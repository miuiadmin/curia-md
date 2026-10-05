#!/usr/bin/env node
/**
 * self-test.mjs —— 门禁自证：每条断言配一个必须失败的负向夹具（纯 node 标准库，零依赖）。
 *
 * 「强承诺需要能失败的证据」：门禁若无法在坏输入上报错，它就没在守任何东西。
 * 本脚本在临时目录里搭一个最小工作区（复制真实注册表、模板与脚本树 + git init + 装提交钩子），
 * 逐个夹具断言八道守卫（类型 / 版式 / 写作 / 链接 / 工具链 / 笔记 / 迁移 / 台账）报错或报警命中预期模式；
 * 收尾再把行使过的守卫集合与 run-checks 的 CHECKS 比对，覆盖有缺口就自己报红。
 *
 * 运行：node scripts/self-test.mjs        （由 run-checks.mjs --self 调用）
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runCheck as runTypes } from './check-doc-types.mjs';
import { runCheck as runLayout } from './check-layout.mjs';
import { runCheck as runProse } from './check-prose.mjs';
import { runCheck as runLinks } from './check-links.mjs';
import { runCheck as runTools } from './check-tools.mjs';
import { runCheck as runNotesTree } from './check-agent-notes.mjs';
import { runCheck as runMigrations } from './check-migrations.mjs';
import { runCheck as runLedger } from './check-db-ledger.mjs';
import { countMissingRuleIds, loadRegistry, logRuleHits, today } from './doc-lib.mjs';
import { render, serializeRegistry } from './gen-doc-types.mjs';
import { fixText } from './fix-doc.mjs';
import { adoptDoc, renderScaffold } from './new-doc.mjs';
import { MARKER } from './install-hooks.mjs';
import { CHECKS } from './run-checks.mjs';

/** check-agent-notes 的入参是 notes 树根而不是仓库根，包一层好复用 expectFail 系列。 */
const runNotes = (r) => runNotesTree(join(r, '.agents', 'notes'));

/**
 * check-tools 的暂存开关只由环境变量驱动（runCheck 没有 staged 选项）：自证从 pre-commit 里跑时
 * 会被 CURIA_STAGED=1 透传，直接调用的夹具必须显式清掉，保证断言的是交互语义；
 * 暂存语义由子进程夹具（显式设置环境变量）单独覆盖。
 */
function runToolsDisk(r, o) {
  const saved = process.env.CURIA_STAGED;
  delete process.env.CURIA_STAGED;
  try {
    return runTools(r, o);
  } finally {
    if (saved !== undefined) process.env.CURIA_STAGED = saved;
  }
}

/**
 * 自证覆盖登记：哪道守卫被哪个夹具行使过。
 * 收尾拿它跟 run-checks 的 CHECKS 比对——加了新守卫却不补夹具，自证自己就会红，
 * 「每道守卫都被证明能失败」这句话才不是空话。
 */
const GUARD_OF = new Map([
  [runTypes, 'check-doc-types.mjs'],
  [runLayout, 'check-layout.mjs'],
  [runProse, 'check-prose.mjs'],
  [runLinks, 'check-links.mjs'],
  [runTools, 'check-tools.mjs'],
  [runToolsDisk, 'check-tools.mjs'],
  [runNotes, 'check-agent-notes.mjs'],
  [runMigrations, 'check-migrations.mjs'],
  [runLedger, 'check-db-ledger.mjs'],
]);
const exercised = new Set();
const markGuard = (check) => {
  const guard = GUARD_OF.get(check);
  if (guard) exercised.add(guard);
};

const HERE = resolve(fileURLToPath(new URL('.', import.meta.url)));
const SRC_ROOT = resolve(HERE, '..');
// 真实时钟：夹具里的归档子进程用真实日期盖章，硬编码会随时间腐化
const TODAY = new Date().toISOString().slice(0, 10);

const root = mkdtempSync(join(tmpdir(), 'curia-selftest-'));
// 自证自己的提交一律 --no-verify：夹具故意造坏输入，装了钩子还让它在临时树里真跑，
// 每次 reset/sync 的提交都会被门禁拦死。守卫是直接 import 调用的，不经钩子。
const git = (...a) => execFileSync('git', a.includes('commit') ? [...a, '--no-verify'] : a, { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });

// 夹具可能覆盖基础树里的文件（模板一致性用 AGENTS.md / GLOSSARY.md 当建档目标），
// 所以清理时要还原原内容，而不是把原文件当夹具删掉。
const preimages = new Map();

function write(rel, content, raw = false) {
  const abs = join(root, rel);
  if (!preimages.has(rel)) preimages.set(rel, existsSync(abs) ? readFileSync(abs, 'utf8') : null);
  mkdirSync(dirname(abs), { recursive: true });
  // raw 模式逐字节落盘：「结尾缺换行」这类夹具不能被自动补换行改掉
  writeFileSync(abs, raw ? content : (content.endsWith('\n') ? content : `${content}\n`));
}

function reset(files) {
  for (const rel of files) {
    const abs = join(root, rel);
    const pre = preimages.get(rel);
    if (pre === null || pre === undefined) rmSync(abs, { force: true });
    else writeFileSync(abs, pre);
    preimages.delete(rel);
  }
  // 落盘夹具时 mkdir -p 出的目录不会随文件消失。空目录对某些守卫就是脏输入
  // （notes 的 lifecycle/class 封闭集按目录名判定），所以自底向上把空目录一起收掉。
  for (const rel of files) {
    for (let dir = dirname(join(root, rel)); dir !== root && dir.startsWith(root); dir = dirname(dir)) {
      let entries;
      try {
        entries = readdirSync(dir);
      } catch {
        break;
      }
      if (entries.length > 0) break;
      rmSync(dir, { recursive: true, force: true });
    }
  }
  git('add', '-A');
  git('-c', 'user.email=selftest@local', '-c', 'user.name=selftest', 'commit', '-q', '--allow-empty', '-m', 'reset');
}

let passed = 0;
const failures = [];

/** 夹具内容：字符串走常规落盘（自动补结尾换行），`{ raw }` 走逐字节落盘。 */
function writeFixture(rel, content) {
  if (content !== null && typeof content === 'object') write(rel, content.raw, true);
  else write(rel, content);
}

/** 断言：这批夹具让门禁报出匹配 pattern 的错误。夹具值传 `{ raw: '...' }` 表示逐字节落盘（不自动补结尾换行）。 */
function expectFail(name, files, pattern, check = runTypes) {
  markGuard(check);
  for (const [rel, content] of Object.entries(files)) writeFixture(rel, content);
  git('add', '-A');
  const r = check(root, { today: TODAY });
  const hits = [...r.errors, ...r.warnings].filter((e) => pattern.test(e));
  if (hits.length) {
    passed++;
  } else {
    failures.push(`${name}：期望命中 ${pattern}，实际错误=${JSON.stringify(r.errors.slice(0, 4))} 警告=${JSON.stringify(r.warnings.slice(0, 2))}`);
  }
  reset(Object.keys(files));
}

/** 只同步索引与基线，不删文件。 */
function sync() {
  git('add', '-A');
  git('-c', 'user.email=selftest@local', '-c', 'user.name=selftest', 'commit', '-q', '--allow-empty', '-m', 'sync');
}

/** 断言：调用 fn 抛出匹配 pattern 的错误。 */
function expectThrow(name, fn, pattern) {
  try {
    fn();
    failures.push(`${name}：期望抛错 ${pattern}，实际没抛`);
  } catch (e) {
    if (pattern.test(e.message)) passed++;
    else failures.push(`${name}：期望错误匹配 ${pattern}，实际「${e.message}」`);
  }
}

/** 断言：条件为真。 */
function expectTrue(name, cond, detail = '') {
  if (cond) passed++;
  else failures.push(`${name}${detail ? `：${detail}` : ''}`);
}

/** 断言：这批夹具干净通过（可选地检查警告命中）。 */
function expectPass(name, files, warnPattern = null, check = runTypes) {
  markGuard(check);
  for (const [rel, content] of Object.entries(files)) writeFixture(rel, content);
  git('add', '-A');
  const r = check(root, { today: TODAY });
  if (!r.ok) {
    failures.push(`${name}：期望通过，实际报错=${JSON.stringify(r.errors.slice(0, 4))}`);
  } else if (warnPattern && !r.warnings.some((w) => warnPattern.test(w))) {
    failures.push(`${name}：期望警告命中 ${warnPattern}，实际警告=${JSON.stringify(r.warnings.slice(0, 4))}`);
  } else {
    passed++;
  }
  reset(Object.keys(files));
}

/** 断言：这批夹具既不报错也不报警——用来证明豁免与掩码真的生效，而不只是「没报错」。 */
function expectClean(name, files, check = runTypes) {
  markGuard(check);
  for (const [rel, content] of Object.entries(files)) writeFixture(rel, content);
  git('add', '-A');
  const r = check(root, { today: TODAY });
  if (r.ok && r.warnings.length === 0) {
    passed++;
  } else {
    failures.push(`${name}：期望零错误零警告，实际错误=${JSON.stringify(r.errors.slice(0, 3))} 警告=${JSON.stringify(r.warnings.slice(0, 3))}`);
  }
  reset(Object.keys(files));
}

/* --------------------------------------------------------------- 夹具正文 */

const SURVEY_OK = `# 样例调研

Type: survey
Status: current
Updated: ${TODAY}

一句话结论。

## 问题

要回答什么。

## 方法与来源

怎么查的：[注册表](../doc-types.json)、[总规格](../README.md)、https://example.com/a

## 结论

- 结论一 [出处](../README.md)

## 适用边界

样本范围与失效条件。
`;

const PLAN_OK = `# 样例计划

Type: plan
Status: draft
Updated: ${TODAY}

一句话目标。

## 背景

为什么现在做，见[总规格](../README.md)。

## 目标

- 交付物。

## 步骤

1. 做事 + 验证。

## 未完成事项

- [ ] 第一步。

## 状态记录

- ${TODAY}：创建。
`;

/* ------------------------------------------------------------ 准备临时工作区 */

mkdirSync(join(root, '.agents'), { recursive: true });
cpSync(join(SRC_ROOT, '.agents', 'doc-types.json'), join(root, '.agents', 'doc-types.json'));
cpSync(join(SRC_ROOT, '.agents', 'templates'), join(root, '.agents', 'templates'), { recursive: true });
for (const d of ['plans', 'research', 'future', 'skills', 'archive', 'notes']) {
  mkdirSync(join(root, '.agents', d), { recursive: true });
  write(`.agents/${d}/README.md`, `# ${d}/ — 样例\n\n装什么：样例。\n`);
}

// 模板里有指向 write-note 技能的链接，而模板目录被 check-links 单独补检——
// 临时树缺这个技能会让基础断言假红。只复制它一个（其出链只有 ../../doc-types.json，临时树里有）。
mkdirSync(join(root, '.agents', 'skills', 'write-note'), { recursive: true });
cpSync(join(SRC_ROOT, '.agents', 'skills', 'write-note', 'SKILL.md'), join(root, '.agents', 'skills', 'write-note', 'SKILL.md'));

// 布局封闭集与桥都是被检对象，所以临时工作区必须是一副完整、干净的骨架
const REG = loadRegistry(root);
write('.agents/README.md', '# .agents — 总规格\n\n样例总规格。\n');
write('.agents/GLOSSARY.md', '# GLOSSARY — 术语表\n\n## 分组\n\n**样例（sample）**：用来占位的术语。_Avoid_: 例子、！样本文本\n');
write('.agents/doc-types.md', render(REG));
write('AGENTS.md', '# 规则\n\n- 样例规则一条。\n');
symlinkSync('AGENTS.md', join(root, 'CLAUDE.md'));
for (const dir of ['.claude', '.codex']) {
  mkdirSync(join(root, dir), { recursive: true });
  symlinkSync('../.agents/skills', join(root, dir, 'skills'));
}

// check-tools 的被检对象是 scripts/ 本身（含只读 CLI 空跑），所以临时工作区要有一份真脚本树
cpSync(join(SRC_ROOT, 'scripts'), join(root, 'scripts'), { recursive: true });

git('init', '-q', '-b', 'main');
// 钩子安装是本地动作、不入库：基础树必须装上，否则 check-tools 的安装断言会把基础工作区判红
mkdirSync(join(root, '.git', 'hooks'), { recursive: true });
writeFileSync(join(root, '.git', 'hooks', 'pre-commit'), readFileSync(join(root, 'scripts', 'hooks', 'pre-commit'), 'utf8'));
chmodSync(join(root, '.git', 'hooks', 'pre-commit'), 0o755);
git('add', '-A');
git('-c', 'user.email=selftest@local', '-c', 'user.name=selftest', 'commit', '-q', '-m', 'base');
preimages.clear(); // 基础树落定：此后夹具覆盖这些文件时，清理要还原而不是删除

// 第 0 号断言：基础工作区自身必须干净，否则后面每个夹具的结论都不可信
for (const [name, run] of [['类型', runTypes], ['版式', runLayout], ['写作', runProse], ['链接', runLinks], ['工具链', runToolsDisk], ['笔记', runNotes], ['迁移', runMigrations], ['台账', runLedger]]) {
  const r = run(root, { today: TODAY });
  if (r.ok && r.warnings.length === 0) passed++;
  else failures.push(`基础工作区在 ${name} 守卫下不干净（后续夹具结论不可信）：错误=${JSON.stringify(r.errors.slice(0, 4))} 警告=${JSON.stringify(r.warnings.slice(0, 4))}`);
}

/* ------------------------------------------------------- 正向：合法文档通过 */

expectClean('合法 survey 通过', { '.agents/research/2026-01-01-sample.md': SURVEY_OK });
expectPass('合法 plan 通过', { '.agents/plans/2026-01-01-sample.md': PLAN_OK });

/* ------------------------------------------------------------- 归类与命名 */

expectFail('缺 Type 头', {
  '.agents/research/2026-01-01-no-type.md': `# 没有类型\n\nStatus: current\nUpdated: ${TODAY}\n\n正文。\n`,
}, /缺少 `Type:` 头/);

expectFail('迁移 seq 跳号', {
  'apps/backend/migrations/0001_a.sql': '-- migration: 0001\n-- summary: x\nSELECT 1;\n',
  'apps/backend/migrations/0003_c.sql': '-- migration: 0003\n-- summary: x\nSELECT 1;\n',
}, /seq/, runMigrations);

expectFail('台账条目缺证据指针', {
  'deploy/db-ledger/README.md': '# 台账\n',
  'deploy/db-ledger/envs/prod.json': JSON.stringify({ env_tag: 'prod', db_version: '0.0.0.2', entries: [
    { seq: 1, version: '0.0.0.1', file: '0001_a.sql', checksum: 'sha256:x', status: 'applied' },
  ] }),
}, /缺证据指针/, runLedger);

expectFail('未注册的类型', {
  '.agents/research/2026-01-01-bad-type.md': SURVEY_OK.replace('Type: survey', 'Type: surveyy'),
}, /未注册的类型/);

expectFail('放错家', {
  '.agents/plans/2026-01-01-misplaced.md': SURVEY_OK,
}, /属于家 `research`/);

expectFail('文件名缺日期', {
  '.agents/research/sample.md': SURVEY_OK,
}, /文件名必须为 yyyy-mm-dd/);

expectFail('文件名日期在未来', {
  '.agents/research/2099-01-01-future.md': SURVEY_OK,
}, /文件名日期 .* 在未来/);

/* --------------------------------------------------------------- 头块字段 */

expectFail('非法状态值', {
  '.agents/research/2026-01-01-bad-status.md': SURVEY_OK.replace('Status: current', 'Status: done'),
}, /不是类型 survey 的合法状态/);

expectFail('禁止字段', {
  '.agents/plans/2026-01-01-forbidden-field.md': PLAN_OK.replace(`Updated: ${TODAY}`, `Updated: ${TODAY}\nVerified: ${TODAY}`),
}, /禁止字段 `Verified:`/);

expectFail('未注册字段', {
  '.agents/research/2026-01-01-unknown-field.md': SURVEY_OK.replace(`Updated: ${TODAY}`, `Updated: ${TODAY}\nFoo: bar`),
}, /未注册的头块字段 `Foo:`/);

expectFail('字段顺序颠倒', {
  '.agents/research/2026-01-01-field-order.md': SURVEY_OK.replace(`Type: survey\nStatus: current`, `Status: current\nType: survey`),
}, /头块字段顺序不符注册表/);

expectFail('字段留占位符', {
  '.agents/research/2026-01-01-placeholder.md': SURVEY_OK.replace(`Updated: ${TODAY}`, `Updated: ${TODAY}\nSource: <填写来源>`),
}, /残留占位符/);

expectFail('缺必填字段', {
  '.agents/research/2026-01-01-no-updated.md': SURVEY_OK.replace(`Updated: ${TODAY}\n`, ''),
}, /缺少必填字段 `Updated:`/);

expectFail('日期格式错', {
  '.agents/research/2026-01-01-bad-date.md': SURVEY_OK.replace(`Updated: ${TODAY}`, 'Updated: 2026年10月02日'),
}, /字段 `Updated:` 必须为 yyyy-mm-dd/);

expectFail('superseded 缺 Superseded-by', {
  '.agents/research/2026-01-01-superseded.md': SURVEY_OK.replace('Status: current', 'Status: superseded'),
}, /必须带 `Superseded-by:`/);

/* ------------------------------------------------------------------- 节 */

expectFail('缺必备节', {
  '.agents/research/2026-01-01-no-limits.md': SURVEY_OK.replace('## 适用边界\n\n样本范围与失效条件。\n', ''),
}, /缺少必备节：## 适用边界/);

expectFail('必备节顺序错', {
  '.agents/research/2026-01-01-bad-order.md': SURVEY_OK
    .replace('## 问题\n\n要回答什么。\n\n', '')
    .replace('## 适用边界', '## 问题\n\n要回答什么。\n\n## 适用边界'),
}, /必备节顺序不符模板/);

expectFail('出现禁用节', {
  '.agents/research/2026-01-01-forbidden-section.md': `${SURVEY_OK}\n## 状态记录\n\n- 不该出现。\n`,
}, /禁止这些节/);

expectFail('必备节是空的', {
  '.agents/research/2026-01-01-empty-section.md': SURVEY_OK.replace('## 结论\n\n- 结论一 [出处](../README.md)\n', '## 结论\n'),
}, /是空的/);

expectPass('空节标记被接受', {
  '.agents/research/2026-01-01-empty-marker.md': SURVEY_OK.replace('## 适用边界\n\n样本范围与失效条件。', '## 适用边界\n\n_（无）_'),
});

/* ------------------------------------------------------------- 预算与时效 */

expectFail('超字数预算', {
  '.agents/future/2026-01-01-fat-idea.md': `# 过胖的想法

Type: idea
Status: future
Updated: ${TODAY}

## 动机

${'很长的动机说明。'.repeat(80)}

## 触发条件

出现某信号。

## 成本与收益

一周。
`,
}, /超上限 400/);

expectPass('时效超期只报警不阻断', {
  '.agents/research/2026-01-01-stale.md': SURVEY_OK.replace(`Updated: ${TODAY}`, 'Updated: 2020-01-01'),
}, /时效: .*已过/,
);

// idea 预算 400 词：标题与三个节标题 13 字 + 头块 6 个拉丁 token + 正文 372 字 = 391，落在 95% 与上限之间
expectPass('预算余量不足只报警', {
  '.agents/future/2026-01-01-tight-idea.md': `# 甲

Type: idea
Status: future
Updated: ${TODAY}

## 动机

${'字'.repeat(372)}

## 触发条件

_（无）_

## 成本与收益

_（无）_
`,
}, /余量不足 5%/);

/* ------------------------------------------------- 状态机（需 git 基线） */

{
  const rel = '.agents/plans/2026-01-01-transition.md';
  write(rel, PLAN_OK.replace('Status: draft', 'Status: done'));
  git('add', '-A');
  git('-c', 'user.email=selftest@local', '-c', 'user.name=selftest', 'commit', '-q', '-m', 'baseline');
  write(rel, PLAN_OK.replace('Status: draft', 'Status: active'));
  git('add', '-A');
  const r = runTypes(root, { today: TODAY });
  if (r.errors.some((e) => /非法迁移 `done` → `active`/.test(e))) passed++;
  else failures.push(`非法状态迁移：实际错误=${JSON.stringify(r.errors.slice(0, 4))}`);
  reset([rel]);
}

{
  const rel = '.agents/plans/2026-01-01-terminal.md';
  write(rel, PLAN_OK.replace('Status: draft', 'Status: superseded').replace(`Updated: ${TODAY}`, `Updated: ${TODAY}\nSuperseded-by: [替代者](./2026-01-02-next.md)`));
  write('.agents/plans/2026-01-02-next.md', PLAN_OK);
  git('add', '-A');
  git('-c', 'user.email=selftest@local', '-c', 'user.name=selftest', 'commit', '-q', '-m', 'baseline');
  write(rel, PLAN_OK.replace('Status: draft', 'Status: active').replace(`Updated: ${TODAY}`, `Updated: ${TODAY}\nSuperseded-by: [替代者](./2026-01-02-next.md)`));
  git('add', '-A');
  const r = runTypes(root, { today: TODAY });
  if (r.errors.some((e) => /是终态，不得迁出/.test(e))) passed++;
  else failures.push(`终态迁出：实际错误=${JSON.stringify(r.errors.slice(0, 4))}`);
  reset([rel, '.agents/plans/2026-01-02-next.md']);
}

/* --------------------------------------------------- 注册表自洽与专属检查 */

expectFail('孤儿模板', { '.agents/templates/bogus.md': '# 没有类型引用的模板\n' }, /是孤儿/);

{
  const p = join(root, '.agents', 'templates', 'survey.md');
  rmSync(p);
  sync();
  const r = runTypes(root, { today: TODAY });
  if (r.errors.some((e) => /模板缺失/.test(e))) passed++;
  else failures.push(`模板缺失：实际错误=${JSON.stringify(r.errors.slice(0, 4))}`);
  cpSync(join(SRC_ROOT, '.agents', 'templates', 'survey.md'), p);
  sync();
}

expectFail('投影与注册表不一致', { '.agents/doc-types.md': '# 文档类型注册表（投影）\n\n手改过的内容。\n' }, /与注册表不一致/);

expectFail('术语条目格式错', {
  '.agents/GLOSSARY.md': '# GLOSSARY — 术语表\n\n## 分组\n\n术语（English）：定义。\n',
}, /格式应为/);

expectFail('术语缺 _Avoid_', {
  '.agents/GLOSSARY.md': '# GLOSSARY — 术语表\n\n## 分组\n\n**术语（English）**：定义。\n',
}, /缺 `_Avoid_:`/);

expectFail('技能 name 与目录名不一致', {
  '.agents/skills/foo/SKILL.md': '---\nname: bar\ndescription: 当用户要 foo 时使用本技能。\n---\n\n# foo\n\n步骤。\n',
}, /必须与所在目录名/);

expectFail('来源不足', {
  '.agents/research/2026-01-01-no-sources.md': SURVEY_OK.replace(/\[[^\]]*\]\([^)]*\)/g, 'X').replace('https://example.com/a', 'X'),
}, /可回溯出处/);

expectPass('原始语料目录整体豁免', {
  '.agents/research/2026-01-01-corpus/.agents-raw': '',
  '.agents/research/2026-01-01-corpus/page-1.md': '# 外部镜像页\n\n没有头块也不报错。\n',
});

expectFail('禁 INDEX.md', {
  '.agents/plans/INDEX.md': '# 索引\n\n- [计划](./2026-01-01-sample.md)\n',
}, /INDEX\.md 被禁止/);

/* ----------------------------------------------------------------- 归档封印 */

expectFail('归档缺 Archived 行', {
  '.agents/archive/2026-01-01-old.md': `# 旧文档\n\nType: plan\nStatus: done\nUpdated: ${TODAY}\n\n正文。\n`,
}, /缺少 `Archived: yyyy-mm-dd` 行/);

expectFail('归档封印哈希不符', {
  '.agents/archive/2026-01-01-old.md': `# 旧文档\n\nType: plan\nStatus: done\nUpdated: ${TODAY}\nArchived: ${TODAY}\n\n正文。\n`,
  '.agents/archive/manifest.json': '{\n  "version": 1,\n  "files": {\n    "archive/2026-01-01-old.md": "sha256:deadbeef"\n  }\n}\n',
}, /哈希不一致/);

/* ------------------------- 永不删除 / 家不变量 / Updated 诚实性（需 git 基线） */

{
  const rel = '.agents/plans/2026-01-01-to-delete.md';
  const moved = '.agents/research/2026-01-01-to-delete.md';
  write(rel, PLAN_OK);
  git('add', '-A');
  git('-c', 'user.email=selftest@local', '-c', 'user.name=selftest', 'commit', '-q', '-m', 'baseline');
  rmSync(join(root, rel), { force: true });
  const r = runTypes(root, { today: TODAY });
  if (r.errors.some((e) => /永不删除/.test(e))) passed++;
  else failures.push(`静默删除未被发现：实际错误=${JSON.stringify(r.errors.slice(0, 4))}`);
  write(moved, SURVEY_OK); // 同名文件迁到别处 = 迁移，不算删除
  git('add', '-A');
  const r2 = runTypes(root, { today: TODAY });
  if (!r2.errors.some((e) => /永不删除/.test(e))) passed++;
  else failures.push(`迁移被误判为删除：${JSON.stringify(r2.errors.filter((e) => /永不删除/.test(e)))}`);
  reset([rel, moved]);
}

{
  const p = join(root, '.agents', 'skills', 'README.md');
  const original = readFileSync(p, 'utf8');
  rmSync(p);
  const r = runTypes(root, { today: TODAY });
  if (r.errors.some((e) => /缺入口规格页/.test(e))) passed++;
  else failures.push(`家缺 README 未被发现：实际错误=${JSON.stringify(r.errors.slice(0, 4))}`);
  writeFileSync(p, original);
  sync();
}

{
  const dir = join(root, '.agents', 'future');
  rmSync(dir, { recursive: true, force: true });
  const r = runTypes(root, { today: TODAY });
  if (r.errors.some((e) => /家 `future` 的目录不存在/.test(e))) passed++;
  else failures.push(`家目录消失未被发现：实际错误=${JSON.stringify(r.errors.slice(0, 4))}`);
  write('.agents/future/README.md', '# future/ — 样例\n\n装什么：样例。\n');
  sync();
}

{
  // 日期是陈旧值：正文改了却没动 Updated → 必须提醒
  const rel = '.agents/research/2026-01-01-updated-honesty.md';
  const stale = SURVEY_OK.replace(`Updated: ${TODAY}`, 'Updated: 2026-09-01');
  write(rel, stale);
  git('add', '-A');
  git('-c', 'user.email=selftest@local', '-c', 'user.name=selftest', 'commit', '-q', '-m', 'baseline');
  write(rel, stale.replace('一句话结论。', '一句话结论，正文改了但日期没动。'));
  git('add', '-A');
  const r = runTypes(root, { today: TODAY });
  if (r.warnings.some((w) => /正文相对 HEAD 变了但/.test(w))) passed++;
  else failures.push(`Updated 未随正文更新没有被提醒：警告=${JSON.stringify(r.warnings.slice(0, 4))}`);
  reset([rel]);
}

{
  // 日期已是今天：同日二次修改无从「再更新」，不得产生无法消除的常驻告警
  const rel = '.agents/research/2026-01-02-updated-same-day.md';
  write(rel, SURVEY_OK);
  git('add', '-A');
  git('-c', 'user.email=selftest@local', '-c', 'user.name=selftest', 'commit', '-q', '-m', 'baseline same-day');
  write(rel, SURVEY_OK.replace('一句话结论。', '一句话结论，同一天又改了一次。'));
  git('add', '-A');
  const r = runTypes(root, { today: TODAY });
  if (!r.warnings.some((w) => /正文相对 HEAD 变了但/.test(w))) passed++;
  else failures.push(`同日二次修改不该报 Updated 未更新（常驻告警必须清零）：${JSON.stringify(r.warnings.filter((w) => /正文相对 HEAD/.test(w)).slice(0, 2))}`);
  reset([rel]);
}

/* ------------------------------------------- 归档全链路（archive-doc 端到端） */

{
  const src = '.agents/plans/2026-01-01-archive-me.md';
  const linker = '.agents/plans/2026-01-01-linker.md';
  const archived = '.agents/archive/plans/2026-01-01-archive-me.md';
  write(src, PLAN_OK);
  write(linker, `${PLAN_OK}\n参见[那篇计划](./2026-01-01-archive-me.md)。\n`);
  git('add', '-A');
  git('-c', 'user.email=selftest@local', '-c', 'user.name=selftest', 'commit', '-q', '-m', 'baseline');

  const r = spawnSync(process.execPath, [join(SRC_ROOT, 'scripts', 'archive-doc.mjs'), src, '--subdir', 'plans', '--root', root], { encoding: 'utf8' });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  expectTrue('archive-doc 正常退出', r.status === 0, out.slice(0, 300));
  expectTrue('源文件已移走、归档件已落地', !existsSync(join(root, src)) && existsSync(join(root, archived)));
  expectTrue('归档件带 Archived 行', /^Archived: \d{4}-\d{2}-\d{2}$/m.test(readFileSync(join(root, archived), 'utf8')));
  expectTrue('归档件已封印', existsSync(join(root, '.agents', 'archive', 'manifest.json')) && /archive\/plans\/2026-01-01-archive-me\.md/.test(readFileSync(join(root, '.agents', 'archive', 'manifest.json'), 'utf8')));
  expectTrue('入链被列出来要求同批修复', out.includes('待修入链') && out.includes('2026-01-01-linker.md'), out.slice(-300));
  git('add', '-A');
  const after = runTypes(root, { today: TODAY });
  expectTrue('归档后门禁通过', after.ok, JSON.stringify(after.errors.slice(0, 4)));
  writeFileSync(join(root, archived), `${readFileSync(join(root, archived), 'utf8')}\n改一字。\n`);
  const tampered = runTypes(root, { today: TODAY });
  expectTrue('归档件被改动后封印报错', tampered.errors.some((e) => /哈希不一致/.test(e)), JSON.stringify(tampered.errors.slice(0, 3)));

  rmSync(join(root, archived), { force: true });
  rmSync(join(root, '.agents', 'archive', 'manifest.json'), { force: true });
  rmSync(join(root, '.agents', 'archive', 'plans'), { recursive: true, force: true });
  reset([src, linker]);
}

/* ------------------------------------- 模板 ↔ 注册表一致性（三件套第三件） */

// 结构性失败 = 模板与注册表脱节；内容性失败（占位符、空节、来源不足）是作者该填的，不算模板的错
const STRUCTURAL_RE = /缺少必备节|顺序不符模板|禁止这些节|禁止字段|未注册的头块字段|缺少必填字段|属于家|固定位置应为|文件名必须为|的合法状态|头块字段顺序|第 1 行必须为|必须为空行|必须带 `Superseded-by:`/;

/** 把模板头块里的占位符换成合法值；正文占位符保留（那是作者要填的）。 */
function fillHeaderPlaceholders(text) {
  const lines = text.split('\n');
  for (let i = 1; i < lines.length && lines[i].trim() !== ''; i++) {
    if (!/^([A-Za-z-]+):\s*.*<[^>]*>/.test(lines[i])) continue;
    lines[i] = lines[i].replace(/<[^>]*>/, '样例来源 https://example.com/source');
  }
  return lines.join('\n').replace(/^description: .*$/m, 'description: 当需要样例流程时使用本技能。');
}

{
  const broken = [];
  for (const [type, t] of Object.entries(REG.types)) {
    if (!t.template) continue;
    let s;
    try {
      s = renderScaffold(REG, type, { root, topic: 'sample', name: 'sample', date: TODAY, title: '样例' });
    } catch (e) {
      broken.push(`${type}: 脚手架抛错 ${e.message}`);
      continue;
    }
    write(s.rel, fillHeaderPlaceholders(s.text));
    git('add', '-A');
    const r = runTypes(root, { today: TODAY });
    const bad = r.errors.filter((e) => e.includes(s.rel) && STRUCTURAL_RE.test(e));
    if (bad.length) broken.push(`${type}（${s.rel}）: ${bad.join(' | ')}`);
    else passed++;
    reset([s.rel]);
  }
  if (broken.length) failures.push(`模板与注册表不一致，脚手架产物结构性失败：\n  ${broken.join('\n  ')}`);
}

/* ------------------------------------------------- 布局封闭集与桥完整性 */

expectFail('仓库根出现未登记的 Markdown', { 'NOTES.md': '# 随手记\n\n正文。\n' }, /布局: NOTES\.md/);
expectFail('仓库根出现未登记的目录', { 'bogus-root/README.md': '# 未登记目录\n\n样例。\n' }, /布局: bogus-root\//);

{
  mkdirSync(join(root, '.agents', 'bogus'), { recursive: true });
  const r = runTypes(root, { today: TODAY });
  if (r.errors.some((e) => /布局: \.agents\/bogus/.test(e))) passed++;
  else failures.push(`未登记的 .agents 子目录未被发现：实际错误=${JSON.stringify(r.errors.slice(0, 4))}`);
  rmSync(join(root, '.agents', 'bogus'), { recursive: true, force: true });
  sync();
}

{
  rmSync(join(root, 'CLAUDE.md'), { force: true });
  const r = runTypes(root, { today: TODAY });
  if (r.errors.some((e) => /桥: CLAUDE\.md — 不存在/.test(e))) passed++;
  else failures.push(`桥缺失未被发现：实际错误=${JSON.stringify(r.errors.slice(0, 4))}`);
  writeFileSync(join(root, 'CLAUDE.md'), '# 我不是符号链接\n');
  const r2 = runTypes(root, { today: TODAY });
  if (r2.errors.some((e) => /桥: CLAUDE\.md — 不是符号链接/.test(e))) passed++;
  else failures.push(`桥退化成普通副本未被发现：实际错误=${JSON.stringify(r2.errors.slice(0, 4))}`);
  rmSync(join(root, 'CLAUDE.md'), { force: true });
  symlinkSync('AGENTS.md', join(root, 'CLAUDE.md'));
  sync();
}

/* ------------------------------------------------------ 归档与必填字段 */

expectPass('归档文档保留原 Type 也不会被误判回原类型', {
  '.agents/archive/2026-01-01-old.md': `# 旧计划

Type: plan
Status: done
Updated: ${TODAY}
Archived: ${TODAY}

正文。
`,
});

expectFail('evidence 缺 Verified', {
  '.agents/research/2026-01-01-no-verified.md': `# 采集快照

Type: evidence
Status: current
Updated: ${TODAY}
Source: https://example.com/raw

## 采集内容

原始输出。

## 采集方式

\`\`\`bash
some-command
\`\`\`

## 适用边界

只覆盖 X。
`,
}, /缺少必填字段 `Verified:`/);

/* --------------------------------------------------------- --adopt 迁移器 */

{
  const rel = '.agents/research/2026-01-01-adopt-me.md';
  write(rel, '# 待补头块的调研\n\n## 问题\n\n要回答什么。\n');
  const res = adoptDoc(REG, root, { adopt: rel, type: 'survey' });
  expectTrue('adopt 补齐必填字段', ['Type', 'Status', 'Updated'].every((f) => res.fields.includes(f)), res.fields.join(' '));
  expectTrue('adopt 不动正文', res.text.endsWith('\n## 问题\n\n要回答什么。\n'), JSON.stringify(res.text.slice(-30)));
  expectTrue('adopt 不给可选字段凭空生成 Verified', !res.fields.includes('Verified'), res.fields.join(' '));
  const res2 = adoptDoc(REG, root, { adopt: rel, type: 'survey' });
  expectTrue('adopt 幂等', res2.text === res.text);
  sync();
  const after = runTypes(root, { today: TODAY });
  const headErrors = after.errors.filter((e) => e.includes(rel) && /头块|归类|文件名/.test(e));
  expectTrue('adopt 产物在头块与归类上干净（内容缺失另算）', headErrors.length === 0, JSON.stringify(headErrors));
  reset([rel]);
}

expectThrow('adopt 拒绝笔记树', () => adoptDoc(REG, root, { adopt: '.agents/notes/implemented/process/2026-01-01-x.md', type: 'note' }), /专属守卫/);
expectThrow('adopt 拒绝技能（frontmatter 类型）', () => adoptDoc(REG, root, { adopt: '.agents/skills/foo/SKILL.md', type: 'skill' }), /不带头块字段/);

{
  const rel = '.agents/research/2026-01-01-adopt-evidence.md';
  write(rel, '# 采集\n\n正文。\n');
  const res = adoptDoc(REG, root, { adopt: rel, type: 'evidence' });
  expectTrue('必填 Verified 无法推断时留占位符而不是替人签', res.placeholders.includes('Verified'), res.text.split('\n').slice(0, 8).join(' | '));
  reset([rel]);
}

/* ------------------------------------------------------------- 写作层夹具 */

const PROSE_FILE = '.agents/research/2026-01-01-prose.md';

expectFail('emoji', {
  [PROSE_FILE]: `# 排版样例\n\n正文带 🎉 装饰。\n`,
}, /emoji 或装饰符号/, runProse);

expectFail('中英混排缺空格', {
  [PROSE_FILE]: `# 排版样例\n\n这是中文English混排。\n`,
}, /缺半角空格/, runProse);

expectFail('中文语境用半角标点', {
  [PROSE_FILE]: `# 排版样例\n\n这是中文, 用错标点。\n`,
}, /应用全角标点/, runProse);

expectFail('一段跨多物理行', {
  [PROSE_FILE]: `# 排版样例\n\n第一段第一行。\n第一段第二行。\n`,
}, /一段一物理行/, runProse);

expectClean('头块字段行不算段落', {
  [PROSE_FILE]: SURVEY_OK,
}, runProse);

expectClean('行内代码与链接不参与排版检查', {
  [PROSE_FILE]: `# 排版样例\n\n运行 \`node scripts/run-checks.mjs\`，见[总规格](../README.md)。\n`,
}, runProse);

expectClean('原始语料目录也不受写作检查', {
  '.agents/research/2026-01-01-corpus/.agents-raw': '',
  '.agents/research/2026-01-01-corpus/page.md': '# 外部页\n\n带 🎉 和半角标点.\n',
}, runProse);

expectFail('正文用了硬禁用词', {
  '.agents/research/2026-01-01-term.md': '# 术语样例\n\n这里出现了 样本文本 这个词。\n',
}, /用了禁用词/, runProse);

expectClean('「」内提及禁用词不算使用', {
  '.agents/research/2026-01-01-term-quoted.md': '# 术语样例\n\n不要写「样本文本」，改用登记术语。\n',
}, runProse);

expectClean('未加 ！ 的 Avoid 词条不阻断', {
  '.agents/research/2026-01-01-term-soft.md': '# 术语样例\n\n这里出现了 例子 这个词，属命名指引不属硬禁用。\n',
}, runProse);

const DUP = '这句话在两个文档里一字不差地重复出现，长度超过四十个字符，用来触发跨文档重复句探针。';

expectPass('跨文档重复句只报警', {
  '.agents/research/2026-01-01-dup-a.md': `# 甲\n\n${DUP}\n`,
  '.agents/research/2026-01-02-dup-b.md': `# 乙\n\n${DUP}\n`,
}, /重复: /, runProse);

/* ------------------------------------------------------- 版式层（check-layout） */

const FENCE = '```';

expectFail('版式：代码栅栏未闭合', {
  '.agents/research/2026-01-01-layout-fence-open.md': `# 样例\n\n${FENCE}text\nlet x = 1;\n`,
}, /代码栅栏未闭合/, runLayout);

expectFail('版式：代码栅栏缺语言标记只报警', {
  '.agents/research/2026-01-01-layout-fence-bare.md': `# 样例\n\n${FENCE}\nplain text\n${FENCE}\n`,
}, /缺语言标记/, runLayout);

expectFail('版式：表格列数与表头不符', {
  '.agents/research/2026-01-01-layout-table.md': '# 样例\n\n| 甲 | 乙 |\n| --- | --- |\n| 1 | 2 | 3 |\n',
}, /与表头/, runLayout);

expectFail('版式：标题层级跳跃', {
  '.agents/research/2026-01-01-layout-heading.md': '# 样例\n\n## 二级\n\n#### 四级\n',
}, /标题层级跳跃/, runLayout);

expectFail('版式：结尾缺换行', {
  '.agents/research/2026-01-01-layout-eof.md': { raw: '# 样例\n\n正文没有结尾换行' },
}, /结尾缺换行/, runLayout);

expectFail('版式：行尾空白', {
  '.agents/research/2026-01-01-layout-space.md': '# 样例\n\n正文带尾随空格   \n',
}, /行尾有空白/, runLayout);

expectFail('版式：连续空行只报警', {
  '.agents/research/2026-01-01-layout-blank.md': '# 样例\n\n\n正文\n',
}, /连续空行/, runLayout);

expectClean('版式：栅栏内是数据，尾随空白与井号都不误报', {
  '.agents/research/2026-01-01-layout-fence-body.md': `# 样例\n\n${FENCE}text\n命令输出带尾随空格   \n# 这不是标题\n#### 也不是\n${FENCE}\n\n正文\n`,
}, runLayout);

expectClean('版式：frontmatter 里的井号是注释不是标题', {
  '.agents/research/2026-01-01-layout-frontmatter.md': '---\n# YAML 注释\nname: sample\n---\n\n# 样例\n\n正文\n',
}, runLayout);

expectClean('版式：HTML 注释区整段跳过', {
  '.agents/research/2026-01-01-layout-comment.md': '# 样例\n\n<!--\n注释里有尾随空格   \n-->\n\n正文\n',
}, runLayout);

expectClean('版式：表格里的行内代码竖线与转义竖线不误报', {
  '.agents/research/2026-01-01-layout-table-escape.md': `# 样例\n\n| 甲 | 乙 |\n| --- | --- |\n| ${'`'}a|b${'`'} | x \\| y |\n`,
}, runLayout);

expectClean('版式：原始语料目录整目录豁免', {
  '.agents/research/2026-01-01-layout-raw/.agents-raw': '',
  '.agents/research/2026-01-01-layout-raw/page.md': `# 坏版式\n\n${FENCE}\n未闭合\n`,
}, runLayout);

/* --------------------------------------------------------------- 链接守卫 */

expectFail('链接：相对链接目标不存在', {
  '.agents/research/2026-01-01-badlink.md': SURVEY_OK.replace('[注册表](../doc-types.json)', '[注册表](../nope.json)'),
}, /相对链接目标不存在/, runLinks);

expectClean('链接：外链、纯锚点与 mailto 一律跳过', {
  '.agents/research/2026-01-01-links-skip.md': '# 样例\n\n[外部](https://example.com/a)、[锚点](#节)、[邮件](mailto:a@b.c)。\n',
}, runLinks);

expectClean('链接：fenced code 里的断链不查', {
  '.agents/research/2026-01-01-links-fence.md': `# 样例\n\n${FENCE}markdown\n[断链](./nope.md)\n${FENCE}\n`,
}, runLinks);

expectClean('链接：原始语料目录整目录豁免', {
  '.agents/research/2026-01-01-links-raw/.agents-raw': '',
  '.agents/research/2026-01-01-links-raw/page.md': '# 语料\n\n[断链](./nope.md)\n',
}, runLinks);

const NOTE_OK = `# Agent Note: 样例决定

Status: implemented

## Problem

动机要能脱离方案独立成立。

## Decision

现在时描述已落地的现实。

## Alternatives considered

**备选甲**：为什么落选。

## Consequences

后果与代价。
`;

// 笔记正文的链接归 check-agent-notes，本守卫必须看不见它——否则两道守卫重复报错
expectClean('链接：notes lifecycle 子树交给专属守卫', {
  '.agents/notes/implemented/process/2026-01-01-links-note.md': NOTE_OK.replace('后果与代价。', '见[别处](../../../../nope.md)。'),
}, runLinks);

expectFail('链接：模板目录整体豁免但仍单独补检', {
  '.agents/templates/zz-broken-sample.md': '# 样例\n\n[断链](./nope.md)\n',
}, /相对链接目标不存在/, runLinks);

/* --------------------------------------------------------------- 笔记守卫 */

expectPass('笔记：合法 implemented 笔记通过', {
  '.agents/notes/implemented/process/2026-01-01-sample.md': NOTE_OK,
}, null, runNotes);

expectFail('笔记：同一条断链由专属守卫报出', {
  '.agents/notes/implemented/process/2026-01-01-note-link.md': NOTE_OK.replace('后果与代价。', '见[别处](../../../../nope.md)。'),
}, /相对链接目标不存在/, runNotes);

expectFail('笔记：未知 lifecycle 目录', {
  '.agents/notes/wip/2026-01-01-x.md': NOTE_OK,
}, /未知 lifecycle/, runNotes);

expectFail('笔记：未知 class 目录', {
  '.agents/notes/implemented/refactor/2026-01-01-x.md': NOTE_OK,
}, /未知 class/, runNotes);

expectFail('笔记：文件名缺日期', {
  '.agents/notes/implemented/process/sample.md': NOTE_OK,
}, /文件名必须为 yyyy-mm-dd/, runNotes);

expectFail('笔记：Status 与所在 lifecycle 目录不一致', {
  '.agents/notes/implemented/process/2026-01-01-status.md': NOTE_OK.replace('Status: implemented', 'Status: proposed'),
}, /与所在 implemented\/ 目录一致/, runNotes);

expectFail('笔记：implemented 里出现提案式节标题', {
  '.agents/notes/implemented/process/2026-01-01-tense.md': NOTE_OK.replace('## Decision', '## Proposal'),
}, /禁止提案式节标题/, runNotes);

expectFail('笔记：缺 Alternatives considered 且无 retro 豁免', {
  '.agents/notes/implemented/process/2026-01-01-noalt.md': NOTE_OK.replace('## Alternatives considered\n\n**备选甲**：为什么落选。\n\n', ''),
}, /Alternatives considered/, runNotes);

expectFail('笔记：禁全局 INDEX.md', {
  '.agents/notes/INDEX.md': '# 索引\n',
}, /INDEX/, runNotes);

/* --------------------------------------------------- 笔记：归档区封印 */

const ARCHIVED_NOTE = `# Agent Note: 已归档的样例决定

Status: implemented

Archived: ${TODAY}

## Problem

动机。

## Decision

决定。

## Alternatives considered

**备选甲**：落选理由。

## Consequences

后果。
`;

// write() 会自动补结尾换行，封印要按落盘后的字节算
const sealOf = (s) => `sha256:${createHash('sha256').update(Buffer.from(s.endsWith('\n') ? s : `${s}\n`, 'utf8')).digest('hex')}`;
const manifestOf = (files) => `${JSON.stringify({ version: 1, files }, null, 2)}\n`;
const ARCHIVE_REL = '.agents/notes/archived/process/2026-01-01-sealed.md';
const ARCHIVE_KEY = 'archived/process/2026-01-01-sealed.md';
const MANIFEST_REL = '.agents/notes/archived/manifest.json';

expectClean('笔记：归档封印一致则通过', {
  [ARCHIVE_REL]: ARCHIVED_NOTE,
  [MANIFEST_REL]: manifestOf({ [ARCHIVE_KEY]: sealOf(ARCHIVED_NOTE) }),
}, runNotes);

expectFail('笔记：归档文件缺封印条目', {
  [ARCHIVE_REL]: ARCHIVED_NOTE,
  [MANIFEST_REL]: manifestOf({}),
}, /manifest 中缺少封印/, runNotes);

expectFail('笔记：归档后正文被改（哈希不一致）', {
  [ARCHIVE_REL]: ARCHIVED_NOTE,
  [MANIFEST_REL]: manifestOf({ [ARCHIVE_KEY]: 'sha256:deadbeef' }),
}, /哈希不一致/, runNotes);

expectFail('笔记：manifest 非法 JSON', {
  [ARCHIVE_REL]: ARCHIVED_NOTE,
  [MANIFEST_REL]: '{ version: 1 }',
}, /不是合法 JSON/, runNotes);

expectPass('笔记：有归档但缺 manifest 只告警', {
  [ARCHIVE_REL]: ARCHIVED_NOTE,
}, /manifest\.json 缺失/, runNotes);

// append-only：封印进基线后，改正文再重新封印也必须报错——否则改一次归一次就能把篡改洗白
{
  write(ARCHIVE_REL, ARCHIVED_NOTE);
  write(MANIFEST_REL, manifestOf({ [ARCHIVE_KEY]: sealOf(ARCHIVED_NOTE) }));
  sync();
  const tampered = ARCHIVED_NOTE.replace('后果。', '被改过的后果。');
  write(ARCHIVE_REL, tampered);
  write(MANIFEST_REL, manifestOf({ [ARCHIVE_KEY]: sealOf(tampered) }));
  git('add', '-A');
  const r = runNotes(root);
  expectTrue('笔记：归档后重新封印仍违反 append-only', !r.ok && r.errors.some((e) => /append-only/.test(e)), JSON.stringify(r.errors.slice(0, 3)));
  reset([ARCHIVE_REL, MANIFEST_REL]);
}

/* ---------------------------------------- 笔记树 schema 由注册表 noteTree 驱动 */

// 改注册表 noteTree 的必备节清单，笔记守卫行为随之变化——schema 的家在注册表不在守卫代码
expectFail('笔记：noteTree 改动即时生效（implemented 增列 risks）', {
  '.agents/doc-types.json': `${JSON.stringify({ ...REG, noteTree: { ...REG.noteTree, sectionsByStatus: { ...REG.noteTree.sectionsByStatus, implemented: [...REG.noteTree.sectionsByStatus.implemented, 'risks'] } } }, null, 2)}\n`,
  '.agents/notes/implemented/process/2026-01-01-notetree.md': NOTE_OK,
}, /缺少必备节：`## Risks`/, runNotes);

expectFail('注册表：noteTree 引用未定义的节键', {
  '.agents/doc-types.json': `${JSON.stringify({ ...REG, noteTree: { ...REG.noteTree, sectionsByStatus: { ...REG.noteTree.sectionsByStatus, implemented: ['problem', 'decision', 'alternatives', 'consequences', 'bogus-section'] } } }, null, 2)}\n`,
}, /noteTree\.sectionsByStatus 用了未定义的节键 `bogus-section`/, runTypes);

expectFail('注册表：noteTree 缺失', {
  '.agents/doc-types.json': `${JSON.stringify({ ...REG, noteTree: undefined }, null, 2)}\n`,
}, /缺少顶层字段 `noteTree`/, runTypes);

expectFail('注册表：noteTree.statusLine 缺某 lifecycle', {
  '.agents/doc-types.json': `${JSON.stringify({ ...REG, noteTree: { ...REG.noteTree, statusLine: { proposed: 'Status: proposed', implemented: 'Status: implemented' } } }, null, 2)}\n`,
}, /noteTree\.statusLine 缺少 lifecycle `rejected`/, runTypes);

expectFail('注册表：noteTree.statusReasonRequired 含不在 lifecycles 内的项', {
  '.agents/doc-types.json': `${JSON.stringify({ ...REG, noteTree: { ...REG.noteTree, statusReasonRequired: [...REG.noteTree.statusReasonRequired, 'archived'] } }, null, 2)}\n`,
}, /noteTree\.statusReasonRequired 的 `archived` 不在 lifecycles 内/, runTypes);

/* ---------------------------------------- 注册表序列化归一（值级变更即值级 diff） */

// 审计案例：注册表一个值级变更曾炸出千行格式化 diff（churn 居机制文件之首）。
// 规范形态 = serializeRegistry：就地改值不重建对象（键序即文件键序）、2 空格缩进、结尾一个换行。
{
  const raw = readFileSync(join(SRC_ROOT, '.agents', 'doc-types.json'), 'utf8');
  const once = serializeRegistry(JSON.parse(raw));
  expectTrue('序列化归一：同一注册表连序列化两遍逐字节一致（重解析回环是不动点）',
    once === serializeRegistry(JSON.parse(once)),
    '规范序列化不是不动点——键序或缩进有漂移');
  expectTrue('序列化归一：仓内注册表已是规范形态（值级变更即值级 diff）',
    raw === once,
    '与 serializeRegistry 形态不一致——跑 node scripts/gen-doc-types.mjs --normalize 归一');
}

// --normalize 连跑两遍：首遍把非规范形态改写回规范，第二遍零改写——写回动作本身不许产生 churn
{
  const normRoot = mkdtempSync(join(tmpdir(), 'curia-normalize-'));
  try {
    mkdirSync(join(normRoot, '.agents'), { recursive: true });
    const regPath = join(normRoot, '.agents', 'doc-types.json');
    const canonical = readFileSync(join(SRC_ROOT, '.agents', 'doc-types.json'), 'utf8');
    writeFileSync(regPath, `${JSON.stringify(JSON.parse(canonical), null, 4)}\n`); // 4 空格缩进 = 非规范形态
    const envNorm = { ...process.env, CURIA_ROOT: normRoot };
    delete envNorm.CURIA_STAGED; // 自证可能从 pre-commit 透传暂存开关
    const run = () => spawnSync(process.execPath, [join(SRC_ROOT, 'scripts', 'gen-doc-types.mjs'), '--normalize'], { cwd: normRoot, encoding: 'utf8', env: envNorm });
    const first = run();
    const regAfterFirst = readFileSync(regPath);
    const projAfterFirst = readFileSync(join(normRoot, '.agents', 'doc-types.md'));
    const second = run();
    expectTrue('序列化归一：--normalize 首遍把非规范形态改写回规范（报写回）',
      first.status === 0 && (first.stdout ?? '').includes('已按规范序列化写回') && regAfterFirst.toString('utf8') === canonical,
      `退出码 ${first.status}；${(first.stderr ?? '').slice(0, 200)}`);
    expectTrue('序列化归一：连跑两遍注册表与投影逐字节一致，第二遍零改写',
      second.status === 0 && readFileSync(regPath).equals(regAfterFirst) && readFileSync(join(normRoot, '.agents', 'doc-types.md')).equals(projAfterFirst) && (second.stdout ?? '').includes('已是规范序列化形态'),
      `退出码 ${second.status}；${(second.stdout ?? '').slice(0, 160)}`);
  } finally {
    rmSync(normRoot, { recursive: true, force: true });
  }
}

/* -------------------------------------------- 规则 ID：每条守卫输出可被定位 */

expectFail('规则 ID：prose 报错挂 [prose/…]', {
  [PROSE_FILE]: '# 排版样例\n\n这是中文English混排。\n',
}, /\[prose\/cjk-space\]/, runProse);

expectFail('规则 ID：notes 报错挂 [notes/…]', {
  '.agents/notes/implemented/process/2026-01-01-rule-id.md': NOTE_OK.replace('Status: implemented', 'Status: proposed'),
}, /\[notes\/status-line\]/, runNotes);

expectTrue('规则 ID：收口自查函数只放过带 [scope/rule] 的输出行', countMissingRuleIds(['干净 [a/b]', '无 ID 的行']) === 1);

/* ------------------------------- 暂存模式：守卫校验索引内容而非盘面（CURIA_STAGED） */

/**
 * 暂存模式夹具的公共姿态：坏版 add 进索引、好版留在盘面（不再 add）。
 * 暂存模式必须按索引拦下坏版（校验的是将要提交的版本），盘面模式必须放行（对照，证明差异只在索引）。
 */
function expectStagedFail(name, rel, bad, good, pattern, run) {
  write(rel, bad);
  git('add', '-A');
  write(rel, good);
  const staged = run({ staged: true });
  expectTrue(`暂存：${name} 按索引拦下坏版（盘上已改好）`, !staged.ok && staged.errors.some((e) => pattern.test(e)), JSON.stringify(staged.errors.slice(0, 3)));
  const disk = run({});
  expectTrue(`暂存：${name} 盘面版本放行（对照，差异只在索引）`, disk.ok, JSON.stringify(disk.errors.slice(0, 3)));
  reset([rel]);
}

expectStagedFail('doc-types', '.agents/research/2026-01-01-staged-types.md',
  SURVEY_OK.replace('Status: current', 'Status: done'), SURVEY_OK,
  /不是类型 survey 的合法状态/, (o) => runTypes(root, { today: TODAY, ...o }));

expectStagedFail('prose', '.agents/research/2026-01-01-staged-prose.md',
  '# 排版样例\n\n这是中文English混排。\n', '# 排版样例\n\n这是中文 English 混排。\n',
  /缺半角空格/, (o) => runProse(root, o));

expectStagedFail('layout', '.agents/research/2026-01-01-staged-layout.md',
  '# 样例\n\n正文带尾随空格   \n', '# 样例\n\n正文无尾随空格\n',
  /行尾有空白/, (o) => runLayout(root, o));

expectStagedFail('links', '.agents/research/2026-01-01-staged-links.md',
  '# 样例\n\n[注册表](../nope.json)\n', '# 样例\n\n[注册表](../doc-types.json)\n',
  /相对链接目标不存在/, (o) => runLinks(root, o));

expectStagedFail('notes', '.agents/notes/implemented/process/2026-01-01-staged-note.md',
  NOTE_OK.replace('Status: implemented', 'Status: proposed'), NOTE_OK,
  /与所在 implemented\/ 目录一致/, (o) => runNotesTree(join(root, '.agents', 'notes'), o));

// 未入库草稿：暂存模式按索引过滤看不见它们，盘面模式看得见——同仓并行会话的在写笔记不拦提交
{
  const relA = '.agents/notes/implemented/process/2026-01-01-staged-draft.md';
  const relB = '.agents/notes/implemented/bogus/2026-01-01-staged-draft.md';
  write(relA, NOTE_OK.replace('Status: implemented', 'Status: proposed'));
  write(relB, NOTE_OK);
  const staged = runNotesTree(join(root, '.agents', 'notes'), { staged: true });
  expectTrue('暂存：未入库坏草稿（含未知 class 目录）不拦提交', staged.ok, JSON.stringify(staged.errors.slice(0, 3)));
  const disk = runNotesTree(join(root, '.agents', 'notes'), {});
  expectTrue('暂存：同草稿盘面模式仍报错（对照）', !disk.ok && disk.errors.some((e) => /与所在 implemented\/ 目录一致/.test(e)) && disk.errors.some((e) => /未知 class/.test(e)), JSON.stringify(disk.errors.slice(0, 4)));
  reset([relA, relB]);
}

// 暂存模式的禁用词清单取自索引版 GLOSSARY：索引里有硬禁用词、盘面已撤掉，暂存模式仍按索引拦下
{
  const glossaryRel = '.agents/GLOSSARY.md';
  const docRel = '.agents/research/2026-01-01-staged-term.md';
  write(glossaryRel, '# GLOSSARY — 术语表\n\n## 分组\n\n**样例（sample）**：用来占位的术语。_Avoid_: 例子、！样例禁用词\n');
  write(docRel, '# 术语样例\n\n这里出现了 样例禁用词 这个词。\n');
  git('add', '-A');
  write(glossaryRel, '# GLOSSARY — 术语表\n\n## 分组\n\n**样例（sample）**：用来占位的术语。_Avoid_: 例子、！样本文本\n');
  const staged = runProse(root, { staged: true });
  expectTrue('暂存：prose 的 GLOSSARY 禁用词清单也读索引版', !staged.ok && staged.errors.some((e) => /用了禁用词/.test(e)), JSON.stringify(staged.errors.slice(0, 3)));
  const disk = runProse(root, {});
  expectTrue('暂存：盘面 GLOSSARY 已撤掉该词则放行（对照）', disk.ok, JSON.stringify(disk.errors.slice(0, 3)));
  reset([glossaryRel, docRel]);
}

// check-tools 的暂存模式只由环境变量开关（runCheck 无 staged 选项），用 CLI 子进程断言
{
  const rel = 'scripts/zz-staged-broken.mjs';
  write(rel, 'const a = ;\n');
  git('add', '-A');
  write(rel, 'export const a = 1;\n');
  const envStaged = { ...process.env, CURIA_STAGED: '1' };
  const envDisk = { ...process.env };
  delete envDisk.CURIA_STAGED; // 自证可能从 pre-commit 里跑（CURIA_STAGED=1 透传），对照必须显式关掉
  const staged = spawnSync(process.execPath, [join(root, 'scripts', 'check-tools.mjs')], { cwd: root, encoding: 'utf8', env: envStaged });
  const stagedOut = `${staged.stdout ?? ''}${staged.stderr ?? ''}`;
  expectTrue('暂存：check-tools 按索引拦下坏脚本', staged.status !== 0 && /node --check 失败/.test(stagedOut), stagedOut.slice(0, 300));
  const disk = spawnSync(process.execPath, [join(root, 'scripts', 'check-tools.mjs')], { cwd: root, encoding: 'utf8', env: envDisk });
  expectTrue('暂存：check-tools 盘面模式放行（对照）', disk.status === 0, `${disk.stdout ?? ''}${disk.stderr ?? ''}`.slice(0, 300));
  rmSync(join(root, '.agents', '.rule-hits.jsonl'), { force: true }); // CLI 会写命中台账，别带进后续夹具
  reset([rel]);
}

/* ------------- 暂存模式第二轮：发现面、封印、链接目标与注册表全部对齐「将要提交的树」 */

// a) git rm --cached 把文档从索引删掉（盘面还在）：staged 按索引拦「永不删除」，交互模式按盘面同名文件放行
{
  const rel = '.agents/plans/2026-01-01-rm-cached.md';
  write(rel, PLAN_OK);
  sync();
  git('rm', '--cached', '-q', rel);
  const staged = runTypes(root, { today: TODAY, staged: true });
  expectTrue('暂存：git rm --cached 删文档被「永不删除」拦下（索引里是 D，盘面骗不过）', !staged.ok && staged.errors.some((e) => /永不删除/.test(e) && e.includes(rel)), JSON.stringify(staged.errors.slice(0, 3)));
  const disk = runTypes(root, { today: TODAY });
  expectTrue('暂存：同场景交互模式不拦（对照：盘面同名文件仍在）', disk.ok, JSON.stringify(disk.errors.slice(0, 3)));
  reset([rel]);
}

// a2) 同名迁移不算删除：staged 的存活判定按索引路径集，不误报
{
  const from = '.agents/plans/2026-01-01-moved.md';
  const to = '.agents/research/2026-01-01-moved.md';
  write(from, PLAN_OK);
  sync();
  rmSync(join(root, from), { force: true });
  write(to, SURVEY_OK);
  git('add', '-A');
  const staged = runTypes(root, { today: TODAY, staged: true });
  expectTrue('暂存：同名文档迁到别处（索引里同名仍存活）不算静默删除', staged.ok, JSON.stringify(staged.errors.slice(0, 3)));
  reset([from, to]);
}

// b) 归档区被删光但 manifest 有键：两种模式都逐键报幽灵（曾因 entries 空提前 return 整体绕过封印）
{
  const rel = '.agents/archive/2026-01-01-wiped.md';
  const relM = '.agents/archive/manifest.json';
  const text = `# 旧文档\n\nType: plan\nStatus: done\nUpdated: ${TODAY}\nArchived: ${TODAY}\n\n正文。\n`;
  write(rel, text);
  write(relM, manifestOf({ 'archive/2026-01-01-wiped.md': sealOf(text) }));
  sync();
  rmSync(join(root, rel), { force: true });
  git('add', '-A');
  const staged = runTypes(root, { today: TODAY, staged: true });
  expectTrue('暂存：归档被删光、manifest 有键——staged 逐键报幽灵', !staged.ok && staged.errors.some((e) => /\[seal\/ghost\]/.test(e) && e.includes('archive/2026-01-01-wiped.md')), JSON.stringify(staged.errors.slice(0, 3)));
  const disk = runTypes(root, { today: TODAY });
  expectTrue('暂存：同场景交互模式也逐键报幽灵（空集不再整体绕过）', !disk.ok && disk.errors.some((e) => /\[seal\/ghost\]/.test(e)), JSON.stringify(disk.errors.slice(0, 3)));
  reset([rel, relM]);
}

// b2) 归档区连 manifest 一起删（rm --cached 或盘面删光）：封印只增不改，基线键逐条报 append-only
{
  const rel = '.agents/archive/2026-01-01-vanished.md';
  const relM = '.agents/archive/manifest.json';
  const text = `# 旧文档\n\nType: plan\nStatus: done\nUpdated: ${TODAY}\nArchived: ${TODAY}\n\n正文。\n`;
  write(rel, text);
  write(relM, manifestOf({ 'archive/2026-01-01-vanished.md': sealOf(text) }));
  sync();
  execFileSync('git', ['rm', '-q', '--cached', rel, relM], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
  const staged = runTypes(root, { today: TODAY, staged: true });
  expectTrue('暂存：归档连 manifest 一起 rm --cached——append-only 逐键报错', !staged.ok && staged.errors.some((e) => /\[seal\/append-only\]/.test(e) && e.includes('archive/2026-01-01-vanished.md')), JSON.stringify(staged.errors.slice(0, 3)));
  rmSync(join(root, rel), { force: true });
  rmSync(join(root, relM), { force: true });
  git('add', '-A');
  const disk = runTypes(root, { today: TODAY });
  expectTrue('封印：盘面删光归档与 manifest——append-only 逐键报错（manifest 消失不是空归档区）', !disk.ok && disk.errors.some((e) => /\[seal\/append-only\]/.test(e) && e.includes('archive/2026-01-01-vanished.md')), JSON.stringify(disk.errors.slice(0, 3)));
  reset([rel, relM]);
}

// d3) 笔记静默删除：implemented/proposed 归「永不删除」管；rejected 允许清理（notes 自己的规格）
{
  const rel = '.agents/notes/implemented/process/2026-01-01-del-note.md';
  const rej = '.agents/notes/rejected/process/2026-01-01-del-rejected.md';
  write(rel, NOTE_OK);
  write(rej, '# Agent Note: 样例否决\n\nStatus: rejected — 不再成立\n\n## Problem\n\n动机。\n\n## Alternatives considered\n\n**甲**：落选。\n');
  sync();
  execFileSync('git', ['rm', '-q', '--cached', rel, rej], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
  const staged = runTypes(root, { today: TODAY, staged: true });
  expectTrue('暂存：rm --cached implemented 笔记被「永不删除」拦下', !staged.ok && staged.errors.some((e) => /永不删除/.test(e) && e.includes(rel)), JSON.stringify(staged.errors.slice(0, 3)));
  expectTrue('暂存：rejected 笔记允许清理，不受「永不删除」管', !staged.errors.some((e) => e.includes(rej)), JSON.stringify(staged.errors.filter((e) => e.includes(rej))));
  rmSync(join(root, rel), { force: true });
  rmSync(join(root, rej), { force: true });
  git('add', '-A');
  const disk = runTypes(root, { today: TODAY });
  expectTrue('封印：盘面删除 implemented 笔记同样被「永不删除」拦下', !disk.ok && disk.errors.some((e) => /永不删除/.test(e) && e.includes(rel)), JSON.stringify(disk.errors.slice(0, 3)));
  reset([rel, rej]);
}
{
  const docRel = '.agents/research/2026-01-01-index-only-doc.md';
  const noteRel = '.agents/notes/implemented/process/2026-01-01-index-only-note.md';
  write(docRel, SURVEY_OK.replace('Status: current', 'Status: done'));
  write(noteRel, NOTE_OK.replace('Status: implemented', 'Status: proposed'));
  git('add', '-A');
  rmSync(join(root, docRel), { force: true });
  rmSync(join(root, noteRel), { force: true });
  const stagedDoc = runTypes(root, { today: TODAY, staged: true });
  expectTrue('暂存：坏文档已入索引、盘面已删——按索引发现并拦下', !stagedDoc.ok && stagedDoc.errors.some((e) => /不是类型 survey 的合法状态/.test(e)), JSON.stringify(stagedDoc.errors.slice(0, 3)));
  const stagedNote = runNotesTree(join(root, '.agents', 'notes'), { staged: true });
  expectTrue('暂存：坏笔记已入索引、盘面已删——按索引发现并拦下', !stagedNote.ok && stagedNote.errors.some((e) => /与所在 implemented\/ 目录一致/.test(e)), JSON.stringify(stagedNote.errors.slice(0, 3)));
  const disk = runTypes(root, { today: TODAY });
  expectTrue('暂存：同场景交互模式看不见索引里的坏版（对照）', disk.ok, JSON.stringify(disk.errors.slice(0, 3)));
  const diskNote = runNotesTree(join(root, '.agents', 'notes'), {});
  expectTrue('暂存：同场景笔记交互模式看不见（对照）', diskNote.ok, JSON.stringify(diskNote.errors.slice(0, 3)));

  // 盘面换成符号链接同样改不了索引里的形态：索引 mode 100644、内容仍是坏版
  write(docRel, SURVEY_OK.replace('Status: current', 'Status: done'));
  git('add', '-A');
  rmSync(join(root, docRel), { force: true });
  symlinkSync('../../AGENTS.md', join(root, docRel));
  const symlinked = runTypes(root, { today: TODAY, staged: true });
  expectTrue('暂存：盘面换成符号链接也不影响索引发现（形态按 mode 判）', !symlinked.ok && symlinked.errors.some((e) => /不是类型 survey 的合法状态/.test(e)), JSON.stringify(symlinked.errors.slice(0, 3)));
  reset([docRel, noteRel]);
}

// d) 坏注册表已入索引、盘面改好：staged 全部校验改用索引版注册表（旧规则校验新文档的洞）
{
  const rel = '.agents/doc-types.json';
  const good = readFileSync(join(root, rel), 'utf8');
  write(rel, `${JSON.stringify({ ...REG, noteTree: undefined }, null, 2)}\n`);
  git('add', '-A');
  write(rel, good);
  const staged = runTypes(root, { today: TODAY, staged: true });
  expectTrue('暂存：坏注册表（去 noteTree）按索引拦下', !staged.ok && staged.errors.some((e) => /缺少顶层字段 `noteTree`/.test(e)), JSON.stringify(staged.errors.slice(0, 3)));
  const disk = runTypes(root, { today: TODAY });
  expectTrue('暂存：盘面注册表已改好则放行（对照）', disk.ok, JSON.stringify(disk.errors.slice(0, 3)));
  reset([rel]);
}

// d2) 坏投影已入索引、盘面改好：projection-fresh 按索引版比对，盘面好版洗不白
{
  const rel = '.agents/doc-types.md';
  const good = readFileSync(join(root, rel), 'utf8');
  write(rel, `${good}手改一行。\n`);
  git('add', '-A');
  write(rel, good);
  const staged = runTypes(root, { today: TODAY, staged: true });
  expectTrue('暂存：坏投影按索引拦下（与索引版注册表比对）', !staged.ok && staged.errors.some((e) => /与注册表不一致/.test(e)), JSON.stringify(staged.errors.slice(0, 3)));
  const disk = runTypes(root, { today: TODAY });
  expectTrue('暂存：盘面投影已改好则放行（对照）', disk.ok, JSON.stringify(disk.errors.slice(0, 3)));
  reset([rel]);
}

// e) 链接目标按索引判：rm --cached 目标后提交树断链要拦，目标在索引、盘面删了不误拦
{
  const src = '.agents/research/2026-01-01-index-link-src.md';
  const tgt = '.agents/research/2026-01-01-index-link-tgt.md';
  write(src, `# 引用方\n\n见[目标](./2026-01-01-index-link-tgt.md)。\n`);
  write(tgt, SURVEY_OK);
  sync();
  git('rm', '--cached', '-q', tgt);
  const staged = runLinks(root, { staged: true });
  expectTrue('暂存：目标被 rm --cached 后引用文档按索引拦下（提示一起 add）', !staged.ok && staged.errors.some((e) => /相对链接目标不存在/.test(e) && /目标未入库/.test(e)), JSON.stringify(staged.errors.slice(0, 3)));
  const disk = runLinks(root, {});
  expectTrue('暂存：同场景交互模式不误拦（盘面目标仍在，对照）', disk.ok, JSON.stringify(disk.errors.slice(0, 3)));
  reset([src, tgt]);
}

{
  const src = '.agents/research/2026-01-01-disk-deleted-src.md';
  const tgt = '.agents/research/2026-01-01-disk-deleted-tgt.md';
  write(src, `# 引用方\n\n见[目标](./2026-01-01-disk-deleted-tgt.md)。\n`);
  write(tgt, SURVEY_OK);
  sync();
  rmSync(join(root, tgt), { force: true }); // 盘面删了、删除未暂存：提交树里目标还在
  const staged = runLinks(root, { staged: true });
  expectTrue('暂存：目标在索引、盘面已删——不按盘面误拦合法提交', staged.ok, JSON.stringify(staged.errors.slice(0, 3)));
  reset([src, tgt]);
}

// f) 三个只读 CLI 也要执行索引版：暂存一个语法合法但退出 3 的 doc-query，staged 必须拦下（旧实现跑的是盘面好版）
{
  const rel = 'scripts/doc-query.mjs';
  const good = readFileSync(join(root, rel), 'utf8');
  write(rel, 'process.exit(3);\n');
  git('add', '-A');
  write(rel, good);
  const envStaged = { ...process.env, CURIA_STAGED: '1' };
  const envDisk = { ...process.env };
  delete envDisk.CURIA_STAGED; // 自证可能从 pre-commit 里跑（CURIA_STAGED=1 透传），对照必须显式关掉
  const staged = spawnSync(process.execPath, [join(root, 'scripts', 'check-tools.mjs')], { cwd: root, encoding: 'utf8', env: envStaged });
  const stagedOut = `${staged.stdout ?? ''}${staged.stderr ?? ''}`;
  expectTrue('暂存：只读 CLI 执行索引版（退出 3 的索引版必须被拦）', staged.status !== 0 && /退出码 3/.test(stagedOut) && /doc-query/.test(stagedOut), stagedOut.slice(0, 300));
  const disk = spawnSync(process.execPath, [join(root, 'scripts', 'check-tools.mjs')], { cwd: root, encoding: 'utf8', env: envDisk });
  expectTrue('暂存：盘面模式仍执行盘面好版并放行（对照）', disk.status === 0, `${disk.stdout ?? ''}${disk.stderr ?? ''}`.slice(0, 300));
  rmSync(join(root, '.agents', '.rule-hits.jsonl'), { force: true }); // CLI 会写命中台账，别带进后续夹具
  reset([rel]);
}

/* ----------------------------------------------- fix-doc 修复器（纯函数） */

{
  const sample = '# 样例\n\n这是中文English混排, 标点(也)错。尾随空格   \n\n\n`code不修 span`\n见[文本](../README.md)与 https://example.com/a,b\n正文。\n';
  const { text, applied } = fixText(sample);
  expectTrue('fix-doc：中英空格与全角标点修复', text.includes('这是中文 English 混排，标点（也）错。'), text);
  expectTrue('fix-doc：全角标点后的半角空格被吞掉', !text.includes('， '), text);
  expectTrue('fix-doc：行内代码原样保留', text.includes('`code不修 span`'), text);
  expectTrue('fix-doc：URL 与链接目标原样保留', text.includes('https://example.com/a,b') && text.includes('](../README.md)'), text);
  expectTrue('fix-doc：连续空行压成一个', !text.includes('。\n\n\n'), text);
  expectTrue('fix-doc：行尾空白清除', !/ +\n/.test(text), text);
  expectTrue('fix-doc：报出的规则 ID 与修复行为对得上', applied.has('prose/cjk-space') && applied.has('prose/halfwidth-punct') && applied.has('layout/consecutive-blank') && applied.has('layout/trailing-whitespace'), [...applied.keys()].join(' '));
  // 方向性回归：`_Avoid_:` 这类机器可读字段不能被转全角（转了就断解析），而「中文紧邻半角标点」仍要修好
  const avoidSample = '**样例（sample）**：定义。_Avoid_: 中文\n';
  expectTrue('fix-doc：`_Avoid_: 中文` 原样保留（不转全角、不吞空格）', fixText(avoidSample).text === avoidSample, JSON.stringify(fixText(avoidSample).text));
  expectTrue('fix-doc：`中文, 也` 仍被修成 `中文，也`（吞掉标点后一个空格）', fixText('这是中文, 也一样。\n').text === '这是中文，也一样。\n', JSON.stringify(fixText('这是中文, 也一样。\n').text));
  const fenceSample = `# 样例\n\n${FENCE}text\n保留尾随空格   \n中文English不动\n${FENCE}\n`;
  const r2 = fixText(fenceSample);
  expectTrue('fix-doc：栅栏内是数据，一格不改', r2.text === fenceSample, JSON.stringify(r2.text));
  expectTrue('fix-doc：结尾缺换行会补', fixText('正文').text === '正文\n', JSON.stringify(fixText('正文').text));
  // 嵌套保护：占位符不能被后续保护趟吞并（审计发现的真缺陷——多趟 replace 会把 URL 换成 NUL 落盘）
  const nested = `中a 见[x](https://example.com/a,b)与 [t](${'`'}code${'`'})及 <a href="https://e.com/a">标签</a>文b字\n`;
  const r3 = fixText(nested);
  expectTrue('fix-doc：链接目标内的 URL 原样保留', r3.text.includes('](https://example.com/a,b)'), JSON.stringify(r3.text));
  expectTrue('fix-doc：链接目标内的行内代码原样保留', r3.text.includes(`](${'`'}code${'`'})`), JSON.stringify(r3.text));
  expectTrue('fix-doc：HTML 标签内的 URL 原样保留', r3.text.includes('https://e.com/a'), JSON.stringify(r3.text));
  expectTrue('fix-doc：输出不含占位符残留', !r3.text.includes(String.fromCharCode(0)), JSON.stringify(r3.text));
  expectTrue('fix-doc：同行的机械错误仍被修复', r3.text.includes('中 a') && r3.text.includes('文 b 字'), JSON.stringify(r3.text));
  expectTrue('fix-doc：幂等（第二遍零改动）', fixText(r3.text).text === r3.text, JSON.stringify(fixText(r3.text).text));
}

// fix-doc CLI：--root 指向临时目录（自证与排障用），归档冻结区拒绝、dry-run 不落盘、--write 落盘一次
{
  const fixRoot = mkdtempSync(join(tmpdir(), 'curia-fixdoc-'));
  try {
    mkdirSync(join(fixRoot, '.agents', 'research'), { recursive: true });
    cpSync(join(SRC_ROOT, '.agents', 'doc-types.json'), join(fixRoot, '.agents', 'doc-types.json'));
    const rel = '.agents/research/2026-01-01-fix-me.md';
    const bad = '# 样例\n\n这是中文English混排, 标点(也)错。尾随空格   \n';
    writeFileSync(join(fixRoot, rel), bad);
    const cli = (extra) => spawnSync(process.execPath, [join(SRC_ROOT, 'scripts', 'fix-doc.mjs'), ...extra, '--root', fixRoot, rel], { encoding: 'utf8' });
    const frozen = spawnSync(process.execPath, [join(SRC_ROOT, 'scripts', 'fix-doc.mjs'), '--root', fixRoot, '.agents/archive/2026-01-01-old.md'], { encoding: 'utf8' });
    const frozenOut = `${frozen.stdout ?? ''}${frozen.stderr ?? ''}`;
    expectTrue('fix-doc：--root 下归档冻结区被拒绝（退出非 0）', frozen.status !== 0 && /归档冻结区不可修改/.test(frozenOut), frozenOut.slice(0, 200));
    const dry = cli([]);
    expectTrue('fix-doc：dry-run 只报告不落盘', dry.status === 0 && readFileSync(join(fixRoot, rel), 'utf8') === bad && /将修复/.test(dry.stdout ?? ''), dry.stdout ?? '');
    const wr = cli(['--write']);
    const fixed = readFileSync(join(fixRoot, rel), 'utf8');
    expectTrue('fix-doc：--write 正常落盘一次', wr.status === 0 && fixed.includes('这是中文 English 混排，标点（也）错。尾随空格') && !/ +\n/.test(fixed), JSON.stringify(fixed));
    const again = cli([]);
    expectTrue('fix-doc：修复后重跑报无机械问题（幂等）', again.status === 0 && /无机械问题/.test(again.stdout ?? ''), again.stdout ?? '');
  } finally {
    rmSync(fixRoot, { recursive: true, force: true });
  }
}

/* ------------------------------------------- doc-lib 单元：today 与命中台账 */

{
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const localDate = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  expectTrue('today() 取本地时区日期（与 UTC 日期解耦）', today() === localDate, `today()=${today()} 本地=${localDate} UTC=${d.toISOString().slice(0, 10)}`);
  expectTrue('today() 形态为 yyyy-mm-dd', /^\d{4}-\d{2}-\d{2}$/.test(today()), today());
  // 本进程此刻的本地日期可能恰好与 UTC 日期相同，测不出差异；挑一个「本地日期必定 ≠ UTC 日期」的
  // 极端时区（UTC<12 时用 UTC-12，否则用 UTC+14）跑子进程补一刀——UTC 版实现到这里必红。
  const tz = d.getUTCHours() < 12 ? 'Etc/GMT+12' : 'Pacific/Kiritimati';
  const probeCode = [
    `import(${JSON.stringify(pathToFileURL(join(root, 'scripts', 'doc-lib.mjs')).href)}).then(({ today }) => {`,
    '  const d = new Date();',
    "  const p = (n) => String(n).padStart(2, '0');",
    "  const local = [d.getFullYear(), p(d.getMonth() + 1), p(d.getDate())].join('-');",
    "  console.log(JSON.stringify({ today: today(), local, utc: d.toISOString().slice(0, 10) }));",
    '});',
  ].join('\n');
  const probe = spawnSync(process.execPath, ['-e', probeCode], { encoding: 'utf8', env: { ...process.env, TZ: tz } });
  let rec = null;
  try { rec = JSON.parse((probe.stdout ?? '').trim()); } catch { /* 子进程没输出，按断言失败处理 */ }
  expectTrue(`today() 跟随进程时区（${tz} 下本地日期与 UTC 日期分道）`, rec !== null && rec.today === rec.local && rec.today !== rec.utc, `探测输出：${(probe.stdout ?? '').trim() || (probe.stderr ?? '').slice(0, 200)}`);
}

// ROOT 覆盖契约：暂存模式把守卫物化到临时目录执行，CURIA_ROOT 必须让 ROOT 指回真仓
{
  const overrideRoot = mkdtempSync(join(tmpdir(), 'curia-root-override-'));
  try {
    const probeCode = [
      `import(${JSON.stringify(pathToFileURL(join(root, 'scripts', 'doc-lib.mjs')).href)}).then(({ ROOT }) => {`,
      '  console.log(JSON.stringify({ root: ROOT }));',
      '});',
    ].join('\n');
    const probe = spawnSync(process.execPath, ['-e', probeCode], { encoding: 'utf8', env: { ...process.env, CURIA_ROOT: overrideRoot } });
    let rec = null;
    try { rec = JSON.parse((probe.stdout ?? '').trim()); } catch { /* 子进程没输出，按断言失败处理 */ }
    expectTrue('ROOT 覆盖：CURIA_ROOT 生效（暂存模式物化执行时指回真仓的契约）', rec !== null && rec.root === resolve(overrideRoot), `探测输出：${(probe.stdout ?? '').trim() || (probe.stderr ?? '').slice(0, 200)}`);
  } finally {
    rmSync(overrideRoot, { recursive: true, force: true });
  }
}

{
  const hitsRoot = mkdtempSync(join(tmpdir(), 'curia-rulehits-'));
  try {
    mkdirSync(join(hitsRoot, '.agents'), { recursive: true });
    const ledgerPath = join(hitsRoot, '.agents', '.rule-hits.jsonl');
    const linesOf = () => (existsSync(ledgerPath) ? readFileSync(ledgerPath, 'utf8').trim().split('\n').filter(Boolean) : []);
    // 旧调用点姿态：合并数组进 errors 位（第二参数缺省的过渡期兼容——仍按旧行为入账，不崩）
    logRuleHits(hitsRoot, ['头块: 样例 — 缺少必填字段 [types/field-required-missing]', '没有规则 ID 的行']);
    const first = linesOf()[0] ? JSON.parse(linesOf()[0]) : null;
    expectTrue('logRuleHits：命中行的规则 ID 追加进 .agents/.rule-hits.jsonl', first !== null && Array.isArray(first.ids) && first.ids.length === 1 && first.ids[0] === 'types/field-required-missing', JSON.stringify(first));
    // 新口径：errors 落账、warnings 不落账（命中 = 拦截）
    logRuleHits(hitsRoot, ['结构: 样例 — 另一个问题 [notes/status-line]'], ['告警: 样例 [types/soft-warn]']);
    const mixed = linesOf()[1] ? JSON.parse(linesOf()[1]) : null;
    expectTrue('logRuleHits：errors+warnings 分传时只记 error 的规则 ID', mixed !== null && mixed.ids.length === 1 && mixed.ids[0] === 'notes/status-line', JSON.stringify(mixed));
    const before = linesOf().length;
    logRuleHits(hitsRoot, [], ['纯告警: 样例 [types/warn-only]']);
    expectTrue('logRuleHits：warning-only 输入不落账', linesOf().length === before, JSON.stringify(linesOf().slice(-1)));
    logRuleHits(hitsRoot, ['还是没有规则 ID 的行']);
    logRuleHits(hitsRoot, ['门禁: check-migrations 有 1 条输出未挂规则 ID [meta/missing-rule-id]']);
    const lines = linesOf();
    expectTrue('logRuleHits：台账 append-only，无 ID 的行不落账', lines.length === 3 && lines[1].includes('notes/status-line'), lines.join(' | '));
    expectTrue('logRuleHits：meta/missing-rule-id 在 errors 内、保留入账', lines.length === 3 && lines[2].includes('meta/missing-rule-id'), lines.join(' | '));
  } finally {
    rmSync(hitsRoot, { recursive: true, force: true });
  }
}

/* ----------------- 守卫接线：物化树 + CURIA_ROOT（暂存模式两道新守卫不再静默跳过） */

/**
 * pre-commit 暂存模式把 scripts/ 物化到 /tmp 执行、只设 CURIA_ROOT 指回真仓：
 * 两道新守卫必须认这个变量，否则在物化树里找不到 apps/backend/migrations 与 deploy/db-ledger、静默跳过。
 * 夹具模拟该姿态：脚本副本放在独立临时目录（无 apps/ 与 deploy/），业务仓另置并设 CURIA_ROOT——
 * 带与不带各跑一组，差别只在覆盖变量；坏迁移（seq 断档）与坏台账条目（applied 缺证据指针）都要被挂规则 ID 拦下。
 */
{
  const wireRepo = mkdtempSync(join(tmpdir(), 'curia-wire-repo-'));
  const wireTmp = mkdtempSync(join(tmpdir(), 'curia-wire-scripts-'));
  try {
    // 业务仓：坏迁移两件（0001 与 0003 跳号）、坏台账条目一件、命中台账落点
    mkdirSync(join(wireRepo, 'apps', 'backend', 'migrations'), { recursive: true });
    writeFileSync(join(wireRepo, 'apps', 'backend', 'migrations', '0001_a.sql'), '-- migration: 0001\n-- summary: 首件\nSELECT 1;\n');
    writeFileSync(join(wireRepo, 'apps', 'backend', 'migrations', '0003_c.sql'), '-- migration: 0003\n-- summary: 跳号件\nSELECT 1;\n');
    mkdirSync(join(wireRepo, 'deploy', 'db-ledger', 'envs'), { recursive: true });
    writeFileSync(join(wireRepo, 'deploy', 'db-ledger', 'README.md'), '# 台账\n');
    writeFileSync(join(wireRepo, 'deploy', 'db-ledger', 'envs', 'prod.json'), `${JSON.stringify({
      env_tag: 'prod',
      db_version: '0.0.0.2',
      entries: [{ seq: 1, version: '0.0.0.1', file: '0001_a.sql', checksum: 'sha256:x', status: 'applied' }],
    }, null, 2)}\n`);
    mkdirSync(join(wireRepo, '.agents'), { recursive: true });

    cpSync(join(SRC_ROOT, 'scripts'), join(wireTmp, 'scripts'), { recursive: true });
    const envWired = { ...process.env, CURIA_ROOT: wireRepo };
    const envBlind = { ...process.env };
    delete envWired.CURIA_STAGED;
    delete envBlind.CURIA_ROOT;
    delete envBlind.CURIA_STAGED; // 自证可能从 pre-commit 透传暂存开关；本夹具只关心 ROOT 覆盖
    const spawnGuard = (name, env) => {
      const r = spawnSync(process.execPath, [join(wireTmp, 'scripts', name)], { cwd: wireRepo, encoding: 'utf8', env });
      return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
    };

    const migWired = spawnGuard('check-migrations.mjs', envWired);
    expectTrue('接线：check-migrations 认 CURIA_ROOT——坏迁移（seq 断档）在物化树下被拦下', migWired.code !== 0 && /\[migrations\/seq\]/.test(migWired.out), migWired.out.slice(0, 300));
    const ledgerWired = spawnGuard('check-db-ledger.mjs', envWired);
    expectTrue('接线：check-db-ledger 认 CURIA_ROOT——坏台账条目（缺证据指针）被拦下', ledgerWired.code !== 0 && /\[ledger\/evidence\]/.test(ledgerWired.out), ledgerWired.out.slice(0, 300));
    const hitRaw = existsSync(join(wireRepo, '.agents', '.rule-hits.jsonl')) ? readFileSync(join(wireRepo, '.agents', '.rule-hits.jsonl'), 'utf8') : '';
    expectTrue('接线：命中按 CURIA_ROOT 落进业务仓台账（error 级）', /migrations\/seq/.test(hitRaw) && /ledger\/evidence/.test(hitRaw), JSON.stringify(hitRaw.slice(0, 240)));

    const migBlind = spawnGuard('check-migrations.mjs', envBlind);
    expectTrue('接线：不带 CURIA_ROOT 时物化树里静默跳过（对照组，差别只在覆盖变量）', migBlind.code === 0 && /跳过/.test(migBlind.out), migBlind.out.slice(0, 300));
    const ledgerBlind = spawnGuard('check-db-ledger.mjs', envBlind);
    expectTrue('接线：check-db-ledger 不带 CURIA_ROOT 同样静默跳过（对照）', ledgerBlind.code === 0 && /跳过/.test(ledgerBlind.out), ledgerBlind.out.slice(0, 300));
    expectTrue('接线：对照组跳过不落账（物化树里无台账）', !existsSync(join(wireTmp, '.agents', '.rule-hits.jsonl')), '物化树里不该出现 .rule-hits.jsonl');
  } finally {
    rmSync(wireRepo, { recursive: true, force: true });
    rmSync(wireTmp, { recursive: true, force: true });
  }
}

/* ---------------- 迁移/台账守卫的暂存内容校验：add 坏版、盘面改好也要拦（红队洞的回归夹具） */

{
  const t = mkdtempSync(join(tmpdir(), 'curia-migsplit-'));
  const runStaged = (name) => {
    const r = spawnSync(process.execPath, [join(HERE, name)], { cwd: t, encoding: 'utf8', env: { ...process.env, CURIA_ROOT: t, CURIA_STAGED: '1' } });
    return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
  };
  const commit = (m) => {
    execFileSync('git', ['add', '-A'], { cwd: t, stdio: ['pipe', 'pipe', 'pipe'] });
    execFileSync('git', ['-c', 'user.email=selftest@local', '-c', 'user.name=selftest', 'commit', '-q', '-m', m], { cwd: t, stdio: ['pipe', 'pipe', 'pipe'] });
  };
  try {
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: t, stdio: ['pipe', 'pipe', 'pipe'] });
    mkdirSync(join(t, 'apps/backend/migrations'), { recursive: true });
    const sql = '-- migration: 0001\n-- summary: 初始化\nSELECT 1;\n';
    writeFileSync(join(t, 'apps/backend/migrations/0001_init.sql'), sql);
    const sha = `sha256:${createHash('sha256').update(sql, 'utf8').digest('hex')}`;
    const manOf = (s) => `${JSON.stringify({ files: [{ seq: 1, name: '0001_init.sql', sha256: s }] }, null, 2)}\n`;

    writeFileSync(join(t, 'apps/backend/migrations/MANIFEST.json'), manOf('sha256:deadbeef'));
    commit('base');
    writeFileSync(join(t, 'apps/backend/migrations/MANIFEST.json'), manOf(sha)); // 只改盘面不 add
    const a = runStaged('check-migrations.mjs');
    expectTrue('暂存：坏 MANIFEST（校验和错）已 add、盘面改好——迁移守卫按索引拦下', a.code !== 0 && /校验和不符/.test(a.out), a.out.slice(0, 300));
    commit('fix');

    execFileSync('git', ['rm', '-q', '--cached', 'apps/backend/migrations/0001_init.sql'], { cwd: t, stdio: ['pipe', 'pipe', 'pipe'] });
    const b = runStaged('check-migrations.mjs');
    expectTrue('暂存：rm --cached 删迁移（盘面保留）——MANIFEST 仍登记即报「不存在的文件」', b.code !== 0 && /登记了不存在的文件/.test(b.out), b.out.slice(0, 300));
    execFileSync('git', ['reset', '-q'], { cwd: t, stdio: ['pipe', 'pipe', 'pipe'] });

    mkdirSync(join(t, 'deploy/db-ledger/envs'), { recursive: true });
    mkdirSync(join(t, 'deploy/db-ledger/receipts'), { recursive: true });
    writeFileSync(join(t, 'deploy/db-ledger/README.md'), '# 台账\n');
    writeFileSync(join(t, 'deploy/db-ledger/receipts/r1.txt'), '回执\n');
    const badLedger = `${JSON.stringify({ env_tag: 'dev', db_version: '0.0.0.1', entries: [{ seq: 1, version: '0.0.0.1', file: '0001_init.sql', checksum: sha, status: 'applied' }] }, null, 2)}\n`;
    const goodLedger = badLedger.replace('"status": "applied"', '"receipt": "receipts/r1.txt", "status": "applied"');
    writeFileSync(join(t, 'deploy/db-ledger/envs/dev.json'), badLedger);
    commit('ledger-base');
    writeFileSync(join(t, 'deploy/db-ledger/envs/dev.json'), goodLedger); // 盘面补上证据指针，不 add
    const c = runStaged('check-db-ledger.mjs');
    expectTrue('暂存：坏台账条目（缺证据指针）已 add、盘面改好——台账守卫按索引拦下', c.code !== 0 && /缺证据指针/.test(c.out), c.out.slice(0, 300));
  } finally {
    rmSync(t, { recursive: true, force: true });
  }
}

/* ---------------- 布局封闭集：gitignored 的工具残留目录不要求登记（误拦回归夹具） */

{
  write('.gitignore', 'playjunk-toolresidue/\n');
  mkdirSync(join(root, 'playjunk-toolresidue'), { recursive: true });
  writeFileSync(join(root, 'playjunk-toolresidue', 'cache.bin'), 'x');
  const r = runTypes(root, { today: TODAY });
  expectTrue('布局：gitignored 的工具残留目录不要求登记 rootDirs', !r.errors.some((e) => /layout-root-dir/.test(e) && e.includes('playjunk-toolresidue')), JSON.stringify(r.errors.filter((e) => e.includes('playjunk-toolresidue'))));
  rmSync(join(root, 'playjunk-toolresidue'), { recursive: true, force: true });
  reset(['.gitignore']);
}

/* ------------------------ run-checks --audit：两档台账口径、分段与零命中并集判定（只读，不写盘） */

{
  const auditTmp = mkdtempSync(join(tmpdir(), 'curia-audit-'));
  try {
    cpSync(join(SRC_ROOT, 'scripts'), join(auditTmp, 'scripts'), { recursive: true });
    const envAudit = { ...process.env, CURIA_ROOT: auditTmp }; // 副本里没有 .agents/ 台账 = 空台账
    delete envAudit.CURIA_STAGED;
    const auditOut = () => {
      const r = spawnSync(process.execPath, [join(auditTmp, 'scripts', 'run-checks.mjs'), '--audit'], { cwd: auditTmp, encoding: 'utf8', env: envAudit });
      return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
    };

    const empty = auditOut();
    expectTrue('审计：--audit 输出台账口径行（命中 = 拦截，只记 error 级）', empty.status === 0 && empty.out.includes('口径：命中 = 拦截——只记 error 级；warning 只在门禁输出可见，不入账。'), empty.out.slice(0, 400));
    expectTrue('审计：台账不存在时输出空台账提示', empty.out.includes('（台账为空'), empty.out.slice(0, 400));
    expectTrue('审计：零命中清单按守卫源码规则全集列出', /零命中规则 \d+ 条/.test(empty.out), empty.out.slice(0, 400));

    // 造两档台账：新口径 error-only 档 + 历史 v1 混合口径档（两份，验证多份并合）。
    // 三个 ID 都是守卫源码里的真规则：零命中判定取两档并集，它们必须全部移出零命中清单。
    mkdirSync(join(auditTmp, '.agents'), { recursive: true });
    writeFileSync(join(auditTmp, '.agents', '.rule-hits.jsonl'), `${JSON.stringify({ ts: '2026-10-05T00:00:00Z', ids: ['types/field-required-missing'] })}\n`);
    writeFileSync(join(auditTmp, '.agents', '.rule-hits.v1-2026-10-01.jsonl'), `${JSON.stringify({ ts: '2026-10-01T00:00:00Z', ids: ['layout/trailing-whitespace'] })}\n`);
    writeFileSync(join(auditTmp, '.agents', '.rule-hits.v1-2026-10-02.jsonl'), `${JSON.stringify({ ts: '2026-10-02T00:00:00Z', ids: ['notes/status-line'] })}\n`);
    const hit = auditOut();
    const zeroAt = hit.out.indexOf('零命中规则');
    const zeroList = zeroAt === -1 ? '' : hit.out.slice(zeroAt);
    expectTrue('审计：两档分段标题齐全，历史窗口列出实际并入的两份 v1 档',
      hit.out.includes('【新口径 · error-only】') && hit.out.includes('【历史窗口 · 含 warning 重复记账】') && hit.out.includes('.rule-hits.v1-2026-10-01.jsonl') && hit.out.includes('.rule-hits.v1-2026-10-02.jsonl'),
      hit.out.slice(0, 500));
    expectTrue('审计：两档命中各自出现在对应分段',
      hit.out.includes('[types/field-required-missing]') && hit.out.includes('[layout/trailing-whitespace]') && hit.out.includes('[notes/status-line]'),
      hit.out.slice(0, 700));
    expectTrue('审计：零命中清单不含任一档命中过的 ID（并集判定，历史命中同被剔除）',
      zeroAt !== -1 && !zeroList.includes('[types/field-required-missing]') && !zeroList.includes('[layout/trailing-whitespace]') && !zeroList.includes('[notes/status-line]'),
      zeroList.slice(0, 300));
    const universeN = /登记规则 (\d+) 条/.exec(hit.out);
    const zeroN = /零命中规则 (\d+) 条/.exec(hit.out);
    expectTrue('审计：零命中数 = 规则全集 − 两档并集命中数',
      universeN !== null && zeroN !== null && Number(zeroN[1]) === Number(universeN[1]) - 3,
      `全集 ${universeN?.[1] ?? '—'} 条，零命中 ${zeroN?.[1] ?? '—'} 条`);
  } finally {
    rmSync(auditTmp, { recursive: true, force: true });
  }
}

/* ------------------- make-template：抽取器幂等（同源必得同字节；抽取器不进模板载荷） */

// 规格验收 4：生成脚本连跑两遍产物逐字节一致。抽取器只留在参考实现（规格「脚本留在 Curia」），
// 模板载荷里没有它——在模板仓跑自证时本组整体跳过，Curia 本仓必须行使。
if (existsSync(join(SRC_ROOT, 'scripts', 'make-template.mjs'))) {
  // 清洗规则夹具直接 import 纯函数断言（不经全量生成）；动态 import 让模板仓（载荷里没有抽取器）
  // 整体跳过本组，Curia 本仓必须行使。import 本模块不触发顶层执行——否则自证会死在用法错误上。
  const mt = await import(pathToFileURL(join(SRC_ROOT, 'scripts', 'make-template.mjs')).href);
  const { brandRename, cleanGitignore, cleanRegistry, degradeLinks, runMakeTemplate } = mt;

  expectTrue('make-template 导出面：清洗纯函数与 runMakeTemplate 均为具名导出',
    [brandRename, degradeLinks, cleanGitignore, cleanRegistry, runMakeTemplate].every((f) => typeof f === 'function'),
    Object.keys(mt).join(' '));

  // 入口契约：runMakeTemplate 返回退出码而不是 process.exit——自证 import 后仍能安全调用
  {
    const savedConsoleError = console.error;
    let usageCode = null;
    let usageErr = '';
    console.error = (...a) => { usageErr += `${a.join(' ')}\n`; };
    try {
      usageCode = runMakeTemplate(['--bogus']);
    } finally {
      console.error = savedConsoleError;
    }
    expectTrue('make-template 入口：runMakeTemplate 对用法错误返回 1（不杀进程）', usageCode === 1 && /用法/.test(usageErr), `code=${usageCode} err=${usageErr.slice(0, 120)}`);
  }

  /* 清洗规则 1：品牌词（Curia 家族）→ Curia；标识符保留形态（环境变量 / hook 名 / 临时前缀） */
  const brandIn = 'Curia 参考实现：CURIA_STAGED、CURIA_ROOT、curia-hook、curiad、curia-cli、CURIA、Curia、Curia';
  const brandOut = 'Curia 参考实现：CURIA_STAGED、CURIA_ROOT、curia-hook、curiad、curia-cli、CURIA、Curia、Curia';
  expectTrue('make-template 清洗：品牌词 Curia 家族逐一改写（标识符保形态、正文转 Curia）', brandRename(brandIn) === brandOut, brandRename(brandIn));
  expectTrue('make-template 清洗：产物不再残留 Curia 家族字样（含大小写变体）', !/Curia/i.test(brandRename(brandIn)), brandRename(brandIn));

  /* 清洗规则 2：指向载荷外文件的相对链接降级为纯文本（保留链接文字）；载荷内与 scheme/锚点保留 */
  const linkSet = new Set(['AGENTS.md', '.agents', '.agents/skills', '.agents/skills/write-doc', '.agents/skills/write-doc/SKILL.md']);
  const linksIn = '见[技能](.agents/skills/write-doc/SKILL.md)、[技能目录](.agents/skills/write-doc/)、[断链](./nope.md)与[外链](https://example.com/a)、[锚点](#节)。\n';
  const linksOut = '见[技能](.agents/skills/write-doc/SKILL.md)、[技能目录](.agents/skills/write-doc/)、断链与[外链](https://example.com/a)、[锚点](#节)。\n';
  expectTrue('make-template 清洗：载荷外相对链接降级为纯文本，载荷内（含目录目标）保留', degradeLinks('AGENTS.md', linksIn, linkSet) === linksOut, JSON.stringify(degradeLinks('AGENTS.md', linksIn, linkSet)));
  const fenceOnly = '```markdown\n[断链](./nope.md)\n```\n';
  expectTrue('make-template 清洗：栅栏代码里的链接不降级（是数据不是链接）', degradeLinks('AGENTS.md', fenceOnly, linkSet) === fenceOnly, JSON.stringify(degradeLinks('AGENTS.md', fenceOnly, linkSet)));
  const quoteLine = '> [断链](./nope.md)\n';
  expectTrue('make-template 清洗：引用块行整行跳过', degradeLinks('AGENTS.md', quoteLine, linkSet) === quoteLine, JSON.stringify(degradeLinks('AGENTS.md', quoteLine, linkSet)));

  /* 清洗规则 3：gitignore 通用段保留、项目条目改注释示例（注释跟随条目、品牌词同清洗） */
  const giIn = '# 通用段\n.DS_Store\nnode_modules/\n\n# 项目条目\ncuria-build/\ndeploy-secrets/\n.env\n';
  const giOut = '# 通用段\n.DS_Store\nnode_modules/\n\n# 项目条目示例（参考实现用过；按你的仓库增删，取消注释即生效）\n# 项目条目\n# curia-build/\n# deploy-secrets/\n.env\n';
  expectTrue('make-template 清洗：gitignore 通用段保留、项目条目转注释示例、品牌词同洗', cleanGitignore(giIn) === giOut, JSON.stringify(cleanGitignore(giIn)));
  const giLines = cleanGitignore(giIn).split('\n').map((l) => l.trim());
  expectTrue('make-template 清洗：项目条目无一以可生效形态残留', !giLines.includes('curia-build/') && !giLines.includes('deploy-secrets/'), JSON.stringify(giLines));
  expectTrue('make-template 清洗：gitignore 清洗产物是再清洗的不动点（连洗两遍逐字节一致）', cleanGitignore(cleanGitignore(giIn)) === cleanGitignore(giIn), JSON.stringify(cleanGitignore(cleanGitignore(giIn))));

  /* 清洗规则 4：注册表 rootDirs 收窄为通用五项、被移除根的豁免条目删除、空预算覆盖清理、值级品牌清洗 */
  const regIn = JSON.stringify({
    workspaceLayout: { rootDirs: ['.agents', '.claude', '.codex', '.git', 'scripts', 'apps', 'deploy'], agentsDirs: ['.agents/plans'], rootMarkdown: ['AGENTS.md'] },
    exemptPaths: ['deploy/db-ledger/README.md', 'apps/backend/x', '.agents/doc-types.md'],
    types: { survey: { budgetOverrides: {}, statuses: ['current'] }, note: { hint: 'Curia 家族的笔记' } },
  });
  const regOut = cleanRegistry(regIn);
  const reg = JSON.parse(regOut);
  expectTrue('make-template 清洗：注册表 rootDirs 收窄为通用五项（顺序即规范形态）',
    JSON.stringify(reg.workspaceLayout.rootDirs) === JSON.stringify(['.agents', '.claude', '.codex', '.git', 'scripts']),
    JSON.stringify(reg.workspaceLayout.rootDirs));
  expectTrue('make-template 清洗：指向被移除根的 exemptPaths 条目一并删除',
    JSON.stringify(reg.exemptPaths) === JSON.stringify(['.agents/doc-types.md']),
    JSON.stringify(reg.exemptPaths));
  expectTrue('make-template 清洗：空 budgetOverrides 属残留、删除', !('budgetOverrides' in reg.types.survey), JSON.stringify(reg.types.survey));
  expectTrue('make-template 清洗：注册表字符串值走品牌清洗', reg.types.note.hint === 'Curia 家族的笔记', reg.types.note.hint);
  expectTrue('make-template 清洗：注册表清洗幂等（规范序列化不动点，结尾一个换行）',
    cleanRegistry(regOut) === regOut && regOut.endsWith('\n') && !regOut.endsWith('\n\n'),
    JSON.stringify(regOut.slice(-40)));

  /** 树快照：文件按内容哈希、符号链接按目标、目录按存在性——逐项可比。 */
  const snapshot = (dir) => {
    const out = new Map();
    const walk = (rel) => {
      for (const name of readdirSync(join(dir, rel)).sort()) {
        const r = rel ? `${rel}/${name}` : name;
        const abs = join(dir, r);
        const st = lstatSync(abs);
        if (st.isSymbolicLink()) out.set(r, `link:${readlinkSync(abs)}`);
        else if (st.isDirectory()) { out.set(r, 'dir'); walk(r); }
        else out.set(r, `file:${createHash('sha256').update(readFileSync(abs)).digest('hex')}`);
      }
    };
    walk('');
    return out;
  };
  const mtRoot = mkdtempSync(join(tmpdir(), 'curia-maketemplate-'));
  try {
    const targets = [join(mtRoot, 'out-a'), join(mtRoot, 'out-b')];
    const run = (target) => spawnSync(process.execPath, [join(SRC_ROOT, 'scripts', 'make-template.mjs'), '--allow-dirty', target], { cwd: SRC_ROOT, encoding: 'utf8' });
    const [a, b] = targets.map(run);
    expectTrue('make-template：两遍都正常退出并落盘', a.status === 0 && b.status === 0 && existsSync(join(targets[0], 'AGENTS.md')) && existsSync(join(targets[1], 'AGENTS.md')), `退出码 ${a.status}/${b.status}；${((a.stderr ?? '') + (b.stderr ?? '')).slice(0, 240)}`);
    const [snapA, snapB] = targets.map(snapshot);
    const diffs = [];
    for (const [k, v] of snapA) if (snapB.get(k) !== v) diffs.push(k);
    for (const k of snapB.keys()) if (!snapA.has(k)) diffs.push(k);
    expectTrue('make-template：连跑两遍产物逐字节一致（含符号链接目标）', diffs.length === 0, `不一致 ${diffs.length} 处：${[...new Set(diffs)].slice(0, 5).join('、')}`);
  } finally {
    rmSync(mtRoot, { recursive: true, force: true });
  }

  // 脏树守卫：/tmp 全量副本自成一个 git 仓——净树可抽取，弄脏即拦、--allow-dirty 放行
  {
    const dirtyRepo = mkdtempSync(join(tmpdir(), 'curia-mt-dirty-'));
    try {
      execFileSync('rsync', ['-a', '--exclude', '.git', '--exclude', '开源项目', '--exclude', 'create-curia', '--exclude', 'node_modules', `${SRC_ROOT}/`, `${dirtyRepo}/`]);
      const g = (...a) => execFileSync('git', [...a], { cwd: dirtyRepo, stdio: ['pipe', 'pipe', 'pipe'] });
      g('init', '-q', '-b', 'main');
      g('add', '-A');
      g('-c', 'user.email=selftest@local', '-c', 'user.name=selftest', 'commit', '-q', '-m', 'base');
      const out1 = mkdtempSync(join(tmpdir(), 'curia-mt-out-'));
      const runMt = (extra, target) => spawnSync(process.execPath, [join(dirtyRepo, 'scripts', 'make-template.mjs'), ...extra, target], { cwd: dirtyRepo, encoding: 'utf8' });
      const clean = runMt([], out1);
      expectTrue('make-template：净树正常抽取', clean.status === 0, `${clean.stderr}`.slice(0, 200));
      writeFileSync(join(dirtyRepo, 'scripts', 'version.mjs'), readFileSync(join(dirtyRepo, 'scripts', 'version.mjs'), 'utf8') + '\n// dirty-marker\n');
      const out2 = mkdtempSync(join(tmpdir(), 'curia-mt-out-'));
      const dirty = runMt([], out2);
      expectTrue('make-template：脏树默认拒绝并挂 [template/dirty-tree]', dirty.status !== 0 && /template\/dirty-tree/.test(`${dirty.stderr}`), `${dirty.stderr}`.slice(0, 200));
      const out3 = mkdtempSync(join(tmpdir(), 'curia-mt-out-'));
      const forced = runMt(['--allow-dirty'], out3);
      expectTrue('make-template：--allow-dirty 放行且产物带脏标记（如实烙印）', forced.status === 0 && readFileSync(join(out3, 'scripts', 'version.mjs'), 'utf8').includes('dirty-marker'), `${forced.stderr}`.slice(0, 200));
      rmSync(out1, { recursive: true, force: true });
      rmSync(out2, { recursive: true, force: true });
      rmSync(out3, { recursive: true, force: true });
    } finally {
      rmSync(dirtyRepo, { recursive: true, force: true });
    }
  }
}

/* ---------------------------- version.mjs：默认纯版本号 / --json / 脏树拒绝与放行（规格 §3） */

{
  const verRepo = mkdtempSync(join(tmpdir(), 'curia-version-'));
  try {
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: verRepo, stdio: ['pipe', 'pipe', 'pipe'] });
    execFileSync('git', ['-c', 'user.email=selftest@local', '-c', 'user.name=selftest', 'commit', '-q', '--allow-empty', '-m', 'base'], { cwd: verRepo, stdio: ['pipe', 'pipe', 'pipe'] });
    mkdirSync(join(verRepo, '.agents'), { recursive: true }); // 失败命中的台账落点
    const envVer = { ...process.env, CURIA_ROOT: verRepo };
    delete envVer.CURIA_STAGED;
    const runVersion = (args) => {
      const r = spawnSync(process.execPath, [join(SRC_ROOT, 'scripts', 'version.mjs'), ...args], { cwd: verRepo, encoding: 'utf8', env: envVer });
      return { code: r.status, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
    };

    const plain = runVersion([]);
    expectTrue('version：默认输出纯版本号（不是 JSON）', plain.code === 0 && /^0\.0\.0\.[1-9][0-9]*$/.test(plain.out), `退出码 ${plain.code}，输出「${plain.out}」`);
    const json = runVersion(['--json']);
    let rec = null;
    try { rec = JSON.parse(json.out); } catch { /* 非 JSON 按断言失败处理 */ }
    expectTrue('version：--json 输出 {version, commit, dirty}，version 与默认一致', json.code === 0 && rec !== null && rec.version === plain.out && /^[0-9a-f]{40}$/.test(rec.commit ?? '') && rec.dirty === false, json.out.slice(0, 200));

    writeFileSync(join(verRepo, 'dirty.txt'), 'x\n');
    const dirty = runVersion([]);
    expectTrue('version：脏树默认拒绝构建并挂 [version/dirty]', dirty.code !== 0 && /\[version\/dirty\]/.test(`${dirty.err}${dirty.out}`), `${dirty.err}${dirty.out}`.slice(0, 240));
    const allowed = runVersion(['--allow-dirty']);
    expectTrue('version：--allow-dirty 放行、警告 [version/dirty-allowed] 且不改 N', allowed.code === 0 && allowed.out === plain.out && /\[version\/dirty-allowed\]/.test(allowed.err), `退出码 ${allowed.code}，输出「${allowed.out}」，警告「${allowed.err}」`);

    const verHits = join(verRepo, '.agents', '.rule-hits.jsonl');
    const verRaw = existsSync(verHits) ? readFileSync(verHits, 'utf8') : '';
    let hitRec = null;
    try { hitRec = JSON.parse(verRaw.trim().split('\n')[0] ?? ''); } catch { /* 台账缺失或坏行按断言失败处理 */ }
    expectTrue('version：失败命中落进 CURIA_ROOT 台账（error 级），--allow-dirty 告警不入账', hitRec !== null && Array.isArray(hitRec.ids) && hitRec.ids.includes('version/dirty') && !hitRec.ids.some((id) => id.includes('dirty-allowed')), JSON.stringify(verRaw.slice(0, 240)));
  } finally {
    rmSync(verRepo, { recursive: true, force: true });
  }
}

/* ---------------------- 封印幽灵判定：盘面语义（审计发现的假红：未入库新归档与 --path） */

{
  const relA = '.agents/archive/2026-01-01-a.md';
  const relB = '.agents/archive/2026-01-02-b.md';
  const mk = (t) => `# 旧文档\n\nType: plan\nStatus: done\nUpdated: ${TODAY}\nArchived: ${TODAY}\n\n${t}\n`;
  const A = mk('甲');
  const B = mk('乙');
  write(relA, A);
  write('.agents/archive/manifest.json', manifestOf({ 'archive/2026-01-01-a.md': sealOf(A) }));
  git('add', '-A');
  git('-c', 'user.email=selftest@local', '-c', 'user.name=selftest', 'commit', '-q', '-m', 'baseline');
  // B 落盘且已封印、但未 git add（archive-doc 之后 add 之前的真实窗口）：默认与 --path 都不得误报幽灵
  write(relB, B);
  write('.agents/archive/manifest.json', manifestOf({ 'archive/2026-01-01-a.md': sealOf(A), 'archive/2026-01-02-b.md': sealOf(B) }));
  git('add', '.agents/archive/manifest.json'); // 只入库 manifest，B 留在未入库状态
  const def = runTypes(root, { today: TODAY });
  expectTrue('封印：未入库的新归档不误报幽灵', def.ok, JSON.stringify(def.errors.slice(0, 3)));
  const pathed = runTypes(root, { today: TODAY, paths: [relA] });
  expectTrue('封印：--path 定向检查不把同区其他封印文件误报成幽灵', pathed.ok, JSON.stringify(pathed.errors.slice(0, 3)));
  rmSync(join(root, relB), { force: true });
  const ghost = runTypes(root, { today: TODAY });
  expectTrue('封印：manifest 键在盘上真的不存在才报幽灵', ghost.errors.some((e) => /在盘上不存在/.test(e)), JSON.stringify(ghost.errors.slice(0, 3)));
  symlinkSync(join(root, 'AGENTS.md'), join(root, relB)); // 封印文件被换成符号链接：收集器跳过、哈希从未核对
  const tampered = runTypes(root, { today: TODAY });
  expectTrue('封印：封印文件被换成符号链接会被拦下', tampered.errors.some((e) => /不是常规文件/.test(e)), JSON.stringify(tampered.errors.slice(0, 3)));
  rmSync(join(root, relB), { force: true });
  reset([relA, relB, '.agents/archive/manifest.json']);
}

/* ------------------------------------------------------------- 工具链守卫 */

expectFail('工具：脚本语法坏掉', {
  'scripts/zz-broken.mjs': 'const a = ;\n',
}, /node --check 失败/, runToolsDisk);

expectFail('工具：钩子源文件语法坏掉', {
  'scripts/hooks/zz-broken-hook': 'if then fi (\n',
}, /sh -n 失败/, runToolsDisk);

// 钩子目录已有别的非 sample 钩子（有人装过）却缺我们的 → 错误；只有 *.sample 的全新 clone 才降告警（见下）
{
  const hookAbs = join(root, '.git', 'hooks', 'pre-commit');
  const foreignAbs = join(root, '.git', 'hooks', 'commit-msg');
  const saved = readFileSync(hookAbs, 'utf8');
  rmSync(hookAbs);
  writeFileSync(foreignAbs, '#!/bin/sh\n# 别的工具装的提交钩子\nexit 0\n');
  const r = runToolsDisk(root, {});
  expectTrue('工具：钩子目录有别的钩子而缺我们的必须报错', !r.ok && r.errors.some((e) => /未安装/.test(e)), JSON.stringify(r.errors.slice(0, 3)));
  rmSync(foreignAbs, { force: true });
  writeFileSync(hookAbs, saved);
  chmodSync(hookAbs, 0o755);
}

// 冷启动降级：全新 git init（无提交）首跑，钩子未装只是告警不是错误——别让第一次运行就红
{
  const cold = mkdtempSync(join(tmpdir(), 'curia-coldstart-'));
  try {
    cpSync(join(SRC_ROOT, 'scripts'), join(cold, 'scripts'), { recursive: true });
    mkdirSync(join(cold, '.agents'), { recursive: true });
    for (const f of ['doc-types.json', 'doc-types.md']) cpSync(join(SRC_ROOT, '.agents', f), join(cold, '.agents', f));
    cpSync(join(SRC_ROOT, '.agents', 'templates'), join(cold, '.agents', 'templates'), { recursive: true });
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: cold, stdio: ['pipe', 'pipe', 'pipe'] });
    execFileSync('git', ['add', '-A'], { cwd: cold, stdio: ['pipe', 'pipe', 'pipe'] }); // 入索引但无提交：冷启动
    const envDisk = { ...process.env };
    delete envDisk.CURIA_STAGED; // 冷启动场景是交互首跑，显式关掉可能从 pre-commit 透传的暂存开关
    const r = spawnSync(process.execPath, [join(cold, 'scripts', 'check-tools.mjs')], { cwd: cold, encoding: 'utf8', env: envDisk });
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    expectTrue('冷启动：无提交仓库首跑 check-tools 退出码 0', r.status === 0, out.slice(0, 300));
    expectTrue('冷启动：钩子未装降级为告警并提示先装，不谎报已装', /\[tools\/hook-not-installed\]/.test(r.stderr ?? '') && out.includes('钩子未装'), out.slice(0, 300));
  } finally {
    rmSync(cold, { recursive: true, force: true });
  }
}

// 冷启动（全新 clone：有提交、钩子目录只有 *.sample）：告警不阻断，退出码 0
{
  const cold = mkdtempSync(join(tmpdir(), 'curia-coldclone-'));
  try {
    cpSync(join(SRC_ROOT, 'scripts'), join(cold, 'scripts'), { recursive: true });
    mkdirSync(join(cold, '.agents'), { recursive: true });
    for (const f of ['doc-types.json', 'doc-types.md']) cpSync(join(SRC_ROOT, '.agents', f), join(cold, '.agents', f));
    cpSync(join(SRC_ROOT, '.agents', 'templates'), join(cold, '.agents', 'templates'), { recursive: true });
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: cold, stdio: ['pipe', 'pipe', 'pipe'] });
    execFileSync('git', ['add', '-A'], { cwd: cold, stdio: ['pipe', 'pipe', 'pipe'] });
    execFileSync('git', ['-c', 'user.email=selftest@local', '-c', 'user.name=selftest', 'commit', '-q', '-m', 'base'], { cwd: cold, stdio: ['pipe', 'pipe', 'pipe'] });
    const envDisk = { ...process.env };
    delete envDisk.CURIA_STAGED; // 冷启动是交互首跑，显式关掉可能从 pre-commit 透传的暂存开关
    const r = spawnSync(process.execPath, [join(cold, 'scripts', 'check-tools.mjs')], { cwd: cold, encoding: 'utf8', env: envDisk });
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    expectTrue('冷启动：全新 clone（有提交、钩子目录只有 *.sample）告警不退出 1', r.status === 0, out.slice(0, 300));
    expectTrue('冷启动：提示先装钩子且不谎报已装', /\[tools\/hook-not-installed\]/.test(out) && out.includes('钩子未装'), out.slice(0, 300));
  } finally {
    rmSync(cold, { recursive: true, force: true });
  }
}

// 空索引（有脚本树、什么都没 add）：受检清单为空时跳过安装断言，成功行如实说「无钩子源」而不是「钩子已装」
{
  const empty = mkdtempSync(join(tmpdir(), 'curia-emptyindex-'));
  try {
    cpSync(join(SRC_ROOT, 'scripts'), join(empty, 'scripts'), { recursive: true });
    mkdirSync(join(empty, '.agents'), { recursive: true });
    for (const f of ['doc-types.json', 'doc-types.md']) cpSync(join(SRC_ROOT, '.agents', f), join(empty, '.agents', f));
    cpSync(join(SRC_ROOT, '.agents', 'templates'), join(empty, '.agents', 'templates'), { recursive: true });
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: empty, stdio: ['pipe', 'pipe', 'pipe'] });
    const envDisk = { ...process.env };
    delete envDisk.CURIA_STAGED;
    const r = spawnSync(process.execPath, [join(empty, 'scripts', 'check-tools.mjs')], { cwd: empty, encoding: 'utf8', env: envDisk });
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    expectTrue('空索引：不谎报「钩子已装」（成功行说无钩子源）', r.status === 0 && out.includes('无钩子源') && !out.includes('钩子已装'), out.slice(0, 300));
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
}

// 外来钩子不能报错：install-hooks 本就拒绝覆盖，卡住别人的环境毫无意义
expectPass('工具：外来钩子（无标记）只告警不阻断', {
  '.git/hooks/pre-commit': '#!/bin/sh\n# 别的工具装的提交追踪器\nexit 0\n',
}, new RegExp(`不含 \`${MARKER}\` 标记`), runToolsDisk);

expectPass('工具：钩子已装但过期只告警', {
  '.git/hooks/pre-commit': `#!/bin/sh\n# ${MARKER}: 旧版门禁\nexit 0\n`,
}, /已装但过期/, runToolsDisk);

{
  const cliAbs = join(root, 'scripts', 'doc-query.mjs');
  const saved = readFileSync(cliAbs, 'utf8');
  rmSync(cliAbs);
  const r = runToolsDisk(root, {});
  expectTrue('工具：只读 CLI 缺失必须报错', !r.ok && r.errors.some((e) => /不存在/.test(e)), JSON.stringify(r.errors.slice(0, 3)));
  writeFileSync(cliAbs, saved);
}

/* ------------------------------------------------------------------- 汇总 */

rmSync(root, { recursive: true, force: true });

// 覆盖缺口自证：清单取自 run-checks 的 CHECKS，加了新守卫却不补夹具，这里就会红
const uncovered = CHECKS.filter((c) => !exercised.has(c));
if (uncovered.length) failures.push(`自证覆盖缺口：${uncovered.join(' / ')} 没有任何夹具——「每道守卫都被证明能失败」不成立`);

const total = passed + failures.length;
if (failures.length) {
  for (const f of failures) console.error(`self-test: ✗ ${f}`);
  console.error(`\n✗ 门禁自证未通过：${failures.length}/${total} 个夹具未按预期工作`);
  process.exit(1);
}
console.log(`✓ 门禁自证通过：${passed} 个夹具，覆盖 ${exercised.size}/${CHECKS.length} 道守卫，每道都被证明能失败`);
