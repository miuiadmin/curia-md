# Agent Note（决策记录）——权威规格

本目录存放一种专门的设计文档：**Agent Note（决策记录）**——记录影响本仓库的决策或提案，代码与文档装不下的「为什么」与「放弃了什么」。规格分两层：先读「最短合规路径」（热区），其余各节是细则，按需查。

## 最短合规路径

### 何时写

非平凡改动必须写：改变行为、架构、跨文件/跨模块共享的契约、流程或工具、测试策略、盘上/wire/配置格式，或维护者可能重访的决定。纯机械或局部改动、执行流水账不写——完整豁免见「何时写、何时不写」。重大未来工作从 `proposed/` 起笔；已经做出的决定从 `implemented/` 起笔。

### 检索配方

写新笔记前先搜活跃树——**含 `rejected/`，可能是被否决过的方案**：

```bash
rg --hidden -g '!.agents/notes/archived/**' <关键词> .agents/notes/
```

活跃树即工作清单：按 lifecycle/class 目录浏览或全文检索。

### 五步

1. **先搜**：跑「检索配方」；相关笔记全部进第 4 步。
2. **选家**：lifecycle（`proposed` / `implemented` / `rejected`）× class 六类封闭集（`feature` / `bug-fix` / `simplification` / `architecture` / `process` / `testing`，判据见「分类判据」）；落位 `{lifecycle}/{class}/yyyy-mm-dd-topic-title.md`（日期=首次提出日）。
3. **套格式**：头块四行固定，必备节按 lifecycle（见下节）；`## Alternatives considered` 必写——只记真实备选与落选理由，禁编造。
4. **supersession 检查**：相关笔记逐篇分类（无关 / 重叠互链 / 吸收合并 / 过时转 rejected），结论同批落盘，全文见「检索与 supersession」。
5. **跑门禁**：`node scripts/run-checks.mjs`，必须全绿。

### 头块与必备节

前四行固定（标题 / 空行 / Status / 空行），不加 `Type:` / `Updated:` 头：

```markdown
# Agent Note: <标题>

Status: <状态>
```

`Status:` 三种取值，必须与所在 lifecycle 文件夹一致：`proposed` / `implemented` / `rejected — <一行原因>`（原因非空，守卫强制）。必备节名与序由注册表 `noteTree` 强制；自由节可插其间：

- `proposed/`：`## Problem` → `## Proposal` → … → `## Alternatives considered` → `## Acceptance criteria` → `## Risks`
- `implemented/`：`## Problem` → `## Decision` → … → `## Alternatives considered` → `## Consequences`
- `rejected/`：`## Problem` → …（被否决方案内容与否决理由）→ `## Alternatives considered`

implemented 用现在时描述已落地现实、整篇保持同步；提案式节标题（`## Proposal` / `## Plan` / `## Migration plan` / `## Acceptance criteria` 及中文别名）不得出现在 implemented 与 rejected。

### 六条铁律

1. `## Alternatives considered` 强制——禁编造备选；新笔记禁用 retro 豁免。
2. 决定翻转必新开一篇 + 互链，禁改写旧篇；implemented 笔记的事实（路径/名称/默认值）随代码同批原地更新。
3. 每篇新笔记做 supersession 检查，结论同批落盘（全文见「检索与 supersession」）。
4. 禁建全局 `INDEX.md`（并行分支会产生提交冲突）；检索用「检索配方」。
5. 跨笔记引用一律用相对 Markdown 链接。
6. 归档只做三件事——移动 + `Archived:` 行 + 重封印；封印后冻结（全文见「归档与封印」）。

## 细则（按需查）

以下各节是热区的展开与边界情形；不必通读，被拦下时查对应节。

### 定位：事实记别处，notes 记因果

工作区各家回答不同问题（[.agents/README](../README.md)）：`plans/` 答「要做什么、做到哪了」，`research/` 答「查到了什么」，**notes 答「当初为什么写成这样、否定过哪些方案才妥协成现在这样」**（决策因果）——职责不同，不能混写；一条事实只在一个家（one home per fact）：

| 事实类型 | 唯一家 |
|---|---|
| 开工必读规则 | 根/子树 `AGENTS.md`（每条 1-3 行，rationale 链本目录） |
| 系统/项目现状（事实） | `research/`（时点快照）或仓库自身 |
| 活计划与执行清单 | `plans/` |
| **决策因果（为什么/放弃了什么）** | **本目录 `.agents/notes/`** |
| 可复用干法（流程技能） | `skills/`（SKILL.md） |
| AI 个人记忆 | 各 AI 的 auto-memory（durable 项目事实迁入本目录后，memory 只留个人层） |

### 分类判据

六类封闭集登记在[注册表](../doc-types.json)的 `noteTree.classes`，由 `scripts/check-agent-notes.mjs` 强制；新增类必须同批更新注册表与本节。

| Class | 覆盖内容 |
|---|---|
| `feature` | 新增用户或模型可见能力。 |
| `bug-fix` | 修复缺陷，或收口事故复盘暴露的缺口。 |
| `simplification` | 删除代码、行为或表面面积，不新增能力。 |
| `architecture` | 关于已发布产物的结构性决定——模块如何关联、运行时词汇是什么。 |
| `process` | 产物周边的工具、策略或工作流——门禁、目录结构、发布——不是运行时行为。 |
| `testing` | 测试基建与策略。 |

architecture/process 分界线：**architecture 讲要发布的东西；process 讲周边的工具与流程。** 刻意不收 `refactor`——与 `simplification` 重叠，后者判据「可观察行为是否改变」已覆盖。

### 何时写、何时不写

**每次非平凡改动必须在同批变更中新增或更新至少一篇笔记**（判据见热区「何时写」）；选与决定匹配的 class（见「分类判据」）。

更新已拥有该决定的笔记即可满足规则，**不建重复笔记**。

**豁免（红线清单——以下情形不用写）：**

- 纯机械或局部改动，不改变行为、契约、结构、流程或 rationale：格式化、注释、样式、局部重命名、纯文档措辞、单纯依赖版本升级且不改变契约语义、单文件 bug 修复不改行为面。
- **「行为面」可操作判据**：同一输入下的可观察输出、wire 行为、持久化状态三者任一变化即行为面变化。显式 bug 修复通常会改变行为面（错误输出变正确输出）→ **应写 `bug-fix` 笔记**；仅当修复不改变任何可观察行为才免写。
- **默认值/端口/配置项/API 参数变更属于非平凡**——须写笔记或按铁律 2 同批更新既有笔记，不得按「局部重命名」免写。
- 执行记录、进度汇报、会话流水账——归回执/会话态，不归 notes。笔记不是流水账。

**禁止改写：** 一条笔记**永远不被改写成另一个决定**——被取代就新开一篇并互链（铁律 2），除非旧篇按合并规则被完全吸收。编辑 `implemented/` 笔记以跟踪既有决定的最新事实是**必须**，不是禁止。

**合并（完全吸收时）：** 完全被取代的 implemented 笔记可合并进当前持有笔记并删除：删除前必须保留每一份独有 rationale/备选/后果，修复每一处入链。部分取代不构成合并资格（保留两篇互链，更新仍然成立的事实）。

### 目录、命名与移动

每条笔记的两条轴都编码在**路径**里——`{lifecycle}/{class}/yyyy-mm-dd-topic-title.md`：

- **Lifecycle（顶层目录）** = 笔记状态，随状态变化在目录间移动：
  - `proposed/`——尚未实现（或只实现一部分）的提案。
  - `implemented/`——已落地的决策。记录「决定了什么、否决了什么」，**与真实落地保持同步**：代码/文档后续改路径、改名、改关键默认值时，笔记在同一批变更中原地更新事实（只改事实，不改决定本身，见铁律 2）。
  - `rejected/`——考虑过并否决的提案。仅在否决理由仍能阻止一个有诱惑力的错误时保留；否则整篇删除。
- **Class（第二层目录）** = 决策的种类，见「分类判据」。

文件名的日期是**首次提出日**（补写的 retro 笔记按决策原始发生日考据，不写迁移日）。跨笔记引用一律相对 Markdown 链接（铁律 5，`check-agent-notes.mjs` 扫描覆盖）——不写裸文字路径。

删除概念不存在于 implemented：**不做题、不存档的 implemented 笔记走归档**（见「归档与封印」，铁律 6），永不静默消失。

**lifecycle 间移动**：移动文件 = 更新 `Status:` 行 + 同批满足目标文件夹的骨架，否则守卫拒绝移动：

- `proposed/` → `implemented/`：把 `## Proposal` 改写为现在时 `## Decision`；把 `## Acceptance criteria` 与 `## Risks` 折入 `## Consequences`；删掉计划留事实。
- `proposed/` → `rejected/`：只在 `Status:` 行加原因，冻结文件。

### 文件格式

每篇活跃笔记遵循同一份格式，由 `scripts/check-agent-notes.mjs` 强制。格式权威在[注册表](../doc-types.json)的 `noteTree` 块——节键别名、必备节顺序、禁用节都在那里登记，改格式改注册表不改代码。必备节顺序固定；自由节（模块拓扑、wire 契约、schema 等）可插在必备节之间。

**头块**：状态不含日期与括号（日期在文件名，其余时间在 git）；「以修订形式接受」写进正文。rejected 原因是唯一带内容的 status——被否决笔记的结论就是读者来找的事实（守卫强制 `—` 后非空）。标题冒号兼容全角（`# Agent Note：`）；新笔记建议半角。

**三种模板（必备节全名）**：本仓无独立 `templates/` 目录——模板即以下三个代码块，复制即用。每篇笔记以 `## Problem` 开头——动机要能脱离方案独立成立，之后按 lifecycle 区分：

**`proposed/`**

```markdown
## Problem
## Proposal
…自由节…
## Alternatives considered
## Acceptance criteria
## Risks
```

`## Proposal` 写预期变更，可以用将来时；`## Acceptance criteria` 说清什么可观察状态算完成；`## Risks` 同时写可能出错的点与已知放弃的收益。

**`implemented/`**

```markdown
## Problem
## Decision
…自由节…
## Alternatives considered
## Consequences
```

`## Decision` 用现在时描述已落地现实，整篇与它保持同步（铁律 2）；提案式标题在 implemented 与 rejected 被守卫直接拒绝（清单见「头块与必备节」）。

**`rejected/`**

```markdown
# Agent Note: <标题>

Status: rejected — <一行原因>

## Problem
…被否决提案针对的动机…
…自由节（描述被考虑过的方案内容与否决理由，不使用提案式标题）…
## Alternatives considered
```

rejected 是冻结的提案：结论在 `Status:` 行，正文保留问题背景与其余备选，不把旧篇改写成反面。

**`## Alternatives considered`——强制（铁律 1）**：每个**真实考虑过**的备选与为何落选，一个备选一段粗体引导。记录没有放弃什么的决定，等于邀请重新诉讼——这正是笔记要防的失败。「不做 / 复用现状」仅在当时真的权衡过才写。备选是记录的，**不是发明的**。

存量转化（retro）笔记中确实考据不出备选的，在该节位置放豁免注释代替（守卫接受）：

```markdown
<!-- agent-note-format: alternatives-not-recorded (retro) -->
```

**新写笔记不允许用豁免注释；禁止编造 alternatives。**

### 检索与 supersession

**supersession 检查（全文，铁律 3）**：每篇新笔记触发一次——用 rg 搜活跃树（排除 `archived/`），逐篇当场分类：

- **无关**——不动；
- **部分重叠**——互链；
- **完全吸收**——合并或归档；
- **过时提案**——转 rejected。

分类结论与新笔记同批落盘：写入新笔记的 `## Related` 节互链相关笔记；无关联笔记则结论只进提交说明——**不单独建文件、不建索引**。

### 归档与封印（铁律 6）

**何时归档：** 落地决定已完成、rationale 不太可能指导未来工作时，把 implemented 笔记归档。以下情况保持活跃：备选、归属边界、负向保证、持久或 wire 语义、安全规则、回归条件仍有用。**永远不归档 proposed 笔记**——过时提案直接转 rejected。rejected 笔记只在仍能阻止一个合理错误时保留，否则删除。

**归档操作只允许三件事**（`check-agent-notes.mjs` 的 manifest 哈希校验强制）：

1. 移动笔记到 `archived/`（扁平放置即可，守卫对归档区不检查 class）；
2. 保留 `Status: implemented`，在其下插入 `Archived: YYYY-MM-DD` 行；
3. 重新生成封印：`node scripts/seal-notes-archive.mjs`（append-only，只增不改），并修复或删除入链。

一旦封印，每篇归档笔记**永久冻结**：不编辑、不翻译、不重排、不移动、不删除，**不作为当前行为 authority**。守卫对归档源跳过格式与出链检查；活跃正文仍可有意链接进归档笔记引用历史。

manifest 形态（`archived/manifest.json`，由封印脚本生成）：

```json
{
  "version": 1,
  "files": {
    "archived/process/2026-01-01-foo.md": "sha256:…"
  }
}
```

### 守卫与本仓其他体系

- 蓝本：[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 `.agents/notes/` 体系；移植经验继承参考实现仓 的成熟落地（含 `archived/manifest.json` 哈希封印）。本仓为中文单语：机器可核对 token（`# Agent Note:`、`Status:`）保留英文原文，正文一律中文。
- 守卫：`scripts/check-agent-notes.mjs`（可设 `AGENT_NOTE_ROOT` 环境变量指向测试夹具）；提交前跑 `node scripts/run-checks.mjs`。
- 与类型系统的关系：[注册表](../doc-types.json)把笔记树登记为 `note` 类型并标注 `externalGuard`，即「这棵树由本守卫专属管辖」——`check-doc-types.mjs` 不重复校验笔记，`new-doc.mjs` 也不会给笔记建档。**不要给笔记加 `Type:` / `Updated:` 头**：本格式要求 `Status:` 独占第 3 行，多一行就报错。
- 子树纪律：见 [AGENTS.md](AGENTS.md)。
- 工作区总规格：[.agents/README.md](../README.md)。
