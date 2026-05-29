/** Mulberry32 — 与 server/seededRandom.js 保持一致 */

export function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function seededInt(next: () => number, maxExclusive: number): number {
  if (maxExclusive <= 0) return 0
  return Math.floor(next() * maxExclusive)
}
