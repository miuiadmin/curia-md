#!/usr/bin/env node
/**
 * doc-lib.mjs —— 文档类型系统的共享工具（纯 node 标准库、零依赖）。
 *
 * 被 check-doc-types / check-prose / new-doc / doc-query / gen-doc-types 复用：
 * 注册表加载、文件发现（含原始语料豁免）、头块解析、节解析、字数与日期计算、git 基线读取、
 * 暂存（索引）内容与形态读取（CURIA_STAGED 暂存模式）、主模块判定。
 * 本文件不含断言；断言在各守卫脚本里。
 *
 * 暂存模式的判据分层：内容读 readDocStaged / gitShow(ref='')；存在性与形态读 git 索引
 * （gitIndexModes / indexHas / indexChildren）——盘面（lstat / existsSync / readdirSync）
 * 只在交互模式参与，否则「git rm --cached + 盘面留好版」就能带病入库。
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRegistryJson } from './curia-json.mjs';

export const ROOT = process.env.CURIA_ROOT ? resolve(process.env.CURIA_ROOT) : resolve(fileURLToPath(new URL('../', import.meta.url)));

/**
 * 主模块判定：被直接执行时才跑 CLI 分支，被 import 时不跑。
 * 两边都必须取 realpath——macOS 上 `/var` 与 `/tmp` 是符号链接，`import.meta.url` 给的是真实路径，
 * 只做 `resolve` 会比不上：守卫静默不执行、退出码仍是 0，等于门禁被路径形态悄悄绕过。
 */
export function isMainModule(metaUrl) {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(metaUrl)) === realpathSync(process.argv[1]);
  } catch {
    return false; // argv[1] 不是真实文件（node -e、REPL 等）
  }
}

/** A conservative floor, not a secret detector. Caller exclusions can only narrow it. */
export function privateReadPath(rel) {
  const parts = rel.normalize('NFC').toLowerCase().split('/');
  return rel === '.agents/doc-types.json' || parts.some((part) => /^(?:\.env(?:\..*)?|\.ssh|\.gnupg|secrets?|credentials?|private|logs?|transcripts?)$/.test(part)
    || /(?:^|-)(?:session-transcripts|private-logs|secrets?|credentials?)(?:-|\.|$)/.test(part))
    || /\.(?:pem|key|p12|pfx|keystore|log|db|sqlite3?)$/i.test(rel);
}


export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const DATED_FILENAME_RE = /^(\d{4}-\d{2}-\d{2})-.+\.md$/;

/** The projection is a derived file, never a repository escape or the Registry itself. */
export function registryProjectionPath(value) {
  if (typeof value !== 'string' || !value || /[\\:\x00-\x1f\x7f]/.test(value)
      || value.split('/').some(part => !part || part !== part.trim() || part === '.' || part === '..' || part.endsWith('.') || part.toLowerCase() === '.git')
      || value.normalize('NFC').toLowerCase() === '.agents/doc-types.json') {
    throw new Error('Registry projection 必须是仓内规范相对文件路径，不能指向 Git 元数据或注册表自身 [curia2/registry-invalid]');
  }
  return value;
}

/**
 * 读取注册表；结构非法即抛错。
 * staged=true（pre-commit 暂存模式）时从 git 索引读（`git show :.agents/doc-types.json`）——
 * 校验的是将要提交的注册表：先 add 坏版、再在盘上改好，守卫仍按索引版判定。
 */
export function loadRegistry(root = ROOT, { staged = false } = {}) {
  const rel = '.agents/doc-types.json';
  let reg;
  if (staged) {
    const raw = gitShow(root, rel, '');
    if (raw === null) throw new Error(`注册表不在暂存索引中：${rel}（先把它 add 进来）`);
    reg = parseRegistryJson(raw);
  } else {
    const p = join(root, rel);
    if (!existsSync(p)) throw new Error(`注册表缺失：${p}`);
    reg = parseRegistryJson(readFileSync(p, 'utf8'));
  }
  if (reg?.version !== 1 || typeof reg.types !== 'object') throw new Error(`注册表结构非法：${staged ? rel : join(root, rel)}`);
  if (reg.projection !== undefined) registryProjectionPath(reg.projection);
  return reg;
}

/** 归一化 BOM/CRLF 并切行。 */
export function normalizeLines(raw) {
  return raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
}

export function readDoc(abs) {
  return normalizeLines(readFileSync(abs, 'utf8'));
}

/** 读索引（暂存）内容并归一化行；文件不在索引中时返回 null。供暂存模式的内容守卫用（pre-commit 校验将要提交的版本）。 */
export function readDocStaged(root, rel) {
  const raw = gitShow(root, rel, '');
  return raw === null ? null : normalizeLines(raw);
}

/** 掩码 fenced code 与 HTML 注释区域（跨行），避免样例/注释被当正文。 */
export function maskSource(lines) {
  const n = lines.length;
  const fenced = new Array(n).fill(false);
  const commented = new Array(n).fill(false);
  let inFence = false;
  let inComment = false;
  for (let i = 0; i < n; i++) {
    const l = lines[i];
    fenced[i] = inFence;
    commented[i] = inComment;
    if (!inComment && /^\s{0,3}```/.test(l)) {
      fenced[i] = true;
      inFence = !inFence;
    } else if (inFence) {
      fenced[i] = true;
    }
    if (inFence) continue;
    const openIdx = inComment ? -1 : l.indexOf('<!--');
    const closeIdx = l.indexOf('-->');
    if (inComment) {
      commented[i] = true;
      if (closeIdx !== -1) inComment = false;
    } else if (openIdx !== -1) {
      commented[i] = true;
      if (closeIdx === -1 || closeIdx < openIdx) inComment = true;
    }
  }
  return { fenced, commented };
}

/** 正文行（排除 fenced、注释、引用行），保留原行号。 */
export function proseLines(lines, mask) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (mask.fenced[i] || mask.commented[i]) continue;
    if (/^\s*>/.test(lines[i])) continue;
    out.push({ i, text: lines[i] });
  }
  return out;
}

/** 极简 glob → RegExp：双星号跨任意层目录（含零层），末尾双星号匹配该目录下全部内容，单星号不跨目录。 */
export function globToRe(pattern) {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        i++;
        if (pattern[i + 1] === '/') {
          i++;
          re += '(?:.*/)?';
        } else {
          re += '.*';
        }
      } else {
        re += '[^/]*';
      }
    } else if ('.+?^${}()|[]\\'.includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`);
}

export function matchAny(patterns, rel) {
  return (patterns ?? []).some((p) => globToRe(p).test(rel));
}

/**
 * 解析文件头块：`# 标题` / 空行 / 连续 `Key: value` 行 / 空行 / 正文。
 * 返回 { title, titleOk, fields: [{key,value,idx}], bodyStart, headerEnd }。
 */
export function parseHeader(lines) {
  const fields = [];
  const titleLine = lines[0] ?? '';
  const titleOk = /^#\s+\S/.test(titleLine);
  let i = 1;
  while (i < lines.length && lines[i].trim() === '') i++;
  const fieldStart = i;
  while (i < lines.length) {
    const m = /^([A-Za-z][A-Za-z-]*):\s*(.*)$/.exec(lines[i]);
    if (!m) break;
    fields.push({ key: m[1], value: m[2].trim(), idx: i });
    i++;
  }
  const headerEnd = i;
  let bodyStart = i;
  while (bodyStart < lines.length && lines[bodyStart].trim() === '') bodyStart++;
  return { title: titleOk ? titleLine.replace(/^#\s+/, '') : null, titleOk, fields, fieldStart, headerEnd, bodyStart };
}

/** 从头块字段取值。 */
export function fieldValue(header, key) {
  return header.fields.find((f) => f.key === key)?.value ?? null;
}

/** 解析任意文本里的 `Status:` 值（用于 git 基线比较）。 */
export function parseStatus(raw) {
  for (const line of normalizeLines(raw).slice(0, 20)) {
    const m = /^Status:\s*(.+)$/.exec(line.trim());
    if (m) return m[1].split(/\s+[—-]\s+/)[0].trim();
  }
  return null;
}

/** 二级标题 → 注册表节键（去掉尾部括号说明）；返回按出现顺序的数组。 */
export function sectionKeys(reg, lines, mask) {
  const out = [];
  for (const { i, text } of proseLines(lines, mask)) {
    if (!text.startsWith('## ')) continue;
    const base = text.replace(/[（(].*$/, '').trimEnd();
    let key = null;
    for (const [k, aliases] of Object.entries(reg.sectionAliases)) {
      if (aliases.includes(base)) { key = k; break; }
    }
    out.push({ key, base, idx: i });
  }
  return out;
}

/** 某节标题下到下一个二级标题前的正文行。 */
export function sectionBody(lines, mask, startIdx) {
  const out = [];
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (mask.fenced[i] || mask.commented[i]) { out.push({ i, text: lines[i], masked: true }); continue; }
    if (/^#{1,2}\s/.test(lines[i])) break;
    out.push({ i, text: lines[i], masked: false });
  }
  return out;
}

export function isSubsequence(needle, haystack) {
  let i = 0;
  for (const h of haystack) if (i < needle.length && h === needle[i]) i++;
  return i === needle.length;
}

/** 日期差（天，b - a）；非法日期返回 null。 */
export function dayDiff(a, b) {
  if (!DATE_RE.test(a) || !DATE_RE.test(b)) return null;
  const ta = Date.parse(`${a}T00:00:00Z`);
  const tb = Date.parse(`${b}T00:00:00Z`);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return null;
  return Math.round((tb - ta) / 86400000);
}

/**
 * 今天的日期（yyyy-mm-dd），取本地时区。刻意不用 toISOString——那是 UTC 日期，
 * UTC+8 的凌晨 0 点到 8 点之间建档会落到前一天，文件名与 Updated 字段就会与日历不符。
 */
export function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/* ------------------------------------------- 门禁输出规范：规则 ID 与命中台账 */

/** 规则 ID 形态：`[scope/rule]`，如 `[prose/cjk-space]`。每条守卫输出都挂一个，供修复器、台账与 `--audit` 定位。 */
export const RULE_ID_RE = /\[[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*\]/;

/** 输出里未挂规则 ID 的条数（守卫收口时自查，大于 0 补一条 meta 报错——新规则必须带身份）。 */
export function countMissingRuleIds(lines) {
  return lines.filter((l) => !RULE_ID_RE.test(l)).length;
}

/**
 * 把本次守卫命中的 **error 级** 规则 ID 追加进本地台账 `.agents/.rule-hits.jsonl`（gitignore，不入库）。
 * 口径：命中 = 拦截——调用方分传两份数组（errors / warnings），只有 errors 入账；warnings 只用于
 * 在调用点显式声明告警边界，不落盘（建议级告警进台账会把「最近拦到过什么」灌成背景噪声，
 * 污染零命中判定与修剪依据）。`meta/missing-rule-id` 由守卫收口时推进 errors，属 error 级、保留入账。
 * 台账回答「每条规则最近拦到过什么」；`run-checks --audit` 据此列出零命中规则做删除候选。
 * 写不进就静默跳过——台账是审计辅助，不能反过来阻断门禁。
 */
export function logRuleHits(root, errors, warnings = []) {
  try {
    const ids = [...new Set((errors ?? []).flatMap((l) => [...l.matchAll(/\[([a-z][a-z0-9-]*\/[a-z][a-z0-9-]*)\]/g)].map((m) => m[1])))];
    if (!ids.length) return;
    const agentsDir = join(root, '.agents');
    if (!existsSync(agentsDir)) return;
    appendFileSync(join(agentsDir, '.rule-hits.jsonl'), `${JSON.stringify({ ts: new Date().toISOString(), ids })}\n`);
  } catch {
    // 台账写失败不阻断门禁
  }
}

/* ---------------------- 中英混排与全角标点的共享正则（check-prose 检查、fix-doc 修复共用一份） */

export const CJK_CLASS = '\\u3400-\\u4fff\\u4e00-\\u9fff\\uf900-\\ufaff';
export const CJK_SPACING_RE = new RegExp(`(?:[${CJK_CLASS}])([A-Za-z0-9@#$_])|([A-Za-z0-9%])([${CJK_CLASS}])`, 'g');
export const HALFWIDTH_PUNCT_RE = new RegExp(`(?:[${CJK_CLASS}])([,;:!?()])|(?:[,;:!?()])([${CJK_CLASS}])`, 'g');

/* --------------------------------------------------- 归档封印校验（唯一实现） */

/**
 * 校验一个归档区的 manifest 封印：逐文件 sha256 核对、幽灵条目、相对 git 基线 append-only。
 * 两个归档区共用（.agents/notes/archived 与 .agents/archive）——同一机制只有这一份实现。
 * entries: [{ key, abs }]（key 为 manifest 键，含 archived/ 或 archive/ 前缀），哈希只核对调用方
 * 收集到的条目（发现语义由调用方定：索引、盘面或 --path 点名）；幽灵判定用 keyAbs(key) 回到
 * 盘面——entries 是「本次收集集合」，拿它判「文件在盘上不存在」会把未入库的新归档与 --path 之外的
 * 同区文件误报成幽灵（审计实测过这两个假红）。manifestRel 是仓库相对常量路径，供 gitShow 取基线
 * （常量字符串无需 realpath 归一化，git 自己解析 cwd）；sealHint 是 manifest 缺失时提示命令的尾巴。
 * staged=true（pre-commit 暂存模式）时 manifest、逐文件内容与幽灵判定都改从 git 索引取——
 * 校验的是将要提交的版本，先 add 坏版再在盘上改好也会被拦下。
 * 空集语义：只有「manifest 不在」且「条目为空」才跳过（首批准留空目录）；manifest 有键而条目为空
 * 是「归档区被删光/被 rm --cached」——逐键报幽灵，两种模式一致（曾因 entries 空提前 return 整体绕过）。
 */
export function verifySeals(root, { entries, manifestPath, manifestRel, keyAbs, baseRef = 'HEAD', sealHint = '', errors, warnings, staged = false }) {
  let manifest = null;
  let manifestRaw = null;
  if (staged) {
    manifestRaw = gitShow(root, manifestRel, '');
  } else if (existsSync(manifestPath)) {
    // 读失败（竞态/权限）按非法 JSON 处理——与旧行为一致：报错并返回，不崩
    try { manifestRaw = readFileSync(manifestPath, 'utf8'); } catch { manifestRaw = ''; }
  }
  if (manifestRaw !== null) {
    try {
      manifest = JSON.parse(manifestRaw);
      if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest) ||
          typeof manifest.files !== 'object' || manifest.files === null) {
        throw new Error('bad shape');
      }
    } catch {
      errors.push(`归档: ${manifestRel} 存在但不是合法 JSON（需含 { "version": 1, "files": {…} }） [seal/manifest-json]`);
      return;
    }
  }
  // manifest 有键而条目为空 = 归档文件被删光或 git rm --cached——落到下面的逐键幽灵判定。
  if (manifest === null) {
    if (entries.length) warnings.push(`归档: ${manifestRel} 缺失但归档区有 ${entries.length} 个文件——运行 node scripts/seal-notes-archive.mjs${sealHint} 生成封印 [seal/manifest-missing]`);
    // manifest 连根消失不是「首批准留空目录」：基线里封印过的条目逐键按 append-only 报错。
    // 否则「先删 manifest（只告警）再篡改/删除冻结文档」可以两段式洗白整个封印区。
    if (gitTopLevel(root) !== null) {
      const vanishedRaw = gitShow(root, manifestRel, baseRef);
      if (vanishedRaw !== null) {
        try {
          const vanished = JSON.parse(vanishedRaw);
          for (const key of Object.keys(vanished.files ?? {})) {
            errors.push(`归档: ${key} — 封印相对 ${baseRef} 被删除（manifest 整体消失）；归档封印只增不改（append-only） [seal/append-only]`);
          }
        } catch {
          // 基线坏 JSON——无从比较
        }
      }
    }
    return;
  }
  for (const { key, abs } of entries) {
    const seal = manifest.files[key];
    if (typeof seal !== 'string') { errors.push(`归档: ${key} — manifest 中缺少封印 [seal/entry-missing]`); continue; }
    let bytes;
    if (staged) {
      const raw = gitShow(root, relFromRoot(root, abs), '');
      if (raw === null) { errors.push(`归档: ${key} — 暂存索引中读不到该文件（索引条目异常，无法核对封印） [seal/staged-unreadable]`); continue; }
      bytes = Buffer.from(raw, 'utf8');
    } else {
      bytes = readFileSync(abs);
    }
    const actual = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    if (seal !== actual) errors.push(`归档: ${key} — 哈希不一致：封印后被修改（冻结区永久不可改） [seal/hash]`);
  }
  for (const key of Object.keys(manifest.files)) {
    if (staged) {
      // 暂存模式：幽灵 = manifest 键在索引里没有对应文件（将要提交的树里不存在）
      if (gitShow(root, relFromRoot(root, keyAbs(key)), '') === null) {
        errors.push(`归档: ${key} — manifest 封印的文件不在暂存索引中 [seal/ghost]`);
      }
      continue;
    }
    let st = null;
    try { st = lstatSync(keyAbs(key)); } catch { /* 盘上无此文件——真幽灵 */ }
    if (!st) { errors.push(`归档: ${key} — manifest 封印的文件在盘上不存在 [seal/ghost]`); continue; }
    // 盘上有但不是常规文件（符号链接等）：收集器会跳过它，哈希从未被核对——按篡改处理
    if (!st.isFile()) errors.push(`归档: ${key} — 盘上不是常规文件（绕过收集器，哈希未被核对；归档区不允许符号链接） [seal/tamper]`);
  }
  if (gitTopLevel(root) === null) {
    warnings.push('非 git 环境——append-only 基线检查降级为盘面哈希校验 [seal/no-git]');
    return;
  }
  const baselineRaw = gitShow(root, manifestRel, baseRef);
  if (baselineRaw === null) return; // 基线处无 manifest——无从比较
  try {
    const baseline = JSON.parse(baselineRaw);
    for (const [key, seal] of Object.entries(baseline.files ?? {})) {
      if (manifest.files[key] !== seal) errors.push(`归档: ${key} — 封印相对 ${baseRef} 被改动；归档封印只增不改（append-only） [seal/append-only]`);
    }
  } catch {
    errors.push(`归档: ${manifestRel} 在基线 ${baseRef} 处不是合法 JSON [seal/baseline-json]`);
  }
}

/**
 * 相对链接目标是否存在（支持百分号编码与 `#fragment`）。
 * staged=true（暂存模式）：目标存在性 = 索引成员（`git cat-file -e :<仓库相对路径>`，目录按「其下有
 * 索引文件」判）——提交树里没有的目标就该拦下（先 `git rm --cached` 目标再提交 = 提交一棵断链的树），
 * 盘面有而无索引不算存在；反过来目标在索引、盘面删了不算断链（盘面只是未提交的工作区）。
 * 交互模式仍按盘面 existsSync 判——行为与旧版逐字一致。
 */
export function linkTargetExists(absFromFile, target, { root = null, staged = false } = {}) {
  const pathPart = target.split('#')[0];
  if (!pathPart) return true;
  const base = dirname(absFromFile);
  if (staged) {
    const candidates = [pathPart];
    try { candidates.push(decodeURIComponent(pathPart)); } catch { /* 非法百分号编码——按原样判缺失 */ }
    return candidates.some((p) => {
      const rel = relFromRoot(root, resolve(base, p));
      return rel !== '' && !rel.startsWith('..') && indexHas(root, rel);
    });
  }
  if (existsSync(resolve(base, pathPart))) return true;
  try {
    return existsSync(resolve(base, decodeURIComponent(pathPart)));
  } catch {
    return false;
  }
}

function gitOk(root) {
  try {
    execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
    return true;
  } catch {
    return false;
  }
}

/** `git ls-files -z` 封装：返回仓库相对路径数组（已入库文件，不含未跟踪文件）。 */
export function gitList(root, args) {
  const out = execFileSync('git', ['ls-files', '-z', ...args], {
    cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'],
  });
  return out.split('\0').filter(Boolean);
}

/**
 * 解析 `git ls-files -s -z`（索引条目）为 Map<仓库相对路径, mode>。
 * 暂存模式的形态判据用 mode 取代盘面 lstat：100644/100755 是常规文件、120000 是符号链接——
 * 「git rm --cached + 盘面留好版」或「索引坏内容 + 盘面换符号链接」都改不了索引里的形态。
 */
export function gitIndexModes(root) {
  const out = execFileSync('git', ['ls-files', '-s', '-z'], {
    cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'],
  });
  const map = new Map();
  for (const rec of out.split('\0')) {
    if (!rec) continue;
    const tab = rec.indexOf('\t');
    if (tab === -1) continue;
    map.set(rec.slice(tab + 1), rec.slice(0, tab).split(' ')[0]);
  }
  return map;
}

/**
 * 索引中是否存在该仓库相对路径（暂存模式的存在性判据）。
 * 文件按精确条目判（`git cat-file -e :<rel>`）；目录在索引里没有自身条目，按「其下有索引文件」判——
 * 空目录无法入库，所以「提交树里目录存在」等价于「其下有文件」。
 */
export function indexHas(root, rel) {
  try {
    execFileSync('git', ['cat-file', '-e', `:${rel}`], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
    return true;
  } catch {
    // 不是索引条目（目录，或真的不存在）——继续按目录前缀判
  }
  const prefix = rel.endsWith('/') ? rel : `${rel}/`;
  try {
    return gitList(root, ['--', prefix]).some((p) => p.startsWith(prefix));
  } catch {
    return false;
  }
}

/**
 * 索引目录清单：Map<直接子项名, 'file' | 'dir'>，暂存模式下替代 readdirSync。
 * 「盘面有、索引无」的在写条目不参与判定；「索引有、盘面无」的照样参与——校验面是提交树。
 */
export function indexChildren(root, dirRel = '') {
  const prefix = dirRel ? `${dirRel.replace(/\/$/, '')}/` : '';
  const rels = prefix ? gitList(root, ['--', prefix]) : gitList(root, []);
  const map = new Map();
  for (const p of rels) {
    if (prefix && !p.startsWith(prefix)) continue;
    const rest = prefix ? p.slice(prefix.length) : p;
    if (!rest) continue;
    const slash = rest.indexOf('/');
    const name = slash === -1 ? rest : rest.slice(0, slash);
    const kind = slash === -1 ? 'file' : 'dir';
    if (kind === 'dir' || !map.has(name)) map.set(name, kind);
  }
  return map;
}

/** git 仓库根（realpath）；非 git 环境返回 null。 */
export function gitTopLevel(cwd) {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

function walk(dir, relBase, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) walk(full, rel, out);
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(rel);
  }
}

/**
 * 该路径的任一祖先目录是否带原始语料标记文件。
 * staged=true 时标记存在性也按索引判（indexHas）——盘面有标记而没入库不算豁免。
 */
export function isRawExempt(root, reg, rel, { staged = false } = {}) {
  const parts = rel.split('/');
  for (let i = parts.length - 1; i >= 1; i--) {
    const dir = parts.slice(0, i);
    if (staged ? indexHas(root, [...dir, reg.rawMarker].join('/')) : existsSync(join(root, ...dir, reg.rawMarker))) return true;
  }
  return false;
}

/**
 * 发现待检文档。默认只看已入库文件（`git ls-files`）——门禁守的是「将要提交的内容」，
 * 因此不会踩到同仓其他会话尚未入库的在写文件；includeUntracked=true 时并入未入库文件做全量审计。
 * staged=true（pre-commit 暂存模式）：发现面整体换成 git 索引（`git ls-files -s`）——
 * 存在性与形态（mode 100644/100755 通过，120000 符号链接等跳过）都以索引为准，盘面 lstat 不参与；
 * 未入库文件不在将要提交的树里，此时 includeUntracked 不生效（全量审计走盘面模式）。
 * 返回 [{ rel, abs, tracked }]，已排序。
 */
export function discoverDocs(root, reg, { includeUntracked = false, staged = false } = {}) {
  const useGit = gitOk(root);
  let rels;
  let modes = null;
  if (useGit && staged) {
    modes = gitIndexModes(root);
    rels = [...modes.keys()].filter((p) => p.endsWith('.md'));
  } else if (useGit) {
    rels = gitList(root, ['--', '*.md']);
    if (includeUntracked) rels = rels.concat(gitList(root, ['--others', '--exclude-standard', '--', '*.md']));
  } else {
    rels = [];
    walk(root, '', rels);
  }
  const seen = new Set();
  const out = [];
  for (const rel of [...new Set(rels)].sort()) {
    if (seen.has(rel)) continue;
    seen.add(rel);
    if (matchAny(reg.exemptPaths, rel)) continue;
    const abs = join(root, rel);
    if (staged && modes) {
      const mode = modes.get(rel);
      if (mode !== '100644' && mode !== '100755') continue; // 符号链接（120000）等非正规文件一律跳过
      if (isRawExempt(root, reg, rel, { staged: true })) continue;
      out.push({ rel, abs, tracked: true });
      continue;
    }
    let st;
    try { st = lstatSync(abs); } catch { continue; }
    if (st.isSymbolicLink() || !st.isFile()) continue;
    if (isRawExempt(root, reg, rel)) continue;
    out.push({ rel, abs, tracked: useGit ? true : null });
  }
  return out;
}

/**
 * 归类：固定位置模式优先（路径即身份，归档区里保留的原 `Type:` 行不会把冻结文档误判回原类型），
 * 其次看头块 `Type:`（日期型文档靠它区分同一家里的多种类型）。
 * 返回 { type, via } 或 { type: null, reason }。
 */
export function classifyDoc(rel, reg, header) {
  for (const key of reg.resolutionOrder ?? []) {
    const t = reg.types[key];
    if (t?.location && matchAny(t.location, rel)) return { type: key, via: 'location' };
  }
  const declared = header ? fieldValue(header, 'Type') : null;
  if (declared) {
    if (!reg.types[declared]) return { type: null, reason: `头块声明了未注册的类型 \`Type: ${declared}\`` };
    return { type: declared, via: 'header' };
  }
  return { type: null, reason: '缺少 `Type:` 头，且不匹配任何固定位置模式（新建文档用 scripts/new-doc.mjs）' };
}

/**
 * 读 git 内容；不可用或该版本无此文件时返回 null。
 * ref 默认 'HEAD'（基线）；ref='' 表示读索引（暂存）版本，即 `git show :<rel>`。
 */
export function gitShow(root, rel, ref = 'HEAD') {
  try {
    const spec = ref === '' ? `:${rel}` : `${ref}:${rel}`;
    return execFileSync('git', ['show', spec], {
      cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    return null;
  }
}

/** 仓库根的相对路径（用于 git show 的 pathspec）。 */
export function relFromRoot(root, abs) {
  return relative(root, abs).split('\\').join('/');
}
