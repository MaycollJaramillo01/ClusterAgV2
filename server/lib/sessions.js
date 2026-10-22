import { db } from '../db/knex.js';
import { env } from '../config/env.js';
import { createHttpError } from './http.js';
import { randomToken, sha256 } from './crypto.js';
import { addHoursToIso, isIsoExpired, nowIso } from './time.js';
import { getRecord, upsertRecord } from './records.js';

const SESSION_TOUCH_INTERVAL_MS = 15 * 60 * 1000;

const markUserDisconnectedAt = async ({ userRecordId, disconnectedAt = nowIso() }) => {
    if (!userRecordId) return;
    const userRecord = await getRecord({ collectionName: 'users', recordId: userRecordId });
    if (!userRecord) return;

    const currentDisconnectedAt = Date.parse(userRecord.lastDisconnectedAt || '');
    const nextDisconnectedAt = Date.parse(disconnectedAt);
    if (Number.isFinite(currentDisconnectedAt) && Number.isFinite(nextDisconnectedAt)
        && currentDisconnectedAt >= nextDisconnectedAt) return;

    await upsertRecord({
        collectionName: 'users',
        recordId: userRecordId,
        payload: {
            // lastSeenAt se conserva por compatibilidad con las vistas existentes,
            // pero desde ahora representa la ultima desconexion, no el login.
            lastSeenAt: disconnectedAt,
            lastDisconnectedAt: disconnectedAt
        },
        merge: true
    });
};

const finalizeExpiredSessions = async (stamp) => {
    const expiredSessions = await db('auth_sessions')
        .where('expires_at', '<', stamp)
        .select('user_record_id', 'last_seen_at');
    const latestByUser = new Map();
    expiredSessions.forEach((session) => {
        const current = latestByUser.get(session.user_record_id) || '';
        if (!current || String(session.last_seen_at || '') > current) {
            latestByUser.set(session.user_record_id, session.last_seen_at || stamp);
        }
    });
    await Promise.all([...latestByUser].map(([userRecordId, disconnectedAt]) => (
        markUserDisconnectedAt({ userRecordId, disconnectedAt })
    )));
    await db('auth_sessions').where('expires_at', '<', stamp).delete();
};

const buildCookieOptions = (expiresAt = addHoursToIso(env.sessionTtlHours)) => ({
    httpOnly: true,
    sameSite: env.isProduction ? 'none' : 'lax',
    secure: env.isProduction,
    path: '/',
    expires: new Date(expiresAt)
});

export const buildAuthUser = ({ userRecord, provider = 'password' }) => ({
    uid: userRecord.authUid || userRecord.id,
    email: userRecord.email || '',
    displayName: userRecord.name || '',
    emailVerified: userRecord.emailVerified === true,
    isAnonymous: false,
    providerData: provider ? [{ providerId: provider }] : []
});

const buildClearCookieOptions = () => ({
    httpOnly: true,
    sameSite: env.isProduction ? 'none' : 'lax',
    secure: env.isProduction,
    path: '/'
});

const buildSessionContext = ({ sessionToken = '', provider = 'password', expiresAt = '', userRecord }) => ({
    sessionId: sessionToken,
    session: {
        provider,
        expires_at: expiresAt,
        stateless: false
    },
    userRecord,
    user: buildAuthUser({ userRecord, provider })
});

export const createSession = async ({ req, res, userRecord, provider = 'password' }) => {
    const stamp = nowIso();
    const expiresAt = addHoursToIso(env.sessionTtlHours);
    const sessionToken = randomToken(48);
    const sessionId = sha256(sessionToken);

    await Promise.all([
        finalizeExpiredSessions(stamp),
        db('auth_oauth_states').where('expires_at', '<', stamp).delete()
    ]);

    await db('auth_sessions').insert({
        session_id: sessionId,
        user_record_id: userRecord.id,
        provider,
        expires_at: expiresAt,
        last_seen_at: stamp,
        created_at: stamp,
        ip_address: String(req.ip || '').slice(0, 120) || null,
        user_agent: String(req.get?.('user-agent') || '').slice(0, 2000) || null
    });

    await upsertRecord({
        collectionName: 'users',
        recordId: userRecord.id,
        payload: {
            lastLoginAt: stamp,
            updatedAt: stamp
        },
        merge: true
    });

    res.cookie(env.sessionCookieName, sessionToken, buildCookieOptions(expiresAt));
    return sessionToken;
};

export const clearSession = async ({ req, res }) => {
    const sessionToken = req.cookies?.[env.sessionCookieName];
    if (sessionToken) {
        await markUserDisconnectedAt({
            userRecordId: req.auth?.userRecord?.id,
            disconnectedAt: nowIso()
        });
        await db('auth_sessions').where({ session_id: sha256(sessionToken) }).delete();
    }
    res.clearCookie(env.sessionCookieName, buildClearCookieOptions());
};

export const markCurrentSessionDisconnected = async (req) => {
    if (!req.auth?.userRecord?.id) return false;
    const stamp = nowIso();
    await Promise.all([
        markUserDisconnectedAt({
            userRecordId: req.auth.userRecord.id,
            disconnectedAt: stamp
        }),
        req.auth.sessionId
            ? db('auth_sessions')
                .where({ session_id: sha256(req.auth.sessionId) })
                .update({ last_seen_at: stamp })
            : Promise.resolve()
    ]);
    return true;
};

export const attachSession = async (req, res, next) => {
    const sessionToken = req.cookies?.[env.sessionCookieName];
    req.auth = {
        sessionId: '',
        session: null,
        userRecord: null,
        user: null
    };

    if (!sessionToken) {
        next();
        return;
    }

    const sessionId = sha256(sessionToken);
    const session = await db('auth_sessions').where({ session_id: sessionId }).first();
    if (!session || isIsoExpired(session.expires_at)) {
        if (session) {
            await markUserDisconnectedAt({
                userRecordId: session.user_record_id,
                disconnectedAt: session.last_seen_at || nowIso()
            });
        }
        await db('auth_sessions').where({ session_id: sessionId }).delete();
        res.clearCookie(env.sessionCookieName, buildClearCookieOptions());
        next();
        return;
    }

    const userRecord = await getRecord({ collectionName: 'users', recordId: session.user_record_id });
    if (!userRecord || userRecord.isActive === false) {
        await db('auth_sessions').where({ session_id: sessionId }).delete();
        res.clearCookie(env.sessionCookieName, buildClearCookieOptions());
        next();
        return;
    }

    req.auth = buildSessionContext({
        sessionToken,
        provider: session.provider,
        expiresAt: session.expires_at,
        userRecord
    });

    const lastSeenAt = Date.parse(session.last_seen_at || '');
    if (!Number.isFinite(lastSeenAt) || Date.now() - lastSeenAt >= SESSION_TOUCH_INTERVAL_MS) {
        await db('auth_sessions')
            .where({ session_id: sessionId })
            .update({ last_seen_at: nowIso() });
    }

    next();
};

export const requireAuthenticatedUser = (req) => {
    if (!req.auth?.userRecord) {
        throw createHttpError(401, 'Se requiere una sesion activa.', 'auth/session-required');
    }
    if (req.auth.userRecord.isActive === false) {
        throw createHttpError(403, 'La cuenta esta inactiva.', 'auth/user-disabled');
    }
    return req.auth.userRecord;
};
