# Curia 按需能力参考

[返回上手入口](../README.md)。本页保留可选能力的完整命令、前置条件、失败语义与限制；普通文档采用不要求先配置这些能力。

## 元数据与修订查询

生效配置只来自本实例实际读取的 `.agents/doc-types.json`，报告的 schema、布局、分类和来源身份必须绑定同一份配置。库接口 `buildInventory` 的旧第二参数只接受与该文件 JSON 数据同值的副本，作为兼容性校验而非覆盖；对象键序及普通／空原型差异不影响同值，数组顺序和数据类型仍须一致；不一致返回 `curia2/registry-source-mismatch`。实际文件的未知版本或非法结构仍失败，不能用调用方副本替代；同值副本的 authority 仍为 worktree-file，不另建 caller authority。该约束同时适用于元数据与路径盘点，CLI、默认参数和历史 Run 格式不变。

类型表生成目标由 Registry 的 `projection` 指定；在已纳管范围内，查询与阅读都按这个声明识别，不写死默认文件名。非目标文件仍按已有类型规则分类；投影分类不证明内容新鲜或事实已核实，新鲜度另用 `node scripts/gen-doc-types.mjs --check` 检查。记录区的冻结机制仍独立判断，生成文件不能借此获得可改写承诺。

[查询器](../template/scripts/curia-query.mjs)输出 `curia.inventory/3`，头块、映射 JSON 与显式链接扫描共享同一次读取。它从 Git 获取本地对象与路径元数据，不调用 diff-files、clean filter、textconv、hooks 或远程获取；工作树原始字节由稳定文件描述符读取。元数据、链接和摘要不是全文阅读或事实核验。 敏感、raw 和 ignored 对象以及漂移撤回的 Envelope 不公开逐文件 Git 内容 ID，`git.contentIdsWithheld` 为 true；tracked 与 mode 仍是路径元数据，空 ID 不表示文件未跟踪。

```bash
node scripts/curia-query.mjs --path docs/manual.md --coverage --json
node scripts/curia-query.mjs --path docs/api --path docs/methods --exclude docs/api/private --links --json
node scripts/curia-query.mjs --links --max-files 2048 --max-total-bytes 67108864 --strict --json
node scripts/curia-query.mjs --gap worktree-revision-unobserved --json
```

`--max-files`、`--max-file-bytes`、`--max-total-bytes` 在普通查询中约束元数据读取，默认分别为 2048 件、16 MiB、64 MiB，硬上限为 10000 件、16 MiB、256 MiB。头块与映射 JSON 的 parser 上限各为 64 KiB，链接为 16 MiB；预算不能放大 parser 支持范围。工作树和 HEAD 的 Registry 各有独立 1 MiB 限额，不计入文档预算。`coverage.metadataObservation` 报告实际打开数、计费字节、预算与隐私排除、稳定性；预算不足为 error，strict 不通过，不能证明完整适用性。

完整字节才产生 `curia.raw-worktree-revision/1` 的摘要与 raw Git blob OID，比较还包含 文件所有者可执行位。`worktreeModified` 仍是布尔或 null，但不再是 Git clean 归一化状态；`coverage.byWorktreeState` 使用 tracked-raw-equal、tracked-raw-different、tracked-state-unknown、untracked。前缀、未解析格式和未读对象保持未知，mode 差异只能证明变化，不补造完整摘要。解析失败不抹掉已取得的字节身份，也不把摘要相符升级为内容有效。普通查询的 strict 只拒绝 error，修订未知仍是 coverage gap；它不保证所有对象都完成修订比较。

`--path` 与 `--exclude` 在打开文档和消费元数据预算之前限定范围，接受可重复的规范仓内相对文件或目录，不接受通配；重叠目录不重复读取，排除优先。仅传 `--exclude` 时从默认盘点范围减去指定路径，不传两者则保留完整盘点。`--all` 仍只加入未忽略的 untracked；显式路径未匹配、选集为空或全被排除均保留 error，strict 退出 1，不自动扩大范围补读。类型、owner 等字段筛选仍发生在读取之后，结果行为空不等于输入范围为空。

`input.selection` 记录路径、排除、匹配与计数，`coverage.scope` 为 explicit-path-selection；覆盖统计只针对选中对象，不代表全仓。显式选集不能证明全局 canonical 唯一，已读到的冲突仍阻断；已选文档的时间求值继续有效。API 使用 `metadataSelection`，沿用 paths / exclusions / corpus 形状；旧 `selection` 仍只用于 paths-only，二者不能混用，显式元数据选集也不能与 `--allow-no-git` 混用。

默认敏感路径、raw、有效 ignored 对象不读载荷或输出摘要；完整盘点保留其名字和缺口，显式选集则将其排除。Registry、Git、受管面布局和 authority 路径仍按实例观察；链接目标只检查路径，不读取目标正文。路径仍可能敏感，本地单读者查询不是多读者权限过滤器。已观察原件、配置、忽略或 raw 排除等输入漂移时撤回整组元数据、链接与修订证据；未选文档正文不参与本次元数据后检，实例级变更仍可能使整组失效。局部查询不是跨次缓存或原子快照；阅读正文用下一节 workflow。

### 只比较完整修订

大件、二进制或不需要解析正文时，独立授权 raw 摘要范围；不需要文档 mapping，不扫描关系、不输出正文，也不增加受管面。

```bash
node scripts/curia-query.mjs changes --git-base HEAD --within docs/manuals --non-sensitive --inventory --json
node scripts/curia-query.mjs changes --git-base HEAD --within docs/manuals --non-sensitive --strict --json
node scripts/curia-query.mjs changes --git-base HEAD --within docs/manuals --non-sensitive --max-files 256 --max-file-bytes 16777216 --max-total-bytes 33554432 --strict --json
```

`--within` 可重复，`--exclude` 缩小范围；非敏感声明不能绕过默认排除和路径检查。`--inventory` 只盘点，`--all` 才加入未忽略 untracked。基线语法、删除、两轴比较和漂移撤回沿用下文 Git 影响模式：基线到 index 与 index 到 raw 工作树分别报告，不推断 rename，不等价于 git status。报告为 `curia.git-change-observation/2`，`contentInterpretation` 是 not-performed；hashed 不等于 read。

changes 的 `--max-files`、`--max-file-bytes`、`--max-total-bytes` 是独立摘要预算，默认分别为 256 件、16 MiB、32 MiB，硬上限为 2048 件、512 MiB、1 GiB。发现与变化名字各限 2048 项，不继承 impact 的 128 项图限制；它们也不是上面的元数据预算。strict 退出码为完整观察 0、不完整或仅盘点 1、参数或基线不可用 2；complete 只覆盖允许且未排除的范围，不代表全仓无变化、事实核验或暂存门禁。

## 只读 workflow

单篇、局部集合或语料阅读使用 [read-doc 技能](../template/.agents/skills/read-doc/SKILL.md)和 [curia-workflow](../template/scripts/curia-workflow.mjs)。CLI 提供带来源的正文切片与临时检查摘要；调用方形成语义结论，直接回答用户，不自动创建过程文档或持久化 Run。

```bash
node scripts/curia-workflow.mjs --path docs/manual.md --inventory --json
node scripts/curia-workflow.mjs --path docs/manual.md --json
node scripts/curia-workflow.mjs --path docs/api --path docs/runbooks --exclude docs/api/private --json
node scripts/curia-workflow.mjs --corpus --inventory --json
node scripts/curia-workflow.mjs --path docs/manual.md --max-file-bytes 131072 --strict --json
node scripts/curia-workflow.mjs --list-checks --json
```

必须显式提供一个或多个 `--path`，或者 `--corpus`；两者互斥，不接受通配、越界、大小写等价路径或缺失路径后回退全仓。文件和目录按路径边界匹配，默认仅 Git 已入库成员，`--all` 加入未忽略 untracked。`--inventory` 只盘点路径与 Registry，不读文档头块或正文；去掉该参数才读取选中的 md / txt，或显式映射的 JSON 原件。内部 Git 与系统挂载表读取属于本地元数据观察，不是项目 guard 执行。

`--exclude`、原始语料标记及默认敏感路径排除优先于包含规则，被排除成员不输出路径、正文或摘要。默认排除覆盖常见凭据、私有日志与 transcript 路径，不是秘密检测器；已知敏感内容仍由调用方显式排除，本地单读者模式不能冒充多读者访问授权。命令不会跟随来源链接、执行原文命令、启动项目 guard、调用模型、请求网络或写文件。

`--max-files`、`--max-file-bytes` 和 `--max-total-bytes` 控制读取预算，默认值由 `--help` 报告。顺序按仓内路径稳定排序，不按修改时间抢占预算。原文切片保留字节与行范围、实际观察时点、来源信任标记和未核实声明；完整原件才带原始字节摘要，部分读取不拿前缀摘要冒充全文。未支持格式、损坏编码、控制字符、预算耗尽和截断都会留下缺口，头块未完整时不采信片段状态。

输出 schema 为 `curia.read-workflow/1`。`outcome` 区分 `inventoried-not-read`、`read-complete`、`partial` 和 `blocked`；`read-complete` 仅证明选中正文已完整读入本次输出，不证明事实正确或接收端收到全量；`receiverCompleteness` 固定为 not-observed，工具界面与模型上下文的截断仍由调用方报告。临时检查保留规则 ID、版本、适用范围、空选集策略和正反夹具；未启用原生 guard 为 not-applicable，不假报通过。局部变体不能证明未读同族不存在，现存冲突和时间缺口仍保留。CLI 默认返回报告；`--strict` 对失败、配置错误及必需检查的证据缺口退出 1，参数或配置错误退出 2。

输入来自实际工作树；Registry、Git、挂载、原件或相关 untracked 集合变化时停止或撤回整组上下文，不把脏树结果归因给 HEAD。这是带后置复核的非原子读取，不是持久化 Run。普通入口不自动跟随依赖或启用格式 parser；按需能力见[授权依赖读取](#可选授权依赖读取)与 [Office 数据抽取](#可选-office-原件数据抽取)。多读者访问和受保护交付仍未接入；项目 guard 走独立显式入口，缺口不能靠摘要消失。

普通元数据查询与本节的 paths-only 盘点保持独立：前者读取头块并报告修订证据，后者先选范围才读正文；两者都不调用工作树差分驱动。需要仅比较修订时使用上节 changes，不把摘要计为已读正文。

## 可选 HTTPS 来源读取

普通 workflow、登记表和链接都不触发外访。确实需要读取外部资料时，使用独立 external 入口，分别声明完整 URL、精确 origin、parser，以及响应、URL、连接元数据和可选公开 CA 来源均非敏感；不使用签名 URL、token、私有业务标识或需要认证的内容。

```bash
node scripts/curia-workflow.mjs external --url https://example.com/ --allow-origin https://example.com --parser utf8-text/1 --non-sensitive --json
```

该例只说明调用方法；网络不可达时会返回缺口，不能把示例运行等同实际资料已读。成功退出 0，未完成或参数非法退出 2，SIGINT／SIGTERM 取消分别退出 130／143。输出临时返回 stdout，不默认下载到文件、转换原件、创建 Run 或修改 Registry；`--protected` 在来源 I/O 前拒绝降级。

### 独立的网络范围

只支持 HTTPS GET，allow-origin 必须精确匹配 URL 的 scheme、主机和端口。不接受 URL userinfo、query、fragment 或隐式规范化；不跟随跳转，不重试，不使用代理，不发送或继承 cookie、客户端证书、Authorization 或其他凭据，不接受任意请求头。环境代理不会成为失败后的备用通道；GET 只是调用方的读取意图，服务器侧副作用仍未核实。

DNS 只求解一次 A／AAAA，整个已返回地址集通过策略后固定连接到其中一个地址，不重新求解或尝试其他地址。私有地址、回环与 ULA 必须另给同一精确 origin 的 `--allow-internal-origin`；公开 CA 选项不能代替这项授权。链路本地、云元数据常用地址、转换／映射地址、组播和保守特殊用途范围仍不支持，不提供通用绕过开关。地址策略是带版本的保守快照，不保证实际路由隔离。

TLS 证书和原主机名必须通过校验，最低 TLS 1.2，直接连接的地址另与实际 peer 核对。默认显式使用 Node 内置 CA 集合，连接信任集不继承环境额外 CA；需要自有 CA 时可显式给出 `--trust-cert docs/network-root.crt`，只接受单个公开 PEM CA 证书，不接受私钥。该文件遵守既有仓内边界、Git、raw、敏感排除与完整字节限制；`--all` 只加入这个明确路径中的未忽略 untracked，`--exclude` 可进一步收窄。证书选择由调用方负责，不是 Curia 的认证或审批。

### 数据、限额与证据

`utf8-text/1` 接收受支持的 UTF-8 纯文本、Markdown 与 HTML；HTML 原文是数据，不渲染、执行脚本或跟随链接。`json-data/1` 要求 JSON 媒体类型与完整有效 JSON，保留原始数字和正文，不把业务字段投影为治理元数据。`digest-only/1` 要求额外给出精确 `--media-type`，只流式摘要完整二进制实体，不抽取或保存正文。任何 parser 都不会自动解压、OCR 或解密。

仅完整 200 响应可以产生来源证据；跳转、304、206、Content-Range、压缩、trailer、未知媒体类型、截断、尺寸不符与超限均保持未完成。`--max-bytes` 和 `--timeout-ms` 只能在各 parser 的硬上限内调整，默认与上限由 external --help 报告；头部、DNS 地址数与公开 CA 另有限制。总网络计时覆盖 DNS 与 HTTPS；取消和超时会清理实际请求及连接，不输出半份正文或前缀摘要。这些限制不是 OS sandbox 或硬 CPU／内存／进程数隔离。

报告使用 curia.external-read/1。sourceRef.revision 是实际完整 HTTP 响应实体的 `sha256 + raw-bytes/1 + value`，不含 HTTP 分帧或 TLS 封装；evidenceRefs 只支持本次响应观察，不能从任意报告导入为认证结论。工具、运行时、选定地址、TLS 观察、实际时间、媒体类型、预算及缺口可查；服务端 ETag、cookie、Location 与其他任意头部值不保留。源码或显式 CA 在正文解析后后检不一致时，撤回来源证据与投影。

客户端直接请求不等于源站新鲜：上游缓存、服务器侧当前状态、业务事实、版式、owner／verifier 身份和未来可重放性均未核实。接收端或上下文截断也不由 reader 代签。公网、代理、认证与多读者环境需要各自验证；入口不会根据未覆盖情况自行扩大权限。

实现见 [网络策略](../template/scripts/curia-network.mjs)和 [HTTPS reader](../template/scripts/curia-external.mjs)。[默认夹具](../template/scripts/curia-external-self-test.mjs)只做静态策略及拒绝路径检查，不联网；[真实网络夹具](../template/scripts/curia-external-network-test.mjs)必须在项目授权的隔离运行环境显式运行 `--allow-local-fixture`，它创建的临时 HTTPS／DNS 服务与测试密钥只用于隔离验证。

## 按需持久化 Run

只有需要长期留痕时才使用 [curia-records](../template/scripts/curia-records.mjs)；普通 read-doc 与只读 workflow 不自动启用。本节的 start / finish 用于本地 manual-observation，不执行项目命令、网络请求、模型调用、审批或外发；命令执行、影响检查与事实核验记录由各自显式入口启用。配置、命令和限制见本节，生成项目不依赖参考仓的决策笔记。

在已声明的 `instance` 内增加以下可选字段；它不是第二份配置，也不是替换整个 Registry 的模板。路径必须落在已有目录成员之下，owner 与 authority 必填，示例中的 authority 文件必须真实存在。新生成实例默认没有此绑定，不因阅读而改写项目布局。

```json
{
  "recordStore": {
    "schema": "curia.record-store/1",
    "path": "docs/records/runs",
    "owner": "文档维护者",
    "authorityLinks": ["docs/README.md"]
  }
}
```

```bash
node scripts/curia-records.mjs start --path docs/manual.md --check review --json
node scripts/curia-records.mjs append --run <run-id> --expect <expectedHead> --check review --subject docs/manual.md --statement "条件与限制已核对，事实仍未认证" --state satisfied --evidence docs/manual.md --observer "自报阅读者" --json
node scripts/curia-records.mjs finish --run <run-id> --expect <新expectedHead> --json
node scripts/curia-records.mjs show --run <run-id> --json
node scripts/check-records.mjs
```

run-id 与 expectedHead 从前一步 JSON 原样取得，不手造、不重用；每次成功追加都会更新 expectedHead。start 的 `--path` 可重复，也可显式选择 `--corpus`，`--exclude` 优先，`--all` 只纳入未忽略的未跟踪输入。当前 recordStore 自动加入显式排除，避免语料阅读把自己的历史输出再次当输入；排除会出现在输入快照中，查看旧 Run 使用 show 或更正 / 重试引用。`--check` 在开始前声明人工检查；append 的状态为 satisfied、unsatisfied 或 evidence-gap，证据只能引用该 Run 实际完整读取过的输入；没有依据必须给 `--gap`，有缺口不能标 satisfied。observer 只是自报标签，不是认证身份。

start 保存实际工作树输入快照、原件摘要、读取缺口与配置身份，不自动复制正文；部分 / 未读原件不拥有全文摘要，SourceRef 不授权抓取，原件正文没有被归档，摘要不保证未来仍能回放输入。观察和终态只追加，人工步骤没有伪造的 command、exit code 或日志。finish 从静态检查、人工观察和未执行项派生 passed、failed 或 incomplete，退出码分别为 0、1、2；`--cancel --reason <原因>` 产生 cancelled 与退出码 130。passed 仅表示本次声明检查无已报告缺口，businessOutcome 仍为 not-evaluated，事实核验和接收端完整性不因此通过。show 成功读取记录时退出 0，不改变原终态。

终态后不能续写；用 start 的 `--corrects <run-id>` 或 `--retried-from <run-id>` 创建新尝试，目标必须已终态。配置或代码身份漂移时拒绝继续完成，可以明确取消后重开；HEAD / index 漂移另行登记，不把旧输入换成新版本。发布回执只代表该事件的观察快照，后续写入仍需 CAS，不依赖“上次一定还是最新”。

[记录守卫](../template/scripts/check-records.mjs)已接入统一门禁。事件目录专用，不能混放 README、临时日志或其他文件；已有 HEAD 事件不可改写或删除，取消绑定 / 改路径不能绕过，暂存检查只看 index 原始字节。新事件必须经正常评审纳入 Git 后才有历史比较基线；没有基线时如实显示未封存。CLI 不替用户暂存、提交或推送，摘要链与 Git 门禁不是 WORM、签名或备份。

人工观察 Run 中断但未产生终态时保持 open，不凭超时猜成功或取消；确认执行已停止后可显式取消。若留下 `.pending-*`，门禁拒绝放行；维护者先确认没有存活写者，将残片保留到事件目录外核对，再决定恢复或重开，不盲删、不复用 ID。发布回执失败也要先 show 核对，不能盲重试。supervisor 丢失后的跨进程恢复、备份恢复、远程证据与认证 verifier 尚未交付。命令监督使用下节的显式 guard，不适用人工 append / finish。

### 存储、备份与恢复责任

记录存储的责任继续由 `recordStore.owner` 和 `authorityLinks` 声明；备份与恢复只在同一配置中增加可选 `preservation`，不另建存储系统，也不成为普通记录写入的前置条件：

```json
{
  "preservation": {
    "schema": "curia.record-preservation/1",
    "backup": {
      "authorityLinks": ["docs/records/ownership.md"],
      "policyRef": "docs/records/backup-policy.md",
      "evidenceRef": "docs/records/backup-receipt.json"
    },
    "recovery": {
      "authorityLinks": ["docs/records/ownership.md"],
      "procedureRef": "docs/records/recovery.md"
    }
  }
}
```

backup 与 recovery 可以分别声明，缺席保留缺口；声明一侧时，该侧 authorityLinks 与 policyRef／procedureRef 必填，evidenceRef 可选。每侧 authority 引用非空、唯一且不超过八项。引用必须是仓内规范路径，不能指向 Registry 或事件专属目录；未知字段和 schema 直接拒绝，不用命令、URL 或密钥内容替代引用。外部系统的策略可以由这些文件说明，但本入口不读取正文、不跟随其中的链接或命令。

```bash
node scripts/curia-records.mjs store --json
```

该只读入口校验现有记录链及 HEAD 基线，再检查责任、策略、恢复程序和可选证据引用的文件边界与元数据，不读策略或证据正文，不计算其内容摘要。敏感路径按既有默认规则、任务成员声明和 guard 隐私声明扣留，报告不展示被扣留引用的名称。Registry、记录和引用元数据联合后检发生变化时撤回本次视图。

`configurationGaps` 表示未登记、缺失、越界或隐私扣留；`verificationGaps` 表示尚未认证责任人、核实备份、演练恢复或保证原始输入可回放。引用存在甚至命名为 receipt，也不消除后一类缺口。未启用 recordStore 时为 not-applicable；责任与必要引用齐备为 declarations-complete，两者退出 0；声明、边界或稳定性不完整退出 2。**退出 0 只说明声明检查完成，不表示备份可用或恢复成功。**

`recordCoverage` 分开列出当前 Run、未终态 Run、事件、已有 HEAD 保护的事件及未形成历史基线的事件；不把 open 当作进程已停止，也不把本地记录完整当作输入正文已备份。所有结果均保持 deletionAuthorized=false，不授权清理活跃 authority、未终态操作、断言或 live reference 所依赖的材料；外部引用闭包未证明，缓存和 projection 不是备份。实际备份、恢复、更改权限与清理仍由原系统和项目规则负责，本入口不执行这些操作，不提供 WORM 或身份认证。

### 用原生备份演练恢复

恢复由项目授权的原生工具执行，Curia 只验证恢复后的文档与记录。先在备份系统之外保留可信的目标 revision、纳入范围、完整性依据与责任人；不能从待验证的恢复目录反推“期望值”，也不能仅凭门禁通过确认恢复的是所需版本。

对普通 Git 文件，可在授权后使用 Git bundle 备份已提交历史，并恢复到新的隔离目录，不覆盖活动工作区。bundle 不包含 index 中尚未提交的内容、工作树修改、未跟踪文件、Git LFS 实体、子模块仓库、外部原件或纸档。它们仍由原生保留策略分别覆盖，记录中的路径和摘要不替代原件备份。

```bash
git bundle verify "$BACKUP_BUNDLE"
git clone --no-checkout -- "$BACKUP_BUNDLE" "$RESTORE_DIR"
git -C "$RESTORE_DIR" -c core.hooksPath=/dev/null checkout --detach "$EXPECTED_REVISION"
git -C "$RESTORE_DIR" fsck --full
```

这些变量必须指向已确认的备份、新建隔离目录和独立保留的目标 revision。Git 对象检查不认证备份来源；恢复出的脚本、hook 和正文仍不是执行授权。后续核对使用受信任的 Curia 安装，不因恢复成功自动运行项目命令、重新发布或恢复未终态任务。

恢复核对分为三层，缺一不能声称完整恢复：

- **目标与字节**：实际 revision 必须等于可信目标；按备份范围核对文件集合与完整字节，包含原生规则要求冻结的结果、登记表和附件，明确缺件及范围外对象。
- **记录历史**：用现有记录门禁及 show／history 检查事件、引用、终态和已有 Git 基线。Run ID、事件字节及历史结论不改写；新查询的生成时间不属于冻结记录。open 不因恢复而变成取消或成功。
- **当前原件**：确需判断恢复后的原件是否仍与登记一致时，另行显式核验。原件缺失或变化不重写过去的核验结果；历史 confirmed 不能代替本次原件检查。

项目原生恢复回执至少保留备份身份、可信目标 revision、恢复目标、实际文件范围、核对工具与版本、观察时点、各层结果和剩余缺口，敏感字段按原项目规则处理。不新增 Curia 回执格式；已有 `preservation` 引用仍只检查声明，不能导入演练结论自动消除 verificationGaps。

[原生恢复回归](../template/scripts/curia-original-records-self-test.mjs)在临时 Git 仓验证冻结 Run、结果文档和二进制原件的独立恢复，以及未提交记录、index／工作树修改、未跟踪附件遗漏、缺件、记录篡改和旧版本回退。该回归不代签任一实际项目的备份可用性、LFS／子模块／外部原件恢复、审批、身份认证或未终态进程恢复。

## 显式项目 guard

项目原生检查通过 [curia-guards](../template/scripts/curia-guards.mjs) 显式执行，不从正文或只读 workflow 自动触发。在完整的 `instance` 对象中按需添加 `guards`；执行还需要前述 recordStore，plan 本身不会开启记录。以下用已有的链接守卫演示聚合适配，替换为项目命令时同时核对 cwd、真实扫描范围、代码依赖、effects 与 privacy，不能只改脚本名。

```json
{
  "guards": {
    "links": {
      "schema": "curia.guard/1",
      "owner": "项目文档维护者",
      "authorityLinks": ["AGENTS.md"],
      "activation": "explicit",
      "onEmpty": "fail",
      "command": {
        "program": "node",
        "script": "scripts/check-links.mjs",
        "args": [],
        "cwd": ".",
        "identityPaths": ["scripts/check-links.mjs", "scripts/doc-lib.mjs"]
      },
      "inputScope": {
        "mode": "git",
        "paths": ["."],
        "exclusions": ["CLAUDE.md", ".claude", ".codex", "docs/records/runs"],
        "includeUntracked": false,
        "includeIgnored": false
      },
      "effects": {"write": true, "network": false, "externalSystems": false, "sensitiveRead": false},
      "privacy": {"sensitivePaths": [], "output": "discard", "args": "non-sensitive-static"},
      "environment": [],
      "expectedExitCodes": [0],
      "parser": {"id": "aggregate-exit/1", "ruleIds": []},
      "limits": {
        "timeoutMs": 30000,
        "killGraceMs": 1000,
        "maxOutputBytes": 1048576,
        "maxFiles": 4096,
        "maxFileBytes": 67108864,
        "maxTotalBytes": 268435456,
        "cpuMs": null,
        "memoryBytes": null,
        "maxProcesses": null
      }
    }
  }
}
```

示例声明 write，是因为原守卫失败时可能写本地规则命中台账；输出虽然丢弃，也不能把潜在写入标成只读。scope 的整个 Git 范围是保守并集，不等于每个文件都被原生命令检查。原生程序没有提供观察清单时，observed-scope 明确为 declared-union-not-traced，不伪造精确覆盖。普通 root 默认只扫描声明面，显式 guard 可授权更宽的本仓输入，同时报告超出 Curia 受管面的范围；未授权的嵌套仓库仍阻断。

```bash
node scripts/curia-guards.mjs plan --guard links --json
node scripts/curia-guards.mjs run --guard links --confirm <上一步digest.value> --json
node scripts/curia-records.mjs show --run <run-id> --json
```

执行前审查计划中的命令、真实 executable、输入来源、风险和 effects，再原样传入确认摘要。任何绑定变化都使旧确认失效；`--confirm` 是本地执行确认，不是认证签署或受保护审批。重试或更正可附 `--retried-from <run-id>` / `--corrects <run-id>`，始终创建新 Run，不覆盖旧命令。人工 records append / finish 不能代签命令执行。

同一次计划与执行中的后续复核固定原来的根及其物理身份、挂载、Registry、HEAD、index 和实现身份。先比对这些约束，再打开原范围的输入或记录；配置漂移不能授权复核者改扫另一子树。进程内计划的 JSON 副本不能恢复复核能力；run 的首次规划仍读取当前显式选择，确认摘要不充当跨进程输入快照或读取凭据。

真实命令结束后，可以在原记录绑定内登记配置或 Git 漂移，但不能跟随新的记录路径、owner 或 authority。记录绑定变化时保留 open，返回 run-id 供核对，不猜成功、不自动重跑，也不为了封口写入新目录。该约束不是文件系统隔离、认证访问控制或 supervisor 恢复。

当前支持 Node 项目脚本，以及 `program: "absolute"` 配 `path` 的绝对可执行程序；后者不填 script，args 仍是非敏感静态数组，cwd 与 identityPaths 仍须声明。不把源文档值插入 shell，不把 secret 放到 argv。环境默认最小化，额外变量使用 `{"name":"变量名","source":"inherit","required":true}` 引用，并声明 sensitiveRead；值不写入记录，加载器和 Git 覆盖变量拒绝继承。每个脚本的已声明依赖都加入 identityPaths，尚未实现自动依赖闭包。

inputScope 的 git 模式按 index 与 HEAD 路径并集采集真实工作树字节，保留暂存删除而不把它当作空集，untracked 与 ignored 独立显式启用；filesystem 模式扫描真实目录，必须同时允许两者。记录、Registry 内容和显式 exclusions 不作为普通输入重复读取。敏感路径采用保守默认值加 sensitivePaths，不是秘密检测器；未授权敏感路径阻断，显式授权后也只登记路径与状态、不保存正文或摘要。mixed-tree、删除、未跟踪和 staged 变化分开记录，不能只用 HEAD 代替实际输入。

新计划与 Run 分别使用 `curia.guard-plan/2`、`curia.guard-run/2`，输入行的 privacy 由默认路径规则与 sensitivePaths 派生。敏感文件的 SHA-256、index / HEAD blob ID 均不保存，暂存删除仍保留存在性与变更状态；仓级 Git 身份不代表敏感正文已观察。旧 v1 Run 只读兼容，show 对其中敏感 blob ID 做展示层扣留并报告限制，不改旧事件或摘要链；新 Run 不允许降级写入旧合同。

默认 parser 为 aggregate-exit/1，只按允许退出码给出原生聚合结果。需要子规则时使用 curia-guard-status/1、声明 ruleIds，并把 privacy.output 设为 status-only；原命令输出 `{"schema":"curia.guard-status/1","checks":[{"id":"native/rule","state":"pass"}],"observedPaths":["docs/manual.md"]}`。缺规则、未知 ID、非法输出和范围外路径不会被猜成通过；解析后的路径仍是原生自报，不是系统调用追踪。原始 stdout / stderr 均不持久化，只有字节量、允许的状态和范围进入记录，非允许退出码不能被 JSON 中的 pass 洗白。

墙钟与输出限额实际生效；超时、取消、输出超限和子命令被杀分别记录，不伪造 exit 0。POSIX supervisor 清理同组后代并报告是否确认；它不是安全沙箱，不能阻止程序脱离进程组或读写任意主机路径。CPU、内存、进程数的 null 表示未隔离，填入当前无法执行的硬限额会拒绝，而不是忽略。supervisor 自身被不可捕获地终止时，Run 保持 open，不能据此重试或推断成功；跨进程自动恢复尚未实现。超时 / 取消等进程模拟在本工作区通过调试云运行，普通静态文档检查仍走本地门禁。

## 多仓 guard 的运行时绑定

命令确实需要其他仓库时，登记独立的 curia.guard/2；保留前节完整 owner、command、inputScope、effects、privacy、parser 与 limits，不把下面的增量片段当作完整配置。repositoryInputs 只声明必需角色与范围，不放机器绝对路径。主仓固定为 primary，每个额外根必须已有自己的 Git HEAD 和 Registry，嵌套根同样独立授权。

```json
{
  "schema": "curia.guard/2",
  "repositoryInputs": [
    {"id": "lib", "within": ["docs/input"], "exclusions": [], "includeUntracked": false}
  ]
}
```

把实际项目检查登记为 pair，主仓 inputScope 选择 docs/input，并先核对项目命令真的使用下面的环境协议。plan 与 run 都需传同一组角色绑定及独立的非敏感确认；它不是 impact 的 non-sensitive，也不能从来源正文、继承环境或 snapshot JSON 获取授权。例子中的根和摘要必须替换为自己的实际值。

```bash
node scripts/curia-guards.mjs plan --guard pair --repo '{"id":"lib","root":"/absolute/lib"}' --repositories-non-sensitive --json
node scripts/curia-guards.mjs run --guard pair --repo '{"id":"lib","root":"/absolute/lib"}' --repositories-non-sensitive --confirm <上一步digest.value> --json
node scripts/curia-checks.mjs plan --guard pair --changed docs/input/a.md --within docs/input --non-sensitive --repo '{"id":"lib","root":"/absolute/lib"}' --repositories-non-sensitive --json
node scripts/curia-checks.mjs run --guard pair --changed docs/input/a.md --within docs/input --non-sensitive --repo '{"id":"lib","root":"/absolute/lib"}' --repositories-non-sensitive --confirm <上一步digest.value> --json
```

只绑定实际选中 guard 所需角色；缺失、重复、未声明角色与同一物理根重复计入均拒绝，单仓 guard 不接收额外绑定。主仓和额外仓共用 guard 的输入预算，整个选集预检后才读取正文。额外仓的隐式 privacy、ignored 或 raw 遗漏不能当成完整输入；用声明中的 exclusions 显式排除，不自动缩小范围。任何必需成员不完整或漂移都阻断本次完整结论。此模式只支持非敏感额外来源，不等于受保护读取。

命令通过保留环境变量 CURIA_GUARD_REPOSITORIES 接收下面的 JSON，不能在 environment 中覆盖或继承它；supervisor 回执的 repositoryBindings 摘要证明实际传入的是哪组根，不证明命令只访问这些路径。项目程序应按角色取根并遵守登记范围。

```json
{
  "schema": "curia.guard-repositories/1",
  "primary": {"root": "/actual/primary"},
  "repositories": [{"id": "lib", "root": "/actual/lib"}]
}
```

聚合命令继续用 aggregate-exit/1；需报告原生规则时，parser.id 用 curia-guard-status/2，privacy.output 用 status-only，ruleIds 登记实际规则。输出路径必须带仓库身份，同名文件不再歧义；旧状态协议不会自动升级，范围外自报只保存计数，不保存原始路径或输出。

```json
{
  "schema": "curia.guard-status/2",
  "checks": [{"id": "pair/check", "state": "pass"}],
  "observedPaths": [
    {"repository": "primary", "path": "docs/input/a.md"},
    {"repository": "lib", "path": "docs/input/a.md"}
  ]
}
```

多仓单命令使用 guard-plan/3、guard-run/3 与 run-event/7；未启用配置影响且含实际多仓检查的批次使用 check-plan/2、check-run/2 与 run-event/8；配置批次使用下述独立版本。混合批次仍只有一个 Run，失败即停；其 impactScope 明确为 primary-repository-only，额外来源不会变成跨仓影响图或合并 authority。单 guard 的 show 输出 guard-run-view/3，上述非配置批次输出 check-run-view/2，只回读冻结输入，不重新打开额外仓库。旧单仓和人工记录按原版本解释，不改历史字节。

字段校验归[仓库合同](../template/scripts/curia-guard-contract.mjs)，执行与记录边界归 [guard](../template/scripts/curia-guards.mjs) 和[记录器](../template/scripts/curia-records.mjs)。独立 snapshot 仍是只读入口；此执行模式不增加文档根、配置文件或常驻服务，也不提供跨仓原子事务、命令沙箱、认证签署或自动恢复。

## 显式影响检查批次

[curia-checks](../template/scripts/curia-checks.mjs) 复用前述 guards 与 recordStore，不增加配置文件。调用方逐个传入 `--guard`，顺序就是执行顺序；影响图、来源正文和配置链接均不能增加检查或授予效果权限。plan 只预览，run 重新观察同一选集并核对确认摘要，才按失败即停策略执行。

先使用前述示例登记 links、启用 recordStore，并准备实际的 docs/manuals 文件。下面仅分析 Registry 变更对这些对象的配置影响；如需正文声明关系，先完成[关系映射](#可选取代图与引用效力)，再用普通 impact 选项或 `--configuration include`。

```bash
node scripts/curia-checks.mjs plan --guard links --configuration only --changed .agents/doc-types.json --within docs/manuals --non-sensitive --json
node scripts/curia-checks.mjs run --guard links --configuration only --changed .agents/doc-types.json --within docs/manuals --non-sensitive --confirm <上一步digest.value> --json
node scripts/curia-records.mjs show --run <run-id> --json
```

变更与扫描参数沿用[反向影响计划](#可选反向影响计划)，支持显式名字、Git 两轴观察、配置 only / include、独立字节预算和 `--all`。不接收序列化的影响报告作为授权。检查前核对 `impact`、`checks`、`coverage`、`budgets`、`risks` 和 `unresolved`；计划摘要绑定范围、配置、代码、命令、已读来源、图、规则、预算与 Git 身份，只略去观察时点和明确不属于输入的统计。摘要不是审批签名、凭据证明或可跨实例复用的缓存键。

`coverage` 只表示当前 reviewPaths 候选落在所选 guard 的声明输入与实际快照内，不表示每条业务规则都已检查，也不包括只作为变更锚点的已删旧名或范围外对象。没有命中的 guard 为 not-applicable，不打开它的完整输入或命令；匹配了但没有有效输入、来源未知、未覆盖候选、影响图 incomplete、缺少记录绑定或空检查集都不执行，不产生 passed Run。Git 授权范围无变化的计划为 not-applicable；计划未就绪时 CLI 退出 2。已声明敏感路径不能被 non-sensitive 覆盖，需先从影响扫描显式排除；guard 的敏感输入没有可比较内容身份时，批次保持阻塞，不用元数据冒充完整输入；已继承而不保存值或摘要的环境变量也属于该缺口，可选变量未出现时则保留可观察的缺席状态。

记录输出必须与关系扫描、Git 变更观察、命中 guard 的输入范围分开。若父目录包含 recordStore，显式增加 `--exclude docs/records/runs`，并在对应 guard 的 inputScope.exclusions 排除同一目录；实际路径以项目绑定为准。批次不会悄悄缩小选集，也不豁免正文、配置、命令或 Git 漂移。阶段边界有界重读，兼容 `--all` 产生的新记录，不是跨修订缓存或完整增量读取。

未启用配置影响的纯单仓批次只新建一个 `curia.check-run/1`，使用 `curia.run-event/3` 容器；begin 预声明检查，实际回执按顺序追加，整体终态从这些回执和末次复核派生。序列化计划、伪造回执、重复领取和失败后追加执行被拒绝；未执行项保持 skipped，取消、超时、输出超限和被杀不洗成成功。show 使用 `curia.check-run-view/1` 的 commands 展示多份回执，command 为 null，不用第一条命令冒充整体。既有人工 / 单 guard 协议及历史字节不改写；更正和重试可传 `--corrects` / `--retried-from`，始终新开 Run。

批次命令数、观察次数与合计输入、墙钟和输出预算有上限，具体值由 plan.budgets 与[版本化检查合同](../template/scripts/curia-check-contract.mjs)给出。观察次数限制与单命令监督不等于整个同步扫描阶段的操作系统硬 deadline，也不提供 CPU、内存、进程数、文件系统或网络隔离。阶段复核仍是非原子的本地观察；任意主机程序可能在复核之后修改输入。原始输出不保留，业务事实仍为 not-evaluated。supervisor 丢失或记录发布状态未知时保持 open 或明确报错，先核对事件，不自动恢复、猜终态或重跑未知效果。

## 可选原位纳管与原生状态

默认仍是两根。已有项目要纳管其他路径时，在现有 [Registry](../template/.agents/doc-types.json) 顶层加入 `instance`，不创建第二份配置；下面的片段是完整的 `instance` 值，不是替换整个注册表。示例路径必须已经存在，owner、成员和原生状态词表由项目自己确认。加入后仍运行 `node scripts/gen-doc-types.mjs`；`instance` 不替代 `workspaceLayout` 与现行门禁，不自动批准新增根。

```json
{
  "schema": "curia.instance/1",
  "surfaces": [
    {
      "id": "control",
      "kind": "root",
      "members": [{ "path": ".agents", "kind": "directory", "role": "control" }],
      "owner": "project-owner",
      "entry": ".agents/README.md",
      "authorityLinks": ["AGENTS.md"]
    },
    {
      "id": "legacy",
      "kind": "legacy-root-set",
      "members": [
        { "path": "legacy/manuals", "kind": "directory", "role": "knowledge" },
        { "path": "legacy/receipts", "kind": "directory", "role": "record" }
      ],
      "owner": "domain-owner",
      "entry": "legacy/manuals/README.md",
      "authorityLinks": ["AGENTS.md"],
      "noExpand": true,
      "discovery": { "path": "legacy", "exclusions": [] }
    }
  ],
  "mappings": [
    {
      "path": "legacy/manuals/specs",
      "kind": "directory",
      "defaults": { "owner": "spec-owner" },
      "nativeProfile": "native-spec"
    }
  ],
  "nativeProfiles": {
    "native-spec": {
      "parser": "markdown-native-header/1",
      "authorityLinks": ["AGENTS.md"],
      "fields": {
        "id": "doc_id",
        "version": "Version",
        "lifecycle": "Status",
        "owner": "Owner",
        "pointer": "Pointer"
      },
      "lifecycles": {
        "Active-Confirmed": {
          "view": "current",
          "facets": { "effect": "confirmed", "blocker": "none", "dependency": "none", "purpose": "document" }
        },
        "P0-BLOCKED": {
          "view": "forming",
          "facets": { "effect": "candidate", "blocker": "P0", "dependency": "unmapped", "purpose": "document" }
        }
      }
    }
  }
}
```

原件可以保留下面的头块；只输出最终手册也不要求补造计划或过程日志。

```markdown
# 原生规格

doc_id: spec-17
Version: v3
Status: P0-BLOCKED
Owner: original-owner
Pointer: ./current.md

规格正文。
```

```bash
node scripts/curia-query.mjs --surface legacy --json
node scripts/curia-query.mjs --status-view forming --json
node scripts/curia-query.mjs --gap native-lifecycle-unmapped --json
node scripts/curia-query.mjs --all --links --strict --coverage
```

surface 与 profile 的 ID 使用小写 kebab-case。受管面总数最多五个，root set 多个固定成员合计为一个；单个成员可以是 directory 或 file。entry 必须在成员内，authorityLinks 只引用仓内常规文件，不执行 guard。discovery 枚举未登记 sibling，exclusions 只排除明确边界，不接受通配；未登记正文不读取。布局与 HEAD 基线不一致时停止投影，首次登记缺少基线会明确报告；查询结果不代替配置评审或原项目批准。

owner 按实例可选 owner、面 owner、由粗到细的 mapping 默认值继承；面未直接声明 owner 时必须有实例 owner 可继承；mapping 也可用 `defaults.type` 引用现有注册类型，但不合成过程状态。已登记有状态类型缺少 Status 时为 unknown，无状态登记类型缺少 Status 时为 not-applicable；未知、空或冲突的 Type 不能冒充无状态。current 默认值只用于没有声明类型且头块完整可信的直达知识。显式字段优先，空值、冲突、未知类型、截断与未支持格式不靠默认值洗白。同一类型的显式与继承配置不改变相同 Status 的解析及维护方式，状态注释保留，空值和重复状态不退化为普通缺失。字段来源包含原件行号与 Registry 指针；原生 raw lifecycle、ID、版本和 pointer 保留，不改原件。`--status` 查询原生 raw，`--status-view` 查询派生视图；未启用原生映射时视图是 not-applicable。

同一种类型可以按路径声明为原件、摘要、导航或交付副本，不需要新建类型。受管路径上的 `instance.mappings` 可增加以下条目，普通文档无需填写：

```json
{ "path": "docs/context", "kind": "directory", "defaults": { "representation": "context" } }
```

`representation` 支持 original（独立维护的原件）、generated（通用派生内容）、context（上下文摘录或摘要）、navigation（纯链接导航）、outbound（交付副本）；最具体路径覆盖父层默认值，不改变类型、原生状态和维护机制。查询的 `--representation context --json` 按形态筛选；coverage 区分这些形态、undeclared（未声明）、conflict（冲突）与 unavailable（未解析或不可用）。只盘点路径时不能使用该筛选。

类型表投影和类型的 `generated: true` 提供通用生成声明，与 context、navigation、outbound 的用途细分兼容；和 original 冲突时保留双方来源，阅读 metadata 检查失败。generated 必须是 boolean，false 不等于原件。输出保留声明来源和 `verification: not-performed`，不证明原件权威、来源有效、链接完整或外发成功；普通阅读不自动生成、同步、调用模型或建立执行记录。旧版 reader 不识别该字段时会明确拒绝，不静默采用。

`markdown-native-header/1` 支持首行 H1 后的连续单行 key-value Markdown 头块，原生字段名支持字母、数字、下划线和连字符，首字符必须是字母；64 KiB 内未见完整头块边界就报告未完整解析。JSON 使用下一节的独立显式 parser；frontmatter、YAML、PDF、表格和扫描件没有接入原生字段 parser，不猜测字段。lifecycle 必须精确映射，遗漏 facet 和未知状态保留 unmapped；authority-view 的原生 guard 验证为 not-run，record 声明不证明冻结。

显式原生、变体与时间绑定的头块范围也用于写作门禁的段落判断，`doc_id` 不再被误报成拆行正文；只对显式映射生效，不豁免正文或其他写作检查。pre-commit 使用 index 中的配置和正文，盘面改动不能替代待提交版本。只读 CLI 的暂存工具冒烟在隔离目录使用 index 中的脚本、Registry 与投影原始字节，校验启动、配置和投影新鲜度；投影路径在物化前校验，子进程不继承钩子的 Git 环境覆盖。不构造暂存 inventory，普通查询仍读取工作树。

显式 instance 的路径检查支持 Linux mountinfo 与 macOS mount 表，拒绝链接、嵌套仓库、同设备挂载和未经登记的大小写 / Unicode 别名；未知平台或挂载表不可确认时停止投影。多读者访问与受保护交付不在原位映射能力中；原生 guard 与 Move Binding 通过本文独立入口按需启用。schema、继承与 parser 实现归 [curia-instance](../template/scripts/curia-instance.mjs)，I/O 边界与查询归 [curia-query](../template/scripts/curia-query.mjs)。

### 形态判定与最小身份

先看对象如何维护、供谁使用和交付到哪里，再决定是否声明形态；文件名、格式、作者是人还是 AI，都不是判定依据。普通结果文档可以保持 undeclared，不为采用 Curia 逐篇补字段。以下是采用约定，不是 reader 已经完成的语义分类或真实性核验。

| 形态 | 判定依据 | 不应误判的情况 |
|---|---|---|
| original | 独立维护的事实或规则来源，例如由 Owner 接受并持续修订的手册、方法和结论。 | AI 参与起草不自动使其成为生成投影；original 声明也不证明事实正确或 owner 已认证。 |
| generated | 存在明确的来源与生成约定，内容随来源重新生成，例如从接口定义生成的参考页。 | 仅有来源引用、人工整理或一次性工具辅助，不足以宣称自动生成与同步。 |
| context | 为特定阅读任务选择、裁剪或摘要的来源内容，包括临时 Agent 上下文。 | 不把完整原文都算作已进入上下文，也不因为它临时存在就自动保存 Run。 |
| navigation | 仅提供到内容原件的定位，不承担独立业务事实或规则。 | README 含有操作步骤、约束、结论或事实表时，这些正文不是纯导航；不能只查链接就声称正文有效。 |
| outbound | 向另一个目标交付或同步的源内容副本。 | 本地待审稿、指向外部资料的链接和未执行的交付计划，不等于已外发副本或成功回执。 |

形态不是互相豁免的等级：context 保留生成内容的来源要求；outbound 若承载生成内容或上下文，同时保留其生成、选择、隐私与截断约束。navigation 若确由生成器维护，也保留生成依据。现有视图显示细分用途并保留通用 generated 声明，不因此新建组合类型、第二份元数据或审批流程；阅读中的未核验提示继续保留。

身份只补实际需要的部分：仓内相对路径足以稳定定位时，不另发编号；原项目已有 ID、版本或档号时优先引用，只有跨路径持续引用且原生身份不足时才增加 Artifact ID。移动、翻译、并列版本和事实取代仍是不同关系，不能凭 ID 相同互相替代。已启用 Run 或原生协议的必填身份不因此省略。

修订与摘要同样按用途启用：已有可信的原生修订号足以绑定来源时，不为填写治理字段额外读全件；只有需要核对完整字节、生成漂移或冻结保真时，才在授权与隐私边界内登记算法、规范化方式和值。普通查询可以复用已合法读到的完整字节，但不因需要摘要而扩大选集；前缀摘要、登记表摘要和缓存值不能代替完整原件身份。敏感对象不默认读取或摘要，摘要也不证明访问权限、业务事实或签署身份。

这些判据不启动生成器、模型、同步或解密，不把声明升级为自动验证。当前 reader 只报告形态声明、冲突和未核验范围；生成漂移、模型身份、外发目标并发保护和回执需要各自能力，不由形态查询代签。

### 外发目标与原生同步

本节确定外发的采用边界，不提供通用 publisher，也不授权任何实际写入。只有用户明确要求发布、镜像或同步，且原项目允许该动作时，才采用目标系统已有的工具与协议；普通文档编辑和阅读不触发外发。下列名称是协议语义，不是新的 Registry 字段、核心对象或 Run 状态。

执行前固定候选来源及其完整 revision、允许外发的路径、目标对象和原生权限依据。`expected revision` 来自对同一目标的获准观察，不能借用来源 revision、本地缓存、正文里的版本声明或未经核实的时间戳。目标“确认不存在”仅适用于另行授权的创建；查询失败、无权限、超时和响应无法解释都不是不存在，也不能视为干净。

| 原生目标 | expected revision 的映射 | 干净状态与并发条件 | 无法满足时 |
|---|---|---|---|
| Git 分支或标签 | 精确目标仓库、完整 ref 和已观察的 OID；候选也绑定完整 OID。 | 原协议同时执行版本比较与更新。显式 ref lease 可承担 CAS；它不授予非快进覆盖权限。bare 目标没有工作树，“干净”不适用，不伪造 status 结果。 | ref 不明、OID 未知、租约冲突或原生权限拒绝即停止；不退回无约束 force、默认 remote、整仓 mirror 或未经复核的重试。 |
| 版本化文档／对象 API | 同一对象的原生版本令牌；由服务端在条件写入中比较。 | 原服务须实际保证条件写入；草稿、锁和发布状态沿用该系统的规则。仅把版本字段放入请求不等于服务端执行 CAS。 | 不支持必要的条件写入、令牌无效或状态未知则停止，转原生人工／审批流程，不构造成功回执。 |
| 文件目录或工作树镜像 | 原协议定义的目标基线与允许变更清单。 | 目标的 index、工作树、未跟踪项、锁及路径边界按原项目规则检查；从检查到替换须有原生锁或等价并发保护。来源与目标不重叠，额外文件不能自动删除。 | 缺可靠基线、脏项处置规则或并发保护即停止。先读后写加事后摘要不能冒充原子更新。 |

候选、目标、允许范围或生效配置在确认后变化，需要重新观察并确认。源工作树的暂存、未暂存与未跟踪内容必须与已确认候选区分；不自动 stash、提交或吸收新文件。dry-run 只证明当时的预检结果，不锁定目标，也不代替实际写入时的条件检查。现有 guard 的计划摘要绑定本地观察，但不替代远端 CAS、身份认证、审批或隔离。

一次涉及多个对象时，先确定原协议是否要求整组原子性。若要求原子性，目标必须实际支持且本次调用必须启用；能力缺失就停止，不降级为逐项写入。允许独立提交的同步，必须分别保留已写、未写、冲突和结果未知的原生回执，不能把非零退出解释成“没有任何效果”，也不能把部分成功标为整体完成。跨系统不假设存在统一事务；补偿、回滚或删除需要原项目的独立权限和办法。

超时或回执丢失时，先按原生幂等键、请求记录或目标 revision 查询实际结果；结果仍未知就停止。重试不能改变已确认的候选和目标语义，也不能以新的幂等键重复未知效果。回执至少绑定候选身份、目标对象、预期及实际 revision 或原生回执、观察时间、整体与逐对象结果和剩余缺口；凭据不进入正文、命令参数或普通回执。是否落 Run 沿用项目的审计要求，Run 本身不认证这些外部事实。

[原生协议回归](../template/scripts/curia-guards-self-test.mjs)只使用临时本地 Git 目标，验证显式 ref／OID、dry-run 后并发修改、租约拒绝、重新确认、目标缺失与不可访问、整组原子拒绝、非原子部分写入、原子能力缺失及工作树状态。它验证 Git 映射，不冒充其他服务的接入测试或 Curia 已实现受保护发布。目标身份与路径归一化、认证凭据 audience、审批及实际外发仍须分别验收。

### 模型生成结果的来源说明

先按上一节判断维护方式。AI 辅助起草后由 Owner 接受并独立维护的手册、方法或结论，不因作者使用模型就强制变为 generated，也不补造提示词档案、计划或 Run；事实核验、原生类型和受保护交付规则仍按用途生效。本节适用于明确依赖来源再生成的内容，以及承载这些内容的 context、navigation 或 outbound。

来源说明复用原件已有元数据、原生 manifest 或真实执行记录；一条信息只维护一处，其余引用。不强制每篇增加伴随文件、统一字段名或新的 Registry 段。下面定义必需信息的含义；本地字段映射与声明摘要核对见下一节，其他来源与真实执行链仍需另行核验。

| 信息 | 最小要求 | 缺失或未知时 |
|---|---|---|
| 来源与范围 | 引用实际输入及其 revision 或完整摘要，保留选集、片段定位、排除与截断；沿用 SourceRef 和 Digest。 | 当前路径或链接可达不证明生成时输入；未读、未取到或未授权部分保留缺口，不补读扩大范围。 |
| 生成方式 | 区分数据抽取、摘录、模型推断与混合内容；混合结果在能分清责任的段落、字段或整体范围标明，不要求逐句建档。 | 摘要、翻译和模型归纳含解释时不能标为纯抽取；方式不明不自动视为确定性转换。 |
| 生成者与约定 | 保留实际模型、工具或生成器标识及已知版本，引用非敏感配置、模板或提示的版本或摘要；多步生成保留会影响结果的工具身份。 | 别名不伪装成固定模型版本；未知版本、参数或中间步骤如实说明，不能猜填。身份字符串不等于认证证明。 |
| 时间与输出 | 记录实际生成时间，并用原生修订或完整摘要绑定对应输出；声明与实际观察分开。 | 文件修改时间不冒充生成时间；只知道日期时不制造精确 instant。无法绑定输出时，不宣称来源说明已覆盖当前正文。 |
| 运行依据 | 引用真实 Curia Run 或原生作业／执行回执，保留其身份、范围与终态解释；原生回执不自动等同于 Curia 的受保护记录。 | 未记录时明确缺口，不倒填一份成功 Run。普通纳管不因此受阻，但不能宣称执行证据完整；受保护交付仍须满足真实记录与原项目审批。 |
| 可重放性 | 区分生成约定可再次执行、当前输入可恢复与输出可确定性复现；仅在实际条件与证据支持时声明 deterministic。 | 存在模型名、提示摘要、相同参数或一次成功回执，都不足以证明确定性；缺失依赖、不可取回输入或不透明服务版本保留不可重放或未验证状态。 |

提示、配置与中间材料不因需要来源说明而默认存储或摘要。优先复用获准的非敏感版本标识；敏感内容的可比对摘要也可能泄露信息，只有原项目受保护策略明确允许时才能计算与保存。摘要必须保留算法、规范化方式和值，不以部分输入摘要冒充完整生成约定。

漂移比较同时绑定来源、生成约定和输出。任一实际修订不符，旧说明不能继续为当前内容背书；未检查、不完整或无法解释的修订是未知，不是“仍然一致”。人工修改派生正文后，先保留该次修改与旧来源关系，再由 Owner 决定重新生成还是转为独立维护；不悄悄覆盖人工改动，也不靠更新日期恢复来源有效性。普通阅读不为此自动重跑生成器。

模型生成内容不是已核实 Assertion，模型或工具的成功状态也不是业务正确性的证明。外部模型调用仍是独立的显式 adapter：调用前确认输入可见范围、目标 audience、效果、数据留存与训练边界；未知边界按外发风险处理，未经授权的材料不得发送。工具内部调用模型同样适用，不因其被包装成“抽取”就豁免。

| 使用情形 | 采用方式 |
|---|---|
| AI 起草后由团队独立维护的 API 使用手册 | 可保持普通原件；按 API 事实与原项目要求核对来源，不强制新增生成档案。 |
| 从接口定义反复生成的参考页 | 绑定接口定义、生成约定和输出修订；声称已更新前复核对应来源，不以编译成功代替内容正确。 |
| 无执行记录的历史模型摘要 | 可以保留、引用与纳管，明确来源或运行依据缺口；不补造历史、不宣称可重放或已核实。 |
| 准备外发的模型摘要 | 同时满足生成来源、上下文选择及外发授权；来源说明完整也不授予发送权限。 |

当前 Curia 的 representation 视图只报告声明、冲突和未核验范围；它不读取上述原生生成字段来完成机器化映射，不核验模型身份、重放生成或自动检测完整生成链漂移。本节确定采用合同，相关实现与外部 model adapter 仍分别按实施计划交付。

### 本地生成来源核对

只有需要核对派生内容时，才在现有 `instance.mappings` 为其原生说明登记可选 `generation` 绑定；不增加 Registry 顶层段，不要求每份文档另建伴随文件。普通阅读不自动核对、读取来源或生成 Run。

```json
{
  "path": "docs/build.json",
  "kind": "file",
  "generation": {
    "schema": "curia.generation/1",
    "parser": "json-pointer-generation/1",
    "fields": {
      "sources": "/native/sources",
      "conventions": "/native/conventions",
      "output": "/native/output",
      "generators": "/native/generators",
      "mode": "/native/mode",
      "generatedAt": "/native/generatedAt",
      "run": "/native/run",
      "replay": "/native/replay"
    }
  }
}
```

`fields` 定位原件已有字段，不把声明复制进 Registry。JSON 使用精确 pointer；Markdown 可选 `markdown-header-generation/1`，默认头块名依次为 `Generated-from`、`Generation-conventions`、`Generated-output`、`Generators`、`Generation-mode`、`Generated-at`、`Generation-run` 和 `Generation-replay`，可显式改名。结构值使用单行 JSON，mode、时间与 replay 使用单行原文。重复字段、未知绑定字段、定位重叠及与原生／关系／适用性字段冲突失败；细路径绑定整体替换父绑定，不拼出隐式生成链。

| 原生值 | 支持的形状 |
|---|---|
| sources、conventions | SourceRef 数组，分别描述输入与影响生成的工具、非敏感配置或提示。每项使用 `uri`、`revision`，可带 `locator`、`observedAt`；不自动登记或摘要敏感内容。 |
| output、run | 单个 SourceRef；output 绑定独立输出，run 引用真实原生回执。缺失或 null 保留缺口，不补造运行。 |
| generators | 非空数组，每项含 `kind: model 或 tool`、`id` 与已知 `version`；未知版本保留缺口，身份字符串不成为认证证明。 |
| mode、generatedAt、replay | mode 为 extraction／inference／mixed；时间为实际日期或明确时区 instant；replay 为 unknown／rerunnable／deterministic，仅作为声明，不自动核实确定性。 |

```bash
node scripts/curia-verify.mjs generation --declaration docs/build.json --output docs/result.md --allow-source docs/input.json --allow-source docs/prompt.txt --allow-source docs/receipt.json --non-sensitive --json
```

先用同一组参数加 `--inventory` 盘点；`--allow-source` 逐项授权输入、生成约定和回执，声明里的引用不授予访问权。`--all` 仅加入未忽略的未入库文件，`--exclude` 优先；整组选集须非敏感，原件、输出、说明及其中的隐藏内容都在声明范围内。未授权引用不展开，不回显其原始目标；已排除、缺失或不安全成员会在读取说明前阻断整组。

当前只比较 `repo:` 原件与 `sha256:raw-bytes/1:<64 位小写十六进制>` 修订。先读最多 64 KiB 的说明，再流式摘要获准引用，共享文件与总字节预算，并共同后检 Registry、Git 和路径身份。默认最多 32 件、单件 16 MiB、合计 32 MiB；`--max-file-bytes` 和 `--max-total-bytes` 可在已有摘要上限内调整。输出不含原件正文、提示内容或模型输出正文；任一比较不符返回 drifted／退出 1，全体已声明字节相符且必需字段齐全返回 unchanged／退出 0，缺口或无法稳定观察返回 incomplete／退出 2。

unchanged 只证明本次观察与已声明的本地字节绑定相符，不证明声明列全了实际输入、历史执行真实、业务事实正确、模型身份已认证或结果可确定性复现。未解释的修订、局部 locator、缺失运行依据和外部来源保持缺口；不读取网络、不调用模型、不验证回执终态、不接受受保护降级，也不重跑生成器或覆盖人工修改。完整生成链、认证与模型 adapter 仍按实施合同逐项交付。

## 可选运行任务包

任务目录只登记成员职责，不成为新文档类型或执行系统。在既有 `instance.mappings` 增加目录项即可；不采用此项的普通文档不新增字段、步骤或记录：

```json
{
  "path": "docs/jobs/report",
  "kind": "directory",
  "task": {
    "schema": "curia.task-profile/1",
    "id": "report-job",
    "invocationRef": "docs/jobs/report/SKILL.md",
    "sensitivity": "non-sensitive",
    "members": [
      { "path": "docs/jobs/report/README.md", "kind": "file", "role": "knowledge" },
      { "path": "docs/jobs/report/SKILL.md", "kind": "file", "role": "skill" },
      { "path": "docs/jobs/report/job.mjs", "kind": "file", "role": "source" },
      { "path": "docs/jobs/report/settings.json", "kind": "file", "role": "config" },
      { "path": "docs/jobs/report/checkpoint.json", "kind": "file", "role": "checkpoint" },
      { "path": "docs/jobs/report/ledger.json", "kind": "file", "role": "ledger" },
      { "path": "docs/jobs/report/report.md", "kind": "file", "role": "output" },
      { "path": "docs/jobs/report/history", "kind": "directory", "role": "archive" }
    ],
    "outcomeAuthority": {
      "path": "docs/jobs/report/ledger.json",
      "kind": "file",
      "parser": "json-task-outcome/1",
      "recordsPointer": "/rounds",
      "fields": {
        "invocation": "/id", "taskId": "/task", "outcome": "/result",
        "evidenceComplete": "/evidenceComplete", "schedulerStatus": "/scheduler",
        "exitCode": "/exitCode", "observedAt": "/at"
      },
      "outcomes": { "done": "completed", "noop": "empty", "failed": "failed", "busy": "running", "skipped": "not-executed" }
    },
    "retention": "docs/retention.md"
  }
}
```

`id` 默认取目录路径，`owner` 可沿用路径、受管面或实例的既有 owner。`invocationRef`、可选 `retention` 和成员的可选 `schemaRef` 只引用说明或策略，不读取内容、不触发命令、不执行保留清理。任务目录不可嵌套、重叠或包含 Registry；最多登记 64 个目录，每个目录最多 128 条唯一成员规则。成员路径必须在包内；目录规则允许更细角色覆盖，文件规则不能包含子规则。角色不替代原生生命周期：checkpoint 可变、ledger 动态、archive 的冻结机制都需要项目自行保证，Curia 不凭名字背书。

`sensitivity` 是已声明成员的默认值，省略为 unknown；config 默认 sensitive，可在明确非敏感时逐项声明 non-sensitive。敏感父成员规则不能被子规则降级；未分类文件始终 unknown，不因目录默认 non-sensitive 而自动获准。常规查询、阅读、摘要、Git 变化及 guard 输入身份尊重该声明；`--non-sensitive` 不能覆盖 profile 中的敏感或未知成员，私有内容不能成为可比对的命令或执行器身份。规则不是秘密检测器或操作系统隔离；已授权读取敏感输入的原生 guard 只记录这些输入的元数据，不生成其内容摘要。

```bash
node scripts/curia-workflow.mjs tasks inventory --package docs/jobs/report --all --json
node scripts/curia-workflow.mjs tasks outcome --package docs/jobs/report --receipt docs/jobs/report/ledger.json --invocation round-1 --non-sensitive --json
```

`inventory` 只读 Registry 和路径元数据，列出成员角色、读取限制、未分类或未观察到的文件及 owner 缺口，不读或摘要成员正文；敏感成员可以按名字盘点，显式 `--exclude` 优先且不回显被排除成员名称。`--all` 仅增加未忽略的未跟踪文件。classified 只表示本次范围的声明分类可解释，不表示内容、执行、冻结机制或业务结果已核实。

`outcome` 只读取调用方明确选择且符合 `outcomeAuthority` 的一个非敏感本地 JSON 回执。`recordsPointer` 指定数组账本，省略时读取单个回执对象；字段指针相对于每条记录，invocation、outcome、evidenceComplete 必填且各字段定位不得重叠。包内 authority 必须登记为 ledger、output 或 archive；包外共享 authority 还必须绑定 taskId。authority 可以声明目录，但每次仍须给出精确回执文件，不扫描目录、不猜最新。以上示例中的有效记录为 `{"rounds":[{"id":"round-1","task":"report-job","result":"done","evidenceComplete":true,"scheduler":"success","exitCode":0,"at":"2026-10-17T00:00:00Z"}]}`。

按精确 taskId 和 invocation 唯一选择记录，不回显正文或其他轮次。调度状态、退出码、业务结果和证据完整度分列；没有记录不是空轮次，也不是未执行。重复轮次、无法解释的行身份、未知结果、不完整证据以及已完成／空轮次与非零退出码的冲突均保留缺口，字符串 `"true"` 不等于完整证据，数值舍入不能把非零退出码变成成功。退出码只接受精确的非负 32 位整数；时间字段保持原有日期或 instant 精度。

回执最多 64 KiB、账本最多 1024 行；UTF-8、JSON 重复键、深度和完整字节预算均校验，不用前缀背书。可用 `--max-bytes` 收紧预算、`--expected-revision sha256:raw-bytes/1:<hex>` 绑定原件修订；Registry、回执或任务目录边界后检失败撤回结果。completed／empty／classified 退出 0，观察到 failed／running／not-executed 退出 1，缺口或非法输入退出 2。结果只是配置所指原生回执的报告值，不认证身份、不独立验证外部效果、不重建历史、不写 Run；`--protected` 在读取前拒绝未实现保证，不降级为普通观察。

## 可选 Move Binding

只有机器消费者或长期引用需要连续身份时，才向已有 instance 添加 moves；普通重命名不要求登记或逐篇补 ID。它把旧路径与完整 Git commit 联合定位到当前文件，保留迁移依据，不移动文件、不重写链接、不建立路径别名，也不改变 authority 或 supersession。下面是合入既有 instance 的字段，不替换 surfaces；revision 必须替换为旧文件真实存在的完整 commit ID。

```json
{
  "moves": {
    "schema": "curia.moves/1",
    "artifacts": [
      {
        "id": "manual",
        "current": "docs/new.md",
        "previous": [
          {
            "path": "docs/old.md",
            "revision": "1111111111111111111111111111111111111111",
            "basis": ["docs/decisions/manual-move.md"]
          }
        ]
      }
    ]
  }
}
```

同一对象继续移动时保留 id 和已有 previous，更新 current 并加入新的精确旧定位及依据。旧路径被别的对象复用、或同一对象回到旧路径时，仍按路径与 revision 区分；不按裸路径重定向，不串联声明链或猜测 Git rename。历史定位全局唯一，当前定位不能同时属于多个对象；大小写和 Unicode 等价但拼写不同的声明拒绝，单纯大小写改名不在此版本支持范围。当前目标与依据属于现有受管面，旧定位可属于已经退出当前布局的目录。

```bash
node scripts/curia-workflow.mjs moves --from docs/old.md --revision 1111111111111111111111111111111111111111 --within docs --non-sensitive --strict --json
node scripts/curia-workflow.mjs moves --help
```

within 可重复，必须覆盖旧定位、当前目标及全部依据，exclude 优先；没有授权的目标与依据名称不输出。非敏感声明覆盖所选历史原件、当前原件、依据及当前／历史 Registry，不是秘密检测器或多用户 IAM。默认当前文件须在 Git index 中；all 才包含未忽略 untracked。默认隐私路径、原始语料标记、链接、挂载、嵌套仓库、忽略与冲突检查不能被声明绕过；历史 rawMarker 与当前隐私底线共同生效，未知历史 Registry 版本不读取历史正文。

输出 curia.move-resolution/1，完整读取旧 Git blob、当前目标与依据的原始字节后给出摘要、实际观察时刻和配置指针，不输出正文。结果是 resolved-declaration，不是身份或审批认证；相同字节不证明同一对象，不同字节也不否定显式声明。当前工作树不冒充 HEAD，依据是本次观察的当前文件，不冒充历史签署。前后共同复核固定来源，漂移、缺失、超预算或访问缺口撤回整组证据；stdout 的接收端完整性仍未观察。

共享正文预算沿用 max-files、max-file-bytes 和 max-total-bytes；当前与历史 Registry 每次配置观察各独立限 1 MiB。历史对象只从本仓本地 Git 读取，不自动 fetch、不运行 filter、diff driver、项目命令或正文指令；支持完整 SHA-1／SHA-256 commit ID，拒绝 ref、缩写、表达式、目录、symlink 与 gitlink。参数、配置形状或仓库边界错误退出 2；未启用绑定、定位未登记及观察缺口属于未解决，strict 下退出 1。

该入口不创建 Run、常驻进程或新文件根。普通阅读不跟随 Move；[当前配置影响](#当前配置与-authority-声明的影响)独立投影迁移依据的当前依赖，旧路径与 revision 只作声明信息，不成为当前路径重定向或依赖边。跨仓身份、外部修订、认证 authority、字段级时间推理和历史业务重构仍须独立合同。实现与负向用例归 [Move 入口](../template/scripts/curia-moves.mjs)、[查询读取边界](../template/scripts/curia-query.mjs) 和[专项夹具](../template/scripts/curia-moves-self-test.mjs)。

## 可选 JSON 原件

两种方式都复用已有 `instance.mappings`，不替换 surfaces、不新建配置文件或一篇一份伴随文档。未映射的 JSON 仍不读取正文；parser 启用不等于访问授权。

### 普通结果：仅内容读取

普通 JSON 结果、API 数据与机器清单不需要原生 ID、版本或状态。只启用固定 `contentParser`，可按文件或纯 JSON 子目录继承；混合目录用精确文件 mapping，格式不符不回退其他 parser。

```json
{
  "mappings": [{ "path": "docs/result.json", "kind": "file", "contentParser": "json-data/1" }]
}
```

对应原件可以直接是对象、数组或标量，不补造流程字段：

```json
[{ "method": "GET", "path": "/items", "response": 200 }]
```

正文保持原文，不把数字重写为 JavaScript 精度下的值。`Owner`、`Status`、`Type` 等同名业务键没有元数据含义；归属只能来自已声明的 instance、surface 或路径默认值，并标记 `registry-inherited` 来源。未声明的生命周期与维护方式继续 unknown，不阻止正文阅读，也不因语法有效而变成 current、已批准或已核实。选择有状态类型却不提供其状态仍报告缺口；无状态只能来自已登记的无状态 profile。

`envelope.content` 报告 parser、配置来源、syntax-only 覆盖与失败原因；`metadataRead: registry-only` 不表示读到了原生字段。完整载荷未读、损坏或超限时不使用前缀补元数据。普通阅读只输出临时上下文，不落 Run 或过程文件。另行要求持久化 Run 时，未解决的治理缺口仍使其 terminal 为 incomplete；不为获得 passed 而补造原生字段。

```bash
node scripts/curia-workflow.mjs --path docs/result.json --inventory --json
node scripts/curia-workflow.mjs --path docs/result.json --strict --json
```

### 原生字段：按需映射

只有原件本来就有原生身份、版本、生命周期和归属时才添加 `nativeProfile`，内容读取不以此为前提。下面的 mapping 与 nativeProfiles 条目合入已有 instance；与正文 parser 同时启用时，原生字段要求仍生效，不能用内容解析成功掩盖缺字段或格式冲突。

```json
{
  "mappings": [{ "path": "docs/manifest.json", "kind": "file", "defaults": { "type": "reference" }, "nativeProfile": "json-manifest" }],
  "nativeProfiles": {
    "json-manifest": {
      "parser": "json-native-object/1",
      "authorityLinks": ["AGENTS.md"],
      "fields": { "id": "/document/id", "version": "/document/revision", "lifecycle": "/document/state", "owner": "/document/owner", "pointer": "/document/head" },
      "lifecycles": {
        "Current": { "view": "current", "facets": { "effect": "confirmed", "blocker": "none", "dependency": "none", "purpose": "manifest" } }
      }
    }
  }
}
```

对应原件示例：

```json
{
  "document": { "id": "manual-manifest", "revision": "v1", "state": "Current", "owner": "documentation-owner", "head": "./manifest.json" },
  "entries": []
}
```

定位符从 `/` 开始，逐层取自有字段，`~1` 表示键名中的 `/`，`~0` 表示 `~`；数组下标使用无前导零的十进制整数。字段只接受非空单行字符串；数字编号、复合值、空值与缺失显式报缺口，不强转或用目录 owner 补齐。JSON 中未绑定的 Type、Owner 或 Status 不按 Markdown 头块解释；原生 state 仍需精确映射，current 和 confirmed facet 不等于事实核验。

两种 parser 的完整输入上限均为 64 KiB、嵌套上限为 64 层，全部对象必须满足唯一键检查，转义后重复也失败。UTF-8 损坏、BOM、语法错误和超限不输出已解析结论；原生字段 parser 额外拒绝根数组和标量。截断阅读只返回标明 partial 的原文前缀，不生成完整摘要。提高 workflow 预算不扩大 parser 硬限制。effects、privacy、限制与版本可从 content.contract 或 native.contract 查看；原生字段来源使用 JSON 定位符，不伪造行号。

```bash
node scripts/curia-workflow.mjs --path docs/manifest.json --inventory --json
node scripts/curia-workflow.mjs --path docs/manifest.json --strict --json
```

读取只处理本地数据，不执行原件中的命令，不跟随 URL、schema 或 `$ref`；默认敏感路径和显式排除优先，映射不是访问授权或秘密检测器。`--links` 不因 JSON 已解析而宣称它的引用已检查。该能力不验证 OpenAPI、业务 schema 或台账不变量；变体和适用时间仍只解析 Markdown，不能把未接入的 JSON 绑定报成通过。普通阅读不落 Run；显式记录沿用字节证据，新规则版本不改写历史 Run。实现合同见 [curia-json](../template/scripts/curia-json.mjs)。

## 显式来源事实核验

需要核对已经存在的两个原载荷时，使用 `curia-verify`，不另抄期望值表、不创建过程文档。它是按需的本地比较，不由普通 workflow、JSON 内容 mapping 或原件登记自动触发。事实源可在同仓代码目录，不需要把代码目录增加为受管面，也不需要为这次比较修改 Registry。

以下命令比较两份已有 JSON 的 `/info/version`；路径必须由调用方显式指定，不能由来源中的链接自授读取权限。使用前确认两端完整文件、路径和定位符均为非敏感资料，再传 `--non-sensitive`。

```bash
node scripts/curia-verify.mjs --method json-value-equal/1 --left packages/contracts/openapi.json --left-pointer /info/version --right docs/api.json --right-pointer /info/version --non-sensitive --json
node scripts/curia-verify.mjs --method raw-bytes-equal/1 --left packages/contracts/openapi.json --right docs/api.json --non-sensitive --json
node scripts/curia-verify.mjs --list-methods --json
```

JSON 定位符支持空串 `""` 表示整个值，非空定位的转义与数组下标规则同前。对象键顺序不影响值相等，数组顺序影响；字符串不做 Unicode 归一化，数字不与字符串互转。数字按十进制精确值比较：`1` 与 `1.0` 相等，不同的大整数不会因 JavaScript 精度而相等，极小数不塌缩为零。原始字节比较则保留空白、编码和格式差异，不解释 PDF、Office、加密文件或业务 schema。

路径只接受规范仓内相对路径，不接受 URL、通配、`#` fragment 或 `%` 编码别名。默认只读取 index 可见的精确普通文件；`--all` 只加入这两个路径中未被忽略的 untracked 文件，不扫描全仓。ignored 文件即使被强制加入 index 仍排除；敏感路径、原始语料标记与可重复的 `--exclude <path>` 优先。任一来源缺失、被排除、超限、穿越链接 / 挂载 / 嵌套仓库，整组不读取。HEAD、index、Registry、忽略状态、挂载和选中原件在读取前后复核，变化时撤回来源字节与证据，不以好工作树掩盖读取期间漂移。

上述两种等值方法每个来源最多 64 KiB，一次最多两个不同文件、合计 128 KiB；JSON 最多 64 层，拒绝重复解码键、BOM、损坏的 UTF-8 和语法错误。预算只允许完整原件，不输出部分值或前缀证据；控制配置与工具身份读取另受内置上限约束。默认路径排除不是秘密检测器；不确定内容是否敏感时不要传非敏感声明，也不要用摘要代替隐私审查。

结果 schema 为 `curia.verification/1`，只写 stdout，不自动落 Run 或持久化 Assertion：

| 字段 | 含义 |
|---|---|
| `assertion.state` | confirmed 仅说明指定方法下两端相等；contradicted 说明不等；缺失、无权限声明、无效或未完整读取为 unverified |
| `assertion.sourceRefs` | 按左右顺序保留实际完整原件的内容 Digest 修订、locator 和观察 instant；不是把当前工作树归因给 HEAD |
| `assertion.evidenceRefs` | 实际读取的完整字节身份、来源定位和适用关联；原件不存在或只读前缀时不生成 |
| `assertion.verifiedBy` | 实际比较方法、观察时间与本地工具身份引用；未完成比较保持 null |
| `observation` | 输入的 HEAD / index、Registry 身份、范围、预算和前后复核；缺少隐私声明或要求受保护核验时不读取来源 |
| `comparison` 与 `unresolved` | 等值、差异、字段缺失或未核验原因；不回显字段值、正文或异常中的来源内容 |

退出码分别为 confirmed＝0、contradicted＝1、unverified 或非法调用＝2。两种等值关系都是调用方明确要求的必查项，不输出 not-applicable；两端字段都不存在仍然是 unverified，不算相等。完整字节相等，包括空文件相等，也不证明业务正确、发布成功或资料具备效力。

核验时间来自本机时钟，读取是非原子的前后复核，报告不能保证此后文件不变。模块摘要与 Node 版本是本地工具身份，不是认证 signer 或加载代码证明；`--protected` 在读取原件之前返回 authenticated-verifier-required，不降级成普通 confirmed。上述两种等值方法不执行来源命令、不跟随 schema 或 `$ref`、不下载、不联网、不解释登记版本，也不抹掉此前相矛盾的证据；外部访问、认证身份和业务 verifier 仍需独立扩展；本地等值结果的可选持久化见下一节。

## 可选事实核验记录与更正历史

只有需要长期保留核验依据时，才在已启用 recordStore 的实例中使用 `curia-records verify`。它直接调用上节的本地等值核验，不接收导入的核验 JSON、手填结果或调用方分配的 run-id；不增加一级目录，也不把人工观察升级为机器核验。

```bash
node scripts/curia-records.mjs verify --method json-value-equal/1 --left packages/contracts/openapi.json --left-pointer /info/version --right docs/api.json --right-pointer /info/version --non-sensitive --json
node scripts/curia-records.mjs show --run <run-id> --json
node scripts/curia-records.mjs history --run <run-id> --json
```

verify 的两个来源、定位符和更正原因均须非敏感；敏感路径、原始语料标记、ignored 与显式排除不可绕过，输入不得位于记录输出目录。`--protected` 拒绝持久化，不降级成普通核验；也不支持 original / relations 结果的导入。其他来源参数和资源限制沿用等值核验器。记录只保存来源身份、定位、比较状态、工具实现、实际观察时间和缺口，不保存正文或字段值。

需要更正同一精确关系时，在相同 verify 命令后加 `--corrects <旧 run-id> --reason <非敏感原因>`；仅重试使用 `--retried-from <旧 run-id>`，两者互斥。目标必须是同一方法、左右路径与定位的既有终态断言；内容修订可以变化，不自动跟随别名或跨范围收窄。更正只新增记录，旧证据不覆盖；重试不隐含取代。多个更正端点不按时间选赢家，多前驱合并仍未支持。

begin 保存已经完成的真实核验，实际核验时间与落盘时间分开；terminal 派生 passed、failed 或 incomplete，对应退出 0、1、2。相符仅指所选本地等值关系；矛盾不是成功，未知不能抹掉缺口。保存后来源仍可能变化，记录不代替当前核验、业务正确性、原生 authority 或认证审批。

history 只沿显式更正 / 重试引用查询连通记录，不自动收集全部同主题记录；有界视图超限直接拒绝，不返回部分成功。它保留旧结论、证据入口和原因，多个结论端点、未封存或仍有效的未知记录返回 incomplete 与退出 2；单一已封存结论返回退出 0，但不表示该结论当前仍为真。完整旧记录仍由原合同读取，不改历史字节。

如果 verify 报告观察已发布但封存未知，先 show 回读；仅有 begin 时，执行 `node scripts/curia-records.mjs finish --run <run-id> --expect <expectedHead> --json` 封存原观察，不重新读取来源或重跑核验。记录上下文漂移使结果 incomplete；不得把该方式用于命令 supervisor 丢失或未知外部效果。实现与历史格式归[断言合同](../template/scripts/curia-assertion-contract.mjs)，完整性门禁与 Git 基线规则同前。

### 原件登记核验记录

需要长期保存[本地原件摘要核验](#按需核对本地原件修订)时，在已启用 recordStore 的实例中显式使用 verify-original；它自行执行核验，不导入临时 JSON，不读取正文、解密或调用 Office parser。

```bash
node scripts/curia-records.mjs verify-original --register docs/source-register.json --id manual --source docs/files/manual.pdf --non-sensitive --json
```

来源、路径、登记元数据和更正原因均须非敏感；`--protected`、敏感或 ignored 来源、显式排除和记录目录内输入在写入前拒绝。`--all` 仅加入未忽略 untracked，`--max-source-bytes` 沿用原件摘要预算；预算只影响本次观察，不改变断言主题。普通 `curia-verify original` 仍然无持久化。

记录分开保存登记的完整字节身份、该次登记元素的 JSON pointer 和原件的完整摘要身份，不把登记摘要当原件摘要，不把摘要读取当正文读取。expected 来自登记，observed 来自原件；相符、矛盾、未知仍分别对应 0、1、2，阶段预算和实际打开数独立保留。格式、加密、访问、声明定位及声明观察时间均不因保存记录而变成已核实；原件内容和登记中的 owner、AccessRef、locator 不复制到记录。

show、history 与 begin-only 的 finish 用法同上。更正或重试在相同命令后加 `--corrects <run-id> --reason <非敏感原因>` 或 `--retried-from <run-id>`；只能引用同一方法、登记路径、登记 ID 与原件路径的既有终态记录。数组重排导致实际 JSON pointer 变化时仍保留每次证据；换 ID、换登记表、跨路径或跨方法不自动视为同一断言。history 不读取当前原件，finish 不重跑核验。

原件使用 event/5、assertion-run/2、assertion-observation/2 与 subject/2；原等值断言继续使用原版本，旧人工、guard、检查批次和断言记录不改写。新视图的 schema 为 curia.assertion-run-view/2 或 curia.assertion-history/2；依赖旧 schema 的消费者必须显式适配，不用宽松解析吞掉新语义。

### 外部原件核验记录

需要保存[外部原件修订核验](#按需核对外部原件修订)的依据时，在已启用 recordStore 的实例中显式使用 verify-external-original。它内部执行一次实际核验，不接收 reader JSON、手填结果或调用方指定的 run-id；普通 external verify-original 仍不持久化。

```bash
node scripts/curia-records.mjs verify-external-original --register docs/source-register.json --id external-guide --url https://invalid.example/guide.docx --allow-origin https://invalid.example --media-type application/vnd.openxmlformats-officedocument.wordprocessingml.document --non-sensitive --json
```

上例沿用本文没有 revision 的 external-guide 登记，产生保留单侧登记证据的 incomplete 记录、退出 2，不发起外访。真正比较需要登记维护者独立提供可解释的完整期望摘要；工具不会回填本次观察值。网络授权、CA、内网许可、媒体类型与限额沿用外部核验，登记与 CA 必须位于记录输出目录之外；`--protected`、敏感、ignored 和显式排除不进入记录。

外部记录独立使用 external-verification 模式和 event/6；视图分别是 curia.external-assertion-run-view/1 与 curia.external-assertion-history/1。它保留本次来源证据、比较、实际连接与信任身份，不复制响应正文、登记归属字段或响应头值。相符、矛盾、缺口分别派生 passed、failed、incomplete 和退出 0、1、2；持久化不升级业务事实、源站新鲜度或认证保证。

show、history 与 begin-only 的 finish 沿用上节命令，只读冻结观察，不重新读取登记、CA 或访问 URL。更正或重试可追加 `--corrects <run-id> --reason <非敏感原因>` 或 `--retried-from <run-id>`，只能关联同一方法、登记路径、ID、URL 与保证档的既有外部终态记录，不能把本地断言并入该历史。预算与信任参数可变化，但每次实际请求和观察仍独立留存；多个结论不自动选赢家。

记录在核验完成后才开始，不是网络 supervisor；请求途中进程丢失可能没有记录，不能据此认定没有外访。SIGINT／SIGTERM 保持退出 130／143；已形成的取消观察只能封存为 incomplete。若报告保存或封存未知，先 show 核对，再按 expected-head finish，不盲重跑。合同与历史解释由[外部断言 codec](../template/scripts/curia-external-assertion-contract.mjs) 维护；旧 event/1 至 event/5 的本地、guard 和检查批次合同不扩张。

## 可选取代图与引用效力

链接可达不等于现行规范。需要检查文档取代、current 指针和引用用途时，在既有 `instance.mappings` 合入下面的绑定，不另建关系台账或一级目录；普通 workflow 不自动调用关系检查。

```json
{
  "mappings": [{ "path": "docs/manuals", "kind": "directory", "relations": { "schema": "curia.relations/1", "parser": "markdown-header-relations/1" } }]
}
```

默认从原件头块读 Supersedes、Superseded-by、Current、Normative-refs 与 Historical-refs；只写实际存在的关系，不要求每篇补齐空字段。例如三个已有原件分别为 `old.md`、`current.md`、`use.md`：

```markdown
# 旧手册

Status: superseded
Owner: docs-owner
Superseded-by: [新手册](current.md)

保留旧版的适用背景，不删除历史。
```

```markdown
# 当前手册

Status: current
Owner: docs-owner
Supersedes: [旧手册](old.md)
Current: [本文件](current.md)

这里是当前结果，不需要补造实施过程。
```

```markdown
# 使用说明

Status: current
Owner: docs-owner
Normative-refs: [当前手册](current.md)
Historical-refs: [旧手册](old.md)

规范依据与历史背景分别引用。
```

```bash
node scripts/curia-verify.mjs relations --path docs/manuals/old.md --path docs/manuals/current.md --path docs/manuals/use.md --non-sensitive --json
```

选集必须是精确文件，不接收目录或通配；`--all` 只加入这些路径中的未忽略 untracked 文件，`--exclude` 仍优先。缺少非敏感声明、选择敏感 / ignored / raw 文件、链接别名、超限或快照漂移会阻止读取或撤回整组证据。引用目标必须已经在选集中；未选中的目标只报告 target-outside-selection，不探测是否存在，不跟随外部 URI，也不回显其中的路径或凭据。

Markdown 字段可用单个相对路径，或一个 / 多个相对 Markdown 链接；链接之间用空白、逗号或顿号分隔。Current 与 Superseded-by 必须唯一，字段重复即冲突，不采用最后一个值。只接受规范相对路径和开头的 `./`、`../`，不归一化中间的 `目录/../`，不解析 `%` 编码别名、锚点、标题参数、引用式链接或 HTML。未支持语法保留缺口，不能只解析前半段就声称完整。

Supersedes 与 Superseded-by 统一成旧件指向新件，合法互相声明不形成假环；Current 的自指针是终点，其他自取代仍失败。检查跨种类的环、分叉、current 已被取代、多个 current 指向同一 authority，以及同一 applicability cell 或 Native Binding 身份中的重复 current。规范引用不能指向已取代或历史文档；历史引用保留其用途，不自动改成新版本。

### current 入口不是第二篇权威

确实只承担 current 导航的已有入口，用更具体的 mapping 声明 `kind: current-pointer`；默认字段只剩 Current。它不参加当前文档计数，但两个生效入口指向同一 authority 仍冲突；空入口也不通过。普通文档不能靠正文自称“入口”跳过重复 current 检查。

```json
{
  "path": "docs/manuals/current-pointer.md",
  "kind": "file",
  "relations": { "schema": "curia.relations/1", "parser": "markdown-header-relations/1", "kind": "current-pointer" }
}
```

入口原件的头块可直接写 `Current: [当前手册](current.md)`，不需要新增生命周期。把入口加入同一 `--path` 选集后，规范引用可以经它定位 current 终点；入口自身不因此成为现行规范。缺少生命周期可以由导航绑定解释，但非法状态和 draft 不会因此生效；退役入口仍保持历史效力，原生 blocker / dependency 也不会因导航用途被绕过。

### JSON 与原生指针

JSON 关系使用 `json-pointer-relations/1` 与显式 fields；值是相对路径字符串或字符串数组，不把数字、对象或 null 强转为路径。Current 与 Superseded-by 只能有一个目标；其他关系允许显式空数组。纯 JSON 导航可绑定 `kind: current-pointer` 与 `fields: { "current": "/current" }`，不需要伪造原生身份字段。

已有 Native Binding 的 current pointer 用 `nativePointer: true` 复用，不再次映射它的字段。例如合入已有原生 JSON mapping：

```json
{
  "relations": {
    "schema": "curia.relations/1",
    "parser": "json-pointer-relations/1",
    "fields": { "supersedes": "/previous", "supersededBy": "/next", "normative": "/uses", "historical": "/history" },
    "nativePointer": true
  }
}
```

未知 schema / 字段 / parser、重复字段定位、与已有原生或适用性字段冲突、把固定关系名称换作另一用途、无 Native Binding 却要求 nativePointer，以及继承后的格式冲突都会被拒绝。子 mapping 的 relations 整体替换父绑定，不逐字段拼出隐式规则。默认字段仅属于 Markdown；JSON 必须显式给 fields，原生指针单独使用时可给空对象。

### 结果与保证范围

报告 schema 为 `curia.reference-check/1`；pass＝0、fail＝1、incomplete＝2，未启用任何绑定为 not-applicable＝0，不伪装检查通过。输出声明字段定位、选集内的图和引用结果、SourceRef / EvidenceRef、实际字节 Digest、配置与工具身份，不输出正文和原生字段值。引用链上任一相关节点的冲突或效力缺口都会撤回逐条 current 成功标记，不能越过中间历史文档，或从失败报告里摘一条成功引用代签。

current 判断复用原生 lifecycle 视图或 Curia 文档语义，完成的 spec 仍是权威，不与已完成计划混同。原生 blocker / dependency、元数据冲突、时效和适用单元缺口单列保留，current 标签不会自动消除它们。独立 current 文档也检查有效期，不以“无人引用”免检；带注解的 superseded 状态仍需后继。最多读取 32 个文件、单件 64 KiB、合计 512 KiB；单件关系和全图另有硬限制，超限不输出部分图充当完整结论。

`scope.globalCoverage` 与 `graph.coverage.global` 始终为 false；complete 只表示本次选集的声明字段检查完备，不能证明选集外没有重复权威，也不包含正文普通链接。它不是认证审批、业务正确性验证、自动依赖闭包、外部 ID 解析或持久化取代记录；`--protected` 仍在读取前报告认证缺口。默认双根与结果优先不变，不新增 Run、索引、常驻服务或迁移原件。

## 可选授权依赖读取

普通 workflow 只读调用方选集，不自动跟随引用。确实需要补读声明依赖时，复用上节的 relations 绑定，并把“从哪篇开始”和“最多允许读到哪里”分别给出。以同一组三篇手册为例：

```bash
node scripts/curia-workflow.mjs --path docs/manuals/use.md --dependencies --within docs/manuals --non-sensitive --strict --json
node scripts/curia-workflow.mjs --list-checks --dependencies --json
```

`--within` 可重复，接受规范相对文件或目录，不接受通配。种子本身也在允许范围内；`--exclude`、默认隐私排除和 Git 忽略仍优先，`--all` 只加入未忽略 untracked。非敏感声明须覆盖种子、允许范围和路径本身，不能由原文、Registry 或序列化报告提供。仅盘点时加 `--inventory`，此时授权目录里的路径可见，依赖正文未读，不能声称闭包完成；依赖模式不与 `--corpus` 混用。

该模式只沿已绑定的规范、历史、取代与 current 字段补读，复用 Markdown、JSON 和 native pointer，不扫描正文普通链接、外部 URL 或 `$ref`。关系 JSON 可在此模式直接读成原文，不为此建立原生身份；普通 workflow 的 JSON 准入不变。允许目录中的无关文件只被盘点，不被读取正文；相互引用不会反复读取同一原件。

读取预算由已有 `--max-files`、`--max-file-bytes`、`--max-total-bytes` 统一约束，不按每一跳重置。图与授权盘点另有限额，由 dependencies.limits 报告；部分原件、未知绑定、无法定位、范围外目标或超限使 dependencies.complete 为 false，整体不输出 read-complete，`--strict` 退出 1。参数或授权声明非法退出 2。缺口不会触发外访、隐式放宽范围或项目命令。

所有跳使用同一次盘点及同一配置，结束时复核全部曾读原件；漂移撤回整组正文、摘要和依赖图。输出含种子、允许范围、实际展开路径、关系用途、定位与未决项，接收端是否截断仍未观察。complete 仅表示本次授权范围内的登记关系闭合，不证明全局依赖、效力或事实；效力检查仍用 `curia-verify relations`。诊断不回显范围外目标值，原文上下文仍保留已授权来源的原始内容，不是秘密检测器。

本模式不创建 Run、缓存、索引或过程文档；反向影响计算、跨仓快照、外部依赖和受保护读取未被本地闭包代替。实现与边界见 [curia-dependencies](../template/scripts/curia-dependencies.mjs) 与 [curia-query](../template/scripts/curia-query.mjs)。

## 可选反向影响计划

需要判断“改了某个文件后，应复核哪些文档”时，使用独立的 impact 子命令。它与沿引用方向补读上下文不同：调用方给出精确变更路径和允许扫描的业务范围，工具检查该范围中的关系源，再输出反向关联的复核候选；不自动发现全仓、不执行候选命令、不输出正文、不生成 Run 或持久化索引。

沿用前面的 `docs/manuals` 关系 mapping 和示例原件：

```bash
node scripts/curia-workflow.mjs impact --changed docs/manuals/current.md --within docs/manuals --non-sensitive --inventory --json
node scripts/curia-workflow.mjs impact --changed docs/manuals/current.md --within docs/manuals --non-sensitive --strict --json
node scripts/curia-workflow.mjs impact --list-checks --json
```

`--changed` 可重复，但每项是精确路径，不扩展目录；变更名字与 `--within` 扫描范围独立，排除优先；代码契约或未纳管原件可以只提供名字，不读取其字节，也不把代码树注册成文档面。删除的旧路径也可作为调用方声明的名字参与匹配，不要求原文件仍存在；未暂存的常规文件删除不要求先改 index，但必须能复核安全父目录和持续缺失，原件重现时撤回计划。未声明缺失、配置 authority 缺失或不安全路径不因此豁免；移动需分别给出旧、新路径，不猜测别名或 Git rename。路径声明不是 Git 差分、删除证明或文件读取证据，大小写和 Unicode 等价别名不被静默当作“无影响”。

反向引用规则是：目标变化会使持有 normative、historical 或 current 引用的源文件进入复核集合；取代关系还会将两个端点共同纳入复核。传播递归进行，循环与重复引用只产生有限候选，输出最短传播深度和逐边理由。历史引用也保留影响，因为原证据变化可能需要复核；这不是自动把历史内容改成 current，更不是自动修订原件。

反向关系无法只从变更文件本身得知。因此本模式明确允许读取该范围内所有已绑定关系字段的原件，使用同一盘点和累计预算；未映射文件不读取正文，也不能当成无依赖叶子。范围应按实际业务域选择，不把一次局部修订默认扩大成全仓扫描。工具不维护跨次缓存，也不把本次候选自动用于下一修订；跨次复用需要重新确认输入与配置身份。

普通 md / JSON 关系 parser、原生 pointer 和现有字段 mapping 继续适用；不扫描散文链接，不推断代码、配置 authority 或外部系统依赖；当前 Registry 的显式配置依赖由下方配置模式独立启用。未映射、未支持语法、截断、未知目标、外部引用或范围外目标都使计划 incomplete，不回显未获授权的目标值。默认敏感路径、raw、ignored（含强制 tracked）与调用方排除均不读；只检查范围内实际读取的声明，不能声称排除区和其他仓库无影响。

关系读取的文件数、单件与累计字节预算与普通读取共用，可用 `--max-files`、`--max-file-bytes`、`--max-total-bytes` 调整；关系 parser 自身仍限制单件 64 KiB。影响图另限制 2048 个源、128 个变更名字、16384 条声明关系和 128 层传播，触限报告缺口，不以截断图宣称完整。全部候选来源、Registry、HEAD、index、挂载和有效忽略集合共同复核；漂移时撤回关系图、复核候选和原件证据。

默认输出 `curia.impact-plan/1`，核心字段如下：

| 字段 | 含义 |
|---|---|
| `scope` | 调用方变更名字、允许范围、排除与非敏感声明；globalCoverage 固定为 false |
| `coverage` | 盘点数量、实际完整检查数量与累计字节；bodiesEmitted、factVerified 均为零 |
| `impact.affected` | 变更名字与反向关联对象，含深度、是否仍在盘点中及关系理由 |
| `impact.reviewPaths` | 当前盘点中需要复核的文件；已删除的名字不伪装成可读取对象 |
| `sourceRefs` / `evidenceRefs` | 实际完整读取的关系源、摘要与观察时间；不为缺失或前缀原件造证据 |
| `complete` / `unresolved` | 只表示显式范围内已声明关系是否检查完整；缺口时候选不是完整影响结论 |

普通模式输出报告，`--strict` 对 incomplete 或仅盘点退出 1，参数或边界不可用退出 2；完整计划退出 0。候选包含需要人工判断或另行调用检查器的对象，不是自动放行、不受保护的审批或业务事实核验。普通 workflow、依赖补读和历史 Run 的规则集不变。实现归[影响图](../template/scripts/curia-impact.mjs)，自证归[影响夹具](../template/scripts/curia-impact-self-test.mjs)。

### 从本地 Git 变化生成复核计划

不想手工列名时，显式选择 Git 模式；变更观察范围与关系扫描范围分开授权。例如代码契约变化可以影响手册，但代码不必成为文档受管面：

```bash
node scripts/curia-workflow.mjs impact --git-base HEAD --changes-within packages/contracts --within docs/manuals --non-sensitive --inventory --json
node scripts/curia-workflow.mjs impact --git-base HEAD --changes-within packages/contracts --within docs/manuals --non-sensitive --strict --json
node scripts/curia-workflow.mjs impact --list-checks --git-base HEAD --json
```

`--git-base` 接受 HEAD、本地分支或 tag、完整 commit OID，不接受缩写 OID、revision 表达式或外部来源；基线固定到 commit 并前后复核，不 fetch。`--changes-within` 可重复，指定允许摘要的文件或目录；`--within` 仍只授权关系源扫描。Git 模式与 `--changed` 互斥，`--exclude` 同时缩小两种范围；非敏感声明不是秘密检测器。Git 模式的 `--inventory` 只盘点变更来源，不摘要工作树，也不扫描关系正文。

未启用配置模式时，`changeObservation` 使用 `curia.git-change-observation/1`：逐项保留基线到 index 的 `staged` 差异、index 到原始工作树的 `worktreeChange` 差异、原始摘要和实际观察时间。比较包括内容与可执行位；两轴变化取并集，暂存内容被工作树反向修改时也不会丢失。删除提供旧名，移动按旧名删除和新名增加处理，不猜 rename 或别名。默认不读取未跟踪载荷；基线已有但 index 已删除的文件在工作树重现时，标记 `not-observed-untracked`，删除候选仍保留。需要未跟踪文件时显式加 `--all`。

Git 只提供本地路径与对象元数据；工作树字节由稳定文件描述符流式计算 SHA-256 摘要及对应仓库算法的 raw Git blob OID，不调用工作树 diff、clean filter、textconv 或项目命令。它不做 Git 的 EOL、编码或 clean 归一化，因此可能保守增加候选，不等价于 `git status`。原件内容不输出，不做解密、正文解析或业务判断；hashed 不等于 read。

摘要默认最多 256 个观察对象、单件 16 MiB、合计 32 MiB，可用 `--max-change-files`、`--max-change-file-bytes`、`--max-change-total-bytes` 独立调整；硬上限分别为 2048、512 MiB、1 GiB。发现数量先受 2048 个路径限制，变化名字仍受影响图的 128 项限制；超限不能当成无变化。关系读取继续使用 `--max-files` 等原预算，不和大附件摘要混算。

变更观察与关系扫描共同核对 Registry、HEAD、index、基线 ref、来源、缺失状态、路径边界、有效忽略和未跟踪集合；两阶段不一致时撤回整组变化证据、关系证据与候选。没有变化时输出 `no-changes-within-scope`，不读取关系正文；此时 complete 只表示授权且未排除的变化范围已检查，impact 为 null，不代表全仓无变化或关系图完整。空有效范围、未匹配路径、被阻断和超限均为 incomplete；strict 退出码仍为完整 0、不完整或仅盘点 1、参数或基线不可用 2。

Git 模式有独立规则版本；它不改变手工名字、普通读取或历史 Run 的合同，不创建持久化索引、不执行候选检查、不作暂存门禁或发布批准。实现归[查询器](../template/scripts/curia-query.mjs)与 [workflow](../template/scripts/curia-workflow.mjs)，验证归 [Git 观察夹具](../template/scripts/curia-git-changes-self-test.mjs)。

### 按 Git 变更直接阅读

只需要阅读本次修改相关文档时，read-changes 将现有 Git 观察、反向影响计划与正文读取接在一起。先确认变更来源与关系扫描范围均非敏感；文档关系仍按上述 mapping 声明，未映射不会被当成没有引用。

```bash
node scripts/curia-workflow.mjs read-changes --git-base HEAD --changes-within packages/contracts --within docs --non-sensitive --inventory --json
node scripts/curia-workflow.mjs read-changes --git-base HEAD --changes-within packages/contracts --within docs --non-sensitive --strict --json
```

参数复用 impact 的本地基线、两类范围、排除、all、配置 include 和预算；不接受手工 changed 或配置 only。`--max-files` 与 `--max-total-bytes` 在关系扫描和正文读取间共用，不在第二阶段重置；工作树摘要仍使用独立的 `--max-change-*` 预算。Registry 摘要仍须精确声明其路径，不因该入口放宽。

输出 curia.change-read-workflow/1 分别保留 planning、reading 摘要与唯一一份 documents 正文。关系发现仍扫描授权范围；只把当前复核候选交给正文阅读，不输出无关文档正文，也不自动输出仅用于变更观察的代码载荷，不自动补读前向依赖。直接变更的未映射文档可以阅读，但未知入链继续使整体不完整；隐私扣留、删除、未读格式、预算和适用性缺口保留。覆盖分别报告关系扫描、正文阅读和消耗，不把未输出的关系源正文算成已交给读者。

无变化返回 no-changes-within-scope，不读取关系正文，也不证明全仓或历史配置无变化；完整声明图没有当前文档候选时返回 no-documents-to-read。任何选集、来源、关系源或配置在跨阶段复核中漂移，整组计划和正文撤回。普通完成或有效盘点退出 0，strict 下不完整退出 1，非法调用退出 2；read-complete 仍不是事实核实。

此入口不落 Run、不写缓存、不执行 guard 或模型、不访问网络。它交付本次显式变更驱动的候选阅读，不承诺跨次缓存、旧配置重构、外部关系、跨仓影响或受保护交付；普通阅读与原 impact 输出合同不变。

### 当前配置与 authority 声明的影响

需要判断 Registry 或项目规则变化的影响时，显式加入配置模式；不增添配置文件，也不要求文档移动或补造过程记录。

```bash
node scripts/curia-workflow.mjs impact --configuration only --changed .agents/doc-types.json --within docs --non-sensitive --strict --json
node scripts/curia-workflow.mjs impact --configuration include --changed AGENTS.md --within docs/manuals --non-sensitive --strict --json
node scripts/curia-workflow.mjs impact --configuration only --git-base HEAD --changes-within .agents/doc-types.json --within docs --non-sensitive --strict --json
node scripts/curia-workflow.mjs impact --list-checks --configuration only --json
```

| 模式 | 授权的检查 | complete 的范围 |
|---|---|---|
| `only` | 读取唯一 Registry，盘点对象，不读正文，不要求关系 mapping | 当前 Registry 的配置声明；正文关系未检查，inspection 为 not-applicable |
| `include` | 上述配置投影，加原有授权范围内的正文关系扫描 | 当前配置与已绑定的正文声明；未映射、未读或未解释正文仍使结果 incomplete |

配置边来自 Registry 本身、surface.authorityLinks、最终生效的 nativeProfile.authorityLinks、recordStore 范围内的 authorityLinks、选中 Move 当前对象的 basis，以及命中本仓输入的 guard.authorityLinks 与 command.identityPaths。Registry 文件变化保守影响本次选集中的所有对象；其他声明按适用范围投影。更具体 native profile 替代父层 profile；entry、README 或普通导航不自动成为 authority。默认两根布局没有隐式 authorityLinks，仍可以分析 Registry 对 Markdown、JSON、PDF 等已盘点文件的配置影响。

guard 依赖复用已登记的 inputScope：目录、排除与 Git 未跟踪策略共同决定适用对象；filesystem 声明也不会扩大本次允许的影响扫描范围。guard-authority 指向检查规则的登记依据，guard-code 指向明确登记的脚本或支持配置，JSON pointer 保留具体 guard 与字段位置。不解析脚本 import、命令参数或环境变量，不执行或读取检查目标；未登记的依赖仍未知。guard/2 也只投影主仓声明，configuration.guardScope 固定为 primary-repository-declarations-only，不绑定额外仓库或合并同名路径。

显式配置模式统一输出 `curia.impact-plan/4` 和 `curia.impact-graph/4`，其中 configuration 使用 `curia.configuration-dependencies/3`；即使没有 Move 或 guard，版本也不随选集切换。其中 registry 保存实际原始字节摘要、观察 instant 和字节数；每条边的 declaration 与 JSON pointer 指向该 Registry 声明，不指向受影响文档正文。sourceRefs / evidenceRefs 只来自实际读过的 Registry 和 include 模式中完整读过的关系源；authority 目标与未读原件没有正文证据。调用方的 `--at` 不改变实际观察时间，也不重构历史配置。

`--max-files` 同时约束配置投影对象数，最多 2048 个；Registry 固定上限 1 MiB，与正文单件和累计字节预算分开。配置边（含 guard 边）与 Move 声明行合计最多考虑 16384 项，扣留的声明也消耗预算；再与正文边共用同一图上限，传播深度仍受原有限制。每条旧定位与其全部 basis 边原子计费、原子输出，不输出半条绑定。计数和 Registry 字节单列于 coverage，不计成正文已读。预算耗尽、空有效选集、配置或正文缺口均不得报完整。

Move 的 moves 数组保留逻辑 ID、current、previous.path、完整 previous.revision、basis 和各自 Registry 定位；只有 move-basis 边从 basis 传播到 current。旧路径被当前文件复用或对象回迁时，历史定位都不会自动连入当前图；同名路径只有另被显式声明为当前 basis 才按依据角色传播。配置模式不读历史 blob 或 basis 正文，不核对身份连续性、审批或依据内容；需要实际字节核对时另用 moves 入口。

旧定位或任一 basis 被隐私规则或调用方排除时，整条 Move 声明及全部对应边都被扣留，缺口只指向已授权 current；没有 Move 的选集不产生空检查负担。

所有 guard 已登记的 sensitivePaths 共同约束显式配置分析，包括未命中本次 inputScope 的 guard。`include` 在打开正文前扣留命中这些路径及其子路径的来源，保留 not-read 与 impact/guard-sensitive-source，不产生正文摘要或 SourceRef；其他获准来源仍可读取。全部来源被扣留也不能报告完整。

默认敏感目标、上述敏感声明和 `--exclude` 目标的名字不进入配置依赖边；调用方自己的选项仍可在 scope 中回显。输入或依赖扣留保留缺口，不把缺边解释成无影响。排除 Registry 时拒绝该模式；读取 Registry 后发现其自身或父路径被 guard 声明为敏感时，在正文读取与来源证据输出前以固定错误拒绝，包括仅盘点模式。

既有路径预检仍可检查 authority 的路径形态，但配置模式不读取目标正文，不假称获得目标 revision 或访问授权；raw / ignored 与正文权限不由链接声明豁免。共同后检失败撤回配置、正文证据与候选。

Git 模式的 Registry 摘要必须精确指定 `--changes-within .agents/doc-types.json`；父目录扫描不会自动解除 Registry 的默认隐私排除，其他敏感路径也不获豁免。该模式的变更盘点使用 `curia.git-change-selection/2`，观察使用 `curia.git-change-observation/3`，标记 `explicit-registry-path-only`；普通 changes 与默认 impact 版本不变。无变化时配置未扫描，对应检查为 not-applicable；仅盘点也不产生依赖证明。

显式配置检查批次统一使用 check-plan/3、check-run/3、curia-checks/3、run-event/9 和 check-run-view/3；scope.configurationSchema 绑定当前投影，规则版本、Move 定位与 guard 依赖参与确认摘要。单仓、多仓或混合 guard 都可使用该版本，但 impactScope 始终只覆盖主仓；只有实际包含多仓 guard 的历史视图才声明未复核额外仓库。旧版配置批次仍按 scope.configurationSchema 对应的冻结规则解码，不改写旧事件；本次不更改事件容器，旧 reader 会拒绝不认识的配置投影 / 规则版本，不把新依赖塞进旧规则。

这是当前本地声明图，不是外部 authority 核验、旧配置重建、脚本或运行时依赖扫描、跨仓影响图、多仓快照、缓存或自动执行。只列复核候选，不执行规则文件中的命令，不把零候选解释成全局无影响。实现归[查询器](../template/scripts/curia-query.mjs)和[影响图](../template/scripts/curia-impact.mjs)，验证归[配置影响夹具](../template/scripts/curia-config-impact-self-test.mjs)。

## 显式多仓输入快照

需要把多个仓库的实际输入放在同一上下文中比较时，用 snapshot 独立捕获，不拼接为一个主仓 HEAD。下面的单仓命令可在已提交的生成实例中直接运行；每个额外仓库再增加一个 `--repo` JSON，使用不同 id、明确的绝对 root 和自己的 within。例子只观察 README，不扩大到全仓。

```bash
node scripts/curia-workflow.mjs snapshot --repo "$(node -p 'JSON.stringify({id:"current",root:process.cwd(),within:["README.md"]})')" --non-sensitive --inventory --json
node scripts/curia-workflow.mjs snapshot --repo "$(node -p 'JSON.stringify({id:"current",root:process.cwd(),within:["README.md"]})')" --non-sensitive --json
node scripts/curia-workflow.mjs snapshot --list-checks --json
```

repo 只接受 id、root、within、可选 exclusions 与 includeUntracked。相同物理根不能用多个别名重复计入，独立仓库即使路径或 HEAD 相同也不合并；每个根必须已有自己的 Git HEAD 和 Registry，不自动向父目录或邻仓借配置。嵌套仓库另行声明，父仓范围仍须显式排除该子树；一个成员的授权不扩大另一个成员。根别名可以显式使用，但重解析到其他仓库会使整组失效。

默认共享预算是 8 个仓库、256 个对象、单文件 16 MiB、全部工作树 32 MiB；对应 `--max-repositories`、`--max-files`、`--max-file-bytes`、`--max-total-bytes`。先检查整组选集的成本，再打开正文做摘要，超预算不输出逐文件盘点；Registry 与工具代码另按独立上限读取。private、ignored、raw 与显式排除不入捕获，默认未跟踪文件不纳入；移出 index 后同名工作树文件仍存在而未授权时，不能忽略该输入并宣布完整。

输出 curia.input-snapshots/1 按成员保留独立 root、配置身份、HEAD、index、原始工作树摘要和两轴变更。inputState 的 mixed-tree 与 matches-head-in-selected-scope 只覆盖授权且未排除的输入，不是全仓 dirty 判断，也不等价于 Git 内容归一化后的 status。二进制可以摘要，但没有正文解析、事实核验或权限认证；读取代码目录不把它变成新的受管文档面。

所有成员捕获后共同后检，来源、配置、根别名或观察器代码漂移，以及任一必需成员缺口，都撤回整组 source 与 observation；已消耗字节仍报告。inventory 不是快照，接收端截断也不能当作完整输入。退出 0 表示完整捕获或有效盘点，退出 2 表示不完整或参数错误。它不承诺跨仓原子性、不外访、不执行 guard、不写 Run；公开 JSON 不能恢复本进程读取能力，命令执行另走[多仓 guard 的运行时绑定](#多仓-guard-的运行时绑定)，需重新确认，不导入本报告代签执行。

## 可选原格式与纸档登记

原件可以继续留在原路径、外部系统或档案柜。没有现成权威登记时，可在所属领域维护一份集中登记表；不为每份原件建伴随文件，也不为了采用本能力复制已有原生台账。登记表是非敏感定位与归属的原件，不是被引用资料正文的副本或第二份 authority。

在已有 instance 中为该表启用固定 parser：

```json
{
  "mappings": [{ "path": "docs/source-register.json", "kind": "file", "contentParser": "json-original-register/1" }]
}
```

登记表可同时包含纸档、本地附件与外部对象：

```json
{
  "schema": "curia.original-register/1",
  "owner": "archive-owner",
  "accessRef": "AGENTS.md",
  "originals": [
    { "id": "paper-manual", "format": "paper", "sourceRef": { "uri": "paper:archive-2026-001", "locator": "pages 1-3", "observedAt": "2026-10-01" }, "location": "archive shelf A" },
    { "id": "signed-copy", "format": "pdf", "sourceRef": { "uri": "repo:docs/signed-copy.pdf", "revision": "v1" }, "encryption": "encrypted" },
    { "id": "external-guide", "format": "docx", "sourceRef": { "uri": "https://invalid.example/guide.docx" } }
  ]
}
```

表级 owner 和 accessRef 可逐项覆盖；显式空值不能继承。accessRef 是仓内规则定位符，不是权限证明，也不自动读取目标。每项必须有表内唯一 ID、声明格式和 sourceRef.uri；revision、locator、observedAt、location 与 encryption 按需填写。未填的版本与观察时间保持未知；日期只保留日期精度，不推定午夜或时区。ID 只标识表内条目，不冒充原件的全局身份。

支持 `paper:<稳定档号>`、`repo:<规范仓内相对路径>` 与规范 HTTPS URL；URL 不接受 userinfo、query、fragment、隐式归一化或协议降级，路径不接受越界、Git 内部路径和通配。定位信息必须由维护者确认可在当前本地单读者范围展示；parser 不是秘密检测器，不填凭据、签名 URL 或私有业务正文。登记引用不会触发外访、源文件读取、哈希、OCR、宏、解密或上传。

内置上限为 64 KiB、64 层、128 项；未知 schema、未知字段、重复键、重复 ID、同表相同 URI 与 revision 重复登记、非法时间或 URI 均拒绝，不保留已解析的前半表。空表表示无声明，不表示覆盖完成。表内唯一性不证明跨表、跨版本或路径别名的唯一原件。

`envelope.content.originals` 保留逐项来源、归属、访问规则、声明版本、范围、位置和加密标记，同时固定报告 registered-not-read、存在性与权限未检查、事实未核实、无原件 digest。`coverage.originals` 单独统计登记项与未解析表，read / verified 均为零、complete 为 false；登记表正文读取完成不能改写这些结果。持久化 Run 只绑定实际读取的登记表字节，并保留 `curia-read/originals` 缺口，不伪造外部 EvidenceRef。

```bash
node scripts/curia-workflow.mjs --path docs/source-register.json --inventory --json
node scripts/curia-workflow.mjs --path docs/source-register.json --strict --json
node scripts/curia-query.mjs --all --coverage --json
```

这是最小只读登记能力，不是 PDF / Office / OCR parser、来源探测器、IAM、认证核验或解密服务；后续访问原件仍需单独授权和适配。实现合同见 [原件登记 parser](../template/scripts/curia-originals.mjs)。

### 加密原件与密钥责任

仅纳管时，沿用 `encryption` 和 `accessRef`：前者只是加密声明，后者只指向项目原生访问规则。密钥的受控引用及获准 adapter 由该规则的 owner 管理，不在 Curia 新建密钥登记表，也不把 `keyRef`、口令、解密命令或明文路径加入原件登记 schema。访问规则、引用所指密钥和 adapter 都不是登记的隐含读取范围；不把密钥材料、敏感引用或明文放进非敏感登记、命令实参、Run 或报告。

需要解密时，项目 adapter 必须另行确认实际调用者、原件、密钥、用途、接收者和有效权限。公开 `accessRef`、知道密钥引用、声明 non-sensitive 或普通 guard 成功，都不证明这项授权。当前 Curia 没有该受控解密入口，不能用普通阅读或裸命令执行冒充它；缺少授权、密钥或支持的格式时保留未读，不自动找密钥、换工具或重试。

解密 adapter 的接入合同要求：明文继承原件与访问规则中更严格的 Sensitivity 和 AccessRef，权限取交集；未知或不能比较时停止，不因“已经解密”降级。明文默认只在获准运行环境内存中使用，不落盘、不摘要、不缓存、不外发或交给模型；例外须独立明确授权，失败与取消不得遗留明文。原生系统负责实际密钥取用、运行隔离、明文处置和证明，这些执行保证尚未由本地登记能力交付。

[边界回归](../template/scripts/curia-register-set-self-test.mjs)使用实际文件打开拦截和正向控制，检查原件、访问规则、密钥与 adapter 不被登记隐式打开，未知解密字段不生效或回显，目录与输入不被改写。独立授权的原件字节核验可以读取声明为加密的原始载荷，但仍不验证加密声明、不解密，也不证明 adapter 的敏感继承或明文清理能力。

### 跨表原件身份声明检查

多个领域已有登记表时，可以只比较这些表的原件身份声明，不合并原表、不创建全局索引。先按上述 schema 准备实际登记表，再逐项给出文件；不需要为检查启用 instance 或映射，不能用目录、通配或表内链接扩大范围。

```bash
node scripts/curia-verify.mjs registers --register docs/source-register.json --register docs/team-register.json --non-sensitive --json
```

身份键为精确 URI 与原样 revision，ID 仅在原表有效。跨表重复返回全部条目的原表定位，不采用第一项；归属、访问、格式、加密、位置与 locator 声明不同只报告字段名，不回显这些值或判定哪一份原件为真。不同已知版本可以并存，但不比较新旧或选择 current；未知版本与已知版本可能重叠，返回未决。相同摘要不合并不同 URI，大小写、Unicode 与其他路径别名均不隐式归一化。

运行前确认整份表、身份 URI、修订和路径都非敏感。`--all` 只加入显式选中的未忽略 untracked，`--exclude` 优先；有任一排除、缺失、ignored、raw、链接、损坏或超限来源，不以剩余好表给出完整比较。固定读取上限由 `--list-methods` 的 registers.limits 报告；不接受临时放大。解析后复核全组来源、Registry、HEAD、index 与边界，漂移撤回证据；元数据后检不是原子快照或重新摘要。

报告 schema 为 curia.original-register-check/1；pass＝0 表示所选表的精确身份声明未发现重复和版本重叠，fail＝1 表示发现重复声明，incomplete＝2 表示不能完整比较。全部表为空时为 not-applicable＝0，不假称原件覆盖；有已证明重复且同时存在版本未决时仍 fail，comparison.complete 保留 false。SourceRef／EvidenceRef 只证明实际读过的登记表，原件 read／verified 均为零；不探测原件、校验访问权限、执行命令、外访或落 Run。`--protected` 在来源 I/O 前返回认证缺口。实现及边界见[核验器](../template/scripts/curia-verify.mjs)和[专项夹具](../template/scripts/curia-register-set-self-test.mjs)。

### 按需核对本地原件修订

登记项明确提供完整原件的字节摘要时，可单独核对它与实际本地文件是否一致。调用方独立给出登记表、表内 ID 和原件路径；不需要启用 instance 或为原件增加受管面。来源 URI 必须精确等于 `repo:<调用方原件路径>`，表中的其他 URI、accessRef、locator 或命令不能扩大读取权限。HTTPS 与纸档只报告未支持，不自动下载或探测。

此方法解释 revision 的四种完整摘要记法：`sha256:raw-bytes/1:<64 位小写十六进制>`、`sha512:raw-bytes/1:<128 位小写十六进制>`，以及单条 `sha256-<base64>`、`sha512-<base64>`。后两种使用标准、带填充且解码后可逐字回编码的 base64，可直接保留 npm integrity 一类原生回执；不是完整浏览器 SRI 策略，不支持摘要列表、options、URL-safe 别名、缺失填充或非规范填充位。普通版本号、日期、Git SHA、未知算法和规范化不猜测转换；未知修订或不合法登记在原件读取前返回 unverified。登记 parser 仍原样保留合法的不透明版本字符串。

算法来自登记，不增加 CLI 开关；在同一次受预算约束的流式读取中计算完整摘要，结果归一为带 algorithm 与 raw-bytes/1 的 Digest，不改写登记原文。期望值来自独立权威修订或一次明确授权的完整字节观察，不能用本次实测值自动回填，否则会掩盖矛盾。默认摘要、登记表、Registry、Git index 与工具代码身份仍为 SHA-256；生成来源核对和任务回执的既有 SHA-256 修订合同不随之扩大。

按需持久化使用既有原件记录合同，摘要身份明确区分算法；未知算法不能被签为矛盾。新 reader 按原事件解释历史，不把旧版留下的 unverified 自动升级为 confirmed，也不重算或改写冻结字节；需要新结论时显式核验或更正。旧 reader 不支持的 SHA-512 记录会被拒绝，不能由旧工具继续维护含此记录的 store。

```bash
node scripts/curia-verify.mjs original --register docs/source-register.json --id manual --source docs/files/manual.pdf --non-sensitive --json
```

运行前确认登记表、完整原件及路径均为非敏感资料。默认读取 index 可见的普通文件，`--all` 只加入两个明确路径中的未忽略 untracked；既有隐私排除、`--exclude <path>`、raw 标记、链接、硬链接、挂载与嵌套仓库限制不变。登记表与原件共同绑定一次来源选集，先读表、再按匹配结果流式计算原件摘要，每阶段都复核全部选中文件、Registry、HEAD、index 与路径边界。原件摘要阶段失败或核验器代码身份漂移时撤回两端修订、观察时间、证据与派生比较，不能拼接不同修订的证据。

登记表上限仍为 64 KiB；原件默认最多 16 MiB，`--max-source-bytes <正整数>` 可显式调整，最高 512 MiB。原件用固定缓冲区流式处理，不受正文 parser 的文本上限约束；超限不生成前缀摘要。登记无法解释、ID 缺失、URI 不匹配或 revision 未识别时，可以保留实际读过的登记表证据，但不会打开原件。控制配置与工具身份另受内置上限约束。

结果沿用 `curia.verification/1`，方法为 `registered-original-digest/1`。confirmed＝0 只表示实际完整原件字节与登记摘要相符，contradicted＝1 表示不符，unverified＝2 表示未完成比较；登记表与原件的 SourceRef、EvidenceRef、观察时间和预算分开，原件观察状态为 hashed，不冒充正文 read。报告不回显正文、owner、accessRef 或未获授权的声明 URI；不修改原件、登记表、Verified 或历史记录，不自动落 Run。

PDF、Office、图片与加密文件在此都只是原始字节；格式、页码、声明观察时间、归属和访问权限未被验证，宏、OCR、解密与正文抽取均不发生。哈希相符不证明内容正确、现行效力、认证身份或已读懂，`--protected` 在来源 I/O 前返回认证缺口。普通 workflow 的 originals 覆盖仍只统计登记与未读状态，不因独立核验改成已读或已核实。实现与自证见[核验器](../template/scripts/curia-verify.mjs)和[原件核验夹具](../template/scripts/curia-original-verify-self-test.mjs)。

### 按需核对外部原件修订

需要核对外部附件是否符合登记版本时，使用 external verify-original，不用“下载成功”替代版本相符。登记路径与 ID、完整 URL、精确 origin、媒体类型和非敏感声明都要显式提供；登记中的 URL、owner、accessRef 或 locator 不授予访问权限，也不触发自动下载。

下面复用前文的 external-guide 示例。该示例没有可解释的 revision，因此命令只读取登记，返回 unverified，不访问网络。要真正比较，登记维护者须先提供独立可信的期望修订，格式与[本地原件核验](#按需核对本地原件修订)相同；不要把本次响应摘要自动回填为期望值。

```bash
node scripts/curia-workflow.mjs external verify-original --register docs/source-register.json --id external-guide --url https://invalid.example/guide.docx --allow-origin https://invalid.example --media-type application/vnd.openxmlformats-officedocument.wordprocessingml.document --non-sensitive --json
```

条目缺失、URL 不逐字相同、修订未解释、登记超限或本地输入已变化时，不发请求。真正访问沿用 HTTPS reader 的 origin、内网、TLS、CA、超时和响应限额；parser 固定为 digest-only/1，按声明算法摘要完整实体，不抽取正文、不解压、不解密。普通 external reader、CA 和证书身份仍使用 SHA-256，不增加网络参数。`--all` 与 `--exclude` 同时约束登记与可选 CA；登记上限由 help 报告，`--max-bytes` 只调整响应实体预算。

报告 curia.external-verification/1 分别保留登记与真实响应的 SourceRef／EvidenceRef，比较的是完整 HTTP 实体而非 ETag 或传输封装。相符 confirmed 退出 0，完整实体与期望不同的 contradicted 退出 1，缺口或失败的 unverified 退出 2；SIGINT／SIGTERM 分别退出 130／143。稳定登记的单侧证据不表示外部原件已读。

登记、配置、index、路径、CA 与代码在请求前后复核；整组漂移或显式取消撤回证据与比较结论。核验不证明业务事实、源站新鲜度、声明的格式与加密状态或身份权限，`--protected` 不降级。它不修改登记，不创建 Run，不接受已有 reader JSON 代替真实读取，也不改变本地原件核验与旧记录的合同。

实现与限额由 [external 模块](../template/scripts/curia-external.mjs)维护；普通 workflow、登记表阅读与本地核验仍不会自动进入这个分支。

## 可选 Office 原件数据抽取

需要实际读取本地 DOCX／XLSX 时，显式启用独立数据 parser；不用登记表、instance 或 recordStore，也不改变普通阅读。来源必须是本 Git 仓内可见文件，调用方须确认整个包、路径、批注、隐藏内容和外链元数据均可供当前读者读取；默认路径排除不是秘密检测器。

```bash
node scripts/curia-workflow.mjs extract --parser ooxml-data/1 --path docs/manual.docx --non-sensitive --json
node scripts/curia-workflow.mjs extract --parser ooxml-data/1 --path docs/table.xlsx --non-sensitive --json
node scripts/curia-extract.mjs --list-parsers --json
```

`--all` 只加入未忽略 untracked；`--exclude` 优先排除，任何被阻断的选件阻止整组读取。输入必须是精确文件路径，不递归扫描目录。每批最多 4 件，单件小于 4 MiB，总读取预算 16 MiB；ZIP 最多 512 条目、单条目解压不超过 4 MiB、总解压不超过 16 MiB，XML 共享节点预算 100000、深度 96，单件最多 20000 个数据单元，整组紧凑 JSON 投影不超过 8 MiB。这些是拒绝阈值，不是 OS 级 CPU／内存隔离；格式不支持、加密、损坏或超限不会退回文本前缀。

| 输出 | 保证与限制 |
|---|---|
| sourceRef | 完整原件字节的 Digest 修订、读取 instant 与 Git 观察；不把工作树归因于 HEAD |
| projectionDigest | json-stringify-utf8/1 的派生数据身份，不是原件 Digest，也不授予 authority |
| projection.units | part 与 XML 元素定位；Word 段落通道，或 Excel 显式坐标的单元格数据，不伪造页码或行号 |
| projection.parts / gaps | 已处理职责、未投影 part、外部关系和其他缺口；XML 可解析不表示内容全部被理解 |
| coverage | supported-subset-only、visual not-read、semantics not-verified，字节全读不升级为全文／事实全覆盖 |
| observation / tool | 两次读取的实际预算、同一选集后检和实现文件身份；非原子快照、本地自报工具身份 |

Word 保留正文、header／footer、footnote／endnote、comment 中的段落与表格上下文；插入、删除、移动修订、字段指令／缓存结果和显式隐藏声明分开。样式继承、编号、布局与最终可见修订视图不解析；图片、嵌入对象和 markup compatibility 分支保留未读缺口，不能把抽取片段拼成现行全文。

Excel 保留 sheet 状态、行列隐藏声明、合并范围、style ID、日期系统、富文本和原始数字 token。公式与历史缓存分列，不执行公式、不重算、不展开共享或数组公式、不猜日期／格式化显示；共享公式绑定同表基声明，缺失不补造。只支持显式行、单元格坐标；筛选、图表、图片、外部数据、命名区域等未投影内容有缺口。重叠合并范围不做完整合法性验证。

当前仅支持 UTF-8 transitional OOXML 的非宏 DOCX／XLSX 主格式；ZIP64、多卷、加密、旧二进制 Office 与 strict OOXML 拒绝。包内关系只在已授权字节内定位，External 仅报告不访问；宏、脚本和字段不执行，不调用 Office、模型或网络。投影只输出 stdout，不解包落盘，不写副本、索引或 Run，源件和现有核验记录不变。前后检查出现漂移时撤回整组 sourceRef 和投影；接收端截断不可观察，读者仍须按实际进入上下文的内容报告覆盖。

默认退出 0 仅表示所有所选文件都返回支持子集的数据；退出 2 表示参数、读取、格式、预算或稳定性失败，其他成功文件也不能替失败文件签收。`--strict` 对成功投影仍因视觉、语义及数据范围缺口退出 1。`--protected` 在读取前拒绝，不降级受保护要求；PDF、OCR、解密、外部身份与业务事实核验需各自 adapter。

## 可选文档变体与生效时间

只在确有多版本、多语言或适用时间需要的路径启用，普通文档不补这些字段。`variant` 与 `validity` 互相独立，均放在同一个 `instance.mappings[]`，不增加配置文件或一级目录。下面的 mapping 可追加到前一个原位纳管示例；先创建对应路径。不要把整棵 docs 无差别设为同一个 family：family 表示同一维护对象，不是所有手册的类别。

```json
{
  "path": "legacy/manuals/api",
  "kind": "directory",
  "variant": {
    "defaults": {
      "family": "api-reference",
      "productVersion": "v2",
      "platform": "not-applicable",
      "audience": "developer",
      "canonical": true
    }
  },
  "validity": { "defaults": { "mode": "timeless" } }
}
```

对应原件只需保留不能继承的维度，正文仍可以直接交付，不需要计划或过程日志。

```markdown
# API 手册

Language: zh-CN

最终手册正文。
```

### 字段与唯一原件

| 绑定 | 配置中的语义字段 | 默认头块字段 |
|---|---|---|
| variant | family、language、productVersion、platform、audience、canonical | Family、Language、Product-Version、Platform、Audience、Canonical |
| validity | mode、from、until | Validity、Effective-from、Effective-until |

每个绑定都可用 `fields` 改原生字段名，例如 `"fields": { "productVersion": "product_version" }`；用 `defaults` 补缺失，细路径逐字段覆盖粗路径。别名支持 ASCII 字母、数字、下划线和连字符，首字符为字母，大小写精确匹配；不得复用 `Type`、`Status`、`Owner`、`Updated`、`Verified`，也不得与生效的其他绑定或 Native Binding 字段重合。原生文档 `Version` 与产品版本是不同轴。配置、原件和默认值来源均在 JSON 结果中保留。

variant 启用后，family、四个维度及 canonical 都必须能唯一解析；不适用维度显式填 `not-applicable`。维度是精确字符串，不做语言大小写折叠、版本范围求解或通配匹配。canonical 在配置中是 JSON boolean，头块只接受 `true` / `false`；空值、重复同值、未知值、未解析或截断都不会被默认值洗白。

每个 `[family, language, productVersion, platform, audience]` 单元只有一个 canonical 声明；多个为 conflict 并阻断 `--strict`，只有 false 为 missing，有未解析对象或读取错误时唯一性为 unresolved。不同语言或产品版本不互相 supersede；两个时间窗口不重叠也不能替双 canonical 解围。canonical 只表示维护身份声明，不表示事实已核实、翻译已同步或当前有效。

检查发生在查询过滤前，范围是本次完整 inventory：默认 index 路径，`--all` 再包含未忽略 untracked。`coverage.variants` 区分未启用、无 Git、空范围、不完整和已检查；`complete` 是观察完整性，不是零缺口承诺。`--canonical unknown` 仅选择已启用但 canonical 未解析的对象；未启用对象可用 `--cell-state not-applicable` 查询。

### 时间视图

`Validity: timeless` 表示不使用适用时间轴，不声称永远有效；`perpetual` 表示显式永续适用。两者都不能同时提供端点。`interval` 必须给出 from 与 until，开放端点写 `unbounded`；两端同时开放不自动改成 perpetual。区间为 `[from, until)`，缺失、空值、冲突和逆序都不能推导有效。

```markdown
# 限时 API 约定

Language: en
Validity: interval
Effective-from: 2026-11-01T00:00:00+08:00
Effective-until: unbounded

最终约定正文。
```

精确端点只支持带明确时区的完整秒或 1～3 位小数时间；偏移最多 ±14:00，原始及归一化年份均限于 0001～9999；拒绝无时区、未知偏移 `-00:00`、非法日期、闰秒和 `24:00`。合法 `YYYY-MM-DD` 保留日期精度，但视图为 unresolved，不补午夜或本地时区。模式、端点及原始字段都保留在 `validity`，未启用时视图为 not-applicable。

```bash
node scripts/curia-query.mjs --all --family api-reference --language zh-CN --product-version v2 --json
node scripts/curia-query.mjs --all --canonical true --cell-state unique --json
node scripts/curia-query.mjs --all --validity future --at 2026-10-15T00:00:00Z --json
node scripts/curia-query.mjs --all --at 2026-11-01T00:00:00+08:00 --strict --coverage
```

`--at` 是求值时点，默认使用本次唯一的 generatedAt，可以与 coverage 共用；其他查询过滤不能与 coverage 混用。它只对当前工作树声明求值，不重建该日期的历史文件，也不改写 `Status`、原生状态视图或维护方式。输出的 input 明确记录求值来源和内容基线。另可按 platform、audience、cell-state、validity 或具体 gap 查询，全部是只读操作。

`coverage.validity` 独立报告时间绑定是否启用，以及无 Git、空范围、不完整或已检查；同时给出 unresolved、unparsed 和 invalid 计数。不启用 variant 也有完整时间覆盖说明，未决时间或范围读取错误使其 `complete` 为 false。它不是事实核验承诺，也不改变 metadata gap 的严重度。

直接导入模块时同样拒绝隐式授权：`buildInventory` 的读取开关必须是 boolean，未知选项在 I/O 前失败；`filterEnvelopes` 拒绝未知字段、空值、非字符串和非法枚举，链接缺口只能在已启用链接扫描的 inventory 上筛选。直接调用时间投影也必须提供合法求值时点，不能用缺失值或日期替代。

本切片仅使用 `markdown-native-header/1`；非 Markdown、frontmatter、非法编码和未读完整头块仍为未解析。文档级适用区间不等于字段级时间推理，也没有引入 Move Binding、取代图或翻译同步。字段合同归 [curia-applicability](../template/scripts/curia-applicability.mjs)，I/O 与全选集检查归 [curia-query](../template/scripts/curia-query.mjs)。
