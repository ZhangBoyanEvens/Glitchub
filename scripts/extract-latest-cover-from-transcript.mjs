/**
 * 从 agent transcript 提取最新一条含 data:image 的用户消息，写入 batch 输入文件。
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const transcriptPath = process.argv[2]
const keyword = process.argv[3] || ''
const outPath =
  process.argv[4] ||
  path.join(path.dirname(fileURLToPath(import.meta.url)), '_covers-batch.input')

if (!transcriptPath) {
  console.error(
    'Usage: node extract-latest-cover-from-transcript.mjs <transcript.jsonl> [keyword] [output.txt]',
  )
  process.exit(1)
}

const lines = fs.readFileSync(transcriptPath, 'utf8').split('\n')
let last = ''
for (const line of lines) {
  if (!line.includes('data:image')) continue
  if (keyword && !line.includes(keyword)) continue
  try {
    const o = JSON.parse(line)
    let text = ''
    if (o.text) text = o.text
    else if (o.message?.content) {
      for (const c of o.message.content) {
        if (c.type === 'text') {
          const m = c.text.match(/<user_query>\n?([\s\S]*?)\n?<\/user_query>/)
          text = m ? m[1] : c.text
        }
      }
    }
    if (text.includes('data:image')) last = text
  } catch {
    /* skip */
  }
}

if (!last) {
  console.error('No matching user message found')
  process.exit(1)
}

fs.writeFileSync(outPath, last)
console.log(`Wrote ${outPath} (${last.length} chars)`)
