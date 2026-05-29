import { requireOrgMember } from '../orgGames/clerkOrgAccess.js'
import { loadHomepageDashboard } from './homepageDashboardService.js'

/**
 * GET /api/homepage/dashboard?orgId=
 */
export function registerHomepageRoutes(app, pool) {
  app.get('/api/homepage/dashboard', async (req, res) => {
    if (!pool) {
      res.status(503).json({ ok: false, message: 'DATABASE_URL not configured' })
      return
    }

    const orgId = String(req.query.orgId ?? '').trim()
    if (!orgId) {
      res.status(400).json({ ok: false, message: 'orgId is required' })
      return
    }

    const auth = await requireOrgMember(req, orgId)
    if (!auth.ok) {
      res.status(auth.status).json({ ok: false, message: auth.message })
      return
    }

    try {
      const dashboard = await loadHomepageDashboard(pool, orgId, auth.userId)
      res.json({ ok: true, ...dashboard })
    } catch (err) {
      console.error('[homepage/dashboard]', err)
      const message = err instanceof Error ? err.message : String(err)
      res.status(500).json({ ok: false, message })
    }
  })
}
