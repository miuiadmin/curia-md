# curia — 工作区规则

Curia 是独立的文档管理方案仓：规范、检查脚本、脚手架与设计导读都在这里；采用方（含参考实现兼采用方 参考实现仓）拿走载荷副本后自行维护（fork-and-own）。

维护契约的唯一权威是 [README.md](README.md)「维护这个包的人读这里」——红线、版本纪律、验收与分发边界都在那一节，动手前先读。

- 包内任何文件改动同批跳 [package.json](package.json) 的 patch 号；`guide/` 改动同批跳 [guide/README.md](guide/README.md) 开头的版本号。
- `template/` 是手工维护的一等资产，不从采用方仓抽取。
- `史料/` 是冻结史料：不改写、不修链接、不参与发布与门禁；选材与边界见 [史料/README.md](史料/README.md)。
- 不发布到公共 registry（`private: true` 常设）；发布制品以 `curia-v<版本>` tag 记录。