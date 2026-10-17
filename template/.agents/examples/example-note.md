# Agent Note: 解析器选型定案

Status: implemented

## Problem

自研解析器在表格与嵌套列表上行为漂移，且边界情形修复成本持续上升；需要一个替换方案，同时不引入运行时依赖。

## Decision

选用 A（v3.1.0）替换自研解析器：A 通过 CommonMark 全量用例、零运行时依赖，解析耗时仍在预算内。自研解析器删除，原测试夹具迁移为 A 的断言。

## Alternatives considered

- **B（v2.4.2）**：表格列数不齐时静默截断，错误不可观测，落选。
- **继续维护自研解析器**：边界情形修复成本持续上升，且无测试套件背书，落选。

## Consequences

- 表格列数不齐的历史文档在 A 的严格模式下会报错，需要修一遍。
- 解析耗时上升约 40%，压测仍在预算内；语料翻倍时需要重测。

## Related

- 选型依据：[解析器选型调研](../examples/example-survey.md)（示例）。
- 规范全文：[.agents/README.md](../README.md)。
