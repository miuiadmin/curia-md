#!/usr/bin/env node
/**
 * check-prose.mjs —— 写作与排版层守卫（单文件、纯 node 标准库、零依赖）。
 *
 * 规则来自 .agents/README.md 的「写作与格式（硬规则）」与 .agents/skills/prose-standard/SKILL.md，
 * 排版细则参考 kimi-code 的 docs/AGENTS.md（中英混排空格、全角标点）。
 * 语义层的 slop（重复规则、推理记录、状态注解）无法机械判定，归 prose-standard 技能与人工审校。
 *
 * 报错（阻断）：
 *   1) emoji 与装饰符号
 *   2) 中文与英文/数字之间缺半角空格
 *   3) 中文语境用了半角标点 , ; : ! ? ( )
 *   4) 一个自然段跨多物理行（应一段一行，靠编辑器软折行）
 *   5) 正文用了 GLOSSARY 里 `_Avoid_: !词` 标记的硬禁用词
 * 报警（不阻断，靠审校判断）：
 *   6) 正文裸写仓库路径（应写成相对链接或行内代码）
 *   7) 跨文档重复句（「一事实一归属」的机械探针）
 *
 * 豁免：生成物（注册表投影）、模板目录、归档冻结区、原始语料目录、fenced code、HTML 注释、
 *   行内代码、链接目标、`「」` 引用（提及禁用词以讨论它不算使用）、GLOSSARY 自身、表格行与列表行
 *   （第 4 条只对连续散文行生效）。
 *
 * 运行：node scripts/check-prose.mjs [--all] [--path <rel>]
 *   环境变量 CURIA_STAGED=1 时走暂存模式（pre-commit 调用）：发现面、注册表与正文全部取自 git 索引，
 *   校验的是将要提交的版本——先 add 坏版本、再在盘上改好，仍会按索引里的版本拦下。
 */

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CJK_SPACING_RE, HALFWIDTH_PUNCT_RE, ROOT, countMissingRuleIds, discoverDocs, isMainModule,
  loadRegistry, logRuleHits, maskSource, proseLines, readDoc, readDocStaged,
} from './doc-lib.mjs';

const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/gu;
// 放行的功能性符号：✓ ✗ 在三档示例里当对错标记用；→ ← 属排版箭头，不在 emoji 范围内
const ALLOWED_SYMBOL_RE = /^[\u2713\u2714\u2717\u2718]$/;
const BARE_PATH_RE = /(?:\.agents|scripts|开源项目|templates)\/[\w./\-\u4e00-\u9fff]+/g;
const STRUCTURAL_RE = /^(?:\s{0,3}#{1,6}\s|\s*(?:[-*+]|\d+[.)])\s|\s*\||\s*>\s?|\s*(-{3,}|\*{3,}|_{3,})\s*$)/;

/** 去掉行内代码、链接目标、HTML 标签，留下供排版检查的可见文本。 */
function stripInline(text) {
  return text
    .replace(/`[^`]*`/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ');
}

function isProseLine(text) {
  return text.trim() !== '' && !STRUCTURAL_RE.test(text);
}

/** 头块（YAML frontmatter 或 `# 标题` + `Key: value` 字段行）不是段落，跳过它再判「一段一物理行」。 */
function proseStart(lines) {
  if ((lines[0] ?? '').trim() === '---') {
    for (let i = 1; i < lines.length; i++) if (lines[i].trim() === '---') return i + 1;
    return lines.length;
  }
  let i = /^#\s/.test(lines[0] ?? '') ? 1 : 0;
  while (i < lines.length && lines[i].trim() === '') i++;
  while (i < lines.length && /^[A-Za-z][A-Za-z-]*:\s*\S/.test(lines[i])) i++;
  while (i < lines.length && lines[i].trim() === '') i++;
  return i;
}

/**
 * 从 GLOSSARY 解析硬禁用词：`_Avoid_:` 列表里以全角 `！` 开头的条目才是机械校验对象。
 * 不带 `！` 的条目留给 prose-standard 与人工判断——「原则」「脚本」「目录」「白名单」这类词
 * 只在特定语境下才是错的，一刀切会淹没真问题（实测：全部条目扫出 477 处命中，绝大多数合法）。
 * 用全角 `！` 而不是半角 `!`，因为半角感叹号会被本文件的全角标点规则拦下。
 */
function loadAvoidedTerms(root, staged = false) {
  // 暂存模式：禁用词清单也取自索引版 GLOSSARY（与其余被检文件同一语义）
  const lines = staged
    ? readDocStaged(root, '.agents/GLOSSARY.md')
    : (existsSync(join(root, '.agents', 'GLOSSARY.md')) ? readDoc(join(root, '.agents', 'GLOSSARY.md')) : null);
  if (lines === null) return [];
  const out = [];
  for (const line of lines) {
    const m = /^\*\*([^*]+)\*\*：.*_Avoid_:\s*(.+)$/.exec(line.trim());
    if (!m) continue;
    for (const raw of m[2].split(/[、,，]/)) {
      const word = raw.trim().replace(/^！/, '').replace(/（.*$/, '').trim();
      if (raw.trim().startsWith('！') && word) out.push({ word, term: m[1] });
    }
  }
  return out.filter((e) => e.word);
}

function checkFile(rel, lines, mask, reg, errors, warnings, avoided = []) {
  const prose = proseLines(lines, mask);
  const start = proseStart(lines);
  let prevProseIdx = null;
  const sentences = [];
  const isGlossary = /(^|\/)GLOSSARY\.md$/.test(rel);

  for (const { i, text } of prose) {
    const no = i + 1;
    const visible = stripInline(text);

    const deco = [...visible.matchAll(EMOJI_RE)].map((m) => m[0]).find((c) => !ALLOWED_SYMBOL_RE.test(c));
    if (deco) errors.push(`排版: ${rel} — 第 ${no} 行含 emoji 或装饰符号 \`${deco}\`（硬规则：禁 emoji） [prose/emoji]`);

    for (const m of visible.matchAll(CJK_SPACING_RE)) {
      const at = m.index;
      const ctx = visible.slice(Math.max(0, at - 6), at + 8);
      errors.push(`排版: ${rel} — 第 ${no} 行中英混排缺半角空格：…${ctx}… [prose/cjk-space]`);
      break; // 一行只报第一处，避免刷屏
    }

    for (const m of visible.matchAll(HALFWIDTH_PUNCT_RE)) {
      const at = m.index;
      const ctx = visible.slice(Math.max(0, at - 6), at + 8);
      errors.push(`排版: ${rel} — 第 ${no} 行中文语境应用全角标点：…${ctx}… [prose/halfwidth-punct]`);
      break;
    }

    if (isProseLine(text)) {
      if (i >= start && prevProseIdx !== null && prevProseIdx === i - 1) {
        errors.push(`排版: ${rel} — 第 ${no} 行与上一行同属一段却换了物理行（一段一物理行；分段请空一行） [prose/paragraph-split]`);
      }
      prevProseIdx = i;
      const flat = visible.replace(/[*_`#>|]/g, '').replace(/\s+/g, ' ').trim();
      if (flat.length >= 40) sentences.push({ rel, no, text: flat });
    } else {
      prevProseIdx = null;
    }
  }

  // 裸路径：整条链接（含链接文本）与行内代码都不算裸写；头块字段行不是正文
  for (const { i, text } of prose) {
    if (i < start || !isProseLine(text)) continue;
    const bare = text
      .replace(/!?\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/`[^`]*`/g, ' ')
      .match(BARE_PATH_RE);
    if (bare) warnings.push(`引用: ${rel} — 第 ${i + 1} 行裸写仓库路径 ${bare[0]}（写成相对链接或行内代码） [prose/bare-path]`);
  }

  // 术语硬禁用：GLOSSARY 里 `_Avoid_: !词` 的条目在正文出现即报错（术语表自身、行内代码、链接、「」引用除外）
  if (!isGlossary && avoided.length) {
    for (const { i, text } of prose) {
      if (i < start) continue;
      const scan = text
        .replace(/!?\[[^\]]*\]\([^)]*\)/g, ' ')
        .replace(/`[^`]*`/g, ' ')
        .replace(/「[^」]*」/g, ' ');
      for (const { word, term } of avoided) {
        if (scan.includes(word)) errors.push(`术语: ${rel} — 第 ${i + 1} 行用了禁用词「${word}」（「${term}」的 _Avoid_ 硬条目）；改用登记术语 [prose/term-avoided]`);
      }
    }
  }

  return sentences;
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

  const allSentences = [];
  const avoided = loadAvoidedTerms(root, staged);
  let scanned = 0;
  for (const doc of docs) {
    // 冻结区与生成物不参与写作检查
    if (/^\.agents\/(archive|notes\/archived)\//.test(doc.rel)) continue;
    if (doc.rel === reg.projection) continue;
    // 暂存模式：正文取自索引，盘上删改不影响判定；索引里读不到（未入库草稿等）一律跳过
    const lines = staged ? readDocStaged(root, doc.rel) : (existsSync(doc.abs) ? readDoc(doc.abs) : null);
    if (lines === null) continue; // 非暂存模式下索引里有、盘上已删：不是写作问题
    const mask = maskSource(lines);
    allSentences.push(...checkFile(doc.rel, lines, mask, reg, errors, warnings, avoided));
    scanned++;
  }

  // 跨文档重复句：同一句话出现在两个及以上文件里，通常意味着规则被复制而不是被链接
  const byText = new Map();
  for (const s of allSentences) {
    if (!byText.has(s.text)) byText.set(s.text, []);
    byText.get(s.text).push(s);
  }
  for (const [, group] of byText) {
    const files = [...new Set(group.map((g) => g.rel))];
    if (files.length < 2) continue;
    const a = group[0];
    warnings.push(`重复: ${files.join(' 与 ')} — 同一句话出现 ${group.length} 次（${a.rel} 第 ${a.no} 行起）：保留一个归属，其余改成链接 [prose/duplicate-sentence]`);
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
  for (const w of result.warnings) console.warn(`warning: prose: ${w}`);
  const missing = countMissingRuleIds([...result.errors, ...result.warnings]);
  if (missing > 0) result.errors.push(`门禁: check-prose 有 ${missing} 条输出未挂规则 ID [meta/missing-rule-id]`);
  if (result.errors.length) {
    for (const e of result.errors) console.error(`prose: ${e}`);
    console.error(`✗ check-prose 未通过：共 ${result.errors.length} 处错误（扫描 ${result.stats.scanned} 篇文档）；机械类错误可先跑 node scripts/fix-doc.mjs --write <路径>`);
  }
  logRuleHits(ROOT, result.errors, result.warnings);
  if (result.errors.length) process.exit(1);
  console.log(`✓ check-prose 通过：${result.stats.scanned} 篇文档，emoji/中英空格/全角标点/一段一物理行全部合规`);
}
