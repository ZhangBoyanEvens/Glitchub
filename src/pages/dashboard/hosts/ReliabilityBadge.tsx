export type MemberReputation = {
  attendanceRate: number
  lateJoinRate: number
  noShowRate: number
  roomCompletionRate: number
  reliabilityScore: number
  badge: 'Reliable' | 'Average' | 'Risky'
}

type Props = {
  reputation: MemberReputation | null | undefined
}

function pct(n: number) {
  return `${Math.round(n * 100)}%`
}

export function ReliabilityBadge({ reputation }: Props) {
  if (!reputation) return null

  const title = [
    `Attendance: ${pct(reputation.attendanceRate)}`,
    `No-show: ${pct(reputation.noShowRate)}`,
    `Late join: ${pct(reputation.lateJoinRate)}`,
    `Completion: ${pct(reputation.roomCompletionRate)}`,
  ].join(' · ')

  const icon = reputation.badge === 'Reliable' ? '⭐' : reputation.badge === 'Average' ? '◆' : '⚠'

  return (
    <span
      className={`dashboard__reliabilityBadge dashboard__reliabilityBadge--${reputation.badge.toLowerCase()}`}
      title={title}
    >
      {icon} {reputation.badge}
    </span>
  )
}
