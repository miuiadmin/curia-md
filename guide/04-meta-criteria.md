# 04 元判据：新提议怎么裁决、机制什么时候动

本章回答九条问题里的第 7、8 条：面对新机制提议（要不要加个 X），裁决用的元判据是什么；机制什么时候该改、什么时候不该改，「还能更好」算不算理由。写给接手或研究 Curia 演进的人：本章不复述规范内容，只把参考实现仓里实际用过的裁决方法整理成可搬用的形态。出处一律为参考实现仓内相对路径，指到文件与小节，不写行号。

一个归属先说清：Owner 三条硬约束是上游约束，决定 Curia 载荷该长什么样；机制冻结住参考实现仓的「本地附加（不随分发）」节，是参考实现自己的治理规则，不在 Curia 载荷里。把两者当可复用模式搬走，是你自己的决定。

## 一、判据一句话与它的两个来源

把整套裁决压成一句话：先问这是文档规范还是软件系统；倾向砍而不是加。

这句话不是某条原话的复制，是对三条硬约束与规范「范围」节的压缩：第一问来自解耦与「它不是软件系统」；「倾向砍」来自历次裁决的方向——2.1 对 2.0 逐项砍，2.2 的载荷方案里保守档被否、「Owner 裁定激进档」（出处：`.agents/notes/implemented/simplification/2026-10-19-curia-2-2-check-groups-and-payload-trim.md`「Alternatives considered」）。

它有两个来源：Owner 三条硬约束检验「形态」，机制冻结检验「动议」。前者回答「这东西该长什么样」，后者回答「现在该不该动」。

### Owner 三条硬约束（2026-10-17 原话）

- 解耦：「不要跟系统耦合起来，丢到其他项目也可以用。它就是一个文档管理方案，是关于怎么管理文档的指导方案。」
- 避免过度设计：「不要加一堆规则校验、脚本校验、门禁之类的东西，真没必要啊。文档也不要加字数限制，没必要对不对？就是套用规范格式。」
- 轻量配套：「最多就是有点轻微的配套脚本，去看一下文档规不规范。」

出处：`.agents/notes/implemented/architecture/2026-10-17-curia-2-1-convergence.md`「Problem」。

怎么用：当逐项检验清单，不当口号。2.1 收敛时被这三句逐条否掉的有四项：载荷重量、类型表示叠加、门禁与规则规模、与参考仓特定路径耦合的分发面（出处同上）。后续裁决也直接引用原话当否决依据——「载荷清单自证」路线被否的第一条理由就是「正面撞 Owner ② 的原话「不要加一堆规则校验、脚本校验、门禁之类的东西」」（出处：`.agents/notes/implemented/process/2026-10-20-curia-migration-stability-decisions.md`「Alternatives considered」）。

三条也钉住了下限：要的是「轻微配套」不是零配套——「不要一堆」与「零检查」之间的落点是 1 支轻量自检脚本（出处：2.1 收敛笔记「Alternatives considered」第三条；该脚本在 2.2 下为编码预检加 3 组，见 `.agents/notes/implemented/simplification/2026-10-19-curia-2-2-check-groups-and-payload-trim.md`「Decision」）。规范对它的定位写得很硬：「轻量自检工具，不是门禁体系」；「它不是软件系统——没有运行时、服务、数据库、网络调用、权限模型、审批流、CI 或钩子」（出处：`.agents/README.md`「范围」）。

解耦这一条在规范里有机械化的四条判据：分发文本可整段拷进任何仓库（无指向宿主仓的爬升链接）；脚本零依赖（只用 Node 内置模块、不联网）；可移植运行（拷进无 git、无 node_modules 的目录照常出判定）；无隐性前置（不装钩子、不接 CI、不用 git 也能完整使用）（出处：`.agents/README.md`「范围」的「解耦判据（可核验）」）。

实操口径：新提议如果引入运行时、服务、依赖、配置面或审批流，它答错了第一问，方向应是砍；如果它是「一堆规则校验、脚本校验、门禁」中的又一件，它答错了第二问。

### 机制冻结：两类信号与一条非理由

机制冻结是热路径硬规则第 11 条，原文：「机制冻结：`.agents/` 机制与 `scripts/` 只在两类信号下动——门禁漏了真问题、流程税高到开始少写文档；「还能更好」不是理由，预算还给产品。」（出处：`AGENTS.md`「本地附加（不随分发）」第 11 条；术语定义见 `.agents/GLOSSARY.md`「机制冻结」）。

信号一，门禁漏了真问题。典型形态是静默：守卫跳过、退出码 0 而什么都没查（假绿）、锚点失配后检查停用却不报。实例见第四节。

信号二，流程税高到开始少写文档。看行为不看情绪：有人开始绕开机制、告警噪声压过信号、参数怎么调都没有均衡。实例见第四节。

「还能更好」为什么被单列为非理由：agent 会话天然热衷改工具——改工具永远有正反馈，做产品没有——工作区存在自我服务式持续打磨的倾向（出处：`.agents/notes/implemented/simplification/2026-10-02-workspace-lean-pass.md`「Problem」）。第 11 条放在每个会话必读的位置，正是让后续会话（包括 agent 自己）在动机制之前先过这道闸（出处：同上「Decision」）。

冻结的边界：「冻结」不冻结内容只冻结机制——写文档、翻状态、归档、记账照常；动 `.agents` 机制与 `scripts/` 才需要那两类信号；信号出现时，先立提案再动手（出处：同上「Consequences」）。冻结还配了一次性清理：同一批把「每个会话都在付」的热路径与双写成本顺手清掉——「顺手清掉才配得上冻结规则」（出处：同上「Alternatives considered」第一条）。

## 二、裁决一个新提议：五步

以下五步是本章对仓内实践的整理；每一步素材都有出处，但仓内没有一份以此为题的单文档。裁决权在 Owner（搬用时是你的维护者），agent 的角色是提案、举证与请示——仓内有执行方改错被按第 11 条撤回、再由 Owner 裁定的原例（出处：`.agents/notes/implemented/architecture/2026-10-10-round2-rulings.md`「Decision」其七）。

第一步，定类：这是机制改动，还是内容与纪律改动？内容随时可改；只有机制面（`.agents/` 的制度、配套脚本、分发载荷）才需要信号。

第二步，搜旧案。写前先搜（含 `rejected/`）是硬规则 3 的一部分（出处：`AGENTS.md`「硬规则」第 3 条）。配方用规范「链接与检索」的第 2 条：`rg --hidden -g '!.agents/notes/archived/**' <关键词> .agents/notes/`。旧案有三种关系：整题重复则并入；部分重叠则新篇互链；被否过则逐条看当时的否决理由今天是否还成立，不成立时要在新篇里明写推翻了什么。

第三步，对信号。提议落在两类信号中的哪一类？新增类提议（要加一个新机制）通常只能落在第一类——要拦的真问题已构成实测损害；加机制本身是加税，第二类信号对它反向（走例见第三节）。举证责任在提议方，证据要实测——台账复算、存量树首扫、反例攻击。三式的采法：台账复算的配方见第一章第六节；存量树首扫要自己设计（原始扫描口径未入库；判据是第一章的去噪比 = 1 − 保留条数 / 原条数）；反例攻击的做法见第三章第二节与第五章的「怎么系统地找这类坑」。两个常见的不合格替代：设计意图（「采用方会需要」）与口味（「这样更好」）。2.2 的自我要求是「依据是数据而非口味」（出处：`.agents/notes/implemented/simplification/2026-10-19-curia-2-2-check-groups-and-payload-trim.md`「Decision」）。没有信号，就记触发条件或直接不做。

第四步，过三问与算成本账。三问即 Owner 三条硬约束（见第一节）。成本账四条：

- 重量的本体是「存在」，不是「强制」——可选机制同样要写规范、写实现、写自证、维护兼容、被采用方理解；「等出现真实采用需求再立项，比现在保留一整套可选面便宜」（出处：`.agents/notes/implemented/architecture/2026-10-17-curia-2-1-convergence.md`「Alternatives considered」第四条）。
- 成本归宿要问清谁付、什么时候付：热路径内容按会话计费（出处：`.agents/notes/implemented/simplification/2026-10-02-workspace-lean-pass.md`「Problem」）；「不在提交路径里的工具没人会跑」（出处：`.agents/plans/2026-10-19-curia-2-2-implementation.md`「状态记录」2026-10-19 条）。
- 护栏持续变成流程税就是负资产，先例见第四节字数预算。
- 砍也要记账：明示接受什么退化（漂移、信号变弱、覆盖不到的面），写进规范的「适用边界」——不做哈希封印、不查时效、风格面无机器判据，都是这样记下的（出处：`.agents/README.md`「适用边界」）。

信号成立、三问通过后，先立提案再动手（出处：lean-pass 笔记「Consequences」）。

第五步，落记录。没做的进 `plans/`、为什么进 `notes/`（出处：`AGENTS.md`「硬规则」第 2 条）。样板是工作区精简提案与同名笔记的配对：「选定后的因果写进 notes，本文只留结论与链接」（出处：`.agents/plans/2026-10-02-workspace-lean-pass.md`）。提案的建议节是「背景、目标、成功判据、方案选项」；笔记四节是 Problem / Decision 或 Proposal / Alternatives considered / Consequences，备选「只记真实考虑过的选项与落选原因，禁编造」（出处：`.agents/README.md`「9 类文档」「笔记（note）」）。若裁定是「以后再说」，DEFERRED 写三要素——原因、归属、触发条件（样板：`.agents/plans/2026-10-19-curia-2-2-implementation.md`「未完成事项」）。触发条件会被后续版本消解而机器抓不到：2.2 删掉风格三组后，2.1 留下的「机械修复」触发条件永远不会成立，「这一步机器替代不了，只能靠人回查」（出处：2.2 决策笔记「Consequences」末条）。决定翻转不改写旧篇——新开一篇互链（出处：`.agents/README.md`「笔记（note）」）。

## 三、走一遍：要不要加第三方格式化器

背景：2.2 删掉风格三组后，风格面不再有机器信号（九项不查清单：围栏代码块语言标注、标题层级跳级、表格竖线数、行尾空白、文件末尾换行、段落连排、中英空格、半角标点、emoji）。自然的后续提议：装个第三方格式化器把信号补回来。Owner 2026-10-19 裁定：不装。按五步走一遍。

第一步，定类：机制改动——要引入依赖与配置、要对全树生效。

第二步，搜旧案：有同族先例。更早一次版式门禁建设里，「用现成 linter（markdownlint 一类）」被否，理由两条——零依赖是硬约束；规则集必须跟着本仓豁免语义走，而豁免判定在代码里，配置文件表达不了（出处：`.agents/notes/implemented/process/2026-10-02-layout-gate.md`「Alternatives considered」第 4 条）。

第三步，对信号：第一类信号不成立——没有风格漂移事故的实测，该面的触发条件「出现真实的风格漂移事故或采用方反馈」尚未出现；第二类信号反向——加依赖与配置是加税，不是减税。

第四步，过三问与算成本账。覆盖账先算：能补的只有中英空格一项（pangu 或 textlint 类）；段落断行会被 prettier 与「一段一物理行」打架；emoji 无合适工具——工具补不回被删的整组判据。成本账：本仓加 devDependency 与配置；而「不在提交路径里的工具没人会跑」——「门禁摘出钩子后很可能再没人跑」的原句出自 `.agents/notes/implemented/process/2026-10-09-doc-gate-runs-locally.md`「Alternatives considered」；且 2.0 唯一的大规模只报告实践（字数预算）结局不是被修而是被当噪声。三问：这是软件系统物件（依赖与配置），正是「不要加一堆规则校验、脚本校验、门禁」点名要避免的东西（出处：`.agents/plans/2026-10-19-curia-2-2-implementation.md`「状态记录」2026-10-19 条）。

第五步，落记录：裁定「不装」；风格面明示为写作纪律与评审、无机器兜底、接受漂移；DEFERRED 三要素——原因「删除风格三组是数据裁定，不再保留机制」，归属「不做」，触发「出现真实的风格漂移事故或采用方反馈」（出处：同上「未完成事项」）。

案例的教益在方向性：问题不是「工具能不能补上信号」，而是「信号缺失是否已构成实测损害」。缺信号本身是明示取舍的一部分——「2.1 用噪音面换漂移信号，2.2 换了个面：用漂移信号换干净默认」——不构成加机制的信号（出处：2.2 决策笔记「Decision」）。

### 两个同族小案例

看同一条判据落在别的形态上：

- 「让桥的判据接受功能等价写法」（绝对路径、`./AGENTS.md`、尾斜杠）：定义调研把它列为缺口，但今天没有任何真实宿主用这些写法——「属「还能更好」而非实测损害，按机制冻结点不做」（出处：`.agents/notes/implemented/bug-fix/2026-10-20-curia-lossless-migration-fixes.md`「Alternatives considered」）。
- 「恢复索引校验」（让检查器读暂存面）：Owner 2026-10-18 裁定「属加机制，不予采纳」，两条语义代价明示接受（出处：`.agents/notes/implemented/simplification/2026-10-17-curia-2-1-retirement-and-gate-switch.md`「Decision」的「语义换面」条）。

## 四、什么时候该改：两类信号与数据推翻

实例跨越 1.0 至 2.2 的机制更迭，形式不同、信号形态相同。

第一类信号（门禁漏真问题）的仓内实例：

- 八份脚本的主模块判定在符号链接路径下整体跳过——「门禁一条规则都不查却退出 0」；揪出它的是自证套件「退出码 0 但无输出」的断言（出处：`.agents/notes/implemented/bug-fix/2026-10-02-gate-silent-bypass-on-symlinked-path.md`「Problem」）。
- 结构判定以「路径含 `.agents` 段」为锚，根目录改名后组 1 至 4 静默停用、`--strict` 全绿（出处：2.2 决策笔记「Problem」）。
- 根锚点自脚本位置上溯，脚本放到用户主目录下会静默锚到那里另一个同名 `.agents` 目录，扫 242 篇、退出码 0、零注记（出处：`.agents/notes/implemented/process/2026-10-20-curia-migration-stability-decisions.md`「Problem」）。
- 迁移面的五处静默失败都制造假绿——「正落本仓硬规则 11 的第一类信号「门禁漏了真问题」」；修法口径是「只修实测出来的假绿，不造新机制」「不新增判据面，只把已有判据的代理指标换成性质指标」（出处：`.agents/notes/implemented/bug-fix/2026-10-20-curia-lossless-migration-fixes.md`「Decision」「Alternatives considered」；`.agents/notes/implemented/process/2026-10-20-curia-migration-stability-decisions.md`「Alternatives considered」）。
- 一条文档规则描述了一个不存在的惯例、会误导每个读它的 agent——Owner 裁定「这属「门禁漏了真问题」那一类信号，不是「还能更好」」（出处：`.agents/notes/implemented/architecture/2026-10-10-round2-rulings.md`「Decision」其七）。

第二类信号（流程税高到开始少写文档）的实例是字数预算：预算政策三分之后 30 小时内仍发生 10 次加码；预算类命中一度占全部规则命中 55%；headroom 告警曾灌出 444 次台账命中——「上限参数没有稳定均衡，护栏持续变成流程税」（出处：`.agents/notes/implemented/simplification/2026-10-08-word-budget-removal.md`「Problem」）。处置是整体移除、不调参：字数预算退出文档系统，篇幅改提示词一句话引导，「不建任何替代性机械验证」（出处：同上「Decision」）。

还有一种改法是数据推翻旧论据——冻结不挡数据。2.1 保留风格检查的论据是「没有机械检查，格式面会漂移且无任何信号」；2.2 用数据推翻它——风格三组在真实存量树上信噪比接近零（某仓全树告警的 98.2%、某采用仓的 99.9% 来自这三组；组 6 的命中里 80.2% 是把机器生成的行当自然段的误伤；组 7 两档合计 296 次（现行档单独口径 260 次、为现行档第一；两档合计第一名另有其族，490 次）、零事故史），且为它设的 DEFERRED 触发从未出现（出处：2.2 决策笔记「Problem」）。推翻有两条硬要求：明写推翻了什么；明示代价——「用漂移信号换干净默认」（出处：同上「Decision」）。被推翻的旧论据原文保留、加更新指针，不重写（出处：`.agents/notes/implemented/architecture/2026-10-17-curia-2-1-convergence.md`「Alternatives considered」第三条的更新括号句）。

改的时候另有两条纪律。其一，不夹带：修 bug 时不顺带改架构级边界——「那些边界……属机制冻结规则的管辖——记触发条件，不夹带」（出处：`.agents/notes/implemented/bug-fix/2026-10-02-workflow-audit-fixes.md`「Alternatives considered」）。其二，改机制不翻内容纪律：2.2 删风格三组时，除这三组外判据一条不减，其余各组是合并而不是删减（出处：2.2 决策笔记「Decision」）。

### 不构成理由的提议：三种形态

这类提议仓内也留了档：

- 「还能更好」型：功能等价写法（见上）；把文档命中统计做成机制——「那是层层加码；一个季度翻一次会话记录的仪式就够了」（出处：lean-pass 笔记「Alternatives considered」第四条）。
- 「按需可选」型：把治理内核保留为「按需可选」——「15 天 1 次命中证明这个「需」没有出现」；可选化不减重，因为可选机制同样要写规范、写实现、写自证、维护兼容、被采用方理解（出处：2.1 收敛笔记「Alternatives considered」第四条）。
- 「保留等价物」型：保留自证矩阵或其等价物——体量与收益不成比例，只留两条硬断言（2.1 退役时的裁定；现行三条——第三条「根锚点缺失必红」由 2.2 补入、2026-10-20 加「（默认调用下）」限定，见第三章「自证矩阵」节），属明示取舍（出处：`.agents/notes/implemented/simplification/2026-10-17-curia-2-1-retirement-and-gate-switch.md`「Alternatives considered」第三条）。

## 五、边界与未核实

判据的经验基础是单仓 12 至 15 天窗口的台账实测（出处：`.agents/research/2026-10-17-curia-2-1-slimming-research.md`「适用边界」）。别的项目搬用时，「对信号」一步要用自己的证据——元判据可搬，证据不可搬；这份裁决方法比 9 类与 3 组判据更可移植。

未核实（三项）：

- 第三方格式化器的评估没有独立成文：今天可核的只有 2.2 实施计划「状态记录」里的一段结论与理由；更细的评估过程（试过哪些工具、样本多大）未入库。核实归属：Curia 维护方或当时的会话记录。
- 本章「五步流程」是对仓内实践的整理（素材：硬规则 2、3、11 与多篇笔记），仓内没有一份以「裁决流程」为题的成文清单。核实归属：若要一个官方版本，应向 Curia 维护方确认或立项成文。
- 本章取材截止于仓内 2026-10-20 落盘的笔记；此后若有新裁定未覆盖。核实归属：Curia 维护方。

## 本章主要出处

以下均为参考实现仓内相对路径。

- `AGENTS.md`（「硬规则」第 2、3 条；「本地附加（不随分发）」第 11 条）
- `.agents/GLOSSARY.md`（「机制冻结」）
- `.agents/README.md`（「范围」「适用边界」「9 类文档」「笔记（note）」「链接与检索」）
- `.agents/notes/implemented/simplification/2026-10-02-workspace-lean-pass.md`
- `.agents/notes/implemented/simplification/2026-10-08-word-budget-removal.md`
- `.agents/notes/implemented/simplification/2026-10-17-curia-2-1-retirement-and-gate-switch.md`
- `.agents/notes/implemented/simplification/2026-10-19-curia-2-2-check-groups-and-payload-trim.md`
- `.agents/notes/implemented/architecture/2026-10-17-curia-2-1-convergence.md`
- `.agents/notes/implemented/architecture/2026-10-10-round2-rulings.md`
- `.agents/notes/implemented/process/2026-10-02-layout-gate.md`
- `.agents/notes/implemented/process/2026-10-09-doc-gate-runs-locally.md`
- `.agents/notes/implemented/process/2026-10-20-curia-migration-stability-decisions.md`
- `.agents/notes/implemented/bug-fix/2026-10-02-gate-silent-bypass-on-symlinked-path.md`
- `.agents/notes/implemented/bug-fix/2026-10-02-workflow-audit-fixes.md`
- `.agents/notes/implemented/bug-fix/2026-10-20-curia-lossless-migration-fixes.md`
- `.agents/plans/2026-10-02-workspace-lean-pass.md`
- `.agents/plans/2026-10-19-curia-2-2-implementation.md`
- `.agents/research/2026-10-17-curia-2-1-slimming-research.md`
