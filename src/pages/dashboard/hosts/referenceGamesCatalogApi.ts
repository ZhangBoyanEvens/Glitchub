export type ReferenceCatalogGame = {
  id: number
  title: string
  sort_order: number
  /** 理论中奖概率（档权重归一化后 / 档内游戏数） */
  approx_pick_probability?: number
}

export type ReferenceCatalogCategory = {
  id: number
  tier_rank: number
  tier_pick_weight: number
  label_zh?: string
  display_name_zh?: string
  tier_normalized_probability?: number
  games: ReferenceCatalogGame[]
}

type CatalogPayload = {
  ok?: boolean
  message?: string
  categories?: (ReferenceCatalogCategory & {
    label_zh?: string
    display_name_zh?: string
    tier_normalized_probability?: number
    games?: (ReferenceCatalogGame & { approx_pick_probability?: number })[]
  })[]
}

/** 带档位权重的完整目录（用于开箱概率等） */
export async function fetchReferenceGamesCatalogDetailed(): Promise<
  ReferenceCatalogCategory[]
> {
  const res = await fetch('/api/catalog/reference-games')
  const data = (await res.json()) as CatalogPayload
  if (!res.ok) {
    throw new Error(
      data.message ??
        (res.status === 503
          ? 'Database is not configured; cannot load game pool.'
          : `Failed to load (${res.status})`),
    )
  }
  if (!data.ok || !data.categories?.length) {
    throw new Error(data.message ?? 'Invalid game pool data')
  }
  return data.categories.map((c) => ({
    id: c.id,
    tier_rank: c.tier_rank,
    tier_pick_weight: Number(c.tier_pick_weight),
    label_zh: c.label_zh,
    display_name_zh: c.display_name_zh,
    tier_normalized_probability: Number(c.tier_normalized_probability),
    games: (c.games ?? []).map((g) => ({
      id: g.id,
      title: g.title,
      sort_order: g.sort_order,
      approx_pick_probability: Number(g.approx_pick_probability),
    })),
  }))
}

type CatalogPayloadFlat = {
  ok?: boolean
  message?: string
  categories?: {
    id: number
    games: ReferenceCatalogGame[]
  }[]
}

/** 拉取 Neon `reference_games` 目录并摊平为列表（按标题排序） */
export async function fetchReferenceGamesFlat(): Promise<ReferenceCatalogGame[]> {
  const res = await fetch('/api/catalog/reference-games')
  const data = (await res.json()) as CatalogPayloadFlat
  if (!res.ok) {
    throw new Error(
      data.message ??
        (res.status === 503
          ? 'Database is not configured; cannot load game pool.'
          : `Failed to load (${res.status})`),
    )
  }
  if (!data.ok || !data.categories?.length) {
    throw new Error(data.message ?? 'Invalid game pool data')
  }
  const flat: ReferenceCatalogGame[] = []
  for (const c of data.categories) {
    for (const g of c.games ?? []) {
      flat.push(g)
    }
  }
  flat.sort((a, b) => a.title.localeCompare(b.title, 'en'))
  return flat
}
