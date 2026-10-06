#!/usr/bin/env node
/**
 * run-checks.mjs —— Curia 门禁总入口：并行运行八道守卫，任一失败则退出码非 0。
 *
 * 运行：node scripts/run-checks.mjs            # 八道守卫并行（默认只看已入库文件）
 *       node scripts/run-checks.mjs --all      # 并入未入库文件做全量审计
 *       node scripts/run-checks.mjs --self     # 附带门禁自证（负向夹具套件，在守卫之后串行）
 *       node scripts/run-checks.mjs --audit    # 只读两档命中台账（新口径 + 历史窗口）：命中过的规则与零命中候选，不跑守卫
 *
 * 暂存模式：CURIA_STAGED=1（pre-commit 设置）时，先把 git 索引里的 scripts/ 物化到临时目录，
 * 八道守卫全部从这份「将要提交的副本」启动，并设 CURIA_ROOT 指回真实仓库根（doc-lib 的 ROOT 覆盖）——
 * 校验的既是要提交的树，也是要提交的门禁本体：先 add 坏守卫再在盘上改好同样拦得住。
 * 索引里缺门禁脚本（含 run-checks 自身与 doc-lib）时直接拒绝放行；交互模式（无此变量）仍从盘面启动。
 * 自证（--self）是唯一例外，仍从盘面跑：它要用真实仓库的 .agents 搭夹具工作区，物化树只有 scripts/。
 *
 * 守卫之间互不依赖，并发执行、按 CHECKS 顺序汇总输出；自证要搭临时工作区且最重，放最后串行。
 * 守卫收口时会把本次命中的 error 级规则 ID 记进 .agents/.rule-hits.jsonl（gitignore 的本地台账；
 * 口径：命中 = 拦截，warning 只在门禁输出可见、不入账）。--audit 并读该档与此前归档的 v1 混合口径
 * 台账（.rule-hits.v1-*.jsonl，含 warning 重复记账）：零命中判定取两档并集、输出按口径分段——
 * 零命中的机械格式类规则是删除候选（修剪机制）；修剪随机制批次执行，不绑日历。
 *
 * CHECKS 导出给 self-test：自证要断言「每道守卫都至少有一个夹具」，这份清单是唯一权威，
 * 新增守卫而不补夹具会直接被自证拦下。导入本文件不会跑门禁（主体在主模块守卫内）。
 */

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, isMainModule } from './doc-lib.mjs';

export const CHECKS = ['check-tools.mjs', 'check-agent-notes.mjs', 'check-doc-types.mjs', 'check-prose.mjs', 'check-layout.mjs', 'check-links.mjs', 'check-migrations.mjs', 'check-db-ledger.mjs'];
export const SELFTEST = 'self-test.mjs';

/** 暂存模式开关：pre-commit 设 CURIA_STAGED=1，门禁校验 git 索引（将要提交的树）而非盘面。 */
const isStagedMode = () => process.env.CURIA_STAGED === '1';

/**
 * 把 git 索引里的 scripts/ 物化到临时目录（保留可执行位与 hooks/ 子目录）。
 * 返回 { scriptsDir, cleanup }；git 不可用或索引读取失败时返回 { error }——
 * 暂存模式宁可阻断提交，也不能静默退回盘面守卫。
 */
function materializeStagedScripts(root) {
  const tmp = mkdtempSync(join(tmpdir(), 'curia-staged-'));
  try {
    const paths = execFileSync('git', ['ls-files', '-z', '--', 'scripts'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
    execFileSync('git', ['checkout-index', '-z', '--stdin', `--prefix=${tmp}/`], { cwd: root, input: paths, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) {
    rmSync(tmp, { recursive: true, force: true });
    return { error: `暂存模式: 索引物化失败（git checkout-index scripts/）——无法校验将要提交的门禁本体，拒绝放行：${e.message} [meta/staged-materialize]` };
  }
  return { scriptsDir: join(tmp, 'scripts'), cleanup: () => rmSync(tmp, { recursive: true, force: true }) };
}

function runScript(scriptsDir, name, scriptArgs, env = null) {
  return new Promise((res) => {
    const child = spawn(process.execPath, [join(scriptsDir, name), ...scriptArgs], { stdio: ['ignore', 'pipe', 'pipe'], ...(env ? { env } : {}) });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => res({ name, code: 1, out: '', err: `无法启动：${e.message}` }));
    child.on('close', (code) => res({ name, code: code ?? 1, out, err }));
  });
}

/** 规则全集：守卫、doc-lib 与 version.mjs 源码里错误/报警构造（push / fail( / 返回对象字面量 errors:[ / 行首 errors: [ 或 warnings: [ 的多行数组字面量）上的 `[scope/rule]` 字面量。 */
function ruleUniverse(scriptsDir) {
  const ids = new Map(); // id → { src, warn }：首次出现它的源码文件，与是否只见于 warning 构造
  for (const entry of readdirSync(scriptsDir).sort()) {
    if (!/^(check-.*|doc-lib|version)\.mjs$/.test(entry)) continue;
    let open = 0; // > 0 表示处于未收口的错误/报警构造内：构造可跨行（三目折行、多行数组字面量），按配平符续扫
    let openIsWarn = false; // 当前未收口构造是否起于 warnings.push（构造收口即复位，级别不跨构造沿用）
    let openSquare = false; // 配平符种类：false 圆括号（push/fail 调用），true 方括号（行首 errors: [ / warnings: [ 字面量）
    for (const line of readFileSync(join(scriptsDir, entry), 'utf8').split('\n')) {
      const starts = open <= 0 && /(?:errors|warnings)\.push\(|fail\(|(?:errors|warnings):\s*\[/.test(line);
      if (open <= 0 && !starts) continue;
      const warn = /warnings\.push\(/.test(line) || openIsWarn;
      for (const m of line.matchAll(/\[([a-z][a-z0-9-]*\/[a-z][a-z0-9-]*)\]/g)) {
        const cur = ids.get(m[1]);
        if (!cur) ids.set(m[1], { src: entry, warn });
        else if (!warn) cur.warn = false; // 同一 ID 只要见过 error 构造就按 error 级
      }
      // 方括号配平只认行首形态触发：普通数组字面量（赋值、实参、返回值）不按构造续扫
      if (open <= 0) openSquare = /^[ \t]*(?:errors|warnings):\s*\[/.test(line);
      for (const ch of line) {
        if (openSquare) {
          if (ch === '[') { open++; if (open === 1) openIsWarn = warn; }
          else if (ch === ']') open--;
        } else {
          if (ch === '(') { open++; if (open === 1) openIsWarn = warn; }
          else if (ch === ')') open--;
        }
      }
      // 配平回 0 即复位：级别只描述当前构造，不沿用给下一条（否则 warnings.push 之后的 errors.push 全被误判 warning）
      if (open > 0) openIsWarn = warn;
      else openIsWarn = false;
    }
  }
  return ids;
}

/** 读一档台账：坏行、ids 非数组的行与数组里的非字符串 ID 一律跳过——台账是 append-only 的本地数据，不因单行损坏拒绝审计。 */
function readLedger(path) {
  const hits = new Map(); // id → { count, last }
  if (!existsSync(path)) return hits;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line);
      if (!Array.isArray(rec.ids)) continue;
      for (const id of rec.ids) {
        if (typeof id !== 'string') continue; // 非字符串 ID 与坏行同语义跳过：混进 Map 会让 printHits 排序的 localeCompare 崩溃
        const h = hits.get(id) ?? { count: 0, last: null };
        h.count++;
        if (!h.last || rec.ts > h.last) h.last = rec.ts;
        hits.set(id, h);
      }
    } catch {
      // 坏行跳过
    }
  }
  return hits;
}

/**
 * 台账审计：并读两档台账——新口径 .agents/.rule-hits.jsonl（error-only）与此前归档的 v1 混合口径
 * .agents/.rule-hits.v1-*.jsonl（含 warning 重复记账）——零命中判定取两档并集，命中列表按口径分段；
 * 零命中里机械格式类才是删除候选，修剪随机制批次执行，不绑日历。
 */
function audit(scriptsDir) {
  const universe = ruleUniverse(scriptsDir);
  const agentsDir = join(ROOT, '.agents');
  const current = readLedger(join(agentsDir, '.rule-hits.jsonl'));
  const historyFiles = existsSync(agentsDir) ? readdirSync(agentsDir).filter((n) => /^\.rule-hits\.v1-.*\.jsonl$/.test(n)).sort() : [];
  const history = new Map(); // 多份 v1 档（若有）合并为「历史窗口」一档
  for (const name of historyFiles) {
    for (const [id, h] of readLedger(join(agentsDir, name))) {
      const t = history.get(id) ?? { count: 0, last: null };
      t.count += h.count;
      if (h.last && (!t.last || h.last > t.last)) t.last = h.last;
      history.set(id, t);
    }
  }
  const day = (ts) => (ts ? String(ts).slice(0, 10) : '—');
  const total = (m) => [...m.values()].reduce((a, h) => a + h.count, 0);
  const printHits = (m, emptyMsg) => {
    if (!m.size) {
      console.log(emptyMsg);
      return;
    }
    for (const [id, h] of [...m.entries()].sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))) {
      console.log(`  [${id}]  命中 ${h.count} 次，最近 ${day(h.last)}`);
    }
  };
  console.log(`规则命中审计：守卫源码登记规则 ${universe.size} 条；零命中判定取两档台账并集（.agents/ 本地数据）。`);
  console.log('口径：命中 = 拦截——只记 error 级；warning 只在门禁输出可见，不入账。');
  console.log('');
  console.log(`【新口径 · error-only】.agents/.rule-hits.jsonl：累计 ${total(current)} 次 / ${current.size} 条`);
  console.log('  注记：2026-10-05 07:10–07:58 过渡窗口的 44 条 warning 记录混在本档，属切换期遗留，不影响零命中判定');
  printHits(current, '  （台账为空——门禁还没拦到过任何东西，或刚启用）');
  console.log('');
  const historyLabel = historyFiles.length ? historyFiles.map((n) => `.agents/${n}`).join('、') : '.agents/.rule-hits.v1-*.jsonl';
  console.log(`【历史窗口 · 含 warning 重复记账】${historyLabel}：累计 ${total(history)} 次 / ${history.size} 条`);
  printHits(history, '  （无历史档——未保留 v1 台账）');
  console.log('');
  const union = new Set([...current.keys(), ...history.keys()]);
  const zero = [...universe.keys()].filter((id) => !union.has(id)).sort();
  // 分级：台账 error-only，warning 级规则结构性不可记账——列进「删除候选」会诱导误删活规则，单列「台账不可证」
  const zeroError = zero.filter((id) => !universe.get(id).warn);
  const zeroWarn = zero.filter((id) => universe.get(id).warn);
  console.log(`零命中规则 ${zero.length} 条（判定口径：两档台账并集）——结构性不变量（封印、桥、永不删除、状态机）低频是设计使然，不算冗余；`);
  console.log('机械格式类规则长期零命中才是删除候选：先确认负向夹具还在，再连同规则与夹具一起删，并在笔记里记一笔。');
  for (const id of zeroError) console.log(`  [${id}]  定义于 ${universe.get(id).src}`);
  console.log('');
  console.log(`warning 级零「命中」 ${zeroWarn.length} 条——error-only 台账对它们结构性不可证（warning 不入账），不构成删除候选：`);
  for (const id of zeroWarn) console.log(`  [${id}]  定义于 ${universe.get(id).src}`);
  console.log('修剪随机制批次执行，不绑日历。');
}

async function main() {
  const diskScriptsDir = resolve(fileURLToPath(new URL('.', import.meta.url)));
  const args = process.argv.slice(2);

  if (args.includes('--audit')) {
    audit(diskScriptsDir);
    return;
  }

  const passthrough = args.filter((a) => a === '--all');
  const withSelf = args.includes('--self');

  let scriptsDir = diskScriptsDir;
  let guardEnv = null;
  let cleanup = null;
  if (isStagedMode()) {
    const stagedTree = materializeStagedScripts(ROOT);
    if (stagedTree.error) {
      console.error(stagedTree.error);
      process.exitCode = 1;
      return;
    }
    scriptsDir = stagedTree.scriptsDir;
    cleanup = stagedTree.cleanup;
    guardEnv = { ...process.env, CURIA_STAGED: '1', CURIA_ROOT: ROOT };
    // 门禁本体必须也在将要提交的树里：索引删掉某个守卫或钩子源（git rm --cached）不能被静默跳过
    const required = ['run-checks.mjs', 'doc-lib.mjs', ...CHECKS, ...(withSelf ? [SELFTEST] : []), 'hooks/pre-commit'];
    const missing = required.filter((name) => !existsSync(join(scriptsDir, name)));
    if (missing.length) {
      console.error(`暂存模式: 索引里缺门禁脚本 ${missing.join('、')}——将要提交的树缺门禁本体，拒绝放行 [meta/staged-guard-missing]`);
      cleanup();
      process.exitCode = 1;
      return;
    }
  }

  try {
    const results = await Promise.all(CHECKS.map((name) => runScript(scriptsDir, name, passthrough, guardEnv)));
    // 自证在暂存模式下仍从盘面跑（见文件头）：它要用真实仓库的 .agents 搭夹具工作区，且不在 pre-commit 路径上
    if (withSelf) results.push(await runScript(diskScriptsDir, SELFTEST, []));

    let failed = 0;
    for (const r of results) {
      console.log(`\n▶ ${r.name}`);
      if (r.out.trim()) process.stdout.write(r.out.endsWith('\n') ? r.out : `${r.out}\n`);
      if (r.err.trim()) process.stderr.write(r.err.endsWith('\n') ? r.err : `${r.err}\n`);
      if (r.code !== 0) failed++;
    }

    if (failed) {
      console.error(`\n✗ 门禁未通过：${failed}/${results.length} 项失败；机械类错误可先跑 node scripts/fix-doc.mjs --write <路径>`);
      process.exitCode = 1;
    } else {
      console.log(`\n✓ 全部门禁通过（${results.length} 项${withSelf ? '，含自证' : ''}；守卫并行执行）`);
    }
  } finally {
    cleanup?.();
  }
}

if (isMainModule(import.meta.url)) main();
