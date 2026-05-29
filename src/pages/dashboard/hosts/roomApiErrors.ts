const ROOM_API_COMMON_ERR: Record<string, string> = {

  Unauthorized: 'Unauthorized. Please sign in again.',

  'DATABASE_URL not configured': 'Database is not configured on the server.',

  'Your account has no primary email in Clerk (and no synced row in Neon). Add a verified email to join.':

    'Your account has no primary email in Clerk (and no synced row in Neon). Add a verified email to join.',

  'Room not found': 'Room not found.',

  'This session has been cancelled': 'This session has been cancelled and can no longer be entered.',

  NOT_ALL_READY: 'All online players must be ready',

  'All online players must be ready': 'All online players must be ready',

}



export function mapRoomApiMessage(

  raw: string | undefined,

  status: number,

  extra: Record<string, string>,

  actionLabel: string,

): string {

  if (!raw) {

    return status === 401 ? 'Unauthorized. Please sign in again.' : `${actionLabel} (${status})`

  }

  return extra[raw] ?? ROOM_API_COMMON_ERR[raw] ?? raw

}

