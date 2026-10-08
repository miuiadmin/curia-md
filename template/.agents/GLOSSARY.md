# GLOSSARY — Curia 工作区术语表

本表统一工作区术语（**一概念一词**，用新词先查、写进正文前先登记）。条目格式：`**术语（英文）**：定义。_Avoid_: 禁用/易混词`；带 `！` 的是**硬禁用词**，正文命中被 `check-prose` 拦下，其余按语境判断。

## 工作区结构

**Curia（枢机院）**：本仓智能体文档管理制度的总称——单根 `.agents/`、类型注册表、决策笔记树、门禁与自证、技能与桥的整体；定位为可移植到任何项目的 AI 原生文档制度，本仓是它的一个实例。_Avoid_: 这套文档、笔记架构、agents 文档系统（旧散称）

**单根工作区（single-root workspace）**：文档收在 `.agents/` 只维护一份、经符号链接分发给各 CLI 的结构。_Avoid_: 目录规范、！多仓方案

**桥（bridge）**：把 `.agents/` 挂给各 CLI 的符号链接入口（`CLAUDE.md`、`.claude/skills`、`.codex/skills`）。_Avoid_: 适配层、同步脚本

**四句口诀**：放哪的最后裁决——没做的→plans、做完的→research、为什么→notes、过时的→翻转/封存。_Avoid_: 原则、口号

**机制冻结（mechanism freeze）**：AGENTS.md 第 11 条——机制只在门禁漏真问题或流程税压垮写作时改。_Avoid_: 停止规则

## 文档与生命周期

**头块（header block）**：文档开头的固定结构——标题行、空行、`Key: value` 字段行、空行；状态值保留英文 token，正文用中文；笔记树以 `Status:` 独占第 3 行。_Avoid_: frontmatter（本仓只有技能用）、中文状态词

**类型注册表（doc-type registry）**：`.agents/doc-types.json`——文档类型的唯一权威：家、状态机、必备与禁用节、头块字段、时效、模板与检查。_Avoid_: 配置表、schema（它是内容）

**三件套（type triple）**：一个类型 ↔ 一个模板 ↔ 至少一条专属检查的 1:1 约束；缺一件即被门禁拦下。_Avoid_: 三要素

**状态机（transitions）**：某类型允许的状态迁移图；非法迁移与终态迁出由门禁比对 git 基线拦下。_Avoid_: 流程图

**复核日（Verified）**：跑过一遍并见预期结果的日期，与 `Updated` 分开；`evidence`/`reference`/`runbook` 必填、超期报警。_Avoid_: 更新时间、校验日期

**投影文档（projection）**：脚本从权威源生成、禁手改、新鲜度逐字节比对的派生文档（如 `.agents/doc-types.md`）。_Avoid_: 副本、！导出文件

**按需索引（on-demand index）**：`doc-query.mjs` 现场生成、不入库因此不腐烂的结构化索引，是「禁 INDEX.md」的另一半答案。_Avoid_: 目录页、INDEX

**原始语料豁免（raw marker）**：目录内放 `.agents-raw` 空标记即豁免类型、写作与链接检查，用于外部镜像等采集物。_Avoid_: 白名单、忽略目录

**脚手架（scaffold）**：`new-doc.mjs` 按模板建档（`--type`）或补头块（`--adopt`）；手抄骨架被门禁拦下。_Avoid_: 模板生成器、迁移、格式化

**门禁自证（self-test）**：每条断言配一个必须失败的负向夹具，证明拦得住坏输入。_Avoid_: 单元测试（它测的是门禁本身）

**命中台账（rule-hit ledger）**：守卫的 error 级命中把规则 ID 记进 `.agents/.rule-hits.jsonl`（本地，命中=拦截）；warning 只在门禁输出可见、不入账，`--audit` 并读当前与历史两档台账、取并集判定零命中做删除候选。_Avoid_: 统计面板

**晋级（promote）**：`future/` → `plans/`（迁移、换类型并补 `Status: draft`，原处不留副本）。_Avoid_: 升级、立项

**退役（retire）**：过时内容的处置——优先状态翻转（`superseded` / `done` / `historical`），冷历史迁 `archive/`。_Avoid_: 删除（永不删除）、下线

**未完成事项**：`active` 计划里唯一维护的待办清单节；跨计划清单查 `doc-query.mjs --status active`，不建人工汇总。_Avoid_: ！TODO 列表

**冻结留档（archive）**：迁入即永久不改的退役区；与 notes 的 `archived/` 共用 sha256 封印机制。_Avoid_: 备份、！冷存储

## 决策笔记

**Agent Note（决策笔记）**：`.agents/notes/` 下的 RFC 式决策记录，记「为什么这样做、放弃了什么」。_Avoid_: 日记、周报、流水账

**supersession（取代检查）**：每篇新笔记的强制动作——搜活跃树、把与旧笔记的关系分类（无关/部分重叠/完全吸收/过时提案），结论同批落盘。_Avoid_: 查重

**铁律（iron rules）**：notes 树的六条硬约束（alternatives 强制、翻转新开篇、supersession、禁 INDEX、相对链接、归档封印）。_Avoid_: 规则清单

**封印（seal）**：归档文档的 sha256 哈希记录，封印后不可改、只增不改；`notes/archived/` 与 `archive/` 各有 manifest，由 `seal-notes-archive.mjs` 生成。_Avoid_: 备份、加锁

**红线清单（exemption list）**：不用写笔记的改动类型清单（纯机械或局部改动等）。_Avoid_: 白名单

## 写作

**技能（skill）**：`.agents/skills/<name>/SKILL.md`，按需加载的流程或准则，描述字段决定触发时机。_Avoid_: ！提示词模板、脚本

**slop 清单**：写作自查的九类脏东西（重复规则、状态注解、推理记录……），见 [prose-standard](./skills/prose-standard/SKILL.md)。_Avoid_: 检查表、！错题本

**三档示例法**：校准写作规则的方法——每条规则配「过度裁剪 / 平衡 / 过度展开」对照。_Avoid_: ！正反例（只有两档）

## 你的领域（示例）

**占位术语（placeholder term）**：换成你们项目的第一个领域词——一句话写清它指什么、与哪些近义概念怎么区分。_Avoid_: 易混叫法（换成真实要避开的词）

**占位术语二（second placeholder）**：`_Avoid_` 里带全角 `！` 的是硬禁用词（正文命中会被 `check-prose` 拦下），不带的只是命名指引。_Avoid_: ！占位硬禁用词（换成真实要禁用的词）
