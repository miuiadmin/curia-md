# Curia — 文档工作区模板

这是 create-curia 的分发载荷：Curia 2.1 文档管理方案的规范全文、9 份类型骨架与 2 支轻量脚本，拷贝进你的仓库即可用，生成后的内容归你的项目维护。模板提炼自 参考实现仓 参考实现。

## 载荷清单

- `.agents/README.md` — 规范全文，唯一权威；先读它。
- `.agents/templates/` — 9 份类型骨架，文件名即类型键。
- `.agents/tools/` — `check-docs.mjs`（检查）与 `new-doc.mjs`（建档，可选）。
- `.agents/examples/` — 3 份手写示例：规格、调研、决策笔记。
- `.agents/` 其余目录 — `plans/`、`research/`、`notes/`、`skills/`、`archive/` 五个家与各自的 README。
- `AGENTS.md` — 规则入口（8 条通用规则）；`CLAUDE.md` 是其符号链接。
- `docs/README.md` — 知识根约定。
- `CLAUDE.md`、`.claude/skills`、`.codex/skills` — 三个桥符号链接。

## 三步上手

1. 把 `AGENTS.md`、`.agents/`、`docs/`、`.gitignore` 与桥拷进你的仓库（create-curia 的 `init` 会自动完成这一步）。
2. 在 `AGENTS.md` 里补上你的项目名与既有约束；术语种子在 `.agents/GLOSSARY.md`。
3. 按 `.agents/README.md` 的四句口诀放文档、按 9 类文档表选类型；自检跑 `node .agents/tools/check-docs.mjs`（可选）。

## 红线

- 载荷不是运行时：脚本只用 Node 内置模块（Node ≥ 18），不联网、不装钩子、不自动跑任何东西。
- 拿走即你的（fork-and-own）：结构、契约、流程都可以改，不需要迁就本模板。
