/**
 * Neon: core tables for co-op session bookings.
 *
 * - appointments: one row per booking (host, time, temp room, lifecycle status).
 * - appointment_participants: invitees by email + response status.
 *
 * Run: npm run db:migrate:appointments  (requires DATABASE_URL in .env)
 */
import 'dotenv/config'
import pg from 'pg'

const sql = `
CREATE TABLE IF NOT EXISTS appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id TEXT NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  room_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_appointments_host_id ON appointments (host_id);
CREATE INDEX IF NOT EXISTS idx_appointments_scheduled_at ON appointments (scheduled_at);
CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments (status);
CREATE INDEX IF NOT EXISTS idx_appointments_room_id ON appointments (room_id);

CREATE TABLE IF NOT EXISTS appointment_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id UUID NOT NULL REFERENCES appointments (id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'invited'
    CHECK (status IN ('invited', 'accepted', 'declined')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_appointment_participant_email
  ON appointment_participants (appointment_id, lower(trim(email)));

CREATE INDEX IF NOT EXISTS idx_appt_participants_appointment_id
  ON appointment_participants (appointment_id);
CREATE INDEX IF NOT EXISTS idx_appt_participants_email_lower
  ON appointment_participants (lower(trim(email)));

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS host_invitation_id UUID UNIQUE
  REFERENCES host_invitations (id) ON DELETE CASCADE;
`

const sql2 = `
CREATE INDEX IF NOT EXISTS idx_appointments_host_invitation_id
  ON appointments (host_invitation_id)
  WHERE host_invitation_id IS NOT NULL;
`

const sql3 = `
ALTER TABLE appointment_participants
  ADD COLUMN IF NOT EXISTS accept_token TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS decline_token TEXT UNIQUE;
`

async function main() {
  const connectionString = process.env.DATABASE_URL?.trim()
  if (!connectionString) {
    console.error('Missing DATABASE_URL')
    process.exit(1)
  }
  const pool = new pg.Pool({ connectionString })
  try {
    await pool.query(sql)
    await pool.query(sql2)
    await pool.query(sql3)
    console.log('appointments + appointment_participants migration OK.')
  } finally {
    await pool.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
