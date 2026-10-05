#!/usr/bin/env node
/**
 * check-layout.mjs —— 版式层守卫（单文件、纯 node 标准库、零依赖）。
 *
 * check-prose 管散文（emoji、中英空格、全角标点、一段一物理行、术语），本脚本管版式：
 * 那些会让渲染出错或让机器解析出错的结构性问题。语义与豁免范围与 check-prose 同源
 * （索引语义、注册表 exemptPaths、.agents-raw 原始语料目录、归档冻结区、生成物投影）。
 *
 * 严重度按「是否影响渲染或机器解析」分层：
 * 报错（阻断）：
 *   1) 代码栅栏未闭合 —— 后续全部内容被当代码，整篇结构失效
 *   2) 表格行的列数与表头不符 —— 渲染成破表
 *   3) 标题层级跳跃（H2 直接到 H4）—— 目录与大纲断裂
 *   4) 文件结尾缺换行 —— 拼接与 diff 出错
 *   5) 行尾空白 —— 不可见噪声，破坏精确匹配
 * 报警（不阻断）：
 *   6) 代码栅栏缺语言标记 —— 只是丢高亮
 *   7) 连续空行 —— 渲染上等价于一个空行
 *
 * 刻意不收的规则（会造假阳性，见 notes 里的取舍记录）：
 *   裸 URL —— `Source:` 字段与来源索引文档本就该露出原始链接
 *   弯引号 —— 逐字引用英文原话时 “…” 是正确写法
 *
 * 豁免细节：栅栏内是数据不是版式，不查行尾空白与空行；HTML 注释区整段跳过；
 * YAML frontmatter 里的 `#` 是注释不是标题，跳过标题与表格判定。
 *
 * 运行：node scripts/check-layout.mjs [--all] [--path <rel>]
 *   环境变量 CURIA_STAGED=1 时走暂存模式（pre-commit 调用）：发现面、注册表与正文全部取自 git 索引，
 *   校验的是将要提交的版本——先 add 坏版本、再在盘上改好，仍会按索引里的版本拦下。
 */

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, countMissingRuleIds, discoverDocs, isMainModule, loadRegistry, logRuleHits, maskSource, readDoc, readDocStaged } from './doc-lib.mjs';

const FENCE_RE = /^(\s{0,3})(```+|~~~+)(.*)$/;
const HEADING_RE = /^\s{0,3}(#{1,6})(?:\s|$)/;
const TABLE_ROW_RE = /^\s{0,3}\|.*\|\s*$/;
const FRONTMATTER_DELIM = /^\s{0,3}---\s*$/;

/** 表格列数：先摘掉行内代码（里面可能有竖线），再按未转义的 `|` 切。 */
function tableCols(line) {
  const bare = line.trim().replace(/`[^`]*`/g, ' ').replace(/^\|/, '').replace(/\|$/, '');
  return bare.split(/(?<!\\)\|/).length;
}

/** frontmatter 区间 [start, end]（0 基，含两端）；没有则返回 null。 */
function frontmatterRange(lines) {
  if (!FRONTMATTER_DELIM.test(lines[0] ?? '')) return null;
  for (let i = 1; i < lines.length; i++) {
    if (FRONTMATTER_DELIM.test(lines[i])) return [0, i];
  }
  return null;
}

function checkFile(rel, lines, errors, warnings) {
  const { commented } = maskSource(lines);
  const fm = frontmatterRange(lines);
  const inFm = (i) => fm !== null && i >= fm[0] && i <= fm[1];

  let fence = null;          // 当前开栅栏的标记串
  let fenceOpenLine = 0;
  let prevLevel = 0;
  let tableStart = 0;
  let tableColsExpected = 0;

  // 以 \n 结尾的文件，split 后末元素是空串——它不是内容行；尾部空行串不参与逐行版式判定
  const withEof = lines[lines.length - 1] === '';
  const raw = withEof ? lines.slice(0, -1) : lines;
  let contentEnd = raw.length;
  while (contentEnd > 0 && raw[contentEnd - 1].trim() === '') contentEnd--;
  const body = raw.slice(0, contentEnd);

  for (let i = 0; i < body.length; i++) {
    const no = i + 1;
    const line = body[i];

    if (commented[i] && !FENCE_RE.test(line)) continue; // HTML 注释区整段跳过

    const fmLine = FENCE_RE.exec(line);
    if (fmLine && !inFm(i)) {
      if (fence === null) {
        fence = fmLine[2];
        fenceOpenLine = no;
        if (!fmLine[3].trim()) {
          warnings.push(`版式: ${rel} 第 ${no} 行 — 代码栅栏缺语言标记（写成 \`\`\`text 或具体语言，便于高亮与工具识别） [layout/fence-language]`);
        }
      } else if (fmLine[2][0] === fence[0] && fmLine[2].length >= fence.length) {
        fence = null;
      }
      continue;
    }
    if (fence !== null) continue; // 栅栏内是数据不是版式

    if (line.trimEnd() !== line) errors.push(`版式: ${rel} 第 ${no} 行 — 行尾有空白字符 [layout/trailing-whitespace]`);
    if (line.trim() === '' && (body[i - 1] ?? '').trim() === '' && !inFm(i)) {
      warnings.push(`版式: ${rel} 第 ${no} 行 — 连续空行（段落之间只留一个空行） [layout/consecutive-blank]`);
    }

    if (inFm(i)) continue;

    const h = HEADING_RE.exec(line);
    if (h && line.trim() !== '') {
      const level = h[1].length;
      if (prevLevel !== 0 && level > prevLevel + 1) {
        errors.push(`版式: ${rel} 第 ${no} 行 — 标题层级跳跃 H${prevLevel} → H${level}（逐级下降，大纲才不断裂） [layout/heading-jump]`);
      }
      prevLevel = level;
      continue;
    }

    if (TABLE_ROW_RE.test(line)) {
      const cols = tableCols(line);
      if (tableStart === 0) {
        tableStart = no;
        tableColsExpected = cols;
      } else if (cols !== tableColsExpected) {
        errors.push(`版式: ${rel} 第 ${no} 行 — 表格有 ${cols} 列，与表头（第 ${tableStart} 行 ${tableColsExpected} 列）不符：单元格里的竖线要转义成 \\| [layout/table-columns]`);
      }
    } else {
      tableStart = 0;
      tableColsExpected = 0;
    }
  }

  if (fence !== null) {
    errors.push(`版式: ${rel} 第 ${fenceOpenLine} 行 — 代码栅栏未闭合（后续内容会被整段当代码） [layout/fence-unclosed]`);
  }

  if (!withEof) {
    errors.push(`版式: ${rel} — 文件结尾缺换行（文本文件应以换行结束，否则拼接与 diff 会出错） [layout/eof-newline]`);
  }
}

export function runCheck(root = ROOT, opts = {}) {
  const errors = [];
  const warnings = [];
  const staged = opts.staged === true; // 暂存模式：正文从 git 索引读（pre-commit 校验将要提交的版本）
  let reg;
  try {
    reg = loadRegistry(root, { staged });
  } catch (e) {
    return { ok: false, errors: [`注册表: ${e.message} [types/registry-load]`], warnings, stats: {} };
  }

  const docs = opts.paths?.length
    ? opts.paths.map((rel) => ({ rel, abs: join(root, rel) }))
    : discoverDocs(root, reg, { includeUntracked: opts.includeUntracked ?? false, staged });

  let scanned = 0;
  for (const doc of docs) {
    if (/^\.agents\/(archive|notes\/archived)\//.test(doc.rel)) continue; // 冻结区不改版式
    if (doc.rel === reg.projection) continue;                              // 生成物由 projection-fresh 管
    // 暂存模式：正文取自索引，盘上删改不影响判定；索引里读不到（未入库草稿等）一律跳过
    const lines = staged ? readDocStaged(root, doc.rel) : (existsSync(doc.abs) ? readDoc(doc.abs) : null);
    if (lines === null) continue;                                          // 非暂存模式下索引里有、盘上已删
    checkFile(doc.rel, lines, errors, warnings);
    scanned++;
  }

  errors.sort();
  warnings.sort();
  return { ok: errors.length === 0, errors, warnings, stats: { scanned } };
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  const opts = { includeUntracked: args.includes('--all'), staged: process.env.CURIA_STAGED === '1' };
  const pi = args.indexOf('--path');
  if (pi !== -1 && args[pi + 1]) opts.paths = [args[pi + 1]];
  const result = runCheck(ROOT, opts);
  for (const w of result.warnings) console.warn(`warning: layout: ${w}`);
  const missing = countMissingRuleIds([...result.errors, ...result.warnings]);
  if (missing > 0) result.errors.push(`门禁: check-layout 有 ${missing} 条输出未挂规则 ID [meta/missing-rule-id]`);
  if (result.errors.length) {
    for (const e of result.errors) console.error(`layout: ${e}`);
    console.error(`✗ check-layout 未通过：共 ${result.errors.length} 处错误（扫描 ${result.stats.scanned} 个文件）；机械类错误可先跑 node scripts/fix-doc.mjs --write <路径>`);
  }
  logRuleHits(ROOT, result.errors, result.warnings);
  if (result.errors.length) process.exit(1);
  console.log(`✓ check-layout 通过：${result.stats.scanned} 个文件，栅栏/表格/标题层级/空白全部合规`);
}
