type HostsUserBadgeProps = {
  /** 进入房间前：黑白头像 + 灰色 id；在房间内：彩色 + 蓝色 id */
  presence: 'outside_room' | 'inside_room'
  imageUrl: string | null | undefined
  /** 展示的 id：优先 Clerk username，调用方传入 */
  displayId: string
  /** 辅助说明，如「当前账号」 */
  caption?: string
}

/** Clerk 头像 + 展示 id；样式随是否在房间内切换 */
export function HostsUserBadge({
  presence,
  imageUrl,
  displayId,
  caption,
}: HostsUserBadgeProps) {
  const inside = presence === 'inside_room'
  const mod = inside
    ? 'dashboard__hostsUserBadge--inside'
    : 'dashboard__hostsUserBadge--outside'

  return (
    <div className={`dashboard__hostsUserBadge ${mod}`}>
      {caption ? (
        <span className="dashboard__hostsUserBadgeCaption">{caption}</span>
      ) : null}
      <div className="dashboard__hostsUserBadgeRow">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt=""
            className="dashboard__hostsUserBadgeImg"
            width={40}
            height={40}
            decoding="async"
          />
        ) : (
          <span
            className="dashboard__hostsUserBadgeImg dashboard__hostsUserBadgeImg--placeholder"
            aria-hidden
          >
            {(displayId || '?').slice(0, 1).toUpperCase()}
          </span>
        )}
        <span className="dashboard__hostsUserBadgeId" title={displayId}>
          {displayId || '—'}
        </span>
      </div>
    </div>
  )
}
