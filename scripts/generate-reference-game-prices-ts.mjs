import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const snap = JSON.parse(
  fs.readFileSync(path.join(root, 'scripts', 'steam-cn-prices.snapshot.json'), 'utf8'),
)

const lines = Object.entries(snap.prices)
  .sort((a, b) => a[0].localeCompare(b[0], 'zh-Hans-CN'))
  .map(
    ([title, p]) =>
      `  ${JSON.stringify(title)}: { label: ${JSON.stringify(p.label)}, cents: ${p.cents}, steamAppId: ${p.appId} },`,
  )
  .join('\n')

const content = `/**
 * Steam 国区商店标价（仅前端维护）。
 * 数据来自 store.steampowered.com API（cc=cn）的 price_overview.final_formatted；
 * 无标价条目不写入（非 Steam / 未在国区发售 / 免费 / 拉取失败等）。
 *
 * 更新: node scripts/fetch-steam-cn-prices.mjs && node scripts/generate-reference-game-prices-ts.mjs
 * 快照: scripts/steam-cn-prices.snapshot.json
 * 抓取时间: ${snap.fetchedAt}
 */
import {
  normalizeReferenceGameTitle,
  REFERENCE_GAME_TITLE_ALIASES,
} from './referenceGameImageUrls.ts'

export type ReferenceGamePrice = {
  /** Steam 国区当前标价（含折扣后） */
  label: string
  /** 人民币分，用于排序 */
  cents: number
  steamAppId: number
}

export const REFERENCE_GAME_PRICE_BY_TITLE: Record<string, ReferenceGamePrice> = {
${lines}
}

const NORMALIZED_PRICE_LOOKUP: Record<string, ReferenceGamePrice> = (() => {
  const out: Record<string, ReferenceGamePrice> = {}
  for (const [title, price] of Object.entries(REFERENCE_GAME_PRICE_BY_TITLE)) {
    out[normalizeReferenceGameTitle(title)] = price
  }
  for (const [alias, canonical] of Object.entries(REFERENCE_GAME_TITLE_ALIASES)) {
    const price = REFERENCE_GAME_PRICE_BY_TITLE[canonical]
    if (price) out[normalizeReferenceGameTitle(alias)] = price
  }
  return out
})()

export function resolveReferenceGamePrice(game: {
  title?: string | null
}): ReferenceGamePrice | null {
  const title = game.title?.trim()
  if (!title) return null
  const direct = REFERENCE_GAME_PRICE_BY_TITLE[title]
  if (direct) return direct
  return NORMALIZED_PRICE_LOOKUP[normalizeReferenceGameTitle(title)] ?? null
}
`

fs.writeFileSync(
  path.join(root, 'src', 'pages', 'dashboard', 'hosts', 'referenceGamePrices.ts'),
  content,
)
console.log(`Wrote ${Object.keys(snap.prices).length} prices`)
