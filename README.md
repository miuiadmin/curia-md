# create-curia

Scaffold a Curia AI-native documentation workspace into any repository — one command, two questions, then it is yours.

## 是什么

Curia 是一套可移植到任何项目的 AI 原生文档制度：开发与管理文档统一收在 `.agents/`，只维护一份，经符号链接分发给 Claude Code、Codex 等 agent CLI，类型、模板、状态机与门禁由 `.agents/doc-types.json` 注册表驱动。`create-curia` 是它的脚手架：把制度模板生成进你的仓库，生成后的内容即你的项目，随意修改。

## 为什么做成生成器

Curia 的模型是「拿走即你的、改就是正规用法」，没有内核/插件/安装器分层，抽象只体现在规范与默认值的质量里。所以本包只在 `npm create curia` 那一刻提问与落盘：生成后引擎零依赖裸 node 运行，与包再无关系；本工具没有 `upgrade`、`check` 之类的驻留子命令，也不承诺任何兼容性——同步靠 fork-and-own（重开 init 到新目录 diff，或 git cherry-pick）。

## 三步上手

1. 在目标仓库运行 `npm create curia`（等价 `npx create-curia`）；`--dir <path>` 指定目标目录，CI 里加 `--defaults` 直通。
2. 回答两个问题：生成哪些 CLI 桥（Claude Code / Codex / 全部，默认全部）；额外根目录（逗号分隔，如 `src,apps`，写入注册表 `rootDirs` 封闭集）。
3. 按收尾提示写第一篇（`node scripts/new-doc.mjs --type <type> --topic <主题>`；决策笔记用 write-note 技能）并跑 `node scripts/run-checks.mjs`——全绿即接入完成。

`init` 会代跑 `node scripts/install-hooks.mjs` 装 pre-commit 门禁；目标还不是 git 仓库时，它会提示你先 `git init` 再补装。

## 生成后改哪里

规则在 `AGENTS.md` 与 `.agents/README.md`，术语在 `.agents/GLOSSARY.md`，类型系统在 `.agents/doc-types.json`（唯一权威；改完跑 `node scripts/gen-doc-types.mjs` 重生成投影），门禁与工具在 `scripts/`。结构、契约、流程都可以改，不需要迁就本工具。

## 领域守卫示例

模板自带 `scripts/check-migrations.mjs` 与 `scripts/check-db-ledger.mjs`——它们是从参考实现带出的示例领域守卫（迁移与台账），示范「项目如何加自己的守卫」；用不到就删掉这两个文件，并从 `scripts/run-checks.mjs` 的 `CHECKS` 清单里删掉对应两行。

## 红线

生成器，不是运行时：`init` 只提问与落盘；生成物不 `import` 本包任何模块；本包 `dependencies` 为空，交互只用 node 内置 `readline/promises`——生成后的项目零依赖裸 node 运行。

## 致谢

模板与规范提炼自 参考实现仓 的参考实现。
