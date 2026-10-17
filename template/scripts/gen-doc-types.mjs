#!/usr/bin/env node
/**
 * gen-doc-types.mjs —— 从 .agents/doc-types.json 生成可读投影 .agents/doc-types.md。
 *
 * 注册表是唯一权威；投影是它的一次性可读物（给人与不便读 JSON 的场景）。
 * 投影禁止手改：check-doc-types 的 projection-fresh 检查会逐字节比对重生成结果。
 *
 * 注册表写回一律走 serializeRegistry：就地改值、不重建对象，键序不乱，值级变更才呈现为值级 diff——
 * 换一套缩进或整篇重排会炸出上千行格式化 diff，把真正的改动埋掉（2026-10-05 审计的 churn 案例）。
 *
 * 运行：node scripts/gen-doc-types.mjs              # 重生成并写盘
 *       node scripts/gen-doc-types.mjs --check      # 只校验新鲜度，不一致退出码 1
 *       node scripts/gen-doc-types.mjs --stdout     # 打印到标准输出，不写盘
 *       node scripts/gen-doc-types.mjs --normalize  # 注册表按 serializeRegistry 规范写回（稳定键序 + 2 空格缩进），再重生成投影
 */

import { closeSync, constants, fstatSync, ftruncateSync, lstatSync, openSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isMainModule, loadRegistry, registryProjectionPath, ROOT } from './doc-lib.mjs';

// ROOT 从 doc-lib 取（支持 CURIA_ROOT 覆盖）；暂存工具冒烟指向含索引版 Registry 与投影的隔离目录。
// 保留导出以稳定模块表面。
export { ROOT, loadRegistry };

/**
 * 注册表写回的规范序列化：稳定键序（就地改值、不重建对象，键序即文件里的键序）、
 * 2 空格缩进、结尾一个换行。任何脚本写回 .agents/doc-types.json 都必须经由本函数——
 * 值级变更必须呈现为值级 diff，而不是整篇格式化 churn。
 */
export function serializeRegistry(reg) {
  return `${JSON.stringify(reg, null, 2)}\n`;
}

/** 节键 → 中文显示名（取首个别名的标题文本）。 */
function sectionLabel(reg, key) {
  const alias = reg.sectionAliases[key]?.[0];
  return alias ? alias.replace(/^##\s*/, '') : key;
}

function fieldList(reg, type, group) {
  const arr = type.fields?.[group] ?? [];
  return arr.length ? arr.map((f) => `\`${f}\``).join(' ') : '—';
}

function transitionText(type) {
  const entries = Object.entries(type.transitions ?? {});
  if (!entries.length) return '—（无状态机）';
  return entries.map(([from, to]) => `\`${from}\`→${to.length ? to.map((t) => `\`${t}\``).join(' ') : '终态'}`).join('；');
}

function freshnessText(type) {
  const f = type.freshness;
  if (!f) return '—';
  const when = f.when ? `（仅 ${Object.values(f.when).flat().map((s) => `\`${s}\``).join(' ')} 时）` : '';
  return `\`${f.field}\` 超 ${f.maxAgeDays} 天报警${when}`;
}

function typeBlock(reg, key) {
  const t = reg.types[key];
  const home = reg.homes[t.home];
  const out = [];
  out.push(`### \`${key}\` — ${t.title}`);
  out.push('');
  out.push(`- 家：\`${t.home}\`（\`${home.path}\`）；命名：${namingText(t)}；模板：${t.template ? `[templates/${t.template}](./templates/${t.template})` : '—（无模板）'}`);
  if (t.location) out.push(`- 位置：${t.location.map((l) => `\`${l}\``).join(' ')}`);
  out.push(`- 状态：${t.statuses.length ? t.statuses.map((s) => `\`${s}\``).join(' ') : '—'}；迁移：${transitionText(t)}`);
  out.push(`- 必备节（按序）：${(t.sections?.required ?? []).length ? t.sections.required.map((s) => sectionLabel(reg, s)).join(' → ') : '—'}；禁用节：${(t.sections?.forbidden ?? []).length ? t.sections.forbidden.map((s) => sectionLabel(reg, s)).join('、') : '—'}`);
  out.push(`- 字段：必填 ${fieldList(reg, t, 'required')}；可选 ${fieldList(reg, t, 'optional')}；禁止 ${fieldList(reg, t, 'forbidden')}`);
  out.push(`- 时效：${freshnessText(t)}；文体：${t.narrative ? '允许叙事' : '非叙事（禁推理记录）'}`);
  if (t.extraChecks?.length) out.push(`- 专属检查：${t.extraChecks.map((c) => `\`${c}\``).join(' ')}`);
  if (t.externalGuard) out.push(`- 归属守卫：[\`${t.externalGuard}\`](../${t.externalGuard})（本类型不由类型门禁重复校验）`);
  out.push(`- 装什么：${t.purpose}`);
  out.push(`- 不装什么：${t.notFor}`);
  if (t.promotesTo?.length) out.push(`- 晋级去向：${t.promotesTo.map((p) => `\`${p}\``).join('、')}`);
  out.push('');
  return out.join('\n');
}

function namingText(t) {
  if (t.naming === 'dated') return '`yyyy-mm-dd-<topic>.md`';
  if (t.naming === 'notes-tree') return '`{lifecycle}/{class}/yyyy-mm-dd-<topic>.md`';
  if (t.naming === 'free') return '保留原文件名';
  return `\`${(t.location ?? []).join('`、`')}\``;
}

/** 由注册表渲染投影全文（纯函数：同注册表必得同字节，供新鲜度比对）。 */
export function render(reg) {
  const L = [];
  L.push('# 文档类型注册表（投影）');
  L.push('');
  L.push('<!-- 生成物：由 scripts/gen-doc-types.mjs 从 .agents/doc-types.json 生成。禁止手改——改注册表后重生成，projection-fresh 检查逐字节比对。 -->');
  L.push('');
  L.push(`本文件是 [doc-types.json](./doc-types.json) 的可读投影：${Object.keys(reg.types).length} 个类型、${Object.keys(reg.homes).length} 个家。类型系统的机制见 [.agents/README.md](./README.md)；「放哪」由[四句口诀](./README.md)裁决，「是什么」由本文件裁决。`);
  L.push('');
  L.push('常用命令：`node scripts/new-doc.mjs --type <type> --topic <topic>`（按模板建档）、`node scripts/new-doc.mjs --adopt <path> --type <type>`（给既有文档补头块）、`node scripts/doc-query.mjs`（按需索引）、`node scripts/doc-query.mjs --stale`（时效报告）、`node scripts/run-checks.mjs`（门禁）。');
  L.push('');
  L.push('## 家（放哪）');
  L.push('');
  L.push('| 家 | 目录 | 装什么 | 一句话判据 | 允许的类型 |');
  L.push('|---|---|---|---|---|');
  for (const [k, h] of Object.entries(reg.homes)) {
    L.push(`| \`${k}\` | \`${h.path}\` | ${h.job} | ${h.criterion} | ${h.types.map((t) => `\`${t}\``).join(' ')} |`);
  }
  L.push('');
  L.push('## 头块字段');
  L.push('');
  L.push('日期型文档的头块顺序固定为 `# 标题` / 空行 / 字段行（按下表顺序，只写该类型允许的）/ 空行 / 正文。');
  L.push('');
  L.push('| 字段 | 形态 | 语义 |');
  L.push('|---|---|---|');
  for (const [k, f] of Object.entries(reg.headerFields)) {
    L.push(`| \`${k}\` | ${f.kind} | ${f.doc} |`);
  }
  L.push('');
  const g = reg.globalRules;
  L.push(`全局规则：\`Status: superseded\` 必须带 \`${g.statusRequiresField.superseded}\` 链接；\`.agents/archive/\` 下的文档必须带 \`${g.archiveRequiresField}\` 日期行并被 manifest 封印；必备节确实无内容时只允许写 \`${g.emptySectionMarker}\`；字段值不得残留 \`<占位符>\`。`);
  L.push('');
  L.push('## 类型总览');
  L.push('');
  L.push('| 类型 | 家 | 命名 | 状态 | 时效 |');
  L.push('|---|---|---|---|---|');
  for (const [k, t] of Object.entries(reg.types)) {
    L.push(`| \`${k}\` | \`${t.home}\` | ${namingText(t)} | ${t.statuses.join(' ') || '—'} | ${t.freshness ? `${t.freshness.field} ${t.freshness.maxAgeDays}d` : '—'} |`);
  }
  L.push('');
  L.push('## 节键与可接受标题');
  L.push('');
  L.push('必备节按键匹配，标题写成下表任一别名即可（尾部括号说明会被忽略）；表外标题算自由节，可插在必备节之间。');
  L.push('');
  L.push('| 节键 | 可接受标题 |');
  L.push('|---|---|');
  for (const [k, aliases] of Object.entries(reg.sectionAliases)) {
    L.push(`| \`${k}\` | ${aliases.map((a) => `\`${a}\``).join(' ')} |`);
  }
  L.push('');
  L.push('## 类型详情');
  L.push('');
  for (const key of Object.keys(reg.types)) L.push(typeBlock(reg, key));
  L.push('## 布局封闭集与桥');
  L.push('');
  L.push('`.agents/` 顶层、仓库根目录与仓库根 Markdown 是封闭集：多出来的目录或门面文件会被 `check-doc-types` 拦下，防止绕过类型系统。桥必须是符号链接且指向登记的目标，断了或退化成副本都会报错。');
  L.push('');
  const wl = reg.workspaceLayout ?? {};
  L.push('| 位置 | 允许 |');
  L.push('|---|---|');
  L.push(`| \`.agents/\` 子目录 | ${(wl.agentsDirs ?? []).map((d) => `\`${d}\``).join(' ')} |`);
  L.push(`| \`.agents/\` 文件 | ${(wl.agentsFiles ?? []).map((d) => `\`${d}\``).join(' ')} |`);
  L.push(`| 仓库根 Markdown | ${(wl.rootMarkdown ?? []).map((d) => `\`${d}\``).join(' ')} |`);
  L.push(`| 仓库根目录 | ${(wl.rootDirs ?? []).map((d) => `\`${d}\``).join(' ')} |`);
  L.push(`| \`${reg.templateDir}\` | 只放 \`.md\` 模板，且每个模板必须被某个类型引用 |`);
  L.push('');
  L.push('| 桥 | 指向 | 消费方 |');
  L.push('|---|---|---|');
  for (const b of reg.bridges ?? []) L.push(`| \`${b.path}\` | \`${b.target}\` | ${b.consumer} |`);
  L.push('');
  L.push('## 豁免');
  L.push('');
  L.push(`- 原始语料：目录内放一个名为 \`${reg.rawMarker}\` 的空标记文件，该目录整体豁免类型与写作检查（外部镜像、批量采集数据）。豁免不是免罪：仍需有一篇 \`evidence\` 或 \`reference\` 文档说明它是什么、怎么采的。`);
  L.push(`- 生成物与模板：\`${reg.exemptPaths[0]}\` 与本文件不参与写作层检查。`);
  L.push(`- 笔记树：\`.agents/notes/{proposed,implemented,rejected,archived}/\` 由 \`${reg.types.note.externalGuard}\` 专属守卫，类型门禁不重复校验。`);
  L.push('');
  const nt = reg.noteTree ?? {};
  const ntLabel = (k) => `\`${(nt.sectionAliases?.[k] ?? [`## ${k}`])[0].replace(/^##\s*/, '')}\``;
  L.push('## 笔记树格式（noteTree）');
  L.push('');
  L.push(`笔记树的格式权威在本注册表的 \`noteTree\` 块，\`${reg.types.note.externalGuard}\` 消费它做断言。首个小节固定为 ${ntLabel(nt.firstSection ?? 'problem')}；备选节确实考据不出时可用豁免注释 \`${nt.alternativesExemptComment}\` 代替（仅限存量 retro 笔记，禁止编造）。节键命名空间独立于上面的总表——「## 方案」在笔记里是 \`proposal\`，在计划文档里是 \`steps\`，刻意不共用。`);
  L.push('');
  L.push('| lifecycle | Status 行 | 必备节（按序） | 禁用节 |');
  L.push('|---|---|---|---|');
  for (const lc of nt.lifecycles ?? []) {
    const req = (nt.sectionsByStatus?.[lc] ?? []).map(ntLabel).join(' → ');
    const ban = (nt.bannedSectionsByStatus?.[lc] ?? []).map(ntLabel).join('、');
    L.push(`| \`${lc}\` | \`${nt.statusLine?.[lc] ?? '—'}\` | ${req || '—'} | ${ban || '—'} |`);
  }
  L.push('');
  L.push(`class 封闭集（第二层目录）：${(nt.classes ?? []).map((c) => `\`${c}\``).join(' ')}；\`Status:\` 行需附一行原因的 lifecycle：${(nt.statusReasonRequired ?? []).map((c) => `\`${c}\``).join(' ') || '—'}。`);
  L.push('');
  return L.join('\n');
}

const REGISTRY_REL = '.agents/doc-types.json';
const sameFile = (a, b) => a && b && a.dev === b.dev && a.ino === b.ino;
const sameRevision = (a, b) => sameFile(a, b) && ['mode', 'size', 'mtimeMs', 'ctimeMs', 'nlink'].every(key => a[key] === b[key]);
const boundaryError = () => new Error('投影或注册表路径不是独立的仓内普通文件，或来源已变化 [projection/path-boundary]');

// Inspect existing components, not just the lexical destination. A missing projection is
// allowed, but writing never creates parent directories or follows symlinks/hard-link aliases.
function inspectFile(root, rel, { writing = false, required = false } = {}) {
  const parts = rel.split('/'); let path = root;
  for (let i = 0; i < parts.length; i++) {
    path = join(path, parts[i]); let stat;
    try { stat = lstatSync(path); }
    catch (error) {
      if (error.code !== 'ENOENT' || required || (writing && i < parts.length - 1)) throw boundaryError();
      return { root, rel, path: join(root, rel), stat: null };
    }
    if (stat.isSymbolicLink() || (i < parts.length - 1 ? !stat.isDirectory() : !stat.isFile() || (writing && stat.nlink !== 1))) throw boundaryError();
    if (i === parts.length - 1) return { root, rel, path, stat };
  }
}

function unchanged(file) {
  const now = inspectFile(file.root, file.rel, { required: !!file.stat });
  if (file.stat ? !sameRevision(file.stat, now.stat) : now.stat !== null) throw boundaryError();
}

function writeChecked(file, text) {
  unchanged(file);
  const flags = constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0) | (file.stat ? 0 : constants.O_CREAT | constants.O_EXCL);
  const fd = openSync(file.path, flags, 0o666);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || (file.stat && !sameRevision(file.stat, stat))) throw boundaryError();
    ftruncateSync(fd, 0); writeFileSync(fd, text);
  } finally { closeSync(fd); }
}

function generateProjection() {
  const stdout = process.argv.includes('--stdout');
  const check = !stdout && process.argv.includes('--check');
  const normalize = !stdout && !check && process.argv.includes('--normalize');
  const root = realpathSync(ROOT);
  const registryFile = inspectFile(root, REGISTRY_REL, { required: true, writing: normalize });
  const reg = loadRegistry(root);
  const projection = registryProjectionPath(reg.projection);
  const text = render(reg);
  unchanged(registryFile);
  if (stdout) { process.stdout.write(text); return; }
  // Validate both destinations before --normalize can touch the authoritative JSON.
  const target = inspectFile(root, projection, { writing: !check });
  if (sameFile(registryFile.stat, target.stat)) throw boundaryError();
  if (check) {
    const current = target.stat ? readFileSync(target.path, 'utf8') : null;
    unchanged(target); unchanged(registryFile);
    if (current === text) console.log(`✓ doc-types 投影新鲜：${reg.projection}`);
    else {
      console.error(`✗ doc-types 投影过期：${reg.projection} 与注册表不一致——运行 node scripts/gen-doc-types.mjs 重生成`);
      process.exitCode = 1;
    }
    return;
  }
  if (normalize) {
    const current = readFileSync(registryFile.path, 'utf8');
    const normalized = serializeRegistry(reg);
    if (current === normalized) console.log('✓ 注册表已是规范序列化形态（键序与缩进无漂移）');
    else {
      writeChecked(registryFile, normalized);
      console.log('✓ 注册表已按规范序列化写回（键序与缩进归一）');
    }
  }
  writeChecked(target, text);
  console.log(`✓ 已生成 ${reg.projection}（${Object.keys(reg.types).length} 个类型）`);
}

if (isMainModule(import.meta.url)) {
  try { generateProjection(); }
  catch (error) { console.error(`gen-doc-types: ${error.message} [projection/generate-failed]`); process.exitCode = 1; }
}
