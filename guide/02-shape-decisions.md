# 02 形状决策：两根、9 类、3 行头块、四句口诀与状态机

本章回答九条问题里的第 6 条：两根布局、9 类文档、3 行头块、四句口诀、状态机这些形状是怎么推出来的，备选是什么，为什么没选；并正面回答同题附带的两个明问——「为什么不用 YAML frontmatter」与「考虑过一根或三根吗」。取材只取参考实现仓（Curia 的参考实现兼分发仓）内的现行规范与决策记录；每条主张后附出处（仓内相对路径加小节名，不写行号；个别引证指向 git 历史提交，因为初版文本只在那里）。历史段落只用于交代形状的推导与落选备选，不复述过程流水；已退役机制一律显式标注。凡「未找到成文推导」处，均列出检索关键词与核实归属——这类空缺本身是信息：它说明该形状是沿用中的惯例，而不是论证过的选择。

## 形状清单一句话

现行规范的自我描述是「两根、四句口诀定家、9 类文档、3 行头块、1 支轻量配套脚本」（出处：`.agents/README.md`「一句话说明」与「快速上手」）。本章覆盖其中的结构形状：两根布局、9 类文档、3 行头块、四句口诀、状态机；同族的笔记两行头、`docs/` 无头块与命名规则一并交代。

## 两根布局：单根起步，封顶两根

**现状。** 受管文档面只有两根：`.agents/` 装过程与制度（计划、调研、决策笔记、技能、归档），`docs/` 装知识与外部事实（仓外系统的登记与定义，当前版即唯一真相、无状态机）；受管面封顶这两根、不再设第三根，项目可以只启用其中一根（出处：`.agents/README.md`「模型本体」）。

**成文推导链。** 第一步是单根：2026-10-01 的决策采用单根 `.agents/` 工作区，六子目录（`notes/`、`skills/`、`plans/`、`research/`、`future/`、`archive/`），根级只留 `AGENTS.md`、`README.md`、`scripts/` 等（出处：`.agents/notes/implemented/process/2026-10-01-agents-single-root-workspace.md`「Decision」）；该决策同时预留了「独立可见树」出口——将来真出现对外文档或站点，另立树即可（同篇「Alternatives considered」）。第二步走该出口：2026-10-09 建立仓库根 `docs/` 外部事实树，理由是外部事实「改了就是改了」、没有认知生命周期，状态机与复核时效是纯流程税，且读者要一步直达唯一现行版（出处：`.agents/notes/implemented/process/2026-10-09-docs-external-facts-tree.md`「Problem」与「Decision」）。第三步是封顶：Curia 2.0 曾把受管面放大——默认两根不变，但允许条件性第三根（`records/` 只在独立权限、存储、合规保留或归档系统确实必要时才成立），一级文档根硬上限五个、「五个是硬上限，不是目标」（出处：`.agents/plans/2026-10-14-curia-2-0-master-architecture.md`「默认两根、root set 与三种逻辑职责」）；Curia 2.1 收敛把多根能力整族退场，用「存量树只读纳管」条款替代 root set 机制，受管面回到封顶两根（出处：`.agents/notes/implemented/architecture/2026-10-17-curia-2-1-convergence.md`「Alternatives considered」；`.agents/README.md`「存量树只读纳管」）。该条款的验证缺口有成文记录：「规则不回溯」与链接检查、类型-家检查的交互没有在存量树上跑过，首次全量扫描的命中量、修与不修的判据都没有数据——三个调研对象是 868 / 285 / 495 篇量级的存量大树（出处：`.agents/notes/implemented/architecture/2026-10-17-curia-2-1-convergence.md`「Consequences」）。

**考虑过一根或三根吗：都考虑过，也都有落选记录。** 其一，一根：两个形态被考虑过。「字面全仓单目录」（连 `AGENTS.md`、`README.md`、`scripts/` 也收进 `.agents/`）落选，因为各 CLI 从仓库根读规则、根 `AGENTS.md` 必须是固定位；六个开源样本里另有一个「极致整合、无独立 docs 树」的形态被列为候选实践，本仓落点是单根加预留出口（出处：单根决策「Problem」与「Alternatives considered」；`.agents/research/2026-10-01-开源agent项目开发文档对比.md`「总览对比」）。现行规范把「只启用一根」列为允许的降级形态（出处：`.agents/README.md`「模型本体」）。其二，两翼布局（`.agents/` 管笔记、可见 `docs/` 管人读文档）：落选，原因是当时没有对外面，且两翼会引入跨树相对链接；「将来若真出现对外面，再立独立可见树」这个出口后来以「外部事实树」子类兑现（出处：单根决策「Alternatives considered」；外部事实树决策「supersession 结论」）。其三，三根：2.0 讨论过条件性第三根（见上），以及「把三个逻辑平面固定成三个物理根」的提案，后者被否决——小型项目与存量领域树可以用两根或原位子树表达同等职责，只有独立权限、存储或保留需求才值得第三根（出处：`.agents/notes/rejected/architecture/2026-10-14-curia-2-kernel-and-assertions.md`「Alternatives considered」；`.agents/notes/rejected/architecture/2026-10-13-curia-2-document-planes-and-result-artifacts.md`「被否决方案」）；两份提案都随 2.1 退场（出处：`.agents/notes/implemented/architecture/2026-10-17-curia-2-1-convergence.md`「Alternatives considered」）。

**`docs/` 的形态细节。** 无头块、无状态机；文件名 kebab-case 主题名、无日期前缀——身份是主题，不是落笔时点（出处：`.agents/README.md`「规范格式（骨架）」）。`docs/` 树自己的目录约定在标题下写三条登记字段（`Updated:`、`Verified:`、`Source:`），是目录约定而非头块（出处：`docs/README.md`「约定」）。

## 9 类文档：类型是头块字段，不是目录

**现状。** 9 类：`proposal`、`spec`、`plan` 住 `plans/`；`survey`、`evidence`、`postmortem`、`reference` 住 `research/`；`runbook`、`skill` 住 `skills/`；笔记（note）是独立形态，不带 `Type:` 行（出处：`.agents/README.md`「9 类文档」与「笔记（note）」）。目录名 kebab-case，日期型文档 `yyyy-mm-dd-topic-title.md`（出处：`.agents/README.md`「文件名与目录」）。

**成文推导链。** 起点是「家不够用」：2026-10-02 的类型系统决策指出六个家只有一层维度，`research/` 混装调研报告、复盘、对比分析与回执，同类型文档没有统一骨架、`Status:` 无人守（出处：`.agents/notes/implemented/process/2026-10-02-doc-type-system.md`「Problem」）。处置是「在六个家之上加一层类型维度、目录结构不变」，类型落在头块字段上（同篇「Decision」）。Curia 2.0 把这一层做大：注册表登记 17 类型 / 7 家 / 10 头块字段 / 114 条规则 ID（出处：`.agents/research/2026-10-17-curia-2-1-slimming-research.md`「重量分布」）。2.1 收敛为 9 类：类型清单收进规范 9 类表与脚本内联枚举，注册表、投影与生成器三件退场（出处：`.agents/notes/implemented/architecture/2026-10-17-curia-2-1-convergence.md`「Decision」）；2.2 再裁载荷——9 份模板、3 份示例与建档器删除，骨架文本的唯一家是规范「规范格式」节（出处：`.agents/notes/implemented/simplification/2026-10-19-curia-2-2-check-groups-and-payload-trim.md`「载荷裁剪（36 到 21）」）。

**为什么是「字段」而不是「目录」。** 这是有明文备选的一次裁决：「加目录（`postmortem/`、`runbook/`、`specs/`、`milestones/`）」被否决，理由是目录爆炸会让四句口诀失效、定家判据变复杂、既有路径全要迁移——类型维度用一个头块字段就能表达；同批还否决了「只发模板不加字段」（没有 `Type:` 就没有机器可读身份）与「照搬某开源项目的 kind 系统」（类型定义散在三处散文里，正是「一事实一归属」要消灭的形态）（出处：`.agents/notes/implemented/process/2026-10-02-doc-type-system.md`「Alternatives considered」）。

**类型数只减不增的记录。** `milestone` 因持续零实例被删（18 类 → 17 类）（出处：`.agents/notes/implemented/process/2026-10-05-curia-template-batch.md`「Decision」与「Alternatives considered」；`.agents/notes/implemented/process/2026-10-02-doc-type-system.md`「Consequences」）。CHANGELOG、handover、changeset、benchmark 四者被拒绝成为类型，理由分别是与 git log 重复归属、归属已在 plan 的「未完成事项」、与笔记加提交双重归属、可被 `evidence` 覆盖（出处：类型系统笔记「Alternatives considered」）。`docs/` 树建立时拒绝新增 `fact` 类型：机制冻结合法信号只有两条，本痛点用可见目录即解（出处：`.agents/notes/implemented/process/2026-10-09-docs-external-facts-tree.md`「Alternatives considered」）。

**依据与边界。** 9 类的判断来自单仓用量分布（单仓 574 篇文档、12 至 15 天窗口），并明文「类型表是上界不是配额」——短文档为主的项目可以删减类型与建议节（出处：`.agents/notes/implemented/architecture/2026-10-17-curia-2-1-convergence.md`「Consequences」；`.agents/README.md`「适用边界」）。

**未成文处。** 17 类到 9 类的逐类去向没有单一成文对照表；本次按关键词「9 类」「17 类型」「类型表」检索 `.agents/notes/`、`.agents/plans/`、`.agents/research/` 的决策与调研文档，只找到散落证据：`idea` 与 `foundation` 随 `future/` 面退役（该面已于 2026-10-20 整体归档）（出处：`.agents/archive/future/README.md`「两个类型」；`.agents/GLOSSARY.md`「晋级」）；`readme`、`agents-rules`、`glossary` 三个管目录说明文件与术语表的类型没有对应物——目录说明文件整类豁免头块（出处：`.agents/README.md`「3 行头块」）；`projection` 随注册表退役（出处：`.agents/GLOSSARY.md`「投影文档」）；`frozen` 归归档区处置、归档件保留原 `Type:`（出处：`.agents/GLOSSARY.md`「冻结留档」；`.agents/README.md`「归档」）；`note` 转两行形态（出处：`.agents/README.md`「笔记（note）」）。这一一映射若需权威对照，核实归属是 Curia 维护者与 2.1 收敛批的提交记录。

## 3 行头块：三行固定，外加两条条件行

**现状。** 类型化文档（`plans/`、`research/`、`skills/` 家内的 Markdown）统一头块：标题加固定的 `Type:`、`Status:`、`Updated:` 三行（顺序固定），三行之后可追加项目自定义字段（如 `Owner:`、`Source:`）；机器只校验三行及其取值，以及字段值是否残留 `<占位符>`。条件行两条：`Status: superseded` 必须带 `Superseded-by:`；归档件必须带 `Archived:`。三处例外：笔记两行（标题与 `Status:`，`Status:` 独占第 3 行）、`SKILL.md` 用 frontmatter、`docs/` 无头块（出处：`.agents/README.md`「3 行头块」）。

**成文推导链。** 首版头块只有 `Status:` 一个字段，形态写作「标题、空行、Status」（出处：`.agents/README.md` 初版，git 历史提交 `56045fb`；`.agents/GLOSSARY.md` 初版「头块」词条，git 历史提交 `f19d05e`）。类型维度落地时头块改为注册表驱动，字段有必填、可选、禁止与顺序之分（出处：`.agents/notes/implemented/process/2026-10-02-doc-type-system.md`「Decision」）；2.0 注册表登记 10 个头块字段（出处：`.agents/research/2026-10-17-curia-2-1-slimming-research.md`「重量分布」）。2.1 收敛把字段面固定为三行加可选自定义字段，并明文不查时效、`Updated:` 诚实性降为写作者纪律（出处：`.agents/notes/implemented/architecture/2026-10-17-curia-2-1-convergence.md`「Decision」第 ⑥ 条）。名号要留意：「3 行头块」在首版指「标题、空行、Status」三行，现行指三行字段——同名号、不同指代（出处：同上前两处初版与现行规范「3 行头块」）。

**为什么不用 YAML frontmatter：未找到成文推导。** 本次检索 `.agents/notes/`（含 `rejected/`）、`.agents/plans/`、`.agents/research/`、`docs/`、`create-curia/`，关键词 `frontmatter`、`YAML`、`不用`，没有找到论证「类型化文档为何不用 YAML frontmatter」的决策记录。可考的只有痕迹与后果，不是理由：其一，GLOSSARY 把头块定义为「固定字段行块」，并把 frontmatter 列入该词的 _Avoid_ 项、注明「本仓只有技能用」（出处：`.agents/GLOSSARY.md`「头块」）；其二，首版术语表更直白——「那是 YAML 元数据，本仓不用」——同样只有结论没有论证（出处：`.agents/GLOSSARY.md` 初版，git 历史提交 `f19d05e`）；其三，技能用 frontmatter 是宿主 CLI 的加载契约要求（`name` 决定目录身份、`description` 决定触发时机）（出处：`.agents/skills/README.md`「两个类型」；`.agents/README.md`「规范格式（骨架）」）；其四，现行检查器按「首个标题后连续的 `键: 值` 行块」读头块，零 YAML 解析器（出处：`.agents/tools/check-docs.mjs` 头注释；`.agents/README.md`「配套脚本规格」）。这四条能解释「不用也运转良好」，不能证明「当初比较过 YAML 并选了键值行块」；若要权威答案，核实归属是 Curia 维护者与首版骨架批的会话记录（该批未留关于 frontmatter 的决策笔记）。

**同族的其他形状与未成文处。** 笔记正文四节（Problem、Decision 或 Proposal、Alternatives considered、Consequences，可加 Related）与「备选方案只记真实考虑过的选项、禁编造」同为移植内容（出处：`.agents/README.md`「笔记（note）」；`.agents/research/2026-10-01-开源agent项目开发文档对比.md`「结论」）。笔记的两行形态出处清楚：笔记树采纳某开源 harness 项目的设计加对照仓的中文化经验（单文件、`Status:` 英文 token、归档封印）（同上）。未成文处：写作格式调研把「某对照仓的文档四字段」列为元数据层参考之一（出处：`.agents/research/2026-10-01-文档格式与写作规范调研.md`「结论」），最终头块定为三行；3 与 4 之间是否比较过、为什么取 3，未找到成文论证；本次按关键词「头块」「三行」「四字段」检索 `.agents/notes/`（含 `rejected/`）、`.agents/plans/`、`.agents/research/`、`docs/`、`create-curia/`，未见 3 与 4 的对照记录。核实归属是 Curia 维护者。

## 四句口诀：家的判据句

**现状。** 口诀四句——没做的 → `plans/`（proposal / spec / plan）；做完的 → `research/`（survey / evidence / postmortem / reference）；为什么 → `notes/`（决策因果，永远不进 research）；过时的 → 状态翻转优先，冷历史进 `archive/` 封存，永不删除。补句两条：可复用的干法 → `skills/`（skill / runbook）；外部事实 → 根 `docs/`。另有明文：不承诺的方向不落文档——写下来就是 `draft` 的 proposal，不写就是不做（出处：`.agents/README.md`「四句口诀」）。现行规范下 `.agents/` 是五个家：`plans/`、`research/`、`notes/`、`skills/`、`archive/`（出处：`.agents/README.md`「文件名与目录」）。

**成文推导。** 口诀与六个家同批出现于 2026-10-01 的首版总规格（出处：`.agents/README.md` 初版，git 历史提交 `56045fb`；`.agents/notes/implemented/process/2026-10-01-agents-single-root-workspace.md`「Decision」列六子目录）。家的划分来自同批调研：笔记树采纳某开源 harness 项目的四态设计加对照仓的中文化经验，根 `AGENTS.md` 加符号链接桥是样本共识（出处：`.agents/research/2026-10-01-开源agent项目开发文档对比.md`「结论」）。此后口诀只有两次补充：外部事实 → `docs/`（出处：`.agents/notes/implemented/process/2026-10-09-docs-external-facts-tree.md`「Consequences」）；「不承诺的方向不落文档」随 `future/` 面退役写进口诀补句，家的数量现行规范为五家（出处：`.agents/GLOSSARY.md`「晋级」；`.agents/README.md`「四句口诀」与「文件名与目录」）。「过时的 → 翻转/封存」的后半段在 2.1 定型为「归档四步」，起因是归档工具缺「重写自身相对链接」一步、48 条链接当场失效的实测事故（出处：`.agents/notes/implemented/architecture/2026-10-17-curia-2-1-convergence.md`「Decision」第 ② 条）。

**备选与落选。** 口诀之外曾并存一份「决策树」（问三个问题定家），随 `place-doc` 技能并入 `write-doc`，收缩为「定家三问 + 判别要点」（出处：`.agents/notes/implemented/simplification/2026-10-02-workspace-lean-pass.md`「Decision」与「Consequences」；`.agents/skills/write-doc/SKILL.md`「定家」）。「可复用干法独立成 `cookbook/`」的备选记入 `future/` 留触发条件（出处：`.agents/notes/implemented/process/2026-10-02-doc-type-system.md`「Alternatives considered」；`.agents/archive/future/2026-10-02-human-runbook-cookbook.md`）。

**未成文处。** 未找到单独论证「口诀为何是这四句、为何用口诀而不是查表」的成文记录；本次按关键词「口诀」「四句」检索 `.agents/notes/`、`.agents/plans/`、`.agents/research/`，只找到「首版即如此、此后仅两次补充」的痕迹（见上）。核实归属是 Curia 维护者与首版骨架批的会话记录。

## 状态机：按族的状态集与两条终态规则

**现状。** 状态按族给出：proposal / spec / plan 用 `draft / active / done / superseded`；survey / evidence / reference 用 `current / historical / superseded`；postmortem 用 `current / historical`；runbook 用 `current / superseded`；skill 无 `Status`（frontmatter 即身份）。两条硬规则：`superseded` 是终态、不得迁出，要推翻就新建文档互链、`Superseded-by:` 指向取代者；`spec` 的 `done` 不是退役，规格是长期契约、原地改并更新 `Updated:`。退役顺序：先状态翻转，冷历史才归档，永不删除（出处：`.agents/README.md`「状态与退役」）。

**成文推导链。** 首版按家给状态集：`plans/` 四态、`research/` 三态、笔记树 `proposed | implemented | rejected | archived`，并附「晋级与退役」流转表（出处：`.agents/README.md` 初版「目录职责」与「晋级与退役」，git 历史提交 `56045fb`）。2.0 把状态机做成注册表驱动并对 git 基线校验——用 `git show HEAD:<path>` 取旧状态，非法迁移与终态迁出直接报错（出处：`.agents/notes/implemented/process/2026-10-02-doc-type-system.md`「Decision」）。2.1 收敛砍掉这条机器面：脚本不读 git，只查 `Status` 取值合法，终态不迁出与流转方向靠纪律与评审（出处：`.agents/GLOSSARY.md`「状态机」；`.agents/notes/implemented/architecture/2026-10-17-curia-2-1-convergence.md`「Decision」第 ⑥ 条）。

**备选与落选。** 「终态迁出」被规则明文禁止，替代做法是「新建文档互链」——同一模式在笔记树写作「决定翻转不改写旧篇，新开一篇互链」（出处：`.agents/README.md`「状态与退役」与「笔记（note）」）。`Verified:`（跑过一遍的日期）在 2.0 与 `Updated:` 分离、按类型必填并超期报警；2.1 把时效检查整体退场，`Verified` 降为「用不用由文档自己约定」（出处：`.agents/notes/implemented/process/2026-10-02-doc-type-system.md`「Decision」；`.agents/GLOSSARY.md`「复核日」）。同一「护栏变流程税」判据的更早先例是字数预算族被整体移除（出处：`.agents/notes/implemented/simplification/2026-10-08-word-budget-removal.md`「Problem」与「Decision」）。

**未成文处。** 未找到论证「为何 postmortem 没有 `superseded`」「为何各族状态集不统一为单一枚举」的成文记录；检索关键词「状态机」「终态」「superseded」。核实归属是 Curia 维护者与类型系统批的会话记录。

## 2.3 补的两个形状：取代链的终点与模块设计文档（2026-11-06）

**问题。** 一个具体场景：新的排版想法定了，它就该是全局指导；可是做别的活时，agent 还在拿旧文档当依据。2.2 的机制在这里有一个结构性缺口——状态翻转只写在旧文自己头块上（`Status: superseded` 加 `Superseded-by:`），而检索是全文检索、不看头块。于是「这份讲段落间距的文档已经作废」这个事实不在任何一次命中里，读的人拿到的是文件路径加命中行。

**改了什么。** 三处，都不加文件、不加字段：其一，取代链从「有一行指针」升级为「必须终结在一份类型化、现行态、未归档的文档上」，成环、指向笔记或 `docs/`、指向归档件、终点已退役都算错；其二，`plans/` 与 `skills/` 里讲「该怎么做」的文档，若链接指向被取代的文档，报组 3 告警并指出现行版本；其三，读协议写进总规则——命中先看状态。现行态的边界按族给：`spec` 的 `done` 仍是权威，`plan` 的 `done` 是历史，`research` 的 `historical` 是时效过去——这三条都不是本次新判的，是规范「状态与退役」与写作技能里早就写着的语义，本次只是第一次让机器读它。

**为什么是这条线，不是别的。** 备选与落选：双向 `Supersedes:` 反向字段被否——它是新必填字段，会让每处既有链立刻报错，且「B 取代 A」一条事实存两处、漂移面翻倍；主题键（一份权威文档带一个主题，同主题只许一份现行）被否——主题是语义的，机器判不出「排版」与「写作格式」算不算同一主题，近似判法误报率注定高，会立刻变成流程税；笔记与 `skill` 加状态位被否——笔记的翻转本就靠「新开一篇互链」，加状态位等于同一事实两处；`skill` 的 `Status` 由宿主 CLI 的加载契约决定，多一个键没有下游。留下的三处都在既有判据面上改，属「把代理指标换成性质指标」，不是新增一族判据。

**边界照旧明示。** 机器判「链能不能走到一份现行态文档」，判不了「这份新文档是否真的该取代旧的」；判「现行文档链到了被取代的文档」，判不了「这段引用是被当成依据、还是只在说明沿革」。所以后一条只覆盖 `plans/` 与 `skills/`——`research/` 是某时点的快照，引用旧文本正当。**一主题一现行承载点**仍是纪律：机器不知道两份文档是不是同一主题。

**证据的等级。** 这一批的依据是构造反例（12 例夹具：多跳、成环、归档件、笔记终点、历史态终点、引用方三种家），不是拦截台账——本仓 2.2 的台账里没有「旧文被当现行依据」这一类命中记录。这一点按「依据是数据而非口味」的自我要求如实记下：它是「既有判据用了代理指标」那一类进场，不是「实测损害」那一类。

**第二个形状：模块设计文档。** 问题与上面相邻，但落在发现面：一个模块有一份总体设计，可「知道模块名就该一步找到它」原来只能靠检索——检索给的是一堆同名片段，而那份文档也没有自己的版本号，看不出手上是不是第 4 版。

**备选与落选。** 建注册表或 `INDEX.md`：直接撞「禁全局索引、目录即索引」的既定判据，且索引与现实必然漂移，是与现实不同步的第二承载点。给头块加「模块键」新必填字段：等于要求全树回填，而模块是语义概念——「排版」与「写作格式」算不算同一模块机器判不了，判据会立刻变成误报源。放开 `plans/` 用中文文件名：与「目录名 kebab-case」的机械判据正面冲突，中文名在大小写不敏感的文件系统与 URL 场景里也不稳。

**落点。** 把身份放进路径，把版本放进字段：`plans/<模块>/design.md`——目录名是模块标识，`design.md` 是固定名（与 `skills/<技能>/SKILL.md`、`RUNBOOK.md` 同族），自然免掉日期前缀；`Version: MAJOR.MINOR.PATCH` 走规范本就允许的「三行之后可追加自定义字段」，不是新必填项。发现靠 `ls`，不建任何文件。判断只看形态：路径对不对、`Type` 是不是 `spec`、`Version` 合不合格式、标题含不含模块标识。

**三层版本各管一件事**，这是这次特意分开的：包版本认的是**制品字节**（`MAJOR.MINOR` 是机制代号、`PATCH` 随字节走）；设计的 `Version` 认的是**这份设计自己的演进**（契约不兼容 / 兼容新增 / 澄清改字）；取代链认的是**哪一份是现行**。三者互不覆盖，也不互相推导。

**边界照旧明示。** 机器不知道「每个模块是否都有一份设计」，也不知道「这份设计是否覆盖了这个模块」——没有注册表就不存在「应该有」的清单。这既是代价也是好处：没有清单，就没有清单可漂移。
## 小结：哪些形状有成文推导，哪些没有

有成文推导：两根封顶（单根决策 + 外部事实树决策 + 2.1 收敛）；类型是字段不是目录（类型系统笔记「Alternatives considered」）；`docs/` 无状态机（外部事实树决策「Problem」）；类型数只减不增（模板批次笔记「Decision」、类型系统笔记「Alternatives considered」）；归档四步（2.1 收敛「Decision」第 ② 条）；状态迁移的机器校验从 git 基线降为纪律（2.1 收敛「Decision」第 ⑥ 条）。

没有成文推导：类型化文档为何不用 YAML frontmatter（只有 _Avoid_ 痕迹与后果）；头块为何恰好三行而不是对照仓的四字段；四句口诀本身的成形；状态集按族不统一的理由。这些形状今天是「沿用中的惯例」，不是「论证过的选择」——接手者若要动它们，先补的是论证，而不是先改规范。
