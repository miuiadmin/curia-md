# create-curia

Scaffold a Curia 2.2 documentation workspace into any repository — copy, bridge, done.

## 是什么

Curia 是一套可移植的文档管理方案：两根布局（`.agents/` 管过程与制度，`docs/` 管外部事实与知识）、9 类文档、3 行头块，配一支轻量检查脚本。`create-curia` 把这份载荷复制进你的仓库；生成后的内容归你的项目维护。

## 三步上手

1. 在目标仓库运行 `npm create curia`（等价 `npx create-curia`）；未发布时从源码运行 `node create-curia/bin/init.mjs --dir <目标目录>`。
2. `init` 复制载荷并创建三个桥符号链接（`CLAUDE.md`、`.claude/skills`、`.codex/skills`）；被占用的路径打印手工命令并跳过，既有文件一律不覆盖。
3. 读 `.agents/README.md`（规范全文）按「规范格式（骨架）」手抄第一篇文档；自检跑 `node .agents/tools/check-docs.mjs`（可选）；要提交拦截，自己写一行 pre-commit（见规范「钩子归采用方」）。

## 参数

- `--dir <path>` — 目标目录（默认当前工作目录）。
- `--defaults` — 兼容保留：`init` 无提问，等价默认行为（CI 直传无害）。
- `-h, --help` — 帮助。

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

`template/` 内另有 3 个桥符号链接（`CLAUDE.md`、`.claude/skills`、`.codex/skills`）：模板目录自足（整目录直拷即为可用工作区）；`init` 复制时跳过它们，由桥步在目标仓重建。21 个文件含 7 个 `.gitkeep` 占位（空家与归档区的目录占位）。

## 红线

- **生成器，不是运行时**：`init` 只复制载荷、建桥与打印下一步——不提问、不装钩子、不运行载荷内任何脚本；生成物不 `import` 本包任何模块。
- **零依赖**：本包 `dependencies` 为空，只用 Node 内置模块（Node ≥ 18）；载荷脚本同样零依赖、不联网。
- **fork-and-own**：生成后目标仓与本包再无关系；没有 `upgrade` / `check` 驻留子命令，同步靠重开 init 到新目录 diff，或 git cherry-pick。
- **不覆盖**：目标已存在且内容不同的文件一律保留并列出；桥被占用时打印 `ln -s` 命令后跳过。

## 验收（实现方）

以下判据逐条可跑，验收对象是载荷自身，不构成采用方义务；`check-docs` 指载荷内 `.agents/tools/check-docs.mjs`。

1. **空集断言**：`mkdir -p /tmp/empty-docs && node .agents/tools/check-docs.mjs --strict /tmp/empty-docs` → 输出「未检查任何文件」，退出码 2。
2. **正例**：在载荷树（`template/`）或载荷生成的仓库里跑 `node .agents/tools/check-docs.mjs --strict` → 退出码 0。
3. **根锚点断言**：默认调用下根锚点缺失（根下 `.agents/` 改名后重跑）→ 输出「根锚点缺失」，退出码 2，不静默降级。
4. **零依赖**：`rg -n "from ['\"]|require\(|import\(" template/.agents/tools/check-docs.mjs` → 只应出现 `node:` 前缀的内置模块名。
5. **可移植**：把 `.agents/` 拷进无 git、无 `node_modules` 的临时目录，跑 `node .agents/tools/check-docs.mjs --strict` → 与源目录同一判定。

## 发布边界

包尚未发布到 npm，当前设置 `private: true` 使用 npm 原生防误发限制；这不妨碍本地打包、离线安装与生成，也不是私有 registry 的发布或访问权限设置。正式发布前须先由 Owner 确认包名、registry、版本、许可证与仓库地址，再显式移除该标记；发布前按「三步上手」第 1 条的源码入口运行。
