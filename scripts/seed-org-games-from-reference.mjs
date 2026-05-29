/**
 * 将 reference_games（全局参考目录）一次性导入 organization_games（指定组织）。
 * 幂等：同名游戏已存在则跳过。
 *
 * 用法：
 *   node scripts/seed-org-games-from-reference.mjs <orgId> [createdByUserId]
 *   ORG_SEED_ORG_ID=org_xxx node scripts/seed-org-games-from-reference.mjs
 *
 * createdBy 默认 system:reference-seed（可传 Clerk user id）
 */
import 'dotenv/config'
import pg from 'pg'
import { createClerkClient } from '@clerk/backend'
import { ensureOrgGamesSchema } from '../server/orgGames/orgGamesSchema.js'
import { resolveReferenceMetaForTitle } from '../server/orgGames/referenceGameMetadata.js'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('Missing DATABASE_URL in .env')
  process.exit(1)
}

const orgId = (process.argv[2] ?? process.env.ORG_SEED_ORG_ID ?? '').trim()
const createdBy = (process.argv[3] ?? process.env.ORG_SEED_CREATED_BY ?? 'system:reference-seed').trim()

if (!orgId) {
  console.error('Usage: node scripts/seed-org-games-from-reference.mjs <orgId> [createdByUserId]')
  console.error('  or set ORG_SEED_ORG_ID in .env')
  process.exit(1)
}

const pool = new pg.Pool({ connectionString: url })

async function discoverOrgIdFromDb(client) {
  const fromHost = await client.query(`
    SELECT org_id, COUNT(*)::int AS n
    FROM host_invitations
    WHERE org_id IS NOT NULL AND trim(org_id) <> ''
    GROUP BY org_id
    ORDER BY n DESC
    LIMIT 1
  `)
  return fromHost.rows[0]?.org_id ?? null
}

async function discoverOrgIdFromClerk() {
  const sk = process.env.CLERK_SECRET_KEY?.trim()
  if (!sk) return null
  const clerk = createClerkClient({ secretKey: sk })
  const page = await clerk.organizations.getOrganizationList({ limit: 10 })
  const orgs = page.data ?? []
  if (orgs.length === 1) return orgs[0].id
  if (orgs.length > 1) {
    console.log('Clerk organizations (pass org id as argv if wrong):')
    for (const o of orgs) {
      console.log(`  ${o.id}  ${o.name ?? ''}`)
    }
    return orgs[0].id
  }
  return null
}

async function discoverOrgId(client) {
  const fromDb = await discoverOrgIdFromDb(client)
  if (fromDb) return fromDb
  return discoverOrgIdFromClerk()
}

async function main() {
  const client = await pool.connect()
  let targetOrgId = orgId

  try {
    await ensureOrgGamesSchema(pool)

    if (targetOrgId === 'auto' || targetOrgId === '--auto') {
      const found = await discoverOrgId(client)
      if (!found) {
        console.error('Could not auto-detect org_id. Pass org_xxx explicitly.')
        process.exit(1)
      }
      targetOrgId = found
      console.log('Auto-detected org_id:', targetOrgId)
    }

    const { rows: games } = await client.query(
      `SELECT title FROM reference_games ORDER BY category_id, sort_order`,
    )
    if (!games.length) {
      console.error('reference_games is empty. Run: npm run db:seed:reference-catalog')
      process.exit(1)
    }

    await client.query('BEGIN')
    let inserted = 0
    let skipped = 0

    let metaUpdated = 0

    for (const g of games) {
      const name = String(g.title ?? '').trim()
      if (!name) continue

      const meta = resolveReferenceMetaForTitle(name)

      const ins = await client.query(
        `INSERT INTO organization_games (org_id, game_name, steam_url, image_url, created_by)
         SELECT $1, $2, $3, $4, $5
         WHERE NOT EXISTS (
           SELECT 1 FROM organization_games
           WHERE org_id = $1 AND lower(trim(game_name)) = lower(trim($2))
         )
         RETURNING id`,
        [targetOrgId, name, meta?.steamUrl ?? null, meta?.imageUrl ?? null, createdBy],
      )
      if (ins.rowCount > 0) {
        inserted++
      } else {
        skipped++
        if (meta?.steamUrl || meta?.imageUrl) {
          const up = await client.query(
            `UPDATE organization_games
             SET steam_url = COALESCE($3, steam_url),
                 image_url = COALESCE($4, image_url)
             WHERE org_id = $1 AND lower(trim(game_name)) = lower(trim($2))`,
            [targetOrgId, name, meta.steamUrl, meta.imageUrl],
          )
          if (up.rowCount > 0) metaUpdated++
        }
      }
    }

    await client.query('COMMIT')

    const { rows: total } = await client.query(
      `SELECT COUNT(*)::int AS n FROM organization_games WHERE org_id = $1`,
      [targetOrgId],
    )

    console.log(
      `Done. org=${targetOrgId} reference=${games.length} inserted=${inserted} skipped=${skipped} meta_backfill=${metaUpdated} total_in_org=${total[0].n}`,
    )
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
