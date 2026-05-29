/** @type {Map<string, { value: unknown, expires: number }>} */
const store = new Map()

/**
 * @param {string} key
 * @param {() => Promise<T>} loader
 * @param {number} ttlMs
 * @returns {Promise<T>}
 * @template T
 */
export async function cached(key, loader, ttlMs) {
  const now = Date.now()
  const hit = store.get(key)
  if (hit && hit.expires > now) {
    return /** @type {T} */ (hit.value)
  }
  const value = await loader()
  store.set(key, { value, expires: now + ttlMs })
  return value
}

/**
 * @param {string} prefix 例如 `appt:rm_abc`
 */
export function invalidatePrefix(prefix) {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key)
  }
}

export const TTL = {
  appointmentMs: Number(process.env.ROOM_CACHE_APPT_MS ?? 15_000),
  userEmailMs: Number(process.env.ROOM_CACHE_EMAIL_MS ?? 300_000),
  accessMs: Number(process.env.ROOM_CACHE_ACCESS_MS ?? 60_000),
}
