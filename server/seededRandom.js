/**
 * Mulberry32 — 确定性 PRNG，禁止在抽奖逻辑中使用 Math.random()。
 *
 * @param {number} seed  uint32 种子（服务端下发）
 * @returns {() => number} [0, 1)
 */
export function createSeededRandom(seed) {
  let state = seed >>> 0
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * @param {() => number} next
 * @param {number} maxExclusive
 */
export function seededInt(next, maxExclusive) {
  if (maxExclusive <= 0) return 0
  return Math.floor(next() * maxExclusive)
}
