/**
 * Generate Glitchub logo assets from source PNG:
 * - Transparent background
 * - Purple → blue gradient fill
 * - favicon.svg, logo.svg, PNG sizes
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const publicDir = path.join(root, 'public')

const SOURCE = path.join(root, 'assets', 'logo-source.png')

const PURPLE = { r: 168, g: 85, b: 247 } // #a855f7
const BLUE = { r: 59, g: 130, b: 246 } // #3b82f6
const SIZE = 512

function lerp(a, b, t) {
  return Math.round(a + (b - a) * t)
}

function gradientAt(x, y, w, h) {
  const t = (x / (w - 1) + y / (h - 1)) / 2
  return {
    r: lerp(PURPLE.r, BLUE.r, t),
    g: lerp(PURPLE.g, BLUE.g, t),
    b: lerp(PURPLE.b, BLUE.b, t),
  }
}

async function buildGradientLogo(inputPath, size) {
  const { data, info } = await sharp(inputPath)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const { width, height } = info
  const out = Buffer.alloc(data.length)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const srcAlpha = data[i + 3]

      if (srcAlpha < 8) {
        out[i] = 0
        out[i + 1] = 0
        out[i + 2] = 0
        out[i + 3] = 0
      } else {
        const c = gradientAt(x, y, width, height)
        out[i] = c.r
        out[i + 1] = c.g
        out[i + 2] = c.b
        out[i + 3] = srcAlpha
      }
    }
  }

  return sharp(out, { raw: { width, height, channels: 4 } }).png()
}

async function buildMask(inputPath, size) {
  const { data, info } = await sharp(inputPath)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const { width, height } = info
  const out = Buffer.alloc(data.length)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const on = data[i + 3] >= 8 ? 255 : 0
      out[i] = on
      out[i + 1] = on
      out[i + 2] = on
      out[i + 3] = on
    }
  }

  return sharp(out, { raw: { width, height, channels: 4 } }).png().toBuffer()
}

function svgFromMask(maskBase64, id = 'logo') {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}">
  <defs>
    <linearGradient id="${id}-grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#a855f7"/>
      <stop offset="45%" stop-color="#8b5cf6"/>
      <stop offset="100%" stop-color="#3b82f6"/>
    </linearGradient>
    <mask id="${id}-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="${SIZE}" height="${SIZE}">
      <image xlink:href="data:image/png;base64,${maskBase64}" width="${SIZE}" height="${SIZE}"/>
    </mask>
  </defs>
  <rect width="${SIZE}" height="${SIZE}" fill="url(#${id}-grad)" mask="url(#${id}-mask)"/>
</svg>
`
}

async function main() {
  if (!fs.existsSync(SOURCE)) {
    console.error('Source image not found:', SOURCE)
    process.exit(1)
  }

  fs.mkdirSync(publicDir, { recursive: true })

  const logoPng = await buildGradientLogo(SOURCE, SIZE)
  const maskBuf = await buildMask(SOURCE, SIZE)
  const maskBase64 = maskBuf.toString('base64')

  await logoPng.toFile(path.join(publicDir, 'logo.png'))
  await sharp(await logoPng.toBuffer()).resize(32, 32).png().toFile(path.join(publicDir, 'favicon-32.png'))
  await sharp(await logoPng.toBuffer()).resize(180, 180).png().toFile(path.join(publicDir, 'apple-touch-icon.png'))

  const svg = svgFromMask(maskBase64, 'glitchub')
  fs.writeFileSync(path.join(publicDir, 'logo.svg'), svg)
  fs.writeFileSync(path.join(publicDir, 'favicon.svg'), svg)

  console.log('Generated: public/logo.svg, logo.png, favicon.svg, favicon-32.png, apple-touch-icon.png')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
