# Curia — AI 原生文档工作区模板

开发与管理文档统一收在 `.agents/`，只维护一份，经符号链接分发给各 agent CLI；可移植的文档制度提炼自 参考实现仓 的参考实现：抽象在注册表驱动的规范与默认值里，没有内核、插件或安装器——拿走即你的，改就是正规用法。

## 三步上手

1. 拷贝 `.agents/`、`scripts/`、`AGENTS.md`、桥（`CLAUDE.md`、`.claude/`、`.codex/`）与 `.gitignore` 通用段进你的仓库，跑 `node scripts/install-hooks.mjs` 装 pre-commit 门禁。
2. 改注册表三个取值：`rootDirs`（你的根目录）、`bridges`（你用的 CLI）、GLOSSARY 种子词；跑 `node scripts/gen-doc-types.mjs` 重生成投影。
3. 写第一篇：`node scripts/new-doc.mjs --type <type> --topic <主题>`（决策笔记走 write-note 技能，不走脚手架）；`node scripts/run-checks.mjs` 全绿即接入完成。

## 改哪里

规则在 `AGENTS.md` 与 `.agents/README.md`，术语在 `.agents/GLOSSARY.md`，类型系统在 `.agents/doc-types.json`（唯一权威），门禁与工具在 `scripts/`。领域守卫示例：`check-migrations.mjs` 与 `check-db-ledger.mjs` 是 参考实现仓 的示例领域件（迁移与台账），用不到就删文件并从 `scripts/run-checks.mjs` 的 `CHECKS` 清单去掉两行。
