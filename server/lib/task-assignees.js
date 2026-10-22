const uniqueIds = (values = []) => [...new Set(
    (Array.isArray(values) ? values : [])
        .map((value) => String(value || '').trim())
        .filter(Boolean)
)];

export const normalizeTaskAssignees = (payload = {}, existing = null) => {
    const fromPayload = Object.hasOwn(payload, 'assignees')
        ? uniqueIds(payload.assignees)
        : null;
    const fallback = uniqueIds([
        payload.contextId,
        payload.assigneeUserId,
        ...(Array.isArray(existing?.assignees) ? existing.assignees : []),
        existing?.contextId,
        existing?.assigneeUserId
    ]);
    const assignees = fromPayload || fallback;
    const primary = assignees[0] || String(payload.contextId || existing?.contextId || '').trim();
    return {
        assignees,
        contextId: primary || '',
        assigneeUserId: String(payload.assigneeUserId || existing?.assigneeUserId || primary || '').trim()
    };
};
