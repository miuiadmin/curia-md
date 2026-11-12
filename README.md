# Curia MD

> Curia 2.5 — 可移植的文档管理方案：两根布局、10 类文档、3 行头块、`docs/` 标准的版本与取代链、零依赖检查器与脚手架，外加只读的健康诊断与 docs 标准升格提示；人和 AI agent 按同一套规则读写。

**简体中文** | [English](./README.en.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node ≥ 18](https://img.shields.io/badge/Node-%E2%89%A518-5FA04E.svg)](https://nodejs.org/)
[![Dependencies: 0](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](./package.json)

**目录**：[是什么](#是什么) · [适合谁](#适合谁) · [核心设计](#核心设计) · [装上去](#装上去) · [跑完怎么确认装对了](#跑完怎么确认装对了) · [采用到已有仓库](#采用到已有仓库) · [常见问题](#常见问题) · [维护这个包的人读这里](#维护这个包的人读这里)

> 中文是默认语言，也是维护契约的权威版本；[English](./README.en.md) 为逐节对照翻译，如有歧义以中文为准。

## 是什么

Curia 2.5 是一套可移植的文档管理方案：两根布局——`.agents/` 管过程与过程产物（计划、调研、决策笔记、技能、归档），`docs/` 管外部事实、现行标准与知识；10 类文档各有家与骨架；类型化文档统一带 3 行头块，`docs/` 标准另带 `Version:`；过时的文档翻状态、由取代链解析到现行版本；配 1 支零依赖检查脚本 `check-docs.mjs`（Node ≥ 18，不联网），另带两支只读诊断：`--health` 体检载荷、桥与 `AGENTS.md` 合并态，`--suggest-standards` 列出 `docs/` 里可升格为 `standard` 的候选；两者只提示、不写文件。采用后，文档放哪、长什么样、怎么引用、过时了怎么退役，都有明文，人和 agent 按同一份规则读写。

`create-curia` 是它的本地分发包，也是一个生成器：把载荷复制进你的仓库、建好三条桥符号链接（`CLAUDE.md`、`.claude/skills`、`.codex/skills`——让 Claude Code、Codex 等 CLI 直接读到规则与技能）、打印下一步。它不提问、不装钩子、不运行载荷内任何脚本；一次跑完即 fork-and-own——生成后的文档树归你维护，本包没有 `upgrade` / `check` 驻留子命令。

要不要用，看两条：你想让项目的文档有固定归属、固定格式，且希望人和 agent 按同一套规则帮你写与查——用它；你在找流程引擎、门禁体系、审批流或权限模型——这些不在 Curia 里，规范开篇就写明它不是治理平台、流程引擎或门禁体系。上手成本低：有 Node ≥ 18 就跑生成器；没有也能用——直拷载荷、只采用文本约定（见「备选：直接拷贝」）。

## 适合谁

**适合。**

- 多个会话（人 + Claude Code / Codex 等）同时写文档，开始出现「这份放哪、那份过时没有」的分歧。
- 想让文档结构可机械检查，但不想引入平台、服务、数据库或 CI 依赖。
- 接受 fork-and-own：拿走一份载荷，之后按自己的节奏维护。

**不适合。**

- 需要审批流、权限模型、发布门禁、注册表或流程引擎——Curia 明确不提供这些。
- 想找文档自动生成、迁移工具或批量修复——本包不做。
- 团队还没有任何文档习惯，指望一套目录结构自动解决协作问题。

## 核心设计

### 两根布局，封顶两根

| 根 | 装什么 | 不装什么 |
|---|---|---|
| `.agents/` | 过程与过程产物：计划、调研、决策笔记、技能、归档。 | 外部事实登记、跨模块/对外的现行标准与契约、面向最终读者的发布内容。 |
| `docs/` | 结果性知识与契约：仓外系统的登记与定义（资源 ID、字段映射、端点、协议）；自由知识无头块、当前版即唯一真相；现行标准用 `Type: standard`，带轻量状态机与 `Version`。 | 计划与提案、决策因果、原始事实快照、过程性技能与操作手册。 |

受管面封顶这两根，不再设第三根；项目可以只启用其中一根。

### 四句口诀

1. 没做的 → `plans/`（proposal / spec / plan）
2. 做完的 → `research/`（survey / evidence / postmortem / reference）
3. 为什么 → `notes/`（决策因果，永远不进 research）
4. 过时的 → 状态翻转优先，冷历史进 `archive/` 封存；**永不删除**

补：可复用的干法 → `skills/`（skill / runbook）；外部事实与现行标准 → 根 `docs/`——自由知识无头块，现行标准写 `Type: standard` 并带 `Version:`。模块的总体设计仍固定为 `plans/<模块>/design.md`。

### 10 类文档

| Type | 家 | 是什么 | 建议节 |
|---|---|---|---|
| `proposal` | `plans/` | 立项前对齐：为什么值得做、做成什么样算成功、有哪些候选路线。 | 背景、目标、成功判据、方案选项 |
| `spec` | `plans/` | 长期契约：做成什么样——字段、接口、验收标准；`done` 不是退役。 | 背景、范围、契约、验收标准、适用边界 |
| `plan` | `plans/` | 分几步做、做到哪了；`active` 时「未完成事项」是唯一活跃清单。 | 背景、步骤、未完成事项 |
| `survey` | `research/` | 一次性调研：问题、方法、结论与适用边界。 | 问题、方法与来源、结论、证据与出处、适用边界 |
| `evidence` | `research/` | 原始事实快照：什么时候、用什么命令、看到了什么。 | 采集内容、采集方式、适用边界 |
| `postmortem` | `research/` | 事故复盘：时间线、因果链、影响、预防与行动项。 | 事故概述、时间线、影响、因果链、预防、行动项 |
| `reference` | `research/` | 长期事实参考：持续维护的映射与导览。 | 事实映射、方法与来源、维护方式、适用边界 |
| `runbook` | `skills/` | 人向操作手册：前置条件、步骤、每步验证、失败恢复。 | 前置条件、步骤、验证、失败与恢复 |
| `skill` | `skills/` | Agent 按需加载的工作流：frontmatter 加步骤加边界。 | 步骤、边界 |
| `standard` | `docs/` | 现行标准与契约：设计规范、UI 设计系统、API/数据契约、编码约定、写作与排版约定；需要「现行第几版」的文档。 | 背景、适用范围、契约、版本与兼容、适用边界 |

「建议节」是骨架默认，不是机器配额；检查脚本不查节的完整性。类型表是上界不是配额——短文档为主的项目可以删减类型与建议节。

### 3 行头块

类型化文档（`plans/`、`research/`、`skills/` 家内的 Markdown，以及 `docs/` 下带 `Type: standard` 的标准）统一带固定三行，顺序不可换：

```markdown
# <标题>

Type: <10 类之一>
Status: <该类型允许值>
Updated: yyyy-mm-dd
```

`standard` 在三行之后再加 `Version: MAJOR.MINOR.PATCH`。`Status: superseded` 必须带 `Superseded-by: <相对链接>`；归档件必须带 `Archived: yyyy-mm-dd`。笔记用两行头块（标题加 `Status:`），`docs/` 自由知识无头块。完整规则见载荷内 [`.agents/README.md`](./template/.agents/README.md)。

### 过时与取代

文档过时了不删，翻状态——`superseded`。但状态翻转只说明「旧的不算数」，它不说「新的在哪」；所以本方案把取代做成一条**必须能走到底的链**。

- 旧文档带 `Superseded-by: <相对链接>`；取代者不回写反向字段，反向索引现算（规范「链接与检索」第 6 条）。
- 链可多跳，但必须终结在一份**类型化、现行态、未归档**的文档上。成环、指向笔记或 `docs/` 自由知识（无 `Type`/`Status`，链在那里不可判）、指向归档件、终点已退役——都算错，检查器报出来。
- **一主题一现行承载点**：新的全局指导只有两种落法——原地改这份（`spec` 与 `standard` 的做法，历史在 git），或新开一份并由它取代旧的。两份都留着、都声称是规范，属违规；这条靠评审，机器判不出「两份是不是同一主题」。它跨两根生效：`.agents/plans/<模块>/design.md` 与 `docs/<主题>.md` 不能同时声称是同一主题的现行承载点。
- 过程产物（计划、提案、决策因果、调研）不进 `docs/`；现行标准进 `docs/`，但必须带 `Type: standard`、`Status:` 与 `Version:`——这样它才进得了取代链。`docs/` 自由知识仍无头块、无状态机。
- 读的人只做一件事：**命中先看状态**，`superseded` 就沿链走到终点再读。`plans/`、`skills/` 与 `docs/` 下 `current` 的标准链到被取代的文档会被报出来；`research/` 是某时点的快照，引用旧文不判。

一句话：旧文档留着不是问题，留着却解析不到现行版本才是问题。

### 模块设计文档

一个模块要有一份总体设计；知道模块名，就该能一步找到它，并看出版本。这件事用**固定路径加固定字段**做，不建注册表、不建索引文件：

- 位置是 `.agents/plans/<模块>/design.md`：目录名即模块标识，**kebab-case 或纯中文名都行**（`plans/chat-bridge/`、`plans/聊天桥接/` 同效），`design.md` 是固定名（和 `skills/<技能>/SKILL.md` 同族），所以免日期前缀。
- 标题里必须出现模块标识，人话名随意——`# chat-bridge（聊天桥接）总体设计`、`# 聊天桥接（chat-bridge）总体设计` 都合法。路径承担稳定身份，标题承担可读的名字。
- 头块带 `Version: MAJOR.MINOR.PATCH`，是**这份设计自己的版本**：MAJOR 是契约不兼容的变更，MINOR 是兼容新增，PATCH 是澄清改字。它与包版本、与取代链各管一件事——取代链说「哪份是现行」，`Version` 说「这份自己演进到哪」。
- 默认原地改、`Version` 递增、历史在 git；只有模块被拆分、改名或整体重做，才新建一份并让旧的翻 `superseded`。
- 发现靠目录：`ls .agents/plans/*/design.md` 就是全部模块，`rg -n '^Version:' .agents/plans/*/design.md` 一次列出版本。**不建 `INDEX.md`**——索引会和现实漂移，路径不会。

### docs 标准

跨模块、全项目共同遵守的设计标准（UI 设计系统、API/数据契约、编码约定、写作与排版约定）住 `docs/`，类型是 `standard`。它需要回答「现行第几版」，所以头块带 `Version:`（与模块设计文档同族）：

```markdown
# <主题>（v<MAJOR.MINOR>）

Type: standard
Status: current
Updated: yyyy-mm-dd
Version: 1.2.0
```

- 位置是 `docs/<主题>.md`；主题段 kebab-case 或纯中文名。文件名可带版本（如 `docs/设计规范v1.2.md`），但头块 `Version:` 是权威；文件名版本必须是头块版本的前缀（`v1.2` 对 `1.2.0`）。
- `Version` 语义与模块设计文档一致：MAJOR 不兼容、MINOR 兼容新增、PATCH 澄清改字。
- `Status` 取 `current`（现行）、`historical`（仅保留给存量或参考）、`superseded`（被取代，必须带 `Superseded-by:`）。`docs/` 不放 `draft`——未定稿的标准走 `.agents/plans/`。
- 默认原地改、`Version` 递增、历史在 git；大版本线必须共存或主题被重做时，才新建一份并让旧的翻 `superseded` 或 `historical`。
- 与模块设计的分工：单模块总体设计住 `.agents/plans/<模块>/design.md`；跨模块、全项目、对外标准住 `docs/`。同一主题只有一个现行承载点；两者互相链接，不复制正文。
- 发现靠目录：`rg -l '^Type: standard$' docs/` 列出全部标准，`rg -n '^(Type|Status|Version|Updated):' docs/` 看它们的头块；不建 `INDEX.md`。
- `docs/` 自由知识没有 `Type:`，不参与状态机；当前文件即真相，改了直接改。
- 把已有文档升格为 `standard`：先跑 `node .agents/tools/check-docs.mjs --suggest-standards`——它只读列出候选（文件名像标准，或前 20 行有 `Updated:`/`Verified:`/`Version:` 线索）并打印建议头块；由人确认后手工补 `Type: standard`、`Status:`、`Updated:`、`Version:`，检查器不自动改写任何文件。升格不改变「一主题一现行承载点」：同一主题仍只能有一份现行标准。

### 检查器

```bash
node .agents/tools/check-docs.mjs                      # 报告模式：列发现，不失败
node .agents/tools/check-docs.mjs --strict             # 严格模式：任一发现即失败
node .agents/tools/check-docs.mjs --health             # 只读体检：载荷、桥、AGENTS.md 合并态与 docs 覆盖
node .agents/tools/check-docs.mjs --suggest-standards  # 只读提示：列出 docs 标准候选与建议头块
```

只查机械子集：编码、头块与生命周期（含 `docs/` 标准的 `Version:` 与文件名版本一致性、取代链是否走到现行版本、模块设计文档的 `Version:`）、家与命名、相对链接（含现行文档是否还在引用被取代的文档）。零依赖、不联网、不执行文档内代码。**检查通过不等于文档合规**——节的完整性、事实真假、结论质量、时效新鲜度都不在机器判定面。

两支诊断只读、不写文件：`--health` 按项打印载荷是否齐全（推荐项缺失也会点名；体检清单是 14 项实质载荷，7 个 `.gitkeep` 占位不在其中）、三条桥的状态（`symlink-ok` / `symlink-broken` / `symlink-other` / `real-file-pointer` / `missing` 等）、`AGENTS.md` 是否已合并三节，以及 docs 标准与候选计数；`--suggest-standards` 列出候选文件、候选理由与建议头块，供人确认后手工补。正常情形两者一律退出 `0`，`--strict` 对它们无效——**它们是诊断不是门禁**，缺项只报告、不失败；只有根锚点缺失、内部错误或用法错误（诊断不接受路径参数）才返回 `2`。两者可同时使用（先 health 后 suggest）；检查器搬出 `.agents/tools/` 时 health 仍算载荷齐全并注明运行位置。

报告模式的汇总行在告警大于 0 时附带分组计数：`检查 N 篇 / 告警 M 条（组 0 …、组 1 …、组 2 …、组 3 …）`；告警为 0 时仍只输出 `检查 N 篇 / 告警 0 条`。

### 三条桥

生成器会建三条符号链接，让不同 CLI 读到同一份规则与技能：

| 桥 | 指向 | 谁读 |
|---|---|---|
| `CLAUDE.md` | `AGENTS.md` | Claude Code |
| `.claude/skills` | `../.agents/skills` | Claude Code |
| `.codex/skills` | `../.agents/skills` | Codex |

桥是指针，不藏内容；改规则只改 `AGENTS.md` 与 `.agents/`。

## 装上去

包里内容很少：`bin/init.mjs`（生成器）、`template/`（载荷，21 个文件加 3 条桥符号链接）、`guide/`（设计由来与研究导读，纯文本；**不给采用方看**，见「维护这个包的人读这里」）、[ADOPTION.md](./ADOPTION.md)（采用手册：初次引用、迁移存量文档树、升级、卸载，给动手的 agent 读）、[README.md](./README.md)、[README.en.md](./README.en.md)、[package.json](./package.json)、[LICENSE](./LICENSE)——整个目录自足，拷到你机器上任意位置即可用，不需要网络与任何外部件。

前置只有一条：Node ≥ 18。用法如下（`<包路径>` 指包目录在你机器上的路径）：

```bash
node <包路径>/bin/init.mjs --dir <目标仓路径>
```

不指定 `--dir` 时，目标是当前工作目录——也可以先 `cd` 进目标仓，再运行包内入口。参数只有三个：

- `--dir <path>` — 目标目录。
- `--defaults` — 兼容保留：init 无提问，等价默认行为。
- `-h, --help` — 帮助与退出码。

一次运行做三件事：复制 21 个载荷文件（检查脚本 `check-docs.mjs` 与 7 个 `.gitkeep` 占位都在这 21 件之内）、按需创建三条桥符号链接、打印「下一步」。既有文件一律不覆盖——被保留的、被占用的都会在输出里写明，见「采用到已有仓库」。

### 装完后目标仓长什么样

```text
<目标仓>/
├── AGENTS.md               # Curia 通用规则集（9 条）
├── CLAUDE.md               # -> AGENTS.md（桥）
├── .agents/
│   ├── README.md           # 规范全文（唯一权威，骨架文本在内）
│   ├── GLOSSARY.md         # 术语种子
│   ├── notes/AGENTS.md     # 笔记树入口（agent 原生读取）
│   ├── tools/check-docs.mjs
│   ├── plans/ research/ notes/ archive/   # 计划 / 调研 / 笔记 / 归档（各带 README 与 .gitkeep 占位）
│   └── skills/             # write-doc / write-note / prose-standard
├── .claude/skills          # -> ../.agents/skills（桥）
├── .codex/skills           # -> ../.agents/skills（桥）
└── docs/README.md          # 外部事实、现行标准与知识的根约定（按需启用，见文件内说明）
```

这就是全部新增：21 个文件加 3 条桥。宿主已有同名文件时，那几件保持原样、不在此列。

### 备选：直接拷贝（没有 Node ≥ 18 时）

不跑生成器、把载荷原样拷过去也可以。源一定写 `template/.`——末尾的 `/.` 让 `cp` 连点目录一起拷；整目录拷进空仓即为可用工作区（21 个文件加 3 条桥链接）：

```bash
cp -an template/. <目标仓>/
```

`cp -R template/*` 会静默漏掉 `.agents/`、`.claude/`、`.codex/` 三个点目录——退出码 0、不报错，落出一个没有框架的树；不要用这种写法。**`cp -R`（不带 `-n`）还会覆盖宿主的同名文件**——包括未提交的改动与未跟踪的文件，那些字节在 git 历史里也找不回来。**直拷一律带 `-n`**，且拷之前先 `git status` 确认没有未提交内容。

直拷的短处是不报告跳过了什么：目标已有同名文件时 `cp -an` 静默跳过（实测 macOS 的 BSD cp 以退出码 1 结束、stderr 为空），三条桥可能静默缺失——所以直拷后不能只看退出码，务必按「跑完怎么确认装对了」把三条桥数一遍。目标仓已有自己的 `AGENTS.md`、`CLAUDE.md` 或 `.claude/skills` 时，优先用 `init`：它会逐条报告哪条桥没接上。

另外，直拷只对源码树形态成立：`npm pack` 出的 tarball 载荷里没有 3 条桥符号链接，拿到 tarball 就一律走 `init`（见「分发边界」）。

## 跑完怎么确认装对了

第一看退出码与汇总行。空仓上汇总行应当是：

```text
完成：目标 <路径> — 新建 21、已一致 0、保留 0；桥 3 条：新建 3、已就位 0、未接上 0
```

退出码：

| 退出码 | 含义 |
|---|---|
| `0` | 载荷落地且三条桥全部接上 |
| `1` | 复制失败——I/O 出错、落点解析到目标仓之外（`.agents/`、`docs/` 之类被预先做成指向仓外的符号链接）、或**落点在另一个 git 仓里**（`.agents/` 是子模块或嵌套克隆） |
| `2` | 用法与守卫（参数写错、目标落在包内、Node 版本不足等） |
| `3` | 桥未接上——写操作完成但机制没接上 |

**判据是退出码 `0` 与「未接上 0」这两项**；汇总行里的「新建 / 已一致 / 保留」随宿主形状变（有主仓上「新建」不会是 21、「保留」不会是 0），别拿它们逐字对。

把 `init` 接进 CI 时：三条桥路径都空闲时退出码 `0`、流水线照常；宿主已有桥路径被占用时返回 `3`、流水线变红——接入前先按「采用到已有仓库」清障。注意：退出码 `0` 回答的是「没有复制失败、三条桥全部接上」——「保留 N 项」不改变它；宿主原有的 `AGENTS.md` 被保留时，9 条通用规则集并没有装上，见下一节。

第二，核对三条桥都接上了：

```bash
ls -l CLAUDE.md .claude/skills .codex/skills
```

三条都要在，且分别指向 `AGENTS.md`、`../.agents/skills`、`../.agents/skills`。**光看 `readlink` 不够——要打开它**：`ls .claude/skills` 应能列出 `write-doc`、`write-note`、`prose-standard` 三个技能目录。字符串对而打不开是可能的——父级目录（如 `.claude`）本身是指向仓外的符号链接时，链接会被建到仓外、按落点解析后悬空。`init` 现在按「**真解析得到、且落在目标仓内**」判定，所以它报「未接上」就是真没接上；这种形态下它也不会在仓外写任何东西。

第三，跑一次自检（在目标仓根）：

```bash
node .agents/tools/check-docs.mjs --strict
```

退出码 `0` 即通过。**判据是退出码，不是篇数**——纯载荷树输出「检查 12 篇 / 告警 0 条」，你往 `docs/` 放一份自己的文档就变 13 篇，篇数随你的树走。

第四，重跑幂等：对同一目标再跑一次 `init`，退出码应回到 `0` 且「未接上」为 `0`（空仓上是「新建 0、已一致 21、保留 0；桥 3 条：新建 0、已就位 3、未接上 0」；有主仓上数字随保留项变化）——重跑是安全的，已一致的文件会自动跳过。

## 采用到已有仓库

`init` 的原则是不覆盖既有文件——这对安全是好事，但意味着「退出码 `0`」不等于「一切都装上了」，尤其宿主已有自己的 `AGENTS.md` 时：**9 条通用规则根本不会装入**，必须手工并入。

**让 agent 来装、升级或卸载时，把 [ADOPTION.md](./ADOPTION.md) 交给它**——那份覆盖四个场景：初次引用（含三类冲突与三项验收）、迁移存量文档树（只读纳管，不做大迁移）、升级（`--diff` 比对后逐件裁决）、卸载（拆机制、保住你自己的文档）。另有一条命令专门用来取并入片段：

```bash
node <包路径>/bin/init.mjs --print-merge   # 只打印并入宿主 AGENTS.md 的三节原文，不写盘
```

以下是逐种情况的说明，供人查阅。

**宿主已有自己的 `AGENTS.md`（真实宿主最常见）。** `init` 会保留它并列入「已存在且内容不同，未覆盖」，载荷里的 9 条通用规则集不会装入——三条桥照常接上，退出码仍可能是 `0`。规则集需自行并入：把包内 [template/AGENTS.md](template/AGENTS.md) 的「通用规则」「桥」「结构速览」三节一起并进你的 `AGENTS.md`（三节要同批并——「下一步」里让你补的项目名占位在「结构速览」里，只并「通用规则」会把那条指引指空）。核对一条就够：在你的 `AGENTS.md` 里搜「一事实一归属」（规则第 1 条）——搜不到就是没装上。并入之后，「已存在且内容不同，未覆盖」这条清单**每次重跑都会照旧出现**，属预期，不是没生效。

**宿主已有 `CLAUDE.md`（真文件，不是桥链接）。** 桥建不上，`init` 会逐条警告并具名列出，汇总退出码 `3`。做法：把它备份移走、内容并入 `AGENTS.md`，重跑 `init`（已一致的文件自动跳过）。桥的语义是 `CLAUDE.md` 成为 `AGENTS.md` 的指针——指针不藏内容。

**宿主已有 `.claude/skills` 目录（或指向别处的链接）。** 同样退出码 `3`。做法：把其中有用的技能内容迁入 `.agents/skills/`，备份移走占用路径，重跑 `init`。`init` 打印的手工命令形如 `mv <路径> <路径>.pre-curia && ln -s <目标> <路径>`，可直接照抄（先备份再建链，两条一起跑）。**不要自己写裸的 `ln -s <目标> <路径>`**：路径已是目录时，它会在目录里建出一个同名子链接、退出码 `0`，桥却没接上——静默假成功。

**宿主根上 `.claude` 或 `.codex` 本身是指向仓外的符号链接**（dotfiles 共享配置的常见形态）。这时相对目标 `../.agents/skills` 会按落点解析到仓外、必然悬空，`init` 直接判「未接上」并说明父级解析到了哪里，**不在仓外写任何东西**。要接上得先决定那个符号链接的去留（删掉换真目录，或换一种暴露方式）。这是本包早期版本的又一个静默假成功：桥被建到仓外、`readlink` 字符串逐字正确、退出码 `0`、自检全绿，而桥是死的且根本不在仓里。

**宿主已有 `docs/README.md`。** 影响最小：它是 `docs/` 的根约定（外部事实、现行标准与知识），该目录按需启用、不启用也不影响 `.agents/` 完整使用——并入与否都不挡路。

**备份放哪。** 没有约定：挑一个仓外位置（如 `~/.curia-backup-<日期>/`）或仓内已被忽略的目录。`init` 不管备份，也不删你的任何东西——`mv` 那一步是你自己执行的。

**宿主把 `.agents/` 或 `docs/` 预先做成了指向仓外的符号链接。** 载荷会整份写到仓外、git 完全看不见——本包早期版本在这里报「完成」、退出码 `0`。现在落点按「上溯到最近的存在祖先再真解析」判定，落在仓外一律拦下、逐件具名、退出码 `1`，**一个字节都不写到仓外**（嵌套形态如 `.agents/plans/` 指向仓外同样拦）。修法同样是先决定那些符号链接的去留，再重跑。

**宿主把 `.agents/` 做成了 git 子模块（或嵌套克隆）。** 载荷会整份写进**那个仓的工作树**，宿主仓 git 永远追不到它（`git add -A` 只登记子模块指针）——而 `init` 会报「完成」。落点判据现已扩到 git 边界：落点在另一个 git 仓里一律拦下、逐件具名、退出码 `1`。做法：先决定 `.agents` 是留作子模块还是换成普通目录。

**没有 Node ≥ 18 又有占用路径。** 这一组合最麻烦：直拷不报告冲突、`init` 要 Node。出路是手工挑拣——把 `template/` 下的载荷件逐件比对后拷进去，再手工补三条桥 `ln -s`。

**从 2.2 升到 2.3。** 2.3 只收紧一件事：`Superseded-by:` 必须终结在现行态类型化文档上（2.2 只要求这一行存在）。先量再改：`rg --hidden -l '^Superseded-by:' .agents/ | wc -l`——输出 `0`（载荷树就是 `0`）则本次升级对它零影响，直接换检查器；大于 `0` 就逐条看告警，修法只有三种：把指针改指链终点、把终点落成一份 `spec`（原先指向笔记或 `docs/` 页的情形）、或把旧文按归档四步归档。三种都不必动旧文正文。存量树仍按「规则不回溯」处理，新判据不设清理期限。

**从 2.3 升到 2.4。** 2.4 新增第 10 类 `standard`：`docs/` 的现行设计标准可带 `Type: standard`、`Status:`、`Version:`，进入取代链；`docs/` 自由知识与 `.agents/` 既有文档都不受影响。先量再改：`rg -l '^Type: standard$' .agents/ docs/ 2>/dev/null | wc -l`——旧树应为 `0`，本次升级对它零影响；已有的 `docs/设计规范v1.2.md` 可以原样保留为自由知识，下次实质修改时再补头块。检查器同时支持只有 `docs/` 的仓（docs-only 模式）；`init` 载荷仍是 21 件，无迁移。

**从 2.4.0 升到 2.4.1。** 2.4.1 修检查器两处判据一致性：`CURRENT.proposal` 纳入 `draft`（规范一直写 proposal/plan 的 `draft`/`active`）；组 3 的「现行版本是 X」只认类型化、现行态、未归档的终点，不再把 `done`/`historical` 叫现行。无迁移，换检查器即可；载荷仍是 21 件。

**从 2.4.1 升到 2.5。** 2.5 只动检查器、docs 标准口径与相应说明文字：新增 `--health` 与 `--suggest-standards` 两支只读诊断，默认汇总行在告警大于 0 时补分组计数；文档模型不变，载荷仍是 21 件、3 条桥不变，无文档迁移——规范与载荷里的措辞更新由 `--diff` 列为「上游已变」，逐件裁决。把新版 `template/.agents/tools/check-docs.mjs` 换进目标仓后，在仓根跑 `node .agents/tools/check-docs.mjs --health` 看载荷与桥的现状，再跑 `--suggest-standards` 看哪些存量 `docs/` 文件可升格为 `standard`——按提示人工裁决，不自动改写。

**宿主已有存量文档树要纳入 Curia。** 纳入纪律（登记根、规则不回溯、闸门只挂默认面等六条）见规范「存量树只读纳管」节（目标仓 `.agents/README.md`，包内 [template/.agents/README.md](template/.agents/README.md)）；本包不提供迁移工具与批量修复。

处理完任何一项，都用「跑完怎么确认装对了」的桥核对与自检收尾。

## 常见问题

**它是运行时或平台吗？** 不是。没有服务、数据库、网络调用、权限模型或审批流；检查器只做静态自检。

**会覆盖我已有的文件吗？** 不会。已有且内容不同的文件一律保留并列出；桥被占用时打印手工命令后跳过。

**没有 Node ≥ 18 能用吗？** 能。直拷 `template/.` 并手工补三条桥，或只采用文本约定、不跑检查器。

**10 类文档必须全用吗？** 不必。类型表是上界不是配额；可以删减类型与建议节，只保留你实际会写的。

**设计规范放哪？** 跨模块、全项目、需要「现行第几版」的设计标准放 `docs/<主题>.md`，带 `Type: standard`、`Version:` 与 `Status:`；单模块的总体设计仍放 `.agents/plans/<模块>/design.md`；还没定稿的标准走 `.agents/plans/` 的 proposal/spec。`docs/` 自由知识（外部事实、使用说明）仍无头块。

**怎么把已有设计规范升成 `standard`？** 先跑 `node .agents/tools/check-docs.mjs --suggest-standards`：它按文件名关键词与头块线索列出候选，并打印建议头块。确认后由人手工补 `Type: standard`、`Status:`、`Updated:`、`Version:`——检查器**不自动改写**任何文件；升格后仍受「一主题一现行承载点」约束。

**怎么检查桥和载荷？** 在仓根跑 `node .agents/tools/check-docs.mjs --health`：它打印载荷 x/14（缺项按必需/推荐具名）、三条桥的状态（如 `symlink-ok`、`real-file-pointer`、`symlink-broken`、`missing`）、`AGENTS.md` 的合并态与 docs 覆盖。退出码 `0` 是常态——它是诊断，不是门禁；只有根锚点缺失、内部错误或用法错误（带路径参数）才返回 `2`。

**本地改了 checker 怎么升级？** 升级前记下基线：所用 `create-curia` 版本与官方检查器的 sha256（`--health` 会打印本地检查器的 sha256 前 8 位，可与官方值比对）。本地改动集中放在一个带显眼标记的补丁块里，升级时先取新版原件、再把补丁块重新贴上——**不要**用新版整份覆盖你的改动，也不要让改动无标记地散落在文件中。

**strict 积压怎么处理？** 先跑报告模式看全貌：汇总行会给出组 0 到组 3 的计数。修复顺序是先组 1（头块与生命周期）、组 2（家与命名），再组 3（相对链接）；存量树按「规则不回溯」处理。`--strict` 只适合在你决定把它当闸门时启用——**是不是门禁归项目自己定**，Curia 不强制。

**生成后还能升级吗？** 能，但没有 `upgrade` 子命令（fork-and-own）。升级是「比对 + 重跑」：`node <新版本包路径>/bin/init.mjs --diff --dir <你的仓>` 只读列出「未安装 / 已一致 / 上游已变 / 本地独有」四类，你逐件裁决后重跑 `init` 补齐新增件——它永不覆盖你的改动。完整步骤与卸载见 [ADOPTION.md](./ADOPTION.md)。

**能用在 monorepo 吗？** 能。工作区根放在你希望管理的目录；默认扫描该根的 `.agents/` 与 `docs/`，其他根用显式路径巡检。

**检查器会改我的文件吗？** 不会。只报不改，没有 `--fix`，从不写回文件。

## 维护这个包的人读这里

采用方读到这里就够了；以下各节讲这个包自身的契约、发布与验收。

本仓是 Curia 的母仓，独立于任何采用方发展。设计史料语料库不随本仓发布——[`guide/`](./guide/README.md) 里的出处是标识符，不是可解析的仓内路径；读不到的条目按「不可复核」处理。

**这个包为什么是现在这样**——设计由来、什么试过不行、新机制怎么裁决——见同目录的 [`guide/`](./guide/README.md)——**设计由来与研究导读**，五章、纯文本、零脚本。它**不给采用方看**；接手本包或要研究 Curia 演进的人读它。

### 红线

- **生成器，不是运行时**：`init` 只复制载荷、建桥与打印下一步——不提问、不装钩子、不运行载荷内任何脚本；生成物不 `import` 本包任何模块。
- **零依赖**：本包 `dependencies` 为空，只用 Node 内置模块（Node ≥ 18）；载荷脚本同样零依赖、不联网。
- **fork-and-own**：生成后目标仓与本包再无关系；没有 `upgrade` / `check` 驻留子命令，同步靠重开 init 到新目录 diff，或 git cherry-pick。
- **不覆盖**：目标已存在且内容不同的文件一律保留并列出；桥被占用时打印「先备份移走、再 `ln -s`」的手工命令后跳过。

### 版本纪律

**版本号只有一个，写在 [package.json](package.json) 的 `version`**，格式 `MAJOR.MINOR.PATCH`，三段各管一件事：

- `MAJOR.MINOR` 是机制代号，与规范题头「Curia 2.5」逐字一致——只有机制级变更（如 2.3 → 2.4、2.4 → 2.5）才动它。
- `PATCH` 是制品字节差异：**包内任何文件的改动**都同批跳一位，使「`create-curia@<版本>`」唯一对应一份字节。判据是**制品**不是载荷：只改本 README 也要跳号，因为 tarball 的字节变了。

`guide/` 不单独编号，跟着这同一个版本走。此前用过另一套编号（`0.3.x`）记同一批制品，2.3.0 起与机制代号对齐——旧号只出现在历史叙述里。

发布制品时记下 `shasum -a 512`，采用方记一行「采用 `create-curia@2.5.0`，sha512-…」即获得可复核的身份。发布前另跑一次核对（`npm pack` 丢符号链接是预期行为，不是错误）：

```bash
npm pack --pack-destination <tmp>
tar -xzf <tmp>/create-curia-<版本>.tgz -C <tmp>
diff -rq <tmp>/package/template template    # 预期差异恰为 3 条桥（CLAUDE.md、.claude/skills、.codex/skills）
```

### 验收（维护方）

以下判据逐条可跑，验收对象是载荷自身，不构成采用方义务；`check-docs` 指载荷内 `.agents/tools/check-docs.mjs`。

1. **空集断言**：`mkdir -p /tmp/empty-docs && node .agents/tools/check-docs.mjs --strict /tmp/empty-docs` → 输出「未检查任何文件」，退出码 2。
2. **正例**：在载荷树（`template/`）或载荷生成的仓库里、于该树根下跑 `node .agents/tools/check-docs.mjs --strict` → 退出码 0。
3. **根锚点断言**：在自身既不含 `.agents/` 也不含 `docs/` 的目录里跑默认调用（如 `cd /tmp && node <路径>/check-docs.mjs`）→ 输出「根锚点缺失」，退出码 2，不静默降级、不向父目录上溯。
4. **零依赖**：`rg -n "from ['\"]|require\(|import\(" template/.agents/tools/check-docs.mjs` → 只应出现 `node:` 前缀的内置模块名。
5. **可移植**：把 `.agents/` 拷进无 git、无 `node_modules` 的临时目录，跑 `node .agents/tools/check-docs.mjs --strict` → 与源目录同一判定。
6. **桥断言**：`init` 到空宿主 → 退出码 0、汇总行「桥 3 条：新建 3、已就位 0、未接上 0」，对同一空宿主重跑 → 「新建 0、已一致 21、保留 0；桥 3 条：新建 0、已就位 3、未接上 0」、退出码 0；`init` 到已有 `CLAUDE.md` 真文件的宿主 → 退出码 3 并具名列出未接上的桥（该宿主重跑仍为退出码 3——占用路径没清障前不会自己变好）。
7. **退出码断言**：`node bin/init.mjs --bogus` → 退出码 2；`node bin/init.mjs --dir <包内路径>` → 退出码 2；`node bin/init.mjs --help` → 退出码 0。
8. **版本纪律目检**（发布前，人工）：`git log -1 --stat` 显示本仓有改动（`template/`、`bin/`、`README.md` 任一），而 `package.json` 的 `version` 未随之跳号 → 制品身份与字节脱钩，不许发布。
9. **桥解析断言**：`init` 到「`.claude` 是指向目标仓之外符号链接」的宿主 → 退出码 3、具名报出「父级目录……解析到目标仓之外」，且**仓外那个目录零写入**（前后 `ls -A` 计数不变）。
10. **结构组假绿断言**：造一棵只有 `.agents/README.md` 与 `.agents/tools/check-docs.mjs`、五个家（`plans/ research/ notes/ skills/ archive/`）一个都没有的树，跑默认调用 → 汇总行带「结构组无判定对象」（是标注，退出码仍按告警数走）。
11. **面外类型化断言**：把一份带 `Type: plan` 三行头块的文档放进 `docs/`、同内容放 `.agents/plans/2026-11-08-plan.md` → 组 2 只报 `docs/` 里那份（「应住 `.agents/plans/`，实际在 `docs/`」），`--strict` 退出码 1；把 `Type: standard` + `Version:` 放 `docs/` → 不报家归属。
12. **落点断言**：宿主把 `.agents/`（或 `docs/`，或嵌套的 `.agents/plans/`）预先做成指向仓外的符号链接 → `init` 退出码 `1`、逐件具名「落点……解析到目标仓之外」，且**仓外那个目录零写入**（前后 `ls -A` 计数不变）。
13. **git 边界断言**：宿主把 `.agents` 做成 git 子模块 → `init` 退出码 `1`、逐件具名「在另一个 git 仓里」，且**子模块工作树零写入**。
14. **取代链断言**：造 `Type: spec` 的 A `superseded` → B `superseded` → C `active`，链路应退出码 `0`；把 C 换成 `Type: proposal`、`Status: draft` → 仍退出码 `0`，换成 `Status: done` → 报「终点不是现行态」、`--strict` 退出码 `1`；再分别造 A→B→A 成环、A→归档件、A→笔记（无 `Type`）、A→`Status: historical` 的 survey 四种反例 → 各自报组 1 告警、`--strict` 退出码 `1`；让一份 `active` 的 plan 链接到 A（终点是 `done` proposal）→ 组 3 报「且取代链未解析到现行版本」，不把 `done` proposal 叫现行版本。
15. **现行引用断言**：`plans/` 里一份 `active` 的 plan 链接到 `superseded` 的 spec → 报组 3 告警并指出其现行版本；同一链接写进 `research/` 的 survey 或 `notes/` 笔记 → 不报。
16. **模块设计文档断言**：造 `.agents/plans/chat-bridge/design.md`（`Type: spec`、`Version: 1.4.2`、标题含 `chat-bridge`）→ 退出码 `0`；分别去掉 `Version:`、把 `Version` 写成 `v1.4`、标题去掉模块标识、`Type` 改成 `reference`、把文件挪到 `.agents/plans/design.md` → 各自报组 1 或组 2 告警、`--strict` 退出码 `1`；同目录再放一份 `roadmap.md` → 仍按日期前缀规则报。
17. **引导断言**：`init` 到「已有自己的 `AGENTS.md`」的宿主 → 「下一步」必须列出「规则没有装上」并给出 `--print-merge` 的取原文命令；`init` 到「已有真实 `CLAUDE.md` 文件」的宿主 → 退出码 `3`，且「下一步」给出「并入 → `mv CLAUDE.md CLAUDE.md.pre-curia` → 重跑」的完整序列；`node bin/init.mjs --print-merge` 输出含 `通用规则`、`桥`、`结构速览` 三节且退出码 `0`，且**不做任何写操作**（运行前后目标仓 `ls -A` 计数不变）。
18. **升级比对断言**：`init --diff --dir <已装好的仓>` → 「未安装 0、已一致 24、上游已变 0」、退出码 `0`；改一件载荷文件后再跑 → 该件进「上游已变」；在 `.agents/plans/` 放一份自己的文档后再跑 → 进「本地独有」且不列进改动；**全过程零写入**（运行前后目标仓 `git status` 输出不变）。
19. **docs 标准断言**：造 `docs/设计规范v1.2.md`（`Type: standard`、`Status: current`、`Updated`、`Version: 1.2.0`）→ docs-only 默认调用退出码 0；分别去掉 `Version:`、写 `Version: v1.2`、把文件名改成 `v1.3` 而头块仍 `1.2.0`、把 `Type` 改成 `plan`、把文件挪到 `.agents/plans/` → 各自报组 1 或组 2、`--strict` 退出码 1；造 `superseded` 标准 → `current` 标准 → 退出码 0；`superseded` → `historical` 标准 → 组 1；`current` 标准链接 `superseded` 文档 → 组 3。
20. **docs-only 断言**：只含 `docs/`（无 `.agents/`）的树默认调用 → 退出码按告警数，stderr 与汇总行带「结构组未执行：仅 docs/ 根」；只有空的 `docs/` → 输出「未检查任何文件」、退出码 2；既无 `.agents/` 也无 `docs/` → 「根锚点缺失」、退出码 2。
21. **健康诊断断言**：`cd template && node .agents/tools/check-docs.mjs --health` → 退出码 `0`，输出「载荷：14/14 齐全」、三条桥均为 `symlink-ok`、「AGENTS.md：merged（规则与三节齐全）」、「docs 标准：0 篇；候选 0 篇」；造一个缺 `GLOSSARY.md`（推荐项）且 `CLAUDE.md` 为真实文件的宿主 → 报「载荷：13/14；缺：.agents/GLOSSARY.md（推荐）」与 `CLAUDE.md=real-file-pointer`，退出码仍 `0`；把 `CLAUDE.md` 指向另一份文件 → `CLAUDE.md=symlink-other`，退出码仍 `0`；只含 `docs/` 的树 → 输出「.agents/ 不存在：跳过载荷、桥与 AGENTS.md 检查」、退出码 `0`；既无 `.agents/` 也无 `docs/` → 「根锚点缺失」、退出码 `2`；`--health --suggest-standards` 同时给出 → 先 health 后 suggest、退出码 `0`；带路径参数 → 用法错误、退出码 `2`。
22. **标准升格提示断言**：造 `docs/设计规范v1.2.md`（只有旧 `Updated:` 行、无 `Type`）→ `--suggest-standards` 列出该文件，候选理由含文件名关键词与 `Updated:`，并给出含 `Type: standard` 的建议头块；同目录放一份已带 `Type: standard` 的文件 → 不列入候选；退出码 `0`；追加 `--strict` 后输出与退出码不变。
23. **汇总分组计数断言**：造只含一个组 1 告警的树（如 `docs/某标准.md` 带 `Type: standard` 而缺 `Version:`）→ 默认汇总行含「组 1 1」（实测「检查 1 篇 / 告警 1 条（组 0 0、组 1 1、组 2 0、组 3 0）」）；干净载荷树（`template/`）→ 只输出「检查 12 篇 / 告警 0 条」，不带分组文字。

### 分发边界

本包**不分发到公共 registry**，分发方式是源码入口、载荷直拷与发布制品（tarball，见「版本纪律」）三条。发布制品以 `curia-v<版本>` tag 与 tarball asset 的形态发布在本仓；首个公开发布的制品是 `curia-v2.3.1`，更早的制品（旧编号 `0.3.x` 与未定稿的 `2.3.0`）属独立开发期，未随本仓公开发布；2.4 的首个制品是 `curia-v2.4.0`，2.4.1 为修复制品；2.5 的制品是 `curia-v2.5.0`。[package.json](package.json) 的 `private: true` 是常设的防误发限制，不是待移除的过渡标记——不要移除它。

`npm pack` 会静默丢弃载荷里的 3 个桥符号链接（源载荷 3 条 → tarball 内 0 条，零 warning）——tarball 采用方一律走 `init`（建桥由桥步完成，不依赖载荷里的链接），或手工补三条 `ln -s`；从 tarball 直拷得到的是零桥工作区。

包名 `create-curia` 在公共 registry 无人占用，而机器默认指向公共源——一旦被抢注，`npm create curia` 会在配置如默认的机器上静默拉取并执行第三方代码。本包因此不宣传 `npm create curia` 这条用法（它在本包不发布的前提下本来也不可用）。`repository` 字段的占位值不影响使用。

## 许可

MIT，见 [LICENSE](./LICENSE)。
