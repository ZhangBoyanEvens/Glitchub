import { useState } from 'react'
import { resolveReferenceGameImageUrl } from './referenceGameImageUrls.ts'
import './gameCover.css'

type GameCoverImageProps = {
  gameId?: number | null
  title: string
  className?: string
  /** 无图或加载失败时显示的首字母 */
  fallbackLetter?: string
}

export function GameCoverImage({
  gameId,
  title,
  className,
  fallbackLetter,
}: GameCoverImageProps) {
  const src = resolveReferenceGameImageUrl({ id: gameId, title })
  const [failed, setFailed] = useState(false)
  const showImg = Boolean(src) && !failed
  const letter = (fallbackLetter ?? (title.trim().slice(0, 1) || '?')).toUpperCase()

  return (
    <div className={`gameCover${className ? ` ${className}` : ''}`}>
      {showImg ? (
        <img
          className="gameCover__img"
          src={src!}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="gameCover__ph" aria-hidden>
          {letter}
        </span>
      )}
    </div>
  )
}
