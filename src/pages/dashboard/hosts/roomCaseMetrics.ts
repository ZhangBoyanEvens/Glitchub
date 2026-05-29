/** 与 buildStrip 中奖格索引一致 */
export const REEL_LEN = 56
export const WIN_INDEX = 44

/**
 * 将条带上第 index 格的中心对齐到视口水平中心所需的 translateX（像素）。
 * 必须在条带 DOM 已渲染且 transform 为 none/已知 后调用。
 */
export function reelTranslateXToCenterCell(
  viewport: HTMLElement,
  reel: HTMLElement,
  cellIndex: number,
): number {
  const cell = reel.children.item(cellIndex)
  if (!(cell instanceof HTMLElement)) {
    return 0
  }
  const viewportCenter = viewport.clientWidth / 2
  const cellCenter = cell.offsetLeft + cell.offsetWidth / 2
  return viewportCenter - cellCenter
}
