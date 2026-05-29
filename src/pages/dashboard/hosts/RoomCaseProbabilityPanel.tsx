import { useMemo } from 'react'
import type { ReferenceCatalogCategory } from './referenceGamesCatalogApi.ts'
import { buildGameProbabilityRowsWithWishPool } from './wishPoolBoost.ts'
import { formatProbabilityPercent } from './roomCaseProbability.ts'
import {
  isWishPoolSlotsComplete,
  wishPoolBoostGameIds,
} from './wishPoolConstants.ts'
import { GameCoverImage } from './GameCoverImage.tsx'

type Props = {
  categories: ReferenceCatalogCategory[]
  wishGameIds: number[]
  loadErr: string | null
  loading: boolean
}

export function RoomCaseProbabilityPanel({
  categories,
  wishGameIds,
  loadErr,
  loading,
}: Props) {
  const rows = useMemo(
    () => buildGameProbabilityRowsWithWishPool(categories, wishGameIds),
    [categories, wishGameIds],
  )
  const wishActive =
    isWishPoolSlotsComplete(wishGameIds) && wishPoolBoostGameIds(wishGameIds).length > 0

  const byTier = useMemo(() => {
    const map = new Map<string, typeof rows>()
    for (const row of rows) {
      const list = map.get(row.tierLabel) ?? []
      list.push(row)
      map.set(row.tierLabel, list)
    }
    return [...map.entries()]
  }, [rows])

  return (
    <>
      <header className="roomCase__panelHead">
        <h4 className="roomCase__panelTitle">Odds</h4>
      </header>
      <div className="roomCase__panelBody roomCase__panelBody--prob">
        {loadErr ? (
          <p className="roomCase__panelErr" role="alert">
            {loadErr}
          </p>
        ) : loading ? (
          <p className="roomCase__panelMuted">Loading odds…</p>
        ) : rows.length === 0 ? (
          <p className="roomCase__panelMuted">No game probability data</p>
        ) : (
          <div className="roomCase__probScroll">
            <p className="roomCase__probLead">
              Between tiers by tier_pick_weight; uniform within each tier.
              {wishActive
                ? ' Wish pool saved: each slot boosts that game’s weight ×1.5 (same game can stack). Table shows normalized odds.'
                : ' Table shows theoretical win probability per game.'}
            </p>
            {byTier.map(([tierLabel, tierRows]) => (
              <section key={tierLabel} className="roomCase__probTier">
                <h5 className="roomCase__probTierTitle">{tierLabel}</h5>
                <ul className="roomCase__probList">
                  {tierRows.map((row) => (
                    <li
                      key={`${row.id}-${row.title}`}
                      className={`roomCase__probRow roomCase__probRow--t${row.tierRank}${row.wishSlotCount ? ' is-wished' : ''}`}
                    >
                      <GameCoverImage
                        gameId={row.id}
                        title={row.title}
                        className="gameCover--probRow"
                      />
                      <span className="roomCase__probName" title={row.title}>
                        {row.title}
                        {row.wishSlotCount ? (
                          <span className="roomCase__probWishTag">
                            Wish×{row.wishSlotCount}
                          </span>
                        ) : null}
                      </span>
                      <span className="roomCase__probPct">
                        {formatProbabilityPercent(row.probability)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
