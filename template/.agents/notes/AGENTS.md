# AGENTS.md — .agents/notes 决策记录树

Agent Note 是 agent 写的 RFC 式决策记录：沉淀代码与文档装不下的「为什么」与「放弃了什么」。完整规格见 [README.md](README.md)，格式与目录由 `scripts/check-agent-notes.mjs` 强制。

**动手重构/选型前先搜笔记**——含 `rejected/`，可能是被否决过的方案：

```bash
rg --hidden -g '!.agents/notes/archived/**' -g '!**/2026-10-02-session-transcripts/**' -g '!**/2026-10-02-qoder-intl-docs/**' -g '!doc-types.md' <关键词> .agents/notes/
```

- **每篇新笔记触发 supersession 检查**：先 rg 搜活跃树（排除 archived/），当场分类——无关 / 部分重叠（互链）/ 完全吸收（合并或归档）/ 过时提案（转 rejected）——分类结论与新笔记同批落盘。
- **禁建全局 INDEX.md**；检索一律用上面的 rg 命令。
- **只写决策级内容**：行为、架构、契约、流程、测试策略、格式的取舍与后果。机械改动、执行流水账、进度汇报不写（红线清单见 README）。
- **规则行尾「因果见[相对链接]」**：即该条款决策因果的笔记出处，反查从它开始。
- 写/改笔记后必须跑 `node scripts/check-agent-notes.mjs`；提交前跑 `node scripts/run-checks.mjs`。
- `archived/` 是冻结历史快照：永不修改，不作为当前 authority。
