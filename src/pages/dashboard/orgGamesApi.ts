export type OrgGame = {

  id: string

  orgId: string

  gameName: string

  steamUrl: string | null

  imageUrl: string | null

  createdBy: string

  createdAt: string

}



export type OrgProposal = {

  id: string

  orgId: string

  proposalType: 'ADD_GAME' | 'REMOVE_GAME'

  status: string

  gameName: string

  steamUrl: string | null

  imageUrl: string | null

  targetGameId: string | null

  proposerUserId: string

  createdAt: string

  expiresAt: string

  resolvedAt: string | null

  expiresInMs: number

  myVote: 'APPROVE' | 'REJECT' | null

  hasVoted: boolean

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



export async function fetchOrgGames(

  orgId: string,

  options: { getToken: () => Promise<string | null> },

): Promise<OrgGame[]> {

  const data = await authFetch(`/api/org-games?orgId=${encodeURIComponent(orgId)}`, options)

  return (data.games as OrgGame[]) ?? []

}



export async function fetchOrgProposals(

  orgId: string,

  options: { getToken: () => Promise<string | null> },

): Promise<{ pending: OrgProposal[]; resolved: OrgProposal[] }> {

  const data = await authFetch(

    `/api/org-games/proposals?orgId=${encodeURIComponent(orgId)}`,

    options,

  )

  return {

    pending: (data.pending as OrgProposal[]) ?? [],

    resolved: (data.resolved as OrgProposal[]) ?? [],

  }

}



export async function createOrgProposal(

  body: {

    orgId: string

    proposalType: 'ADD_GAME' | 'REMOVE_GAME'

    gameName: string

    steamUrl?: string

    imageUrl?: string

    targetGameId?: string

  },

  options: { getToken: () => Promise<string | null> },

): Promise<OrgProposal> {

  const data = await authFetch('/api/org-games/proposals', {

    method: 'POST',

    body: JSON.stringify(body),

    getToken: options.getToken,

  })

  return data.proposal as OrgProposal

}



export async function voteOrgProposal(

  proposalId: string,

  vote: 'APPROVE' | 'REJECT',

  options: { getToken: () => Promise<string | null> },

): Promise<OrgProposal> {

  const data = await authFetch(`/api/org-games/proposals/${encodeURIComponent(proposalId)}/vote`, {

    method: 'POST',

    body: JSON.stringify({ vote }),

    getToken: options.getToken,

  })

  return data.proposal as OrgProposal

}



export function formatExpiresIn(ms: number): string {

  if (ms <= 0) return 'Expired'

  const h = Math.floor(ms / 3_600_000)

  const m = Math.floor((ms % 3_600_000) / 60_000)

  if (h > 0) return `${h}h ${m}m`

  return `${m}m`

}

