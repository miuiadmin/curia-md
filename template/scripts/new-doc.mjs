#!/usr/bin/env node
/**
 * new-doc.mjs —— 按类型注册表建档 / 给既有文档补头块（纯 node 标准库、零依赖）。
 *
 * 用法：
 *   node scripts/new-doc.mjs --list
 *   node scripts/new-doc.mjs --type <type> --topic <topic> [--title <标题>] [--status <s>] [--date yyyy-mm-dd] [--dry-run]
 *   node scripts/new-doc.mjs --type skill|runbook --name <技能目录名> [--title <标题>]
 *   node scripts/new-doc.mjs --adopt <path.md> --type <type> [--status <s>]
 *
 * 建档：按 .agents/templates/<type>.md 生成骨架，填好日期与头块；目标已存在则拒绝覆盖。
 * --adopt：只改头块（插入或补全 Type/Status/Updated 等必填字段），正文一字不动；
 *   必填字段无法推断时留下 `<…>` 占位符，check-doc-types 会拦住直到填完。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DATE_RE, DATED_FILENAME_RE, ROOT, isMainModule, loadRegistry, normalizeLines, parseHeader, today,
} from './doc-lib.mjs';

function usage(msg) {
  if (msg) console.error(`new-doc: ${msg}`);
  console.error('用法：node scripts/new-doc.mjs --list | --type <type> --topic <topic> | --type skill --name <dir> | --adopt <path> --type <type>');
  process.exit(msg ? 1 : 0);
}

function argOf(args, name) {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] : null;
}

function listTypes(reg) {
  for (const [home, h] of Object.entries(reg.homes)) {
    console.log(`\n${home}（${h.job}，${h.criterion}）`);
    for (const key of h.types) {
      const t = reg.types[key];
      const status = t.statuses.length ? `｜状态 ${t.statuses.join('/')}` : '';
      const tmpl = t.template ? `｜模板 templates/${t.template}` : '｜无模板';
      console.log(`  ${key.padEnd(12)} ${t.title}${status}${tmpl}`);
      console.log(`  ${''.padEnd(12)} 装：${t.purpose}`);
      if (t.notFor) console.log(`  ${''.padEnd(12)} 不装：${t.notFor}`);
    }
  }
  console.log('');
}

/** 由 topic 生成一个像样的标题。 */
function titleFrom(topic) {
  return topic.split('-').filter(Boolean).join(' ');
}

function fillTemplate(text, { title, date, topic }) {
  return text.replaceAll('{{TITLE}}', title).replaceAll('{{DATE}}', date).replaceAll('{{TOPIC}}', topic);
}

/**
 * 由模板渲染建档内容（纯函数）：算出目标相对路径，填入标题/日期/topic，并按需覆盖 Status。
 * 供 CLI 与自证套件共用；不做写盘，不校验类型合法性（调用方负责）。
 */
export function renderScaffold(reg, type, opts = {}) {
  const t = reg.types[type];
  if (!t?.template) throw new Error(`类型 \`${type}\` 没有模板`);
  const templatePath = join(opts.root ?? ROOT, reg.templateDir, t.template);
  if (!existsSync(templatePath)) throw new Error(`模板缺失：${reg.templateDir}/${t.template}`);
  const template = readFileSync(templatePath, 'utf8');
  const topic = opts.topic ?? opts.name ?? 'sample';
  const date = opts.date ?? today();

  let rel;
  if (t.naming === 'dated') {
    rel = join(reg.homes[t.home].path, `${date}-${topic}.md`);
  } else if (t.naming === 'fixed') {
    rel = t.location[0].replace('*', opts.name ?? topic);
    if (rel.includes('*')) throw new Error(`类型 \`${type}\` 的位置模式含多个通配符：${t.location[0]}`);
  } else {
    throw new Error(`类型 \`${type}\` 不支持脚本建档`);
  }

  const body = fillTemplate(template, { title: opts.title ?? titleFrom(topic), date, topic });
  const status = opts.status ?? t.initialStatus;
  const text = t.statuses.length ? body.replace(/^Status: .*$/m, `Status: ${status}`) : body;
  return { rel: rel.split('\\').join('/'), text, status };
}

function createDoc(reg, root, opts) {
  const type = opts.type;
  const t = reg.types[type];
  if (!t) usage(`未注册的类型 \`${type}\`；用 --list 看全部类型`);
  if (t.externalGuard) usage(`类型 \`${type}\` 走笔记树流程，用 write-note 技能而不是本脚本`);
  if (!t.template) usage(`类型 \`${type}\` 没有模板（${t.title}），不能由脚本建档`);
  if (t.naming === 'dated' && !opts.topic) usage(`类型 \`${type}\` 是日期型，必须给 --topic`);
  if (t.naming === 'fixed' && !opts.name) usage(`类型 \`${type}\` 是固定命名，必须给 --name（技能目录名）`);
  if (opts.date && !DATE_RE.test(opts.date)) usage(`--date 必须为 yyyy-mm-dd，实为 \`${opts.date}\``);

  let scaffold;
  try {
    scaffold = renderScaffold(reg, type, opts);
  } catch (e) {
    usage(e.message);
  }
  const { rel, text, status } = scaffold;
  const abs = join(root, rel);
  if (existsSync(abs)) usage(`目标已存在，拒绝覆盖：${rel}`);

  if (opts.dryRun) {
    console.log(`--- ${rel}（dry-run）---\n${text}`);
    return;
  }
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, text);
  console.log(`✓ 已建档 ${rel}（类型 ${type}，Status: ${status}）`);
  const pending = (t.fields?.required ?? []).filter((f) => new RegExp(`^${f}:.*<`, 'm').test(text));
  if (pending.length) console.log(`  待填字段：${pending.map((f) => `\`${f}:\``).join(' ')}（留占位符会被门禁拦下）`);
  console.log('  下一步：填完必备节 → node scripts/run-checks.mjs');
}

/**
 * 给既有文档补头块：只改头块，正文一字不动。返回 { rel, fields, text }。
 * 校验失败抛错（CLI 转成用法提示）。
 * 诚实性约束：必填但无法推断的字段留 `<…>` 占位符让门禁拦住；可选字段绝不凭空生成
 *   （尤其 `Verified:`——它是「我按这份文档跑过并看到预期结果」的声明，不能替人签）。
 */
export function adoptDoc(reg, root, opts) {
  const rel = opts.adopt;
  const type = opts.type;
  const t = reg.types[type];
  if (!t) throw new Error(`未注册的类型 \`${type}\``);
  if (t.externalGuard) throw new Error(`类型 \`${type}\` 由 ${t.externalGuard} 专属守卫（笔记树自带头块格式），--adopt 会破坏它`);
  if (t.header === 'none' || t.header === 'frontmatter' || t.header === 'external') throw new Error(`类型 \`${type}\` 不带头块字段，无需 --adopt`);
  const abs = resolve(root, rel);
  if (!existsSync(abs)) throw new Error(`文件不存在：${rel}`);

  const lines = normalizeLines(readFileSync(abs, 'utf8'));
  const header = parseHeader(lines);
  if (!header.titleOk) throw new Error(`${rel} 第 1 行不是 \`# <标题>\`，先补标题再 --adopt`);
  const existing = new Map(header.fields.map((f) => [f.key, f.value]));
  if (existing.has('Type') && existing.get('Type') !== type) {
    throw new Error(`${rel} 已声明 \`Type: ${existing.get('Type')}\`，与 --type ${type} 冲突`);
  }

  const required = t.fields?.required ?? [];
  const dateFromName = DATED_FILENAME_RE.exec(rel.split('/').pop())?.[1];
  const values = {
    Type: type,
    Status: opts.status ?? existing.get('Status') ?? t.initialStatus ?? t.statuses[0],
    Updated: existing.get('Updated') ?? dateFromName ?? today(),
    Verified: existing.get('Verified') ?? (required.includes('Verified') ? '<按文档跑一遍后填 yyyy-mm-dd>' : null),
    Owner: existing.get('Owner'),
    Source: existing.get('Source') ?? (required.includes('Source') ? '<填写事实来源：链接或系统名>' : null),
    Note: existing.get('Note'),
    Supersedes: existing.get('Supersedes'),
    'Superseded-by': existing.get('Superseded-by'),
    Archived: existing.get('Archived'),
  };
  const wanted = [...required, ...(t.fields?.optional ?? [])];
  const order = Object.keys(reg.headerFields);
  const fields = order.filter((k) => wanted.includes(k) && values[k]);

  const text = [lines[0], '', ...fields.map((k) => `${k}: ${values[k]}`), '', ...lines.slice(header.headerEnd)].join('\n')
    .replace(/\n{3,}/g, '\n\n');
  const out = text.endsWith('\n') ? text : `${text}\n`;
  if (!opts.dryRun) writeFileSync(abs, out);
  return { rel, fields, text: out, placeholders: fields.filter((k) => /<[^>]*>/.test(values[k])) };
}

// 直接执行时做主入口；被自证套件 import 时不触发。
if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  const reg = loadRegistry(ROOT);
  if (args.includes('--list') || args.includes('-h') || args.includes('--help') || args.length === 0) {
    listTypes(reg);
    process.exit(0);
  }
  const opts = {
    type: argOf(args, 'type'),
    topic: argOf(args, 'topic'),
    name: argOf(args, 'name'),
    title: argOf(args, 'title'),
    status: argOf(args, 'status'),
    date: argOf(args, 'date'),
    adopt: argOf(args, 'adopt'),
    dryRun: args.includes('--dry-run'),
  };
  if (opts.adopt) {
    if (!opts.type) usage('--adopt 需要同时给 --type');
    let result;
    try {
      result = adoptDoc(reg, ROOT, opts);
    } catch (e) {
      usage(e.message);
    }
    if (!opts.dryRun) console.log(`✓ 已补头块 ${result.rel}（类型 ${opts.type}，字段：${result.fields.join(' ')}）`);
    else console.log(`--- ${result.rel}（dry-run）---\n${result.text}`);
    if (result.placeholders.length) console.log(`  待填字段：${result.placeholders.map((f) => `\`${f}:\``).join(' ')}（留占位符会被门禁拦下）`);
    console.log('  下一步：核对必备节是否齐全 → node scripts/run-checks.mjs');
  } else {
    createDoc(reg, ROOT, opts);
  }
}
