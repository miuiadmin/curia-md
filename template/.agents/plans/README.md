# plans/ — 承诺要做的意图

**装什么**：已承诺、会影响后续行动的工作——目标提案、实施规格、实施计划。没开始的、半做的、做完留档的，都在这里靠 `Type` 与 `Status` 区分。

**不装什么**：决策因果（→ [../notes/](../notes/)）、已完成的事实与证据（→ [../research/](../research/)）、不承诺的想法（→ [../future/](../future/)）。

## 三个类型

| Type | 回答什么 | 做完之后 |
|---|---|---|
| `proposal` | 为什么值得做、做成什么样算成功、有哪些候选路线 | 翻 `done` 留档；因果写进 [../notes/](../notes/) |
| `spec` | 做成什么样：契约、接口、数据结构、验收标准 | `done` 不是退役——它是长期可引用的权威规格 |
| `plan` | 分几步做、做到哪了、还剩什么 | 翻 `done`；事实与回执写成 research 的 `evidence` 或 `survey` |

三个类型的状态机、必备节与字数预算见[注册表投影](../doc-types.md)。

## 建档与查询

```bash
node scripts/new-doc.mjs --type plan --topic doc-type-rollout
node scripts/doc-query.mjs --home plans --status active
```

- 三个类型共用 `draft`（没开始）→ `active`（进行中）→ `done`（完成留档），任意态可 → `superseded`（必须带 `Superseded-by:` 链接）。
- `active` 的计划必须维护「未完成事项」一节——它是这项工作唯一的活跃清单；本次做不完的项写 `DEFERRED: <原因 / 归属 / 触发条件>`。
- 迁移由门禁对 git 基线校验：`done` 与 `superseded` 之后不得回到 `active`（`spec` 例外——规格可因后续变更重新激活）。

## 流转

- [../future/](../future/) 的想法被承诺后迁入本目录，换成 `proposal` 或 `plan` 类型并补 `Status: draft`，原处不留副本。
- 完成时：计划本体翻 `done`；事实与回执进 [../research/](../research/)；决策因果进 [../notes/](../notes/)。
- 多个 `active` 计划并存时用 `doc-query.mjs --status active` 查，不建人工清单（禁 INDEX.md）。
