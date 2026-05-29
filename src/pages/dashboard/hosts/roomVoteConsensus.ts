import type { RoomMemberApi } from './roomMembersApi.ts'
import type { RoomGameVoteValue } from './roomGameVotesApi.ts'

/** 所有在线且可投票成员均对当前游戏投了赞成 */
export function isUnanimousOnlineApprove(
  members: RoomMemberApi[],
  votesByUserId: Map<string, RoomGameVoteValue>,
  gameTitle: string,
): boolean {
  const title = gameTitle.trim()
  if (!title) return false

  const onlineVoters = members.filter((m) => m.isOnline && m.clerkUserId)
  if (onlineVoters.length === 0) return false

  return onlineVoters.every((m) => votesByUserId.get(m.clerkUserId!) === 'approve')
}
