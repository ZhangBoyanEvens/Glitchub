/**
 * 将 data URL 或纯 base64 解码为 public/images/games/<name>.jpg
 * 用法: node scripts/decode-game-cover-dataurl.mjs <input.txt> <output-basename>
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

const inputPath = process.argv[2]
const basename = process.argv[3] || 'cover'
if (!inputPath) {
  console.error('Usage: node scripts/decode-game-cover-dataurl.mjs <input.txt> <basename>')
  process.exit(1)
}

let raw = fs.readFileSync(inputPath, 'utf8').trim()
const labelIdx = raw.indexOf('：')
if (labelIdx >= 0 && raw.includes('data:image')) {
  raw = raw.slice(labelIdx + 1).trim()
}
const comma = raw.indexOf('base64,')
const b64 = comma >= 0 ? raw.slice(comma + 7) : raw
const buf = Buffer.from(b64.replace(/\s/g, ''), 'base64')
const outDir = path.join(root, 'public', 'images', 'games')
fs.mkdirSync(outDir, { recursive: true })
const outPath = path.join(outDir, `${basename}.jpg`)
fs.writeFileSync(outPath, buf)
console.log(`Wrote ${outPath} (${buf.length} bytes)`)
