# Curia — 智能体工作区规则

本项目由 Curia 管理：开发与管理文档统一收在 `.agents/`，只维护一份，符号链接分发给各 agent CLI；外部事实文档（仓外系统的登记与定义，当前版即唯一真相）住根目录 `docs/`，准入与约定见 docs/README.md。

**放东西之前先读总规格：[`.agents/README.md`](./.agents/README.md)。**

## 四句口诀

- **没做的** → `.agents/plans/`（`draft → active → done → superseded`）
- **做完的** → `.agents/research/`（`current → historical → superseded`）
- **为什么** → `.agents/notes/`（`proposed | implemented | rejected | archived` × 6 类）
- **过时的** → 状态翻转，或迁 `.agents/archive/` 封存；**永不删除**
- （**不承诺的** → `.agents/future/`）
- （**外部事实** → 根 `docs/`：仓外系统的登记与定义；当前版即唯一真相、无状态机，变更直接改、走 MR 评审；为什么变仍记 `.agents/notes/`）

家决定放哪，**类型决定是什么**：`Type:` 头绑定模板、状态机、必备节与时效，全部登记在 [.agents/doc-types.json](./.agents/doc-types.json)（可读投影 [.agents/doc-types.md](./.agents/doc-types.md)）。

## 硬规则

1. **一事实一归属**：同一条事实只有一个家；不复制、不双写。
2. **非平凡变更同批写笔记**：改变行为、结构、契约、流程、工具、格式的改动，必须在同一批变更中新增/更新 `.agents/notes/` 笔记；红线豁免见 [notes/README](./.agents/notes/README.md)。
3. **写笔记前先搜**：`rg --hidden -g '!.agents/notes/archived/**' -g '!**/2026-10-02-session-transcripts/**' -g '!**/2026-10-02-qoder-intl-docs/**' -g '!doc-types.md' <关键词> .agents/notes/`——**含 rejected/**（可能已被否决过）；新笔记必须做 supersession 检查。
4. **禁全局 INDEX.md**：目录即索引，检索一律用 rg。
5. **引用一律相对 Markdown 链接**（可机械校验；别写裸路径）。
6. **提交前跑门禁**：`node scripts/run-checks.mjs`（文档门禁）；装成 pre-commit 钩子用 `node scripts/install-hooks.mjs`（幂等；钩子校验暂存内容）。
7. **精确暂存、看清推送范围**：`git add <具体路径>`；禁止 `git add -A` / `git add .`；不提交不属于本任务的改动。同仓常有别的会话在写：动手前 `git status`，别人的未跟踪与已改文件一律不碰；`git push` 推的是整条分支，先 `git log origin/main..HEAD` 确认没把别人的提交一起发布（因果见并行会话笔记）。
8. **点目录代价**：`.agents/` 为点目录——ripgrep 要 `--hidden`，Finder 用 `Cmd+Shift+.`；GitLab 网页与 VS Code 正常显示。
9. **写作与格式**：一段一物理行、中英之间加空格、全角标点、禁 emoji；术语查 [GLOSSARY](./.agents/GLOSSARY.md)；细则见 [prose-standard](./.agents/skills/prose-standard/SKILL.md)。
10. **建档用脚手架**：`node scripts/new-doc.mjs --type <type> --topic <topic>`——头块字段、必备节、状态取值与复核时效都由类型注册表约束，手抄骨架会被门禁拦下；写作流程见 [write-doc](./.agents/skills/write-doc/SKILL.md)。
11. **机制冻结**：`.agents/` 机制与 `scripts/` 只在两类信号下动——门禁漏了真问题、流程税高到开始少写文档；「还能更好」不是理由，预算还给产品。因果见冻结与二轮精简笔记。
12. **本地不跑运行时**（Owner 2026-10-08，2026-10-09 收窄措辞）：一切运行时——数据库、Docker、服务、集成测试栈——跑在调试云双环境（test 栈 `curia-test-*` / dev 栈 `curia-dev-*`，见 deploy/debugcloud），内存与配置都够；本地只查看、编辑与同步文件，不执行构建、单测或重门（`scripts/deep-checks.mjs` 的 PG 矩阵等）；**文档门禁不在此列**——它是零依赖静态检查，按硬规则 6 随 pre-commit 在本地跑，改去云上跑反而验的是落后树；所有重验证经 SSH 在调试云执行，以服务器统一开发修订为准。起本地 Docker/PG 即违规，显式矩阵（`scripts/deep-checks.mjs`）的 DSN 指向调试云而非 127.0.0.1 容器。因果见本地无运行时笔记与文档门禁本地跑笔记。

## 桥

`CLAUDE.md`、`.claude/skills`、`.codex/skills` 是指向 `AGENTS.md` / `.agents/skills/` 的符号链接（不是副本，门禁校验其存在与指向）；Pi 与 Codex 还原生支持 `.agents/skills/`。各 CLI 的完整消费方式见[总规格的「桥」节](./.agents/README.md)。

## 结构速览

```text
<你的项目>/
├── AGENTS.md           # 本文件（hot-path 规则）；CLAUDE.md 是其符号链接
├── README.md
├── .agents/            # ★ 开发管理文档唯一内容根（总规格见其 README）
└── scripts/            # 门禁与工具
```

子目录如需更细规则，放该目录的 `AGENTS.md`（只能追加约束，不得放宽本文件）。
