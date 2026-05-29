/**
 * 组织游戏库 + 提案/投票表（启动时自动补齐）
 */
export async function ensureOrgGamesSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS organization_games (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id TEXT NOT NULL,
      game_name TEXT NOT NULL,
      steam_url TEXT,
      image_url TEXT,
      created_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_organization_games_org_name
      ON organization_games (org_id, lower(trim(game_name)))
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_organization_games_org
      ON organization_games (org_id)
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS organization_game_proposals (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id TEXT NOT NULL,
      proposer_user_id TEXT NOT NULL,
      proposal_type TEXT NOT NULL CHECK (proposal_type IN ('ADD_GAME', 'REMOVE_GAME')),
      status TEXT NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED')),
      game_name TEXT NOT NULL,
      steam_url TEXT,
      image_url TEXT,
      target_game_id UUID REFERENCES organization_games (id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL,
      resolved_at TIMESTAMPTZ,
      resolution_email_sent_at TIMESTAMPTZ
    )
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_org_game_proposals_org_status
      ON organization_game_proposals (org_id, status, expires_at)
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS organization_game_votes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      proposal_id UUID NOT NULL REFERENCES organization_game_proposals (id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      vote TEXT NOT NULL CHECK (vote IN ('APPROVE', 'REJECT')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (proposal_id, user_id)
    )
  `)
}
