#!/usr/bin/env node
/**
 * archive-doc.mjs —— 归档文档：移动 + 插 Archived 行 + 重写自身相对链接 + 重新封印 + 列出待修入链（纯 node 标准库）。
 *
 * 「永不删除」的执行环节。手工做这几步最容易漏掉封印、入链修复与自身链接改写，所以工具化：
 *   1. 校验来源（只接受 plans/ research/ future/ 下的日期型文档；笔记走 notes/archived，技能不归档）
 *   2. 移动到 .agents/archive/[<subdir>/]<原文件名>（目标已存在则拒绝）
 *   3. 在头块末尾插入/更新 `Archived: <date>`（原有 Type/Status 保留，作为它退役前的身份）
 *   4. **重写文档自身的相对链接**——归档件比原件深一层，链接基准随之变；
 *      同批一起归档的指向归档区，其余指向其原位置。不做这步，跨 .agents/ 的链接当场全断，
 *      而 check-links 是扫 archive/ 的，门禁必红；封印又是单向棘轮，搬完再修没有退路。
 *   5. 调 seal-notes-archive.mjs --target archive 重新封印（append-only）
 *   6. 扫全仓指向旧路径的相对链接并列出来——**入链必须在同一批变更里修完**，否则 check-links 会红
 *
 * 可一次给多个路径：同批一起归档时互相引用才不会各自指向已被搬走的位置（一次封印，一次报告）。
 *
 * 运行：node scripts/archive-doc.mjs <path> [<path>…] [--subdir <品类>] [--date yyyy-mm-dd] [--dry-run] [--root <dir>]
 *   --root 只为自证套件与排障服务（默认仓库根）。
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATE_RE, ROOT, loadRegistry, normalizeLines, parseHeader, today } from './doc-lib.mjs';

const SOURCE_RE = /^\.agents\/(plans|research|future)\//;

function fail(msg) {
  console.error(`archive-doc: ${msg}`);
  process.exit(1);
}

function argOf(args, name) {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] : null;
}

/** 扫描全仓 Markdown，找出解析后指向 target 的相对链接。 */
function findInboundLinks(root, targetAbs) {
  const hits = [];
  const skip = new Set(['.git', 'node_modules', '开源项目']);
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(e.name)) continue;
      const full = join(dir, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) { walk(full); continue; }
      if (!e.isFile() || !e.name.endsWith('.md')) continue;
      const lines = normalizeLines(readFileSync(full, 'utf8'));
      lines.forEach((line, i) => {
        for (const m of line.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
          const t = (m[1] ?? '').trim();
          if (!t || t.startsWith('#') || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(t)) continue;
          const pathPart = t.split('#')[0];
          if (!pathPart) continue;
          let abs = resolve(dirname(full), pathPart);
          try {
            abs = resolve(dirname(full), decodeURIComponent(pathPart));
          } catch { /* 非法百分号编码，按原样比较 */ }
          if (abs === targetAbs) hits.push(`${full.slice(root.length + 1)}:${i + 1} — [${t}]`);
        }
      });
    }
  };
  walk(root);
  return hits;
}

/**
 * 重写正文里的相对链接，使它们在新的目录深度下仍指向同一个目标。
 * moves 是本次同批归档的「原绝对路径 → 归档后绝对路径」表：指向同批件的链接直接落到归档区，
 * 否则按原位置解析（目标还在原地就还指原地）。解析不出来的原样保留，交给 check-links 报。
 */
function rewriteInternalLinks(text, fromDir, toDir, moves) {
  return text.replace(/\]\(([^)\s]+)\)/g, (whole, raw) => {
    const t = raw.trim();
    if (!t || t.startsWith('#') || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(t)) return whole;
    const pathPart = t.split('#')[0];
    if (!pathPart) return whole;
    let origAbs = resolve(fromDir, pathPart);
    try {
      origAbs = resolve(fromDir, decodeURIComponent(pathPart));
    } catch { /* 非法百分号编码：按原样解析 */ }
    const finalAbs = moves.get(origAbs) ?? (existsSync(origAbs) ? origAbs : null);
    if (!finalAbs) return whole;
    let next = relative(toDir, finalAbs).split('\\').join('/');
    if (!next.startsWith('.')) next = `./${next}`;
    return `](${next}${t.slice(pathPart.length)})`;
  });
}

const args = process.argv.slice(2);
const rootArg = args.indexOf('--root');
const REPO = rootArg !== -1 && args[rootArg + 1] ? resolve(args[rootArg + 1]) : ROOT;
const VALUE_FLAGS = ['--subdir', '--date', '--root'];
const positional = args.filter((a, i) => !a.startsWith('--') && !VALUE_FLAGS.includes(args[i - 1]));
if (!positional.length) {
  console.error('用法：node scripts/archive-doc.mjs <path> [<path>…] [--subdir <品类>] [--date yyyy-mm-dd] [--dry-run]');
  process.exit(1);
}
const reg = loadRegistry(REPO);
const date = argOf(args, 'date') ?? today();
if (!DATE_RE.test(date)) fail(`--date 必须为 yyyy-mm-dd，实为 \`${date}\``);
const subdir = argOf(args, 'subdir');

// 先整批校验、整批算出移动表，再动手——同批互相引用的链接才知道对方要搬到哪
const jobs = [];
for (const src of positional) {
  const rel = src.replace(/^\.\//, '');
  const abs = resolve(REPO, rel);
  if (!existsSync(abs)) fail(`文件不存在：${rel}`);
  const posixRel = rel.split('\\').join('/');
  if (!SOURCE_RE.test(posixRel)) fail(`只能归档 .agents/{plans,research,future}/ 下的文档（笔记走 .agents/notes/archived/，技能与规格页不归档）：${posixRel}`);
  if (/(^|\/)README\.md$/.test(posixRel)) fail(`README 是目录的入口规格页，不归档：${posixRel}`);
  const targetRel = `.agents/archive/${subdir ? `${subdir}/` : ''}${posixRel.split('/').pop()}`;
  const targetAbs = join(REPO, targetRel);
  if (existsSync(targetAbs)) fail(`归档区已有同名文件，拒绝覆盖：${targetRel}`);
  if (jobs.some((j) => j.targetAbs === targetAbs)) fail(`同一批里两个来源指向同一个归档目标：${targetRel}`);
  jobs.push({ rel, posixRel, abs, targetRel, targetAbs });
}
const moves = new Map(jobs.map((j) => [j.abs, j.targetAbs]));

// 头块末尾插入/更新 Archived:（注册表里它的字段顺序排在最后），再重写自身相对链接
for (const job of jobs) {
  const lines = normalizeLines(readFileSync(job.abs, 'utf8'));
  const header = parseHeader(lines);
  if (!header.titleOk) fail(`${job.posixRel} 第 1 行不是 \`# <标题>\`；归档要求头块完整，先修好再归档`);
  const kept = header.fields.filter((f) => f.key !== reg.globalRules.archiveRequiresField);
  const fields = [...kept, { key: reg.globalRules.archiveRequiresField, value: date }];
  const out = [lines[0], '', ...fields.map((f) => `${f.key}: ${f.value}`), '', ...lines.slice(header.headerEnd)].join('\n')
    .replace(/\n{3,}/g, '\n\n');
  job.out = rewriteInternalLinks(out, dirname(job.abs), dirname(job.targetAbs), moves);
}

if (args.includes('--dry-run')) {
  for (const job of jobs) console.log(`--- ${job.posixRel} → ${job.targetRel}（dry-run）---\n${job.out}`);
  process.exit(0);
}

for (const job of jobs) {
  mkdirSync(dirname(job.targetAbs), { recursive: true });
  writeFileSync(job.targetAbs, job.out.endsWith('\n') ? job.out : `${job.out}\n`);
  rmSync(job.abs);
  console.log(`✓ 已归档 ${job.posixRel} → ${job.targetRel}（${reg.globalRules.archiveRequiresField}: ${date}）`);
}

// 工具随代码走、内容随 --root 走：自证套件在临时工作区里也能跑完整条归档路径
const HERE = resolve(fileURLToPath(new URL('.', import.meta.url)));
const seal = spawnSync(process.execPath, [join(HERE, 'seal-notes-archive.mjs'), '--target', 'archive', '--root', REPO], { stdio: 'inherit' });
if (seal.status !== 0) fail('封印失败：归档文件已移动但未封印，请手工跑 node scripts/seal-notes-archive.mjs --target archive');

let anyInbound = false;
for (const job of jobs) {
  const inbound = findInboundLinks(REPO, job.abs);
  if (!inbound.length) continue;
  anyInbound = true;
  console.log(`\n${job.posixRel} 的待修入链（${inbound.length} 处，必须在本批变更里改完，否则 check-links 会红）：`);
  for (const h of inbound) console.log(`  ${h}`);
}
if (anyInbound) {
  console.log('  改法：指向替代文档；没有替代者就指向归档件本身（它仍是可发现的历史）。');
} else {
  console.log('入链：无（全仓没有指向旧路径的相对链接）');
}
console.log('\n下一步：node scripts/run-checks.mjs');
