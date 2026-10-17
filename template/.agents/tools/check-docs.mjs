#!/usr/bin/env node
/**
 * check-docs.mjs —— Curia 2.1 文档自检（纯 node 标准库、零依赖、Node ≥ 18、不联网、不执行文档内代码）。
 * 权威：Curia 2.1 规范「配套脚本规格」与「豁免清单」——10 组检查（组 0 编码预检 + 组 1 至 9）、退出码 0/1/2、目录级与组级豁免、
 * 诚实条款（空集必红、0 判据必红、只证明机械子集、不读 git、异常非零）。用法：
 *   node .agents/tools/check-docs.mjs [--strict] [--exclude <路径或 glob>]… [--skip <组号,…>] [路径…]
 *   报告模式列发现不失败（0）；--strict 任一发现即 1；--skip 跳过指定组（如纯英文项目 7,8）；
 *   2 = 无法完成检查：扫描面为空、路径不存在、0 条判据可执行（适用组被 --skip 跳光）、模板枚举
 *   自检不一致、内部错误——两种模式都不得返回 0。未给路径时取默认两根 `.agents/` 与 `docs/`（存在才扫）。
 * 取舍：模板目录缺失按配置错误（2，模板是类型枚举的第二份表示）；「跳过 K 项」= 跳过组数；
 *   目录名 kebab-case 只查 `.agents/` 子树；日期型文件名只查 plans/research 家与 notes 活动区；
 *   组 7/8 一行只报第一处；组 0「编码」在文件无法按 UTF-8 解码时报出；纯文件系统遍历，不读 git。
 * 行数：规范「合计目标 ≤ 500 行」——本文件 413 行 + new-doc.mjs 82 行 = 495 行，单支均未超 600 行硬线。
 */

import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 类型枚举（机器读的一份；人读权威在规范「9 类文档」表）：类型 → 家 → 允许状态（null = 无 Status）。 */
const TYPES = {
  proposal: { home: 'plans', statuses: ['draft', 'active', 'done', 'superseded'] },
  spec: { home: 'plans', statuses: ['draft', 'active', 'done', 'superseded'] },
  plan: { home: 'plans', statuses: ['draft', 'active', 'done', 'superseded'] },
  survey: { home: 'research', statuses: ['current', 'historical', 'superseded'] },
  evidence: { home: 'research', statuses: ['current', 'historical', 'superseded'] },
  postmortem: { home: 'research', statuses: ['current', 'historical'] },
  reference: { home: 'research', statuses: ['current', 'historical', 'superseded'] },
  runbook: { home: 'skills', statuses: ['current', 'superseded'] },
  skill: { home: 'skills', statuses: null },
};

const GROUP_NAMES = { 0: '编码', 1: '头块', 2: '状态与取代', 3: '笔记头', 4: '归档头', 5: '家与命名', 6: '段落', 7: '中英空格', 8: '标点与符号', 9: '链接' };
const SKIP_DIR_NAMES = new Set(['.git', 'node_modules']);
const TYPED_HOMES = new Set(['plans', 'research', 'skills']); // 3 行头块的三个类型化家
const NOTE_STATUSES = new Set(['proposed', 'implemented', 'rejected']);
const INDEX_NAMES = new Set(['README.md', 'AGENTS.md']); // 目录说明文件不进类型化面
const MD_RE = /\.[mM][dD]$/, DATE_RE = /^\d{4}-\d{2}-\d{2}$/, DATED_NAME_RE = /^\d{4}-\d{2}-\d{2}-/; // 扩展名大小写不敏感
const KEBAB_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/, SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/, FIELD_RE = /^\s*([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/;
const NOTE_STATUS_LINE_RE = /^Status:\s*(.*)$/, PLACEHOLDER_RE = /<[^<>\n]+>/;
const EMDASH = '—', INLINE_MARK = '\uE000', CJK_CLASS = '\\u3400-\\u4fff\\u4e00-\\u9fff\\uf900-\\ufaff';
const CJK_SPACE_RE = new RegExp(`(?:[${CJK_CLASS}])([A-Za-z0-9])|([A-Za-z0-9])([${CJK_CLASS}])`, 'g');
const CJK_INLINE_RE = new RegExp(`[${CJK_CLASS}]${INLINE_MARK}|${INLINE_MARK}[${CJK_CLASS}]`);
const HALFWIDTH_PUNCT_RE = new RegExp(`(?:[${CJK_CLASS}])([,;:!?()])|(?:[,;:!?()])([${CJK_CLASS}])`, 'g');
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/gu; // 规范「功能性符号只放行 →」
// URL 内不查：整体掩码为拉丁占位 `URL`——保留与相邻中文的边界供组 7 判定；字符集排除空白、CJK 与全角段
const URL_RE = new RegExp(`[a-zA-Z][a-zA-Z0-9+.-]*:\\/\\/[^\\s\\u3000-\\u303f${CJK_CLASS}\\uff00-\\uffef]+`, 'g');
const LINK_RE = /\[[^\]]*\]\(([^)\s]+)\)/g; // 组 9：取链接目标
const LINK_STRIP_RE = /!?\[([^\]]*)\]\((?:[^()]|\([^()]*\))*\)/g; // 组 7/8：整条行内链接 → 仅留链接文字
// 组 6：标题 / 列表项 / 表格行 / 引用 / 围栏行 / 分隔线 / 缩进代码——都不是自然段文本
const STRUCT_RE = /^(?:\s{0,3}#{1,6}\s|\s*(?:[-*+]|\d+[.)])\s|\s*\||\s*>\s?|\s{0,3}(?:```|~~~)|\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$)/;
const INDENT_RE = /^(?: {4}|\t)/; // 缩进代码块（规范豁免清单「代码块」）

/** 输出用路径：两侧统一 realpath（macOS /tmp → /private/tmp 符号链接下输出才不失真）；失败回退原值。 */
function relOf(abs) {
  let cwd = process.cwd(), a = abs;
  try { cwd = realpathSync(cwd); } catch {}
  try { a = realpathSync(abs); } catch {}
  const r = relative(cwd, a).split(sep).join('/');
  return r === '' ? '.' : r;
}

/** 读文件：剥 BOM（否则首行标题匹配失败）；bad = 含 U+FFFD（解码损坏，中文判据不可信）。 */
function readLines(abs) {
  const raw = readFileSync(abs, 'utf8').replace(/^\uFEFF/, '');
  return { lines: raw.replace(/\r\n?/g, '\n').split('\n'), bad: raw.includes('\uFFFD') };
}

/** 极简 glob → RegExp：`**` 跨任意层目录（含零层），`*` 不跨目录（占位符避开替换串里的 `*`）。 */
function globToRe(pattern) {
  const re = pattern.replace(/[\\^$.|?+()[\]{}]/g, '\\$&').replace(/\*\*\//g, '\u0001').replace(/\*\*/g, '\u0002')
    .replace(/\*/g, '[^/]*').replace(/\u0001/g, '(?:.*/)?').replace(/\u0002/g, '.*');
  return new RegExp(`^${re}$`);
}

/** `--exclude` 匹配：绝对路径按前缀；相对值按 cwd 相对路径前缀或 glob。 */
function isExcluded(entry, excludes) {
  return excludes.some((e) => {
    if (isAbsolute(e)) {
      const ea = resolve(e);
      return entry.abs === ea || entry.abs.startsWith(ea + sep);
    }
    const norm = e.replace(/^\.\//, '').replace(/\/+$/, '');
    return !!norm && (entry.rel === norm || entry.rel.startsWith(norm + '/') || globToRe(norm).test(entry.rel));
  });
}

/** 启动自检：读脚本同级 `../templates/*.md` 文件名集合，与内联类型枚举比对；不一致（含目录缺失）返回错误消息。 */
function selfCheck() {
  const tplDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates');
  let names;
  try { names = readdirSync(tplDir).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)).sort(); }
  catch { return `未找到模板目录 ${relOf(tplDir)}（类型枚举的第二份表示随载荷分发；缺失即无法完成一致性自检）`; }
  const want = Object.keys(TYPES).sort(), miss = want.filter((t) => !names.includes(t)), extra = names.filter((t) => !want.includes(t));
  if (!miss.length && !extra.length) return null;
  return `模板目录与内联类型枚举不一致：缺 [${miss.join(', ')}] / 多 [${extra.join(', ')}]（改类型表必须同批改 .agents/templates/ 与脚本）`;
}

const USAGE = '用法：node .agents/tools/check-docs.mjs [--strict] [--exclude <路径或 glob>]… [--skip <组号,…>] [路径…]';
class UsageError extends Error {}

function parseArgs(argv) {
  const opts = { strict: false, excludes: [], skip: new Set(), paths: [], help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], v = argv[i + 1];
    if (a === '--strict') opts.strict = true;
    else if (a === '--exclude' || a === '--skip') {
      if (!v) throw new UsageError(`${a} 缺参数`);
      i++;
      if (a === '--exclude') opts.excludes.push(v);
      else for (const part of v.split(',')) {
        const n = Number(part.trim());
        if (!Number.isInteger(n) || n < 1 || n > 9) throw new UsageError(`--skip 组号非法：${part}`);
        opts.skip.add(n);
      }
    } else if (a === '--help' || a === '-h') opts.help = true;
    else if (a.startsWith('--')) throw new UsageError(`未知参数：${a}`);
    else opts.paths.push(a);
  }
  return opts;
}

/** 遍历扫描面收集 `.md` 文件与目录（组 5c 用）。目录级豁免：`.git/`、`node_modules/`、`--exclude`、含 `.agents-raw` 的目录、`.agents/templates/` 与 `.agents/examples/`；符号链接按真实路径去重。 */
function collect(roots, excludes) {
  const files = [], dirs = [], seen = new Set();
  const rootReals = roots.map((r) => { try { return realpathSync(r); } catch { return null; } }).filter(Boolean);
  const inFace = (real) => rootReals.some((rr) => real === rr || real.startsWith(rr + sep));
  const stack = roots.map((r) => ({ abs: r, rel: relOf(r) }));
  while (stack.length) {
    const cur = stack.pop();
    let st; try { st = statSync(cur.abs); } catch { continue; } // 悬空符号链接等
    let real; try { real = realpathSync(cur.abs); } catch { real = cur.abs; }
    if (!inFace(real) || seen.has(real)) continue;
    seen.add(real);
    if (st.isDirectory()) {
      if (SKIP_DIR_NAMES.has(basename(cur.abs)) || existsSync(join(cur.abs, '.agents-raw'))) continue;
      if (/[\\/]\.agents[\\/](templates|examples)$/.test(cur.abs) || isExcluded(cur, excludes)) continue;
      dirs.push(cur);
      for (const ent of readdirSync(cur.abs)) stack.push({ abs: join(cur.abs, ent), rel: `${cur.rel}/${ent}` });
    } else if (st.isFile() && MD_RE.test(cur.abs) && !isExcluded(cur, excludes)) files.push(cur);
  }
  return { files, dirs };
}

/** 掩码 fenced 代码与 HTML 注释区域（跨行）；识别文件头 YAML frontmatter 的结束行。 */
function analyze(lines) {
  const n = lines.length, fenced = new Array(n).fill(false), commented = new Array(n).fill(false);
  let inFence = false, inComment = false;
  for (let i = 0; i < n; i++) {
    const l = lines[i];
    fenced[i] = inFence, commented[i] = inComment;
    if (!inComment && /^\s{0,3}(?:```|~~~)/.test(l)) { fenced[i] = true; inFence = !inFence; }
    else if (inFence) fenced[i] = true;
    if (inFence) continue;
    const open = inComment ? -1 : l.indexOf('<!--');
    const close = l.indexOf('-->');
    if (inComment) { commented[i] = true; if (close !== -1) inComment = false; }
    else if (open !== -1) { commented[i] = true; if (close === -1 || close < open) inComment = true; }
  }
  let fmEnd = 0;
  if ((lines[0] ?? '').trim() === '---') { fmEnd = n; for (let i = 1; i < n; i++) if (lines[i].trim() === '---') { fmEnd = i + 1; break; } }
  return { fenced, commented, fmEnd };
}

/** 头块 = 首个标题后连续的 `键: 值` 行块（至第一个空行或非字段行为止）。组 1/2/4 只读它。 */
function parseHeader(lines) {
  let titleIdx = -1;
  for (let i = 0; i < lines.length; i++) if (/^#{1,6}\s/.test(lines[i])) { titleIdx = i; break; }
  const fields = [];
  let i = titleIdx + 1;
  while (titleIdx !== -1 && i < lines.length && lines[i].trim() === '') i++;
  for (; titleIdx !== -1 && i < lines.length; i++) {
    const m = FIELD_RE.exec(lines[i]);
    if (!m) break;
    fields.push({ key: m[1], value: m[2].trim(), idx: i });
  }
  return { titleIdx, fields, blockEnd: titleIdx === -1 ? 0 : i };
}

/** 定位文件/目录在 `.agents/` 树中的位置（家、归档区、笔记 lifecycle）。 */
function locate(abs, isDir = false) {
  const segs = abs.split(sep);
  let ai = -1;
  for (let i = segs.length - 1; i >= 0; i--) if (segs[i] === '.agents') { ai = i; break; }
  const after = ai === -1 ? [] : segs.slice(ai + 1);
  const home = after.length > (isDir ? 0 : 1) ? after[0] : null;
  return { inAgents: ai !== -1, home, lifecycle: home === 'notes' ? after[1] ?? null : null,
    inArchive: home === 'archive' || (home === 'notes' && after[1] === 'archived'),
    inNotesActive: home === 'notes' && NOTE_STATUSES.has(after[1]) };
}

/** 行内代码掩码：成对反引号（同长引号串）之间的内容替换为 INLINE_MARK；未闭合的按普通文本处理。 */
function maskInline(line) {
  let out = '', i = 0;
  while (i < line.length) {
    if (line[i] === '`') {
      let j = i;
      while (j < line.length && line[j] === '`') j++;
      const close = line.indexOf('`'.repeat(j - i), j);
      if (close !== -1) { out += INLINE_MARK; i = close + (j - i); continue; }
    }
    out += line[i++];
  }
  return out;
}

/** 组 7/8 共用掩码：行内代码 → 占位符；整条行内链接 → 仅留链接文字（链接语法不是中文标点）；裸 URL → `URL`。 */
function maskProse(line) { return maskInline(line).replace(LINK_STRIP_RE, '$1').replace(URL_RE, 'URL'); }

function add(out, group, rel, line, msg) { out.push({ group, rel, line, msg }); }

/** 组 1：头块——三行必备、顺序固定、取值合法、字段值无 `<占位符>`。 */
function checkHeaderBlock(rel, hdr, out) {
  const anchor = hdr.titleIdx >= 0 ? hdr.titleIdx + 1 : 1;
  const typeF = hdr.fields.find((f) => f.key === 'Type');
  const statusF = hdr.fields.find((f) => f.key === 'Status');
  const updF = hdr.fields.find((f) => f.key === 'Updated');
  const def = typeF && TYPES[typeF.value];
  if (!typeF) add(out, 1, rel, anchor, '头块缺 `Type:` 行');
  if (!updF) add(out, 1, rel, anchor, '头块缺 `Updated:` 行');
  if (!statusF && !(typeF && typeF.value === 'skill')) add(out, 1, rel, anchor, '头块缺 `Status:` 行');
  if (typeF && statusF && updF && !(typeF.idx < statusF.idx && statusF.idx < updF.idx)) add(out, 1, rel, typeF.idx + 1, '头块三行顺序应为 `Type:`、`Status:`、`Updated:`');
  if (typeF && !def) add(out, 1, rel, typeF.idx + 1, `Type 值 \`${typeF.value}\` 不在 9 类内`);
  if (statusF && def && def.statuses !== null && !def.statuses.includes(statusF.value)) add(out, 1, rel, statusF.idx + 1, `Status 值 \`${statusF.value}\` 不在 \`${typeF.value}\` 的允许集（${def.statuses.join('/')}）内`);
  if (updF && !DATE_RE.test(updF.value)) add(out, 1, rel, updF.idx + 1, `Updated 值 \`${updF.value}\` 非 yyyy-mm-dd`);
  for (const f of hdr.fields) { const m = PLACEHOLDER_RE.exec(f.value); if (m) add(out, 1, rel, f.idx + 1, `字段值残留占位符 \`${m[0]}\``); }
}

/** 相对目标存在性（含 URL 解码回退）——组 9 与组 2 裸路径形态共用。 */
function targetExists(dir, target) {
  if (existsSync(resolve(dir, target))) return true;
  try { return existsSync(resolve(dir, decodeURIComponent(target))); } catch { return false; }
}

/** 组 2：`Status: superseded` 必须带 `Superseded-by:`；链接形态目标存在性归组 9，裸路径形态在此查存在性。 */
function checkSuperseded(rel, dir, hdr, out) {
  const statusF = hdr.fields.find((f) => f.key === 'Status' && f.value === 'superseded');
  if (!statusF) return;
  const supF = hdr.fields.find((f) => f.key === 'Superseded-by');
  if (!supF || supF.value === '') { add(out, 2, rel, statusF.idx + 1, '`Status: superseded` 缺 `Superseded-by:` 行'); return; }
  if (supF.value.includes('](')) return; // Markdown 链接形态：目标存在性由组 9 负责
  const p = supF.value.split('#')[0].trim();
  if (p && !targetExists(dir, p)) add(out, 2, rel, supF.idx + 1, `Superseded-by 裸路径目标不存在：${supF.value}（建议改写成相对 Markdown 链接）`);
}

/** 组 3：活动笔记头——必须在 lifecycle 目录下、标题后第一个非空行是 `Status:`、取值与目录一致、rejected 原因非空。 */
function checkNoteHeader(rel, lines, loc, out) {
  if (!loc.inNotesActive) { add(out, 3, rel, 1, '笔记不在 lifecycle 目录（proposed / implemented / rejected）下'); return; }
  let titleIdx = -1;
  for (let i = 0; i < lines.length; i++) if (/^#{1,6}\s/.test(lines[i])) { titleIdx = i; break; }
  if (titleIdx === -1) { add(out, 3, rel, 1, '笔记缺标题行（头块两行：标题与 `Status:`）'); return; }
  let statusIdx = titleIdx, statusRaw = null;
  for (let i = titleIdx + 1; i < lines.length; i++) {
    if (lines[i].trim() === '') continue;
    const m = NOTE_STATUS_LINE_RE.exec(lines[i].trim());
    statusIdx = i;
    statusRaw = m ? m[1].trim() : null;
    break;
  }
  if (statusRaw === null) { add(out, 3, rel, statusIdx + 1, '笔记头：标题后的第一个非空行不是 `Status:` 行'); return; }
  const parts = statusRaw.split(EMDASH);
  const status = parts[0].trim(), reason = parts.slice(1).join(EMDASH).trim();
  if (status !== loc.lifecycle) add(out, 3, rel, statusIdx + 1, `笔记 Status \`${status || '（空）'}\` 与目录 \`${loc.lifecycle}\` 不一致`);
  if (status === 'rejected' && reason === '') add(out, 3, rel, statusIdx + 1, 'rejected 笔记的 `—` 后原因为空');
}

/** 组 4：归档件（带类型头块的文档）必须有 `Archived: yyyy-mm-dd`；目录入口页与说明性文件不适用。 */
function checkArchivedHeader(rel, hdr, out) {
  const typeF = hdr.fields.find((f) => f.key === 'Type');
  if (!typeF) return;
  const archF = hdr.fields.find((f) => f.key === 'Archived');
  if (!archF) add(out, 4, rel, typeF.idx + 1, '归档件缺 `Archived: yyyy-mm-dd` 行');
  else if (!DATE_RE.test(archF.value)) add(out, 4, rel, archF.idx + 1, `Archived 值 \`${archF.value}\` 非 yyyy-mm-dd`);
}

/** 组 5：`.agents/` 下类型与家不符（`docs/` 等面外文档不进此判定）；日期型文件名不以 `yyyy-mm-dd-` 开头。 */
function checkHomeName(rel, hdr, loc, base, isIndex, out) {
  const typeF = hdr.fields.find((f) => f.key === 'Type');
  const def = typeF && TYPES[typeF.value];
  if (def && loc.inAgents && loc.home !== def.home) add(out, 5, rel, typeF.idx + 1, `类型 \`${typeF.value}\` 应住 \`${def.home}/\`，实际在 \`${loc.home ?? '（不在任何家）'}\``);
  const dated = loc.home === 'plans' || loc.home === 'research' || loc.inNotesActive;
  if (dated && !isIndex && !DATED_NAME_RE.test(base)) add(out, 5, rel, 1, '日期型文档文件名应以 `yyyy-mm-dd-` 开头');
}

/** 组 6/7/8：段落连排、中英空格、半角标点与 emoji——同一遍行扫描。组 6 豁免头块与 frontmatter（标题之前照查），缩进代码块不是自然段；组 7/8 不查围栏内与行内代码内部。 */
function checkProse(rel, lines, a, hdr, g, out) {
  const exempt = (i) => i < a.fmEnd || (hdr.titleIdx >= 0 && i >= hdr.titleIdx && i < hdr.blockEnd);
  let run = -1;
  const flush = (end) => {
    if (g.has(6) && run !== -1 && end - run >= 2) add(out, 6, rel, run + 1, `连续 ${end - run} 行自然段文本未用空行分隔（一段一物理行）`);
    run = -1;
  };
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i], masked = a.fenced[i] || a.commented[i];
    if (g.has(6)) {
      const para = !masked && !exempt(i) && raw.trim() !== '' && !INDENT_RE.test(raw) && !STRUCT_RE.test(raw);
      if (para) { if (run === -1) run = i; } else flush(i);
    }
    if (masked) continue;
    const t = maskProse(raw);
    if (g.has(7)) {
      const m1 = t.match(CJK_SPACE_RE);
      if (m1) add(out, 7, rel, i + 1, `中文与拉丁字母/数字之间缺半角空格：…${snippet(t, m1[0])}…`);
      else if (CJK_INLINE_RE.test(t)) add(out, 7, rel, i + 1, '中文与行内代码之间缺半角空格');
    }
    if (g.has(8)) {
      const p = t.match(HALFWIDTH_PUNCT_RE);
      if (p) add(out, 8, rel, i + 1, `中文语境用了半角标点 \`${p[0].match(/[,;:!?()]/)[0]}\`：…${snippet(t, p[0])}…`);
      const e = t.match(EMOJI_RE);
      if (e) add(out, 8, rel, i + 1, `含 emoji \`${e[0]}\``);
    }
  }
  flush(lines.length);
}

/** 组 9：相对 Markdown 链接目标不存在（锚点与外部 URL 跳过；扫描含归档区）。 */
function checkLinks(rel, abs, lines, a, out) {
  const dir = dirname(abs);
  for (let i = 0; i < lines.length; i++) {
    if (a.fenced[i] || a.commented[i]) continue;
    for (const m of maskInline(lines[i]).matchAll(LINK_RE)) {
      const target = m[1].trim();
      if (!target || target.startsWith('#') || SCHEME_RE.test(target)) continue;
      const pathPart = target.split('#')[0];
      if (pathPart && !targetExists(dir, pathPart)) add(out, 9, rel, i + 1, `相对链接目标不存在：${target}`);
    }
  }
}

/** 取匹配处上下文的短片段（±8 字符）。 */
function snippet(text, match) {
  const at = text.indexOf(match);
  if (at === -1) return match;
  return text.slice(Math.max(0, at - 8), at + match.length + 8).trim();
}

/** 文件实际派发的组（豁免与 --skip 后的净执行面）；main 用它落实「0 判据不冒充通过」。 */
function activeGroups(loc, isIndex, skip) {
  const g = new Set();
  if (!loc.inArchive && TYPED_HOMES.has(loc.home) && !isIndex) { g.add(1); g.add(2); }
  if (loc.home === 'notes' && !loc.inArchive && !isIndex) g.add(3);
  if (loc.inArchive && !isIndex) g.add(4);
  if (!loc.inArchive) { g.add(5); g.add(6); g.add(7); g.add(8); }
  g.add(9);
  for (const s of skip) g.delete(s);
  return g;
}

/** 按豁免清单分发组 1 至 9（组 0 独立预检）：归档区只受组 4、9 管辖；组 1/2/4 只读头块；围栏与行内代码中的同形文本不参与判定。返回该文件是否有判据实际执行（组 0 编码检查不计入豁免面）。 */
function checkDoc(f, skip, out) {
  const { lines, bad } = readLines(f.abs);
  const a = analyze(lines);
  const hdr = parseHeader(lines);
  const loc = locate(f.abs);
  const base = basename(f.abs);
  const isIndex = INDEX_NAMES.has(base) || base === 'SKILL.md'; // 类型化文档的例外名
  const g = activeGroups(loc, isIndex, skip);
  if (bad) add(out, 0, f.rel, 1, '文件含无法按 UTF-8 解码的字节（疑似非 UTF-8 编码），其余判据不可信');
  if (g.has(1)) checkHeaderBlock(f.rel, hdr, out);
  if (g.has(2)) checkSuperseded(f.rel, dirname(f.abs), hdr, out);
  if (g.has(3)) checkNoteHeader(f.rel, lines, loc, out);
  if (g.has(4)) checkArchivedHeader(f.rel, hdr, out);
  if (g.has(5)) checkHomeName(f.rel, hdr, loc, base, isIndex, out);
  if (!loc.inArchive) checkProse(f.rel, lines, a, hdr, g, out);
  if (g.has(9)) checkLinks(f.rel, f.abs, lines, a, out);
  return g.size > 0 || bad;
}

/** 组 5c：`.agents/` 子树内目录名 kebab-case（归档区只受组 4、9 管辖，不查）。返回实际检查的目录数。 */
function checkDirNames(dirs, skip, out) {
  let n = 0;
  if (skip.has(5)) return 0;
  for (const d of dirs) {
    const loc = locate(d.abs, true);
    if (!loc.inAgents || loc.home === null || loc.inArchive) continue;
    n++;
    if (!KEBAB_RE.test(basename(d.abs))) add(out, 5, d.rel, 0, '目录名不合 kebab-case（小写字母、数字、连字符）');
  }
  return n;
}

function main(argv) {
  let opts;
  try { opts = parseArgs(argv); } catch (e) {
    if (e instanceof UsageError) { console.error(`用法错误：${e.message}\n${USAGE}`); return 2; }
    throw e;
  }
  if (opts.help) { console.log(USAGE); return 0; }
  const confErr = selfCheck();
  if (confErr) { console.error(`配置错误：${confErr}`); return 2; }
  const roots = opts.paths.length ? opts.paths.map((p) => resolve(p)) : [resolve('.agents'), resolve('docs')].filter((p) => existsSync(p));
  if (opts.paths.length) for (const [i, r] of roots.entries()) if (!existsSync(r)) { console.error(`路径不存在：${opts.paths[i]}`); return 2; }
  if (!roots.length) { console.error('未检查任何文件：默认两根 `.agents/` 与 `docs/` 均不存在'); return 2; }
  const { files, dirs } = collect(roots, opts.excludes);
  if (!files.length) { console.error(`未检查任何文件：扫描面为空（${roots.map(relOf).join('、')}）`); return 2; }
  const out = [];
  let ran = false;
  for (const f of files) ran = checkDoc(f, opts.skip, out) || ran;
  ran = checkDirNames(dirs, opts.skip, out) > 0 || ran;
  if (!ran) { console.error('未检查任何文件：扫描面内 0 条判据可执行（所有适用组均被 --skip 跳过，不冒充通过）'); return 2; }
  out.sort((x, y) => (x.rel < y.rel ? -1 : x.rel > y.rel ? 1 : x.line - y.line || x.group - y.group));
  for (const x of out) console.log(`[组 ${x.group} · ${GROUP_NAMES[x.group]}] ${x.line > 0 ? `${x.rel}:${x.line}` : `${x.rel}/`} — ${x.msg}`);
  console.log(`检查 ${files.length} 篇 / 告警 ${out.length} 条 / 跳过 ${opts.skip.size} 项`);
  if (out.length && opts.strict) { console.error(`✗ --strict：${out.length} 条告警`); return 1; }
  return 0;
}

try {
  process.exit(main(process.argv.slice(2)));
} catch (e) {
  console.error(`内部错误：${e && e.stack ? e.stack : e}`); // 诚实条款：异常必须响，不静默返回 0
  process.exit(2);
}
