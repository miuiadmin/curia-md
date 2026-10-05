# future/ — 不承诺区

**装什么**：明确不承诺实施的想法与方向。写在这里的内容不构成任何派单或承诺。

**不装什么**：已承诺的工作（→ [../plans/](../plans/)）、已成事实（→ [../research/](../research/)）、决策因果（→ [../notes/](../notes/)）。

## 两个类型

| Type | 装什么 | 预算 |
|---|---|---|
| `idea` | 一次性想法：动机、触发条件、粗略成本 | ≤ 400 词 |
| `foundation` | 现在只铺地基、将来可能长成规格的方向；必须写清「现在做什么」与「明确不做什么」 | ≤ 700 词 |

类型定义与必备节的唯一权威是[注册表](../doc-types.json)，可读投影见 [doc-types.md](../doc-types.md)。

## 状态

`future`（提前规划、仅存档，大概率不实施）| `superseded`（放弃，需 `Superseded-by:`）。

## 流转

- 决定要做 → 迁 [../plans/](../plans/) 并换类型（`idea` → `proposal`/`plan`，`foundation` → `spec`/`plan`），补 `Status: draft`，原处不留副本。
- 探索产出了事实性结论 → 结论落 [../research/](../research/)，此处翻 `superseded` 或迁走。
- 冷历史 → 迁 [../archive/](../archive/) 封存。

## 纪律

- 正文可以短，但必须一眼看出「不是承诺」；门禁仍要求头块、必备节与字数预算。
- 别把承诺藏进不承诺区：`foundation` 的「地基范围」要写到可验证，否则它就是 `plan`。
