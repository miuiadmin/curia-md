# 文档工作区（Curia 2.1）

本仓库的文档工作区遵循 Curia 2.1：规则入口是 [`AGENTS.md`](./AGENTS.md)，规范全文是 [`.agents/README.md`](./.agents/README.md)（唯一权威）。

- `.agents/templates/` — 9 份类型骨架，文件名即类型键。
- `.agents/examples/` — 3 份手写示例（规格、调研、决策笔记），可删。
- `.agents/tools/` — `check-docs.mjs`（检查）与 `new-doc.mjs`（建档，可选）。
- `docs/README.md` — 外部事实与知识根的约定。

## 上手

1. 在 `AGENTS.md` 里补上项目名与既有约束；术语种子在 `.agents/GLOSSARY.md`。
2. 按 `.agents/README.md` 的四句口诀放文档、按 9 类文档表选类型。
3. 自检跑 `node .agents/tools/check-docs.mjs`（可选）。

本 README 由 create-curia 生成，可随项目重写。
