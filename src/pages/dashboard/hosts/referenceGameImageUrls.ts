/**
 * 参考游戏库封面图（仅前端维护）。
 * 后端传入 id / title 时通过 resolveReferenceGameImageUrl 匹配。
 * 链接多为 Steam 商店头图，可自行替换为任意 HTTPS 图片地址。
 */

/** 规范化标题作匹配键 */
export function normalizeReferenceGameTitle(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
}

/** 主键：与 seed-reference-catalog.mjs 中 title 一致 */
export const REFERENCE_GAME_IMAGE_BY_TITLE: Record<string, string> = {
  饥荒: 'https://cdn.cloudflare.steamstatic.com/steam/apps/322330/header.jpg',
  星露谷: 'https://cdn.cloudflare.steamstatic.com/steam/apps/413150/header.jpg',
  泰拉瑞亚: 'https://cdn.cloudflare.steamstatic.com/steam/apps/105600/header.jpg',
  '左 4 死 2': 'https://cdn.cloudflare.steamstatic.com/steam/apps/550/header.jpg',
  人类一败涂地: 'https://cdn.cloudflare.steamstatic.com/steam/apps/477160/header.jpg',
  恐鬼症: 'https://cdn.cloudflare.steamstatic.com/steam/apps/739630/header.jpg',
  'PICO park': 'https://cdn.cloudflare.steamstatic.com/steam/apps/1509960/header.jpg',
  '胡闹厨房 2': 'https://cdn.cloudflare.steamstatic.com/steam/apps/728880/header.jpg',
  致命公司: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1966720/header.jpg',
  森林之子: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1326470/header.jpg',
  '方舟：生存进化': 'https://cdn.cloudflare.steamstatic.com/steam/apps/346110/header.jpg',
  帕鲁: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1623730/header.jpg',
  raft: 'https://cdn.cloudflare.steamstatic.com/steam/apps/648800/header.jpg',
  GTA5: 'https://cdn.cloudflare.steamstatic.com/steam/apps/271590/header.jpg',
  'ready or not': 'https://cdn.cloudflare.steamstatic.com/steam/apps/1144200/header.jpg',
  僵尸世界大战: 'https://cdn.cloudflare.steamstatic.com/steam/apps/699130/header.jpg',
  'squad（战术小队）': 'https://cdn.cloudflare.steamstatic.com/steam/apps/393380/header.jpg',
  潜渊症: 'https://cdn.cloudflare.steamstatic.com/steam/apps/602960/header.jpg',
  'Among us': 'https://cdn.cloudflare.steamstatic.com/steam/apps/945360/header.jpg',
  骗子酒馆: 'https://cdn.cloudflare.steamstatic.com/steam/apps/3097560/header.jpg',
  Peak: '/images/games/peak.jpg',
  胖揍派对: '/images/games/pang-zou-party.jpg',
  逃离后室: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1943950/header.jpg',
  前方高能: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1244090/header.jpg',
  'Chain tgt': 'https://cdn.cloudflare.steamstatic.com/steam/apps/2567870/header.jpg',
  'Keep Exploding no Talking': '/images/games/keep-exploding-no-talking.jpg',
  'RV There Yet?': '/images/games/rv-there-yet.jpg',
  Repo: 'https://cdn.cloudflare.steamstatic.com/steam/apps/3241660/header.jpg',
  盗窃地精: 'https://img1.wywyx.com/uploads/allimg/260417/86U26041G615260UL.jpg',
  Palia: '/images/games/palia.jpg',
  袜罪并罚: '/images/games/wazui-bingfa.jpg',
  'Shift at Midnight（Demo）': '/images/games/shift-at-midnight.jpg',
  'SOS OPS': '/images/games/sos-ops.jpg',
  乞丐模拟器: '/images/games/qi-gai-moni-qi.jpg',
  'casino simulator': '/images/games/casino-simulator.jpg',
  '文明 6': 'https://cdn.cloudflare.steamstatic.com/steam/apps/289070/header.jpg',
  Payday2: 'https://cdn.cloudflare.steamstatic.com/steam/apps/218620/header.jpg',
  'PCL2 MC': '/images/games/pcl2-mc.jpg',
  腾讯斗地主: '/images/games/tencent-doudizhu.jpg',
  '恶魔轮盘（CD期）': 'https://cdn.cloudflare.steamstatic.com/steam/apps/2835570/header.jpg',
  '你画我猜（CD期）': 'https://cdn.cloudflare.steamstatic.com/steam/apps/1483870/header.jpg',
}

/** 标题别名 → 主键（便于后端标题略有差异时仍能匹配） */
export const REFERENCE_GAME_TITLE_ALIASES: Record<string, string> = {
  'pico park': 'PICO park',
  'picopark': 'PICO park',
  'left 4 dead 2': '左 4 死 2',
  'human fall flat': '人类一败涂地',
  phasmophobia: '恐鬼症',
  'overcooked! 2': '胡闹厨房 2',
  'overcooked 2': '胡闹厨房 2',
  'lethal company': '致命公司',
  'sons of the forest': '森林之子',
  'ark: survival evolved': '方舟：生存进化',
  palworld: '帕鲁',
  'grand theft auto v': 'GTA5',
  'gta v': 'GTA5',
  'world war z': '僵尸世界大战',
  squad: 'squad（战术小队）',
  barotrauma: '潜渊症',
  'among us': 'Among us',
  "liar's bar": '骗子酒馆',
  'escape the backrooms': '逃离后室',
  'r.e.p.o.': 'Repo',
  "burglin' gnomes": '盗窃地精',
  'burglin gnomes': '盗窃地精',
  'civilization vi': '文明 6',
  'payday 2': 'Payday2',
  'buckshot roulette': '恶魔轮盘（CD期）',
  'gartic phone': '你画我猜（CD期）',
  peak: 'Peak',
  'pummel party': '胖揍派对',
  '揍击派对': '胖揍派对',
  '乱揍派对': '胖揍派对',
  'content warning': '前方高能',
  'chained together': 'Chain tgt',
  'rv there yet': 'RV There Yet?',
  'keep exploding and no talking': 'Keep Exploding no Talking',
  'shift at midnight': 'Shift at Midnight（Demo）',
  'shift at midnight (demo)': 'Shift at Midnight（Demo）',
  'rv there yet？': 'RV There Yet?',
  'socks the lost': '袜罪并罚',
  minecraft: 'PCL2 MC',
  'pcl2': 'PCL2 MC',
  'tencent doudizhu': '腾讯斗地主',
  '斗地主': '腾讯斗地主',
}

const NORMALIZED_LOOKUP: Record<string, string> = (() => {
  const out: Record<string, string> = {}
  for (const [title, url] of Object.entries(REFERENCE_GAME_IMAGE_BY_TITLE)) {
    out[normalizeReferenceGameTitle(title)] = url
  }
  for (const [alias, canonical] of Object.entries(REFERENCE_GAME_TITLE_ALIASES)) {
    const url = REFERENCE_GAME_IMAGE_BY_TITLE[canonical]
    if (url) out[normalizeReferenceGameTitle(alias)] = url
  }
  return out
})()

/** 按数据库 id 覆盖（若重新 seed 后 id 稳定，可在此补充） */
export const REFERENCE_GAME_IMAGE_BY_ID: Record<number, string> = {}

export function resolveReferenceGameImageUrl(game: {
  id?: number | null
  title?: string | null
}): string | null {
  if (game.id != null && game.id > 0) {
    const byId = REFERENCE_GAME_IMAGE_BY_ID[game.id]
    if (byId) return byId
  }
  const title = game.title?.trim()
  if (!title) return null
  const direct = REFERENCE_GAME_IMAGE_BY_TITLE[title]
  if (direct) return direct
  const norm = normalizeReferenceGameTitle(title)
  return NORMALIZED_LOOKUP[norm] ?? null
}
