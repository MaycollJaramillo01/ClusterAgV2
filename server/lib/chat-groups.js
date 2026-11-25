import { normalizeEmail } from './text.js';

const normalizeName = (value = '') => String(value || '')
    .trim()
    .toLocaleLowerCase('es');

const uniqueStrings = (values = []) => [...new Set(
    (Array.isArray(values) ? values : [])
        .map((value) => String(value || '').trim())
        .filter(Boolean)
)];

/** DM conversation id: dm__{sortedUserIdA}__{sortedUserIdB} */
export const buildDmClientId = (leftId = '', rightId = '') => {
    const ids = uniqueStrings([leftId, rightId]).sort();
    if (ids.length !== 2) return '';
    return `dm__${ids[0]}__${ids[1]}`;
};

export const parseDmClientId = (clientId = '') => {
    const raw = String(clientId || '').trim();
    if (!raw.startsWith('dm__')) return null;
    const parts = raw.slice(4).split('__').filter(Boolean);
    if (parts.length !== 2) return null;
    return parts;
};

export const isDmParticipant = (clientId = '', candidateIds = []) => {
    const parts = parseDmClientId(clientId);
    if (!parts) return false;
    const allowed = new Set(parts.map(String));
    return (Array.isArray(candidateIds) ? candidateIds : [])
        .map((value) => String(value || '').trim())
        .filter(Boolean)
        .some((id) => allowed.has(id));
};

export const canManageChatGroups = (userRecord) => (
    userRecord?.isActive !== false
    && ['manager', 'supervisor', 'super_admin'].includes(String(userRecord?.role || ''))
);

export const buildChatDirectory = ({ users = [], managers = [], editors = [] } = {}) => {
    const sourceRecords = [...users, ...managers, ...editors];
    const people = [];
    const personByEmail = new Map();
    const personById = new Map();

    sourceRecords.forEach((record) => {
        if (record?.isActive === false) return;
        const recordId = String(record?.id || '').trim();
        const email = normalizeEmail(record?.email);
        const name = String(record?.name || email || '').trim();
        const canReceiveCallsOutsideGroups = canManageChatGroups(record);
        if (!recordId && !email) return;

        let person = record?.userId
            ? personById.get(String(record.userId))
            : null;
        if (!person && email) person = personByEmail.get(email);
        if (!person) {
            const id = recordId || email;
            person = {
                id,
                name: name || email,
                email,
                // Sin view_users el cliente solo recibe su propio `users`; este
                // directorio es su unica fuente del rol para listar en Equipo a
                // quien solo existe como usuario (editores/accounts sin ficha).
                role: String(record?.role || ''),
                canReceiveCallsOutsideGroups
            };
            people.push(person);
            if (email) personByEmail.set(email, person);
        }
        if (canReceiveCallsOutsideGroups) person.canReceiveCallsOutsideGroups = true;
        if (recordId) personById.set(recordId, person);
        if (record?.linkedManagerId) personById.set(String(record.linkedManagerId), person);
        if (record?.linkedEditorId) personById.set(String(record.linkedEditorId), person);
    });

    const peopleByName = new Map();
    people.forEach((person) => {
        const nameKey = normalizeName(person.name);
        if (!nameKey) return;
        const matches = peopleByName.get(nameKey) || [];
        matches.push(person);
        peopleByName.set(nameKey, matches);
    });

    const resolvePersonId = ({ id = '', email = '', name = '' } = {}) => {
        const idKey = String(id || '').trim();
        if (idKey && personById.has(idKey)) return personById.get(idKey).id;
        const emailKey = normalizeEmail(email);
        if (emailKey && personByEmail.has(emailKey)) return personByEmail.get(emailKey).id;
        const nameMatches = peopleByName.get(normalizeName(name)) || [];
        return nameMatches.length === 1 ? nameMatches[0].id : '';
    };

    people.sort((left, right) => (left.name || '').localeCompare(right.name || '', 'es', {
        sensitivity: 'base'
    }));

    return { people, resolvePersonId };
};

export const buildChatGroups = ({
    clients = [],
    messages = [],
    membershipRecords = [],
    users = [],
    managers = [],
    editors = [],
    teamGroups = []
} = {}) => {
    const directory = buildChatDirectory({ users, managers, editors });
    const clientIds = new Set(clients.map((client) => String(client?.id || '')).filter(Boolean));
    const derivedByClient = new Map();
    const addDerivedMember = (clientId, memberId) => {
        if (!clientId || !memberId) return;
        if (!derivedByClient.has(clientId)) derivedByClient.set(clientId, new Set());
        derivedByClient.get(clientId).add(memberId);
    };

    // El manager asignado al cliente es relevante aun cuando todavia no haya
    // escrito. El resto de integrantes se descubre del historial real.
    clients.forEach((client) => {
        const clientId = String(client?.id || '').trim();
        const managerId = directory.resolvePersonId({ id: client?.managerId });
        addDerivedMember(clientId, managerId);
    });

    const dmGroupsById = new Map();
    messages.forEach((message) => {
        const clientId = String(message?.clientId || '').trim();
        if (!clientId) return;
        const kind = String(message?.kind || 'client');
        if (kind === 'dm') {
            const parts = parseDmClientId(clientId);
            if (!parts) return;
            const memberIds = uniqueStrings(parts
                .map((id) => directory.resolvePersonId({ id }) || id));
            const previous = dmGroupsById.get(clientId);
            dmGroupsById.set(clientId, {
                clientId,
                memberIds: uniqueStrings([
                    ...(previous?.memberIds || []),
                    ...memberIds,
                    directory.resolvePersonId({
                        id: message?.authorId,
                        email: message?.authorEmail,
                        name: message?.authorName
                    })
                ].filter(Boolean)),
                source: 'dm',
                updatedAt: message?.createdAt || previous?.updatedAt || ''
            });
            return;
        }
        if (clientIds.size > 0 && !clientIds.has(clientId)) return;
        addDerivedMember(clientId, directory.resolvePersonId({
            id: message?.authorId,
            email: message?.authorEmail,
            name: message?.authorName
        }));
        uniqueStrings(message?.mentionedIds).forEach((mentionedId) => {
            addDerivedMember(clientId, directory.resolvePersonId({ id: mentionedId }));
        });
    });

    const explicitByClient = new Map();
    membershipRecords.forEach((record) => {
        const clientId = String(record?.clientId || record?.id || '').trim();
        if (!clientId) return;
        const current = explicitByClient.get(clientId);
        if (!current || String(record?.updatedAt || '') >= String(current?.updatedAt || '')) {
            explicitByClient.set(clientId, record);
        }
    });

    const groups = clients.map((client) => {
        const clientId = String(client?.id || '').trim();
        const explicit = explicitByClient.get(clientId);
        const memberIds = explicit
            ? uniqueStrings(explicit.memberIds)
                .map((id) => directory.resolvePersonId({ id }))
                .filter(Boolean)
            : [...(derivedByClient.get(clientId) || new Set())];
        return {
            clientId,
            memberIds: uniqueStrings(memberIds),
            source: explicit ? 'managed' : 'history',
            updatedAt: explicit?.updatedAt || ''
        };
    });

    const teamGroupEntries = (Array.isArray(teamGroups) ? teamGroups : [])
        .map((group) => {
            const groupId = String(group?.id || '').trim();
            if (!groupId) return null;
            const memberIds = uniqueStrings(group?.memberIds)
                .map((id) => directory.resolvePersonId({ id }) || String(id || '').trim())
                .filter(Boolean);
            return {
                clientId: groupId,
                memberIds,
                source: 'team_group',
                updatedAt: group?.updatedAt || ''
            };
        })
        .filter(Boolean);

    return {
        ...directory,
        groups: [...groups, ...teamGroupEntries, ...dmGroupsById.values()]
    };
};

export const getChatGroupChangeError = ({
    actorRole = '',
    actorId = '',
    currentMemberIds = [],
    nextMemberIds = []
} = {}) => {
    const normalizedActorId = String(actorId || '');
    const currentIds = uniqueStrings(currentMemberIds);
    const nextIds = uniqueStrings(nextMemberIds);
    if (!['manager', 'super_admin'].includes(String(actorRole || ''))) {
        if (!normalizedActorId || !currentIds.includes(normalizedActorId)) {
            return 'membership-required';
        }
        return currentIds.some((id) => !nextIds.includes(id)) ? 'remove-forbidden' : '';
    }
    const removesSelf = normalizedActorId
        && currentIds.includes(normalizedActorId)
        && !nextIds.includes(normalizedActorId);
    if (removesSelf && actorRole !== 'super_admin') return 'manager-cannot-leave';
    return '';
};
