/** 检查原始游戏库是否已写入 Neon/Postgres */
import 'dotenv/config'
import pg from 'pg'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('Missing DATABASE_URL')
  process.exit(1)
}

const pool = new pg.Pool({ connectionString: url })
try {
  const { rows: c } = await pool.query(
    'SELECT COUNT(*)::int AS n FROM reference_game_categories',
  )
  const { rows: g } = await pool.query(
    'SELECT COUNT(*)::int AS n FROM reference_games',
  )
  console.log('reference_game_categories:', c[0].n)
  console.log('reference_games:', g[0].n)

  const { rows: sample } = await pool.query(`
    SELECT c.tier_rank, c.label_zh, COUNT(g.id)::int AS games
    FROM reference_game_categories c
    LEFT JOIN reference_games g ON g.category_id = c.id
    GROUP BY c.id, c.tier_rank, c.label_zh
    ORDER BY c.tier_rank
  `)
  console.log('\nPer tier:')
  for (const r of sample) {
    console.log(`  tier ${r.tier_rank} ${r.label_zh}: ${r.games} games`)
  }

  if (c[0].n === 6 && g[0].n === 41) {
    console.log('\nOK: expected 6 categories and 41 games.')
  } else {
    console.log('\nWARN: expected 6 categories and 41 games.')
    process.exitCode = 1
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
} finally {
  await pool.end()
}
