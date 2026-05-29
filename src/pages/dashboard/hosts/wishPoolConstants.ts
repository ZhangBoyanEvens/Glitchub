import type { ReferenceCatalogGame } from './referenceGamesCatalogApi.ts'

/** API / 前端约定的「无」占位 id（不对应 reference_games 行） */
export const WISH_POOL_NONE_GAME_ID = 0

export const WISH_POOL_NONE_GAME: ReferenceCatalogGame = {
  id: WISH_POOL_NONE_GAME_ID,
  title: 'None',
  sort_order: -1,
}

export function isWishPoolNoneGame(game: { id: number } | null | undefined): boolean {
  return game != null && game.id === WISH_POOL_NONE_GAME_ID
}

export function wishPoolBoostGameIds(gameIds: number[]): number[] {
  return gameIds.filter((id) => id > 0)
}

/** 三个槽位均已选择（含「无」） */
export function isWishPoolSlotsComplete(gameIds: number[]): boolean {
  return gameIds.length === 3
}
