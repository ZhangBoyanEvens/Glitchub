/**
 * 游戏安装容量（仅前端维护）。
 * Steam 游戏优先从 pc_requirements「存储空间」解析；失败条目见 reference-game-sizes-manual.mjs。
 * 小于 1 GB 显示为 <1GB。
 *
 * 更新: node scripts/fetch-steam-cn-sizes.mjs && node scripts/generate-reference-game-sizes-ts.mjs
 * 快照: scripts/steam-cn-sizes.snapshot.json
 * 抓取时间: 2026-05-18T09:59:10.982Z
 */
import {
  normalizeReferenceGameTitle,
  REFERENCE_GAME_TITLE_ALIASES,
} from './referenceGameImageUrls.ts'

export type ReferenceGameSize = {
  label: string
  bytes: number
  steamAppId?: number
}

export const REFERENCE_GAME_SIZE_BY_TITLE: Record<string, ReferenceGameSize> = {
  "盗窃地精": { label: "5 GB", bytes: 5000000000 },
  "恶魔轮盘（CD期）": { label: "<1GB", bytes: 500000000 },
  "方舟：生存进化": { label: "60 GB", bytes: 60000000000 },
  "胡闹厨房 2": { label: "4 GB", bytes: 4000000000 },
  "饥荒": { label: "3 GB", bytes: 3000000000 },
  "僵尸世界大战": { label: "50 GB", bytes: 50000000000 },
  "恐鬼症": { label: "21 GB", bytes: 21000000000 },
  "你画我猜（CD期）": { label: "1 GB", bytes: 1000000000, steamAppId: 1483870 },
  "帕鲁": { label: "40 GB", bytes: 40000000000 },
  "胖揍派对": { label: "10 GB", bytes: 10000000000 },
  "骗子酒馆": { label: "15 GB", bytes: 15000000000 },
  "乞丐模拟器": { label: "6.5 GB", bytes: 6500000000 },
  "前方高能": { label: "5 GB", bytes: 5000000000 },
  "潜渊症": { label: "2 GB", bytes: 2000000000 },
  "人类一败涂地": { label: "2 GB", bytes: 2000000000 },
  "森林之子": { label: "20 GB", bytes: 20000000000 },
  "泰拉瑞亚": { label: "4 GB", bytes: 4000000000 },
  "逃离后室": { label: "25 GB", bytes: 25000000000 },
  "腾讯斗地主": { label: "<1GB", bytes: 500000000 },
  "袜罪并罚": { label: "8 GB", bytes: 8000000000 },
  "文明 6": { label: "23 GB", bytes: 23000000000 },
  "星露谷": { label: "<1GB", bytes: 500000000 },
  "致命公司": { label: "4 GB", bytes: 4000000000 },
  "左 4 死 2": { label: "13 GB", bytes: 13000000000 },
  "Among us": { label: "<1GB", bytes: 250000000 },
  "casino simulator": { label: "8 GB", bytes: 8000000000 },
  "Chain tgt": { label: "8 GB", bytes: 8000000000 },
  "GTA5": { label: "95 GB", bytes: 95000000000 },
  "Keep Exploding no Talking": { label: "<1GB", bytes: 500000000 },
  "Palia": { label: "15 GB", bytes: 15000000000 },
  "Payday2": { label: "83 GB", bytes: 83000000000 },
  "PCL2 MC": { label: "<1GB", bytes: 500000000 },
  "Peak": { label: "6 GB", bytes: 6000000000 },
  "PICO park": { label: "<1GB", bytes: 500000000 },
  "raft": { label: "10 GB", bytes: 10000000000 },
  "ready or not": { label: "60 GB", bytes: 60000000000 },
  "Repo": { label: "1 GB", bytes: 1000000000 },
  "RV There Yet?": { label: "1 GB", bytes: 1000000000 },
  "Shift at Midnight（Demo）": { label: "6 GB", bytes: 6000000000 },
  "SOS OPS": { label: "2 GB", bytes: 2000000000 },
  "squad（战术小队）": { label: "65 GB", bytes: 65000000000 },
}

const NORMALIZED_SIZE_LOOKUP: Record<string, ReferenceGameSize> = (() => {
  const out: Record<string, ReferenceGameSize> = {}
  for (const [title, size] of Object.entries(REFERENCE_GAME_SIZE_BY_TITLE)) {
    out[normalizeReferenceGameTitle(title)] = size
  }
  for (const [alias, canonical] of Object.entries(REFERENCE_GAME_TITLE_ALIASES)) {
    const size = REFERENCE_GAME_SIZE_BY_TITLE[canonical]
    if (size) out[normalizeReferenceGameTitle(alias)] = size
  }
  return out
})()

export function resolveReferenceGameSize(game: {
  title?: string | null
}): ReferenceGameSize | null {
  const title = game.title?.trim()
  if (!title) return null
  const direct = REFERENCE_GAME_SIZE_BY_TITLE[title]
  if (direct) return direct
  return NORMALIZED_SIZE_LOOKUP[normalizeReferenceGameTitle(title)] ?? null
}
