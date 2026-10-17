# skills/ — 可复用的干法（skill / runbook）

**装什么**：按需加载的流程与准则。同一件事的两个视角同住一个技能目录——`SKILL.md` 给 Agent（frontmatter 决定何时被触发），`RUNBOOK.md` 给人（前置条件、步骤、每步验证、失败恢复）。

**不装什么**：事实与运行时契约（→ [../research/](../research/)）、决策因果（→ [../notes/](../notes/)）、一次性任务清单（→ [../plans/](../plans/)）、骨架实物（→ [../templates/](../templates/)）。

## 两个类型

| Type | 文件 | 谁读 | 关键约束 |
|---|---|---|---|
| `skill` | `<name>/SKILL.md` | 各 CLI 经桥扫描加载 | frontmatter 的 `name` 等于目录名；`description` 写清「什么时候用我」，不是「我是什么」 |
| `runbook` | `<name>/RUNBOOK.md` | 人 | 每步要有可观察验证；失败路径要有恢复动作 |

步骤只写一份：两个视角同住时，另一份链接过来，不复制。骨架实物见 [skill 骨架](../templates/skill.md) 与 [runbook 骨架](../templates/runbook.md)。

## 加一个技能

```bash
node .agents/tools/new-doc.mjs --type skill --topic <kebab-name>
node .agents/tools/new-doc.mjs --type runbook --topic <kebab-name>
```

## 桥的代价

本目录经符号链接暴露给 Claude Code 与 Codex（`.claude/skills`、`.codex/skills`）；Codex 也原生读取 `.agents/skills/`。代价是**本目录下不要放与技能无关的文件**——它们会被一起分发。
