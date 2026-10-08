---
name: write-doc
description: 在 Curia .agents 工作区新建或修改文档的完整流程——定家定型、脚手架建档、先核事实再写字、填必备节、落头块、过门禁、必要时晋级或退役。当要写调研报告、实施规格、计划、事故复盘、证据快照、运维手册，决定一篇文档放哪、是什么类型，或用户说「写个文档」「补个规格」「整理成文档」时使用。
---

# 文档写作（write-doc）

句子与删改看 [prose-standard](../prose-standard/SKILL.md)，决策因果看 [write-note](../write-note/SKILL.md)。本技能是流程；类型的权威是[注册表](../../doc-types.json)，总规格是 [.agents/README.md](../../README.md)。

## 定家定型（两步）

1. **定家**：按 AGENTS.md 的四句口诀——为什么 → `notes/`（走 write-note）；没做的 → `plans/`（未承诺 → `future/`）；做完的 → `research/`；可复用干法 → `skills/`，冷历史 → `archive/`。
2. **定型**：同一家里类型互斥，判据现查 `node scripts/new-doc.mjs --list`（每类的装什么/不装什么都在输出里，不要背表）。两组最常混的：`survey` 会过时、`reference` 持续维护带 `Verified:`；`spec` 做完仍是权威（`done` 不退役）、`plan` 做完就是历史。

## 流程

1. **建档**：`node scripts/new-doc.mjs --type <type> --topic <topic>`（固定命名类型用 `--name`）；既有文档补头块用 `--adopt <path> --type <type>`。手抄骨架会被门禁拦下（AGENTS.md 第 10 条）。
2. **先核事实，再写字**：每条命令、默认值、端点、路径、行为都要跑一遍或读到原文；核不到的写「未核实 + 核实归属」，不凭记忆、类比或隔壁文档下笔。
3. **填必备节**：按模板顺序写完；确实无内容的节只写 `_（无）_`，不删节、不改标题措辞（标题别名由注册表管）。
4. **写正文**：只写当前状态；篇幅凭判断——事实写够即止、不要太长，没有字数门禁；格式硬规则（一段一行、中英空格、全角标点、术语）在 AGENTS.md 第 9 条，句子层面的自查见 [prose-standard](../prose-standard/SKILL.md)。
5. **落头块**：`Updated:` 改今天；跑过一遍的（`evidence`/`reference`/`runbook`）同时改 `Verified:`；有对应决策笔记补 `Note:` 链接。
6. **过门禁**：`node scripts/run-checks.mjs`；机械类错误（中英空格、全角标点、行尾空白）先 `node scripts/fix-doc.mjs --write <路径>` 一键修复；报错就地修文档，不要改门禁。
7. **同批写笔记**：非平凡变更（改行为、结构、契约、流程、工具、格式）同批新增/更新 `notes/`（走 write-note）。

## 晋级与退役

流转表见[总规格的「晋级与退役」](../../README.md)。三个动词：承诺了迁 `future/` → `plans/`（不留副本）；做完了计划翻 `done`、事实与因果分家互链；过时了优先翻状态，冷历史 `node scripts/archive-doc.mjs <path>`（自动加 `Archived:` 行、封印、列待修入链）。**永不删除。**

## 改类型系统本身

改 `.agents/doc-types.json` 必须同一批做完：更新或新增 `.agents/templates/<type>.md`、实现专属检查、`node scripts/gen-doc-types.mjs` 重生成投影、`scripts/self-test.mjs` 补**必须失败**的负向夹具（输出挂 `[scope/rule]` 规则 ID，缺 ID 被 `meta/missing-rule-id` 拦下）、最后 `node scripts/run-checks.mjs --self`。三件套（类型 ↔ 模板 ↔ 检查）缺一被注册表自洽断言拦下。
