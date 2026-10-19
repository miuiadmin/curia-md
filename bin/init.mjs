#!/usr/bin/env node
/**
 * create-curia —— Curia 2.2 文档工作区生成器（`npm create curia` 的入口）。
 *
 * 定位（红线，见 ../README.md）：生成器，不是运行时。只做三件事：
 *   - 复制包内 template/ 载荷（逐项；桥树留给桥步）；
 *   - 创建桥符号链接（目标路径空闲即建；被占用时打印手工命令并跳过）；
 *   - 打印下一步。
 * 无提问、不装钩子、不运行载荷内任何脚本；目标已存在且内容不同的文件一律不覆盖，
 * 只列出。生成后目标仓与本包再无关系（fork-and-own）——本工具只有 init，没有驻留子命令。
 *
 * 用法：
 *   npm create curia [-- --dir <目标目录>] [-- --defaults]
 *   node bin/init.mjs [--dir <目标目录>] [--defaults]
 *
 * --defaults 兼容保留：init 已无提问，等价默认行为（CI 与自动化可继续直传）。
 */

import {
  existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, statSync,
  symlinkSync, writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/* ------------------------------------------------------------------ 常量 */

/** 包根：bin/ 的上一级。经 npm 安装后 import.meta.url 指向真实文件（Node 默认解析符号链接）。 */
const PKG_ROOT = fileURLToPath(new URL('../', import.meta.url));
const TEMPLATE_DIR = join(PKG_ROOT, 'template');
const MIN_NODE_MAJOR = 18;

/** 桥定义（内联，与载荷 AGENTS.md「桥」节同源）：目标路径 → 链接目标（相对所在目录）。 */
const BRIDGES = [
  { path: 'CLAUDE.md', target: 'AGENTS.md' },
  { path: '.claude/skills', target: '../.agents/skills' },
  { path: '.codex/skills', target: '../.agents/skills' },
];

/* ------------------------------------------------------------------ 输出 */

const log = (msg) => console.log(msg);
const warn = (msg) => console.warn(`warning: create-curia: ${msg}`);
const die = (msg) => {
  console.error(`create-curia: ${msg}`);
  process.exit(1);
};

function usage() {
  console.log(`create-curia —— 把 Curia 2.2 文档工作区生成到你的仓库（生成器，不是运行时）。

用法：
  npm create curia -- [--dir <目标目录>] [--defaults]
  node bin/init.mjs [--dir <目标目录>] [--defaults]

  --dir <path>   生成目标目录（默认当前工作目录）
  --defaults     兼容保留：init 无提问，等价默认行为
  -h, --help     显示本帮助`);
}

/* ------------------------------------------------------------------ 小工具 */

function parseArgs(argv) {
  const opts = { dir: null, defaults: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dir' || a.startsWith('--dir=')) {
      const v = a === '--dir' ? argv[++i] : a.slice('--dir='.length);
      if (!v || v.startsWith('-')) die('--dir 需要目标目录参数，例如：node bin/init.mjs --dir /path/to/repo');
      opts.dir = v;
    } else if (a === '--defaults') {
      opts.defaults = true;
    } else if (a === '-h' || a === '--help') {
      opts.help = true;
    } else {
      die(`未知参数 \`${a}\`；可用参数见 node bin/init.mjs --help`);
    }
  }
  return opts;
}

/** 递归列出 template/ 全部条目（名字排序稳定）：保留符号链接身份，不跟随、不下钻。 */
function walkTemplate(dir, base = '') {
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

function isMain() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ 主流程 */

function run(opts) {
  log('create-curia：把 Curia 2.2 文档工作区生成到你的仓库（生成器，不是运行时）');
  if (opts.defaults) log('--defaults：直通（init 无提问，参数为兼容保留）');

  /* 1) 先验证载荷完整性，再碰目标目录 */
  if (!existsSync(TEMPLATE_DIR)) {
    die(`包内 template/ 载荷缺失：${TEMPLATE_DIR}；安装包不完整——用 npm create curia@latest 重试，或改用「克隆模板仓自改」形态`);
  }
  const entries = walkTemplate(TEMPLATE_DIR);
  if (entries.length === 0) die('包内 template/ 为空：没有可复制内容；安装包不完整，请重试');

  /* 2) 定位目标（先守卫再创建：包内目标不该被顺手建出来） */
  const target = resolve(opts.dir ?? process.cwd());
  const pkgReal = realpathSync(PKG_ROOT);
  const inside = (p) => p === pkgReal || p.startsWith(pkgReal + sep);
  // 目标可能尚不存在：按「最近存在的祖先的 realpath + 剩余段」解析，否则符号链接前缀
  // （macOS 的 /tmp→/private/tmp）会让未存在的包内路径绕过守卫
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
    die(`目标不能落在 create-curia 包内：${target}；请在你要接入的仓库里运行（不指定 --dir 时用当前工作目录）`);
  }
  if (lstatExists(target)) {
    let isDir = false;
    try {
      isDir = statSync(target).isDirectory(); // 跟随符号链接：指向目录的符号链接算目录（macOS 的 /tmp 即如此）
    } catch {
      // 悬空符号链接等：按「不是目录」处理，给可读错误而不是裸崩
    }
    if (!isDir) die(`目标已存在且不是目录：${target}；把 --dir 指向目录，或先移走同名文件`);
  } else {
    try {
      mkdirSync(target, { recursive: true });
    } catch (e) {
      die(`无法创建目标目录：${target} — ${e.message}`);
    }
    log(`已新建目标目录：${target}`);
  }
  log(`目标仓库：${target}`);

  /* 3) 逐项复制（保留符号链接；桥树与桥的祖先目录留给桥步） */
  const bridgePaths = new Set(BRIDGES.map((b) => b.path));
  const inBridgeTree = (rel) => [...bridgePaths].some((p) => rel === p || rel.startsWith(`${p}/`));
  const bridgeParentDirs = new Set();
  for (const p of bridgePaths) {
    const parts = p.split('/');
    for (let i = 1; i < parts.length; i++) bridgeParentDirs.add(parts.slice(0, i).join('/'));
  }
  let created = 0;
  let unchanged = 0;
  let kept = 0;
  const conflicts = [];
  const copyErrors = [];
  for (const entry of entries) {
    if (inBridgeTree(entry.rel)) continue;
    if (entry.kind === 'dir' && bridgeParentDirs.has(entry.rel)) continue;
    const dst = join(target, entry.rel);
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
          else {
            kept++;
            conflicts.push(entry.rel);
          }
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
        kept++;
        conflicts.push(entry.rel);
        continue;
      }
      mkdirSync(dirname(dst), { recursive: true });
      writeFileSync(dst, content, { mode });
      created++;
    } catch (e) {
      copyErrors.push(`${entry.rel} — ${e.message}`);
    }
  }

  /* 4) 桥：空闲即建符号链接；被占用打印命令跳过 */
  const bridgesCreated = [];
  for (const b of BRIDGES) {
    const dst = join(target, b.path);
    const linkTargetAbs = resolve(join(target, dirname(b.path)), b.target);
    if (!existsSync(linkTargetAbs)) {
      warn(`未创建 ${b.path}：链接目标 ${b.target} 在目标仓不存在——先确认载荷已复制，或手工 ln -s ${b.target} ${b.path}`);
      continue;
    }
    if (lstatExists(dst)) {
      if (isSymlinkTo(dst, b.target)) {
        log(`桥已就位：${b.path} -> ${b.target}`);
        continue;
      }
      warn(`未创建 ${b.path}：路径已被占用（不是指向 ${b.target} 的符号链接）——备份后删除该路径再重跑，或手工执行 ln -s ${b.target} ${b.path}`);
      continue;
    }
    try {
      mkdirSync(dirname(dst), { recursive: true });
      symlinkSync(b.target, dst);
    } catch (e) {
      warn(`未创建 ${b.path}：${e.message}——占用路径先备份移走再重跑，或手工执行 ln -s ${b.target} ${b.path}`);
      continue;
    }
    bridgesCreated.push(b.path);
    log(`已创建桥：${b.path} -> ${b.target}`);
  }

  /* 5) 汇总 */
  if (conflicts.length) {
    const head = conflicts.slice(0, 8).map((p) => `\`${p}\``).join('、');
    warn(`以下 ${conflicts.length} 项已存在且内容不同，未覆盖：${head}${conflicts.length > 8 ? ' 等' : ''}；如需载荷版本：备份后移走再重跑，或手工合并`);
  }
  if (copyErrors.length) {
    for (const e of copyErrors) console.error(`create-curia: 复制失败 — ${e}`);
    console.error(`create-curia: ${copyErrors.length} 项复制失败，工作区可能不完整；修好后重跑（已一致的文件会自动跳过）`);
    process.exitCode = 1;
  }
  log(`完成：目标 ${target} — 新建 ${created}、已一致 ${unchanged}、保留 ${kept}；桥 ${bridgesCreated.length} 条`);

  /* 6) 下一步 */
  console.log('下一步：');
  console.log('  1. 读 `.agents/README.md`（规范全文）与 `AGENTS.md`，在 AGENTS.md 里补上你的项目名与既有约束。');
  console.log('  2. 建档：按 `.agents/README.md` 的「规范格式（骨架）」节手抄骨架，落 3 行头块。');
  console.log('  3. 自检：`node .agents/tools/check-docs.mjs`（可选）；要提交拦截，自己写一行 pre-commit：`node .agents/tools/check-docs.mjs --strict`。');
  console.log('  之后一切修改都是你的（fork-and-own）：本工具只有 init，没有 upgrade / check 驻留子命令。');
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    usage();
    return;
  }
  if (Number(process.versions.node.split('.')[0]) < MIN_NODE_MAJOR) {
    die(`需要 Node >= ${MIN_NODE_MAJOR}（当前 ${process.versions.node}）：升级 node 后重跑，或改用「克隆模板仓自改」形态`);
  }
  run(opts);
}

if (isMain()) {
  try {
    main();
  } catch (e) {
    console.error(`create-curia: 未预期错误：${e?.message ?? e}`);
    if (e?.stack) console.error(e.stack);
    process.exit(1);
  }
}
