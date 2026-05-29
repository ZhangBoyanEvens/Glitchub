import { getReputationForUsers } from '../reputation/reputationService.js'

/** @typedef {{ gameTitle: string, count: number }} GameCount */
/** @typedef {{ gameTitle: string, vetoCount: number }} GameVetoCount */
/** @typedef {{ gameTitle: string, frequency: number }} GameFrequency */
/** @typedef {{ gameTitle: string, totalAppearances: number, wins: number, winRate: number }} GameWinRate */

const ORG_APPT_JOIN = `
  INNER JOIN host_invitations hi ON hi.id = a.host_invitation_id AND hi.org_id = $1
`

const USER_PARTICIPATED = `
  (
    a.host_id = $2
    OR EXISTS (
      SELECT 1 FROM reputation_session_joins rsj
      WHERE rsj.appointment_id = a.id AND rsj.clerk_user_id = $2
    )
    OR EXISTS (
      SELECT 1 FROM room_presence rp
      WHERE rp.appointment_id = a.id AND rp.clerk_user_id = $2
    )
    OR EXISTS (
      SELECT 1 FROM room_player_ready rpr
      WHERE rpr.appointment_id = a.id AND rpr.clerk_user_id = $2
    )
  )
`

/**
 * @param {import('pg').Pool} pool
 * @param {string} orgId
 * @param {string} userId
 */
export async function loadHomepageDashboard(pool, orgId, userId) {
  const [
    personalStats,
    gameProfile,
    orgLeaderboard,
    recentRooms,
    orgGames,
  ] = await Promise.all([
    loadPersonalStats(pool, orgId, userId),
    loadGameProfile(pool, orgId, userId),
    loadOrgLeaderboard(pool, orgId),
    loadRecentRooms(pool, orgId, userId),
    loadOrgGameLibrary(pool, orgId),
  ])

  const recommendations = buildRecommendations(orgLeaderboard, orgGames)

  return {
    personalStats,
    gameProfile,
    orgLeaderboard,
    recentRooms,
    recommendations,
  }
}

/**
 * @param {import('pg').Pool} pool
 * @param {string} orgId
 * @param {string} userId
 */
async function loadPersonalStats(pool, orgId, userId) {
  const [statsQ, reputationMap] = await Promise.all([
    pool.query(
      `WITH org_appts AS (
         SELECT a.id, a.room_phase
         FROM appointments a
         ${ORG_APPT_JOIN}
         WHERE a.status <> 'cancelled'
           AND ${USER_PARTICIPATED}
       ),
       joined AS (
         SELECT COUNT(DISTINCT oa.id)::int AS n FROM org_appts oa
       ),
       completed AS (
         SELECT COUNT(DISTINCT oa.id)::int AS n
         FROM org_appts oa
         WHERE oa.room_phase = 'FINALIZED'
       ),
       veto_used AS (
         SELECT COALESCE(SUM(v.reject_count), 0)::int AS n
         FROM room_game_vetoes v
         INNER JOIN appointments a ON a.id = v.appointment_id
         ${ORG_APPT_JOIN}
         WHERE v.clerk_user_id = $2
       ),
       veto_received AS (
         SELECT COUNT(*)::int AS n
         FROM room_events e
         INNER JOIN appointments a ON a.id = e.appointment_id
         ${ORG_APPT_JOIN}
         WHERE e.event_type = 'VETO_RESULT_RESOLVED'
           AND e.payload->>'outcome' = 'respun'
           AND ${USER_PARTICIPATED}
       ),
       ready AS (
         SELECT COUNT(DISTINCT rpr.appointment_id)::int AS n
         FROM room_player_ready rpr
         INNER JOIN appointments a ON a.id = rpr.appointment_id
         ${ORG_APPT_JOIN}
         WHERE rpr.clerk_user_id = $2 AND rpr.is_ready = true
           AND ${USER_PARTICIPATED}
       ),
       org_invites AS (
         SELECT a.id
         FROM appointments a
         ${ORG_APPT_JOIN}
         INNER JOIN host_invitation_invitees hii ON hii.invitation_id = hi.id
         WHERE hii.invitee_user_id = $2
           AND a.scheduled_at < now()
           AND a.status <> 'cancelled'
       ),
       attendance AS (
         SELECT
           COUNT(*)::int AS invited,
           COUNT(*) FILTER (
             WHERE EXISTS (
               SELECT 1 FROM reputation_session_joins rsj
               WHERE rsj.appointment_id = org_invites.id AND rsj.clerk_user_id = $2
             )
             OR EXISTS (
               SELECT 1 FROM room_presence rp
               WHERE rp.appointment_id = org_invites.id AND rp.clerk_user_id = $2
             )
           )::int AS attended
         FROM org_invites
       )
       SELECT
         (SELECT n FROM joined) AS total_rooms_joined,
         (SELECT n FROM completed) AS completed_rooms,
         (SELECT n FROM veto_used) AS veto_used_count,
         (SELECT n FROM veto_received) AS veto_received_count,
         (SELECT n FROM ready) AS ready_sessions,
         (SELECT invited FROM attendance) AS invited_sessions,
         (SELECT attended FROM attendance) AS attended_sessions`,
      [orgId, userId],
    ),
    getReputationForUsers(pool, [userId]),
  ])

  const row = statsQ.rows[0] ?? {}
  const joined = Number(row.total_rooms_joined) || 0
  const readySessions = Number(row.ready_sessions) || 0
  const invited = Number(row.invited_sessions) || 0
  const attended = Number(row.attended_sessions) || 0
  const reputation = reputationMap[userId]

  const readyRate = joined > 0 ? readySessions / joined : 0
  const noShowOfflineRate =
    invited > 0 ? Math.max(0, (invited - attended) / invited) : reputation?.noShowRate ?? 0

  return {
    totalRoomsJoined: joined,
    completedRooms: Number(row.completed_rooms) || 0,
    vetoUsedCount: Number(row.veto_used_count) || 0,
    vetoReceivedCount: Number(row.veto_received_count) || 0,
    readyRate,
    noShowOfflineRate,
    reliabilityScore: reputation?.reliabilityScore ?? 100,
    reliabilityBadge: reputation?.badge ?? 'Reliable',
    attendanceRate: reputation?.attendanceRate ?? 1,
    roomCompletionRate: reputation?.roomCompletionRate ?? 1,
  }
}

/**
 * @param {import('pg').Pool} pool
 * @param {string} orgId
 * @param {string} userId
 */
async function loadGameProfile(pool, orgId, userId) {
  const [favoritesQ, dislikedQ, wishQ] = await Promise.all([
    pool.query(
      `SELECT a.final_game_title AS game_title, COUNT(*)::int AS count
       FROM appointments a
       ${ORG_APPT_JOIN}
       INNER JOIN reputation_session_joins rsj
         ON rsj.appointment_id = a.id AND rsj.clerk_user_id = $2
       WHERE a.room_phase = 'FINALIZED'
         AND a.final_game_title IS NOT NULL
         AND trim(a.final_game_title) <> ''
       GROUP BY a.final_game_title
       ORDER BY count DESC, a.final_game_title ASC
       LIMIT 5`,
      [orgId, userId],
    ),
    pool.query(
      `SELECT v.game_title, SUM(v.reject_count)::int AS veto_count
       FROM room_game_vetoes v
       INNER JOIN appointments a ON a.id = v.appointment_id
       ${ORG_APPT_JOIN}
       WHERE v.clerk_user_id = $2
         AND v.game_title IS NOT NULL
         AND trim(v.game_title) <> ''
       GROUP BY v.game_title
       ORDER BY veto_count DESC, v.game_title ASC
       LIMIT 5`,
      [orgId, userId],
    ),
    pool.query(
      `WITH wish_picks AS (
         SELECT unnest(ARRAY[w.slot1_game_id, w.slot2_game_id, w.slot3_game_id]) AS game_id
         FROM room_wish_pool w
         INNER JOIN appointments a ON a.id = w.appointment_id
         ${ORG_APPT_JOIN}
         WHERE w.updated_by = $2
       )
       SELECT rg.title AS game_title, COUNT(*)::int AS frequency
       FROM wish_picks wp
       INNER JOIN reference_games rg ON rg.id = wp.game_id
       WHERE wp.game_id IS NOT NULL AND wp.game_id > 0
       GROUP BY rg.title
       ORDER BY frequency DESC, rg.title ASC
       LIMIT 5`,
      [orgId, userId],
    ),
  ])

  return {
    favoriteGames: favoritesQ.rows.map((r) => ({
      gameTitle: r.game_title,
      count: Number(r.count) || 0,
    })),
    dislikedGames: dislikedQ.rows.map((r) => ({
      gameTitle: r.game_title,
      vetoCount: Number(r.veto_count) || 0,
    })),
    wishBoostedGames: wishQ.rows.map((r) => ({
      gameTitle: r.game_title,
      frequency: Number(r.frequency) || 0,
    })),
  }
}

/**
 * @param {import('pg').Pool} pool
 * @param {string} orgId
 */
async function loadOrgLeaderboard(pool, orgId) {
  const [mostPlayedQ, mostVetoedQ, winRateQ, wishQ] = await Promise.all([
    pool.query(
      `SELECT a.final_game_title AS game_title, COUNT(*)::int AS count
       FROM appointments a
       ${ORG_APPT_JOIN}
       WHERE a.room_phase = 'FINALIZED'
         AND a.final_game_title IS NOT NULL
         AND trim(a.final_game_title) <> ''
       GROUP BY a.final_game_title
       ORDER BY count DESC, a.final_game_title ASC
       LIMIT 10`,
      [orgId],
    ),
    pool.query(
      `SELECT v.game_title, SUM(v.reject_count)::int AS veto_count
       FROM room_game_vetoes v
       INNER JOIN appointments a ON a.id = v.appointment_id
       ${ORG_APPT_JOIN}
       WHERE v.game_title IS NOT NULL AND trim(v.game_title) <> ''
       GROUP BY v.game_title
       ORDER BY veto_count DESC, v.game_title ASC
       LIMIT 10`,
      [orgId],
    ),
    pool.query(
      `WITH spin_stats AS (
         SELECT
           rs.result_game_title AS game_title,
           COUNT(*)::int AS total_appearances,
           COUNT(*) FILTER (
             WHERE a.room_phase = 'FINALIZED'
               AND a.final_game_title = rs.result_game_title
           )::int AS wins
         FROM room_spins rs
         INNER JOIN appointments a ON a.id = rs.appointment_id
         ${ORG_APPT_JOIN}
         WHERE rs.invalidated_at IS NULL
           AND rs.result_game_title IS NOT NULL
           AND trim(rs.result_game_title) <> ''
         GROUP BY rs.result_game_title
         HAVING COUNT(*) >= 1
       )
       SELECT
         game_title,
         total_appearances,
         wins,
         CASE
           WHEN total_appearances > 0 THEN wins::float / total_appearances
           ELSE 0
         END AS win_rate
       FROM spin_stats
       ORDER BY win_rate DESC, wins DESC, game_title ASC
       LIMIT 10`,
      [orgId],
    ),
    pool.query(
      `WITH picks AS (
         SELECT unnest(ARRAY[w.slot1_game_id, w.slot2_game_id, w.slot3_game_id]) AS game_id
         FROM room_wish_pool w
         INNER JOIN appointments a ON a.id = w.appointment_id
         ${ORG_APPT_JOIN}
       )
       SELECT rg.title AS game_title, COUNT(*)::int AS count
       FROM picks p
       INNER JOIN reference_games rg ON rg.id = p.game_id
       WHERE p.game_id IS NOT NULL AND p.game_id > 0
       GROUP BY rg.title
       ORDER BY count DESC, rg.title ASC
       LIMIT 10`,
      [orgId],
    ),
  ])

  return {
    mostPlayed: mostPlayedQ.rows.map((r) => ({
      gameTitle: r.game_title,
      count: Number(r.count) || 0,
    })),
    mostVetoed: mostVetoedQ.rows.map((r) => ({
      gameTitle: r.game_title,
      vetoCount: Number(r.veto_count) || 0,
    })),
    highestWinRate: winRateQ.rows.map((r) => ({
      gameTitle: r.game_title,
      totalAppearances: Number(r.total_appearances) || 0,
      wins: Number(r.wins) || 0,
      winRate: Number(r.win_rate) || 0,
    })),
    mostRequested: wishQ.rows.map((r) => ({
      gameTitle: r.game_title,
      count: Number(r.count) || 0,
    })),
  }
}

/**
 * @param {import('pg').Pool} pool
 * @param {string} orgId
 * @param {string} userId
 */
async function loadRecentRooms(pool, orgId, userId) {
  const q = await pool.query(
    `SELECT
       a.room_id,
       a.room_phase,
       a.final_game_title,
       a.updated_at,
       a.scheduled_at,
       (
         SELECT COUNT(DISTINCT rsj.clerk_user_id)::int
         FROM reputation_session_joins rsj
         WHERE rsj.appointment_id = a.id
       ) AS player_count,
       EXISTS (
         SELECT 1 FROM room_events e
         WHERE e.appointment_id = a.id
           AND e.event_type = 'VETO_RESULT_RESOLVED'
           AND e.payload->>'outcome' = 'finalized'
       ) AS veto_passed,
       EXISTS (
         SELECT 1 FROM room_events e
         WHERE e.appointment_id = a.id
           AND e.event_type = 'VETO_RESULT_RESOLVED'
           AND e.payload->>'outcome' = 'respun'
       ) AS had_veto_respun
     FROM appointments a
     ${ORG_APPT_JOIN}
     WHERE a.status <> 'cancelled'
       AND ${USER_PARTICIPATED}
     ORDER BY COALESCE(a.updated_at, a.scheduled_at, a.created_at) DESC
     LIMIT 10`,
    [orgId, userId],
  )

  return q.rows.map((r) => ({
    roomId: r.room_id,
    roomPhase: r.room_phase,
    finalGameTitle: r.final_game_title,
    playerCount: Number(r.player_count) || 0,
    vetoPassed: Boolean(r.veto_passed),
    hadVetoRespun: Boolean(r.had_veto_respun),
    updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
    scheduledAt: r.scheduled_at ? new Date(r.scheduled_at).toISOString() : null,
  }))
}

/**
 * @param {import('pg').Pool} pool
 * @param {string} orgId
 */
async function loadOrgGameLibrary(pool, orgId) {
  const q = await pool.query(
    `SELECT id, game_name, steam_url, image_url
     FROM organization_games
     WHERE org_id = $1
     ORDER BY game_name ASC`,
    [orgId],
  )
  return q.rows.map((r) => ({
    id: r.id,
    gameName: r.game_name,
    steamUrl: r.steam_url,
    imageUrl: r.image_url,
  }))
}

/**
 * Deterministic recommendation: favor win-rate, boost wish pool, penalize vetoes.
 *
 * @param {Awaited<ReturnType<typeof loadOrgLeaderboard>>} leaderboard
 * @param {Awaited<ReturnType<typeof loadOrgGameLibrary>>} orgGames
 */
function buildRecommendations(leaderboard, orgGames) {
  /** @type {Map<string, { score: number, gameTitle: string, id?: string, steamUrl?: string | null, imageUrl?: string | null }>} */
  const scores = new Map()

  const ensure = (title) => {
    const key = title.trim().toLowerCase()
    if (!scores.has(key)) {
      const lib = orgGames.find((g) => g.gameName.trim().toLowerCase() === key)
      scores.set(key, {
        score: 0,
        gameTitle: lib?.gameName ?? title,
        id: lib?.id,
        steamUrl: lib?.steamUrl ?? null,
        imageUrl: lib?.imageUrl ?? null,
      })
    }
    return scores.get(key)
  }

  for (const row of leaderboard.highestWinRate) {
    const entry = ensure(row.gameTitle)
    entry.score += row.winRate * 10
  }

  for (const row of leaderboard.mostRequested) {
    const entry = ensure(row.gameTitle)
    entry.score += row.count * 0.5
  }

  for (const row of leaderboard.mostVetoed) {
    const entry = ensure(row.gameTitle)
    entry.score -= row.vetoCount * 1
  }

  for (const game of orgGames) {
    ensure(game.gameName)
  }

  return [...scores.values()]
    .filter((g) => g.score > 0 || orgGames.some((og) => og.gameName === g.gameTitle))
    .sort((a, b) => b.score - a.score || a.gameTitle.localeCompare(b.gameTitle))
    .slice(0, 8)
    .map((g) => ({
      id: g.id ?? null,
      gameTitle: g.gameTitle,
      score: Math.round(g.score * 100) / 100,
      steamUrl: g.steamUrl,
      imageUrl: g.imageUrl,
    }))
}
