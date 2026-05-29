# Hosts：CS 开箱式轮盘（已下线，归档备查）

> 已从 `DashboardHosts` 移除 UI；逻辑与样式记录于此，便于日后恢复或迁移到独立页面。

## 产品形态

- 横向滚动「皮肤条」+ 视口左右渐隐 + **中央金色三角指针**（上下对称）。
- 单格：**占位图块 + 游戏标题**；按 `tier_rank` 1–6 使用不同边框光晕（**不展示档位文案**）。
- **「开箱」** 按钮触发一次动画；`prefers-reduced-motion: reduce` 时缩短为约 0.12s 线性，结果概率不变。

## 概率模型（与原始库一致）

1. 请求 `GET /api/catalog/reference-games`，使用返回的 `tier_pick_weight`（15 / 20 / 30 / 25 / 10 / 5）。
2. **先抽档**：在 `[0, sum(weights))` 上均匀随机，按累计权重命中某一档（总和不必为 100，对 **sum 归一化**）。
3. **再抽游戏**：在该档 `games` 数组内 **均匀随机**。
4. **视觉条带**：固定长度 `REEL_LEN = 56`，中奖格固定在索引 **`WIN_INDEX = 44`**（第 45 格）；其余格从全库随机填充，仅装饰。

## 动画与几何

- 每格宽度 `ITEM_W = 128px`，间距 `GAP = 10px`，步长 **`STRIDE = 138`**。
- 视口中心 `C = clientWidth / 2`；条带 `translateX`：
  - 起始：`C - HALF_W`（`HALF_W = 64`），使第 0 格居中。
  - 结束：`C - WIN_INDEX * STRIDE - HALF_W`，使中奖格对齐指针。
- 缓动：`transform 6.2s cubic-bezier(0.18, 0.92, 0.24, 1)`。
- 实现要点：`transition: none` 重置起点 → 双 `requestAnimationFrame` 再挂上 transition 与终点，避免浏览器合并无效过渡。

## 曾存在的文件

| 文件 | 说明 |
|------|------|
| `src/pages/dashboard/DashboardHosts.tsx` | 含 `pickWeightedGame`、`buildStrip`、`runSpin` 等 |
| `src/pages/dashboard/hosts-case.css` | 开箱视口、指针、金按钮、格子稀有度样式 |

恢复时：把本页逻辑拷回 `DashboardHosts.tsx`、恢复 `hosts-case.css` 并在组件中 `import './hosts-case.css'`。

## 数据依赖

- 后端 `GET /api/catalog/reference-games`（见 `server/index.js`）。
- 表 `reference_game_categories` / `reference_games`，种子脚本 `npm run db:seed:reference-catalog`。

---
*归档日期：以仓库当前迭代为准。*
