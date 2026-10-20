# create-curia

Scaffold a Curia 2.2 documentation workspace into any repository — copy, bridge, done.

## 是什么

Curia 是一套可移植的文档管理方案：两根布局（`.agents/` 管过程与制度，`docs/` 管外部事实与知识）、9 类文档、3 行头块，配一支轻量检查脚本。`create-curia` 把这份载荷复制进你的仓库；生成后的内容归你的项目维护。

## 三步上手

1. 把载荷复制进目标仓库：`node create-curia/bin/init.mjs --dir <目标目录>`；或直接把 `create-curia/template/` 的内容拷到目标仓根（非空树用 `cp -an` 保留既有文件）。两种形态等价，都是本包的分发方式——**但经 `npm pack` 出的 tarball 形态不等价**：`npm pack` 会静默丢弃载荷里的 3 个桥符号链接，从 tarball 直拷得到的是**零桥工作区**（`cp -an` 退出码 0，不报错）。tarball 采用方一律走 `init`，或手工补三条 `ln -s`。
2. `init` 复制载荷并创建三个桥符号链接（`CLAUDE.md`、`.claude/skills`、`.codex/skills`）；被占用的路径打印手工命令并跳过，既有文件一律不覆盖。
3. 读 `.agents/README.md`（规范全文）按「规范格式（骨架）」手抄第一篇文档；自检跑 `node .agents/tools/check-docs.mjs`（可选）；要提交拦截，自己写一行 pre-commit（见规范「钩子归采用方」）。

## 参数

- `--dir <path>` — 目标目录（默认当前工作目录）。
- `--defaults` — 兼容保留：`init` 无提问，等价默认行为。
- `-h, --help` — 帮助。

退出码：`0` 载荷落地且三条桥全部接上；`1` 复制 I/O 失败；`2` 用法与守卫；`3` 桥未接上——写操作完成但机制没接上。**把 `init` 接进 CI 时注意**：空宿主上直传无害，宿主已有桥路径被占用时返回 `3`、流水线变红——这正是要的：「装了」与「接上了」不该共用退出码 `0`。

## 交付物

```text
create-curia/
├── bin/init.mjs            # 生成器入口：复制 + 桥 + 下一步
├── template/               # 分发载荷（21 个文件、1 支脚本）
│   ├── AGENTS.md           # 通用规则集（8 条）
│   ├── docs/README.md      # 知识根约定
│   └── .agents/
│       ├── README.md       # 规范全文（唯一权威，骨架文本在内）
│       ├── GLOSSARY.md     # 术语种子
│       ├── notes/AGENTS.md # 笔记树入口（agent 原生读取）
│       ├── tools/          # check-docs.mjs（唯一配套脚本）
│       ├── plans/ research/ notes/ archive/
│       └── skills/         # write-doc / write-note / prose-standard
└── package.json
```

`template/` 内另有 3 个桥符号链接（`CLAUDE.md`、`.claude/skills`、`.codex/skills`）：**源码树形态**下模板目录自足（整目录直拷即为可用工作区）；`init` 复制时跳过它们，由桥步在目标仓重建。**`npm pack` 出的 tarball 里没有这 3 条链接**（npm 静默丢弃符号链接，零 warning）——tarball 形态必须走 `init`，直拷不建桥。21 个文件含 7 个 `.gitkeep` 占位（空家与归档区的目录占位）。

## 红线

- **生成器，不是运行时**：`init` 只复制载荷、建桥与打印下一步——不提问、不装钩子、不运行载荷内任何脚本；生成物不 `import` 本包任何模块。
- **零依赖**：本包 `dependencies` 为空，只用 Node 内置模块（Node ≥ 18）；载荷脚本同样零依赖、不联网。
- **fork-and-own**：生成后目标仓与本包再无关系；没有 `upgrade` / `check` 驻留子命令，同步靠重开 init 到新目录 diff，或 git cherry-pick。
- **不覆盖**：目标已存在且内容不同的文件一律保留并列出；桥被占用时打印 `ln -s` 命令后跳过。

## 版本纪律

`package.json` 的 `version` 是**制品身份**，不是依赖关系——载荷字节任何改动（含 `template/` 下任一文件）必须同批跳 patch 号，使「`create-curia@<版本>`」唯一对应一份字节。此前 `0.3.0` 曾跨三份不同字节（2.2 落地之后载荷又改过两次），「无损迁移」因此没有可核对的参照物；本纪律自 `0.3.1` 起生效。

发布制品时记下 `shasum -a 512`，采用方记一行「采用 `create-curia@<版本>`，sha512-…」即获得可复核的身份。发布前另跑一次核对（`npm pack` 丢符号链接是预期行为，不是错误）：

```bash
npm pack --pack-destination <tmp>
tar -xzf <tmp>/create-curia-<版本>.tgz -C <tmp>
diff -rq <tmp>/package/template template    # 预期差异恰为 3 条桥（CLAUDE.md、.claude/skills、.codex/skills）
```

## 验收（实现方）

以下判据逐条可跑，验收对象是载荷自身，不构成采用方义务；`check-docs` 指载荷内 `.agents/tools/check-docs.mjs`。

1. **空集断言**：`mkdir -p /tmp/empty-docs && node .agents/tools/check-docs.mjs --strict /tmp/empty-docs` → 输出「未检查任何文件」，退出码 2。
2. **正例**：在载荷树（`template/`）或载荷生成的仓库里、于该树根下跑 `node .agents/tools/check-docs.mjs --strict` → 退出码 0。
3. **根锚点断言**：在自身不含 `.agents/` 的目录里跑默认调用（如 `cd /tmp && node <路径>/check-docs.mjs`）→ 输出「根锚点缺失」，退出码 2，不静默降级、不向父目录上溯。
4. **零依赖**：`rg -n "from ['\"]|require\(|import\(" template/.agents/tools/check-docs.mjs` → 只应出现 `node:` 前缀的内置模块名。
5. **可移植**：把 `.agents/` 拷进无 git、无 `node_modules` 的临时目录，跑 `node .agents/tools/check-docs.mjs --strict` → 与源目录同一判定。
6. **桥断言**：`init` 到空宿主 → 退出码 0、汇总行「桥 3 条：新建 3、已就位 0、未接上 0」；`init` 到已有 `CLAUDE.md` 真文件的宿主 → 退出码 3 并具名列出未接上的桥；对同一宿主重跑 → 「已就位 3、未接上 0」、退出码 0。
7. **版本纪律目检**（发布前，人工）：`git log -1 --stat -- create-curia/template` 显示载荷有改动，而 `package.json` 的 `version` 未随之跳号 → 制品身份与字节脱钩，不许发布。

## 分发边界

本包**不分发到公共 registry**，分发方式是源码入口、载荷直拷与发布制品（tarball，见「版本纪律」）三条。`package.json` 的 `private: true` 是常设的防误发限制，不是待移除的过渡标记——不要移除它。

**包名 `create-curia` 在公共 registry 无人占用，而机器默认指向公共源**——一旦被抢注，`npm create curia` 会在配置如默认的机器上静默拉取并执行第三方代码。本包因此**不宣传 `npm create curia` 这条用法**（它在本包不发布的前提下本来也不可用）。`repository` 字段的占位值不影响使用。
