export type PersonalStats = {
  totalRoomsJoined: number
  completedRooms: number
  vetoUsedCount: number
  vetoReceivedCount: number
  readyRate: number
  noShowOfflineRate: number
  reliabilityScore: number
  reliabilityBadge: 'Reliable' | 'Average' | 'Risky'
  attendanceRate: number
  roomCompletionRate: number
}

export type GameProfile = {
  favoriteGames: { gameTitle: string; count: number }[]
  dislikedGames: { gameTitle: string; vetoCount: number }[]
  wishBoostedGames: { gameTitle: string; frequency: number }[]
}

export type OrgLeaderboard = {
  mostPlayed: { gameTitle: string; count: number }[]
  mostVetoed: { gameTitle: string; vetoCount: number }[]
  highestWinRate: {
    gameTitle: string
    totalAppearances: number
    wins: number
    winRate: number
  }[]
  mostRequested: { gameTitle: string; count: number }[]
}

export type RecentRoom = {
  roomId: string
  roomPhase: string
  finalGameTitle: string | null
  playerCount: number
  vetoPassed: boolean
  hadVetoRespun: boolean
  updatedAt: string | null
  scheduledAt: string | null
}

export type RecommendedGame = {
  id: string | null
  gameTitle: string
  score: number
  steamUrl: string | null
  imageUrl: string | null
}

export type HomepageDashboard = {
  personalStats: PersonalStats
  gameProfile: GameProfile
  orgLeaderboard: OrgLeaderboard
  recentRooms: RecentRoom[]
  recommendations: RecommendedGame[]
}

async function authFetch(
  url: string,
  options: RequestInit & { getToken: () => Promise<string | null> },
) {
  const token = await options.getToken()
  if (!token) throw new Error('Please sign in first.')

  const { getToken, ...init } = options
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  })

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown> & {
    message?: string
  }
  if (!res.ok) {
    throw new Error((data.message as string) ?? `Request failed (${res.status})`)
  }
  return data
}

export async function fetchHomepageDashboard(
  orgId: string,
  options: { getToken: () => Promise<string | null> },
): Promise<HomepageDashboard> {
  const data = await authFetch(
    `/api/homepage/dashboard?orgId=${encodeURIComponent(orgId)}`,
    options,
  )
  return {
    personalStats: data.personalStats as PersonalStats,
    gameProfile: data.gameProfile as GameProfile,
    orgLeaderboard: data.orgLeaderboard as OrgLeaderboard,
    recentRooms: data.recentRooms as RecentRoom[],
    recommendations: data.recommendations as RecommendedGame[],
  }
}
