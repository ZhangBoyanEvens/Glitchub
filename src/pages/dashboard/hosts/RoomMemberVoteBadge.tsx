import type { RoomGameVoteValue } from './roomGameVotesApi.ts'

type Props = {
  vote: RoomGameVoteValue | null | undefined
}

/** 成员名片右侧：本场开箱结果的赞成 / 否决 */
export function RoomMemberVoteBadge({ vote }: Props) {
  if (!vote) {
    return <span className="dashboard__hostsLiveRoomMemberVote dashboard__hostsLiveRoomMemberVote--empty" />
  }

  if (vote === 'approve') {
    return (
      <span
        className="dashboard__hostsLiveRoomMemberVote dashboard__hostsLiveRoomMemberVote--approve"
        title="Approve"
      >
        <span className="dashboard__hostsLiveRoomMemberVoteIcon" aria-hidden>
          ✓
        </span>
        <span className="dashboard__hostsLiveRoomMemberVoteLabel">Approve</span>
      </span>
    )
  }

  return (
    <span
      className="dashboard__hostsLiveRoomMemberVote dashboard__hostsLiveRoomMemberVote--reject"
      title="Veto"
    >
      <span className="dashboard__hostsLiveRoomMemberVoteIcon" aria-hidden>
        ✕
      </span>
      <span className="dashboard__hostsLiveRoomMemberVoteLabel">Veto</span>
    </span>
  )
}
