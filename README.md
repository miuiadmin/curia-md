# create-curia

Scaffold a Curia AI-native documentation workspace into any repository — one command, two questions (plus overwrite confirmations when files already exist), then it is yours.

## 是什么

Curia 是一套可移植的 AI 原生文档制度。默认只用 `.agents/` 管开发协作，`docs/` 管知识与结果：API 手册、使用说明、方法、事实、台账和记录都可以直接维护最终内容，不为纳管补造计划或过程日志。类型差异放在二级目录或按需配置里，不为每类文档增加一级根。`create-curia` 把模板生成进你的仓库，生成后的内容归你的项目维护。

## 为什么做成生成器

Curia 的模型是「拿走即你的、改就是正规用法」，没有内核/插件/安装器分层，抽象只体现在规范与默认值的质量里。所以本包只在 `npm create curia` 那一刻提问与落盘：生成后引擎零依赖裸 node 运行，与包再无关系；本工具没有 `upgrade`、`check` 之类的驻留子命令，也不承诺任何兼容性——同步靠 fork-and-own（重开 init 到新目录 diff，或 git cherry-pick）。

生成的 AGENTS 不继承参考项目的调试云、test / dev 栈或本地运行限制，载荷不包含参考项目的 deep-checks 运行时矩阵。Curia 提供静态文档门禁；业务构建、测试、服务与数据库运行位置由采用项目决定。

## 运行与发布边界

运行版本要求以 [package.json](./package.json) 的 engines 为准。包和生成后的文档引擎只使用 Node 内置模块，不依赖参考仓的运行环境。最低版本须用真实安装包及生成实例验证，不能以维护者当前版本通过来代替。

包当前设置 `private: true`，使用 npm 原生防误发限制；这不妨碍本地打包、离线安装与生成，也不是私有 registry 的发布或访问权限设置。正式发布前须先由 Owner 确认下述目标信息，再显式移除该标记；工具不替 Owner 做这一步。该标记不禁止 npm 自身的元数据访问，也不替代网络和凭据边界。

本仓的打包、离线安装和生成验证不表示已向公共 npm registry 发布。以下 npm 命令是发布目标确认后的采用说明；发布前还须确认包名、registry、版本、许可证和仓库地址，示例元数据不是有效发布目标，也不构成发布授权。未发布时，从参考仓通过[源码入口](./bin/init.mjs)运行 `node create-curia/bin/init.mjs --defaults --dir <目标目录>`，不必访问 npm registry。

## 三步上手

1. 在目标仓库运行 `npm create curia`（等价 `npx create-curia`）；`--dir <path>` 指定目标目录，CI 里加 `--defaults` 直通。
2. 回答两个问题：生成哪些 CLI 桥（Claude Code / Codex / 全部，默认全部）；额外根目录（逗号分隔，如 `src,apps`，写入注册表 `rootDirs` 封闭集）。这两问之外，仅当目标已有 `.agents/`、`AGENTS.md` 或桥路径被占用时，会追加逐项覆盖确认（默认否：保留现有）。
3. 按内容选入口：知识与结果直接放在按需创建的 `docs/`，保留原格式，不强制 Type、Status 或过程头块；受登记类型约束的过程文档才使用 `node scripts/new-doc.mjs --type <type> --topic <主题>`，决策笔记用 write-note。原项目的类型、冻结与审批要求继续生效。检查用 `node scripts/run-checks.mjs --all`；提交前仍须精确暂存目标文件并校验，空范围或静态绿灯不能代签内容核实及所有扩展能力。

`init` 会代跑 `node scripts/install-hooks.mjs` 装 pre-commit 门禁；目标还不是 git 仓库时，它会提示你先 `git init` 再补装。

目标仓完成 `git init` 后，可用 `node scripts/curia-query.mjs --coverage` 查看 Curia 2.0 P1 的只读基础纳管报告：它默认只看已入库文件，未入库内容可加 `--all`；需要链接覆盖时显式加 `--links`，该投影只声明 Markdown 内联基础 parser 的覆盖范围并保留未支持语法与格式缺口。报告按需生成 Envelope 投影，不写全局索引，也不改变 Curia 1.0 注册表。

## 日常阅读

以下命令在生成后、已初始化 Git 的目标仓库执行；`--all` 包含尚未入库但未被忽略的文件。

```bash
node scripts/curia-query.mjs --path .agents/README.md --all --coverage --json
node scripts/curia-workflow.mjs --path .agents/README.md --all --inventory --json
node scripts/curia-workflow.mjs --path .agents/README.md --all --json
```

阅读自己的文档时替换 `--path`，已知敏感内容先用 `--exclude` 排除。默认排除不是秘密检测器；普通阅读不执行原文命令、不外访、不调用模型、不落 Run。CLI 返回正文切片、范围和缺口，语义判断由读者完成；截断、未支持格式和未核实事实不能当作完成。

## 按需查阅

完整命令与约束只维护在[能力参考](./docs/reference.md)，普通采用不必逐项启用。

- 存量文档：[原位映射](./docs/reference.md#可选原位纳管与原生状态)、[JSON 原件](./docs/reference.md#可选-json-原件)、[纸档与附件登记](./docs/reference.md#可选原格式与纸档登记)、[Office 抽取](./docs/reference.md#可选-office-原件数据抽取)。
- 查读与关系：[只读 workflow](./docs/reference.md#只读-workflow)、[依赖读取](./docs/reference.md#可选授权依赖读取)、[影响分析](./docs/reference.md#可选反向影响计划)、[变体与时间](./docs/reference.md#可选文档变体与生效时间)。
- 核验与留痕：[来源核验](./docs/reference.md#显式来源事实核验)、[核验记录](./docs/reference.md#可选事实核验记录与更正历史)、[项目检查](./docs/reference.md#显式项目-guard)。

## 生成后改哪里

规则在 `AGENTS.md` 与 `.agents/README.md`，术语在 `.agents/GLOSSARY.md`，类型系统在 `.agents/doc-types.json`（唯一权威；改完跑 `node scripts/gen-doc-types.mjs` 重生成投影），门禁与工具在 `scripts/`。结构、契约、流程都可以改，不需要迁就本工具。

## 默认边界与项目检查

默认布局允许 `.agents/` 与按需创建的 `docs/`，不要求先建空知识树；新增其他项目目录仍需登记 `workspaceLayout.rootDirs`。根 `docs/README.md` 使用无头块的目录说明，owner 等默认值放在实例或受管面配置，不给 README 强塞过程字段。

模板只携带通用文档检查与自证，不包含参考项目的迁移 / 台账守卫、版本工具、运行时矩阵或专属自证。生成后的 `run-checks` 只启用核心检查；原项目的规则和验收 authority 不因采用 Curia 而被替换或降级。

需要执行项目原生检查时，按[显式项目 guard](./docs/reference.md#显式项目-guard) 登记实际命令、输入范围、effects、privacy 与原生 parser，再逐次确认执行。不把来源正文当作执行授权，也不自动接入提交钩子；已有项目自己的强制检查继续由原项目维护。

生成器使用显式通用脚本清单，新出现在参考仓的脚本不会自动分发。Registry 的实例路径、owner、guard、适用性与记录存储绑定不带入新项目；实例只在采用方明确配置后启用。默认忽略规则不继承参考项目的目录或凭据入仓政策，文档检索示例也不携带参考语料的排除路径。

## 红线

生成器，不是运行时：`init` 只提问与落盘；生成物不 `import` 本包任何模块；本包 `dependencies` 为空，交互只用 node 内置 `readline/promises`——生成后的项目零依赖裸 node 运行。

## 致谢

模板与规范提炼自 参考实现仓 的参考实现。
