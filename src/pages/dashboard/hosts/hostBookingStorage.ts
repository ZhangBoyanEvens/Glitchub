export type HostBookingRecord = {
  id: string
  orgId: string
  hostUserId: string
  dateISO: string
  timeStart: string
  /** Legacy local rows may include duration; new rows omit it */
  durationMin?: number
  inviteeIds: string[]
  inviteeNames: string[]
  createdAt: string
  /** Neon `host_invitations.id` when the API write succeeded */
  neonInvitationId?: string
  /** appointments.room_id when created via API */
  roomId?: string
}

const STORAGE_KEY = 'glitchub_host_bookings_v1'
const MAX_PER_ORG = 80

type StoreShape = Record<string, HostBookingRecord[]>

function readAll(): StoreShape {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed as StoreShape
  } catch {
    return {}
  }
}

function writeAll(data: StoreShape) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
}

export function loadBookingsForOrg(orgId: string): HostBookingRecord[] {
  const all = readAll()
  return [...(all[orgId] ?? [])].sort(
    (a, b) =>
      `${b.dateISO}T${b.timeStart}:00`.localeCompare(
        `${a.dateISO}T${a.timeStart}:00`,
      ),
  )
}

export function appendBooking(orgId: string, row: HostBookingRecord) {
  const all = readAll()
  const list = all[orgId] ?? []
  const next = [row, ...list].slice(0, MAX_PER_ORG)
  all[orgId] = next
  writeAll(all)
}

/** Remove one local booking row by id (after Neon delete succeeds). */
export function removeBooking(orgId: string, localRowId: string) {
  const all = readAll()
  const list = all[orgId] ?? []
  const next = list.filter((b) => b.id !== localRowId)
  all[orgId] = next
  writeAll(all)
}
