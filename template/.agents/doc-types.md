# 文档类型注册表（投影）

<!-- 生成物：由 scripts/gen-doc-types.mjs 从 .agents/doc-types.json 生成。禁止手改——改注册表后重生成，projection-fresh 检查逐字节比对。 -->

本文件是 [doc-types.json](./doc-types.json) 的可读投影：17 个类型、7 个家。类型系统的机制见 [.agents/README.md](./README.md)；「放哪」由[四句口诀](./README.md)裁决，「是什么」由本文件裁决。

常用命令：`node scripts/new-doc.mjs --type <type> --topic <topic>`（按模板建档）、`node scripts/new-doc.mjs --adopt <path> --type <type>`（给既有文档补头块）、`node scripts/doc-query.mjs`（按需索引）、`node scripts/doc-query.mjs --stale`（时效报告）、`node scripts/run-checks.mjs`（门禁）。

## 家（放哪）

| 家 | 目录 | 装什么 | 一句话判据 | 允许的类型 |
|---|---|---|---|---|
| `plans` | `.agents/plans` | 承诺要做的意图 | 「要做什么？做到哪了？」 | `proposal` `spec` `plan` |
| `research` | `.agents/research` | 已成事实与证据 | 「查到了什么？发生了什么？」 | `survey` `reference` `postmortem` `evidence` |
| `future` | `.agents/future` | 不承诺的方向 | 「以后可能做，先记着」 | `idea` `foundation` |
| `skills` | `.agents/skills` | 可复用的干法 | 「这个活怎么干？」 | `skill` `runbook` |
| `notes` | `.agents/notes` | 决策因果 | 「我们决定了什么？放弃了什么？」 | `note` |
| `archive` | `.agents/archive` | 冻结留档 | 「过时了但保留历史」 | `frozen` |
| `workspace` | `.` | 工作区自身的规格与词汇 | 「这个工作区怎么运转？」 | `readme` `agents-rules` `glossary` `projection` |

## 头块字段

日期型文档的头块顺序固定为 `# 标题` / 空行 / 字段行（按下表顺序，只写该类型允许的）/ 空行 / 正文。

| 字段 | 形态 | 语义 |
|---|---|---|
| `Type` | type-token | 本文件在注册表里的类型键 |
| `Status` | status-token | 生命周期状态，取值受该类型 statuses 约束 |
| `Updated` | date | 最近一次实质改动日（改内容就改它） |
| `Verified` | date | 最近一次按文档执行/复核并观察到预期结果的日子 |
| `Owner` | text | 维护责任人或角色 |
| `Source` | text | 事实来源：仓库内相对链接、URL、系统名 |
| `Note` | link | 指向决策笔记（因果归属在 notes/） |
| `Supersedes` | link | 本文取代了谁 |
| `Superseded-by` | link | 谁取代了本文；Status 为 superseded 时必填 |
| `Archived` | date | 归档日；.agents/archive/ 下的文档必填 |

全局规则：`Status: superseded` 必须带 `Superseded-by` 链接；`.agents/archive/` 下的文档必须带 `Archived` 日期行并被 manifest 封印；必备节确实无内容时只允许写 `_（无）_`；字段值不得残留 `<占位符>`。

## 类型总览

| 类型 | 家 | 命名 | 状态 | 时效 |
|---|---|---|---|---|
| `proposal` | `plans` | `yyyy-mm-dd-<topic>.md` | draft active done superseded | Updated 90d |
| `spec` | `plans` | `yyyy-mm-dd-<topic>.md` | draft active done superseded | Updated 180d |
| `plan` | `plans` | `yyyy-mm-dd-<topic>.md` | draft active done superseded | Updated 60d |
| `survey` | `research` | `yyyy-mm-dd-<topic>.md` | current historical superseded | Updated 365d |
| `reference` | `research` | `yyyy-mm-dd-<topic>.md` | current historical superseded | Verified 120d |
| `postmortem` | `research` | `yyyy-mm-dd-<topic>.md` | current historical | — |
| `evidence` | `research` | `yyyy-mm-dd-<topic>.md` | current historical superseded | Verified 90d |
| `idea` | `future` | `yyyy-mm-dd-<topic>.md` | future superseded | Updated 365d |
| `foundation` | `future` | `yyyy-mm-dd-<topic>.md` | future superseded | Updated 365d |
| `skill` | `skills` | `.agents/skills/*/SKILL.md` | — | — |
| `runbook` | `skills` | `.agents/skills/*/RUNBOOK.md` | current superseded | Verified 180d |
| `readme` | `workspace` | `README.md`、`**/README.md` | — | — |
| `agents-rules` | `workspace` | `AGENTS.md`、`.agents/**/AGENTS.md` | — | — |
| `glossary` | `workspace` | `.agents/GLOSSARY.md` | — | — |
| `projection` | `workspace` | `.agents/doc-types.md` | — | — |
| `note` | `notes` | `{lifecycle}/{class}/yyyy-mm-dd-<topic>.md` | proposed implemented rejected archived | — |
| `frozen` | `archive` | 保留原文件名 | — | — |

## 节键与可接受标题

必备节按键匹配，标题写成下表任一别名即可（尾部括号说明会被忽略）；表外标题算自由节，可插在必备节之间。

| 节键 | 可接受标题 |
|---|---|
| `background` | `## 背景` `## Background` |
| `goal` | `## 目标` `## Goal` `## 目标与非目标` |
| `nongoals` | `## 非目标` `## Non-goals` |
| `success` | `## 成功判据` `## Success criteria` |
| `options` | `## 方案选项` `## Options` `## 备选方案` |
| `scope` | `## 范围` `## Scope` `## 改动面` `## 地基范围` |
| `contract` | `## 契约` `## Contract` `## 接口与数据` `## 规格` |
| `acceptance` | `## 验收标准` `## Acceptance criteria` |
| `steps` | `## 步骤` `## Steps` `## 做法` `## 实施步骤` `## 方案` `## 实施方案` |
| `openitems` | `## 未完成事项` `## Open items` |
| `statuslog` | `## 状态记录` `## Status log` |
| `deps` | `## 依赖与顺序` `## Dependencies` |
| `question` | `## 问题` `## Question` `## 调研问题` `## 背景与问题` |
| `method` | `## 方法与来源` `## Method` `## 来源` `## 方法` `## 样本与来源` |
| `findings` | `## 结论` `## Findings` `## 结论与建议` |
| `evidence` | `## 证据与出处` `## Evidence` `## 证据` |
| `limits` | `## 适用边界` `## Limits` `## 已知局限` `## 未覆盖` |
| `incident` | `## 事故概述` `## Incident` `## 事件概述` |
| `timeline` | `## 时间线` `## Timeline` |
| `impact` | `## 影响` `## Impact` |
| `causes` | `## 因果链` `## Root cause` `## 因果分析` `## 根因` |
| `prevention` | `## 预防` `## Prevention` |
| `actions` | `## 行动项` `## Action items` |
| `snapshot` | `## 采集内容` `## Snapshot` `## 快照内容` |
| `collection` | `## 采集方式` `## Collection` `## 采集命令` |
| `factmap` | `## 事实映射` `## Fact map` `## 事实清单` |
| `maintenance` | `## 维护方式` `## Maintenance` `## 刷新流程` |
| `motivation` | `## 动机` `## Motivation` `## 为什么想要` |
| `trigger` | `## 触发条件` `## Trigger` `## 升级条件` |
| `cost` | `## 成本与收益` `## Cost` `## 成本` |
| `prereq` | `## 前置条件` `## Prerequisites` |
| `recovery` | `## 失败与恢复` `## Recovery` `## 故障排除` |
| `verification` | `## 验证` `## Verification` `## 可观察验证` |
| `related` | `## 相关` `## Related` `## 进一步阅读` |

## 类型详情

### `proposal` — 目标提案

- 家：`plans`（`.agents/plans`）；命名：`yyyy-mm-dd-<topic>.md`；模板：[templates/proposal.md](./templates/proposal.md)
- 状态：`draft` `active` `done` `superseded`；迁移：`draft`→`active` `done` `superseded`；`active`→`done` `superseded`；`done`→`superseded`；`superseded`→终态
- 必备节（按序）：背景 → 目标 → 非目标 → 成功判据 → 方案选项；禁用节：时间线、采集方式
- 字段：必填 `Type` `Status` `Updated`；可选 `Owner` `Note` `Supersedes` `Superseded-by`；禁止 `Verified` `Archived`
- 时效：`Updated` 超 90 天报警（仅 `draft` `active` 时）；文体：非叙事（禁推理记录）
- 装什么：为什么值得做、做成什么样算成功、有哪些候选路线——立项前对齐用。
- 不装什么：步骤与进度（→ plan）、字段级契约（→ spec）、决策因果（→ notes）。
- 晋级去向：`spec`、`plan`

### `spec` — 实施规格

- 家：`plans`（`.agents/plans`）；命名：`yyyy-mm-dd-<topic>.md`；模板：[templates/spec.md](./templates/spec.md)
- 状态：`draft` `active` `done` `superseded`；迁移：`draft`→`active` `done` `superseded`；`active`→`done` `superseded`；`done`→`active` `superseded`；`superseded`→终态
- 必备节（按序）：背景 → 范围 → 契约 → 验收标准 → 适用边界；禁用节：未完成事项、状态记录
- 字段：必填 `Type` `Status` `Updated`；可选 `Owner` `Source` `Note` `Supersedes` `Superseded-by`；禁止 `Verified` `Archived`
- 时效：`Updated` 超 180 天报警（仅 `draft` `active` 时）；文体：非叙事（禁推理记录）
- 装什么：做成什么样：契约、接口、数据结构、验收标准。做完后仍是长期可引用的权威规格，`done` 不是退役。
- 不装什么：分几步做与进度（→ plan）、为什么选这条路线（→ notes）。

### `plan` — 实施计划

- 家：`plans`（`.agents/plans`）；命名：`yyyy-mm-dd-<topic>.md`；模板：[templates/plan.md](./templates/plan.md)
- 状态：`draft` `active` `done` `superseded`；迁移：`draft`→`active` `done` `superseded`；`active`→`done` `superseded`；`done`→`superseded`；`superseded`→终态
- 必备节（按序）：背景 → 目标 → 步骤 → 未完成事项 → 状态记录；禁用节：契约
- 字段：必填 `Type` `Status` `Updated`；可选 `Owner` `Note` `Supersedes` `Superseded-by`；禁止 `Verified` `Archived`
- 时效：`Updated` 超 60 天报警（仅 `active` 时）；文体：非叙事（禁推理记录）
- 装什么：分几步做、做到哪了、还剩什么。`active` 时「未完成事项」是这项工作唯一的活跃清单。
- 不装什么：做成什么样的契约（→ spec）、完成后的事实与回执（→ research/evidence）。

### `survey` — 调研报告

- 家：`research`（`.agents/research`）；命名：`yyyy-mm-dd-<topic>.md`；模板：[templates/survey.md](./templates/survey.md)
- 状态：`current` `historical` `superseded`；迁移：`current`→`historical` `superseded`；`historical`→`superseded`；`superseded`→终态
- 必备节（按序）：问题 → 方法与来源 → 结论 → 适用边界；禁用节：未完成事项、状态记录
- 字段：必填 `Type` `Status` `Updated`；可选 `Verified` `Owner` `Source` `Note` `Supersedes` `Superseded-by`；禁止 `Archived`
- 时效：`Updated` 超 365 天报警；文体：非叙事（禁推理记录）
- 专属检查：`source-traceable`
- 装什么：一次性调研的问题、方法、结论与适用边界——回答「查到了什么」。
- 不装什么：持续维护的当前事实（→ reference）、原始数据（→ evidence）、由调研得出的决策（→ notes）。

### `reference` — 长期事实参考

- 家：`research`（`.agents/research`）；命名：`yyyy-mm-dd-<topic>.md`；模板：[templates/reference.md](./templates/reference.md)
- 状态：`current` `historical` `superseded`；迁移：`current`→`historical` `superseded`；`historical`→`current` `superseded`；`superseded`→终态
- 必备节（按序）：事实映射 → 方法与来源 → 维护方式 → 适用边界；禁用节：未完成事项、状态记录
- 字段：必填 `Type` `Status` `Updated` `Verified`；可选 `Owner` `Source` `Note` `Supersedes` `Superseded-by`；禁止 `Archived`
- 时效：`Verified` 超 120 天报警；文体：非叙事（禁推理记录）
- 专属检查：`source-traceable`
- 装什么：调研与语料导览性质的长期参考，持续维护、按 `Verified` 复核。
- 不装什么：一次性调研结论（→ survey）、原始采集数据（→ evidence）、外部系统运行登记（资源 ID、凭据、端点、字段映射等现值 → 仓库根 `docs/` 外部事实树，类型系统外）。

### `postmortem` — 事故复盘

- 家：`research`（`.agents/research`）；命名：`yyyy-mm-dd-<topic>.md`；模板：[templates/postmortem.md](./templates/postmortem.md)
- 状态：`current` `historical`；迁移：`current`→`historical`；`historical`→终态
- 必备节（按序）：事故概述 → 时间线 → 影响 → 因果链 → 预防 → 行动项；禁用节：契约
- 字段：必填 `Type` `Status` `Updated`；可选 `Owner` `Source` `Note`；禁止 `Verified` `Supersedes` `Superseded-by` `Archived`
- 时效：—；文体：允许叙事
- 装什么：事故的时间线、证据、因果链、影响与预防。`current` = 行动项未全部关闭；`historical` = 已关闭的纯历史记录。
- 不装什么：由事故引出的长期决策（→ notes）、可复用的排查步骤（→ skills/runbook）。

### `evidence` — 证据快照

- 家：`research`（`.agents/research`）；命名：`yyyy-mm-dd-<topic>.md`；模板：[templates/evidence.md](./templates/evidence.md)
- 状态：`current` `historical` `superseded`；迁移：`current`→`historical` `superseded`；`historical`→`superseded`；`superseded`→终态
- 必备节（按序）：采集内容 → 采集方式 → 适用边界；禁用节：结论、方案选项、契约、未完成事项
- 字段：必填 `Type` `Status` `Updated` `Verified` `Source`；可选 `Owner` `Note` `Supersedes` `Superseded-by`；禁止 `Archived`
- 时效：`Verified` 超 90 天报警；文体：非叙事（禁推理记录）
- 装什么：原始事实：清单、命令输出、度量数据、外部语料镜像。只记「什么时候、用什么命令、看到了什么」。
- 不装什么：分析与结论（→ survey）、持续维护的事实映射（→ reference）。

### `idea` — 预研想法

- 家：`future`（`.agents/future`）；命名：`yyyy-mm-dd-<topic>.md`；模板：[templates/idea.md](./templates/idea.md)
- 状态：`future` `superseded`；迁移：`future`→`superseded`；`superseded`→终态
- 必备节（按序）：动机 → 触发条件 → 成本与收益；禁用节：步骤、契约、验收标准、状态记录
- 字段：必填 `Type` `Status` `Updated`；可选 `Owner` `Note` `Superseded-by`；禁止 `Verified` `Archived`
- 时效：`Updated` 超 365 天报警；文体：非叙事（禁推理记录）
- 装什么：不承诺的想法：一句话动机、什么条件下值得做、粗略成本。写在这里不构成派单。
- 不装什么：已承诺的工作（→ plans）、决策因果（→ notes）。
- 晋级去向：`proposal`、`plan`

### `foundation` — 打基础方向

- 家：`future`（`.agents/future`）；命名：`yyyy-mm-dd-<topic>.md`；模板：[templates/foundation.md](./templates/foundation.md)
- 状态：`future` `superseded`；迁移：`future`→`superseded`；`superseded`→终态
- 必备节（按序）：动机 → 范围 → 触发条件 → 成本与收益；禁用节：验收标准、状态记录
- 字段：必填 `Type` `Status` `Updated`；可选 `Owner` `Note` `Superseded-by`；禁止 `Verified` `Archived`
- 时效：`Updated` 超 365 天报警；文体：非叙事（禁推理记录）
- 装什么：现在只铺地基、将来可能长成规格的方向；地基范围要写清，避免把承诺藏进不承诺区。
- 不装什么：已承诺的规格或计划（→ spec、plan）、一次性想法（→ idea）。
- 晋级去向：`spec`、`plan`

### `skill` — 智能体技能

- 家：`skills`（`.agents/skills`）；命名：`.agents/skills/*/SKILL.md`；模板：[templates/skill.md](./templates/skill.md)
- 位置：`.agents/skills/*/SKILL.md`
- 状态：—；迁移：—（无状态机）
- 必备节（按序）：—；禁用节：—
- 字段：必填 —；可选 —；禁止 `Type` `Status` `Updated` `Verified` `Archived`
- 时效：—；文体：非叙事（禁推理记录）
- 专属检查：`skill-frontmatter`
- 装什么：按需加载的智能体工作流：YAML frontmatter（name + description）+ 精简步骤 + 权威来源链接。
- 不装什么：面向人的操作手册（→ runbook）、产品与运行时契约（→ research 或源码）。

### `runbook` — 运维手册

- 家：`skills`（`.agents/skills`）；命名：`.agents/skills/*/RUNBOOK.md`；模板：[templates/runbook.md](./templates/runbook.md)
- 位置：`.agents/skills/*/RUNBOOK.md`
- 状态：`current` `superseded`；迁移：`current`→`superseded`；`superseded`→终态
- 必备节（按序）：前置条件 → 步骤 → 验证 → 失败与恢复；禁用节：方案选项、状态记录
- 字段：必填 `Type` `Status` `Updated` `Verified`；可选 `Owner` `Source` `Note` `Superseded-by`；禁止 `Archived`
- 时效：`Verified` 超 180 天报警；文体：非叙事（禁推理记录）
- 装什么：人向操作手册：前置条件、有序步骤、每步的可观察验证、失败恢复。与同目录 SKILL.md 互为两个视角，步骤只在一处写、另一处链接。
- 不装什么：智能体按需加载的工作流（→ skill）、事故因果（→ postmortem）。

### `readme` — 目录规格页

- 家：`workspace`（`.`）；命名：`README.md`、`**/README.md`；模板：[templates/readme.md](./templates/readme.md)
- 位置：`README.md` `**/README.md`
- 状态：—；迁移：—（无状态机）
- 必备节（按序）：—；禁用节：—
- 字段：必填 —；可选 —；禁止 `Type` `Status` `Updated` `Verified` `Archived`
- 时效：—；文体：非叙事（禁推理记录）
- 装什么：一个目录的规格页：装什么、不装什么、命名与状态、流转纪律。目录即索引，README 即该目录的入口。
- 不装什么：跨目录的总规格（→ .agents/README.md）、决策因果（→ notes）。

### `agents-rules` — 智能体规则

- 家：`workspace`（`.`）；命名：`AGENTS.md`、`.agents/**/AGENTS.md`；模板：[templates/agents-rules.md](./templates/agents-rules.md)
- 位置：`AGENTS.md` `.agents/**/AGENTS.md`
- 状态：—；迁移：—（无状态机）
- 必备节（按序）：—；禁用节：—
- 字段：必填 —；可选 —；禁止 `Type` `Status` `Updated` `Verified` `Archived`
- 时效：—；文体：非叙事（禁推理记录）
- 装什么：常驻指令：每个会话都要在上下文里的硬规则，一条一到三行并链接其归属；子树规则只能追加约束、不得放宽上层。
- 不装什么：故事、完整示例、情境化流程、从归属文档复制来的内容（→ 各自的归属）。

### `glossary` — 术语表

- 家：`workspace`（`.`）；命名：`.agents/GLOSSARY.md`；模板：[templates/glossary.md](./templates/glossary.md)
- 位置：`.agents/GLOSSARY.md`
- 状态：—；迁移：—（无状态机）
- 必备节（按序）：—；禁用节：—
- 字段：必填 —；可选 —；禁止 `Type` `Status` `Updated` `Verified` `Archived`
- 时效：—；文体：非叙事（禁推理记录）
- 专属检查：`glossary-terms`
- 装什么：一概念一词的术语表：每条 `**术语（English）**：定义。_Avoid_: 禁用或易混词`。
- 不装什么：类型定义（→ 注册表与投影文档）、规则（→ AGENTS.md）。

### `projection` — 注册表投影

- 家：`workspace`（`.`）；命名：`.agents/doc-types.md`；模板：—（无模板）
- 位置：`.agents/doc-types.md`
- 状态：—；迁移：—（无状态机）
- 必备节（按序）：—；禁用节：—
- 字段：必填 —；可选 —；禁止 `Type` `Status` `Updated` `Verified` `Archived`
- 时效：—；文体：非叙事（禁推理记录）
- 专属检查：`projection-fresh`
- 装什么：由 scripts/gen-doc-types.mjs 从注册表生成的可读投影，供人与不能读 JSON 的场景使用；禁止手改，改注册表后重生成。
- 不装什么：任何手写内容。

### `note` — 决策笔记

- 家：`notes`（`.agents/notes`）；命名：`{lifecycle}/{class}/yyyy-mm-dd-<topic>.md`；模板：—（无模板）
- 位置：`.agents/notes/proposed/**/*.md` `.agents/notes/implemented/**/*.md` `.agents/notes/rejected/**/*.md` `.agents/notes/archived/**/*.md`
- 状态：`proposed` `implemented` `rejected` `archived`；迁移：`proposed`→`implemented` `rejected`；`implemented`→终态；`rejected`→终态；`archived`→终态
- 必备节（按序）：—；禁用节：—
- 字段：必填 —；可选 —；禁止 —
- 时效：—；文体：非叙事（禁推理记录）
- 归属守卫：[`scripts/check-agent-notes.mjs`](../scripts/check-agent-notes.mjs)（本类型不由类型门禁重复校验）
- 装什么：决策因果：为什么这样做、放弃了什么、后果是什么。路径即身份 `{lifecycle}/{class}/yyyy-mm-dd-topic.md`，class 封闭六类。`implemented` 是终态——决定翻转必须新开一篇并互链，不得把旧篇改成反面。
- 不装什么：事实与证据（→ research）、意图与进度（→ plans）。

### `frozen` — 冻结留档

- 家：`archive`（`.agents/archive`）；命名：保留原文件名；模板：—（无模板）
- 位置：`.agents/archive/**/*.md`
- 状态：—；迁移：—（无状态机）
- 必备节（按序）：—；禁用节：—
- 字段：必填 `Archived`；可选 `Type` `Status` `Updated` `Verified` `Owner` `Source` `Note` `Supersedes` `Superseded-by`；禁止 —
- 时效：—；文体：允许叙事
- 装什么：已退役整篇文档的冻结快照：迁入即加 `Archived:` 行并被 manifest 哈希封印，此后永久不改。
- 不装什么：笔记的归档（→ .agents/notes/archived/，同一封印机制、另一处归属）。

## 布局封闭集与桥

`.agents/` 顶层、仓库根目录与仓库根 Markdown 是封闭集：多出来的目录或门面文件会被 `check-doc-types` 拦下，防止绕过类型系统。桥必须是符号链接且指向登记的目标，断了或退化成副本都会报错。

| 位置 | 允许 |
|---|---|
| `.agents/` 子目录 | `notes` `skills` `plans` `research` `future` `archive` `templates` |
| `.agents/` 文件 | `README.md` `GLOSSARY.md` `doc-types.json` `doc-types.md` |
| 仓库根 Markdown | `AGENTS.md` `README.md` `CLAUDE.md` |
| 仓库根目录 | `.agents` `.claude` `.codex` `.git` `docs` `scripts` |
| `.agents/templates` | 只放 `.md` 模板，且每个模板必须被某个类型引用 |

| 桥 | 指向 | 消费方 |
|---|---|---|
| `CLAUDE.md` | `AGENTS.md` | Claude Code |
| `.claude/skills` | `../.agents/skills` | Claude Code |
| `.codex/skills` | `../.agents/skills` | Codex |

## 豁免

- 原始语料：目录内放一个名为 `.agents-raw` 的空标记文件，该目录整体豁免类型与写作检查（外部镜像、批量采集数据）。豁免不是免罪：仍需有一篇 `evidence` 或 `reference` 文档说明它是什么、怎么采的。
- 生成物与模板：`.agents/templates/**` 与本文件不参与写作层检查。
- 笔记树：`.agents/notes/{proposed,implemented,rejected,archived}/` 由 `scripts/check-agent-notes.mjs` 专属守卫，类型门禁不重复校验。

## 笔记树格式（noteTree）

笔记树的格式权威在本注册表的 `noteTree` 块，`scripts/check-agent-notes.mjs` 消费它做断言。首个小节固定为 `Problem`；备选节确实考据不出时可用豁免注释 `agent-note-format: alternatives-not-recorded (retro)` 代替（仅限存量 retro 笔记，禁止编造）。节键命名空间独立于上面的总表——「## 方案」在笔记里是 `proposal`，在计划文档里是 `steps`，刻意不共用。

| lifecycle | Status 行 | 必备节（按序） | 禁用节 |
|---|---|---|---|
| `proposed` | `Status: proposed` | `Problem` → `Proposal` → `Alternatives considered` → `Acceptance criteria` → `Risks` | — |
| `implemented` | `Status: implemented` | `Problem` → `Decision` → `Alternatives considered` → `Consequences` | `Proposal`、`Plan`、`Migration plan`、`Acceptance criteria` |
| `rejected` | `Status: rejected — <一行原因>` | — | `Proposal`、`Plan`、`Migration plan`、`Acceptance criteria` |

class 封闭集（第二层目录）：`feature` `bug-fix` `simplification` `architecture` `process` `testing`；`Status:` 行需附一行原因的 lifecycle：`rejected`。
