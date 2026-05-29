import { randomBytes } from 'node:crypto'

export function newRoomId() {
  return `rm_${randomBytes(8).toString('hex')}`
}
