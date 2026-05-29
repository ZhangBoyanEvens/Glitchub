import { GameCoverImage } from './GameCoverImage.tsx'
import { resolveReferenceGameSteamStoreUrl } from './referenceGameSteam.ts'
import './roomGameFinalReveal.css'

export type FinalGamePick = {
  title: string
  id: number | null
}

type Props = {
  game: FinalGamePick
  onContinue: () => void
}

export function RoomGameFinalReveal({ game, onContinue }: Props) {
  const steamUrl = resolveReferenceGameSteamStoreUrl({ title: game.title })

  return (
    <div className="roomFinal" role="dialog" aria-modal="true" aria-labelledby="roomFinalTitle">
      <div className="roomFinal__rays" aria-hidden />
      <div className="roomFinal__glow" aria-hidden />
      <div className="roomFinal__card">
        <p className="roomFinal__eyebrow">Everyone approved</p>
        <h2 id="roomFinalTitle" className="roomFinal__title">
          {game.title}
        </h2>
        <div className="roomFinal__cover">
          <GameCoverImage
            gameId={game.id ?? undefined}
            title={game.title}
            className="gameCover--card"
          />
        </div>
        {steamUrl ? (
          <a
            className="roomFinal__steam"
            href={steamUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            View on Steam
          </a>
        ) : (
          <p className="roomFinal__steamMuted">No Steam store link</p>
        )}
        <button type="button" className="roomFinal__continue" onClick={onContinue}>
          Back to room
        </button>
      </div>
    </div>
  )
}
