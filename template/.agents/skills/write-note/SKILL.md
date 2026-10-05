---
name: write-note
description: 在 .agents/notes/ 新增或更新决策记录（Agent Note）。当完成非平凡变更、做出架构/流程/契约决策、要在 Curia 记录「为什么这么做」时使用；用户说「记一笔 / 写笔记 / 记录决策」也触发。
---

# 写决策笔记（Agent Note）

规格全文（唯一权威）：[.agents/notes/README.md](../../notes/README.md)。**热区（「最短合规路径」）必读**——何时写、五步、头块与必备节、六条铁律、检索配方都在那里，读完即可动笔；其后的「细则（按需查）」按需查：

- 该不该写、红线豁免 → 「何时写、何时不写」；判不准 class → 「分类判据」。
- 命名落位、lifecycle 间移动 → 「目录、命名与移动」。
- 头块取值、三种模板、Alternatives 全文 → 「文件格式」。
- supersession 四分类全文 → 「检索与 supersession」；归档与封印 → 「归档与封印」。

## 步骤（热区五步的速览）

动笔前先过「何时写」判据：非平凡即写（判据同 [AGENTS.md](../../../AGENTS.md) 第 2 条）；红线豁免见「何时写、何时不写」。然后：

1. **先搜**：含 `rejected/`（可能已被否决过）——配方见热区「检索配方」。
2. **选家落位**：lifecycle × class 封闭集，`{lifecycle}/{class}/yyyy-mm-dd-topic-title.md`（日期=首次提出日）。
3. **套格式**：头块四行固定；必备节按 lifecycle，由注册表 `noteTree` 拥有、守卫强制，不必背。
4. **supersession 检查**：相关笔记逐篇分类，结论同批落盘。
5. **跑门禁**：`node scripts/run-checks.mjs`，必须全绿。

## 禁止

- 禁止把旧笔记改写成反面（翻转 = 新开一篇 + 互链）；禁止编造 alternatives，新笔记禁用 retro 豁免。
- 禁止给笔记加 `Type:` / `Updated:` 头（`Status:` 独占第 3 行，守卫强制）；禁止建 INDEX.md。
