# skills/ — 可复用的干法

**装什么**：按需加载的流程与准则。同一件事的两个视角同住一个技能目录——`SKILL.md` 给智能体（YAML frontmatter 决定何时被触发），`RUNBOOK.md` 给人（前置条件、有序步骤、每步的可观察验证、失败恢复）。

**不装什么**：事实与运行时契约（→ [../research/](../research/)）、决策因果（→ [../notes/](../notes/)）、一次性任务清单（→ [../plans/](../plans/)）、模板骨架（→ [../templates/](../templates/)）。

## 两个类型

| Type | 文件 | 谁读 | 关键约束 |
|---|---|---|---|
| `skill` | `<name>/SKILL.md` | 各 agent CLI 经桥扫描加载 | frontmatter 的 `name` 必须等于目录名；`description` 必须写清「什么时候用我」，不是「我是什么」 |
| `runbook` | `<name>/RUNBOOK.md` | 人 | 必填 `Verified:`——按手册跑过一遍并看到预期结果的日期，超期报警 |

步骤只写一份：两个视角同住时，另一份链接过来，不复制。

## 加一个技能

```bash
node scripts/new-doc.mjs --type skill --name <kebab-name> --title "<标题>"
node scripts/new-doc.mjs --type runbook --name <kebab-name> --title "<标题>"
```

## 桥的代价

本目录经符号链接暴露给 Claude Code 与 Codex，Pi 与 Codex 还原生读取它；完整性由 `check-doc-types` 校验（目标登记在[注册表](../doc-types.json)的 `bridges`）。代价是**本目录下不要放与技能无关的文件**——它们会被一起分发给每个 CLI。
