import { useEffect, useMemo, useState } from 'react'
import { GameCoverImage } from './hosts/GameCoverImage.tsx'
import {
  REFERENCE_GAME_TAG_OPTIONS,
  resolveReferenceGameTags,
} from './hosts/referenceGameMeta.ts'
import { resolveReferenceGamePrice } from './hosts/referenceGamePrices.ts'
import { resolveReferenceGameSize } from './hosts/referenceGameSizes.ts'

type CatalogGameRow = {
  id: number
  title: string
  sort_order: number
}

type CatalogCategory = {
  id: number
  tier_rank: number
  games: CatalogGameRow[]
}

type CatalogPayload = {
  ok?: boolean
  categories?: CatalogCategory[]
}

type SortMode =
  | 'name-asc'
  | 'name-desc'
  | 'price-asc'
  | 'price-desc'
  | 'size-asc'
  | 'size-desc'
type PriceFilter = 'all' | 'priced' | 'unpriced'
type SizeFilter = 'all' | 'sized' | 'unsized' | 'under-1gb'

export function DashboardGames() {
  const [rows, setRows] = useState<CatalogGameRow[]>([])
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'ok' | 'err'>(
    'idle',
  )
  const [errMsg, setErrMsg] = useState<string | null>(null)

  const [sortMode, setSortMode] = useState<SortMode>('name-asc')
  const [filterTag, setFilterTag] = useState('all')
  const [filterPrice, setFilterPrice] = useState<PriceFilter>('all')
  const [filterSize, setFilterSize] = useState<SizeFilter>('all')

  useEffect(() => {
    let cancelled = false
    setLoadState('loading')
    setErrMsg(null)
    fetch('/api/catalog/reference-games')
      .then(async (r) => {
        const data = (await r.json()) as CatalogPayload & { message?: string }
        if (!r.ok) {
          throw new Error(data.message ?? `HTTP ${r.status}`)
        }
        if (!data.ok || !data.categories) {
          throw new Error(data.message ?? 'Invalid catalog data')
        }
        const flat: CatalogGameRow[] = []
        for (const c of data.categories) {
          for (const g of c.games ?? []) {
            flat.push(g)
          }
        }
        if (!cancelled) {
          setRows(flat)
          setLoadState('ok')
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setLoadState('err')
          setErrMsg(e instanceof Error ? e.message : String(e))
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = useMemo(() => {
    return rows.filter((g) => {
      if (filterTag !== 'all' && !resolveReferenceGameTags(g).includes(filterTag)) {
        return false
      }
      const priced = resolveReferenceGamePrice(g) != null
      if (filterPrice === 'priced' && !priced) return false
      if (filterPrice === 'unpriced' && priced) return false
      const size = resolveReferenceGameSize(g)
      if (filterSize === 'sized' && !size) return false
      if (filterSize === 'unsized' && size) return false
      if (filterSize === 'under-1gb' && (!size || size.bytes >= 1_000_000_000)) {
        return false
      }
      return true
    })
  }, [rows, filterTag, filterPrice, filterSize])

  const sorted = useMemo(() => {
    const list = [...filtered]
    switch (sortMode) {
      case 'name-asc':
        list.sort((a, b) => a.title.localeCompare(b.title, 'en'))
        break
      case 'name-desc':
        list.sort((a, b) => b.title.localeCompare(a.title, 'en'))
        break
      case 'price-asc':
        list.sort((a, b) => {
          const pa = resolveReferenceGamePrice(a)?.cents
          const pb = resolveReferenceGamePrice(b)?.cents
          if (pa == null && pb == null) return a.title.localeCompare(b.title, 'en')
          if (pa == null) return 1
          if (pb == null) return -1
          return pa - pb || a.title.localeCompare(b.title, 'en')
        })
        break
      case 'price-desc':
        list.sort((a, b) => {
          const pa = resolveReferenceGamePrice(a)?.cents
          const pb = resolveReferenceGamePrice(b)?.cents
          if (pa == null && pb == null) return a.title.localeCompare(b.title, 'en')
          if (pa == null) return 1
          if (pb == null) return -1
          return pb - pa || a.title.localeCompare(b.title, 'en')
        })
        break
      case 'size-asc':
        list.sort((a, b) => {
          const sa = resolveReferenceGameSize(a)?.bytes
          const sb = resolveReferenceGameSize(b)?.bytes
          if (sa == null && sb == null) return a.title.localeCompare(b.title, 'en')
          if (sa == null) return 1
          if (sb == null) return -1
          return sa - sb || a.title.localeCompare(b.title, 'en')
        })
        break
      case 'size-desc':
        list.sort((a, b) => {
          const sa = resolveReferenceGameSize(a)?.bytes
          const sb = resolveReferenceGameSize(b)?.bytes
          if (sa == null && sb == null) return a.title.localeCompare(b.title, 'en')
          if (sa == null) return 1
          if (sb == null) return -1
          return sb - sa || a.title.localeCompare(b.title, 'en')
        })
        break
      default:
        break
    }
    return list
  }, [filtered, sortMode])

  return (
    <section className="dashboard__panel dashboard__games">
      <h1 className="dashboard__panelTitle">Reference Catalog</h1>
      <p className="dashboard__gamesHint">
        Global reference game catalog (read-only). For organization game library and proposal voting, go to{' '}
        <a href="/dashboard/games">Organization Games</a>. Prices are Steam China region list prices (— if
        unavailable); sizes come from Steam storage requirements or verified store data. Sizes under 1GB show as{' '}
        {'<1GB'}.
      </p>

      <div className="dashboard__gamesToolbar" role="region" aria-label="Sort and filter">
        <div className="dashboard__gamesToolbarRow">
          <label className="dashboard__gamesField">
            <span className="dashboard__gamesFieldLabel">Sort</span>
            <select
              className="dashboard__gamesSelect"
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as SortMode)}
            >
              <option value="name-asc">Name A → Z</option>
              <option value="name-desc">Name Z → A</option>
              <option value="price-asc">Price ascending</option>
              <option value="price-desc">Price descending</option>
              <option value="size-asc">Size ascending</option>
              <option value="size-desc">Size descending</option>
            </select>
          </label>
          <label className="dashboard__gamesField">
            <span className="dashboard__gamesFieldLabel">Filter Tag</span>
            <select
              className="dashboard__gamesSelect"
              value={filterTag}
              onChange={(e) => setFilterTag(e.target.value)}
            >
              <option value="all">All</option>
              {REFERENCE_GAME_TAG_OPTIONS.map((tag) => (
                <option key={tag} value={tag}>
                  {tag}
                </option>
              ))}
            </select>
          </label>
          <label className="dashboard__gamesField">
            <span className="dashboard__gamesFieldLabel">Filter price</span>
            <select
              className="dashboard__gamesSelect"
              value={filterPrice}
              onChange={(e) => setFilterPrice(e.target.value as PriceFilter)}
            >
              <option value="all">All</option>
              <option value="priced">Has Steam China price</option>
              <option value="unpriced">No price</option>
            </select>
          </label>
          <label className="dashboard__gamesField">
            <span className="dashboard__gamesFieldLabel">Filter size</span>
            <select
              className="dashboard__gamesSelect"
              value={filterSize}
              onChange={(e) => setFilterSize(e.target.value as SizeFilter)}
            >
              <option value="all">All</option>
              <option value="sized">Has size data</option>
              <option value="unsized">No size data</option>
              <option value="under-1gb">{'<1GB'}</option>
            </select>
          </label>
        </div>
      </div>

      {loadState === 'loading' ? (
        <p className="dashboard__gamesStatus">Loading catalog…</p>
      ) : null}
      {loadState === 'err' ? (
        <p className="dashboard__gamesError" role="alert">
          {errMsg ?? 'Load failed'} (confirm you have run{' '}
          <code>npm run db:seed:reference-catalog</code> and the backend is running)
        </p>
      ) : null}

      {loadState === 'ok' ? (
        <div className="dashboard__gamesGrid">
          {sorted.map((g) => {
            const tags = resolveReferenceGameTags(g)
            const price = resolveReferenceGamePrice(g)
            const size = resolveReferenceGameSize(g)
            return (
              <article className="dashboard__gameCard" key={g.id}>
              <GameCoverImage
                gameId={g.id}
                title={g.title}
                className="gameCover--card"
              />
              <div className="dashboard__gameBody">
                <h2 className="dashboard__gameTitle">{g.title}</h2>
                <dl className="dashboard__gameMeta">
                  <div className="dashboard__gameMetaRow">
                    <dt>Tag</dt>
                    <dd>
                      {tags.length > 0 ? (
                        <span className="dashboard__gameTagList">
                          {tags.map((tag) => (
                            <span key={tag} className="dashboard__gameTag">
                              {tag}
                            </span>
                          ))}
                        </span>
                      ) : (
                        '—'
                      )}
                    </dd>
                  </div>
                  <div className="dashboard__gameMetaRow">
                    <dt>Price</dt>
                    <dd title={price ? `Steam China app ${price.steamAppId}` : undefined}>
                      {price?.label ?? '—'}
                    </dd>
                  </div>
                  <div className="dashboard__gameMetaRow">
                    <dt>Size</dt>
                    <dd title={size?.steamAppId ? `Steam app ${size.steamAppId}` : undefined}>
                      {size?.label ?? '—'}
                    </dd>
                  </div>
                </dl>
              </div>
              </article>
            )
          })}
        </div>
      ) : null}
    </section>
  )
}
