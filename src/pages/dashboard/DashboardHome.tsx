import { CreateOrganization, OrganizationSwitcher, useAuth, useOrganization } from '@clerk/clerk-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  fetchHomepageDashboard,
  type GameProfile,
  type HomepageDashboard,
  type OrgLeaderboard,
} from './homepageApi.ts'
import { ReliabilityBadge } from './hosts/ReliabilityBadge.tsx'
import './dashboardHome.css'

function pct(n: number) {
  return `${Math.round(n * 100)}%`
}

function barMax(items: { value: number }[]) {
  let max = 0
  for (const item of items) {
    if (item.value > max) max = item.value
  }
  return max || 1
}

function BarList({
  items,
  valueKey,
  variant = 'default',
}: {
  items: { gameTitle: string; [key: string]: string | number }[]
  valueKey: string
  variant?: 'default' | 'warn' | 'wish'
}) {
  const normalized = items.map((item) => ({
    gameTitle: item.gameTitle,
    value: Number(item[valueKey]) || 0,
  }))
  const max = barMax(normalized)
  if (!items.length) {
    return <p className="homeDashboard__empty">No data yet — play a few rooms to see trends.</p>
  }
  return (
    <div className="homeDashboard__barList">
      {normalized.map((item) => {
        const width = Math.max(4, Math.round((item.value / max) * 100))
        return (
          <div key={item.gameTitle}>
            <div className="homeDashboard__barLabel">{item.gameTitle}</div>
            <div className="homeDashboard__barRow">
              <div className="homeDashboard__barTrack">
                <div
                  className={`homeDashboard__barFill${variant === 'warn' ? ' homeDashboard__barFill--warn' : ''}${variant === 'wish' ? ' homeDashboard__barFill--wish' : ''}`}
                  style={{ width: `${width}%` }}
                />
              </div>
              <span className="homeDashboard__barValue">{item.value}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

type LeaderboardTab = 'mostPlayed' | 'mostVetoed' | 'highestWinRate' | 'mostRequested'

function LeaderboardPanel({ leaderboard }: { leaderboard: OrgLeaderboard }) {
  const [tab, setTab] = useState<LeaderboardTab>('mostPlayed')

  const rows = useMemo(() => {
    switch (tab) {
      case 'mostPlayed':
        return leaderboard.mostPlayed.map((r) => ({
          gameTitle: r.gameTitle,
          metric: String(r.count),
          sub: 'sessions',
        }))
      case 'mostVetoed':
        return leaderboard.mostVetoed.map((r) => ({
          gameTitle: r.gameTitle,
          metric: String(r.vetoCount),
          sub: 'vetoes',
        }))
      case 'highestWinRate':
        return leaderboard.highestWinRate.map((r) => ({
          gameTitle: r.gameTitle,
          metric: pct(r.winRate),
          sub: `${r.wins}/${r.totalAppearances} finalized`,
        }))
      case 'mostRequested':
        return leaderboard.mostRequested.map((r) => ({
          gameTitle: r.gameTitle,
          metric: String(r.count),
          sub: 'wish picks',
        }))
      default:
        return []
    }
  }, [leaderboard, tab])

  const tabs: { id: LeaderboardTab; label: string }[] = [
    { id: 'mostPlayed', label: 'Most Played' },
    { id: 'mostVetoed', label: 'Most Vetoed' },
    { id: 'highestWinRate', label: 'Win Rate' },
    { id: 'mostRequested', label: 'Wish Pool' },
  ]

  return (
    <>
      <div className="homeDashboard__tabs" role="tablist" aria-label="Leaderboard type">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`homeDashboard__tab${tab === t.id ? ' is-active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <p className="homeDashboard__empty">No org activity recorded yet.</p>
      ) : (
        <table className="homeDashboard__table">
          <thead>
            <tr>
              <th>#</th>
              <th>Game</th>
              <th>Stat</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={`${row.gameTitle}-${i}`}>
                <td>{i + 1}</td>
                <td>{row.gameTitle}</td>
                <td>{row.metric}</td>
                <td>{row.sub}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}

function PreferenceCharts({ profile }: { profile: GameProfile }) {
  return (
    <div className="homeDashboard__grid" style={{ gap: '16px' }}>
      <div className="homeDashboard__card homeDashboard__span4">
        <h3 className="homeDashboard__cardTitle">Top favorites</h3>
        <BarList items={profile.favoriteGames} valueKey="count" />
      </div>
      <div className="homeDashboard__card homeDashboard__span4">
        <h3 className="homeDashboard__cardTitle">Most vetoed (by you)</h3>
        <BarList items={profile.dislikedGames} valueKey="vetoCount" variant="warn" />
      </div>
      <div className="homeDashboard__card homeDashboard__span4">
        <h3 className="homeDashboard__cardTitle">Wish pool influence</h3>
        <BarList items={profile.wishBoostedGames} valueKey="frequency" variant="wish" />
      </div>
    </div>
  )
}

function phaseClass(phase: string) {
  if (phase === 'FINALIZED') return 'homeDashboard__phase homeDashboard__phase--finalized'
  if (phase === 'CLOSED') return 'homeDashboard__phase homeDashboard__phase--closed'
  return 'homeDashboard__phase homeDashboard__phase--other'
}

function DashboardHomeInner() {
  const { getToken } = useAuth()
  const { organization, isLoaded } = useOrganization()
  const [data, setData] = useState<HomepageDashboard | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!organization?.id) {
      setData(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const dashboard = await fetchHomepageDashboard(organization.id, { getToken })
      setData(dashboard)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [organization?.id, getToken])

  useEffect(() => {
    if (!isLoaded) return
    void load()
  }, [isLoaded, load])

  if (!isLoaded) {
    return <p className="homeDashboard__loading">Loading organization…</p>
  }

  if (!organization) {
    return (
      <section className="dashboard__panel homeDashboard">
        <h1 className="dashboard__panelTitle">Homepage</h1>
        <p className="dashboard__panelLead">
          Select or create an organization to see your activity dashboard.
        </p>
        <div className="homeDashboard__orgSwitch" style={{ marginTop: 20 }}>
          <CreateOrganization afterCreateOrganizationUrl="/dashboard/home" />
        </div>
      </section>
    )
  }

  const stats = data?.personalStats

  return (
    <section className="dashboard__panel homeDashboard">
      <header className="homeDashboard__header">
        <div className="homeDashboard__headerText">
          <h1 className="dashboard__panelTitle">Homepage</h1>
          <p className="dashboard__panelLead">
            Your game-night stats for <strong>{organization.name}</strong>.
          </p>
        </div>
        <div className="homeDashboard__orgSwitch">
          <OrganizationSwitcher
            afterCreateOrganizationUrl="/dashboard/home"
            afterSelectOrganizationUrl="/dashboard/home"
            hidePersonal
          />
        </div>
      </header>

      {error ? <p className="homeDashboard__error">{error}</p> : null}
      {loading && !data ? <p className="homeDashboard__loading">Loading dashboard…</p> : null}

      {stats ? (
        <>
          <div className="homeDashboard__credit">
            <span className="homeDashboard__creditScore">{stats.reliabilityScore}</span>
            <div>
              <ReliabilityBadge
                reputation={{
                  attendanceRate: stats.attendanceRate,
                  lateJoinRate: 0,
                  noShowRate: stats.noShowOfflineRate,
                  roomCompletionRate: stats.roomCompletionRate,
                  reliabilityScore: stats.reliabilityScore,
                  badge: stats.reliabilityBadge,
                }}
              />
              <p className="homeDashboard__creditMeta">
                Reliability score · attendance {pct(stats.attendanceRate)} · completion{' '}
                {pct(stats.roomCompletionRate)}
              </p>
            </div>
          </div>

          <div className="homeDashboard__grid">
            <div className="homeDashboard__card homeDashboard__span12">
              <h2 className="homeDashboard__cardTitle">Personal activity</h2>
              <div className="homeDashboard__statGrid">
                <div className="homeDashboard__stat">
                  <span className="homeDashboard__statValue">{stats.totalRoomsJoined}</span>
                  <span className="homeDashboard__statLabel">Rooms joined</span>
                </div>
                <div className="homeDashboard__stat">
                  <span className="homeDashboard__statValue">{stats.completedRooms}</span>
                  <span className="homeDashboard__statLabel">FINALIZED</span>
                </div>
                <div className="homeDashboard__stat">
                  <span className="homeDashboard__statValue">{stats.vetoUsedCount}</span>
                  <span className="homeDashboard__statLabel">Vetoes used</span>
                </div>
                <div className="homeDashboard__stat">
                  <span className="homeDashboard__statValue">{stats.vetoReceivedCount}</span>
                  <span className="homeDashboard__statLabel">Veto respins in your rooms</span>
                </div>
                <div className="homeDashboard__stat">
                  <span className="homeDashboard__statValue">{pct(stats.readyRate)}</span>
                  <span className="homeDashboard__statLabel">Ready rate</span>
                </div>
                <div className="homeDashboard__stat">
                  <span className="homeDashboard__statValue">{pct(stats.noShowOfflineRate)}</span>
                  <span className="homeDashboard__statLabel">No-show / offline</span>
                </div>
              </div>
            </div>
          </div>

          {data?.gameProfile ? <PreferenceCharts profile={data.gameProfile} /> : null}

          <div className="homeDashboard__grid">
            <div className="homeDashboard__card homeDashboard__span8">
              <h2 className="homeDashboard__cardTitle">Organization leaderboard</h2>
              {data?.orgLeaderboard ? <LeaderboardPanel leaderboard={data.orgLeaderboard} /> : null}
            </div>

            <div className="homeDashboard__card homeDashboard__span4">
              <h2 className="homeDashboard__cardTitle">Tonight&apos;s picks</h2>
              {data?.recommendations?.length ? (
                <div className="homeDashboard__recList">
                  {data.recommendations.map((game) => (
                    <div key={game.gameTitle} className="homeDashboard__recItem">
                      <span className="homeDashboard__recTitle">{game.gameTitle}</span>
                      <span className="homeDashboard__recScore">score {game.score}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="homeDashboard__empty">
                  Add games to your org library and play a few sessions for suggestions.
                </p>
              )}
            </div>

            <div className="homeDashboard__card homeDashboard__span12">
              <h2 className="homeDashboard__cardTitle">Recent rooms</h2>
              {data?.recentRooms?.length ? (
                <div className="homeDashboard__feed">
                  {data.recentRooms.map((room) => (
                    <div key={`${room.roomId}-${room.updatedAt}`} className="homeDashboard__feedItem">
                      <div>
                        <div className="homeDashboard__feedRoom">
                          <Link to={`/dashboard/hosts/room/${encodeURIComponent(room.roomId)}`}>
                            {room.roomId}
                          </Link>
                        </div>
                        <p className="homeDashboard__feedMeta">
                          {room.playerCount} players
                          {room.finalGameTitle ? ` · ${room.finalGameTitle}` : ''}
                          {room.hadVetoRespun ? ' · had veto respin' : ''}
                          {room.vetoPassed ? ' · veto passed' : ''}
                        </p>
                      </div>
                      <span className={phaseClass(room.roomPhase)}>{room.roomPhase}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="homeDashboard__empty">
                  No room history in this org yet.{' '}
                  <Link to="/dashboard/hosts">Book or join a session</Link>.
                </p>
              )}
            </div>
          </div>
        </>
      ) : null}
    </section>
  )
}

export function DashboardHome() {
  const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY
  if (!publishableKey) {
    return (
      <section className="dashboard__panel">
        <h1 className="dashboard__panelTitle">Homepage</h1>
        <p className="dashboard__missing">
          Set <code>VITE_CLERK_PUBLISHABLE_KEY</code> in <code>.env</code>.
        </p>
      </section>
    )
  }
  return <DashboardHomeInner />
}
