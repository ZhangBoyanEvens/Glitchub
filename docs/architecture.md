# Glitchub 架构说明

本文档记录当前约定的**功能边界**与对外服务分工，便于后续开发与排障。

## 功能分类

| 领域 | 职责 | 技术选型 |
|------|------|----------|
| **用户系统** | 注册登录、会话、用户资料、权限入口等与「人」直接相关的身份能力 | **Clerk** |
| **组织（Organization）** | 组织/成员/角色等多租户边界（与 Clerk Organizations 对齐） | **Clerk** |
| **网站业务数据** | 产品业务表、内容、统计等需由自有后端读写的关系型数据 | **Neon**（PostgreSQL） |

## 数据与信任边界

- **Clerk**：身份与组织的**事实来源（source of truth）**。前端通过 Clerk SDK 使用会话；服务端校验使用 **Secret Key**（仅服务器环境变量，不得进入浏览器或前端打包产物）。
- **Neon**：承载**应用自有数据**。连接串 `DATABASE_URL` 仅用于 **Node 后端**（如 `server/`），由 API 再暴露给前端；浏览器不直连数据库。
- **关联方式（建议）**：在 Neon 的业务表中用 `clerk_user_id`、`clerk_org_id`（或 Clerk 提供的稳定 ID 字段）与 Clerk 主体做关联，避免在库里重复维护与 Clerk 冲突的用户名/邮箱等身份主数据。

## 环境变量（与 `.env.example` 对齐）

| 变量 | 用途 |
|------|------|
| `DATABASE_URL` | Neon PostgreSQL 连接串（后端） |
| `VITE_CLERK_PUBLISHABLE_KEY` | Clerk 公钥（Vite 前端，仅 `VITE_*`） |
| `CLERK_SECRET_KEY` | Clerk 密钥（仅后端） |
| `CLERK_WEBHOOK_SIGNING_SECRET` | Clerk Webhook 验签（启用 Webhook 时） |
| `PORT` | 本地 API 端口（默认与 `server/index.js` 一致） |

## 用户流程图

- 房间 FSM 状态、角色操作、否决/重抽、同步时序：[room-user-flow.md](./room-user-flow.md)

## 项目报告

- **Scrum 1 总结**（进度、连接测试、接口、已完成/待改进）：[scrum1-report.md](./scrum1-report.md)

## 房间对局 FSM（权威状态机）

- **唯一状态源**：`appointments.room_phase`（8 态：`LOBBY` → `WISH_COLLECTION` → `READY_LOCK` → `SPINNING` → `VETO_PHASE` → `FINALIZED` / `RESPINNING` → `SPINNING` → `CLOSED`）
- **核心模块**（`server/roomFsm/`）：
  - `roomStateMachine.js` — 纯函数 `transition(phase, event)`
  - `eventProcessor.js` — 事件副作用、写库、WebSocket 广播
  - `spinEngine.js` — `seed` / `spinId` / 确定性选游
  - `roomService.js` — `POST /api/rooms/:roomId/events` 与遗留路由统一 `dispatchRoomEvent`
- **事件日志**：`room_events`；**准备态**：`room_player_ready`；**转盘**：`room_spins`（`invalidated_at` 作废旧局）
- **实时**：`ROOM_SPIN_START` + `ROOM_STATE_CHANGED`（`/api/rooms/:id/ws`）
- **前端**：仅渲染 `/live` 与 WS 下发的 `roomPhase` / `activeSpin`；动画仅用服务端 `seed` 与时间轴

## 仓库内相关代码位置（当前）

- 前端：`src/main.tsx`（`BrowserRouter` + 可选 `ClerkProvider`）；**根路径即登录**：路由用 **`path="*"`** 接住 Clerk **path** 模式下的子路径；`<SignIn path="/" routing="path" />`（不再用 `hash`）
- 注册：`/sign-up/*`（`<SignUp />`），「返回登录」指向 `/`
- 后端示例：`server/index.js`（Express + `pg`）
- 数据库连通性自检：`npm run test:db`（`scripts/test-db.mjs`）
