#!/usr/bin/env node
/**
 * fix-doc.mjs —— 机械写作规则的一键修复器（纯 node 标准库、零依赖）。
 *
 * 只修「机器能改对」的规则，检查与修复共用 doc-lib 的同一份字符类（一事实一归属）：
 *   1) prose/cjk-space             中英文/数字之间补半角空格
 *   2) prose/halfwidth-punct       与中文直接相邻的半角标点 , ; : ! ? ( ) 转全角
 *   3) layout/trailing-whitespace  行尾空白（fenced code 与 HTML 注释内不动）
 *   4) layout/consecutive-blank    连续空行压成一个（同上，栅栏内不动）
 *   5) layout/eof-newline  结尾恰好一个换行（尾部多余空行一并收整——门禁只拦缺换行，
 *      多余空行属编辑卫生，修复器顺手收，记账用修复器自己的标签）
 *
 * 绝不自动修（要语义判断，留给作者与门禁报错）：一段一物理行、禁用术语、栅栏语言标记、
 * 表格列数、标题层级、链接文本与正文之间的跨界空格（该在内侧还是外侧补空格需作者判断）。
 * 保护区：行内代码、链接目标、URL、HTML 标签、frontmatter、
 * 引用行、fenced code、HTML 注释、归档冻结区、生成物投影、原始语料目录。
 *
 * 运行：node scripts/fix-doc.mjs <路径…>            # dry-run：报告会改哪些行、命中哪些规则
 *       node scripts/fix-doc.mjs --write <路径…>    # 落盘（改完跑 node scripts/run-checks.mjs）
 *       [--root <dir>] 只为自证套件与排障服务（默认仓库根，与 archive-doc.mjs 同语义）。
 * 只接受显式路径——不扫全仓、不碰没有点名给它的文件（同仓并行会话的在写文件因此安全）。
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { CJK_CLASS, ROOT, isMainModule, isRawExempt, loadRegistry, maskSource } from './doc-lib.mjs';

const FROZEN_RE = /^\.agents\/(archive|notes\/archived)\//;
const PUNCT_MAP = { ',': '，', ';': '；', ':': '：', '!': '！', '?': '？', '(': '（', ')': '）' };
const QUOTE_RE = /^\s*>/;
const FRONTMATTER_DELIM = /^\s{0,3}---\s*$/;

/**
 * 保护区（行内代码、URL、链接目标、HTML 标签）换成不可见占位符，返回 { text, vault }。
 * 必须单趟交替匹配：多趟顺序 replace 时，后趟的字符类不排除占位符，会把前趟占位符包进新 vault 项，
 * restore 单遍也换不回来——链接目标里的 URL/行内代码就会被替换成 NUL 字节落盘（审计实测过这个洞）。
 */
function protect(text) {
  const vault = [];
  const hide = (s) => `\u0000${vault.push(s) - 1}\u0000`;
  const out = text.replace(/`[^`]*`|https?:\/\/[^\s)）】>]+|\]\([^)\s]*\)|<[^>]+>/g, hide);
  return { out, vault };
}

/** 还原占位符；循环到不动点，防占位符内容里再含占位符形态。 */
function restore(text, vault) {
  let prev = null;
  let cur = text;
  while (cur !== prev) {
    prev = cur;
    cur = cur.replace(/\u0000(\d+)\u0000/g, (m, i) => vault[Number(i)] ?? m);
  }
  return cur;
}

/** 中英文/数字之间补一个半角空格（两个方向各一遍；已有空格不会重复加）。 */
function fixSpacing(t) {
  return t
    .replace(new RegExp(`([${CJK_CLASS}])([A-Za-z0-9@#$_])`, 'g'), '$1 $2')
    .replace(new RegExp(`([A-Za-z0-9%])([${CJK_CLASS}])`, 'g'), '$1 $2');
}

/**
 * 与 CJK 直接相邻的半角标点转全角。两个方向分开处理，各自只做检查器（HALFWIDTH_PUNCT_RE）会拦的事：
 *   方向一（CJK 紧邻标点，`中文,`）：允许吞掉其后的一个半角空格——`中文, 也` → `中文，也`；
 *   方向二（标点紧邻 CJK，`,中文`）：必须直接相邻才转，绝不吞空格——`_Avoid_: 多仓` 这类机器可读
 *   字段不转（否则 GLOSSARY 的 `_Avoid_：` 会让 check-prose 的禁用词解析静默失效；审计实测 45 处）。
 */
function fixPunct(t) {
  return t
    .replace(new RegExp(`([${CJK_CLASS}])([,;:!?()]) ?`, 'g'), (m, c, p) => c + PUNCT_MAP[p])
    .replace(new RegExp(`([,;:!?()])([${CJK_CLASS}])`, 'g'), (m, p, c) => PUNCT_MAP[p] + c);
}

/** frontmatter 区间 [start, end]（0 基，含两端）；没有则返回 null。 */
function frontmatterRange(lines) {
  if (!FRONTMATTER_DELIM.test(lines[0] ?? '')) return null;
  for (let i = 1; i < lines.length; i++) {
    if (FRONTMATTER_DELIM.test(lines[i])) return [0, i];
  }
  return null;
}

/**
 * 修复一个文件的全部机械规则（纯函数：文本进、文本出，不碰盘）。
 * 返回 { text, applied: Map<规则ID, 命中数>, changed: Set<行号(1 基)> }。
 */
export function fixText(raw) {
  const lines = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  const mask = maskSource(lines);
  const fm = frontmatterRange(lines);
  const inFm = (i) => fm !== null && i >= fm[0] && i <= fm[1];
  const applied = new Map();
  const changed = new Set();
  const hit = (rule, line) => {
    applied.set(rule, (applied.get(rule) ?? 0) + 1);
    if (line !== undefined) changed.add(line);
  };

  // 以 \n 结尾的文件，split 后末元素是空串——它不是内容行，结尾规则单独处理
  const withEof = lines[lines.length - 1] === '';
  const body = withEof ? lines.slice(0, -1) : lines;
  const skip = (i) => mask.fenced[i] || mask.commented[i] || inFm(i) || QUOTE_RE.test(lines[i]);

  // 1-3) 逐行：行尾空白 + （保护区外的）中英空格与全角标点
  const out = body.map((line, i) => {
    if (skip(i)) return line;
    let l = line;
    if (l.trimEnd() !== l) {
      l = l.trimEnd();
      hit('layout/trailing-whitespace', i + 1);
    }
    const { out: guarded, vault } = protect(l);
    const spaced = fixSpacing(guarded);
    const puncted = fixPunct(spaced);
    if (puncted !== guarded) {
      if (spaced !== guarded) hit('prose/cjk-space', i + 1);
      if (puncted !== spaced) hit('prose/halfwidth-punct', i + 1);
      l = restore(puncted, vault);
    }
    return l;
  });

  // 4) 连续空行压成一个（栅栏/注释内是数据，不动）
  const collapsed = [];
  let lastKeptBlank = false;
  for (let i = 0; i < out.length; i++) {
    const blank = out[i].trim() === '' && !mask.fenced[i] && !mask.commented[i];
    if (blank && lastKeptBlank) {
      hit('layout/consecutive-blank', i + 1);
      continue;
    }
    collapsed.push(out[i]);
    lastKeptBlank = blank;
  }

  // 5) 结尾：去掉尾部空行，恰好一个换行收尾（行号记当次收整的末行，便于 dry-run 报告定位）
  let end = collapsed.length;
  while (end > 0 && collapsed[end - 1].trim() === '') {
    end--;
    hit('fix/trailing-blank-lines', end + 1);
  }
  if (!withEof && end > 0) hit('layout/eof-newline');
  const text = end === 0 ? '' : `${collapsed.slice(0, end).join('\n')}\n`;

  return { text, applied, changed };
}

function usage(msg) {
  if (msg) console.error(`fix-doc: ${msg}`);
  console.error('用法：node scripts/fix-doc.mjs [--write] [--root <dir>] <路径…>（默认 dry-run，只报告不落盘）');
  process.exit(msg ? 1 : 0);
}

// 直接执行时做主入口；被自证套件 import 时不触发。
if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  const doWrite = args.includes('--write');
  // --root 与 archive-doc.mjs 同款：只为自证套件在临时工作区里跑完整条修复路径
  const rootArg = args.indexOf('--root');
  const REPO = rootArg !== -1 && args[rootArg + 1] ? resolve(args[rootArg + 1]) : ROOT;
  const VALUE_FLAGS = ['--root'];
  const paths = args.filter((a, i) => !a.startsWith('--') && !VALUE_FLAGS.includes(args[i - 1]));
  if (!paths.length) usage('至少给一个路径');

  const reg = loadRegistry(REPO);
  let dirty = 0;
  for (const p of paths) {
    const abs = resolve(REPO, p);
    const rel = relative(REPO, abs).split('\\').join('/');
    if (rel.startsWith('..')) usage(`路径在仓库外：${p}`);
    if (FROZEN_RE.test(rel)) usage(`归档冻结区不可修改：${rel}`);
    if (rel === reg.projection) usage(`${rel} 是生成物——改注册表后跑 node scripts/gen-doc-types.mjs，不要手改`);
    if (!existsSync(abs)) usage(`文件不存在：${p}`);
    if (isRawExempt(REPO, reg, rel)) usage(`${rel} 在原始语料豁免目录里（外部镜像，不是本工作区文档）`);
    const raw = readFileSync(abs, 'utf8');
    const { text, applied, changed } = fixText(raw);
    if (text === raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')) {
      console.log(`✓ ${rel}：无机械问题`);
      continue;
    }
    dirty++;
    const parts = [...applied.entries()].map(([rule, n]) => `${rule}×${n}`).join('，');
    const nums = [...changed].sort((a, b) => a - b);
    console.log(`${doWrite ? '✓ 已修复' : '· 将修复'} ${rel}：${parts}`);
    console.log(`  涉及行：${nums.slice(0, 12).join('、')}${nums.length > 12 ? ` …（共 ${nums.length} 行）` : ''}`);
    if (doWrite) writeFileSync(abs, text);
  }
  if (!doWrite && dirty) console.log('\ndry-run：加 --write 落盘；一段一行、术语、链接等语义规则仍需手工。');
  if (doWrite && dirty) console.log('\n下一步：node scripts/run-checks.mjs。');
  void join;
}
