/**
 * Steam 国区商店标价（仅前端维护）。
 * 数据来自 store.steampowered.com API（cc=cn）的 price_overview.final_formatted；
 * 无标价条目不写入（非 Steam / 未在国区发售 / 免费 / 拉取失败等）。
 *
 * 更新: node scripts/fetch-steam-cn-prices.mjs && node scripts/generate-reference-game-prices-ts.mjs
 * 快照: scripts/steam-cn-prices.snapshot.json
 * 抓取时间: 2026-05-18T09:40:14.124Z
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
  "恶魔轮盘（CD期）": { label: "¥ 12.00", cents: 1200, steamAppId: 2835570 },
  "方舟：生存进化": { label: "¥ 58.00", cents: 5800, steamAppId: 346110 },
  "胡闹厨房 2": { label: "¥ 98.00", cents: 9800, steamAppId: 728880 },
  "僵尸世界大战": { label: "¥ 32.25", cents: 3225, steamAppId: 699130 },
  "恐鬼症": { label: "¥ 47.60", cents: 4760, steamAppId: 739630 },
  "你画我猜（CD期）": { label: "¥ 25.00", cents: 2500, steamAppId: 1483870 },
  "帕鲁": { label: "¥ 108.00", cents: 10800, steamAppId: 1623730 },
  "胖揍派对": { label: "¥ 79.99", cents: 7999, steamAppId: 509980 },
  "骗子酒馆": { label: "¥ 29.00", cents: 2900, steamAppId: 3097560 },
  "前方高能": { label: "¥ 165.00", cents: 16500, steamAppId: 1244090 },
  "潜渊症": { label: "¥ 130.00", cents: 13000, steamAppId: 602960 },
  "人类一败涂地": { label: "¥ 17.40", cents: 1740, steamAppId: 477160 },
  "森林之子": { label: "¥ 108.00", cents: 10800, steamAppId: 1326470 },
  "泰拉瑞亚": { label: "¥ 42.00", cents: 4200, steamAppId: 105600 },
  "逃离后室": { label: "¥ 37.00", cents: 3700, steamAppId: 1943950 },
  "文明 6": { label: "¥ 220.00", cents: 22000, steamAppId: 289070 },
  "致命公司": { label: "¥ 42.00", cents: 4200, steamAppId: 1966720 },
  "左 4 死 2": { label: "¥ 42.00", cents: 4200, steamAppId: 550 },
  "Among us": { label: "¥ 25.00", cents: 2500, steamAppId: 945360 },
  "casino simulator": { label: "¥ 50.00", cents: 5000, steamAppId: 270130 },
  "Chain tgt": { label: "¥ 22.00", cents: 2200, steamAppId: 2567870 },
  "Keep Exploding no Talking": { label: "¥ 42.00", cents: 4200, steamAppId: 2797340 },
  "Payday2": { label: "¥ 17.50", cents: 1750, steamAppId: 218620 },
  "Peak": { label: "¥ 20.46", cents: 2046, steamAppId: 3527290 },
  "PICO park": { label: "¥ 22.00", cents: 2200, steamAppId: 1509960 },
  "raft": { label: "¥ 77.00", cents: 7700, steamAppId: 648800 },
  "ready or not": { label: "¥ 159.00", cents: 15900, steamAppId: 1144200 },
  "Repo": { label: "¥ 35.00", cents: 3500, steamAppId: 3241660 },
  "RV There Yet?": { label: "¥ 40.00", cents: 4000, steamAppId: 2644470 },
  "Shift at Midnight（Demo）": { label: "¥ 56.00", cents: 5600, steamAppId: 2825530 },
  "SOS OPS": { label: "¥ 34.99", cents: 3499, steamAppId: 2475460 },
  "squad（战术小队）": { label: "¥ 170.00", cents: 17000, steamAppId: 393380 },
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
