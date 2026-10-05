#!/usr/bin/env node
/**
 * doc-query.mjs —— 按需结构化索引与时效报告（纯 node 标准库、零依赖）。
 *
 * 「禁全局 INDEX.md」的另一半答案：索引不入库、按需生成，因此永远不会腐烂。
 *
 * 用法：
 *   node scripts/doc-query.mjs                       # 全量（已入库文档）
 *   node scripts/doc-query.mjs --home plans --status active
 *   node scripts/doc-query.mjs --type postmortem
 *   node scripts/doc-query.mjs --stale               # 只看该复核的
 *   node scripts/doc-query.mjs --all                 # 并入未入库文档
 *   node scripts/doc-query.mjs --json                # 机器可读
 */

import { basename } from 'node:path';
import {
  ROOT, classifyDoc, dayDiff, discoverDocs, fieldValue, loadRegistry, parseHeader, readDoc, today,
} from './doc-lib.mjs';

function argOf(args, name) {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] : null;
}

/** frontmatter 文件的标题在 `---` 之后；取第一个 `# ` 标题作为显示名。 */
function heading(lines, header) {
  if (header.title) return header.title;
  const h = lines.find((l) => /^#\s+\S/.test(l));
  return h ? h.replace(/^#\s+/, '') : null;
}

/** 汇总每篇文档的索引条目；不做校验（校验归 check-doc-types）。 */
export function collect(root = ROOT, opts = {}) {
  const reg = loadRegistry(root);
  const todayStr = opts.today ?? today();
  const docs = discoverDocs(root, reg, { includeUntracked: opts.includeUntracked ?? opts.all ?? false });
  const rows = [];
  for (const doc of docs) {
    const lines = readDoc(doc.abs);
    const header = parseHeader(lines);
    const { type } = classifyDoc(doc.rel, reg, header);
    if (!type) continue;
    const t = reg.types[type];
    const status = fieldValue(header, 'Status');
    const updated = fieldValue(header, 'Updated');
    const verified = fieldValue(header, 'Verified');
    let stale = null;
    if (t.freshness) {
      const f = t.freshness;
      const when = f.when ? Object.values(f.when)[0].includes(status) : true;
      const value = fieldValue(header, f.field);
      const age = value ? dayDiff(value, todayStr) : null;
      if (when && age !== null && age > f.maxAgeDays) stale = { field: f.field, age, max: f.maxAgeDays, value };
    }
    rows.push({
      type, title: t.title, home: t.home, rel: doc.rel, name: basename(doc.rel, '.md'),
      status: status ?? null, updated: updated ?? null, verified: verified ?? null,
      heading: heading(lines, header), stale,
    });
  }
  rows.sort((a, b) => a.rel.localeCompare(b.rel));
  return { reg, rows, today: todayStr };
}

function pad(s, n) {
  const w = [...String(s ?? '')].reduce((a, c) => a + (/[\u3400-\u9fff\uf900-\ufaff]/.test(c) ? 2 : 1), 0);
  return String(s ?? '') + ' '.repeat(Math.max(0, n - w));
}

const args = process.argv.slice(2);
const opts = { all: args.includes('--all'), today: argOf(args, 'today') };
const { reg, rows } = collect(ROOT, opts);
const fType = argOf(args, 'type');
const fStatus = argOf(args, 'status');
const fHome = argOf(args, 'home');
const staleOnly = args.includes('--stale');

let out = rows.filter((r) => (!fType || r.type === fType) && (!fStatus || r.status === fStatus) && (!fHome || r.home === fHome) && (!staleOnly || r.stale));

if (args.includes('--json')) {
  console.log(JSON.stringify(out, null, 2));
} else if (!out.length) {
  console.log('（无匹配文档）');
} else {
  console.log(`${pad('类型', 14)}${pad('状态', 12)}${pad('更新', 12)}${pad('复核', 12)}标题 / 路径`);
  for (const r of out) {
    const mark = r.stale ? ` ← ${r.stale.field} 已 ${r.stale.age} 天（上限 ${r.stale.max}）` : '';
    console.log(`${pad(r.type, 14)}${pad(r.status ?? '—', 12)}${pad(r.updated ?? '—', 12)}${pad(r.verified ?? '—', 12)}${r.heading ?? r.name}`);
    console.log(`${pad('', 50)}${r.rel}${mark}`);
  }
  const byType = {};
  for (const r of out) byType[r.type] = (byType[r.type] ?? 0) + 1;
  console.log(`\n共 ${out.length} 篇：${Object.entries(byType).map(([k, v]) => `${k}×${v}`).join(' ')}${staleOnly ? '' : `；时效告警 ${out.filter((r) => r.stale).length} 篇（--stale 只看这些）`}`);
  if (staleOnly) console.log('消费审计提醒：时效是机器报的，消费是另一回事——翻本月会话记录核对实际打开过的文档，没被消费的翻状态或归档。');
}
