#!/usr/bin/env node
/**
 * check-tools.mjs —— 工具链冒烟门禁（纯 node 标准库、零依赖）。
 *
 * 动机：run-checks 只执行守卫脚本；doc-query / new-doc / gen-doc-types / seal 这些工具
 * 若语法坏掉或启动即崩，没有任何门禁会发现——它们只在被人用到时才炸。本检查把它们全部空跑一遍。
 *
 * 断言：
 *   a) scripts/ 下每个 .mjs 都能通过 `node --check`（含未被任何守卫 import 的工具）
 *   b) 只读 CLI 正常退出并有输出：doc-query --json、new-doc --list、gen-doc-types --check
 *   c) 注册表可被加载且投影与之一致（--check 已覆盖）
 *   d) 提交钩子真的装好了：八道守卫只在 pre-commit 自动跑，钩子没装就等于门禁全靠自愿。
 *      钩子目录里没有任何非 *.sample 文件（全新 clone / 从未装过）→ 告警并提示 install-hooks；
 *      有非 sample 文件但我们的钩子缺/坏 → 报错（有人装过钩子而门禁没接上，才是真问题）；
 *      被别的工具占用（不含我们的标记）或已过期 → 告警不阻断，
 *      因为 install-hooks 遇到外来钩子本就拒绝覆盖，强行报错会卡住别人的环境。
 *      钩子源清单为空（索引里没有 scripts/hooks/）时跳过安装断言，成功行如实说「无钩子源」。
 *
 * 受检清单默认取 git 索引（git ls-files -- scripts）——门禁守「将要提交的内容」，
 * 同仓并行会话未入库的草稿脚本不拦本次提交（与内容守卫的索引语义对齐）；非 git 环境回退读盘。
 * CURIA_STAGED=1（pre-commit 的暂存模式）时脚本内容也从索引取并物化到临时目录：
 * `node --check` / `sh -n` 与三个只读 CLI 跑的都是「将要提交的版本」——先 add 坏版再在盘上改好也拦得住；
 * CLI 从物化目录 spawn，带 CURIA_ROOT（指回真仓，配合 doc-lib 的 ROOT 覆盖）与 CURIA_STAGED。
 *
 * 只跑只读命令：seal 会写 manifest，故只做语法检查，不执行。
 * 运行：node scripts/check-tools.mjs
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { ROOT, countMissingRuleIds, isMainModule, logRuleHits } from './doc-lib.mjs';
import { MARKER } from './install-hooks.mjs';

const READ_ONLY_CLIS = [
  ['doc-query.mjs', ['--json']],
  ['new-doc.mjs', ['--list']],
  ['gen-doc-types.mjs', ['--check']],
];

/** 暂存模式开关（pre-commit 置 1）：脚本内容从 git 索引取，而不是工作区正文。 */
const isStagedMode = () => process.env.CURIA_STAGED === '1';

/** 定位 git 目录内路径（`git rev-parse --git-path`）；worktree 与分离 gitdir 也能对上。非 git 仓库返回 null。 */
function gitPath(root, p) {
  try {
    const out = execFileSync('git', ['rev-parse', '--git-path', p], { cwd: root, encoding: 'utf8' }).trim();
    if (!out) return null;
    return resolve(root, out);
  } catch {
    return null;
  }
}

/** 定位 git 目录下的钩子路径；非 git 仓库返回 null。 */
function hookPath(root, name) {
  return gitPath(root, `hooks/${name}`);
}

/**
 * 钩子目录是否「从未装过」：目录里没有任何非 *.sample 文件（全新 clone / git init 只有样例）。
 * 目录不存在也按从未装过算；定位不到 git 目录（非 git 环境）返回 false——不降级，保持报错。
 */
function hooksNeverInstalled(root) {
  const dir = gitPath(root, 'hooks');
  if (dir === null) return false;
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return true;
  }
  return entries.every((n) => n.endsWith('.sample'));
}

/**
 * 受检脚本清单：默认 git 索引（git ls-files -- scripts）——门禁守「将要提交的内容」，
 * 同仓并行会话未入库的草稿脚本不拦本次提交（与内容守卫的索引语义对齐）；非 git 环境回退读盘。
 * 返回 { mode: 'index'|'disk', scripts, hooks }，两者均为仓库相对路径。
 */
function listToolFiles(root) {
  try {
    const out = execFileSync('git', ['ls-files', '-z', '--', 'scripts'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
    const rels = [...new Set(out.split('\0').filter(Boolean))];
    return {
      mode: 'index',
      scripts: rels.filter((rel) => /^scripts\/[^/]+\.mjs$/.test(rel)).sort(),
      hooks: rels.filter((rel) => /^scripts\/hooks\/[^/]+$/.test(rel) && !rel.slice('scripts/hooks/'.length).startsWith('.')).sort(),
    };
  } catch {
    const scriptsDir = join(root, 'scripts');
    const hooksDir = join(scriptsDir, 'hooks');
    return {
      mode: 'disk',
      scripts: (existsSync(scriptsDir) ? readdirSync(scriptsDir) : []).filter((n) => n.endsWith('.mjs')).sort().map((n) => `scripts/${n}`),
      hooks: (existsSync(hooksDir) ? readdirSync(hooksDir) : []).filter((n) => !n.startsWith('.')).sort().map((n) => `scripts/hooks/${n}`),
    };
  }
}

/** 从 git 索引读暂存内容（`git show :path`）；索引里没有该条目或读取失败时返回 null。 */
function readIndexBlob(root, rel) {
  try {
    return execFileSync('git', ['show', `:${rel}`], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch {
    return null;
  }
}

export function runCheck(root = ROOT, opts = {}) {
  const errors = [];
  const warnings = [];
  const listed = listToolFiles(root);
  const staged = listed.mode === 'index' && isStagedMode();
  const stats = { scripts: 0, hooks: 0, clis: 0, hookMissing: 0, hookSources: listed.hooks.length };
  const scriptsDir = join(root, 'scripts');

  // 暂存模式下脚本树可以只在索引里（盘上删了但删除未暂存）：物化后即可校验，不按盘面判缺
  if (!staged && !existsSync(scriptsDir)) {
    return { ok: false, errors: [`工具: 找不到 ${join(root, 'scripts')}——守卫与工具脚本都不在 [tools/scripts-dir]`], warnings, stats };
  }

  // 暂存模式：把索引内容物化到临时目录再校验/执行（node --check、sh -n 与只读 CLI 都要真实文件路径）
  let stageDir = null;
  const stageContent = (rel, content) => {
    if (stageDir === null) stageDir = mkdtempSync(join(tmpdir(), 'curia-check-tools-'));
    const abs = join(stageDir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
    return abs;
  };
  const stagedFile = (rel) => {
    const content = readIndexBlob(root, rel);
    if (content === null) {
      errors.push(`暂存: ${rel} — git show :${rel} 读取失败，无法校验将要提交的内容 [tools/staged-read]`);
      return null;
    }
    return stageContent(rel, content);
  };

  try {
    for (const rel of listed.scripts) {
      let target = join(root, rel);
      if (staged) {
        target = stagedFile(rel);
        if (target === null) continue;
      } else if (!existsSync(target)) {
        continue; // 索引里有、盘上已无（删除尚未暂存）：本次提交内容未变，无可检
      }
      stats.scripts++;
      const r = spawnSync(process.execPath, ['--check', target], { encoding: 'utf8' });
      if (r.status !== 0) errors.push(`语法: ${rel} — node --check 失败：${(r.stderr || '').trim().split('\n')[0]} [tools/script-syntax]`);
    }

    // shell 钩子也要检查：它们只在提交那一刻执行，语法坏了会以「钩子静默失效」的形式出现
    for (const rel of listed.hooks) {
      const entry = rel.slice('scripts/hooks/'.length);
      let srcAbs = join(root, rel);
      if (staged) {
        srcAbs = stagedFile(rel);
        if (srcAbs === null) continue;
      } else if (!existsSync(srcAbs)) {
        continue; // 源文件不在盘上：语法与安装状态都无从校验
      }

      const r = spawnSync('sh', ['-n', srcAbs], { encoding: 'utf8' });
      if (r.status !== 0) errors.push(`语法: ${rel} — sh -n 失败：${(r.stderr || '').trim().split('\n')[0]} [tools/hook-syntax]`);
      else stats.hooks++;

      // d) 装好了没：源文件在库里，装进 git 目录是本地动作，漏了没人会发现
      const dest = hookPath(root, entry);
      if (dest === null) {
        warnings.push(`钩子: ${entry} — 定位不到 git 目录（不是 git 仓库？），跳过安装状态断言 [tools/hook-path]`);
      } else if (!existsSync(dest)) {
        stats.hookMissing++;
        if (hooksNeverInstalled(root)) {
          warnings.push(`钩子: ${entry} 未安装 — 钩子目录里只有 *.sample（从未装过），先跑 node scripts/install-hooks.mjs 装好（装好前门禁不会在提交时自动跑） [tools/hook-not-installed]`);
        } else {
          errors.push(`钩子: ${entry} 未安装 — 钩子目录已有其他钩子但缺我们的，门禁不会在提交时自动跑，执行 node scripts/install-hooks.mjs [tools/hook-not-installed]`);
        }
      } else {
        const have = readFileSync(dest, 'utf8');
        const want = readFileSync(srcAbs, 'utf8');
        if (!have.includes(MARKER)) warnings.push(`钩子: ${entry} 不含 \`${MARKER}\` 标记，可能是别的工具装的（install-hooks 会拒绝覆盖）——本仓门禁可能没在提交时跑 [tools/hook-foreign]`);
        else if (have !== want) warnings.push(`钩子: ${entry} 已装但过期 — 执行 node scripts/install-hooks.mjs 更新 [tools/hook-stale]`);
      }
    }

    for (const [name, args] of READ_ONLY_CLIS) {
      const rel = `scripts/${name}`;
      let script = join(scriptsDir, name);
      let cliEnv = null;
      if (staged) {
        // 执行索引版而不是盘面版：从物化目录 spawn，CURIA_ROOT 让 CLI 的 ROOT 解析指回真仓
        const content = readIndexBlob(root, rel);
        if (content === null) {
          errors.push(`工具: ${rel} 不在暂存索引中——只读 CLI 缺失 [tools/cli-missing]`);
          continue;
        }
        script = stageContent(rel, content);
        cliEnv = { ...process.env, CURIA_ROOT: root, CURIA_STAGED: '1' };
      } else if (!existsSync(script)) {
        errors.push(`工具: scripts/${name} 不存在——只读 CLI 缺失 [tools/cli-missing]`);
        continue;
      }
      const r = spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8', ...(cliEnv ? { env: cliEnv } : {}) });
      if (r.status !== 0) {
        errors.push(`工具: scripts/${name} ${args.join(' ')} — 退出码 ${r.status}：${(r.stderr || r.stdout || '').trim().split('\n')[0]} [tools/cli-failed]`);
      } else if (!(r.stdout || '').trim()) {
        errors.push(`工具: scripts/${name} ${args.join(' ')} — 退出码 0 但无输出 [tools/cli-no-output]`);
      } else {
        stats.clis++;
      }
    }
  } finally {
    if (stageDir !== null) rmSync(stageDir, { recursive: true, force: true });
  }

  errors.sort();
  warnings.sort();
  return { ok: errors.length === 0, errors, warnings, stats };
}

if (isMainModule(import.meta.url)) {
  const result = runCheck(ROOT, {});
  for (const w of result.warnings) console.warn(`warning: tools: ${w}`);
  const missing = countMissingRuleIds([...result.errors, ...result.warnings]);
  if (missing > 0) result.errors.push(`门禁: check-tools 有 ${missing} 条输出未挂规则 ID [meta/missing-rule-id]`);
  if (result.errors.length) {
    for (const e of result.errors) console.error(`tools: ${e}`);
    console.error(`✗ check-tools 未通过：共 ${result.errors.length} 处错误`);
  }
  logRuleHits(ROOT, result.errors, result.warnings);
  if (result.errors.length) process.exit(1);
  const { scripts, hooks, clis, hookMissing, hookSources } = result.stats;
  const hookTail = hookSources === 0
    ? '无钩子源（索引为空？）'
    : hookMissing ? '钩子未装（先跑 node scripts/install-hooks.mjs）' : '钩子已装';
  console.log(`✓ check-tools 通过：${scripts} 个脚本与 ${hooks} 个 shell 钩子语法正常，${clis} 个只读 CLI 可用，${hookTail}`);
}
