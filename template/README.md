# Curia — AI 原生文档工作区模板

开发协作文档收在 `.agents/`，知识与结果收在按需创建的 `docs/`；API、手册、方法、事实、台账和记录无需先有过程。原项目的类型、冻结与审批规则继续生效。制度提炼自 参考实现仓 参考实现，生成后归你的项目维护。

## 三步上手

1. 拷 `.agents/`、`scripts/`、`AGENTS.md`、桥（`CLAUDE.md`、`.claude/`、`.codex/`）与 `.gitignore` 通用段进你的仓库，跑 `node scripts/install-hooks.mjs`。
2. 改注册表三个取值：`rootDirs`、`bridges`、GLOSSARY 种子词；跑 `node scripts/gen-doc-types.mjs` 重生成投影。
3. 知识与结果可直接写入按需创建的 `docs/`，不要求过程头块或前置计划；受登记类型约束的过程文档才用 `node scripts/new-doc.mjs --type <type> --topic <主题>`（决策笔记走 write-note）。检查用 `node scripts/run-checks.mjs --all`；提交前仍须精确暂存并校验，空检查或静态通过不等于事实已核实。

## 按需能力

普通阅读使用 [read-doc](./.agents/skills/read-doc/SKILL.md) 与 [curia-workflow](./scripts/curia-workflow.mjs)：显式选集、覆盖与缺口直接返回，不自动创建过程文档或 Run；按需声明允许范围后可补读已登记依赖，普通阅读不扩大选集。原位纳管的可选 Registry 合同归 [curia-instance](./scripts/curia-instance.mjs)，不另建一级目录。

需要核对两个原载荷时，显式使用 [curia-verify](./scripts/curia-verify.mjs)，命令见 `node scripts/curia-verify.mjs --help`；支持 JSON 值、完整字节比较，以及按 Registry 字段绑定的显式取代图与引用检查；先声明非敏感范围，不新增受管面或 Run。本地等值核对不代替业务真实性与认证身份。

需要留痕时才启用 [curia-records](./scripts/curia-records.mjs) 的 manual-observation 分支；本地等值核验使用显式 verify 分支，历史更正与重试使用 history 查询，不接受导入 JSON 冒充实际核验。命令见 `node scripts/curia-records.mjs --help`；记录目录绑定在唯一 Registry 的 `instance.recordStore`，必须是已登记面的子目录，默认不启用。[记录守卫](./scripts/check-records.mjs) 校验追加与 Git 基线冻结，不代表事实认证或受保护发布；普通项目没有额外运行时。

显式影响检查使用 [curia-checks](./scripts/curia-checks.mjs) 的 plan / run：逐个选择已登记 guard，确认输入和风险后顺序执行，一个批次只追加一个 Run，覆盖缺口与空检查不算通过。它不由普通阅读触发，不是缓存、业务核验或受保护执行。

项目原生检查使用 [curia-guards](./scripts/curia-guards.mjs) 的 plan / run：先确认真实输入与风险，再运行登记命令，不由普通阅读触发。它保留原生退出码与 authority，不把受信本地执行或进程组清理称为安全隔离。

## 改哪里

规则在 `AGENTS.md` 与 `.agents/README.md`，术语在 `GLOSSARY.md`，类型系统在 `doc-types.json`（唯一权威），门禁与工具在 `scripts/`。默认只含通用文档检查与自证，不带参考项目的迁移 / 台账守卫、版本工具或运行时矩阵。项目检查按需登记到唯一 Registry 的 `instance.guards`，显式确认后执行，不默认接入提交钩子。
