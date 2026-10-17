# archive/ — 冻结留档区

**装什么**：已退役的整篇文档（`plans/` `research/` `future/` 的冷历史），类型为 `frozen`。**只归档、不删除。**

**不装什么**：notes 的归档——它们走 [../notes/archived/](../notes/archived/)（同一套哈希封印机制，另一处归属）。

## 归档操作

```bash
node scripts/archive-doc.mjs .agents/plans/2026-01-01-old-plan.md --subdir plans --dry-run   # 先看结果
node scripts/archive-doc.mjs .agents/plans/2026-01-01-old-plan.md --subdir plans             # 执行
```

**同批归档多篇时把路径一次给全**（`node scripts/archive-doc.mjs <路径1> <路径2> … --subdir plans`）：一次移动、一次封印、一次报告，且互相引用的两篇才知道对方要搬到哪，不会各自指向已被搬走的位置。

工具做五件事：移动到本目录（保留原文件名，`--subdir` 可按品类分子目录）、在头块末尾插入 `Archived: YYYY-MM-DD`（原有 `Type:`/`Status:` 保留，作为它退役前的身份）、**重写文档自身的相对链接**、调 `seal-notes-archive.mjs --target archive` 重新封印、扫出全仓指向旧路径的入链清单。

**第三步不能省。** 归档件比原件深一层（`research/x.md` → `archive/research/x.md`），文中所有相对链接的基准跟着变。不重写就会出两类事故：其一，跨 `.agents/` 的链接当场失效，而 `check-links` 是扫归档区的，门禁必红；其二，更隐蔽的一类——`../README.md` 从 `archive/plans/` 解析到 `archive/README.md`，**那个文件存在**，于是门禁不报而链接静默指错。封印是 append-only 的单向棘轮（`seal-notes-archive.mjs` 拒绝封印后的任何改动，也没有 `--force`），所以「搬完再修」这条退路不存在——真要补救只能删掉 manifest 条目重来。

**入链必须在同一批变更里修完**（改指替代文档；没有替代者就指向归档件本身，它仍是可发现的历史），否则 `check-links` 会红。手工归档也只做这四件事：移动、加 `Archived:` 行、重写自身相对链接、重新封印并修入链。

之后**永久冻结**：不编辑、不翻译、不重排、不移动、不删除；它不再是对当前行为的权威，仅作历史快照。门禁逐文件核对 sha256，并校验封印相对 git 基线只增不改。

只接受 `plans/` `research/` `future/` 下的文档：笔记走 [../notes/archived/](../notes/archived/)，技能与各家 README 是活的入口页、不归档。

## 为什么不是删除

「做完了就不用了、但回顾时可能还会看」是常态需求。归档 = 可发现的历史；删除 = 丢失上下文。**当不确定时，归档。**
