/** 与后端 `displayId` 规则尽量一致：username → 邮箱 @ 前 → 姓名 → user id */
export function clerkSelfDisplayId(
  user:
    | {
        id: string
        username?: string | null
        primaryEmailAddress?: { emailAddress?: string | null } | null
        firstName?: string | null
        lastName?: string | null
      }
    | null
    | undefined,
): string {
  if (!user) return ''
  const un = user.username?.trim()
  if (un) return un
  const em = user.primaryEmailAddress?.emailAddress?.trim()
  if (em) {
    const local = em.split('@')[0]
    return local || em
  }
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim()
  if (name) return name
  return user.id
}
