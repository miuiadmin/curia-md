#!/usr/bin/env node
/**
 * create-curia —— Curia 2.2 文档工作区生成器。
 *
 * 定位（红线，见 ../README.md）：生成器，不是运行时。只做三件事：
 *   - 复制包内 template/ 载荷（逐项；桥树留给桥步）；
 *   - 创建桥符号链接（目标路径空闲即建；被占用时打印手工命令并跳过）；
 *   - 打印下一步。
 * 无提问、不装钩子、不运行载荷内任何脚本；目标已存在且内容不同的文件一律不覆盖，
 * 只列出。生成后目标仓与本包再无关系（fork-and-own）——本工具只有 init，没有驻留子命令。
 *
 * 用法：
 *   node bin/init.mjs [--dir <目标目录>] [--defaults]
 *
 * --defaults 兼容保留：init 已无提问，等价默认行为。退出码：0 载荷落地且三条桥全部接上；
 * 1 复制 I/O 失败；2 用法与守卫；3 桥未接上——写操作完成但机制没接上，不静默当成功。
 */

import {
  existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, statSync,
  symlinkSync, writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/* ------------------------------------------------------------------ 常量 */

/** 包根：bin/ 的上一级。入口文件先过 realpath 再上溯——preserve-symlinks-main 形态下 import.meta.url 停在符号链接上，直接上溯会把包根指到链接所在目录、模板找不到。 */
const PKG_ROOT = dirname(dirname(realpathSync(fileURLToPath(import.meta.url))));
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
/** 用法与守卫错误 → 退出码 2；I/O 类失败显式传 1（口径见文件头与 --help 的退出码表）。 */
const die = (msg, code = 2) => {
  console.error(`create-curia: ${msg}`);
  process.exit(code);
};

function usage() {
  console.log(`create-curia —— 把 Curia 2.2 文档工作区生成到你的仓库（生成器，不是运行时）。

用法：
  node bin/init.mjs [--dir <目标目录>] [--defaults]

  --dir <path>   生成目标目录（默认当前工作目录）
  --defaults     兼容保留：init 无提问，等价默认行为
  -h, --help     显示本帮助

退出码：0 载荷落地且三条桥全部接上；1 复制 I/O 失败；2 用法与守卫；3 桥未接上。`);
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
    // 两侧都过 realpath：preserve-symlinks-main 形态下 import.meta.url 停在符号链接上，只解析 argv[1] 会判假、入口静默空转（无输出、退出码 0）
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
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
    die(`包内 template/ 载荷缺失：${TEMPLATE_DIR}；分发件不完整——重新取一份完整的分发包（源码树或发布制品 tarball）`);
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
  // 落点判据（复制步与桥步共用）：真解析后必须落在目标仓内——目标仓里预先做成的、指向仓外的符号链接一律拦下
  const insideTarget = (p) => p === targetReal || p.startsWith(targetReal + sep);
  /** 自 p 上溯到最近的存在祖先再真解析——嵌套新目录自身不存在，只看它会漏掉「父级是仓外符号链接」这一形态 */
  const landsInside = (p) => {
    for (let cur = p; ;) {
      try { return insideTarget(realpathSync(cur)); } catch {
        const up = dirname(cur);
        if (up === cur) return true;
        cur = up;
      }
    }
  };
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
      die(`无法创建目标目录：${target} — ${e.message}`, 1);
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
    // 落点必须在目标仓内：目标仓若把 .agents/、docs/ 之类预先做成指向仓外的符号链接，
    // 载荷会整份写到仓外、git 完全看不见（与桥父级同族的假成功）
    const landPath = entry.kind === 'dir' ? dst : dirname(dst);
    if (!landsInside(landPath)) {
      copyErrors.push(`${entry.rel} — 落点 ${landPath} 解析到目标仓之外；载荷会写到仓外、git 看不见（先决定该符号链接的去留再重跑）`);
      continue;
    }
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

  /* 4) 桥：空闲即建符号链接；被占用打印命令跳过。三分计数——「装了」与「接上了」必须可分辨。
     判据是「真解析得到、且落在目标仓内」：readlink 字符串相等不够——父级是符号链接时链接会落到仓外并悬空。 */
  const bridgesCreated = [], bridgesAlready = [], bridgesMissing = [];
  for (const b of BRIDGES) {
    const dst = join(target, b.path);
    const linkTargetAbs = resolve(join(target, dirname(b.path)), b.target);
    if (!existsSync(linkTargetAbs)) {
      const why = `链接目标 ${b.target} 在目标仓不存在——先确认载荷已复制，或手工 ln -s ${b.target} ${b.path}`;
      warn(`未创建 ${b.path}：${why}`);
      bridgesMissing.push({ path: b.path, why });
      continue;
    }
    // 父级必须真解析到目标仓内：父级是符号链接（如 .claude 指向 dotfiles 共享目录）时，
    // 相对目标 ../.agents/skills 会按落点解析到仓外，桥必然悬空——建了也是死桥，且写到仓外
    const parent = dirname(dst);
    let parentReal = null;
    try { parentReal = realpathSync(parent); } catch { /* 父级尚不存在，稍后 mkdirSync 创建 */ }
    if (parentReal !== null && !insideTarget(parentReal)) {
      const why = `父级目录 ${parent} 解析到目标仓之外（${parentReal}）——相对目标 ${b.target} 在这里解析不到，桥必然悬空；先决定该符号链接的去留（删掉，或换一种暴露方式）再重跑`;
      warn(`未创建 ${b.path}：${why}`);
      bridgesMissing.push({ path: b.path, why });
      continue;
    }
    if (lstatExists(dst)) {
      if (isSymlinkTo(dst, b.target) && existsSync(dst)) {
        log(`桥已就位：${b.path} -> ${b.target}`);
        bridgesAlready.push(b.path);
        continue;
      }
      if (isSymlinkTo(dst, b.target)) {
        const why = `符号链接指向正确但解析不到（悬空）——按它所在位置解析 ${b.target} 不存在；备份移走后重跑 init`;
        warn(`未创建 ${b.path}：${why}`);
        bridgesMissing.push({ path: b.path, why });
        continue;
      }
      const why = `路径已被占用（不是指向 ${b.target} 的符号链接）——备份移走后重跑 init，或手工执行：mv ${b.path} ${b.path}.pre-curia && ln -s ${b.target} ${b.path}`;
      warn(`未创建 ${b.path}：${why}`);
      bridgesMissing.push({ path: b.path, why });
      continue;
    }
    try {
      mkdirSync(dirname(dst), { recursive: true });
      symlinkSync(b.target, dst);
    } catch (e) {
      const why = `${e.message}——占用路径先备份移走再重跑，或手工执行：mv ${b.path} ${b.path}.pre-curia && ln -s ${b.target} ${b.path}`;
      warn(`未创建 ${b.path}：${why}`);
      bridgesMissing.push({ path: b.path, why });
      continue;
    }
    if (!existsSync(dst)) {
      const why = `刚建的符号链接解析不到（悬空）——按它所在位置解析 ${b.target} 不存在`;
      warn(`未创建 ${b.path}：${why}`);
      bridgesMissing.push({ path: b.path, why });
      continue;
    }
    bridgesCreated.push(b.path);
    log(`已创建桥：${b.path} -> ${b.target}`);
  }

  /* 5) 汇总 */
  if (conflicts.length) {
    warn(`以下 ${conflicts.length} 项已存在且内容不同，未覆盖（逐条列出，不截断）：`);
    for (const p of conflicts) console.error(`create-curia:   ${p}`);
    warn('如需载荷版本：备份后移走再重跑，或手工合并');
  }
  if (copyErrors.length) {
    for (const e of copyErrors) console.error(`create-curia: 复制失败 — ${e}`);
    console.error(`create-curia: ${copyErrors.length} 项复制失败，工作区可能不完整；修好后重跑（已一致的文件会自动跳过）`);
    process.exitCode = 1;
  }
  log(`完成：目标 ${target} — 新建 ${created}、已一致 ${unchanged}、保留 ${kept}；桥 ${BRIDGES.length} 条：新建 ${bridgesCreated.length}、已就位 ${bridgesAlready.length}、未接上 ${bridgesMissing.length}`);
  if (bridgesMissing.length) {
    console.error(`create-curia: ${bridgesMissing.length} 条桥未接上——载荷已落地，但 agent CLI 读不到规则与技能（退出码 3）：`);
    for (const m of bridgesMissing) console.error(`create-curia:   ${m.path} — ${m.why}`);
    if (!process.exitCode) process.exitCode = 3;
  }

  /* 6) 下一步 */
  console.log('下一步：');
  console.log('  1. 读 `.agents/README.md`（规范全文）与 `AGENTS.md`，在 AGENTS.md 里补上你的项目名与既有约束。');
  console.log('  2. 建档：按 `.agents/README.md` 的「规范格式（骨架）」节手抄骨架，落 3 行头块。');
  console.log('  3. 自检：`node .agents/tools/check-docs.mjs`（可选）；要提交拦截，在 `.git/hooks/pre-commit` 里写一行 `node .agents/tools/check-docs.mjs --strict`，再 `chmod +x .git/hooks/pre-commit`——不加执行位 git 会静默忽略钩子；装完验证：提交一份坏文档应被拦下。');
  console.log('  之后一切修改都是你的（fork-and-own）：本工具只有 init，没有 upgrade / check 驻留子命令。');
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    usage();
    return;
  }
  if (Number(process.versions.node.split('.')[0]) < MIN_NODE_MAJOR) {
    die(`需要 Node >= ${MIN_NODE_MAJOR}（当前 ${process.versions.node}）：升级 node 后重跑；没有 Node 的环境可只采用载荷的文本约定部分（规范「适用边界」）`);
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
