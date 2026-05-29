import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const metaPath = path.resolve(__dirname, '../../scripts/reference-game-metadata.json')

/** @type {{ games: Record<string, { imagePath?: string|null, steamUrl?: string|null, priceLabel?: string|null, sizeLabel?: string|null }>, byNormalizedTitle?: Record<string, string> } | null} */
let cache = null

function loadMeta() {
  if (cache) return cache
  if (!fs.existsSync(metaPath)) return null
  cache = JSON.parse(fs.readFileSync(metaPath, 'utf8'))
  return cache
}

export function normalizeReferenceGameTitle(title) {
  return title
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
}

/**
 * @param {string} title
 */
export function resolveReferenceMetaForTitle(title) {
  const meta = loadMeta()
  if (!meta?.games) return null

  const trimmed = title.trim()
  let row = meta.games[trimmed]
  if (!row && meta.byNormalizedTitle) {
    const canon = meta.byNormalizedTitle[normalizeReferenceGameTitle(trimmed)]
    if (canon) row = meta.games[canon]
  }
  if (!row) return null

  const origin = (
    process.env.APP_PUBLIC_ORIGIN ??
    process.env.VITE_APP_PUBLIC_ORIGIN ??
    'http://localhost:5173'
  ).replace(/\/$/, '')

  let imageUrl = row.imagePath ?? null
  if (imageUrl?.startsWith('/')) {
    imageUrl = `${origin}${imageUrl}`
  }

  return {
    imageUrl,
    steamUrl: row.steamUrl ?? null,
    priceLabel: row.priceLabel ?? null,
    sizeLabel: row.sizeLabel ?? null,
  }
}
