#!/usr/bin/env node
/**
 * check-agent-notes.mjs —— .agents/notes 决策记录树守卫（单文件、纯 node 标准库、零依赖）。
 *
 * 格式权威在注册表的 `noteTree` 块（doc-types.json）：lifecycle 与 class 封闭集、Status 行形态、
 * 按 lifecycle 的必备节与禁用节、retro 豁免注释。本脚本消费注册表数据做断言，不再自带 schema 常量。
 * 移植自 参考实现仓的 check/check-agent-notes.mjs（源头为 DeepSeek Harness）。
 *
 * 断言清单：
 *   a) 目录合法性：lifecycle 与 class 封闭集（noteTree.lifecycles / noteTree.classes）
 *   b) active 区文件名必须匹配 yyyy-mm-dd-*.md
 *   c) 头块四行：`# Agent Note: <非空>` / 空行 / `Status:`（形态见 noteTree.statusLine）/ 空行
 *   d) Status 值与所在 lifecycle 目录一致；e) 需附原因的 lifecycle（noteTree.statusReasonRequired）`—` 后非空
 *   f) 必备节全齐且按序（noteTree.sectionsByStatus，自由节可插在必备节之间）
 *   g) 禁用节缺席（noteTree.bannedSectionsByStatus——implemented/rejected 不得有提案式节标题）
 *   h) ## Alternatives considered 存在，或其位置有 retro 豁免注释（noteTree.alternativesExemptComment）
 *   i) 笔记间相对 Markdown 链接可解析（外链 http/https/mailto 等跳过；暂存模式按索引判目标存在性）
 *   j) archived/manifest.json 哈希一致性与 append-only（manifest 缺失或 archived 为空时跳过；
 *      无 git 环境降级为盘面校验）
 *
 * 每条输出挂规则 ID `[notes/…]`；失败时命中记进 .agents/.rule-hits.jsonl 台账（见 doc-lib）。
 * 测试/排障可用 AGENT_NOTE_ROOT 环境变量覆盖 notes 根（其上级需有 .agents/doc-types.json）。
 * 暂存模式（环境变量 CURIA_STAGED=1，pre-commit 调用）：树发现、笔记内容、archived 清单与链接目标
 *   存在性都改从 git 索引取，未入库的草稿不参与判定——先 add 坏版本、再在盘上改好（或删掉盘面文件），
 *   仍会按索引里的版本拦下。
 * 运行：node scripts/check-agent-notes.mjs
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import {
  ROOT, countMissingRuleIds, gitList, isMainModule, isSubsequence, linkTargetExists, loadRegistry, logRuleHits,
  maskSource, normalizeLines, readDocStaged, verifySeals,
} from './doc-lib.mjs';

const AGENT_NOTE_ARCHIVE = 'archived';
const NOTES_ROOT_FILES = new Set(['README.md', 'AGENTS.md', 'CLAUDE.md']);
const LIFECYCLE_ROOT_FILES = new Set(['AGENTS.md', 'CLAUDE.md']);
const TITLE_RE = /^# Agent Note[:：] ?\S/;
const FILENAME_RE = /^\d{4}-\d{2}-\d{2}-.+\.md$/;
const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const INDEX_MESSAGE =
  'INDEX.md 被禁止：检索用 rg --hidden -g \'!.agents/notes/archived/**\' <关键词> .agents/notes/';

/** 由注册表 noteTree 派生运行期 schema（节键解析、Status 行正则、显示名）。 */
function schemaFromRegistry(reg) {
  const nt = reg.noteTree ?? {};
  const sectionAliases = nt.sectionAliases ?? {};
  const sectionKey = (base) => {
    for (const [key, names] of Object.entries(sectionAliases)) {
      if (names.includes(base)) return key;
    }
    return null; // 自由节
  };
  const sectionName = (k) => (sectionAliases[k]?.[0] ?? `## ${k}`).replace(/^##\s*/, '');
  const statusRegex = (lc) => (nt.statusReasonRequired ?? []).includes(lc)
    ? new RegExp(`^Status: ${lc} — \\S`)
    : new RegExp(`^Status: ${lc}$`);
  return {
    nt,
    lifecycles: nt.lifecycles ?? [],
    classes: nt.classes ?? [],
    sectionAliases,
    sectionKey,
    sectionName,
    statusRegex,
  };
}

/** 去除小节标题尾部括号说明：`## Decision（说明）` → `## Decision`。 */
function headingBase(h) {
  return h.replace(/[（(].*$/, '').trimEnd();
}

/** 递归收集 archived 下 .md 文件（跳过隐藏项与 .zh.md），返回相对 archivedDir 的 posix 路径。 */
function collectArchived(base, dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collectArchived(base, full, out);
    else if (entry.isFile() && entry.name.endsWith('.md') && !entry.name.endsWith('.zh.md')) {
      out.push(relative(base, full).split('\\').join('/'));
    }
  }
}

/**
 * 遍历一个 lifecycle 下的 active 树（lifecycle/class/文件），交互模式专用（读盘面）。
 * 暂存模式的同语义实现是 collectStagedNotes（发现面换成 git 索引）。
 */
function walkActive(lifecycle, schema, notesRoot, notes, fail) {
  const dir = join(notesRoot, lifecycle);
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const rel = `${lifecycle}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!schema.classes.includes(entry.name)) {
        fail(`结构: ${rel}/ — 未知 class 目录（允许：${schema.classes.join(' / ')}） [notes/dir-unknown-class]`);
        continue;
      }
      const classDir = join(dir, entry.name);
      for (const file of readdirSync(classDir, { withFileTypes: true })) {
        if (file.name.startsWith('.')) continue;
        const fileRel = `${rel}/${file.name}`;
        if (file.isDirectory()) {
          fail(`结构: ${fileRel}/ — class 目录下不允许子目录 [notes/dir-no-subdir]`);
          continue;
        }
        if (file.name === 'INDEX.md' || file.name === 'index.md') {
          fail(`结构: ${fileRel} — ${INDEX_MESSAGE} [notes/dir-index]`);
          continue;
        }
        if (!file.name.endsWith('.md')) continue;
        if (!FILENAME_RE.test(file.name)) {
          fail(`结构: ${fileRel} — 文件名必须为 yyyy-mm-dd-主题.md [notes/filename-date]`);
          continue;
        }
        notes.push({ lifecycle, rel: fileRel, date: file.name.slice(0, 10) });
      }
    } else if (entry.isFile()) {
      if (LIFECYCLE_ROOT_FILES.has(entry.name)) continue;
      if (entry.name === 'INDEX.md' || entry.name === 'index.md') {
        fail(`结构: ${rel} — ${INDEX_MESSAGE} [notes/dir-index]`);
        continue;
      }
      fail(`结构: ${rel} — 应为 {lifecycle}/{class}/yyyy-mm-dd-主题.md [notes/dir-stray-file]`);
    }
  }
}

/**
 * 暂存模式的笔记树发现：从索引清单（相对 notesRoot 的 posix 路径集合）枚举 lifecycle/class/文件。
 * 与 walkActive 的断言语义对齐（未知 lifecycle/class、class 下子目录、INDEX.md、非法文件名）；
 * 盘面 rm 或换符号链接不影响发现——校验的是将要提交的树，不是盘面。
 */
function collectStagedNotes(indexed, schema, notes, fail) {
  const rels = [...indexed].filter((rel) => !rel.split('/').some((seg) => seg.startsWith('.')));
  // a) 顶层目录/文件合法性 + 禁 INDEX.md
  const topDirs = new Set();
  const topFiles = new Set();
  for (const rel of rels) {
    const slash = rel.indexOf('/');
    if (slash === -1) topFiles.add(rel);
    else topDirs.add(rel.slice(0, slash));
  }
  for (const name of topDirs) {
    if (!schema.lifecycles.includes(name) && name !== AGENT_NOTE_ARCHIVE) {
      fail(`结构: ${name}/ — 未知 lifecycle 目录（允许：${schema.lifecycles.join(' / ')} / ${AGENT_NOTE_ARCHIVE}） [notes/dir-unknown-lifecycle]`);
    }
  }
  for (const name of topFiles) {
    if (name === 'INDEX.md' || name === 'index.md') {
      fail(`结构: ${name} — ${INDEX_MESSAGE} [notes/dir-index]`);
    } else if (!NOTES_ROOT_FILES.has(name)) {
      fail(`结构: ${name} — notes 根目录只允许 README.md / AGENTS.md / CLAUDE.md [notes/dir-root-file]`);
    }
  }
  // b) active 树（lifecycle × class）
  for (const lifecycle of schema.lifecycles) {
    const prefix = `${lifecycle}/`; // indexed 是相对 notesRoot 的路径
    const unknownClasses = new Set();
    const subDirs = new Set();
    for (const p of indexed) {
      if (!p.startsWith(prefix)) continue;
      const rest = p.slice(prefix.length);
      if (!rest || rest.split('/').some((seg) => seg.startsWith('.'))) continue;
      const parts = rest.split('/');
      const rel = `${lifecycle}/${rest}`;
      if (parts.length === 1) {
        if (LIFECYCLE_ROOT_FILES.has(rest)) continue;
        if (rest === 'INDEX.md' || rest === 'index.md') {
          fail(`结构: ${rel} — ${INDEX_MESSAGE} [notes/dir-index]`);
          continue;
        }
        fail(`结构: ${rel} — 应为 {lifecycle}/{class}/yyyy-mm-dd-主题.md [notes/dir-stray-file]`);
        continue;
      }
      const cls = parts[0];
      if (!schema.classes.includes(cls)) {
        if (!unknownClasses.has(cls)) {
          unknownClasses.add(cls);
          fail(`结构: ${lifecycle}/${cls}/ — 未知 class 目录（允许：${schema.classes.join(' / ')}） [notes/dir-unknown-class]`);
        }
        continue;
      }
      if (parts.length > 2) {
        const sub = `${lifecycle}/${cls}/${parts[1]}/`;
        if (!subDirs.has(sub)) {
          subDirs.add(sub);
          fail(`结构: ${sub} — class 目录下不允许子目录 [notes/dir-no-subdir]`);
        }
        continue;
      }
      const file = parts[1];
      if (file === 'INDEX.md' || file === 'index.md') {
        fail(`结构: ${rel} — ${INDEX_MESSAGE} [notes/dir-index]`);
        continue;
      }
      if (!file.endsWith('.md')) continue;
      if (!FILENAME_RE.test(file)) {
        fail(`结构: ${rel} — 文件名必须为 yyyy-mm-dd-主题.md [notes/filename-date]`);
        continue;
      }
      notes.push({ lifecycle, rel, date: file.slice(0, 10) });
    }
  }
}

/** 单篇活跃笔记的格式断言（c/d/e/f/g/h）；lines 由调用方按模式取自盘面或索引。 */
function verifyNote(note, schema, lines, errors) {
  const fail = (msg) => errors.push(`格式: ${note.rel} — ${msg}`);
  const src = maskSource(lines);
  const { nt } = schema;

  // c) 头块四行
  if (!TITLE_RE.test(lines[0] ?? '')) fail('第 1 行必须为 `# Agent Note: <标题>` [notes/title-format]');
  if (lines[1] !== '') fail('第 2 行必须为空行 [notes/header-blank-line]');
  // d) Status 与所在文件夹一致；e) 需附原因的 lifecycle `—` 后非空
  if (!schema.statusRegex(note.lifecycle).test(lines[2] ?? '')) {
    fail(`第 3 行必须为 \`${nt.statusLine[note.lifecycle]}\`（与所在 ${note.lifecycle}/ 目录一致） [notes/status-line]`);
  }
  if (lines[3] !== '') fail('第 4 行必须为空行 [notes/header-blank-line]');

  const statusLike = new Set(schema.lifecycles.map((lc) => schema.statusRegex(lc)));
  const prose = [];
  for (let i = 0; i < lines.length; i++) {
    if (src.fenced[i] || src.commented[i]) continue;
    if (/^\s*>/.test(lines[i])) continue;
    prose.push(lines[i]);
  }
  if (prose.filter((l) => [...statusLike].some((re) => re.test(l.trim()))).length !== 1) {
    fail('Status: 行在正文中必须恰好出现一次（fenced/注释/引用行不计） [notes/status-unique]');
  }

  const bases = prose
    .filter((l) => l.startsWith('## '))
    .map((l) => headingBase(l.trimEnd()));
  const keys = bases.map(schema.sectionKey).filter((k) => k !== null);

  if (keys[0] !== nt.firstSection) {
    fail(`首个小节必须为 \`## ${schema.sectionName(nt.firstSection)}\`（当前：${JSON.stringify(bases[0] ?? '<无小节>')}） [notes/first-section]`);
  }

  // f) 必备节全齐且按序（retro 豁免注释视为 ## Alternatives considered 的替代品）
  const hasExemption = lines.join('\n').includes(nt.alternativesExemptComment);
  const required = (nt.sectionsByStatus?.[note.lifecycle] ?? []).filter(
    (k) => !(k === 'alternatives' && hasExemption),
  );
  const missing = required.filter((k) => !keys.includes(k));
  if (missing.length) {
    fail(`缺少必备节：${missing.map((k) => `\`## ${schema.sectionName(k)}\``).join(' / ')} [notes/sections-missing]`);
  } else if (!isSubsequence(required, keys)) {
    fail(`必备节顺序不符合模板（应为 ${required.map((k) => `\`## ${schema.sectionName(k)}\``).join(' → ')}，自由节可插入其间） [notes/sections-order]`);
  }

  // g) 禁用节（implemented/rejected 的提案式节标题；小写形态同样算——旧守卫按 toLowerCase 匹配）
  const bannedKeys = nt.bannedSectionsByStatus?.[note.lifecycle] ?? [];
  if (bannedKeys.length) {
    const bannedLower = new Set(bannedKeys.flatMap((k) => schema.sectionAliases[k] ?? []).map((a) => a.toLowerCase()));
    const banned = bases.filter((b) => bannedLower.has(b.toLowerCase()));
    if (banned.length) {
      fail(`implemented/rejected 禁止提案式节标题：${banned.map((b) => `\`${b}\``).join(' / ')} [notes/sections-banned]`);
    }
  }

  // h) Alternatives considered 或其位置的 retro 豁免注释
  if (!keys.includes('alternatives') && !hasExemption) {
    fail(`缺少 \`## Alternatives considered\` 且无 retro 豁免注释（\`${nt.alternativesExemptComment}\`） [notes/alternatives-required]`);
  }
}

/** 单篇活跃笔记的链接断言（i）：相对 Markdown 链接目标必须存在，外链/页内锚点跳过。 */
function verifyNoteLinks(note, notesRoot, root, lines, errors, staged) {
  const src = maskSource(lines);
  const absNote = join(notesRoot, note.rel);
  for (let i = 0; i < lines.length; i++) {
    if (src.fenced[i] || src.commented[i]) continue;
    if (/^\s*>/.test(lines[i])) continue;
    for (const m of lines[i].matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const target = (m[1] ?? '').trim();
      if (!target) continue;
      if (target.startsWith('#')) continue; // 页内锚点
      if (SCHEME_RE.test(target)) continue; // 外链（https 等）跳过
      // 暂存模式按索引判目标（提交树里没有即断链）；交互模式仍查盘面——见 doc-lib.linkTargetExists
      if (linkTargetExists(absNote, target, { root, staged })) continue;
      errors.push(staged
        ? `链接: ${note.rel} — 相对链接目标不存在：${target}（目标未入库：把它一起 add；提交树里没有的目标按断链处理） [notes/link-target-missing]`
        : `链接: ${note.rel} — 相对链接目标不存在：${target} [notes/link-target-missing]`);
    }
  }
}

/**
 * 全量校验 .agents/notes 树。返回 { ok, errors, warnings, notes, archived }。
 * notes/archived 为统计计数。errors 已排序，中文输出。格式 schema 取自注册表 noteTree。
 * opts.staged=true（pre-commit 暂存模式）：树发现、笔记内容与 archived 清单都取自 git 索引，
 * 未入库草稿不参与判定；默认（交互运行）始终读盘。
 */
export function runCheck(notesRoot, opts = {}) {
  const errors = [];
  const warnings = [];
  const notes = [];
  const fail = (msg) => errors.push(msg);
  const staged = opts.staged === true; // 暂存模式：树发现、内容与 archived 清单都从 git 索引取（pre-commit 校验将要提交的版本）

  const root = resolve(notesRoot, '../..');
  let reg;
  try {
    reg = loadRegistry(root, { staged });
  } catch (e) {
    return { ok: false, errors: [`注册表: ${e.message}（笔记树格式权威在注册表 noteTree） [notes/registry-missing]`], warnings, notes: 0, archived: 0 };
  }
  if (!reg.noteTree) {
    return { ok: false, errors: ['注册表: 缺少顶层字段 `noteTree`（笔记树格式权威） [notes/registry-notetree]'], warnings, notes: 0, archived: 0 };
  }
  const schema = schemaFromRegistry(reg);

  const notesRel = relative(root, notesRoot).split('\\').join('/'); // 仓库相对（如 .agents/notes）
  // 暂存模式：发现面整体换成索引——盘面 rm 或换符号链接不影响发现，未入库草稿天然不参与判定
  const indexed = staged ? new Set(gitList(root, ['--', notesRel]).map((p) => p.slice(notesRel.length + 1))) : null;
  if (!staged && !existsSync(notesRoot)) {
    return { ok: true, errors, warnings, notes: 0, archived: 0 };
  }

  if (staged) {
    // a)+b) 结构断言与活跃笔记收集都从索引清单枚举（校验的是将要提交的树）
    collectStagedNotes(indexed, schema, notes, fail);
  } else {
    // a) 顶层目录/文件合法性 + 禁 INDEX.md
    for (const entry of readdirSync(notesRoot, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      if (entry.isDirectory()) {
        if (!schema.lifecycles.includes(entry.name) && entry.name !== AGENT_NOTE_ARCHIVE) {
          fail(`结构: ${entry.name}/ — 未知 lifecycle 目录（允许：${schema.lifecycles.join(' / ')} / ${AGENT_NOTE_ARCHIVE}） [notes/dir-unknown-lifecycle]`);
        }
      } else if (entry.isFile()) {
        if (entry.name === 'INDEX.md' || entry.name === 'index.md') {
          fail(`结构: ${entry.name} — ${INDEX_MESSAGE} [notes/dir-index]`);
        } else if (!NOTES_ROOT_FILES.has(entry.name)) {
          fail(`结构: ${entry.name} — notes 根目录只允许 README.md / AGENTS.md / CLAUDE.md [notes/dir-root-file]`);
        }
      }
    }

    // b) active 树（lifecycle × class）
    for (const lifecycle of schema.lifecycles) {
      walkActive(lifecycle, schema, notesRoot, notes, fail);
    }
  }
  notes.sort((a, b) => a.rel.localeCompare(b.rel));

  for (const note of notes) {
    // 暂存模式：内容从索引读；读不到（索引条目异常）跳过而非崩溃
    const lines = staged
      ? readDocStaged(root, `${notesRel}/${note.rel}`)
      : normalizeLines(readFileSync(join(notesRoot, note.rel), 'utf8'));
    if (lines === null) continue;
    verifyNote(note, schema, lines, errors);
    verifyNoteLinks(note, notesRoot, root, lines, errors, staged);
  }

  // j) archived 冻结区与 manifest 封印（唯一实现在 doc-lib.verifySeals，与 .agents/archive 共用）
  const archivedDir = join(notesRoot, AGENT_NOTE_ARCHIVE);
  const archivedRel = relative(root, archivedDir).split('\\').join('/');
  let archivedFiles = [];
  if (staged) {
    // 暂存模式：归档清单从索引取（git ls-files）；封印核对同样对索引内容做——见 verifySeals 的 staged
    archivedFiles = gitList(root, ['--', archivedRel])
      .filter((p) => p.startsWith(`${archivedRel}/`))
      .map((p) => p.slice(archivedRel.length + 1))
      .filter((rel) => rel.split('/').every((seg) => !seg.startsWith('.')) && rel.endsWith('.md') && !rel.endsWith('.zh.md'));
  } else if (existsSync(archivedDir)) {
    collectArchived(archivedDir, archivedDir, archivedFiles);
  }
  archivedFiles.sort();
  verifySeals(root, {
    entries: archivedFiles.map((rel) => ({ key: `archived/${rel}`, abs: join(archivedDir, rel) })),
    manifestPath: join(archivedDir, 'manifest.json'),
    manifestRel: relative(root, join(archivedDir, 'manifest.json')).split('\\').join('/'),
    keyAbs: (key) => join(notesRoot, key),
    baseRef: process.env.AGENT_NOTE_ARCHIVE_BASE_REF || 'HEAD',
    errors,
    warnings,
    staged,
  });

  errors.sort();
  return { ok: errors.length === 0, errors, warnings, notes: notes.length, archived: archivedFiles.length };
}

// 直接执行时做主入口；被测试 import 时不触发。
if (isMainModule(import.meta.url)) {
  const notesRoot = process.env.AGENT_NOTE_ROOT
    ? resolve(process.env.AGENT_NOTE_ROOT)
    : join(ROOT, '.agents', 'notes'); // ROOT 从 doc-lib 取（支持 CURIA_ROOT）：物化到临时目录执行时也指回真仓
  const result = runCheck(notesRoot, { staged: process.env.CURIA_STAGED === '1' });
  for (const w of result.warnings) console.warn(`warning: agent-notes: ${w}`);
  const missing = countMissingRuleIds([...result.errors, ...result.warnings]);
  if (missing > 0) result.errors.push(`门禁: check-agent-notes 有 ${missing} 条输出未挂规则 ID [meta/missing-rule-id]`);
  if (result.errors.length) {
    for (const e of result.errors) console.error(`agent-notes: ${e}`);
    console.error(`✗ check-agent-notes 未通过：共 ${result.errors.length} 处错误（${result.notes} 篇活跃笔记 / ${result.archived} 篇归档笔记）`);
  }
  logRuleHits(resolve(notesRoot, '../..'), result.errors, result.warnings);
  if (result.errors.length) process.exit(1);
  console.log(`✓ check-agent-notes 通过：${result.notes} 篇活跃笔记 + ${result.archived} 篇归档笔记，目录/文件名/头块/Status/必备节/链接/归档封印全部合规`);
}
