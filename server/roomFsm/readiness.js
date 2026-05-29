/**
 * Room readiness helpers (lobby + wish-collection ready gates).
 */

/**
 * @param {{ clerkUserId?: string | null, isOnline?: boolean }[]} members
 * @param {Map<string, boolean> | Record<string, boolean>} readyByUser
 */
export function computeRoomReadiness(members, readyByUser) {
  const readyMap =
    readyByUser instanceof Map
      ? readyByUser
      : new Map(Object.entries(readyByUser ?? {}))

  const onlineMembers = members
    .filter((m) => m.isOnline && m.clerkUserId)
    .map((m) => ({
      clerkUserId: m.clerkUserId,
      ready: readyMap.get(m.clerkUserId) === true,
    }))

  const onlineIds = onlineMembers.map((m) => m.clerkUserId)
  const readyMembers = onlineMembers.filter((m) => m.ready).map((m) => m.clerkUserId)
  const allReady = onlineIds.length > 0 && onlineIds.every((id) => readyMap.get(id) === true)

  return {
    onlineMembers: onlineIds,
    readyMembers,
    allReady,
    onlineCount: onlineIds.length,
    readyCount: readyMembers.length,
  }
}
