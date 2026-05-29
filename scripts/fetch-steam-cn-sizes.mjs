/**
 * 从 Steam appdetails 的 pc_requirements 解析「可用空间/Storage」作为安装容量参考。
 * 合并 reference-game-sizes-manual.mjs 手工条目。
 *
 * 用法: node scripts/fetch-steam-cn-sizes.mjs
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { REFERENCE_STEAM_APP_IDS } from './reference-steam-app-ids.mjs'
import { MANUAL_REFERENCE_GAME_SIZES } from './reference-game-sizes-manual.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function parseBytesFromRequirements(pc) {
  if (!pc) return null
  const html = [pc.minimum, pc.recommended].filter(Boolean).join(' ')
  const items = html.split(/<li[^>]*>/i)
  let max = 0

  for (const item of items) {
    const plain = item
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;|&#\d+;/g, ' ')
      .replace(/\s+/g, ' ')
    if (
      !/存储空间|storage|available space|可用空间|硬盘空间|hard drive/i.test(plain)
    ) {
      continue
    }
    const m = plain.match(/(\d+(?:[.,]\d+)?)\s*(TB|GB|MB)\b/i)
    if (!m) continue
    const num = parseFloat(m[1].replace(',', '.'))
    const unit = m[2].toUpperCase()
    let bytes = 0
    if (unit === 'TB') bytes = num * 1e12
    else if (unit === 'GB') bytes = num * 1e9
    else bytes = num * 1e6
    if (bytes > max) max = bytes
  }
  return max > 0 ? Math.round(max) : null
}

export function formatSizeLabel(bytes) {
  if (bytes < 1_000_000_000) return '<1GB'
  const gb = bytes / 1_000_000_000
  if (gb >= 100) return `${Math.round(gb)} GB`
  const rounded = Math.round(gb * 10) / 10
  return Number.isInteger(rounded) ? `${rounded} GB` : `${rounded} GB`
}

async function fetchRequirements(appId) {
  const url = `https://store.steampowered.com/api/appdetails?appids=${appId}&cc=cn&l=schinese`
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Glitchub/1.0 (size sync)' },
    signal: AbortSignal.timeout(45000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = await res.json()
  const entry = json[String(appId)]
  if (!entry?.success) return null
  return parseBytesFromRequirements(entry.data?.pc_requirements)
}

async function main() {
  const sizes = {}
  const skipped = []
  const manualTitles = new Set(Object.keys(MANUAL_REFERENCE_GAME_SIZES))

  for (const [title, manual] of Object.entries(MANUAL_REFERENCE_GAME_SIZES)) {
    sizes[title] = {
      bytes: manual.bytes,
      label: formatSizeLabel(manual.bytes),
      source: `manual: ${manual.source}`,
    }
    console.log(`MAN ${title}: ${sizes[title].label}`)
  }

  for (const [title, appId] of Object.entries(REFERENCE_STEAM_APP_IDS)) {
    if (manualTitles.has(title)) continue
    await sleep(500)
    try {
      const bytes = await fetchRequirements(appId)
      if (bytes) {
        sizes[title] = {
          bytes,
          label: formatSizeLabel(bytes),
          appId,
          source: 'steam:pc_requirements',
        }
        console.log(`OK  ${title}: ${sizes[title].label} (app ${appId})`)
      } else {
        skipped.push({ title, appId, reason: 'no storage in pc_requirements' })
        console.warn(`SKIP ${title} (app ${appId})`)
      }
    } catch (e) {
      skipped.push({ title, appId, reason: String(e.message ?? e) })
      console.warn(`ERR  ${title}:`, e.message ?? e)
    }
  }

  const outPath = path.join(root, 'scripts', 'steam-cn-sizes.snapshot.json')
  fs.writeFileSync(
    outPath,
    JSON.stringify({ fetchedAt: new Date().toISOString(), sizes, skipped }, null, 2),
  )
  console.log(`\nWrote ${outPath} (${Object.keys(sizes).length} sizes, ${skipped.length} skipped)`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
