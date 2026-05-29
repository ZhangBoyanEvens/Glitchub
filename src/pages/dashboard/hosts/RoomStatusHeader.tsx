import type { RoomPhase } from './roomFsmPhases.ts'
import { PHASE_STATUS_HEADLINE, phaseActionGuidance } from './roomUxCopy.ts'

type Props = {
  roomPhase: RoomPhase
  headline?: string
  guidance: string
  progressLines: string[]
}

export function RoomStatusHeader({ roomPhase, headline, guidance, progressLines }: Props) {
  const title = headline ?? PHASE_STATUS_HEADLINE[roomPhase]

  return (
    <div className="dashboard__roomStatusHeader" role="status" aria-live="polite">
      <div className="dashboard__roomStatusHeaderMain">
        <span className="dashboard__roomStatusPhase">{roomPhase.replace(/_/g, ' ')}</span>
        <span className="dashboard__roomStatusHeadline">{title}</span>
      </div>
      <p className="dashboard__roomStatusGuidance">{guidance}</p>
      {progressLines.length > 0 ? (
        <ul className="dashboard__roomStatusProgress">
          {progressLines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

export { phaseActionGuidance }
