import { createClerkClient } from '@clerk/backend'
import { clerkUserIdFromRequest } from '../clerkAuth.js'

/**
 * @param {string} orgId
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
export async function isOrganizationMember(orgId, userId) {
  const sk = process.env.CLERK_SECRET_KEY?.trim()
  if (!sk || !orgId || !userId) return false

  const clerk = createClerkClient({ secretKey: sk })
  let offset = 0
  const limit = 100

  for (;;) {
    const page = await clerk.organizations.getOrganizationMembershipList({
      organizationId: orgId,
      limit,
      offset,
    })
    const members = page.data ?? []
    if (members.some((m) => m.publicUserData?.userId === userId)) {
      return true
    }
    if (members.length < limit) break
    offset += limit
    if (offset > 5000) break
  }
  return false
}

/**
 * @param {string} orgId
 * @returns {Promise<string[]>}
 */
export async function listOrganizationMemberUserIds(orgId) {
  const sk = process.env.CLERK_SECRET_KEY?.trim()
  if (!sk || !orgId) return []

  const clerk = createClerkClient({ secretKey: sk })
  const ids = []
  let offset = 0
  const limit = 100

  for (;;) {
    const page = await clerk.organizations.getOrganizationMembershipList({
      organizationId: orgId,
      limit,
      offset,
    })
    const members = page.data ?? []
    for (const m of members) {
      const uid = m.publicUserData?.userId
      if (uid) ids.push(uid)
    }
    if (members.length < limit) break
    offset += limit
    if (offset > 5000) break
  }
  return [...new Set(ids)]
}

/**
 * @param {import('express').Request} req
 * @param {string} orgId
 */
export async function requireOrgMember(req, orgId) {
  const userId = await clerkUserIdFromRequest(req)
  if (!userId) {
    return { ok: false, status: 401, message: 'Unauthorized' }
  }
  const member = await isOrganizationMember(orgId, userId)
  if (!member) {
    return { ok: false, status: 403, message: 'Not an organization member' }
  }
  return { ok: true, userId }
}
