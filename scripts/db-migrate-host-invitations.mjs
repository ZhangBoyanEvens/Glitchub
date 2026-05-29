/**
 * 在 Neon 上创建：用户加入码表、主机邀请表、受邀人表。
 * 用法：DATABASE_URL=... node scripts/db-migrate-host-invitations.mjs
 */
import 'dotenv/config'
import pg from 'pg'

const sql = `
CREATE TABLE IF NOT EXISTS app_user_join_uid (
  clerk_user_id TEXT PRIMARY KEY,
  join_uid TEXT NOT NULL UNIQUE,
  source_label TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS host_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  host_user_id TEXT NOT NULL,
  host_join_uid TEXT NOT NULL,
  date_iso DATE NOT NULL,
  time_start TEXT NOT NULL,
  encrypted_payload TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- encrypted_payload：列名历史遗留；应用层当前写入明文 JSON，可自行迁移重命名或接入新加密。

CREATE INDEX IF NOT EXISTS idx_host_invitations_org ON host_invitations (org_id);
CREATE INDEX IF NOT EXISTS idx_host_invitations_host ON host_invitations (host_user_id);

CREATE TABLE IF NOT EXISTS host_invitation_invitees (
  invitation_id UUID NOT NULL REFERENCES host_invitations (id) ON DELETE CASCADE,
  invitee_user_id TEXT NOT NULL,
  join_uid TEXT NOT NULL,
  display_name TEXT NOT NULL,
  PRIMARY KEY (invitation_id, invitee_user_id)
);

CREATE INDEX IF NOT EXISTS idx_host_inv_invitee_uid
  ON host_invitation_invitees (invitation_id, lower(join_uid));
`

const sqlAddInviteeEmail = `
ALTER TABLE host_invitation_invitees
  ADD COLUMN IF NOT EXISTS invitee_email TEXT;
`

async function main() {
  const connectionString = process.env.DATABASE_URL?.trim()
  if (!connectionString) {
    console.error('缺少 DATABASE_URL')
    process.exit(1)
  }
  const pool = new pg.Pool({ connectionString })
  try {
    await pool.query(sql)
    await pool.query(sqlAddInviteeEmail)
    console.log('host-invitations 迁移完成（含 invitee_email 列）。')
  } finally {
    await pool.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
