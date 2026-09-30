import { createHttpError } from './http.js';
import { normalizeTaskAssignees } from './task-assignees.js';
import { latestDevStatusLabel, normalizeDevStatusLog } from './dev-task-status.js';
import { normalizeEmail } from './text.js';

const DATE_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const TIME_RE = /^(\d{1,2}):(\d{2})$/;

const normalizeText = (value = '') => (typeof value === 'string' ? value.trim() : '');

export const normalizeManagementTaskDate = (value = '') => {
    const match = normalizeText(value).match(DATE_RE);
    if (!match) return '';
    const [, year, month, day] = match;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
};

export const normalizeManagementTaskTime = (value = '') => {
    const match = normalizeText(value).match(TIME_RE);
    if (!match) return '';
    const [, hours, minutes] = match;
    const normalizedHours = hours.padStart(2, '0');
    if (Number(normalizedHours) > 23 || Number(minutes) > 59) return '';
    return `${normalizedHours}:${minutes}`;
};

const buildReminderResetPatch = () => ({
    reminder24hSentAt: null,
    reminder8hSentAt: null,
    reminder1hSentAt: null,
    overdueSentAt: null,
    lastOverdueNagAt: null,
    lastUpcomingNagAt: null
});

const resolveAssignerName = (actor = null) => normalizeText(actor?.name) || normalizeText(actor?.email) || 'Sistema';

export const prepareManagementTaskPayload = ({
    payload = {},
    existing = null,
    actor = null,
    isCreate = false
}) => {
    const nextPayload = { ...payload };

    if ('title' in nextPayload) nextPayload.title = normalizeText(nextPayload.title);
    if ('notes' in nextPayload) nextPayload.notes = typeof nextPayload.notes === 'string' ? nextPayload.notes.trim() : '';
    if ('clientId' in nextPayload) nextPayload.clientId = normalizeText(nextPayload.clientId);
    if ('category' in nextPayload) nextPayload.category = normalizeText(nextPayload.category).toLowerCase() || 'seguimiento';
    if ('devStatusLog' in nextPayload) {
        nextPayload.devStatusLog = normalizeDevStatusLog(nextPayload.devStatusLog);
        nextPayload.devStatus = latestDevStatusLabel(nextPayload.devStatusLog);
    } else if ('devStatus' in nextPayload) {
        nextPayload.devStatus = normalizeText(nextPayload.devStatus).slice(0, 80);
    }
    if ('contextId' in nextPayload) nextPayload.contextId = normalizeText(nextPayload.contextId);
    if ('assigneeUserId' in nextPayload) nextPayload.assigneeUserId = normalizeText(nextPayload.assigneeUserId);
    Object.assign(nextPayload, normalizeTaskAssignees(nextPayload, existing));
    if ('notificationsEnabled' in nextPayload || isCreate) nextPayload.notificationsEnabled = nextPayload.notificationsEnabled !== false;

    const titleAfterPatch = normalizeText('title' in nextPayload ? nextPayload.title : existing?.title);
    if (!titleAfterPatch) {
        throw createHttpError(400, 'La tarea de gestion requiere un titulo.', 'management_tasks/title-required');
    }

    const hasDueInput = 'date' in nextPayload || 'time' in nextPayload || isCreate;
    const normalizedDate = normalizeManagementTaskDate(hasDueInput ? nextPayload.date : existing?.date);
    const normalizedTime = normalizeManagementTaskTime(hasDueInput ? nextPayload.time : existing?.time);
    const shouldRequireDue = hasDueInput || ('notificationsEnabled' in nextPayload && nextPayload.notificationsEnabled !== false);

    if (shouldRequireDue && (!normalizedDate || !normalizedTime)) {
        throw createHttpError(400, 'La tarea de gestion requiere fecha y hora limite.', 'management_tasks/due-required');
    }

    if (normalizedDate) nextPayload.date = normalizedDate;
    if (normalizedTime) nextPayload.time = normalizedTime;

    const existingContextId = normalizeText(existing?.contextId);
    const nextContextId = normalizeText(nextPayload.contextId || existingContextId);
    const shouldRequireAssignee = isCreate || ('notificationsEnabled' in nextPayload && nextPayload.notificationsEnabled !== false);
    if (shouldRequireAssignee && !nextContextId) {
        throw createHttpError(400, 'La tarea de gestion requiere un responsable asignado.', 'management_tasks/assignee-required');
    }
    const assigneeChanged = Boolean(existing) && nextContextId !== existingContextId;
    const statusAfterPatch = normalizeText('status' in nextPayload ? nextPayload.status : existing?.status);
    const reopened = Boolean(existing) && normalizeText(existing?.status) === 'cerrado' && statusAfterPatch && statusAfterPatch !== 'cerrado';
    const dueChanged = Boolean(existing) && (
        normalizedDate !== normalizeManagementTaskDate(existing?.date) ||
        normalizedTime !== normalizeManagementTaskTime(existing?.time)
    );
    const notificationsDisabled = Boolean(existing) && existing.notificationsEnabled !== false && nextPayload.notificationsEnabled === false;
    const notificationsReenabled = Boolean(existing) && existing.notificationsEnabled === false && nextPayload.notificationsEnabled !== false;

    if (isCreate || assigneeChanged) {
        nextPayload.assignedByUserId = actor?.id || existing?.assignedByUserId || '';
        nextPayload.assignedByName = resolveAssignerName(actor);
        nextPayload.assignedByEmail = normalizeEmail(actor?.email);
    }

    if (dueChanged || assigneeChanged || reopened || notificationsDisabled || notificationsReenabled) {
        Object.assign(nextPayload, buildReminderResetPatch());
    }

    return nextPayload;
};
