import { verifyToken } from '@clerk/backend'

/**
 * @param {import('express').Request} req
 * @returns {Promise<string | null>} Clerk user id (sub)
 */
export async function clerkUserIdFromRequest(req) {
  const h = req.headers.authorization
  if (!h?.toLowerCase().startsWith('bearer ')) return null
  const token = h.slice(7).trim()
  if (!token || !process.env.CLERK_SECRET_KEY) return null
  try {
    const payload = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY,
    })
    return payload?.sub ?? null
  } catch {
    return null
  }
}
