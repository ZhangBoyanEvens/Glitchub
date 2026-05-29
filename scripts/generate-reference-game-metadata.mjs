/**
 * 合并前端封面映射 + Steam 价格/容量快照 → scripts/reference-game-metadata.json
 * 运行：node scripts/generate-reference-game-metadata.mjs
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

function parseImageMapFromTs() {
  const ts = fs.readFileSync(
    path.join(root, 'src/pages/dashboard/hosts/referenceGameImageUrls.ts'),
    'utf8',
  )
  const marker = 'REFERENCE_GAME_IMAGE_BY_TITLE'
  const start = ts.indexOf(marker)
  if (start < 0) throw new Error('REFERENCE_GAME_IMAGE_BY_TITLE not found')
  const braceStart = ts.indexOf('{', start)
  let depth = 0
  let end = braceStart
  for (let i = braceStart; i < ts.length; i++) {
    if (ts[i] === '{') depth++
    else if (ts[i] === '}') {
      depth--
      if (depth === 0) {
        end = i + 1
        break
      }
    }
  }
  const out = {}
  for (const line of ts.slice(braceStart, end).split('\n')) {
    const m = line.match(/^\s+(?:'([^']+)'|([^:]+?))\s*:\s*'([^']*)',?\s*$/)
    if (!m) continue
    const title = (m[1] ?? m[2]).trim()
    if (title) out[title] = m[3]
  }
  return out
}

function normalizeTitle(title) {
  return title
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
}

function main() {
  const images = parseImageMapFromTs()
  const prices = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'steam-cn-prices.snapshot.json'), 'utf8'),
  ).prices
  const sizes = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'steam-cn-sizes.snapshot.json'), 'utf8'),
  ).sizes

  const titles = new Set([
    ...Object.keys(images),
    ...Object.keys(prices ?? {}),
    ...Object.keys(sizes ?? {}),
  ])

  const games = {}
  for (const title of titles) {
    const imagePath = images[title] ?? null
    const price = prices?.[title]
    const size = sizes?.[title]
    const steamAppId = price?.appId ?? size?.steamAppId ?? null
    games[title] = {
      imagePath,
      steamUrl: steamAppId
        ? `https://store.steampowered.com/app/${steamAppId}/`
        : null,
      priceLabel: price?.label ?? null,
      priceCents: price?.cents ?? null,
      steamAppId,
      sizeLabel: size?.label ?? null,
      sizeBytes: size?.bytes ?? null,
    }
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    normalize: 'lower-trim-paren',
    games,
    byNormalizedTitle: Object.fromEntries(
      Object.keys(games).map((t) => [normalizeTitle(t), t]),
    ),
  }

  const outPath = path.join(__dirname, 'reference-game-metadata.json')
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8')
  console.log('Wrote', outPath, 'titles=', Object.keys(games).length)
}

main()
