/**
 * 为 organization_games 回填 steam_url / image_url（来自 reference-game-metadata.json）
 *
 * 用法：
 *   node scripts/generate-reference-game-metadata.mjs   # 先更新快照
 *   node scripts/backfill-org-games-metadata.mjs [orgId|all|auto]
 */
import 'dotenv/config'
import pg from 'pg'
import { createClerkClient } from '@clerk/backend'
import { resolveReferenceMetaForTitle } from '../server/orgGames/referenceGameMetadata.js'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('Missing DATABASE_URL')
  process.exit(1)
}

const arg = (process.argv[2] ?? 'all').trim()
const pool = new pg.Pool({ connectionString: url })

async function listOrgIds() {
  if (arg !== 'all' && arg !== 'auto') return [arg]

  const sk = process.env.CLERK_SECRET_KEY?.trim()
  if (!sk) {
    console.error('CLERK_SECRET_KEY required for all/auto')
    process.exit(1)
  }
  const clerk = createClerkClient({ secretKey: sk })
  const page = await clerk.organizations.getOrganizationList({ limit: 50 })
  const ids = (page.data ?? []).map((o) => o.id)
  if (!ids.length) {
    console.error('No Clerk organizations found')
    process.exit(1)
  }
  if (arg === 'auto') return [ids[0]]
  return ids
}

async function backfillOrg(client, orgId) {
  const { rows } = await client.query(
    `SELECT id, game_name, steam_url, image_url FROM organization_games WHERE org_id = $1`,
    [orgId],
  )

  let updated = 0
  let missing = 0

  for (const row of rows) {
    const meta = resolveReferenceMetaForTitle(row.game_name)
    if (!meta) {
      missing++
      continue
    }

    const steamUrl = meta.steamUrl ?? row.steam_url
    const imageUrl = meta.imageUrl ?? row.image_url

    if (!steamUrl && !imageUrl) {
      missing++
      continue
    }

    const res = await client.query(
      `UPDATE organization_games
       SET steam_url = COALESCE($3, steam_url),
           image_url = COALESCE($4, image_url)
       WHERE id = $1 AND org_id = $2`,
      [row.id, orgId, steamUrl, imageUrl],
    )
    if (res.rowCount > 0) updated++
  }

  return { total: rows.length, updated, missing }
}

async function main() {
  const orgIds = await listOrgIds()
  const client = await pool.connect()

  try {
    for (const orgId of orgIds) {
      await client.query('BEGIN')
      const stats = await backfillOrg(client, orgId)
      await client.query('COMMIT')
      console.log(`org=${orgId} total=${stats.total} updated=${stats.updated} no_meta=${stats.missing}`)
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    console.error(err)
    process.exitCode = 1
  } finally {
    client.release()
    await pool.end()
  }
}

main()
