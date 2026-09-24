# D&D 4E 遭遇战模拟器（4E-Encounter）

前端工程文档（DM 工具型）。

## 1. 项目简介

一款面向桌面端浏览器的 **D&D 4E 遭遇战模拟器**，用于主持线下/线上跑团时的战斗阶段：布设地图、配置参战者、先攻排序、移动棋子、掷骰攻击结算、状态管理、保存/读取遭遇。

- 与私有的「4E 车卡器（4E-NEXT）」**并行**：可直接导入车卡器的 `.d4e.json` 生成 PC 战斗属性，并复用车卡器的怪物数据。
- 数据来源：怪物与规则数据来自《4E 龙与地下城·规则合集 / 万律书（4e Rules Compendium）》中文资料。
- 定位为 **DM 手动/半自动**工具，攻击结算在弹窗中确认后应用，不做全自动模拟。

## 2. 技术栈

| 类别 | 选型 |
| --- | --- |
| 框架 | React 19（`createRoot` + `StrictMode`） |
| 构建 | Vite 6 |
| 语言 | TypeScript 5.7（`strict`，`noUnusedLocals` / `noUnusedParameters`） |
| 样式 | 原生 CSS（`styles.css`），Material Symbols 图标字体 |
| 运行时 | 浏览器（无构建期 Node 依赖；脚本仅用于数据预处理） |

## 3. 快速开始

```bash
# 安装依赖（项目自带 .npm-cache-local，也可忽略之）
npm install

# 开发服务器
npm run dev          # 默认 http://localhost:5173/

# 类型检查
npm run typecheck    # tsc --noEmit

# 生产构建（会依次执行 copy-data / build-rules / clean-dist / tsc / vite build）
npm run build

# 预览构建产物
npm run preview
```

> 注意：`npm run build` 依赖外部数据源（4E-NEXT 管线产物 + 万律书 HTML）。若缺失会打印错误并中止，详见 §7。

## 4. 目录结构

```
4E-Encounter/
├── index.html               # 入口 HTML，挂载 #root
├── package.json
├── tsconfig.json            # strict 工程配置
├── vite.config.ts           # base: './'（可部署到任意相对路径）
├── scripts/                 # 构建期 Node 脚本（数据预处理）
│   ├── copy-data.mjs        # 同步 4E-NEXT 管线产物到 public/data
│   ├── build-rules.mjs      # 万律书 HTML → public/data/rules/index.json
│   ├── clean-dist.mjs       # 用 PowerShell 清空 dist（规避 Node25 非ASCII路径崩溃）
│   └── validate.ts          # 数据校验（类型）
├── public/
│   └── data/                # 运行时静态 JSON（fetch 加载）
│       ├── creature.json    # 怪物条目
│       ├── class.json       # 职业条目（派生生前 HP / 防御）
│       ├── race.json        # 种族条目（速度 / 属性加值）
│       └── rules/index.json # 规则速查索引
└── src/
    ├── main.tsx             # React 挂载入口
    ├── App.tsx              # 主应用：状态编排 + 布局 + 各视图切换
    ├── types.ts             # 核心数据模型与常量（状态表等）
    ├── engine.ts            # 战斗引擎纯函数（路径 / 距离 / 射程 / 生命 / 瞄准）
    ├── dice.ts              # 投骰工具（解析 NdM+偏、掷骰、重击最大伤害）
    ├── data.ts              # 数据加载 + 怪物属性块解析
    ├── characterParse.ts    # .d4e.json 导入 → 重算 PC 战斗属性
    ├── baseWeapons.ts       # 基础武器表（自动生成，勿手改）
    ├── uiPrefs.ts           # 设置 & 怪物队伍 的 localStorage 读写
    ├── MapGrid.tsx          # 方格地图（CSS Grid + 令牌 + 移动 + 瞄准覆盖层）
    ├── SidePanel.tsx        # 右侧选中参战者面板
    ├── AttackDialog.tsx     # 攻击结算弹窗
    ├── CombatLog.tsx        # 战斗日志
    ├── MonsterLibrary.tsx   # 左侧怪物库 / 队伍面板
    ├── MonstersView.tsx     # 「怪物」页：浏览 + 建队
    ├── SettingsView.tsx     # 「设置」页
    ├── ExportView.tsx       # 「导出」页
    ├── RulesView.tsx        # 「规则」速查页
    ├── styles.css           # 全部样式
    └── vite-env.d.ts
```

## 5. 核心架构

### 5.1 数据流

所有战斗状态集中在 `App.tsx`：

- `combatants: Combatant[]` — 参战者列表（角色 / 怪物 / 位置 / 状态 / 数据）。
- `obstacles` / `difficult: Set<string>` — 障碍 / 困难地形格集合（`"x,y"` 字符串键）。
- `turnOrder: string[]` + `turnIndex` — 先攻顺序与当前回合。
- `movePreview: MovePreview` — 移动路径预览（先预览后确认）。
- `aim` / `aimOrigin` / `aimSel` / `aimArea` — 攻击瞄准状态（威能 → 地图点选目标）。
- `pendingAttack` — 待结算的攻击（传给 `AttackDialog`）。
- `log: LogEntry[]` — 战斗日志。

子组件通过 props 回调（`onCellClick` / `onConfirmMove` / `onResolve` / `onSelectAttack` …）把交互回传给 `App`，由 `App` 统一更新状态并 `pushLog`。

### 5.2 视图导航

左侧导航在 `battle`（战斗）、`monsters`（怪物）、`settings`（设置）、`export`（导出）、`rules`（规则）五个视图间切换。战斗页是核心，采用三栏布局：

```
[左侧添加栏]  [中央地图 + 工具条 + 日志]  [右侧选中面板]
 怪物库/队伍       鼠标操作棋子                属性/状态/技能
```

### 5.3 类型模型（types.ts）

- `Team = "pc" | "monster"`。
- `DefenseKey = ac | fort | ref | will`（防御四维，含中文标签）。
- `AttackKind` — 动作分区（标准/移动/次要/自由/触发/灵气/特性）。
- `AttackOption` — 一条威能/特性：射程、目标词条、攻加值、目标防御、伤害表达式、效果文本。
- `CombatantStats` — 与战斗相关的静态属性（PC / 怪物通用）。
- `Combatant` — 加 `cid`、`pos`、`conditions`、`initResult` 的动态对象。
- `ConditionKey` → `CONDITION_LABEL` — 17 种状态，译名与《万律书》对齐（如 目盲 / 晕眩 / 震慑 / 束缚 / 迟缓 / 濒死 / 无助 / 被突袭…），其中「重伤(`bloodied`)」由 HP 自动派生，不可手动切换。

### 5.4 战斗引擎（engine.ts，纯函数）

- **距离**：`gridDistance`（切比雪夫距离）；`tokenDistance` 对大型棋子取其占地间的最小距离。
- **移动**：`buildPath` — 8 向最短步数 BFS，支持斜向穿过生物但不斜穿「墙」拐角，`size` 参数支持大型棋子按占地寻路；`pathMoveCost` 按困难地形计价；`effectiveMoveLimit` 根据状态（迟缓-2 / 倒地减半 / 定身·束缚=0）修正移动力；`validatePath` 逐格校验并返回含「第 N 步」的详细错误。
- **射程**：`parseRange` 解析「近战N / 远程N / 近程爆发N / 近程冲击N / 区域N爆发M / 范围N」等中文描述；`rangeStatus` 判定双方是否在射程内；`losBlocked` 用 Bresenham 直线做效果线遮挡判定。
- **生命**：`dealDamage` 先扣临时 HP 再扣生命（最低 0），自动同步「重伤」「濒死」；`heal` / `useSurge` 回复（回复力去小数取整）。
- **瞄准/区域**：`burstCells`（切比雪夫正方形爆发）、`blastSquare`（冲击贴占地的正方形）、`closeBurstCells`（以使用者整个空间为起始格，大型生物爆发更大）、`reachCells`（近战触及）、`affectedIn`（占地与区域相交的生物）、`centerOf`（占地中心，效果线起终点）、`parseTargetSpec`（解析目标词条 → 最少/最多/是否强制全选）。

### 5.5 投骰（dice.ts）

- `parseDiceExpr` / `rollDiceExpr` — 解析并掷 `NdM+偏`、纯数值，可标记天然 20 / 天然 1。
- `rollD20` — 掷 d20（先攻与攻击）。
- `maxDamage` — 重击伤害 = 骰子取最大值（4E 规则，非翻倍）。
- `formatDiceParts` / `exprBonus` — 展示与偏移提取。

## 6. 主要功能流程

### 6.1 搭建遭遇

1. 左侧「添加怪物」或顶部「导入角色 .d4e.json」，参战者入列并进入**待放置**状态。
2. 在地图上点击放置（校验 `size×size` 占地需完整在地图内、无障碍、无占位）。
3. 可用「障碍」「困难」工具条按钮在地图上绘制地形；障碍阻断寻路与效果线。

### 6.2 移动

- **拖拽**：长按棋子（≥300ms）后拖动到落点，生成可编辑路径，点 `✓` 确认落地并播放滑动动画。
- **路径编辑**：路径上的每个格子中心有锚点，拖动任一锚点仅重算「起点→该锚点→终点」两段（避免网织），可手动绕行。
- **先预览后确认**：路径高亮 + 幽灵棋子预览终点；路径非法时确认按钮禁用但仍保持可见，提示具体不合法原因。
- 支持困难地形（进入每格耗 2 点）、状态减益（定身/束缚无法移动）。

### 6.3 攻击结算

1. 在右侧面板点选某威能的 `⚔`，进入**瞄准模式**，地图上高亮范围 / 效果线 / 判定点。
2. 依射程类型点选目标：
   - **近战 / 远程**：点击目标生物（可连续点选多目标威能）。
   - **近程爆发/冲击 / 区域爆发**：点击格子确定起始格或区域中心，再点范围内目标（或多个）。
3. 弹出 `AttackDialog`：
   - **每个目标独立掷 d20** 攻击骰 + 可选情境调整值（战斗优势、掩护、隐蔽…）。
   - 近战/远程：各目标独立掷伤害骰；近程/区域：**共享一次伤害骰**，重击目标取最大。
   - 强制目标（「每个/所有/全部」或区域内无数量词）锁定不可取消；其余可勾选排除。
   - 效果型威能（`attack === null`）尊重勾选目标逐目标记录效果文本。
4. 确认后 `App` 应用伤害、自动处理重伤/濒死，并写入战斗日志。

### 6.4 先攻与回合

- 「掷先手」：所有参战者掷 `d20 + init` 排序（同值比 init），顶栏显示回合圆点，高亮当前行动者。
- 「下一回合」：轮转到下一位并记日志。

### 6.5 保存 / 读取 / 导出

- **保存遭遇**：导出 `.enc.json`（version 1：地图尺寸、障碍、困难地形、参战者、先攻）。「读取遭遇」还原。
- **导出页**：打包遭遇记录 + 怪物队伍 + 界面设置为一个 JSON。

## 7. 数据与构建

### 7.1 数据来源与预处理

| 产物 | 来源 | 脚本 |
| --- | --- | --- |
| `public/data/creature.json / class.json / race.json` | 车卡器 `4E-NEXT/out/categories` | `scripts/copy-data.mjs` |
| `public/data/rules/index.json` | 《万律书》HTML（4e Rules Compendium — 万律书.html） | `scripts/build-rules.mjs` |

> `build-rules.mjs` 读取项目上级目录的万律书 HTML，按 h1–h6/p 分节、剥离实体生成纯文本索引，供前端全文速查；「规则」页若加载失败会提示需要先 `npm run build`。

### 7.2 构建注意事项（Windows 非 ASCII 路径）

本机 Node 25 遇到含 `【4】` 这类非 ASCII 路径时，`fs.rm`/`cpSync` 会原生崩溃（0xC0000409），故：

- `copy-data.mjs` 用 `readFileSync` + `writeFileSync` 替代 `cpSync`。
- `clean-dist.mjs` 在 `vite build` 前用 PowerShell `Remove-Item` 先清空 `dist`。

`build` 脚本顺序：`copy-data → build-rules → clean-dist → tsc --noEmit → vite build`。

## 8. 关键设计约定（迭代中沉淀）

- 路径校验须检查大型棋子**整个** `size×size` 占地，而非仅左上角；并返回含步骤号的详细错误原因。
- 路径锚点只影响**相邻段**，拖动单个锚点重算「起点→锚点→终点」两段，防止「织网」。
- 拖拽与点击移动方式共存不冲突；用 `e.currentTarget`（而非 `e.target`）捕获指针，避免点中文字引发拖拽失效。
- 近程爆发/冲击以**使用者整个空间**为起始格（大型生物更大），且不影响创造者；大型生物可点自身任一占用格切换起始格（黄色高亮）。
- 攻击可攻击**同阵营目标**，但**禁止自我攻击**（`selected.cid !== occupant.cid`）。
- 目标词条校验：须满足威能目标定义、在射程/效果区域内、对起始格有效果线；「两个生物」须恰好选 2 个。
- 瞄准时的**判定点**（悬停格）以整格青色半透明块高亮，压过爆发范围格。
- `z-index` 固定层级：路径锚点(30) > 确认/取消按钮(20) > 地图元素。
- 死亡/重伤状态由 HP 自动推导；临时 HP 先于生命扣除；回复力/HP 均 `Math.floor` 取整避免小数。

## 9. 常见问题

- **规则页提示数据加载失败**：运行 `npm run build` 生成 `public/data/rules/index.json`。
- **构建时报「未找到车卡器管线产物」**：先到 `4E-NEXT` 目录运行其数据管线，再重新 `npm run build`。
- **移动确认无响应 / 显示「路径不合法」**：多为困难地形超移动力、落点被占位/封闭，或定身/束缚状态。