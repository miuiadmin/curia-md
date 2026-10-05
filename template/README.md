# Curia — AI 原生文档工作区模板

开发与管理文档统一收在 `.agents/`，只维护一份，经符号链接分发给各 agent CLI；制度提炼自 参考实现仓 参考实现：抽象在注册表驱动的规范与默认值里，没有内核、插件或安装器——拿走即你的，改就是正规用法。

## 三步上手

1. 拷 `.agents/`、`scripts/`、`AGENTS.md`、桥（`CLAUDE.md`、`.claude/`、`.codex/`）与 `.gitignore` 通用段进你的仓库，跑 `node scripts/install-hooks.mjs`。
2. 改注册表三个取值：`rootDirs`、`bridges`、GLOSSARY 种子词；跑 `node scripts/gen-doc-types.mjs` 重生成投影。
3. 写第一篇 `node scripts/new-doc.mjs --type <type> --topic <主题>`（决策笔记走 write-note 技能）；`node scripts/run-checks.mjs` 全绿即接入。

## 改哪里

规则在 `AGENTS.md` 与 `.agents/README.md`，术语在 `GLOSSARY.md`，类型系统在 `doc-types.json`（唯一权威），门禁与工具在 `scripts/`。示例领域守卫 `check-migrations` 与 `check-db-ledger`（迁移与台账）用不到就删干净：删两文件、`run-checks.mjs` 的 `CHECKS` 去两行、`self-test.mjs` 里搜 `check-migrations`/`check-db-ledger`/`migrations/seq`/`ledger/evidence` 删对应夹具，否则 `--self` 红。
