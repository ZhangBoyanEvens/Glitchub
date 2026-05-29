/**
 * 从 Steam 商店 API（cc=cn）拉取国区标价，输出供 referenceGamePrices.ts 使用。
 * 仅 success 且含 price_overview 的条目会写入。
 *
 * 用法: node scripts/fetch-steam-cn-prices.mjs
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

import { REFERENCE_STEAM_APP_IDS as TITLE_TO_APP_ID } from './reference-steam-app-ids.mjs'

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function fetchPrice(appId) {
  const url = `https://store.steampowered.com/api/appdetails?appids=${appId}&cc=cn&l=schinese&filters=price_overview`
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Glitchub/1.0 (price sync)' },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = await res.json()
  const entry = json[String(appId)]
  if (!entry?.success) return null
  const p = entry.data?.price_overview
  if (!p || p.currency !== 'CNY') return null
  return {
    cents: p.final,
    formatted: p.final_formatted?.trim() || null,
    discountPercent: p.discount_percent ?? 0,
  }
}

async function main() {
  const out = {}
  const skipped = []

  for (const [title, appId] of Object.entries(TITLE_TO_APP_ID)) {
    await sleep(400)
    try {
      const price = await fetchPrice(appId)
      if (price?.formatted) {
        out[title] = {
          appId,
          cents: price.cents,
          label: price.formatted,
          discountPercent: price.discountPercent,
        }
        console.log(`OK  ${title}: ${price.formatted} (app ${appId})`)
      } else {
        skipped.push({ title, appId, reason: 'no CNY price_overview' })
        console.warn(`SKIP ${title} (app ${appId}): no price`)
      }
    } catch (e) {
      skipped.push({ title, appId, reason: String(e.message ?? e) })
      console.warn(`ERR  ${title}:`, e.message ?? e)
    }
  }

  const outPath = path.join(root, 'scripts', 'steam-cn-prices.snapshot.json')
  fs.writeFileSync(
    outPath,
    JSON.stringify({ fetchedAt: new Date().toISOString(), prices: out, skipped }, null, 2),
  )
  console.log(`\nWrote ${outPath} (${Object.keys(out).length} prices, ${skipped.length} skipped)`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
