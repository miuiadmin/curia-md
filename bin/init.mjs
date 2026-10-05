#!/usr/bin/env node
/**
 * create-curia —— Curia 文档工作区脚手架（`npm create curia` 的入口）。
 *
 * 定位（配送红线，见 ../README.md）：生成器，不是运行时。
 *   - init 只提问与落盘：复制包内 template/ 载荷 → 按回答改写注册表 → 重生成投影 → 装 pre-commit 钩子。
 *   - 生成后目标仓与包再无关系：引擎零依赖裸 node 运行；本工具没有 upgrade/check 等驻留子命令；
 *     生成物不 import 包内任何模块；包 dependencies 为空，交互只用 node 内置 readline/promises。
 *
 * 用法：
 *   npm create curia [-- --dir <目标目录>] [-- --defaults]
 *   node bin/init.mjs [--dir <目标目录>] [--defaults]
 *
 * 非交互（--defaults 或 stdin/stdout 非 TTY）：桥=全部、额外根目录=无、冲突一律不覆盖，
 * 全部取默认值直通，供 CI 与自动化使用。
 *
 * 所有输出挂 [create-curia/<rule>] 规则 ID；错误信息给出可操作命令。
 */

import { spawnSync } from 'node:child_process';
import {
  existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, statSync,
  symlinkSync, writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

/* ------------------------------------------------------------------ 常量 */

/** 包根：bin/ 的上一级。经 npm 安装后 import.meta.url 指向真实文件（Node 默认解析符号链接）。 */
const PKG_ROOT = fileURLToPath(new URL('../', import.meta.url));
const TEMPLATE_DIR = join(PKG_ROOT, 'template');
const MIN_NODE_MAJOR = 18;

/** 桥选择 → 模板注册表 bridges 的 consumer 取值。CLAUDE.md -> AGENTS.md 属 Claude Code。 */
const BRIDGE_CONSUMERS = { claude: 'Claude Code', codex: 'Codex' };

/** 模板注册表缺失时的桥兜底定义（正常路径由注册表 bridges 驱动，两处定义同源）。 */
const FALLBACK_BRIDGES = [
  { path: 'CLAUDE.md', target: 'AGENTS.md', consumer: 'Claude Code' },
  { path: '.claude/skills', target: '../.agents/skills', consumer: 'Claude Code' },
  { path: '.codex/skills', target: '../.agents/skills', consumer: 'Codex' },
];

/* ------------------------------------------------------------------ 输出 */

const log = (rule, msg) => console.log(`${msg} [create-curia/${rule}]`);
const warn = (rule, msg) => console.warn(`warning: create-curia: ${msg} [create-curia/${rule}]`);
const die = (rule, msg) => {
  console.error(`create-curia: ${msg} [create-curia/${rule}]`);
  process.exit(1);
};

function usage() {
  console.log(`create-curia —— 把 Curia 文档工作区生成到你的仓库（生成器，不是运行时）。 [create-curia/usage]

用法：
  npm create curia -- [--dir <目标目录>] [--defaults]
  node bin/init.mjs [--dir <目标目录>] [--defaults]

  --dir <path>   生成目标目录（默认当前工作目录）
  --defaults     非交互直通：桥=全部、额外根目录=无、冲突不覆盖
  -h, --help     显示本帮助

生成后：node scripts/install-hooks.mjs 已代跑；写第一篇与跑门禁见收尾提示。 [create-curia/usage]`);
}

/* ------------------------------------------------------------------ 纯函数（导出供测试） */

/** 桥选择答案 → 'claude' | 'codex' | 'all'；无法识别返回 null（调用方重问）。 */
export function parseBridgeChoice(raw) {
  const a = String(raw).trim().toLowerCase();
  if (a === '' || a === '3' || a === 'all' || a === 'both' || a === '全部') return 'all';
  if (a === '1' || a === 'claude' || a === 'claude code' || a === 'claude-code' || a === 'cc') return 'claude';
  if (a === '2' || a === 'codex') return 'codex';
  return null;
}

/** 额外根目录答案 → { list, bad }：逗号（中英）分隔、去重、去尾部斜杠；坏名字单列不抛错。 */
export function parseRootDirs(raw) {
  const list = [];
  const bad = [];
  for (const part of String(raw).split(/[,，]/)) {
    const name = part.trim().replace(/\/+$/, '');
    if (name === '') continue;
    if (name === '.' || name === '..' || /[\\/\s]/.test(name)) {
      bad.push(part.trim());
      continue;
    }
    if (!list.includes(name)) list.push(name);
  }
  return { list, bad };
}

/** rootDirs 合并去重：保留既有顺序，追加新名字（已存在的不重复登记）。 */
export function mergeRootDirs(current, extra) {
  const out = Array.isArray(current) ? [...current] : [];
  for (const name of extra) if (!out.includes(name)) out.push(name);
  return out;
}

/** bridges 取选择子集：all 原样，claude/codex 只留该 consumer 的条目。 */
export function filterBridges(bridges, choice) {
  if (!Array.isArray(bridges) || choice === 'all') return bridges;
  return bridges.filter((b) => b && b.consumer === BRIDGE_CONSUMERS[choice]);
}

/** 递归列出 template/ 全部条目（名字排序稳定）：保留符号链接身份，不跟随、不下钻。 */
export function walkTemplate(dir, base = '') {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const rel = base === '' ? entry.name : `${base}/${entry.name}`;
    const abs = join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      out.push({ rel, abs, kind: 'symlink' });
    } else if (entry.isDirectory()) {
      out.push({ rel, abs, kind: 'dir' });
      out.push(...walkTemplate(abs, rel));
    } else if (entry.isFile()) {
      out.push({ rel, abs, kind: 'file' });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ 小工具 */

function parseArgs(argv) {
  const opts = { dir: null, defaults: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dir' || a.startsWith('--dir=')) {
      const v = a === '--dir' ? argv[++i] : a.slice('--dir='.length);
      if (!v || v.startsWith('-')) die('usage', '--dir 需要目标目录参数，例如：node bin/init.mjs --dir /path/to/repo');
      opts.dir = v;
    } else if (a === '--defaults') {
      opts.defaults = true;
    } else if (a === '-h' || a === '--help') {
      opts.help = true;
    } else {
      die('usage', `未知参数 \`${a}\`；可用参数见 node bin/init.mjs --help`);
    }
  }
  return opts;
}

const lstatExists = (p) => {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
};

const isSymlinkTo = (p, target) => {
  try {
    return lstatSync(p).isSymbolicLink() && readlinkSync(p) === target;
  } catch {
    return false;
  }
};

const isGitRepo = (dir) => spawnSync('git', ['rev-parse', '--git-dir'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).status === 0;

async function ask(rl, rule, text) {
  try {
    return await rl.question(`? ${text} [create-curia/${rule}]: `);
  } catch {
    die('aborted', '读取输入中断（EOF 或 Ctrl+C）——请在终端里交互运行，或加 --defaults 用默认值直通');
  }
}

async function askYesNo(rl, rule, text) {
  const a = String(await ask(rl, rule, `${text}（y/N）`)).trim().toLowerCase();
  return a === 'y' || a === 'yes' || a === '是';
}

function isMain() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ 主流程 */

async function run(opts, interactive, rl) {
  log('init', 'create-curia：把 Curia 文档工作区生成到你的仓库（生成器，不是运行时）');
  if (!interactive) log('non-interactive', '非交互模式（--defaults 或非 TTY）：桥=全部、额外根目录=无、冲突一律不覆盖');

  /* 1) 载荷与桥定义（先验证包的完整性，再碰目标目录） */
  if (!existsSync(TEMPLATE_DIR)) {
    die('template-missing', `包内 template/ 载荷缺失：${TEMPLATE_DIR}；安装包不完整——用 npm create curia@latest 重试，或改用「克隆模板仓自改」形态`);
  }
  const entries = walkTemplate(TEMPLATE_DIR);
  if (entries.length === 0) warn('template-empty', '包内 template/ 为空（载荷尚未落地？）——本次只做目标检查，没有可复制内容；载荷到位后重跑');
  let templateBridges = null;
  const tplRegPath = join(TEMPLATE_DIR, '.agents', 'doc-types.json');
  if (existsSync(tplRegPath)) {
    try {
      const reg = JSON.parse(readFileSync(tplRegPath, 'utf8'));
      if (Array.isArray(reg.bridges)) templateBridges = reg.bridges;
    } catch (e) {
      warn('template-registry', `模板注册表解析失败（${e.message}），桥改用内置清单`);
    }
  }
  const bridgeDefs = templateBridges ?? FALLBACK_BRIDGES;
  const bridgePaths = new Set(bridgeDefs.map((b) => b.path));
  const inBridgeTree = (rel) => [...bridgePaths].some((p) => rel === p || rel.startsWith(`${p}/`));
  // 桥路径的祖先目录（如 .claude、.codex）由桥步按需创建——桥被跳过时不留下空目录
  const bridgeParentDirs = new Set();
  for (const p of bridgePaths) {
    const parts = p.split('/');
    for (let i = 1; i < parts.length; i++) bridgeParentDirs.add(parts.slice(0, i).join('/'));
  }

  /* 2) 定位目标（先守卫再创建：包内目标不该被顺手建出来） */
  const target = resolve(opts.dir ?? process.cwd());
  const pkgReal = realpathSync(PKG_ROOT);
  const inside = (p) => p === pkgReal || p.startsWith(pkgReal + sep);
  // 目标可能尚不存在：按「最近存在的祖先的 realpath + 剩余段」解析，否则符号链接前缀
  // （macOS 的 /tmp→/private/tmp）会让未存在的包内路径绕过守卫——先建目录再落 59 个文件
  const realpathDeep = (p) => {
    let prefix = p;
    const rest = [];
    while (true) {
      try {
        return join(realpathSync(prefix), ...rest);
      } catch {
        const parent = dirname(prefix);
        if (parent === prefix) return p; // 到根都不存在：按字面参与守卫
        rest.unshift(basename(prefix));
        prefix = parent;
      }
    }
  };
  const targetReal = realpathDeep(target);
  if (inside(target) || inside(targetReal)) {
    die('target-in-package', `目标不能落在 create-curia 包内：${target}；请在你要接入的仓库里运行（不指定 --dir 时用当前工作目录）`);
  }
  if (existsSync(target)) {
    if (!lstatSync(target).isDirectory()) die('target-not-dir', `目标已存在且不是目录：${target}；把 --dir 指向目录，或先移走同名文件`);
  } else {
    mkdirSync(target, { recursive: true });
    log('target-created', `已新建目标目录：${target}`);
  }
  log('target', `目标仓库：${target}`);

  /* 3) 安全检查：既有 .agents/ 与 AGENTS.md 逐项问，默认否（保留现有） */
  const preAgents = existsSync(join(target, '.agents'));
  const preRules = existsSync(join(target, 'AGENTS.md'));
  let keepAgents = false;
  let keepRules = false;
  if (preAgents) {
    keepAgents = interactive
      ? !(await askYesNo(rl, 'overwrite-agents', '目标已存在 .agents/（可能已是 Curia 工作区）。覆盖其中同名文件？（默认否：保留现有）'))
      : true;
    if (keepAgents) warn('overwrite-kept', '保留既有 .agents/：不覆盖、不改写注册表、不创建桥；如需模板版本，备份后移走既有目录再重跑');
  }
  if (preRules) {
    keepRules = interactive
      ? !(await askYesNo(rl, 'overwrite-rules', '目标已存在 AGENTS.md。覆盖它？（默认否：保留现有）'))
      : true;
    if (keepRules) warn('overwrite-kept', '保留既有 AGENTS.md：跳过该文件；如需模板版本，备份后删除再重跑');
  }

  /* 4) 两个交互问题（非交互取默认） */
  let choice = 'all';
  let extraRootDirs = [];
  if (interactive) {
    for (;;) {
      const parsed = parseBridgeChoice(await ask(rl, 'prompt-bridge', '生成哪些 CLI 桥？1) Claude Code 2) Codex 3) 全部（默认 3）'));
      if (parsed) {
        choice = parsed;
        break;
      }
      console.log('  请输入 1 / 2 / 3（或 claude / codex / all） [create-curia/bad-bridge]');
    }
    const parsed = parseRootDirs(await ask(rl, 'prompt-rootdirs', '额外的仓库根目录（逗号分隔，如 src,apps；直接回车跳过）'));
    extraRootDirs = parsed.list;
    for (const badName of parsed.bad) {
      warn('bad-rootdir', `忽略无效的根目录名 \`${badName}\`：不能含空格或路径分隔符；请登记顶层目录名`);
    }
  }
  log('answers', `选择：桥=${choice === 'all' ? '全部' : choice}；额外根目录=${extraRootDirs.length ? extraRootDirs.join('、') : '无'}`);

  /* 5) 逐项复制（保留符号链接；桥树由注册表驱动单独创建） */
  let created = 0;
  let overwritten = 0;
  let unchanged = 0;
  let kept = 0;
  const conflicts = [];
  const copyErrors = [];
  // npm 安装会把包内 .gitignore 重命名为 .npmignore（实查 npm 11：tarball 里是 .gitignore，
  // 装进 node_modules 后变 .npmignore）。载荷里两种名字都当 gitignore 样例，落盘统一为 .gitignore；
  // 两者同时存在时以 .gitignore 为准，.npmignore 不再落盘（避免在用户仓库留下同名杂物）。
  const hasGitignoreEntry = entries.some((e) => e.rel === '.gitignore');
  const dstRelOf = (rel) => {
    if (rel === '.npmignore') return hasGitignoreEntry ? null : '.gitignore';
    return rel;
  };
  for (const entry of entries) {
    if (inBridgeTree(entry.rel)) continue;
    if (entry.kind === 'dir' && bridgeParentDirs.has(entry.rel)) continue; // 桥的祖先目录留给桥步按需创建
    const dstRel = dstRelOf(entry.rel);
    if (dstRel === null) continue;
    if (keepRules && entry.rel === 'AGENTS.md') {
      kept++;
      continue;
    }
    if (keepAgents && entry.rel.startsWith('.agents/')) {
      kept++;
      continue;
    }
    const dst = join(target, dstRel);
    try {
      if (entry.kind === 'dir') {
        mkdirSync(dst, { recursive: true });
        continue;
      }
      const dstExists = lstatExists(dst);
      if (entry.kind === 'symlink') {
        const linkTarget = readlinkSync(entry.abs);
        if (dstExists) {
          if (isSymlinkTo(dst, linkTarget)) unchanged++;
          else conflicts.push(entry.rel);
          continue;
        }
        mkdirSync(dirname(dst), { recursive: true });
        symlinkSync(linkTarget, dst);
        created++;
        continue;
      }
      const content = readFileSync(entry.abs);
      const mode = statSync(entry.abs).mode & 0o777;
      if (dstExists) {
        if (lstatSync(dst).isFile() && readFileSync(dst).equals(content)) {
          unchanged++;
          continue;
        }
        // .agents/ 与 AGENTS.md 的冲突已在第 3 步问过；到这里说明用户选了覆盖（或本就不存在）
        if (entry.rel === 'AGENTS.md' || entry.rel.startsWith('.agents/')) {
          writeFileSync(dst, content, { mode });
          overwritten++;
          continue;
        }
        conflicts.push(dstRel);
        continue;
      }
      mkdirSync(dirname(dst), { recursive: true });
      writeFileSync(dst, content, { mode });
      created++;
    } catch (e) {
      copyErrors.push(`${dstRel} — ${e.message}`);
    }
  }

  /* 6) 桥：注册表 bridges（或内置兜底）驱动，按选择创建符号链接 */
  const chosenConsumers = choice === 'all' ? null : new Set([BRIDGE_CONSUMERS[choice]]);
  const bridgeReady = new Set();
  const bridgeCreated = [];
  if (entries.length === 0) {
    // 空载荷：无可建桥，template-empty 已提示
  } else if (keepAgents) {
    const wanted = bridgeDefs.filter((b) => !chosenConsumers || chosenConsumers.has(b.consumer));
    const allPresent = wanted.length > 0 && wanted.every((b) => isSymlinkTo(join(target, b.path), b.target));
    if (allPresent) log('bridges-exist', '保留既有 .agents/ 不动；所选桥均已存在且指向正确');
    else warn('bridges-skipped', '保留既有 .agents/：不创建也不改动桥；需要时按 .agents/README.md 的「桥」节手工处理');
  } else {
    for (const b of bridgeDefs) {
      if (chosenConsumers && !chosenConsumers.has(b.consumer)) {
        log('bridge-subset', `按选择跳过桥 ${b.path}（${b.consumer}）`);
        continue;
      }
      const dst = join(target, b.path);
      const linkTargetAbs = resolve(join(target, dirname(b.path)), b.target);
      if (!existsSync(linkTargetAbs)) {
        warn('bridge-unavailable', `未创建 ${b.path}：链接目标 ${b.target} 在目标仓不存在——载荷到位后重跑，或手工 ln -s ${b.target} ${b.path}`);
        continue;
      }
      if (lstatExists(dst)) {
        if (isSymlinkTo(dst, b.target)) {
          bridgeReady.add(b.path);
          log('bridge-exists', `${b.path} 已是正确符号链接，保持`);
          continue;
        }
        const ok = interactive
          ? await askYesNo(rl, 'bridge-conflict', `${b.path} 已存在且不是指向 ${b.target} 的符号链接。覆盖为符号链接？（默认否）`)
          : false;
        if (!ok) {
          warn('bridge-conflict', `未覆盖既有 ${b.path}：把已有内容并入 ${b.target} 后删除该文件再重跑，或手工 ln -s ${b.target} ${b.path}`);
          continue;
        }
        rmSync(dst, { recursive: true, force: true });
      }
      mkdirSync(dirname(dst), { recursive: true });
      symlinkSync(b.target, dst);
      bridgeReady.add(b.path);
      bridgeCreated.push(b.path);
      log('bridge-created', `已创建桥：${b.path} -> ${b.target}（${b.consumer}）`);
    }
  }

  /* 7) 注册表改写：rootDirs 合并去重；bridges 取选择子集并与实际桥同步 */
  let registryChanged = false;
  const regPath = join(target, '.agents', 'doc-types.json');
  if (keepAgents) {
    // 保留既有 .agents/：注册表属对方，不动（overwrite-kept 已提示）
  } else if (!existsSync(regPath)) {
    warn('registry-missing', '目标缺少 .agents/doc-types.json，跳过注册表改写（载荷未落地时属预期）；落地后重跑，或手工改 rootDirs / bridges 再跑 node scripts/gen-doc-types.mjs');
  } else {
    let reg;
    try {
      reg = JSON.parse(readFileSync(regPath, 'utf8'));
    } catch (e) {
      die('registry-rewrite-failed', `注册表不是合法 JSON（.agents/doc-types.json）：${e.message}；修正后重跑`);
    }
    const wl = (reg.workspaceLayout ??= {});
    const current = Array.isArray(wl.rootDirs) ? wl.rootDirs : [];
    const merged = mergeRootDirs(current, extraRootDirs);
    const added = merged.filter((d) => !current.includes(d));
    const bridgesBefore = JSON.stringify(reg.bridges ?? null);
    if (Array.isArray(reg.bridges)) {
      reg.bridges = filterBridges(reg.bridges, choice).filter((b) => !bridgePaths.has(b.path) || bridgeReady.has(b.path));
    }
    const bridgesAfter = JSON.stringify(reg.bridges ?? null);
    if (added.length) wl.rootDirs = merged;
    registryChanged = added.length > 0 || bridgesBefore !== bridgesAfter;
    if (registryChanged) {
      writeFileSync(regPath, `${JSON.stringify(reg, null, 2)}\n`);
      const bits = [];
      if (added.length) bits.push(`rootDirs 新增 ${added.map((d) => `\`${d}\``).join('、')}`);
      if (bridgesBefore !== bridgesAfter) bits.push(`bridges 同步为 ${(reg.bridges ?? []).map((b) => b.path).join('、') || '空'}`);
      log('registry-rewritten', `注册表已改写：${bits.join('；')}`);
    } else {
      log('registry-unchanged', '注册表无需改写（桥=全部且无新增根目录）');
    }
  }

  /* 8) 投影重生成（注册表变了才需要；用目标仓自己的引擎跑） */
  if (registryChanged) {
    const genScript = join(target, 'scripts', 'gen-doc-types.mjs');
    if (!existsSync(genScript)) {
      warn('projection-skip', '注册表已改但 scripts/gen-doc-types.mjs 不存在：投影未重生成——接入后先跑 node scripts/gen-doc-types.mjs 再跑门禁');
    } else {
      const r = spawnSync(process.execPath, ['scripts/gen-doc-types.mjs'], { cwd: target, encoding: 'utf8' });
      if (r.status !== 0) {
        die('projection-failed', `投影重生成失败：${(r.stderr || r.stdout || '').trim().split('\n')[0] || '无输出'}；修好后在目标仓跑 node scripts/gen-doc-types.mjs`);
      }
      log('projection-regenerated', '投影 .agents/doc-types.md 已按新注册表重生成');
    }
  }

  /* 9) 装 pre-commit 钩子 */
  const hooksScript = join(target, 'scripts', 'install-hooks.mjs');
  let hooksOk = false;
  if (!existsSync(hooksScript)) {
    warn('hooks-skip', 'scripts/install-hooks.mjs 不存在，跳过钩子安装（载荷未落地时属预期）；落地后跑 node scripts/install-hooks.mjs');
  } else if (!isGitRepo(target)) {
    warn('hooks-deferred', '目标还不是 git 仓库：先 git init，再跑 node scripts/install-hooks.mjs（pre-commit 门禁靠它自动跑）');
  } else {
    const r = spawnSync(process.execPath, ['scripts/install-hooks.mjs'], { cwd: target, encoding: 'utf8' });
    log('hooks-run', '运行 node scripts/install-hooks.mjs（用目标仓自带的工具）：');
    for (const line of `${r.stdout ?? ''}${r.stderr ?? ''}`.split('\n')) if (line.trim()) console.log(`  ${line}`);
    if (r.status !== 0) {
      warn('hooks-failed', '钩子安装未完成（见上方输出）；常见原因：钩子目录有别的工具装的同名钩子——备份后删除再跑 node scripts/install-hooks.mjs');
    } else {
      hooksOk = true;
      log('hooks-installed', 'pre-commit 门禁已装好：提交时自动跑');
    }
  }

  /* 10) 汇总与收尾 */
  if (conflicts.length) {
    const head = conflicts.slice(0, 8).map((p) => `\`${p}\``).join('、');
    warn('copy-conflict', `以下 ${conflicts.length} 项已存在且内容不同，未覆盖：${head}${conflicts.length > 8 ? ' 等' : ''}；如需模板版本：备份后删除冲突项再重跑，或手工合并`);
  }
  if (copyErrors.length) {
    for (const e of copyErrors) console.error(`create-curia: 复制失败 — ${e} [create-curia/copy-error]`);
    console.error(`create-curia: ${copyErrors.length} 项复制失败，工作区可能不完整；修好后重跑（已一致的文件会自动跳过） [create-curia/copy-failed]`);
    process.exitCode = 1;
  }
  log('done', `完成：目标 ${target} — 新建 ${created}、覆盖 ${overwritten}、已一致 ${unchanged}、保留 ${kept}；桥 ${bridgeCreated.length} 条`);
  console.log('剩余动作（三步上手的第 3 步）： [create-curia/next-steps]');
  if (!hooksOk) console.log('  0. 装好提交门禁：git init（若尚未）后跑 node scripts/install-hooks.mjs [create-curia/next-steps]');
  console.log('  1. 写第一篇：node scripts/new-doc.mjs --list 看类型；再用 node scripts/new-doc.mjs --type <type> --topic <主题> 建档（决策笔记用 write-note 技能，不走脚手架） [create-curia/next-steps]');
  console.log('  2. 跑门禁：node scripts/run-checks.mjs；全绿即接入完成 [create-curia/next-steps]');
  console.log('  之后一切修改都是你的（fork-and-own）：本工具只有 init，没有 upgrade / check 驻留子命令 [create-curia/fork-and-own]');
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    usage();
    return;
  }
  if (Number(process.versions.node.split('.')[0]) < MIN_NODE_MAJOR) {
    die('node-version', `需要 Node >= ${MIN_NODE_MAJOR}（当前 ${process.versions.node}）：升级 node 后重跑，或改用「克隆模板仓自改」形态`);
  }
  const interactive = !opts.defaults && process.stdout.isTTY === true && process.stdin.isTTY === true;
  const rl = interactive ? createInterface({ input: process.stdin, output: process.stdout }) : null;
  try {
    await run(opts, interactive, rl);
  } finally {
    rl?.close();
  }
}

if (isMain()) {
  main().catch((e) => {
    console.error(`create-curia: 未预期错误：${e?.message ?? e} [create-curia/unexpected]`);
    if (e?.stack) console.error(e.stack);
    process.exit(1);
  });
}