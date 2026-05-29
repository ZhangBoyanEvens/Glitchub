# Glitchub — Scrum 1 项目报告

| 项目 | Glitchub（Hosts 协作开房与房间内游戏流程） |
|------|---------------------------------------------|
| Sprint | Scrum 1 |
| 报告日期 | 2026-05-27 |
| 技术栈 | React 19 + Vite 8 · Express 5 · Neon PostgreSQL · Clerk · Resend |

---

## 1. 项目概述

Glitchub 是一个面向组织内协作的 Web 应用：用户通过 **Clerk** 登录并归属组织，业务数据存放在 **Neon（PostgreSQL）**。当前 Sprint 1 的核心交付集中在 **Hosts 模块**——预约开房、面对面现场组队、进入实时房间，并在房间内完成许愿池、开箱抽奖、投票与对局会话等流程。

架构原则见 [architecture.md](./architecture.md)；部署说明见 [deploy.md](./deploy.md)。

---

## 2. 项目进度（Scrum 1）

### 2.1 整体完成度（估算）

| 模块 | 状态 | 说明 |
|------|------|------|
| 用户与组织（Clerk） | 已完成 | 登录/注册、Dashboard、组织页 |
| 预约房间（Book + 邀请邮件） | 已完成 | 创建邀请、受邀人接受/拒绝、邮件通知 |
| 进入房间（Join） | 已完成 | `rm_*` 房间号、预约列表一键进入 |
| 现场组队（Lobby） | 已完成 | 4–6 位房间码面对面进房，首人即房主 |
| 实时房间 UI | 已完成 | 成员、在线态、许愿池、开箱、投票、揭晓 |
| 对局会话 | 已完成 | 房主开始游戏、否决次数限制、全员赞成揭晓 |
| 房间生命周期 | 已完成 | 预约房到期清理、取消房删除、现场房空房删除 |
| 原始游戏库 Catalog | 已完成 | 分类/概率 API + 前端封面与概率展示 |
| 自动化 E2E / 单元测试 | 未开始 | 以脚本自检与手工联调为主 |
| 生产部署与监控 | 部分 | 有 `deploy.md` 与生产启动脚本，待环境实配 |

**Sprint 1 结论：** Hosts 主路径（预约 → 进房 → 房间内玩法 → 结束/解散）已打通；测试以连接脚本 + 开发环境手工验证为主；后续 Sprint 可聚焦测试覆盖、大厅体验与运维可观测性。

### 2.2 里程碑时间线（本 Sprint 内）

```mermaid
flowchart LR
  A[身份与 DB 基建] --> B[预约邀请 + 邮件]
  B --> C[进房 + 成员/在线]
  C --> D[许愿池 + 开箱]
  D --> E[投票 + 对局会话]
  E --> F[揭晓页 + 结束房间]
  F --> G[现场组队 + 房间清理]
  G --> H[代码去重与文档]
```

---

## 3. 连接测试

### 3.1 开发环境拓扑

| 组件 | 地址/方式 | 说明 |
|------|-----------|------|
| 前端（Vite） | `http://localhost:5173`（或 5174 等占用端口） | `npm run dev` |
| 后端（Express） | `http://127.0.0.1:8787` | `npm run server:dev` |
| API 代理 | Vite `proxy: /api → 8787` | 前端统一请求 `/api/*` |
| 数据库 | Neon `DATABASE_URL` | 仅后端连接 |
| 身份 | Clerk Dashboard 密钥 | 前端 `VITE_*`，后端 `CLERK_SECRET_KEY` |

### 3.2 连接自检命令

在项目根目录配置 `.env`（参考 `.env.example`）后执行：

| 命令 | 验证对象 | 通过标准 |
|------|----------|----------|
| `npm run test:db` | Neon PostgreSQL | 输出 `Connection OK` |
| `npm run test:resend` | Resend 发信 | 配置 `RESEND_API_KEY` 等后可发测试邮件 |
| `npm run test:clerk-webhook` | Clerk Webhook 验签 | 本地需隧道（ngrok/cloudflared）指向 `:8787` |
| `npm run test:clerk-user-sync` | Clerk 用户 → Neon 同步 | 需 `CLERK_SECRET_KEY` |
| `npm run test:appointment-invite` | 预约邀请响应链路 | 需已有预约数据 |

**健康检查（运行时）：**

```http
GET /api/health
```

- 有 `DATABASE_URL`：`{ "ok": true, "db": { "ok": 1 } }`
- 无数据库：`503` + 说明信息

### 3.3 联调检查清单（手工）

- [ ] 登录 Clerk 账号，主邮箱已验证
- [ ] `GET /api/catalog/reference-games` 返回分类与游戏（需已 seed）
- [ ] 创建预约邀请 → 受邀邮箱收到邮件（Resend 已配置）
- [ ] 受邀人接受邀请 → `POST /api/rooms/join` 成功 → 进入 `/dashboard/hosts/room/:roomId`
- [ ] 现场组队：两人输入相同 4–6 位码 → 同房间、首人为房主
- [ ] 房间内：presence 心跳、成员列表在线绿点
- [ ] 房主「开始游戏」→ 非房主收到提示；否决每局 2 次
- [ ] 开箱 → 投票 → 在线全员赞成 → 金光揭晓页 + Steam 链接
- [ ] 预约房：预约时间前不可结束；之后可结束并删除数据
- [ ] 全员离开现场房约 45s 后房间被后台清扫删除

### 3.4 房间内性能（Scrum 1 优化）

目标：单次房间内读操作 **&lt; 300ms**（在 Neon 同区域 + pooled 连接前提下）。

| 优化项 | 说明 |
|--------|------|
| `GET /api/rooms/:roomId/live` | 一次请求返回成员、对局、投票、许愿池（并行 SQL） |
| 热路径禁 Clerk HTTP | 成员列表仅查 `clerk_synced_users` |
| 邮箱解析 | 优先 Neon，缓存 5 分钟 |
| 预约/权限缓存 | 15s / 60s 内存 TTL |
| 数据库索引 | `room_id`、`appointment_participants`、`primary_email` |
| presence 心跳 | 不再每次 `UPDATE appointments`（仅首次进入写库） |
| 前端轮询 | 合并为约 2s 一次 `/live`（`VITE_ROOM_LIVE_POLL_MS`） |

### 3.5 已知连接/环境注意点

- 未配置 `DATABASE_URL` 时后端仍可启动，但所有 DB 路由返回 `503`。
- Clerk Webhook 写库依赖公网 HTTPS 端点，纯本地需隧道。
- PostgreSQL 驱动可能打印 SSL 提示，一般不影响开发库连接。

---

## 4. 接口一览

除特别说明外，业务 API 均需请求头：`Authorization: Bearer <Clerk Session JWT>`。

### 4.1 系统与资源

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 服务与数据库探活 |
| GET | `/api/catalog/reference-games` | 原始游戏库（分类、档内概率） |
| POST | `/api/webhooks/clerk` | Clerk 用户事件（Svix 验签，raw body） |

### 4.2 预约与邀请

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/host-invitations?orgId=` | 当前组织下的预约/邀请列表 |
| POST | `/api/host-invitations` | 创建预约 + `rm_*` 房间 + 发邀请邮件 |
| DELETE | `/api/host-invitations/:invitationId` | 取消预约（可发取消邮件） |
| POST | `/api/host-invitations/:invitationId/verify-join` | 校验加入 UID |
| POST | `/api/appointment-invite/respond` | 公开：接受/拒绝（token） |
| POST | `/api/email/host-invitation` | 重发邀请邮件 |

### 4.3 进房

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/rooms/join` | Body: `{ roomId }` — 预约房或已知 `rm_*` 的现场房 |
| POST | `/api/rooms/instant/enter` | Body: `{ joinCode }` — 现场组队（4–6 位数字） |
| POST | `/api/rooms/instant/suggest-code` | 随机 6 位未占用房间码 |

### 4.4 房间内（`:roomId` = `rm_…`）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/rooms/:roomId/presence` | 在线心跳（约 45s TTL） |
| GET | `/api/rooms/:roomId/members` | 成员列表 + `isOnline` |
| GET | `/api/rooms/:roomId/game-session` | 对局状态、否决余量、`canEndRoom` 等 |
| POST | `/api/rooms/:roomId/game-session/start` | 仅房主开始游戏 |
| GET | `/api/rooms/:roomId/wish-pool` | 许愿池三槽 |
| PUT | `/api/rooms/:roomId/wish-pool` | 保存许愿池 |
| GET | `/api/rooms/:roomId/votes` | 当前投票记录 |
| POST | `/api/rooms/:roomId/votes` | 赞成/否决（开始后否决限次） |
| GET | `/api/rooms/:roomId/draw-logs` | 开箱历史 |
| POST | `/api/rooms/:roomId/draw-logs` | 仅房主记录开箱结果 |
| DELETE | `/api/rooms/:roomId/draw-logs` | 删除记录（按实现权限） |
| POST | `/api/rooms/:roomId/end` | 仅房主结束；预约房须过 `scheduled_at` |

### 4.5 主要数据表（Neon）

| 表 | 用途 |
|----|------|
| `host_invitations` / `host_invitation_invitees` | 预约邀请主数据 |
| `appointments` / `appointment_participants` | 房间实例、受邀邮箱、`room_kind`、`join_code` |
| `room_presence` | 在线心跳 |
| `room_wish_pool` | 许愿池 |
| `room_game_votes` / `room_game_vetoes` | 投票与否决计数 |
| `room_case_draw_logs` | 开箱记录 |
| `reference_game_categories` / `reference_games` | 游戏库 |
| `clerk_synced_users` | Clerk 用户镜像（展示用） |

---

## 5. 已完成功能

### 5.1 平台与基建

- Clerk 登录/注册（path 路由）、Dashboard 布局
- Express API + Vite 开发代理；生产同域静态资源（见 deploy）
- Neon 迁移脚本与启动时部分 DDL 自动补齐
- Clerk Webhook → 用户同步 Neon（及可选 Resend Audience）

### 5.2 Hosts — 预约流程

- **预约房间**：选择时间、邀请成员、生成 `rm_*` 房间号
- **邮件**：Resend 发送邀请/取消（依赖环境变量）
- **邀请落地页**：`/book/:inviteRef` 接受/拒绝
- **进入房间**：Join 页输入房间号或从预约列表进入

### 5.3 Hosts — 现场组队

- **面对面房间码**：4–6 位数字，同码进同房
- **房主规则**：首个创建该码的用户为房主
- **自动解散**：全员离线超过约 45s（新建房至少保留 90s）后删除
- **UI**：大厅输入码 / 随机码；房间内顶栏显示房间码

### 5.4 Hosts — 实时房间

- **布局**：左侧成员 + 许愿池，主区开箱三栏（记录 / 本次结果 / 概率）
- **在线状态**：presence 轮询 + 成员列表绿点
- **许愿池**：三槽选游戏、保存、加成概率公示
- **开箱**：CS 式轮盘动画；仅房主可抽；关联许愿池权重
- **抽奖记录**：面板展示历史
- **对局会话**：房主「开始游戏」；未开始自由投票，开始后每人 2 次否决
- **结果投票**：成员名片侧赞成/否决徽章
- **全员揭晓**：在线全员赞成 → 全屏金光揭晓 + Steam 商店链接
- **结束房间**：仅房主；预约房须到预约时间；取消/结束后数据清理

### 5.5 房间生命周期（后台）

- 预约房：`scheduled_at + N 小时` 后删除（默认 6h，`ROOM_AUTO_EXPIRE_HOURS`）
- 已取消房间：定时 + 结束接口即时删除
- 现场空房：`purgeEmptyInstantRooms`（可配置 `ROOM_INSTANT_EMPTY_GRACE_SECONDS`）

### 5.6 代码质量（Sprint 末）

- 抽取 `roomAccess.js`、`roomIds.js` 等共享模块，减少重复鉴权/SQL
- 前端 `roomApiErrors.ts`、`parseRoomGameSession` 统一错误与状态解析
- 移除未使用的大厅列表 CSS

---

## 6. 待改进功能

### 6.1 功能与产品

| 项 | 优先级 | 说明 |
|----|--------|------|
| 现场组队房间列表/历史 | 中 | 当前仅「输码进房」，无进行中房间浏览 |
| 离开房间显式 API | 低 | 依赖 presence TTL，可增 `DELETE presence` 加快空房清理 |
| 预约房与非预约房权限提示 | 中 | 403 场景可更细分（邮箱不匹配 vs 房间已解散） |
| 组织维度现场房 | 低 | 现场房未绑定 `org_id`，跨组织同码理论上可撞码（概率低） |
| Dashboard Games / 其他模块 | 待定 | 非 Hosts 页面仍为占位或浅层 |
| 移动端适配 | 中 | 房间网格在小屏需持续验证 |

### 6.2 测试与质量

| 项 | 优先级 | 说明 |
|----|--------|------|
| API 集成测试 | 高 | 覆盖 join、instant/enter、game-session、votes |
| E2E（Playwright 等） | 中 | 主路径：进房 → 许愿 → 开箱 → 投票 |
| CI 流水线 | 中 | `lint` + `test:db` + 构建 |
| 类型与契约 | 低 | 前后端共享 OpenAPI 或 zod 契约 |

### 6.3 工程与运维

| 项 | 优先级 | 说明 |
|----|--------|------|
| 路由中间件统一鉴权 | 中 | 各 `room*.js` 仍有重复样板 |
| 环境变量文档补全 | 低 | 如 `ROOM_INSTANT_EMPTY_GRACE_SECONDS` 写入 `.env.example` |
| 日志与监控 | 中 | 结构化日志、房间清扫指标 |
| Webhook 本地开发文档 | 低 | 隧道步骤可并入本报告附录 |

### 6.4 安全与合规

| 项 | 优先级 | 说明 |
|----|--------|------|
| 房间码暴力尝试限流 | 中 | `instant/enter` 可加 IP/用户频率限制 |
| 敏感配置审计 | 低 | 确保 `.env` 未入库、生产密钥轮换 |

---

## 7. 本地快速启动（附录）

```bash
# 1. 依赖
npm install

# 2. 环境
cp .env.example .env
# 编辑 DATABASE_URL、Clerk、Resend 等

# 3. 数据库（首次）
npm run db:migrate:host-invitations
npm run db:migrate:appointments
npm run db:migrate:room-presence
npm run db:seed:reference-catalog

# 4. 连接测试
npm run test:db

# 5. 双进程开发
npm run server:dev   # :8787
npm run dev          # :5173，代理 /api
```

---

## 8. 相关文档

| 文档 | 路径 |
|------|------|
| 架构说明 | [architecture.md](./architecture.md) |
| 部署指南 | [deploy.md](./deploy.md) |
| 开箱归档说明 | [archive-hosts-case-opening.md](./archive-hosts-case-opening.md) |

---

*本报告对应仓库 Scrum 1 交付快照；后续 Sprint 请在本文件续写「Scrum 2」章节或新建 `scrum2-report.md`。*
