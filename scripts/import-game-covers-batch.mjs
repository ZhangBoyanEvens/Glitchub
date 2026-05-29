/**
 * 从用户粘贴的多段「标题：data:image...」文本批量解码封面。
 * 用法: node scripts/import-game-covers-batch.mjs <input.txt>
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const outDir = path.join(root, 'public', 'images', 'games')

/** 中文/英文标题 → 输出文件名（不含扩展名） */
const TITLE_TO_BASENAME = {
  腾讯斗地主: 'tencent-doudizhu',
  袜罪并罚: 'wazui-bingfa',
  Palia: 'palia',
  'PCL2 MC': 'pcl2-mc',
  peak: 'peak',
  Peak: 'peak',
  'rv there yet？': 'rv-there-yet',
  'rv there yet?': 'rv-there-yet',
  'RV There Yet?': 'rv-there-yet',
  'Shift at Midnight': 'shift-at-midnight',
  'Shift at Midnight（Demo）': 'shift-at-midnight',
  'SOS OPS': 'sos-ops',
  'Keep Exploding no Talking': 'keep-exploding-no-talking',
  乞丐模拟器: 'qi-gai-moni-qi',
  'casino simulator': 'casino-simulator',
}

function decodeDataUrl(dataUrl) {
  const comma = dataUrl.indexOf('base64,')
  if (comma < 0) throw new Error('missing base64,')
  const b64 = dataUrl.slice(comma + 7).replace(/\s/g, '')
  return Buffer.from(b64, 'base64')
}

function parseEntries(text) {
  const entries = []
  const chunks = text.split(/\n(?=[^\n]+[：:]\s*data:image)/)
  for (const chunk of chunks) {
    const sep = chunk.search(/[：:]/)
    if (sep < 0) continue
    const title = chunk.slice(0, sep).trim()
    const rest = chunk.slice(sep + 1).replace(/\s/g, '')
    if (!rest.startsWith('data:image') || !rest.includes('base64,')) continue
    entries.push({ title, dataUrl: rest })
  }
  return entries
}

async function fetchMinecraftCover() {
  const url =
    'https://cdn.cloudflare.steamstatic.com/steam/apps/1794680/header.jpg'
  const res = await fetch(url)
  if (!res.ok) throw new Error(`minecraft fetch ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

async function main() {
  const inputPath = process.argv[2]
  if (!inputPath) {
    console.error('Usage: node scripts/import-game-covers-batch.mjs <input.txt>')
    process.exit(1)
  }
  const text = fs.readFileSync(inputPath, 'utf8')
  fs.mkdirSync(outDir, { recursive: true })

  const entries = parseEntries(text)
  console.log(`Parsed ${entries.length} data URL entries`)

  for (const { title, dataUrl } of entries) {
    const base = TITLE_TO_BASENAME[title] ?? TITLE_TO_BASENAME[title.trim()]
    if (!base) {
      console.warn(`Skip unknown title (add to TITLE_TO_BASENAME): ${title}`)
      continue
    }
    const buf = decodeDataUrl(dataUrl)
    const outPath = path.join(outDir, `${base}.jpg`)
    fs.writeFileSync(outPath, buf)
    console.log(`Wrote ${outPath} (${buf.length} bytes) <- ${title}`)
  }

  // PCL2 仅当写明「找 minecraft」且未提供 base64 时才拉 Steam 头图
  const pcl2HasDataUrl = entries.some((e) => e.title.includes('PCL2'))
  if (!pcl2HasDataUrl && /PCL2\s*MC[：:]\s*找minecraft/i.test(text)) {
    const buf = await fetchMinecraftCover()
    const outPath = path.join(outDir, 'pcl2-mc.jpg')
    fs.writeFileSync(outPath, buf)
    console.log(`Wrote ${outPath} (${buf.length} bytes) <- PCL2 MC (Minecraft)`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
