#!/usr/bin/env node
/**
 * check-doc-types.mjs —— .agents 文档类型守卫（单文件断言、纯 node 标准库、零依赖）。
 *
 * 权威注册表：.agents/doc-types.json（类型 ↔ 模板 ↔ 检查 三件套 1:1）。
 * 共享工具在 scripts/doc-lib.mjs；投影生成在 scripts/gen-doc-types.mjs。
 * 笔记树（.agents/notes/{proposed,implemented,rejected,archived}）由 check-agent-notes.mjs 专属守卫，本脚本跳过。
 *
 * 断言清单：
 *   a) 注册表自洽：家↔类型双向登记、节键与字段名已定义、迁移端点在 statuses 内、模板存在且不孤立
 *   b) 可归类：每篇文档要么有合法 `Type:` 头，要么匹配某固定位置模式
 *   c) 归属家：类型声明的目录必须与注册表一致
 *   d) 命名：日期型必须为 yyyy-mm-dd-<topic>.md 且日期真实、不在未来
 *   e) 头块：标题行、字段顺序、必填非空、禁止字段缺席、未注册字段拒绝、占位符拒绝
 *   f) 字段形态：date 合法、link 可解析、status ∈ 该类型 statuses
 *   g) 条件字段：Status=superseded 必须带 Superseded-by；archive/ 下必须带 Archived
 *   h) 必备节齐全且按序；禁用节缺席；必备节非空（或写空节标记）
 *   i) 时效：Verified/Updated 超期报警（不阻断——阻断会让人绕过门禁）
 *   j) 状态机：与 git 基线比较，非法迁移报错，终态迁出报错
 *   k) 专属检查：skill-frontmatter / glossary-terms / projection-fresh
 *   l) 禁 INDEX.md；目录里不得出现无法归类的固定文件
 *   m) 归档封印：.agents/archive/ 下每篇有 Archived 行、manifest 哈希一致、封印相对基线只增不改
 *
 * 运行：node scripts/check-doc-types.mjs [--all] [--today yyyy-mm-dd] [--path <rel>]
 *   默认只校验已入库文件；--all 并入未入库文件（全量审计）；--path 只校验指定文件。
 *   环境变量 CURIA_STAGED=1 时走暂存模式（pre-commit 调用）：发现面、注册表、投影、封印、布局与
 *   链接目标全部取自 git 索引，校验的是将要提交的版本——先 add 坏版本、再在盘上改好，仍按索引版拦下。
 */

import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render } from './gen-doc-types.mjs';
import {
  DATED_FILENAME_RE, DATE_RE, ROOT, classifyDoc, countMissingRuleIds, dayDiff, discoverDocs,
  fieldValue, gitIndexModes, gitList, gitShow, indexChildren, indexHas, isMainModule, isSubsequence, linkTargetExists,
  loadRegistry, logRuleHits, matchAny, maskSource, normalizeLines, parseHeader, parseStatus, proseLines, readDoc,
  readDocStaged, relFromRoot, sectionBody, sectionKeys, today, verifySeals,
} from './doc-lib.mjs';

const NOTES_TREE_RE = /^\.agents\/notes\/(proposed|implemented|rejected|archived)(\/|$)/;
const PLACEHOLDER_RE = /<[^>\n]*>/;
const FIELD_LINE_RE = /^([A-Za-z][A-Za-z-]*):\s*(.*)$/;

/* ---------------------------------------------------------------- a) 注册表自洽 */

function verifyRegistry(reg, root, fail, staged = false) {
  for (const key of ['homes', 'types', 'sectionAliases', 'headerFields', 'resolutionOrder', 'templateDir']) {
    if (!reg[key]) fail(`注册表: 缺少顶层字段 \`${key}\` [types/registry-shape]`);
  }
  if (!reg.types || !reg.homes) return; // 顶层结构缺失，后续断言无从谈起
  const aliasKeys = new Set(Object.keys(reg.sectionAliases ?? {}));
  const fieldKeys = new Set(Object.keys(reg.headerFields ?? {}));
  const usedTemplates = new Set();
  for (const [key, t] of Object.entries(reg.types)) {
    if (!reg.homes[t.home]) fail(`注册表: 类型 ${key} 的家 \`${t.home}\` 未在 homes 中定义 [types/registry-home]`);
    else if (!reg.homes[t.home].types.includes(key)) fail(`注册表: 类型 ${key} 未在 homes.${t.home}.types 中登记 [types/registry-home]`);
    for (const group of ['required', 'forbidden']) {
      for (const s of t.sections?.[group] ?? []) if (!aliasKeys.has(s)) fail(`注册表: 类型 ${key} 用了未定义的节键 \`${s}\` [types/registry-section-key]`);
    }
    for (const group of ['required', 'optional', 'forbidden']) {
      for (const f of t.fields?.[group] ?? []) if (!fieldKeys.has(f)) fail(`注册表: 类型 ${key} 用了未定义的头块字段 \`${f}\` [types/registry-field-key]`);
    }
    for (const [from, tos] of Object.entries(t.transitions ?? {})) {
      if (!(t.statuses ?? []).includes(from)) fail(`注册表: 类型 ${key} 的迁移起点 \`${from}\` 不在 statuses 内 [types/registry-transition]`);
      for (const to of tos) if (!(t.statuses ?? []).includes(to)) fail(`注册表: 类型 ${key} 的迁移终点 \`${to}\` 不在 statuses 内 [types/registry-transition]`);
    }
    if (t.header === 'required' && !(t.statuses ?? []).length) fail(`注册表: 类型 ${key} 要求头块却没有 statuses [types/registry-header]`);
    if (t.naming === 'fixed' && !(t.location ?? []).length) fail(`注册表: 类型 ${key} 是固定命名却没有 location 模式 [types/registry-naming]`);
    if (t.template) {
      usedTemplates.add(t.template);
      const rel = `${reg.templateDir}/${t.template}`;
      // 暂存模式按索引判模板存在性——校验的是提交树，不是盘面
      if (staged ? !indexHas(root, rel) : !existsSync(join(root, rel))) {
        fail(`注册表: 类型 ${key} 的模板缺失 ${rel} [types/registry-template-missing]`);
      }
    }
  }
  for (const [h, hv] of Object.entries(reg.homes)) {
    for (const t of hv.types ?? []) if (!reg.types[t]) fail(`注册表: homes.${h} 登记了未定义的类型 \`${t}\` [types/registry-home]`);
  }
  if (staged) {
    // 暂存模式：模板清单取索引——盘面未入库的新模板不算孤儿，索引里删掉的模板也不因盘面还在而漏检
    for (const name of indexChildren(root, reg.templateDir).keys()) {
      if (!name.endsWith('.md')) continue;
      if (!usedTemplates.has(name)) fail(`注册表: 模板 ${reg.templateDir}/${name} 是孤儿——没有类型引用它（三件套必须 1:1） [types/registry-orphan-template]`);
    }
  } else {
    const templateDir = join(root, reg.templateDir);
    if (existsSync(templateDir)) {
      for (const entry of readdirSync(templateDir)) {
        if (!entry.endsWith('.md')) continue;
        if (!usedTemplates.has(entry)) fail(`注册表: 模板 ${reg.templateDir}/${entry} 是孤儿——没有类型引用它（三件套必须 1:1） [types/registry-orphan-template]`);
      }
    }
  }
  for (const key of reg.resolutionOrder ?? []) if (!reg.types[key]) fail(`注册表: resolutionOrder 含未定义类型 \`${key}\` [types/registry-resolution-order]`);
}

/* ---------------------------------------------- a) noteTree（笔记树格式权威）自洽 */

function verifyNoteTree(reg, fail) {
  const nt = reg.noteTree;
  if (!nt) { fail('注册表: 缺少顶层字段 `noteTree`——笔记树格式权威 [types/registry-notetree]'); return; }
  const note = reg.types.note;
  if (!note) return; // note 类型缺失已由注册表自洽断言报过
  const aliases = new Set(Object.keys(nt.sectionAliases ?? {}));
  for (const lc of nt.lifecycles ?? []) {
    if (!(note.statuses ?? []).includes(lc)) fail(`注册表: noteTree.lifecycles 的 \`${lc}\` 不在 note 类型的 statuses 内 [types/registry-notetree]`);
    if (!(nt.sectionsByStatus ?? {})[lc]) fail(`注册表: noteTree.sectionsByStatus 缺少 lifecycle \`${lc}\` 的必备节清单 [types/registry-notetree]`);
    if (!(nt.statusLine ?? {})[lc]) fail(`注册表: noteTree.statusLine 缺少 lifecycle \`${lc}\` 的形态说明 [types/registry-notetree]`);
  }
  for (const [lc, keys] of Object.entries(nt.sectionsByStatus ?? {})) {
    if (!(nt.lifecycles ?? []).includes(lc)) fail(`注册表: noteTree.sectionsByStatus 的 \`${lc}\` 不在 lifecycles 内 [types/registry-notetree]`);
    for (const s of keys) if (!aliases.has(s)) fail(`注册表: noteTree.sectionsByStatus 用了未定义的节键 \`${s}\` [types/registry-notetree]`);
  }
  for (const [lc, keys] of Object.entries(nt.bannedSectionsByStatus ?? {})) {
    if (!(nt.lifecycles ?? []).includes(lc)) fail(`注册表: noteTree.bannedSectionsByStatus 的 \`${lc}\` 不在 lifecycles 内 [types/registry-notetree]`);
    for (const s of keys) if (!aliases.has(s)) fail(`注册表: noteTree.bannedSectionsByStatus 用了未定义的节键 \`${s}\` [types/registry-notetree]`);
  }
  for (const lc of nt.statusReasonRequired ?? []) {
    if (!(nt.lifecycles ?? []).includes(lc)) fail(`注册表: noteTree.statusReasonRequired 的 \`${lc}\` 不在 lifecycles 内 [types/registry-notetree]`);
  }
  if (nt.firstSection && !aliases.has(nt.firstSection)) fail(`注册表: noteTree.firstSection \`${nt.firstSection}\` 未在 sectionAliases 定义 [types/registry-notetree]`);
  if (!(nt.classes ?? []).length) fail('注册表: noteTree.classes 为空（笔记 class 封闭集至少一类） [types/registry-notetree]');
}

/* ------------------------------------------------------- e)/f) 头块与字段形态 */

function verifyHeader(rel, type, tdef, reg, header, lines, errors, warnings, opts) {
  const fail = (msg) => errors.push(`头块: ${rel} — ${msg}`);
  const spec = reg.headerFields;
  if (tdef.header === 'none' || tdef.header === 'external') {
    for (const f of header.fields) {
      if ((tdef.fields?.forbidden ?? []).includes(f.key)) fail(`本类型不带头块字段，却出现 \`${f.key}:\`（第 ${f.idx + 1} 行） [types/field-unexpected]`);
      else if (spec[f.key]) fail(`本类型不带头块字段，却出现 \`${f.key}:\`（第 ${f.idx + 1} 行） [types/field-unexpected]`);
    }
    return;
  }
  if (tdef.header === 'frontmatter') return; // 由 extraChecks.skill-frontmatter 负责

  if (!header.titleOk) fail('第 1 行必须为 `# <标题>` [types/title-format]');
  if (lines[1] !== undefined && lines[1].trim() !== '') fail('第 2 行必须为空行 [types/header-blank]');

  const required = tdef.fields?.required ?? [];
  const optional = tdef.fields?.optional ?? [];
  const forbidden = tdef.fields?.forbidden ?? [];
  const allowed = new Set([...required, ...optional]);

  const orderIdx = Object.keys(spec);
  let lastOrder = -1;
  for (const f of header.fields) {
    if (!spec[f.key]) { fail(`未注册的头块字段 \`${f.key}:\`（第 ${f.idx + 1} 行） [types/field-unregistered]`); continue; }
    if (forbidden.includes(f.key)) { fail(`类型 ${type} 禁止字段 \`${f.key}:\`（第 ${f.idx + 1} 行） [types/field-forbidden]`); continue; }
    if (!allowed.has(f.key)) { fail(`类型 ${type} 未把 \`${f.key}:\` 列为必填或可选字段（第 ${f.idx + 1} 行） [types/field-unexpected]`); continue; }
    const oi = orderIdx.indexOf(f.key);
    if (oi < lastOrder) fail(`头块字段顺序不符注册表：\`${f.key}:\` 应排在前面（第 ${f.idx + 1} 行） [types/field-order]`);
    lastOrder = Math.max(lastOrder, oi);
    if (!f.value) { fail(`字段 \`${f.key}:\` 值为空（第 ${f.idx + 1} 行） [types/field-empty]`); continue; }
    if (PLACEHOLDER_RE.test(f.value)) fail(`字段 \`${f.key}:\` 残留占位符：${f.value} [types/field-placeholder]`);
    const kind = spec[f.key].kind;
    if (kind === 'date') {
      if (!DATE_RE.test(f.value)) fail(`字段 \`${f.key}:\` 必须为 yyyy-mm-dd，实为 \`${f.value}\` [types/field-date]`);
      else {
        const ahead = dayDiff(opts.today, f.value);
        if (ahead !== null && ahead > (reg.globalRules?.maxFutureDays ?? 1)) fail(`字段 \`${f.key}:\` 在未来（${f.value} > ${opts.today}） [types/field-future]`);
      }
    } else if (kind === 'link') {
      const m = /\[[^\]]*\]\(([^)\s]+)\)/.exec(f.value);
      const target = m ? m[1] : f.value;
      if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(target)) continue;
      // 暂存模式按索引判目标（提交树里没有即断链）；交互模式仍查盘面——见 doc-lib.linkTargetExists
      if (!linkTargetExists(join(opts.root, rel), target, { root: opts.root, staged: opts.staged })) {
        fail(opts.staged
          ? `字段 \`${f.key}:\` 的链接目标不存在：${target}（目标未入库：把它一起 add；提交树里没有的目标按断链处理） [types/field-link-target]`
          : `字段 \`${f.key}:\` 的链接目标不存在：${target} [types/field-link-target]`);
      }
    } else if (kind === 'status-token') {
      // statuses 为空的类型（如 frozen，保留原文档的状态行）不做取值校验
      if ((tdef.statuses ?? []).length && !(tdef.statuses ?? []).includes(f.value)) {
        fail(`\`Status: ${f.value}\` 不是类型 ${type} 的合法状态（允许：${(tdef.statuses ?? []).join(' / ')}） [types/field-status]`);
      }
    } else if (kind === 'type-token' && tdef.header === 'required') {
      if (f.value !== type) fail(`\`Type: ${f.value}\` 与归类结果 \`${type}\` 不一致 [types/field-type-mismatch]`);
    }
  }

  for (const key of required) {
    if (!header.fields.some((f) => f.key === key)) fail(`缺少必填字段 \`${key}:\` [types/field-required-missing]`);
  }
  const lastField = header.fields[header.fields.length - 1];
  if (lastField && lines[lastField.idx + 1] !== undefined && lines[lastField.idx + 1].trim() !== '') {
    fail('头块字段与正文之间必须有空行 [types/header-blank]');
  }

  // g) 条件字段
  const status = fieldValue(header, 'Status');
  const need = reg.globalRules?.statusRequiresField?.[status];
  if (need && !fieldValue(header, need)) fail(`\`Status: ${status}\` 必须带 \`${need}:\` 链接（指向取代它的文档） [types/field-conditional]`);
}

/* ------------------------------------------------------------- h) 必备节 */

function verifySections(rel, tdef, reg, lines, mask, errors) {
  const fail = (msg) => errors.push(`结构: ${rel} — ${msg}`);
  const found = sectionKeys(reg, lines, mask);
  const keys = found.map((s) => s.key).filter(Boolean);
  const label = (k) => reg.sectionAliases[k][0];
  const required = tdef.sections?.required ?? [];
  const forbidden = tdef.sections?.forbidden ?? [];

  const missing = required.filter((k) => !keys.includes(k));
  if (missing.length) fail(`缺少必备节：${missing.map(label).join(' / ')} [types/sections-missing]`);
  else if (!isSubsequence(required, keys)) fail(`必备节顺序不符模板（应为 ${required.map(label).join(' → ')}，自由节可插入其间） [types/sections-order]`);

  const banned = found.filter((s) => s.key && forbidden.includes(s.key));
  if (banned.length) fail(`类型 ${tdef.title} 禁止这些节：${banned.map((s) => `\`${s.base}\``).join(' / ')} [types/sections-forbidden]`);

  const marker = reg.globalRules?.emptySectionMarker;
  for (const s of found) {
    if (!s.key || !required.includes(s.key)) continue;
    const body = sectionBody(lines, mask, s.idx).filter((l) => !l.masked && l.text.trim() !== '');
    if (body.length) continue;
    fail(`必备节 \`${s.base}\` 是空的——写内容，或只写 \`${marker}\` 表示确实无内容 [types/section-empty]`);
  }
}

/* ------------------------------------------------------------------- i) 时效 */

function verifyFreshness(rel, tdef, header, errors, warnings, opts) {
  const f = tdef.freshness;
  if (!f) return;
  const status = fieldValue(header, 'Status');
  if (f.when) {
    const [key, allowed] = Object.entries(f.when)[0];
    const actual = fieldValue(header, key);
    if (actual !== null && !allowed.includes(status)) return;
  }
  const value = fieldValue(header, f.field);
  if (!value) return; // 必填缺失已由头块检查报错
  const age = dayDiff(value, opts.today);
  if (age === null) return;
  if (age > f.maxAgeDays) {
    warnings.push(`时效: ${rel} — \`${f.field}: ${value}\` 已过 ${age} 天（上限 ${f.maxAgeDays}）；复核后更新日期，或把 Status 翻 historical。汇总看 node scripts/doc-query.mjs --stale [types/freshness-stale]`);
  }
}

/* ---------------------------------------------------------------- j) 状态机 */

function verifyTransition(rel, tdef, root, header, errors) {
  const cur = fieldValue(header, 'Status');
  if (!cur || !Object.keys(tdef.transitions ?? {}).length) return;
  const base = gitShow(root, rel);
  if (base === null) return; // 新文件或无 git 基线
  const old = parseStatus(base);
  if (!old || old === cur) return;
  const allowed = tdef.transitions[old];
  if (allowed === undefined) return; // 基线状态本身非法，交由头块检查
  if (!allowed.length) {
    errors.push(`生命周期: ${rel} — \`${old}\` 是终态，不得迁出（当前 \`${cur}\`）；确需推翻请新建文档并互链 [types/transition-terminal]`);
    return;
  }
  if (!allowed.includes(cur)) {
    errors.push(`生命周期: ${rel} — 非法迁移 \`${old}\` → \`${cur}\`（允许：${allowed.join(' / ')}） [types/transition-illegal]`);
  }
}

/* -------------------------------------------------------------- k) 专属检查 */

function verifySkillFrontmatter(rel, abs, lines, errors) {
  const fail = (msg) => errors.push(`技能: ${rel} — ${msg}`);
  if (lines[0]?.trim() !== '---') { fail('第 1 行必须为 YAML frontmatter 起始 `---` [types/skill-frontmatter]'); return; }
  let close = -1;
  for (let i = 1; i < lines.length; i++) if (lines[i].trim() === '---') { close = i; break; }
  if (close === -1) { fail('frontmatter 未闭合 [types/skill-frontmatter]'); return; }
  const fm = lines.slice(1, close).join('\n');
  const name = /^name:\s*(.+)$/m.exec(fm)?.[1]?.trim();
  const desc = /^description:\s*(.+)$/m.exec(fm)?.[1]?.trim();
  const dir = basename(resolve(abs, '..'));
  if (!name) fail('frontmatter 缺少 `name:` [types/skill-name]');
  else if (name !== dir) fail(`frontmatter \`name: ${name}\` 必须与所在目录名 \`${dir}\` 一致 [types/skill-name]`);
  if (!desc) fail('frontmatter 缺少 `description:` [types/skill-desc]');
  else {
    if (PLACEHOLDER_RE.test(desc)) fail('`description:` 残留占位符 [types/skill-desc]');
    if (desc.length > 1024) fail('`description:` 过长（≤ 1024 字符） [types/skill-desc]');
    if (!/使用|用于|当|时/.test(desc)) fail('`description:` 应写明触发场景（何时用这个技能） [types/skill-desc]');
  }
}

function verifyGlossaryTerms(rel, lines, mask, errors) {
  const prose = proseLines(lines, mask);
  let seenGroup = false;
  for (const { i, text } of prose) {
    if (/^#{2,6}\s/.test(text)) { seenGroup = true; continue; }
    if (/^#\s/.test(text) || !text.trim()) continue;
    if (!seenGroup) continue; // H1 与引言段不受术语格式约束
    if (!/^\*\*[^*]+\*\*：/.test(text)) errors.push(`术语: ${rel} — 第 ${i + 1} 行格式应为 \`**术语（English）**：定义。_Avoid_: …\` [types/glossary-format]`);
    else if (!/_Avoid_/.test(text)) errors.push(`术语: ${rel} — 第 ${i + 1} 行缺 \`_Avoid_:\`（写禁用词或易混词） [types/glossary-avoid]`);
  }
}

function verifySourceTraceable(rel, lines, mask, errors) {
  let n = 0;
  for (const { text } of proseLines(lines, mask)) {
    n += [...text.matchAll(/\[[^\]]*\]\([^)\s]+\)/g)].length;
    n += [...text.matchAll(/https?:\/\/[^\s)）】]+/g)].length;
  }
  if (n < 3) {
    errors.push(`来源: ${rel} — 只有 ${n} 处可回溯出处；调研与参考类文档的每条结论都要能追到相对链接或 URL（至少 3 处） [types/source-traceable]`);
  }
}

function verifyProjectionFresh(rel, root, reg, errors, staged) {
  const target = join(root, reg.projection);
  let actual;
  if (staged) {
    // 暂存模式：比对索引版投影与 render(索引版注册表)——盘面好版洗不白将要提交的坏投影
    actual = gitShow(root, reg.projection, '');
    if (actual === null) {
      errors.push(`投影: ${rel} — 生成物不在暂存索引中（先 git add ${reg.projection}） [types/projection-missing]`);
      return;
    }
  } else {
    if (!existsSync(target)) { errors.push(`投影: ${rel} — 生成物缺失，运行 node scripts/gen-doc-types.mjs [types/projection-missing]`); return; }
    actual = readFileSync(target, 'utf8');
  }
  if (actual !== render(reg)) {
    errors.push(`投影: ${rel} — 与注册表不一致（手改生成物或忘了重生成），运行 node scripts/gen-doc-types.mjs [types/projection-stale]`);
  }
}

/* ------------------------------------------------------------- m) 归档封印 */

function verifyArchiveSeal(root, reg, frozenFiles, errors, warnings, staged) {
  // 空条目也要走 verifySeals：manifest 有键而条目为空 = 归档被删光/被 rm --cached 的空集绕过
  // （曾因调用方与 verifySeals 各有一处「entries 为空就 return」而整体绕过封印，见 doc-lib.verifySeals）。
  // 唯一实现在 doc-lib.verifySeals（与 .agents/notes/archived 共用同一机制）
  verifySeals(root, {
    entries: frozenFiles.map((rel) => ({ key: rel.replace(/^\.agents\/archive\//, 'archive/'), abs: join(root, rel) })),
    manifestPath: join(root, '.agents', 'archive', 'manifest.json'),
    manifestRel: '.agents/archive/manifest.json',
    keyAbs: (key) => join(root, '.agents', key),
    sealHint: ' --target archive',
    errors,
    warnings,
    staged,
  });
}

/* ------------------------------------------- o) 工作区布局封闭集与桥完整性 */

function verifyLayout(root, reg, errors, staged = false) {
  const layout = reg.workspaceLayout;
  /** gitignored 的名字不入封闭集：被忽略的路径永远不会被提交，不构成「绕过类型系统」的面（如工具残留 .playwright-mcp/）。 */
  const ignored = (name) => {
    try {
      execFileSync('git', ['check-ignore', '-q', '--', name], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
      return true;
    } catch {
      return false;
    }
  };
  if (layout) {
    if (staged) {
      // 暂存模式：布局校验面 = 索引。盘面未入库的在写条目不算数，索引里的删除也不因盘面还在而漏检。
      for (const [name, kind] of indexChildren(root, '.agents')) {
        if (name.startsWith('.')) continue;
        const known = kind === 'dir' ? layout.agentsDirs : layout.agentsFiles;
        if (!known?.includes(name)) {
          errors.push(`布局: .agents/${name} — 未登记在注册表 workspaceLayout 里；新目录/新门面文件要先登记，否则会绕过类型系统 [types/layout-unregistered]`);
        }
      }
      for (const [name, kind] of indexChildren(root)) {
        if (!name.endsWith('.md') || kind !== 'file') continue;
        if (!layout.rootMarkdown?.includes(name)) {
          errors.push(`布局: ${name} — 仓库根的 Markdown 只允许 ${layout.rootMarkdown.join(' / ')}；工作区文档放 .agents/ 下 [types/layout-root-markdown]`);
        }
      }
      for (const [name, kind] of indexChildren(root)) {
        if (kind !== 'dir') continue;
        if (!layout.rootDirs?.includes(name)) {
          errors.push(`布局: ${name}/ — 仓库根的目录未登记在 workspaceLayout.rootDirs 里；新代码或部署目录要先登记 [types/layout-root-dir]`);
        }
      }
      for (const name of indexChildren(root, reg.templateDir).keys()) {
        if (!name.endsWith('.md')) errors.push(`布局: ${reg.templateDir}/${name} — 模板目录只放 .md 模板 [types/layout-template-file]`);
      }
      // 每个家都必须存在且有入口规格页：少一个家等于丢掉它的文档，少一篇 README 等于该家没有判据
      for (const [name, h] of Object.entries(reg.homes ?? {})) {
        if (!h.path.startsWith('.agents/')) continue;
        if (!indexHas(root, h.path)) {
          errors.push(`布局: ${h.path} — 家 \`${name}\` 的目录不存在 [types/layout-home-missing]`);
          continue;
        }
        if (!indexHas(root, `${h.path}/README.md`)) errors.push(`布局: ${h.path}/README.md — 家 \`${name}\` 缺入口规格页（每家一篇 readme，说明装什么、不装什么） [types/layout-home-readme]`);
      }
    } else {
      const agentsDir = join(root, '.agents');
      if (existsSync(agentsDir)) {
        for (const entry of readdirSync(agentsDir, { withFileTypes: true })) {
          if (entry.name.startsWith('.')) continue;
          const known = entry.isDirectory() ? layout.agentsDirs : layout.agentsFiles;
          if (!known?.includes(entry.name) && !ignored(entry.name)) {
            errors.push(`布局: .agents/${entry.name} — 未登记在注册表 workspaceLayout 里；新目录/新门面文件要先登记，否则会绕过类型系统 [types/layout-unregistered]`);
          }
        }
      }
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (!entry.name.endsWith('.md')) continue;
        if (!entry.isFile() && !entry.isSymbolicLink()) continue;
        if (!layout.rootMarkdown?.includes(entry.name) && !ignored(entry.name)) {
          errors.push(`布局: ${entry.name} — 仓库根的 Markdown 只允许 ${layout.rootMarkdown.join(' / ')}；工作区文档放 .agents/ 下 [types/layout-root-markdown]`);
        }
      }
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        if (!layout.rootDirs?.includes(entry.name) && !ignored(entry.name)) {
          errors.push(`布局: ${entry.name}/ — 仓库根的目录未登记在 workspaceLayout.rootDirs 里；新代码或部署目录要先登记 [types/layout-root-dir]`);
        }
      }
      const templateDir = join(root, reg.templateDir);
      if (existsSync(templateDir)) {
        for (const entry of readdirSync(templateDir)) {
          if (!entry.endsWith('.md')) errors.push(`布局: ${reg.templateDir}/${entry} — 模板目录只放 .md 模板 [types/layout-template-file]`);
        }
      }
      // 每个家都必须存在且有入口规格页：少一个家等于丢掉它的文档，少一篇 README 等于该家没有判据
      for (const [name, h] of Object.entries(reg.homes ?? {})) {
        if (!h.path.startsWith('.agents/')) continue;
        const dir = join(root, h.path);
        if (!existsSync(dir)) {
          errors.push(`布局: ${h.path} — 家 \`${name}\` 的目录不存在 [types/layout-home-missing]`);
          continue;
        }
        if (!existsSync(join(dir, 'README.md'))) errors.push(`布局: ${h.path}/README.md — 家 \`${name}\` 缺入口规格页（每家一篇 readme，说明装什么、不装什么） [types/layout-home-readme]`);
      }
    }
  }
  if (staged) {
    // 桥：索引里必须是符号链接（mode 120000），整份校验对将要提交的树做
    const modes = gitIndexModes(root);
    for (const b of reg.bridges ?? []) {
      const mode = modes.get(b.path);
      if (mode === undefined) {
        errors.push(`桥: ${b.path} — 不在暂存索引中（${b.consumer} 的入口断了） [types/bridge-missing]`);
        continue;
      }
      if (mode !== '120000') {
        errors.push(`桥: ${b.path} — 不是符号链接；桥必须指向 .agents/ 或根 AGENTS.md，不能是副本 [types/bridge-not-symlink]`);
        continue;
      }
      const actual = (gitShow(root, b.path, '') ?? '').trim();
      if (actual !== b.target) errors.push(`桥: ${b.path} — 指向 \`${actual}\`，注册表要求 \`${b.target}\` [types/bridge-target]`);
      const targetRel = relFromRoot(root, resolve(join(root, dirname(b.path)), b.target));
      if (!indexHas(root, targetRel)) errors.push(`桥: ${b.path} — 符号链接悬空（目标 ${b.target} 不存在） [types/bridge-dangling]`);
    }
    return;
  }
  for (const b of reg.bridges ?? []) {
    const abs = join(root, b.path);
    let st = null;
    try {
      st = lstatSync(abs);
    } catch {
      errors.push(`桥: ${b.path} — 不存在（${b.consumer} 的入口断了） [types/bridge-missing]`);
      continue;
    }
    if (!st.isSymbolicLink()) {
      errors.push(`桥: ${b.path} — 不是符号链接；桥必须指向 .agents/ 或根 AGENTS.md，不能是副本 [types/bridge-not-symlink]`);
      continue;
    }
    const actual = readlinkSync(abs);
    if (actual !== b.target) errors.push(`桥: ${b.path} — 指向 \`${actual}\`，注册表要求 \`${b.target}\` [types/bridge-target]`);
    if (!existsSync(abs)) errors.push(`桥: ${b.path} — 符号链接悬空（目标 ${b.target} 不存在） [types/bridge-dangling]`);
  }
}

/* --------------------------------------- p) 永不删除 与 q) Updated 诚实性 */

const GUARDED_HOME_RE = /^\.agents\/(plans|research|future|skills|notes)\//;
// notes 里只有 rejected 允许清理（否决理由不再能阻止错误时，notes/README 自己的规格）；
// archived 由封印守卫管辖；implemented/proposed 的归宿是翻状态或归档，不允许静默消失。
const NOTES_DELETABLE_RE = /^\.agents\/notes\/(rejected|archived)\//;

/** 收集 .agents 下现存的全部 .md 文件名（判断「删除」是否其实是迁移）。 */
function collectMarkdownNames(dir, out = new Set()) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git') continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) collectMarkdownNames(full, out);
    else if (e.isFile() && e.name.endsWith('.md')) out.add(e.name);
  }
  return out;
}

/**
 * 「永不删除」的机械守卫：受管文档从 HEAD 消失、且找不到同名文件，即视为静默删除。
 * 覆盖 plans/research/future/skills 与笔记树的 implemented/proposed；笔记的 rejected 允许清理、
 * archived 由封印守卫管辖（各自规格）。
 * staged=true（暂存模式）时比 HEAD 对索引（--cached）——git rm --cached 在盘面看不见、在索引里是 D；
 * 同名存活判定也按索引路径集，不再被盘面留着的旧文件骗过。
 */
function verifyNoSilentDeletion(root, errors, staged = false) {
  let out;
  try {
    out = execFileSync('git', ['diff', '--name-status', ...(staged ? ['--cached'] : []), 'HEAD', '--', '.agents'], {
      cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (e) {
    // 只吞 git 执行失败（无 git、无 HEAD、非仓库）；代码错误必须暴露，否则守卫会静默失效
    if (e && (e.status !== undefined || e.code === 'ENOENT')) return;
    throw e;
  }
  const deleted = out.split('\n').filter(Boolean)
    .map((l) => l.split('\t'))
    .filter((parts) => parts[0] === 'D' && GUARDED_HOME_RE.test(parts[1] ?? '') && !NOTES_DELETABLE_RE.test(parts[1] ?? ''))
    .map((parts) => parts[1]);
  if (!deleted.length) return;
  let alive;
  if (staged) {
    alive = new Set(gitList(root, ['--', '.agents']).filter((p) => p.endsWith('.md')).map((p) => p.split('/').pop()));
  } else {
    const agentsDir = join(root, '.agents');
    alive = existsSync(agentsDir) ? collectMarkdownNames(agentsDir) : new Set();
  }
  for (const p of deleted) {
    const base = p.split('/').pop();
    if (alive.has(base)) continue; // 迁移或改名：同名文档仍在别处
    errors.push(staged
      ? `删除: ${p} — 「永不删除」：文档从暂存索引消失且提交树里找不到同名文件。过时内容请翻状态或用 node scripts/archive-doc.mjs <path> 迁入归档；确要合并进别的文档，同批在被合并方留下指向说明 [types/silent-deletion]`
      : `删除: ${p} — 「永不删除」：文档消失且工作区里找不到同名文件。过时内容请翻状态或用 node scripts/archive-doc.mjs <path> 迁入归档；确要合并进别的文档，同批在被合并方留下指向说明 [types/silent-deletion]`);
  }
}

/** 正文相对 HEAD 变了但 `Updated:` 没动 → 报警（日期是「最近一次实质改动日」的自我声明）。 */
function verifyUpdatedHonesty(rel, tdef, root, header, lines, warnings, todayStr) {
  if (!(tdef.fields?.required ?? []).includes('Updated')) return;
  const base = gitShow(root, rel);
  if (base === null) return;
  const baseLines = normalizeLines(base);
  const baseHeader = parseHeader(baseLines);
  const cur = fieldValue(header, 'Updated');
  const old = fieldValue(baseHeader, 'Updated');
  if (!cur || !old || cur !== old) return;
  if (cur === todayStr) return; // 日期已是今天：已如实声明，同日二次修改无从「再更新」，报警只会变成常驻噪音
  const bodyOf = (ls, h) => ls.slice(h.headerEnd).join('\n').trim();
  if (bodyOf(lines, header) !== bodyOf(baseLines, baseHeader)) {
    warnings.push(`时效: ${rel} — 正文相对 HEAD 变了但 \`Updated: ${cur}\` 没动；实质改动要更新日期（纯排版修订可忽略本条） [types/updated-honesty]`);
  }
}

/* ------------------------------------------------------------------ 主流程 */

export function runCheck(root = ROOT, opts = {}) {
  const errors = [];
  const warnings = [];
  const fail = (msg) => errors.push(msg);
  const todayStr = opts.today ?? today();
  const staged = opts.staged === true; // 暂存模式：正文从 git 索引读（pre-commit 校验将要提交的版本）

  let reg;
  try {
    reg = loadRegistry(root, { staged });
  } catch (e) {
    return { ok: false, errors: [`注册表: ${e.message} [types/registry-load]`], warnings, stats: {} };
  }
  verifyRegistry(reg, root, fail, staged);
  verifyNoteTree(reg, fail);
  verifyLayout(root, reg, errors, staged);

  const docs = opts.paths?.length
    ? opts.paths.map((rel) => ({ rel, abs: join(root, rel), tracked: null }))
    : discoverDocs(root, reg, { includeUntracked: opts.includeUntracked ?? false, staged });

  const frozen = [];
  const counts = {};
  for (const doc of docs) {
    if (NOTES_TREE_RE.test(doc.rel) && basename(doc.rel) !== 'README.md') continue; // 笔记树专属守卫
    // 暂存模式：正文取自索引，盘上删改不影响判定；非暂存模式：索引里有、盘上已删（未暂存的删除）
    // 交给「永不删除」守卫判定，这里不重复报错也不崩。索引里读不到（未入库草稿等）一律跳过。
    const lines = staged ? readDocStaged(root, doc.rel) : (existsSync(doc.abs) ? readDoc(doc.abs) : null);
    if (lines === null) continue;
    const mask = maskSource(lines);
    const header = parseHeader(lines);
    const { type, reason, via } = classifyDoc(doc.rel, reg, header);

    // m) 禁 INDEX.md
    if (/^index\.md$/i.test(basename(doc.rel))) {
      fail(`结构: ${doc.rel} — INDEX.md 被禁止：目录即索引，检索用 rg 或 node scripts/doc-query.mjs [types/index-md]`);
      continue;
    }
    if (!type) {
      // 归类失败：只有落在六个家目录内的 .md 才算错，仓库其他位置的 .md 不在类型系统管辖内
      if (/^(\.agents\/|README\.md$|AGENTS\.md$)/.test(doc.rel)) fail(`归类: ${doc.rel} — ${reason} [types/unclassifiable]`);
      continue;
    }
    const tdef = reg.types[type];
    counts[type] = (counts[type] ?? 0) + 1;

    if (tdef.externalGuard) continue; // 笔记树：由专属守卫覆盖
    if ((tdef.header === 'required' || tdef.header === 'archived') && !header.titleOk) {
      errors.push(`头块: ${doc.rel} — 第 1 行必须为 \`# <标题>\` [types/title-format]`);
    }

    // c) 归属家
    const homePath = reg.homes[tdef.home].path;
    const inHome = homePath === '.' ? true : doc.rel.startsWith(`${homePath}/`);
    if (!inHome) fail(`归类: ${doc.rel} — 类型 ${type} 属于家 \`${tdef.home}\`（\`${homePath}\`），不能放在这里 [types/wrong-home]`);
    if (tdef.naming === 'fixed' && !matchAny(tdef.location, doc.rel)) {
      fail(`归类: ${doc.rel} — 类型 ${type} 的固定位置应为 ${tdef.location.map((l) => `\`${l}\``).join(' 或 ')} [types/wrong-location]`);
    }

    // d) 命名
    if (tdef.naming === 'dated') {
      const m = DATED_FILENAME_RE.exec(basename(doc.rel));
      if (!m) fail(`结构: ${doc.rel} — 文件名必须为 yyyy-mm-dd-<topic>.md [types/filename-format]`);
      else {
        const d = m[1];
        if (Number.isNaN(Date.parse(`${d}T00:00:00Z`))) fail(`结构: ${doc.rel} — 文件名日期 \`${d}\` 不是真实日期 [types/filename-date]`);
        else {
          const ahead = dayDiff(todayStr, d);
          if (ahead !== null && ahead > (reg.globalRules?.maxFutureDays ?? 1)) fail(`结构: ${doc.rel} — 文件名日期 \`${d}\` 在未来 [types/filename-future]`);
        }
      }
    }

    verifyHeader(doc.rel, type, tdef, reg, header, lines, errors, warnings, { today: todayStr, root, staged });
    verifySections(doc.rel, tdef, reg, lines, mask, errors);
    verifyFreshness(doc.rel, tdef, header, errors, warnings, { today: todayStr });
    verifyTransition(doc.rel, tdef, root, header, errors);
    verifyUpdatedHonesty(doc.rel, tdef, root, header, lines, warnings, todayStr);

    for (const extra of tdef.extraChecks ?? []) {
      if (extra === 'skill-frontmatter') verifySkillFrontmatter(doc.rel, doc.abs, lines, errors);
      else if (extra === 'glossary-terms') verifyGlossaryTerms(doc.rel, lines, mask, errors);
      else if (extra === 'source-traceable') verifySourceTraceable(doc.rel, lines, mask, errors);
      else if (extra === 'projection-fresh') verifyProjectionFresh(doc.rel, root, reg, errors, staged);
      else fail(`注册表: 类型 ${type} 声明了未实现的专属检查 \`${extra}\` [types/registry-extra-check]`);
    }

    // g)/n) 归档
    if (type === 'frozen' || doc.rel.startsWith('.agents/archive/')) {
      if (basename(doc.rel) !== 'README.md') {
        frozen.push(doc.rel);
        if (!fieldValue(header, reg.globalRules.archiveRequiresField)) {
          fail(`归档: ${doc.rel} — 缺少 \`Archived: yyyy-mm-dd\` 行（迁入归档区的必做动作） [types/archive-field]`);
        }
      }
    }
  }
  verifyArchiveSeal(root, reg, frozen, errors, warnings, staged);
  verifyNoSilentDeletion(root, errors, staged);

  errors.sort();
  warnings.sort();
  return { ok: errors.length === 0, errors, warnings, stats: { docs: docs.length, byType: counts, frozen: frozen.length } };
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  const opts = { includeUntracked: args.includes('--all'), staged: process.env.CURIA_STAGED === '1' };
  const ti = args.indexOf('--today');
  if (ti !== -1 && args[ti + 1]) opts.today = args[ti + 1];
  const pi = args.indexOf('--path');
  if (pi !== -1 && args[pi + 1]) opts.paths = [args[pi + 1]];
  const result = runCheck(ROOT, opts);
  for (const w of result.warnings) console.warn(`warning: doc-types: ${w}`);
  const missing = countMissingRuleIds([...result.errors, ...result.warnings]);
  if (missing > 0) result.errors.push(`门禁: check-doc-types 有 ${missing} 条输出未挂规则 ID [meta/missing-rule-id]`);
  const summary = Object.entries(result.stats.byType ?? {}).map(([k, v]) => `${k}×${v}`).join(' ');
  if (result.errors.length) {
    for (const e of result.errors) console.error(`doc-types: ${e}`);
    console.error(`✗ check-doc-types 未通过：共 ${result.errors.length} 处错误（${result.stats.docs} 篇文档：${summary}）`);
  }
  logRuleHits(ROOT, result.errors, result.warnings);
  if (result.errors.length) process.exit(1);
  console.log(`✓ check-doc-types 通过：${result.stats.docs} 篇文档（${summary || '无'}），注册表/归类/头块/必备节/状态机/封印全部合规`);
}
