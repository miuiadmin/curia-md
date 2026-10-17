# Curia — 智能体工作区规则

本项目由 Curia 管理：过程与制度文档收在 `.agents/`，外部事实与知识收在 `docs/`。

**放东西之前先读总规格：[`.agents/README.md`](./.agents/README.md)。**

## 通用规则

1. 一事实一归属：同一条事实只有一个家；别处引用用相对链接，不复制、不双写。
2. 先定家再落笔（四句口诀）：没做的进 `plans/`、做完的进 `research/`、为什么进 `notes/`、过时的翻状态或归档；可复用的干法进 `skills/`，外部事实进 `docs/`。
3. 非平凡变更同批写笔记：改变行为、结构、契约、流程、工具或格式的改动，同一批变更里新增或更新一篇 `notes/` 笔记；写前先搜（含 `rejected/`）。
4. 永不删除：过时文档优先翻状态；冷历史走归档四步——移动、`Archived:` 行、重写自身相对链接、修入链。
5. 引用一律相对 Markdown 链接，目标必须存在；禁全局 `INDEX.md`，检索用全文检索工具（`rg` 或等价）。
6. 写作格式：一段一物理行；中英之间加一个半角空格；中文全角标点；禁 emoji；只写当前状态。
7. 并行会话纪律：动手前 `git status`；只精确暂存自己的路径（禁 `git add -A` / `git add .`）；提交带显式路径（`git commit -- <自己的路径…>`）；推送前 `git log origin/main..HEAD` 确认推送范围；别人的未跟踪与已改文件一律不碰。
8. 改动文档后跑检查：`node .agents/tools/check-docs.mjs`（读工作树，无需先 `git add`）；提交把关用 `--strict`，可自挂钩子；装不装钩子归项目自定，本条不是提交硬门槛。

## 桥

`CLAUDE.md`、`.claude/skills`、`.codex/skills` 是指向 `AGENTS.md` / `.agents/skills/` 的符号链接（不是副本）；Claude Code、Codex 等 CLI 从这些入口读取本规则与技能。桥被占用或缺失时，重建命令是：

```bash
ln -s AGENTS.md CLAUDE.md
ln -s ../.agents/skills .claude/skills
ln -s ../.agents/skills .codex/skills
```

## 结构速览

```text
<你的项目>/
├── AGENTS.md           # 本文件；CLAUDE.md 是其符号链接
├── .agents/            # 制度与过程（规范全文见其 README）
│   ├── plans/          # 没做的
│   ├── research/       # 做完的
│   ├── notes/          # 为什么
│   ├── skills/         # 可复用的干法
│   ├── archive/        # 过时的（封存，永不删除）
│   ├── templates/      # 9 份类型骨架
│   ├── examples/       # 手写示例（可删）
│   └── tools/          # check-docs.mjs 与 new-doc.mjs
└── docs/               # 外部事实与知识（仓外系统的登记与定义）
```

子目录如需更细规则，放该目录的 `AGENTS.md`（只能追加约束，不得放宽本文件）。
