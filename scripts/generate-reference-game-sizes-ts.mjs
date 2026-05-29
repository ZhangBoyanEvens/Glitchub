import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const snap = JSON.parse(
  fs.readFileSync(path.join(root, 'scripts', 'steam-cn-sizes.snapshot.json'), 'utf8'),
)

const lines = Object.entries(snap.sizes)
  .sort((a, b) => a[0].localeCompare(b[0], 'zh-Hans-CN'))
  .map(([title, s]) => {
    const app = s.appId != null ? `, steamAppId: ${s.appId}` : ''
    return `  ${JSON.stringify(title)}: { label: ${JSON.stringify(s.label)}, bytes: ${s.bytes}${app} },`
  })
  .join('\n')

const content = `/**
 * 游戏安装容量（仅前端维护）。
 * Steam 游戏优先从 pc_requirements「存储空间」解析；失败条目见 reference-game-sizes-manual.mjs。
 * 小于 1 GB 显示为 <1GB。
 *
 * 更新: node scripts/fetch-steam-cn-sizes.mjs && node scripts/generate-reference-game-sizes-ts.mjs
 * 快照: scripts/steam-cn-sizes.snapshot.json
 * 抓取时间: ${snap.fetchedAt}
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
${lines}
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
`

fs.writeFileSync(
  path.join(root, 'src', 'pages', 'dashboard', 'hosts', 'referenceGameSizes.ts'),
  content,
)
console.log(`Wrote ${Object.keys(snap.sizes).length} sizes`)
