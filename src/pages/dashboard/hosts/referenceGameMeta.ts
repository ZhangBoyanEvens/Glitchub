/**
 * Reference game library tags (frontend-only, titles match seed).
 * Derived from game names and cover art; used for catalog display and filtering.
 */
import {
  normalizeReferenceGameTitle,
  REFERENCE_GAME_TITLE_ALIASES,
} from './referenceGameImageUrls.ts'

/** Primary keys: match title in seed-reference-catalog.mjs */
export const REFERENCE_GAME_TAGS_BY_TITLE: Record<string, readonly string[]> = {
  饥荒: ['Survival', 'Co-op', 'Sandbox'],
  星露谷: ['Simulation', 'Casual', 'Co-op'],
  泰拉瑞亚: ['Adventure', 'Survival', 'Co-op'],
  '左 4 死 2': ['Shooter', 'Co-op', 'Horror'],
  人类一败涂地: ['Party', 'Co-op', 'Puzzle'],
  恐鬼症: ['Horror', 'Co-op'],
  'PICO park': ['Party', 'Co-op', 'Puzzle'],
  '胡闹厨房 2': ['Party', 'Co-op'],
  致命公司: ['Horror', 'Co-op'],
  森林之子: ['Survival', 'Horror', 'Co-op'],
  '方舟：生存进化': ['Survival', 'Open World', 'Co-op'],
  帕鲁: ['Survival', 'Sandbox', 'Co-op'],
  raft: ['Survival', 'Co-op'],
  GTA5: ['Open World', 'Action'],
  'ready or not': ['Shooter', 'Tactical', 'Co-op'],
  僵尸世界大战: ['Shooter', 'Horror', 'Co-op'],
  'squad（战术小队）': ['Shooter', 'Tactical', 'Co-op'],
  潜渊症: ['Horror', 'Survival', 'Co-op'],
  'Among us': ['Party', 'Social', 'Puzzle'],
  骗子酒馆: ['Party', 'Card', 'Social'],
  Peak: ['Co-op', 'Adventure'],
  胖揍派对: ['Party', 'Competitive'],
  逃离后室: ['Horror', 'Co-op'],
  Repo: ['Horror', 'Co-op'],
  盗窃地精: ['Stealth', 'Co-op'],
  前方高能: ['Horror', 'Co-op'],
  'Chain tgt': ['Co-op', 'Adventure'],
  袜罪并罚: ['Adventure', 'Co-op'],
  'Keep Exploding no Talking': ['Party', 'Co-op'],
  'RV There Yet?': ['Co-op', 'Adventure'],
  Palia: ['Simulation', 'Casual', 'Life Sim'],
  'Shift at Midnight（Demo）': ['Horror', 'Co-op', 'Social'],
  'SOS OPS': ['Co-op', 'Simulation'],
  乞丐模拟器: ['Simulation'],
  'casino simulator': ['Simulation', 'Strategy'],
  '文明 6': ['Strategy'],
  Payday2: ['Shooter', 'Co-op', 'Stealth'],
  'PCL2 MC': ['Sandbox', 'Building', 'Survival'],
  腾讯斗地主: ['Card', 'Casual'],
  '恶魔轮盘（CD期）': ['Party', 'Horror', 'Card'],
  '你画我猜（CD期）': ['Party', 'Social', 'Creative'],
}

const NORMALIZED_TAG_LOOKUP: Record<string, readonly string[]> = (() => {
  const out: Record<string, readonly string[]> = {}
  for (const [title, tags] of Object.entries(REFERENCE_GAME_TAGS_BY_TITLE)) {
    out[normalizeReferenceGameTitle(title)] = tags
  }
  for (const [alias, canonical] of Object.entries(REFERENCE_GAME_TITLE_ALIASES)) {
    const tags = REFERENCE_GAME_TAGS_BY_TITLE[canonical]
    if (tags) out[normalizeReferenceGameTitle(alias)] = tags
  }
  return out
})()

/** All tags (for filter dropdown) */
export const REFERENCE_GAME_TAG_OPTIONS: readonly string[] = (() => {
  const set = new Set<string>()
  for (const tags of Object.values(REFERENCE_GAME_TAGS_BY_TITLE)) {
    for (const t of tags) set.add(t)
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'en'))
})()

export function resolveReferenceGameTags(game: {
  title?: string | null
}): readonly string[] {
  const title = game.title?.trim()
  if (!title) return []
  const direct = REFERENCE_GAME_TAGS_BY_TITLE[title]
  if (direct) return direct
  return NORMALIZED_TAG_LOOKUP[normalizeReferenceGameTitle(title)] ?? []
}

export function formatReferenceGameTags(tags: readonly string[]): string {
  return tags.length > 0 ? tags.join(' · ') : '—'
}
