import type { RoomGameSession } from './roomGameSessionApi.ts'

type Props = {
  session: RoomGameSession | null
  loadErr: string | null
  startNotice: boolean
  onDismissNotice: () => void
}

/** 开箱区：非房主开始提示与状态（开始按钮在房主名片旁） */
export function RoomGameSessionBar({
  session,
  loadErr,
  startNotice,
  onDismissNotice,
}: Props) {
  const started = session?.started ?? false
  const isHost = session?.isHost ?? false

  return (
    <div className="roomCase__session" aria-live="polite">
      {startNotice && started && !isHost ? (
        <div className="roomCase__sessionNotice" role="status">
          <p className="roomCase__sessionNoticeText">
            The host started the game. You have <strong>2</strong> vetoes on case results.
          </p>
          <button
            type="button"
            className="roomCase__sessionNoticeDismiss"
            aria-label="Dismiss notice"
            onClick={onDismissNotice}
          >
            ×
          </button>
        </div>
      ) : null}

      {!isHost && !started ? (
        <p className="roomCase__sessionHint">Waiting for host to start</p>
      ) : null}

      {loadErr ? (
        <p className="roomCase__sessionErr" role="alert">
          {loadErr}
        </p>
      ) : null}
    </div>
  )
}
