const uniqueIds = (values = []) => [...new Set(
    (Array.isArray(values) ? values : [])
        .map((value) => String(value || '').trim())
        .filter(Boolean)
)];

export const normalizeTaskAssignees = (payload = {}, existing = null) => {
    const hasList = Object.hasOwn(payload, 'assignees');
    const contextChanged = Boolean(existing) && Object.hasOwn(payload, 'contextId')
        && String(payload.contextId || '').trim() !== String(existing.contextId || '').trim();
    // An explicit reassignment replaces the previous owner; an explicit empty
    // list clears it. Ordinary edits must preserve the existing list exactly.
    const assignees = hasList
        ? uniqueIds(payload.assignees)
        : contextChanged
            ? uniqueIds([payload.contextId])
            : Array.isArray(existing?.assignees)
                ? uniqueIds(existing.assignees)
                : uniqueIds([
                    payload.contextId ?? existing?.contextId,
                    payload.assigneeUserId ?? existing?.assigneeUserId
                ]);
    const primary = assignees[0] || '';
    const assignmentChanged = contextChanged || (hasList
        && primary !== String(existing?.contextId || '').trim());
    const userId = Object.hasOwn(payload, 'assigneeUserId')
        ? String(payload.assigneeUserId || primary).trim()
        : assignmentChanged ? primary : String(existing?.assigneeUserId || primary).trim();
    return {
        assignees,
        contextId: primary,
        assigneeUserId: userId
    };
};
