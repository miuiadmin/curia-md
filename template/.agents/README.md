# .agents — Curia 工作区总规格

本系统名为 **Curia（枢机院）**：可移植到任何项目的 AI 原生文档管理制度——本目录即其内容根：开发与管理文档只收这里、只维护一份，经符号链接分发各 CLI。**判断「一个新东西该放哪」只看这一页**；建立决策见单根工作区决策笔记。

## 四句口诀（放哪的最后裁决）

1. **没做的** → `plans/`（尚未开始或进行中的意图）
2. **做完的** → `research/`（已成事实的调研与证据）；若它是决策的理由 → `notes/`
3. **为什么** → `notes/`（决策因果与备选，永远不进 research）
4. **过时的** → 优先状态翻转（`superseded` / `done` / `historical`）；冷历史迁 `archive/` 封存。**永不删除。**

补充：**不承诺的** → `future/`；**可复用的干法** → `skills/`；**工作区规格与词汇** → 本目录 `README.md`、`GLOSSARY.md`、`doc-types.*`。

六个家：[notes/](./notes/)、[plans/](./plans/)、[research/](./research/)、[future/](./future/)、[skills/](./skills/)、[archive/](./archive/)，另有 [templates/](./templates/)。各家装什么、允许哪些类型、状态怎么流转，唯一权威是[类型注册表](./doc-types.json)（可读投影 [doc-types.md](./doc-types.md)，生成物禁手改）。

## 类型系统（是什么）

家决定**放哪**，类型决定**是什么**。每个类型在注册表里绑定一组约束；三件套严格 1:1：类型 ↔ 模板文件 ↔ 专属检查。

| 约束 | 注册表字段 | 谁守 |
|---|---|---|
| 允许的状态与合法迁移 | `statuses` `transitions` | `check-doc-types.mjs` 对 git 基线比对，非法迁移与终态迁出直接报错 |
| 必备节与禁用节（按序） | `sections` `sectionAliases` | 同上 |
| 头块字段必填/可选/禁止与顺序 | `fields` `headerFields` | 同上 |
| 时效（多久必须复核一次） | `freshness` | 同上：超期报警，不阻断提交 |
| 文体（是否允许叙事） | `narrative` | [prose-standard 技能](./skills/prose-standard/SKILL.md)与人工审校 |

常用命令清单见[投影](./doc-types.md)开头。新增类型必须同时交齐三件套（注册表条目、模板文件、专属检查），缺一件被注册表自洽断言拦下。

## 文件头与命名

- 目录名：kebab-case 英文。
- 日期型文件名：`yyyy-mm-dd-topic-title.md`（日期取首次落笔日）；固定型文件名由注册表 `location` 模式决定（`SKILL.md`、`RUNBOOK.md`、目录 `README.md` 等）。notes 子树的路径编码见 [notes/README](./notes/README.md)。
- 日期型文档的头块（字段顺序由注册表约束，只写该类型允许的字段）：

```markdown
# <标题>

Type: <类型键>
Status: <该类型允许的状态>
Updated: yyyy-mm-dd
Verified: yyyy-mm-dd

<正文>
```

- `Type:` `Status:` 保留英文 token（机器可核对）；正文一律中文。
- `Verified:` 是「我按这份文档跑过一遍并看到预期结果」的日期——`evidence`、`reference`、`runbook` 必填，其余类型不写。
- `Status: superseded` 必须带 `Superseded-by:` 链接；`.agents/archive/` 下的文档必须带 `Archived:` 日期行并被 manifest 封印。
- 字段值不得残留 `<占位符>`；必备节确实无内容时只写 `_（无）_`。

## 写作与格式（硬规则）

- **一段一物理行**：每个自然段写成一行（靠编辑器软折行；表格、列表、代码块除外）——diff 干净、评审省力。
- **中英混排**：中文与英文/数字/行内代码之间加一个半角空格；中文用全角标点（，。；：！？（））。
- **禁 emoji、禁客套填充**；直给结论。功能性符号只放行 `→`，以及三档示例里当对错标记的 `✓` `✗`。
- **只写当前状态**：历史、过程、被否方案不进正文——分别去 git、notes、rejected。
- **引用用相对 Markdown 链接**（可机械校验）；正文不写裸路径。
- **术语**：查 [GLOSSARY.md](./GLOSSARY.md)，一概念一词；各词条 `_Avoid_` 中带全角 `！` 的是硬禁用词（正文命中即被 `check-prose` 拦下），不带的只是命名指引。
- 前五条由 `check-prose.mjs` 机械校验；语义层细则（完整命题、slop 清单、三档示例法）见 [prose-standard 技能](./skills/prose-standard/SKILL.md)。

## 晋级与退役

| 从 | 到 | 触发 |
|---|---|---|
| `future/`（idea / foundation） | `plans/`（proposal / spec / plan） | 决定要做（承诺）→ 迁移 + 换类型与 `Status: draft`，原处不留副本 |
| `plans/` 完成 | `research/` + `notes/` | 事实与回执写成 `evidence` 或 `survey`；决策因果写笔记；计划本体翻 `done` 留档 |
| `spec` 完成 | 原地 `done` | 规格是长期契约，`done` 不是退役；后续变更改它并更新 `Updated:` |
| `postmortem` 行动项关闭 | 原地 `historical` | 复盘不退役，只从「未关闭」翻成「历史记录」 |
| 任意 | 状态翻转 | 被取代 → `superseded` + `Superseded-by:`（正文保留可发现入口） |
| 任意（非 notes） | `archive/` | 冷历史、不再维护 → `node scripts/archive-doc.mjs <path>`（移动 + `Archived:` 行 + 封印 + 列出待修入链），永久不改 |
| notes 子树 | `notes/archived/` | 见 [notes/README](./notes/README.md)（同一套哈希封印机制） |

迁移必须合法：`transitions` 就是状态机，终态（如 `superseded`）不得迁出，要推翻就新建文档并互链；守卫拿 git 基线比对，翻错直接报错。

## 检索

```bash
# 全工作区检索（排除归档区；.agents-raw 语料目录按名排除，新增语料时补一项）
rg --hidden -g '!**/archived/**' -g '!.agents/archive/**' -g '!**/2026-10-02-session-transcripts/**' -g '!**/2026-10-02-qoder-intl-docs/**' -g '!doc-types.md' <关键词> .agents/

# 只搜决策笔记（含 rejected，排除 archived；语料与投影排除为全工作区统一项）
rg --hidden -g '!.agents/notes/archived/**' -g '!**/2026-10-02-session-transcripts/**' -g '!**/2026-10-02-qoder-intl-docs/**' -g '!doc-types.md' <关键词> .agents/notes/

# 结构化查询（按类型 / 状态 / 家 / 时效）
node scripts/doc-query.mjs --home plans --status active
```

**禁全局 INDEX.md**——目录即索引：rg 全文检索，`doc-query.mjs` 结构化索引（按需生成、不入库）。

## 桥（各 CLI 怎么消费）

符号链接入口清单登记在注册表 `bridges` 字段（渲染见[投影](./doc-types.md)），由 `check-doc-types` 校验：必须存在、是符号链接、指向与登记一致——断链或退化成副本都报错。各 CLI 原生支持：

| 消费方 | 机制 |
|---|---|
| Claude Code | 只认仓库根的 `CLAUDE.md` 与 `.claude/skills`，两者都是符号链接 |
| Codex | `.agents/skills/` 与 `.codex/skills` 两处均为其原生技能根（源码证实），后者是符号链接入口；根 `AGENTS.md` 原生读取 |
| Pi | **原生支持** `.agents/skills/` 与根 `AGENTS.md`（Agent Skills 规范明列该位置） |
| 其他 | 直接读根 `AGENTS.md` |

## 门禁

```bash
node scripts/run-checks.mjs          # 全部门禁（八道守卫并行）
node scripts/run-checks.mjs --self   # 附带门禁自证（负向夹具漏一道，自证自己红）
node scripts/run-checks.mjs --audit  # 规则命中审计（命中 = 拦截，只记 error 级；不跑守卫）
node scripts/install-hooks.mjs       # 装 pre-commit 钩子（幂等，不覆盖别的工具装的）
```

| 守卫 | 管什么 | 看哪里 |
|---|---|---|
| `check-tools.mjs` | 脚本与钩子语法、只读 CLI、钩子安装 | 索引 |
| `check-agent-notes.mjs` | 笔记树格式、归档封印 | 工作区 |
| `check-doc-types.mjs` | 类型、生命周期、布局与桥、永不删除 | 索引 + git 基线 |
| `check-prose.mjs` | 散文层：中英空格、标点、一段一行、禁用词、文风 | 索引 |
| `check-layout.mjs` | 版式层：栅栏、表列数、标题层级、空白 | 索引 |
| `check-links.mjs` | 链接可达（含模板目录） | 索引 |
| `check-migrations.mjs` | 迁移文件：命名、seq、头注释、MANIFEST 校验和、冻结对账 | 工作区 |
| `check-db-ledger.mjs` | 迁移台账：envs 形状、status 封闭集、证据指针、checksum 对账 | 工作区 |
| `self-test.mjs` | 自证：八道守卫负向夹具、覆盖比对 | 临时工作区 |

「看哪里」是交互模式受检范围：索引 = 已入库文件（`git ls-files`），工作区 = 盘面全树。pre-commit 暂存模式（`CURIA_STAGED=1`）下八道守卫按 git 索引判「将要提交的树」——发现、正文、链接、封印、注册表与投影、脚本、迁移与台账取索引版：先 add 坏版再在盘面改好、`git rm --cached`、换符号链接都骗不过；全量审计加 `--all`。守卫输出挂 `[scope/rule]` ID；error 级命中记进 `.agents/.rule-hits.jsonl`（gitignore；warning 不入账）；`--audit` 并读当前与历史两档台账取并集列零命中规则——error 级零命中才是删除候选，warning 级不可证、单列不诱导误删。新增检查必须带 ID 与负向夹具（缺 ID 报 `meta/missing-rule-id`）。守卫清单见脚本头注释（唯一权威）。

工具（不参与判定）：`new-doc.mjs` 建档与补头块、`fix-doc.mjs` 机械修复（默认 dry-run）、`archive-doc.mjs` 归档、`doc-query.mjs` 查询与时效、`gen-doc-types.mjs` 重生成投影、`seal-notes-archive.mjs` 重封印。

## 边界（什么不进这里）

- 密钥/凭据/`.env`：任何情况下不进仓库（含 `.agents`）。
- 原始大文件、二进制产物：不进；引用外部位置。
- 批量原始语料（外部文档镜像、采集数据）：可以进，但目录里放一个空标记文件 `.agents-raw` 即整体豁免类型与写作检查；仍需一篇 `evidence` 或 `reference` 说明它是什么、怎么采的。
- 将来如出现「对外文档/站点」（产品站、用户手册）：另立独立可见树，不放 `.agents`——**.agents 是工作区，不是发布面**。
