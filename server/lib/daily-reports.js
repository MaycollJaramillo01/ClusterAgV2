import { listRecords } from './records.js';
import { sendDailyReportEmail } from './email.js';
import { nowIso } from './time.js';
import { createPdfDocument } from './pdf.js';

const HONDURAS_TIMEZONE = 'America/Tegucigalpa';
const HONDURAS_OFFSET = '-06:00';
const DAY_MS = 24 * 60 * 60 * 1000;
const REPORT_CUTOFF_HOUR = 6;

const getLastActivityLabel = (record = {}) => {
    const raw = record?.updatedAt || record?.createdAt || record?.lastSeenAt || '';
    if (!raw) return 'Sin actividad';
    try {
        return new Date(raw).toLocaleString('es-HN', {
            timeZone: HONDURAS_TIMEZONE,
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch {
        return String(raw);
    }
};

const normalizeRoleName = (role) => {
    if (!role) return 'Sin rol';
    return String(role).replace(/_/g, ' ');
};

const getHondurasDateParts = (value = Date.now()) => {
    const date = value instanceof Date ? value : new Date(value);
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: HONDURAS_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        weekday: 'short'
    }).formatToParts(date);
    const getPart = (type) => parts.find((part) => part.type === type)?.value || '';
    return {
        year: getPart('year'),
        month: getPart('month'),
        day: getPart('day'),
        weekday: getPart('weekday')
    };
};

const getTaskOwnerKeys = (task = {}) => {
    const keys = new Set();
    if (Array.isArray(task.assignees)) {
        for (const assigneeId of task.assignees) {
            if (assigneeId) keys.add(assigneeId);
        }
    }
    [task.contextId, task.ownerAtCompletionId, task.assigneeUserId, task.userId]
        .filter(Boolean)
        .forEach((value) => keys.add(value));
    return [...keys];
};

const getReportDayKey = (now = Date.now()) => {
    const { year, month, day } = getHondurasDateParts(now);
    return `${year}-${month}-${day}`;
};

const formatWindowInstant = (ms) => {
    try {
        return new Date(ms).toLocaleString('es-HN', {
            timeZone: HONDURAS_TIMEZONE,
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch {
        return String(ms);
    }
};

/**
 * Ventana de reporte: [6:00 AM, 6:00 AM siguiente) en hora Honduras.
 * Al enviarse el 7 ago a las 6:00 AM, cubre 6 ago 06:00 → 7 ago 06:00.
 */
export const getDailyReportWindow = (now = Date.now()) => {
    const { year, month, day } = getHondurasDateParts(now);
    const todayKey = `${year}-${month}-${day}`;
    const todayCutoffMs = Date.parse(`${todayKey}T${String(REPORT_CUTOFF_HOUR).padStart(2, '0')}:00:00${HONDURAS_OFFSET}`);
    const endMs = now < todayCutoffMs ? todayCutoffMs - DAY_MS : todayCutoffMs;
    const startMs = endMs - DAY_MS;
    return {
        startMs,
        endMs,
        labelDayKey: getReportDayKey(startMs),
        periodLabel: `${formatWindowInstant(startMs)} – ${formatWindowInstant(endMs)} (Honduras)`
    };
};

const isTimestampInWindow = (value, window) => {
    if (!value || typeof value !== 'string') return false;
    const ms = Date.parse(value);
    if (!Number.isFinite(ms)) return false;
    return ms >= window.startMs && ms < window.endMs;
};

export const getTaskCompletionIso = (task = {}) => {
    const status = String(task.status || '').toLowerCase();
    const candidates = [
        task.completedAt,
        task.statusTimestamps?.[task.status],
        task.statusTimestamps?.aprobado_internamente,
        task.statusTimestamps?.aprobado,
        task.statusTimestamps?.publicado,
        task.statusTimestamps?.cerrado,
        task.internallyApprovedAt,
        task.approvedAt,
        task.publishedAt,
        task.closedAt
    ].filter((value) => Number.isFinite(Date.parse(value)));
    if (candidates.length) {
        return candidates.sort((left, right) => Date.parse(left) - Date.parse(right))[0];
    }
    if (['publicado', 'aprobado', 'aprobado_internamente', 'cerrado'].includes(status)) {
        return task.updatedAt || task.createdAt || '';
    }
    return '';
};

const isCreatedInReportWindow = (createdAt, window) => isTimestampInWindow(createdAt, window);

const isCompletedInReportWindow = (task, closedStatuses, window) => {
    const status = String(task?.status || '').toLowerCase();
    if (!closedStatuses.has(status)) return false;
    return isTimestampInWindow(getTaskCompletionIso(task), window);
};

export const shouldSendDailyRoleReport = (date = new Date()) => {
    const weekday = getHondurasDateParts(date).weekday;
    return weekday !== 'Sun';
};

export const summarizeRolePerformance = ({ people = [], tasks = [], collectionName, closedStatuses = new Set(), now = Date.now() }) => {
    const taskMap = new Map();
    const peopleList = Array.isArray(people) ? people : [];
    const taskList = Array.isArray(tasks) ? tasks : [];
    const window = getDailyReportWindow(now);

    for (const task of taskList) {
        if (!isCreatedInReportWindow(task?.createdAt || '', window)) continue;

        const ownerKeys = getTaskOwnerKeys(task);
        if (ownerKeys.length === 0) continue;
        for (const ownerKey of ownerKeys) {
            const bucket = taskMap.get(ownerKey) || [];
            bucket.push(task);
            taskMap.set(ownerKey, bucket);
        }
    }

    const peopleSummary = peopleList.map((person) => {
        const perPersonTaskMap = new Map();
        [person.id, person.userId].filter(Boolean).forEach((ownerKey) => {
            const ownerTasks = taskMap.get(ownerKey) || [];
            ownerTasks.forEach((task) => {
                const dedupeKey = task.id || `${task.contextId || ''}-${task.createdAt || ''}-${task.title || ''}`;
                if (!perPersonTaskMap.has(dedupeKey)) perPersonTaskMap.set(dedupeKey, task);
            });
        });
        const perPersonTasks = [...perPersonTaskMap.values()];
        const created = perPersonTasks.length;
        const completed = perPersonTasks.filter((task) => isCompletedInReportWindow(task, closedStatuses, window)).length;
        const inProgress = created - completed;

        const lastActivity = perPersonTasks.reduce((latest, task) => {
            const candidate = getTaskCompletionIso(task) || task?.updatedAt || task?.createdAt || '';
            if (!candidate) return latest;
            const candidateMs = Date.parse(candidate);
            if (!Number.isFinite(candidateMs)) return latest;
            if (!latest || candidateMs > latest) return candidateMs;
            return latest;
        }, null);

        return {
            id: person.id,
            name: person.name || person.email || 'Sin nombre',
            email: person.email || '',
            role: normalizeRoleName(person.role || ''),
            collectionName,
            created,
            completed,
            approved: completed,
            inProgress,
            rate: created > 0 ? Math.round((completed / created) * 100) : 0,
            lastActivity,
            lastActivityLabel: getLastActivityLabel({ updatedAt: lastActivity })
        };
    });

    const totals = peopleSummary.reduce((acc, person) => ({
        created: acc.created + person.created,
        completed: acc.completed + person.completed,
        approved: acc.approved + person.approved,
        inProgress: acc.inProgress + person.inProgress
    }), { created: 0, completed: 0, approved: 0, inProgress: 0 });
    totals.rate = totals.created > 0 ? Math.round((totals.completed / totals.created) * 100) : 0;

    return { collectionName, people: peopleSummary, totals, window };
};

const CRITERION_LABEL = 'Criterio: tareas creadas en el periodo y completadas el mismo dia (6:00 AM Honduras).';

const formatRate = (person = {}) => {
    const created = Number(person.created) || 0;
    const completed = Number(person.completed ?? person.approved) || 0;
    if (created <= 0) return '—';
    const rate = Number.isFinite(person.rate) ? person.rate : Math.round((completed / created) * 100);
    return `${rate}%`;
};

const buildPdfBuffer = async ({ title, people, totals, generatedAt, periodLabel, showArea = false }) => {
    const doc = createPdfDocument();
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));

    const rowHeight = 20;
    const colWidths = showArea
        ? [118, 72, 52, 78, 62, 42, 90]
        : [150, 58, 78, 70, 48, 110];
    const headers = showArea
        ? ['Persona', 'Area', 'Creadas', 'Completadas', 'Pendientes', '%', 'Ultima actividad']
        : ['Persona', 'Creadas', 'Completadas', 'Pendientes', '%', 'Ultima actividad'];
    const xStart = 40;

    const drawHeader = () => {
        doc.fontSize(18).fillColor('#0f172a').text(title, { align: 'left' });
        doc.moveDown(0.5);
        doc.fontSize(10).fillColor('#475569').text(`Generado: ${generatedAt}`, { align: 'left' });
        doc.moveDown(0.3);
        doc.fontSize(10).fillColor('#64748b').text(`Periodo: ${periodLabel}`, { align: 'left' });
        doc.moveDown(0.2);
        doc.fontSize(10).fillColor('#64748b').text(CRITERION_LABEL, { align: 'left' });
        doc.moveDown(1);
        doc.fontSize(12).fillColor('#0f172a').text('Resumen por persona');
        doc.moveDown(0.4);
    };

    const drawTableHeader = (topY) => {
        doc.fontSize(9).fillColor('#334155');
        headers.forEach((header, index) => {
            const x = xStart + colWidths.slice(0, index).reduce((sum, width) => sum + width, 0);
            doc.text(header, x, topY, { width: colWidths[index], align: 'left' });
        });
        doc.moveTo(xStart, topY + 12)
            .lineTo(xStart + colWidths.reduce((sum, width) => sum + width, 0), topY + 12)
            .stroke('#cbd5e1');
        return topY + 18;
    };

    drawHeader();
    let currentY = drawTableHeader(doc.y);
    const pageBottom = () => doc.page.height - doc.page.margins.bottom;

    people.forEach((person) => {
        if (currentY + rowHeight > pageBottom() - 30) {
            doc.addPage();
            drawHeader();
            currentY = drawTableHeader(doc.y);
        }

        const completed = person.completed ?? person.approved ?? 0;
        const values = showArea
            ? [
                person.name,
                person.area || person.role || '',
                String(person.created ?? 0),
                String(completed),
                String(person.inProgress ?? 0),
                formatRate(person),
                person.lastActivityLabel || 'Sin actividad'
            ]
            : [
                person.name,
                String(person.created ?? 0),
                String(completed),
                String(person.inProgress ?? 0),
                formatRate(person),
                person.lastActivityLabel || 'Sin actividad'
            ];

        values.forEach((value, index) => {
            const x = xStart + colWidths.slice(0, index).reduce((sum, width) => sum + width, 0);
            doc.text(value, x, currentY, { width: colWidths[index], align: 'left' });
        });
        currentY += rowHeight;
    });

    const completedTotal = totals.completed ?? totals.approved ?? 0;
    doc.moveDown(1.5);
    doc.fontSize(11).fillColor('#0f172a').text('Totales');
    doc.fontSize(10).fillColor('#475569').text(
        `Personas: ${people.length} | Creadas: ${totals.created || 0} | Completadas mismo dia: ${completedTotal} | Pendientes: ${totals.inProgress || 0} | Cierre: ${totals.created ? `${totals.rate || 0}%` : '—'}`
    );

    doc.end();
    await new Promise((resolve, reject) => {
        doc.once('end', resolve);
        doc.once('error', reject);
    });

    return Buffer.concat(chunks);
};

export const buildDailyRoleReportPdf = async ({
    title,
    people = [],
    totals = {},
    generatedAt = nowIso(),
    periodLabel = '',
    showArea = false
}) => buildPdfBuffer({ title, people, totals, generatedAt, periodLabel, showArea });

export const mergeGeneralPerformance = (summaries = []) => {
    const byKey = new Map();
    for (const summary of summaries) {
        const areaLabel = summary.areaLabel || summary.collectionName || '';
        for (const person of summary.people || []) {
            const key = String(person.email || person.id || '').toLowerCase() || person.id;
            if (!key) continue;
            const current = byKey.get(key);
            if (!current) {
                byKey.set(key, {
                    ...person,
                    area: areaLabel,
                    areas: areaLabel ? [areaLabel] : [],
                    completed: person.completed ?? person.approved ?? 0,
                    approved: person.completed ?? person.approved ?? 0
                });
                continue;
            }
            current.created += person.created || 0;
            current.completed += person.completed ?? person.approved ?? 0;
            current.approved = current.completed;
            current.inProgress += person.inProgress || 0;
            if (areaLabel && !current.areas.includes(areaLabel)) current.areas.push(areaLabel);
            current.area = current.areas.join(' / ');
            const latest = Date.parse(person.lastActivity);
            const currentLatest = Date.parse(current.lastActivity);
            if (Number.isFinite(latest) && (!Number.isFinite(currentLatest) || latest > currentLatest)) {
                current.lastActivity = person.lastActivity;
                current.lastActivityLabel = person.lastActivityLabel;
            }
        }
    }
    const people = [...byKey.values()]
        .map((person) => ({
            ...person,
            rate: person.created > 0 ? Math.round((person.completed / person.created) * 100) : 0
        }))
        .sort((left, right) => right.completed - left.completed || right.created - left.created || String(left.name).localeCompare(String(right.name)));
    const totals = people.reduce((acc, person) => ({
        created: acc.created + person.created,
        completed: acc.completed + person.completed,
        approved: acc.approved + person.completed,
        inProgress: acc.inProgress + person.inProgress
    }), { created: 0, completed: 0, approved: 0, inProgress: 0 });
    totals.rate = totals.created > 0 ? Math.round((totals.completed / totals.created) * 100) : 0;
    return { people, totals };
};

const getCollectionPeople = async ({ collectionName }) => listRecords({ collectionName });

const MANAGEMENT_ROLES = new Set(['super_admin', 'operations', 'management', 'manager']);

const selectManagementPeople = (users = [], tasks = []) => {
    const assignedIds = new Set();
    for (const task of tasks) {
        for (const key of getTaskOwnerKeys(task)) assignedIds.add(String(key));
    }
    return users.filter((user) => {
        if (user?.isActive === false) return false;
        if (MANAGEMENT_ROLES.has(user?.role)) return true;
        return assignedIds.has(String(user?.id || ''));
    });
};

export const buildDailyPerformanceReports = async ({ now = Date.now() } = {}) => {
    const generatedAt = nowIso();
    const window = getDailyReportWindow(now);
    const createdFrom = new Date(window.startMs - 12 * 60 * 60 * 1000).toISOString();
    const createdTo = new Date(window.endMs).toISOString();

    const [editors, communityManagers, users, editingTasks, accountTasks, managementTasks] = await Promise.all([
        getCollectionPeople({ collectionName: 'editors' }),
        getCollectionPeople({ collectionName: 'managers' }),
        getCollectionPeople({ collectionName: 'users' }),
        listRecords({ collectionName: 'editing', createdFrom, createdTo }),
        listRecords({ collectionName: 'account_tasks', createdFrom, createdTo }),
        listRecords({ collectionName: 'management_tasks', createdFrom, createdTo })
    ]);

    const editorsSummary = {
        ...summarizeRolePerformance({
            people: editors,
            tasks: editingTasks,
            collectionName: 'editing',
            closedStatuses: new Set(['aprobado', 'publicado']),
            now
        }),
        areaLabel: 'Edicion'
    };

    const communityManagersSummary = {
        ...summarizeRolePerformance({
            people: communityManagers,
            tasks: accountTasks,
            collectionName: 'account_tasks',
            closedStatuses: new Set(['aprobado_internamente', 'publicado']),
            now
        }),
        areaLabel: 'Account'
    };

    const managementSummary = {
        ...summarizeRolePerformance({
            people: selectManagementPeople(users, managementTasks),
            tasks: managementTasks,
            collectionName: 'management_tasks',
            closedStatuses: new Set(['cerrado']),
            now
        }),
        areaLabel: 'Gestion'
    };

    const general = mergeGeneralPerformance([
        editorsSummary,
        communityManagersSummary,
        managementSummary
    ]);
    const periodLabel = editorsSummary.window?.periodLabel || window.periodLabel;

    const [generalPdf, editorPdf, communityManagerPdf] = await Promise.all([
        buildDailyRoleReportPdf({
            title: 'Rendimiento diario general',
            people: general.people,
            totals: general.totals,
            generatedAt,
            periodLabel,
            showArea: true
        }),
        buildDailyRoleReportPdf({
            title: 'Resumen diario de Editores',
            people: editorsSummary.people,
            totals: editorsSummary.totals,
            generatedAt,
            periodLabel
        }),
        buildDailyRoleReportPdf({
            title: 'Resumen diario de Community Managers',
            people: communityManagersSummary.people,
            totals: communityManagersSummary.totals,
            generatedAt,
            periodLabel
        })
    ]);

    return {
        generatedAt,
        periodLabel,
        window,
        editors: editorsSummary,
        communityManagers: communityManagersSummary,
        management: managementSummary,
        general,
        pdfs: {
            general: generalPdf,
            editors: editorPdf,
            communityManagers: communityManagerPdf
        }
    };
};

export const sendDailyRoleReports = async ({ to = '' } = {}) => {
    const recipient = String(to || '').trim();
    if (!recipient) throw new Error('Falta el destinatario del reporte diario.');
    const now = Date.now();
    if (!shouldSendDailyRoleReport(new Date(now))) {
        return {
            ok: true,
            skipped: true,
            reason: 'domingo',
            generatedAt: nowIso(),
            to: recipient
        };
    }

    const bundle = await buildDailyPerformanceReports({ now });
    const delivery = await sendDailyReportEmail({
        to: recipient,
        subject: `Rendimiento diario ${bundle.window.labelDayKey}`,
        generalPdf: bundle.pdfs.general,
        editorPdf: bundle.pdfs.editors,
        accountPdf: bundle.pdfs.communityManagers,
        generatedAt: bundle.generatedAt,
        periodLabel: bundle.periodLabel
    });

    return {
        ok: true,
        to: recipient,
        generatedAt: bundle.generatedAt,
        periodLabel: bundle.periodLabel,
        delivery: delivery.mode,
        general: bundle.general.totals,
        editors: bundle.editors.totals,
        communityManagers: bundle.communityManagers.totals,
        management: bundle.management.totals
    };
};
