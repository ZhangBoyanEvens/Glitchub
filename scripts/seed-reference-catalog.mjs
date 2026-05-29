/**
 * 在 Neon/Postgres 中创建「原始游戏库」表并写入分类 + 游戏。
 * 档间权重：15%、20%、30%、25%、10%、5%（合计 105，抽样时除以 SUM 归一化）；
 * 档内：该档内各游戏均分该档概率。
 *
 * 运行：npm run db:seed:reference-catalog
 */
import 'dotenv/config'
import pg from 'pg'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('Missing DATABASE_URL. Set it in .env (Neon connection string).')
  process.exit(1)
}

/** @type {{ rank: number, label: string, display: string, weight: number, games: string[] }[]} */
const CATALOG = [
  {
    rank: 1,
    label: '好评如潮',
    display: '第 1 档：好评如潮（15%）',
    weight: 15,
    games: [
      '饥荒',
      '星露谷',
      '泰拉瑞亚',
      '左 4 死 2',
      '人类一败涂地',
      '恐鬼症',
      'PICO park',
      '胡闹厨房 2',
    ],
  },
  {
    rank: 2,
    label: '特别好评',
    display: '第 2 档：特别好评（20%）',
    weight: 20,
    games: [
      '致命公司',
      '森林之子',
      '方舟：生存进化',
      '帕鲁',
      'raft',
      'GTA5',
      'ready or not',
      '僵尸世界大战',
      'squad（战术小队）',
      '潜渊症',
      'Among us',
      '骗子酒馆',
      'Peak',
      '胖揍派对',
    ],
  },
  {
    rank: 3,
    label: '多半好评',
    display: '第 3 档：多半好评（30%）',
    weight: 30,
    games: [
      '逃离后室',
      'Repo',
      '盗窃地精',
      '前方高能',
      'Chain tgt',
      '袜罪并罚',
      'Keep Exploding no Talking',
      'RV There Yet?',
      'Palia',
    ],
  },
  {
    rank: 4,
    label: '褒贬不一',
    display: '第 4 档：褒贬不一（25%）',
    weight: 25,
    games: [
      'Shift at Midnight（Demo）',
      'SOS OPS',
      '乞丐模拟器',
      'casino simulator',
      '文明 6',
    ],
  },
  {
    rank: 5,
    label: '多半差评',
    display: '第 5 档：多半差评（10%）',
    weight: 10,
    games: ['Payday2', 'PCL2 MC', '腾讯斗地主'],
  },
  {
    rank: 6,
    label: 'CD期',
    display: '第 6 档：CD期（5%）',
    weight: 5,
    games: ['恶魔轮盘（CD期）', '你画我猜（CD期）'],
  },
]

const DDL = `
CREATE TABLE IF NOT EXISTS reference_game_categories (
  id SERIAL PRIMARY KEY,
  tier_rank SMALLINT NOT NULL UNIQUE CHECK (tier_rank BETWEEN 1 AND 6),
  label_zh TEXT NOT NULL,
  display_name_zh TEXT NOT NULL,
  tier_pick_weight NUMERIC(8,4) NOT NULL CHECK (tier_pick_weight > 0)
);

COMMENT ON TABLE reference_game_categories IS
  '原始游戏库口碑档位；档间按 tier_pick_weight 加权（与 SUM 归一化）；档内游戏均匀。';

CREATE TABLE IF NOT EXISTS reference_games (
  id SERIAL PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES reference_game_categories(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL,
  title TEXT NOT NULL,
  UNIQUE (category_id, sort_order)
);

CREATE INDEX IF NOT EXISTS idx_reference_games_category_id ON reference_games(category_id);
`

const pool = new pg.Pool({ connectionString: url })

async function main() {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(DDL)
    await client.query(
      'TRUNCATE TABLE reference_game_categories RESTART IDENTITY CASCADE',
    )

    for (const t of CATALOG) {
      const { rows } = await client.query(
        `INSERT INTO reference_game_categories (tier_rank, label_zh, display_name_zh, tier_pick_weight)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [t.rank, t.label, t.display, t.weight],
      )
      const categoryId = rows[0].id
      for (let i = 0; i < t.games.length; i++) {
        await client.query(
          `INSERT INTO reference_games (category_id, sort_order, title) VALUES ($1, $2, $3)`,
          [categoryId, i + 1, t.games[i]],
        )
      }
    }

    await client.query('COMMIT')
    const { rows: counts } = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM reference_game_categories) AS categories,
        (SELECT COUNT(*)::int FROM reference_games) AS games
    `)
    console.log(
      'Reference catalog seeded:',
      counts[0].categories,
      'categories,',
      counts[0].games,
      'games.',
    )
  } catch (e) {
    await client.query('ROLLBACK')
    console.error(e)
    process.exitCode = 1
  } finally {
    client.release()
    await pool.end()
  }
}

main()
