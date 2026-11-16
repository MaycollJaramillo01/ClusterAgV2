import { createHttpError } from './http.js';
import { listRecords } from './records.js';
import {
    buildChatGroups,
    canManageChatGroups,
    isDmParticipant
} from './chat-groups.js';

export const loadChatGroupAccess = async (
    userRecord,
    messages = null,
    allowOversight = true,
    includeContext = false
) => {
    const canAccessAll = allowOversight && canManageChatGroups(userRecord);
    if (canAccessAll && !includeContext) {
        return { canAccessAll: true, clientIds: new Set(), context: null };
    }
    const [clients, allMessages, membershipRecords, users, managers, editors, teamGroups] = await Promise.all([
        listRecords({ collectionName: 'clients' }),
        messages ? Promise.resolve(messages) : listRecords({ collectionName: 'client_chats' }),
        listRecords({ collectionName: 'chat_group_memberships' }),
        listRecords({ collectionName: 'users' }),
        listRecords({ collectionName: 'managers' }),
        listRecords({ collectionName: 'editors' }),
        listRecords({ collectionName: 'team_groups' })
    ]);
    const context = buildChatGroups({
        clients,
        messages: allMessages,
        membershipRecords,
        users,
        managers,
        editors,
        teamGroups
    });
    const actorId = context.resolvePersonId({
        id: userRecord?.id,
        email: userRecord?.email,
        name: userRecord?.name
    });
    return {
        canAccessAll,
        clientIds: new Set(context.groups
            .filter((group) => group.memberIds.map(String).includes(String(actorId)))
            .map((group) => String(group.clientId))),
        context
    };
};

export const ensureChatClientAccess = async (userRecord, clientId, { allowOversight = false } = {}) => {
    const access = await loadChatGroupAccess(userRecord, null, allowOversight, true);
    if (access.canAccessAll || access.clientIds.has(String(clientId || ''))) return;
    const actorCandidates = [
        access.context?.resolvePersonId?.({
            id: userRecord?.id,
            email: userRecord?.email,
            name: userRecord?.name
        }),
        userRecord?.id
    ];
    if (isDmParticipant(clientId, actorCandidates)) return;
    throw createHttpError(403, 'No perteneces a este grupo.', 'chat-groups/membership-required');
};
