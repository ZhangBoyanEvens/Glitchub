# Glitchub 房间用户流程图

本文描述从进入房间到结束的**完整用户旅程**与**服务端 FSM 状态**对应关系。权威状态以 `appointments.room_phase` 为准。

---

## 1. 房间状态机（FSM）

```mermaid
stateDiagram-v2
  direction TB

  [*] --> LOBBY: 创建/加入预约房

  LOBBY --> WISH_COLLECTION: 房主 GAME_START_REQUESTED\n(预约房须到 scheduled_at)

  WISH_COLLECTION --> WISH_COLLECTION: 任意玩家 WISHLIST_UPDATED
  WISH_COLLECTION --> WISH_COLLECTION: 任意玩家 PLAYER_READY_TOGGLED

  WISH_COLLECTION --> READY_LOCK: 全员在线且已准备\n或 房主 force-lock

  READY_LOCK --> SPINNING: 房主 SPIN_STARTED\n(服务端 seed + spinId)

  SPINNING --> VETO_PHASE: SPIN_REVEALED\n(revealTimestamp 到达)

  VETO_PHASE --> VETO_PHASE: 玩家 VETO_USED\n(approve / reject)

  VETO_PHASE --> FINALIZED: 全员在线赞成\n(无否决)
  VETO_PHASE --> RESPINNING: 存在否决且全员已投票\n(否决失败)

  RESPINNING --> SPINNING: 自动 SPIN_STARTED\n(旧 spin 作废, round+1)

  FINALIZED --> CLOSED: 房主 ROOM_CLOSED\n(预约房须到点可结束)

  CLOSED --> [*]
```

---

## 2. 端到端用户流程（主流程）

```mermaid
flowchart TB
  subgraph entry [进入房间]
    A[用户登录 Clerk] --> B{房间类型}
    B -->|预约房| C[受邀接受邀请 / 房主创建预约]
    B -->|现场房| D[输入 4–6 位房间码]
    C --> E[打开房间页 /join 或链接]
    D --> E
    E --> F[POST 加入 + 心跳 presence]
    F --> G["阶段: LOBBY\n大厅等待"]
  end

  subgraph wish [许愿与准备]
    G --> H{是否房主}
    H -->|是| I[点击「开始游戏」]
    H -->|否| J[等待房主开始]
    I --> K["阶段: WISH_COLLECTION"]
    J --> K
    K --> L[编辑许愿池 3 槽并保存]
    L --> M[点击「准备」]
    M --> N{全员在线且已准备?}
    N -->|否| L
    N -->|是| O["阶段: READY_LOCK\n许愿池锁定"]
    N -->|房主等不及| P[房主「强制锁定」]
    P --> O
  end

  subgraph spin [权威抽奖]
    O --> Q[房主点击「开箱/抽奖」]
    Q --> R["阶段: SPINNING\n服务端生成 seed/spinId/结果"]
    R --> S[WebSocket 广播 ROOM_SPIN_START]
    S --> T[各客户端用 seed 同步动画\nserverTimestamp + revealTimestamp]
    T --> U{客户端是否迟到?}
    U -->|是| V[跳过动画直接展示结果]
    U -->|否| W[播放确定性转盘动画]
    V --> X["阶段: VETO_PHASE"]
    W --> X
  end

  subgraph veto [否决投票]
    X --> Y[展示本轮开奖游戏名]
    Y --> Z[在线成员对「本局标题」投票]
    Z --> AA{投票结果}
    AA -->|任一否决| AB["自动重抽\nRESPINNING → SPINNING"]
    AB --> R
    AA -->|全员赞成| AC["阶段: FINALIZED\n锁定 final_game"]
    AC --> AD[全屏揭晓最终游戏]
  end

  subgraph end [结束]
    AD --> AE{房主结束房间}
    AE --> AF["阶段: CLOSED\n清理预约数据"]
    AF --> AG[离开房间页]
  end
```

---

## 3. 角色与可操作项（按阶段）

```mermaid
flowchart LR
  subgraph phases [房间阶段]
    P1[LOBBY]
    P2[WISH_COLLECTION]
    P3[READY_LOCK]
    P4[SPINNING]
    P5[VETO_PHASE]
    P6[FINALIZED]
    P7[CLOSED]
  end

  subgraph host [房主]
    H1[开始游戏]
    H2[强制锁定]
    H3[开箱抽奖]
    H4[结束房间]
  end

  subgraph player [所有玩家]
    U1[加入/心跳]
    U2[编辑许愿池]
    U3[准备/取消准备]
    U4[观看同步动画]
    U5[赞成/否决]
  end

  P1 --> H1
  P1 --> U1
  P2 --> H2
  P2 --> U2
  P2 --> U3
  P3 --> H3
  P4 --> U4
  P5 --> U5
  P6 --> H4
  P7 --> U1
```

| 阶段 | 房主 | 全体玩家 | 前端 UI 锁定 |
|------|------|----------|----------------|
| LOBBY | 开始游戏 | 加入、在线展示 | 许愿池/抽奖/投票不可用 |
| WISH_COLLECTION | 强制锁定 | 许愿池、准备 | 可编辑许愿；不可抽奖 |
| READY_LOCK | 开箱 | 等待 | 许愿池只读 |
| SPINNING | — | 只看动画 | 不可投票 |
| VETO_PHASE | 同玩家 | 赞成/否决（限 2 次否决权） | 不可改许愿 |
| FINALIZED | 结束房间 | 查看最终游戏 | 揭晓层 |
| CLOSED | — | 被踢回大厅/加入页 | — |

---

## 4. 否决与重抽决策

```mermaid
flowchart TD
  A[进入 VETO_PHASE\n已有本轮 resultGameTitle] --> B[玩家提交 VETO_USED]
  B --> C{当前阶段仍为 VETO_PHASE?}
  C -->|否| X[拒绝 409]
  C -->|是| D{vote}
  D -->|reject| E{本轮是否首次否决该用户?}
  E -->|是| F{已用否决次数 < 2?}
  F -->|否| G[403 VETO_LIMIT]
  F -->|是| H[记入 room_game_vetoes]
  E -->|否| I[仅更新 vote 行]
  D -->|approve| I
  H --> I
  I --> J{所有在线成员\n对本标题均已投票?}
  J -->|否| K[保持 VETO_PHASE\noutcome=pending]
  J -->|是| L{是否存在 reject?}
  L -->|是| M[RESPINNING\n作废 spinId\n自动新一轮 SPIN_STARTED]
  L -->|否| N[FINALIZED\n写入 final_game_*]
  M --> O[回到 SPINNING 动画链]
  O --> A
```

---

## 5. 同步与数据来源

```mermaid
sequenceDiagram
  participant Host as 房主客户端
  participant API as Express API
  participant FSM as eventProcessor
  participant DB as Neon
  participant WS as WebSocket Hub
  participant P2 as 其他客户端

  Host->>API: POST /spin (SPIN_STARTED)
  API->>FSM: dispatchRoomEvent
  FSM->>DB: room_spins + room_phase=SPINNING
  FSM->>WS: ROOM_SPIN_START + ROOM_STATE_CHANGED
  WS-->>P2: seed, revealTimestamp, resultGameId
  P2->>P2: 确定性动画（不本地随机结果）

  Note over FSM,DB: revealTimestamp 后
  P2->>API: GET /live (轮询)
  API->>FSM: syncFsmOnRead → SPIN_REVEALED
  FSM->>DB: room_phase=VETO_PHASE
  FSM->>WS: ROOM_STATE_CHANGED

  P2->>API: POST /votes (VETO_USED)
  API->>FSM: 评估全员投票
  alt 全员赞成
    FSM->>DB: FINALIZED
  else 有人否决
    FSM->>DB: 新 spin, SPINNING
    FSM->>WS: ROOM_SPIN_START
  end
```

---

## 6. 与测试脚本对应关系

`npm run test:room-fsm-flow` 覆盖的路径：

1. LOBBY → 创建 5 虚拟用户  
2. GAME_START_REQUESTED → WISH_COLLECTION  
3. WISHLIST_UPDATED ×5  
4. PLAYER_READY_TOGGLED ×5 → READY_LOCK  
5. SPIN_STARTED → SPINNING →（快进时间）→ VETO_PHASE  
6. 1× reject + 4× approve → 自动重抽  
7. 5× approve → FINALIZED  
8. ROOM_CLOSED → 清理数据  

详见 [scripts/test-room-fsm-flow.mjs](../scripts/test-room-fsm-flow.mjs)。
