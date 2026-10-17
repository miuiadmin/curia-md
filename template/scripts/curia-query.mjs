#!/usr/bin/env node
/**
 * curia-query.mjs —— Curia 2.0 P1 只读基础纳管与覆盖报告。
 *
 * 定位：轻量 Envelope 投影，不是新运行时、不写 INDEX、不改 Curia 1.0 注册表。
 * 它以 Git 仓库边界为 instance boundary，默认只看已入库文件；`--all` 才并入未忽略的
 * untracked 文件。默认只读头块；`--links` 显式扫描基础 Markdown 链接，不宣称全文已读或事实已核实。
 *
 * 用法：
 *   node scripts/curia-query.mjs --json
 *   node scripts/curia-query.mjs --role knowledge --format md
 *   node scripts/curia-query.mjs --coverage
 *   node scripts/curia-query.mjs --links --strict --coverage
 *   node scripts/curia-query.mjs --all --gap owner-unknown
 *   node scripts/curia-query.mjs --root <git-root> --strict
 *   node scripts/curia-query.mjs --allow-no-git --coverage --json
 */

import { traverseDependencies } from './curia-dependencies.mjs';
import { IMPACT_LIMITS } from './curia-impact.mjs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { normalizeInstance, mappingFor, applyInstanceMetadata, applyRepresentation, REPRESENTATIONS, containsPath, taskProfileFor, taskMemberFor, taskPrivatePath, hasBoundHeader, parseNativeHeader, INSTANCE_GAPS, STATUS_VIEWS, CONTENT_PARSERS } from './curia-instance.mjs';
import { parseDataJson, parseRegistryJson, JSON_NATIVE_PARSER, JSON_NATIVE_LIMITS } from './curia-json.mjs';
import { ORIGINALS_PARSER, inspectOriginalRegister, summarizeOriginals, isOriginalDigestAlgorithm } from './curia-originals.mjs';
import { APPLICABILITY_GAPS, APPLICABILITY_DETAILS, CELL_STATES, VALIDITY_STATES, evaluationInstant, finalizeVariants, summarizeValidity } from './curia-applicability.mjs';
import {
  ROOT,
  privateReadPath,
  registryProjectionPath,
  classifyDoc,
  isMainModule,
  isRawExempt,
  normalizeLines,
  parseHeader,
} from './doc-lib.mjs';

const SCHEMA = 'curia.inventory/3';
const REGISTRY_REL = '.agents/doc-types.json';
// Ephemeral read capabilities: serialized or caller-mutated inventory never grants file access.
const readSnapshots = new WeakMap();
const taskInventoryRequests = new WeakSet();
const impactInventoryRequests = new WeakMap();
const sourceSnapshots = new WeakMap();
const moveSelections = new WeakMap();
const gitChangeSelections = new WeakMap();
const gitChangeObservations = new WeakMap();
const FILTER_KEYS = ['surface', 'role', 'type', 'status', 'status-view', 'format', 'owner', 'maintenance', 'representation', 'tracked', 'gap', 'family', 'language', 'product-version', 'platform', 'audience', 'canonical', 'cell-state', 'validity'];
const plainObject = (value) => value && typeof value === 'object' && !Array.isArray(value) && [null, Object.prototype].includes(Object.getPrototypeOf(value)) && !Object.getOwnPropertySymbols(value).length;
const KNOWN_GAPS = [...INSTANCE_GAPS, ...APPLICABILITY_GAPS, 'metadata-read-budget', 'metadata-privacy-excluded', 'metadata-snapshot-changed', 'worktree-revision-unobserved', 'role-unknown', 'maintenance-unknown', 'owner-unknown', 'owner-conflict', 'type-unknown', 'type-conflict', 'type-source-conflict', 'status-unknown', 'status-invalid', 'status-unexpected', 'status-conflict', 'header-invalid', 'header-truncated', 'content-unparsed', 'record-mutation-unknown', 'head-tree-invalid', 'path-hardlink', 'path-changed-during-read', 'link-coverage-unparsed', 'link-read-truncated', 'link-target-missing', 'link-coverage-excluded-zone', 'link-syntax-uncovered'];
const LINK_SCAN_LIMIT = 16 * 1024 * 1024;
const LINK_PARSER = 'markdown-inline-basic/2';
const LINK_SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const GIT_ENV_OVERRIDES = new Set([
  'GIT_CEILING_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_DIR',
  'GIT_INDEX_FILE',
  'GIT_NAMESPACE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_WORK_TREE',
  'GIT_EXTERNAL_DIFF',
  'GIT_EXTERNAL_DIFF_TRUST_EXIT_CODE',
  'GIT_ATTRIBUTES_FILE',
  'GIT_ATTR_SOURCE',
]);

function gitBytes(root, args, input = undefined, maxBytes = 64 * 1024 * 1024) {
  try {
    const output = execFileSync('git', ['--no-replace-objects', '--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', '-c', 'core.preloadIndex=false', ...args], {
      cwd: root,
      input,
      encoding: null,
      maxBuffer: maxBytes,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, LC_ALL: 'C', LANGUAGE: 'C', GIT_NO_LAZY_FETCH: '1', GIT_ALLOW_PROTOCOL: '', GIT_TERMINAL_PROMPT: '0' },
    });
    if (output.length > maxBytes) throw new Error('Git 输出字节超限');
    return output;
  } catch (error) {
    if (Buffer.isBuffer(error.stdout)) error.stdout = error.stdout.toString('utf8');
    if (Buffer.isBuffer(error.stderr)) error.stderr = error.stderr.toString('utf8');
    throw error;
  }
}

function gitOutput(root, args, input = undefined, maxBytes = 64 * 1024 * 1024) {
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(gitBytes(root, args, input, maxBytes));
}

function gitRootForInstance(root) {
  try {
    return gitOutput(root, ['rev-parse', '--show-toplevel']).trim() || null;
  } catch (e) {
    if (e.status === 128 && /not a git repository/i.test(String(e.stderr ?? ''))) return null;
    throw new Error(`Git 仓库边界不可确认：${e.message} [curia2/git-boundary-unknown]`);
  }
}

/** 显式解析 instance root；不向上递归找父仓，也不用相邻仓库补配置。 */
export function resolveInstance(inputRoot = ROOT, { allowNoGit = false } = {}) {
  let root;
  try {
    root = realpathSync(resolve(inputRoot));
  } catch (e) {
    throw new Error(`Curia instance root 不可解析：${e.message} [curia2/root-unavailable]`);
  }
  const gitEnvOverride = Object.keys(process.env).find((key) => GIT_ENV_OVERRIDES.has(key) || key.startsWith('GIT_CONFIG_'));
  if (gitEnvOverride) {
    throw new Error(`检测到 Git 环境变量覆盖：${gitEnvOverride}；instance boundary 必须来自显式 root [curia2/git-env-override]`);
  }
  const gitRoot = gitRootForInstance(root);
  if (!gitRoot) {
    let gitMarker = false;
    try {
      lstatSync(join(root, '.git'));
      gitMarker = true;
    } catch {
      gitMarker = false;
    }
    if (gitMarker) throw new Error(`Curia instance root 声明了 .git 但 Git 边界不可确认：${root} [curia2/git-boundary-unknown]`);
    if (allowNoGit) return { root, gitRoot: null, boundary: 'unavailable-not-git', available: false };
    throw new Error(`Curia instance root 不是 Git 仓库：${root} [curia2/root-not-git]`);
  }
  const gitReal = realpathSync(gitRoot);
  if (root !== gitReal) {
    throw new Error(`Curia instance root 必须等于 Git 仓库根：${root} != ${gitReal} [curia2/root-boundary]`);
  }
  return { root, gitRoot: gitReal, boundary: 'git-repository', available: true };
}

function within(parent, child) {
  const rel = relative(parent, child);
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function nestedRepositoryRoot(root, rel) {
  const parts = rel.split('/');
  for (let i = 1; i < parts.length; i++) {
    const dir = join(root, ...parts.slice(0, i));
    try {
      lstatSync(join(dir, '.git'));
      return parts.slice(0, i).join('/');
    } catch {
      // 没有 .git 标记或标记已在竞争中消失，继续检查更深层。
    }
  }
  return null;
}

function validGitPath(path) {
  return Boolean(path) && !path.startsWith('/') && !path.split('/').includes('..') && !path.includes('\0');
}

function gitIndexRecords(root) {
  let out;
  try {
    out = gitOutput(root, ['ls-files', '-s', '-z']);
  } catch (e) {
    throw new Error(`Git index 不可读取：${e.message} [curia2/git-index-unavailable]`);
  }
  const map = new Map();
  for (const record of out.split('\0')) {
    if (!record) continue;
    const tab = record.indexOf('\t');
    const parts = tab === -1 ? [] : record.slice(0, tab).split(/\s+/);
    const path = tab === -1 ? '' : record.slice(tab + 1);
    if (tab === -1 || parts.length !== 3 || !['100644', '100755', '120000', '160000'].includes(parts[0]) || !/^[0-9a-f]{40}$|^[0-9a-f]{64}$/.test(parts[1]) || !/^[0-3]$/.test(parts[2]) || !validGitPath(path)) {
      throw new Error(`Git index 记录不可解析：${record.slice(0, 200)} [curia2/git-index-invalid]`);
    }
    const list = map.get(path) ?? [];
    list.push({ mode: parts[0], oid: parts[1], stage: Number(parts[2]) });
    map.set(path, list);
  }
  return map;
}

function indexFingerprint(index) {
  const records = [...index.entries()].map(([path, entries]) => [path, [...entries].map((entry) => `${entry.mode} ${entry.oid} ${entry.stage}`).sort()]);
  records.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  return JSON.stringify(records);
}

function gitHead(root) {
  try {
    const head = gitOutput(root, ['rev-parse', '--verify', '--quiet', 'HEAD']).trim() || null;
    return { head, state: head ? 'available' : 'unknown', error: null };
  } catch (e) {
    if (e.status === 1 && !e.stdout && !e.stderr) return { head: null, state: 'unborn', error: null };
    return { head: null, state: 'unknown', error: e.message };
  }
}

function gitHeadEntries(root, head, paths) {
  if (!head) return { available: false, becauseNoHead: true, invalid: false, entries: new Map() };
  let out;
  try {
    out = gitOutput(root, ['ls-tree', '-r', '-z', head, '--', ...paths]);
  } catch {
    return { available: false, becauseNoHead: false, invalid: false, entries: new Map() };
  }
  const entries = new Map();
  for (const record of out.split('\0')) {
    if (!record) continue;
    const tab = record.indexOf('\t');
    const parts = tab === -1 ? [] : record.slice(0, tab).split(/\s+/);
    if (
      tab === -1
      || parts.length !== 3
      || !/^(?:100[0-7]{3}|120000|160000)$/.test(parts[0])
      || !['blob', 'commit'].includes(parts[1])
      || !/^[0-9a-f]{40}$|^[0-9a-f]{64}$/.test(parts[2])
      || !validGitPath(record.slice(tab + 1))
      || (parts[1] === 'commit') !== (parts[0] === '160000')
    ) {
      return { available: false, becauseNoHead: false, invalid: true, error: `Git HEAD tree 记录不可解析：${record.slice(0, 200)}`, entries: new Map() };
    }
    const path = record.slice(tab + 1);
    if (entries.has(path)) {
      return { available: false, becauseNoHead: false, invalid: true, error: `Git HEAD tree 含重复路径：${path}`, entries: new Map() };
    }
    entries.set(path, { mode: parts[0], type: parts[1], oid: parts[2] });
  }
  return { available: true, becauseNoHead: false, invalid: false, entries };
}

function ensureRegistryBoundary(root, entries = []) {
  const surface = join(root, '.agents');
  let surfaceStat;
  try {
    surfaceStat = lstatSync(surface);
  } catch (e) {
    throw new Error(`Curia Registry 所在受管面不可用：${e.message} [curia2/registry-boundary]`);
  }
  if (surfaceStat.isSymbolicLink() || !surfaceStat.isDirectory()) {
    throw new Error(`Curia Registry 所在受管面必须是仓内真实目录：${surface} [curia2/registry-boundary]`);
  }
  let realSurface;
  try {
    realSurface = realpathSync(surface);
  } catch (e) {
    throw new Error(`Curia Registry 受管面真实路径不可解析：${e.message} [curia2/registry-boundary]`);
  }
  if (realSurface !== surface || !within(root, realSurface)) {
    throw new Error(`Curia Registry 受管面真实路径越界：${realSurface} [curia2/registry-boundary]`);
  }
  if (entries.length > 1 || entries.some((candidate) => candidate.stage !== 0)) {
    throw new Error(`Curia Registry 在 Git index 中处于 conflict stage [curia2/registry-boundary]`);
  }
  const entry = entries[0] ?? null;
  if (entry && entry.mode !== '100644' && entry.mode !== '100755') {
    throw new Error(`Curia Registry 的 Git index 形态不是常规文件：${entry.mode} [curia2/registry-boundary]`);
  }
  const rel = REGISTRY_REL;
  const abs = join(root, rel);
  let stat;
  try {
    stat = lstatSync(abs);
  } catch (e) {
    throw new Error(`Curia Registry 不可读：${e.message} [curia2/registry-boundary]`);
  }
  if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1) {
    throw new Error(`Curia Registry 必须是无硬链接别名的仓内常规文件：${rel} [curia2/registry-boundary]`);
  }
  let real;
  try {
    real = realpathSync(abs);
  } catch (e) {
    throw new Error(`Curia Registry 真实路径不可解析：${e.message} [curia2/registry-boundary]`);
  }
  if (real !== abs || !within(root, real)) {
    throw new Error(`Curia Registry 真实路径越界：${real} [curia2/registry-boundary]`);
  }
  return entries[0] ?? null;
}

function isPlainRegistryObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

function assertRegistryPlainObject(value, label) {
  if (!isPlainRegistryObject(value) || Object.getOwnPropertySymbols(value).length) throw new Error(`Registry ${label} 必须是普通对象 [curia2/registry-invalid]`);
}

function assertRegistryStringArray(value, label, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && !value.length) || value.some((item) => typeof item !== 'string' || !item) || new Set(value).size !== value.length) {
    throw new Error(`Registry ${label} 必须是不重复非空字符串数组 [curia2/registry-invalid]`);
  }
}

function assertRegistryRelativePath(value, label) {
  if (typeof value !== 'string' || !value || isAbsolute(value) || value.split('/').includes('..')) throw new Error(`Registry ${label} 必须是仓内相对路径 [curia2/registry-invalid]`);
}

function normalizeRegistry(input) {
  const required = ['homes', 'types', 'sectionAliases', 'headerFields', 'resolutionOrder', 'templateDir'];
  const allowed = new Set(['instance', 'version', 'comment', 'projection', 'templateDir', 'rawMarker', 'exemptPaths', 'resolutionOrder', 'globalRules', 'workspaceLayout', 'bridges', 'noteTree', 'headerFields', 'sectionAliases', 'homes', 'types']);
  const inputProto = input ? Object.getPrototypeOf(input) : null;
  if (!input || typeof input !== 'object' || Array.isArray(input) || (inputProto !== null && inputProto !== Object.prototype) || input.version !== 1 || required.some((key) => input[key] === undefined)) {
    throw new Error('Registry 缺少 version 1 所需顶层字段或顶层对象原型非法 [curia2/registry-invalid]');
  }
  if (Object.getOwnPropertySymbols(input).length) throw new Error('Registry 不支持 Symbol 顶层字段 [curia2/registry-invalid]');
  const source = Object.fromEntries(Object.keys(input).map((key) => [key, input[key]]));
  const unknown = Object.keys(source).filter((key) => !allowed.has(key));
  if (unknown.length) throw new Error(`Registry 含未支持顶层字段：${unknown.join('、')} [curia2/registry-invalid]`);
  const typesProto = source.types ? Object.getPrototypeOf(source.types) : null;
  if (!source.types || typeof source.types !== 'object' || Array.isArray(source.types) || (typesProto !== null && typesProto !== Object.prototype)) throw new Error('Registry types 必须是普通对象 [curia2/registry-invalid]');
  assertRegistryPlainObject(source.homes, 'homes');
  assertRegistryPlainObject(source.sectionAliases, 'sectionAliases');
  assertRegistryPlainObject(source.headerFields, 'headerFields');
  assertRegistryRelativePath(source.templateDir, 'templateDir');
  for (const [key, home] of Object.entries(source.homes)) assertRegistryPlainObject(home, `homes.${key}`);
  for (const [key, aliases] of Object.entries(source.sectionAliases)) assertRegistryStringArray(aliases, `sectionAliases.${key}`);
  for (const [key, field] of Object.entries(source.headerFields)) assertRegistryPlainObject(field, `headerFields.${key}`);
  if (source.comment !== undefined && typeof source.comment !== 'string') throw new Error('Registry comment 必须是字符串 [curia2/registry-invalid]');
  if (source.projection !== undefined) registryProjectionPath(source.projection);
  if (source.rawMarker !== undefined && (typeof source.rawMarker !== 'string' || !source.rawMarker || source.rawMarker.includes('/'))) {
    throw new Error('Registry rawMarker 必须是不含路径分隔符的非空字符串 [curia2/registry-invalid]');
  }
  if (source.exemptPaths !== undefined) assertRegistryStringArray(source.exemptPaths, 'exemptPaths', { allowEmpty: true });
  if (source.globalRules !== undefined) assertRegistryPlainObject(source.globalRules, 'globalRules');
  if (source.workspaceLayout !== undefined) assertRegistryPlainObject(source.workspaceLayout, 'workspaceLayout');
  if (source.noteTree !== undefined) assertRegistryPlainObject(source.noteTree, 'noteTree');
  if (source.bridges !== undefined) {
    if (!Array.isArray(source.bridges)) throw new Error('Registry bridges 必须是数组 [curia2/registry-invalid]');
    for (const bridge of source.bridges) {
      assertRegistryPlainObject(bridge, 'bridges 成员');
      for (const key of ['path', 'target', 'consumer']) {
        if (typeof bridge[key] !== 'string' || !bridge[key]) throw new Error(`Registry bridges 成员缺少非空 ${key} [curia2/registry-invalid]`);
      }
    }
  }
  const typeKeys = new Set(Object.keys(source.types));
  if (!Array.isArray(source.resolutionOrder) || source.resolutionOrder.some((key) => typeof key !== 'string' || !typeKeys.has(key)) || new Set(source.resolutionOrder).size !== source.resolutionOrder.length) {
    throw new Error('Registry resolutionOrder 必须是已注册类型的不重复字符串数组 [curia2/registry-invalid]');
  }
  const allowedProfileFields = new Set(['home', 'title', 'naming', 'template', 'header', 'statuses', 'initialStatus', 'transitions', 'fields', 'sections', 'freshness', 'narrative', 'purpose', 'notFor', 'promotesTo', 'location', 'generated', 'sealed', 'externalGuard', 'extraChecks']);
  const types = Object.create(null);
  for (const key of Object.keys(source.types)) {
    const rawProfile = source.types[key];
    const profileProto = rawProfile ? Object.getPrototypeOf(rawProfile) : null;
    if (!rawProfile || typeof rawProfile !== 'object' || Array.isArray(rawProfile) || (profileProto !== null && profileProto !== Object.prototype) || Object.getOwnPropertySymbols(rawProfile).length) {
      throw new Error(`Registry 类型 ${key} 不是普通对象 [curia2/registry-invalid]`);
    }
    if (rawProfile.generated !== undefined && typeof rawProfile.generated !== 'boolean') throw new Error(`Registry 类型 ${key} 的 generated 必须是 boolean [curia2/registry-invalid]`);
    const unknownProfileFields = Object.keys(rawProfile).filter((field) => !allowedProfileFields.has(field));
    if (unknownProfileFields.length) throw new Error(`Registry 类型 ${key} 含未支持字段：${unknownProfileFields.join('、')} [curia2/registry-invalid]`);
    const profile = Object.assign(Object.create(null), rawProfile);
    if (profile.header !== undefined && !['required', 'optional', 'external', 'frontmatter', 'none', 'archived'].includes(profile.header)) {
      throw new Error(`Registry 类型 ${key} 的 header 非法 [curia2/registry-invalid]`);
    }
    if (profile.statuses !== undefined && (!Array.isArray(profile.statuses) || profile.statuses.some((status) => typeof status !== 'string' || !status) || new Set(profile.statuses).size !== profile.statuses.length)) {
      throw new Error(`Registry 类型 ${key} 的 statuses 非法 [curia2/registry-invalid]`);
    }
    if (profile.location !== undefined && (!Array.isArray(profile.location) || !profile.location.length || profile.location.some((pattern) => typeof pattern !== 'string' || !pattern) || new Set(profile.location).size !== profile.location.length)) {
      throw new Error(`Registry 类型 ${key} 的 location 非法 [curia2/registry-invalid]`);
    }
    types[key] = profile;
  }
  return Object.assign(Object.create(null), source, { types });
}


/** Compare a caller copy with bounded, parsed file data; JSON object prototypes are not data. */
function equalRegistryData(expected, candidate) {
  if (expected === null || typeof expected !== 'object') return Object.is(expected, candidate);
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(expected) !== Array.isArray(candidate)) return false;
  const proto = Object.getPrototypeOf(candidate);
  if (Array.isArray(expected) ? proto !== Array.prototype : proto !== null && proto !== Object.prototype) return false;
  const keys = Reflect.ownKeys(expected);
  if (keys.length !== Reflect.ownKeys(candidate).length) return false;
  return keys.every(key => {
    const wanted = Object.getOwnPropertyDescriptor(expected, key), supplied = Object.getOwnPropertyDescriptor(candidate, key);
    return supplied && Object.hasOwn(supplied, 'value') && supplied.enumerable === wanted.enumerable && equalRegistryData(wanted.value, supplied.value);
  });
}


/** 打开前已验证的 lstat 对象；打开后用 fd 身份复核，避免路径被并发替换成 symlink 或特殊文件。 */
function openStableRead(abs, expectedStat) {
  const flags = constants.O_RDONLY
    | (constants.O_NOFOLLOW ?? 0)
    | (constants.O_NONBLOCK ?? 0);
  const fd = openSync(abs, flags);
  try {
    const openedStat = fstatSync(fd);
    if (!sameStat(expectedStat, openedStat)) throw new Error('打开后的文件身份与路径 lstat 不一致');
    return fd;
  } catch (e) {
    closeSync(fd);
    throw e;
  }
}

export function readStableFile(abs, expectedStat, maxBytes = null) {
  const fd = openStableRead(abs, expectedStat);
  try {
    const chunks = [];
    const chunk = Buffer.alloc(Math.max(1, Math.min(1024 * 1024, expectedStat.size + 1, maxBytes === null ? Infinity : maxBytes + 1)));
    const limit = maxBytes === null ? Infinity : maxBytes + 1;
    let total = 0;
    while (total < limit) {
      const want = Math.min(chunk.length, limit - total);
      const n = readSync(fd, chunk, 0, want, null);
      if (n === 0) break;
      chunks.push(Buffer.from(chunk.subarray(0, n)));
      total += n;
    }
    if (!sameStat(expectedStat, fstatSync(fd))) throw new Error('文件身份在读取期间变化');
    return Buffer.concat(chunks);
  } finally {
    closeSync(fd);
  }
}

/** Hash raw bytes in fixed memory. A digest is emitted only after the descriptor is revalidated. */
function digestStableFile(abs, expectedStat, gitAlgorithm = null, contentAlgorithm = 'sha256') {
  const fd = openStableRead(abs, expectedStat), hash = createHash(contentAlgorithm);
  const blob = gitAlgorithm ? createHash(gitAlgorithm).update(`blob ${expectedStat.size}\0`) : null;
  try {
    const chunk = Buffer.alloc(64 * 1024); let total = 0;
    while (total < expectedStat.size) {
      const n = readSync(fd, chunk, 0, Math.min(chunk.length, expectedStat.size - total), null);
      if (!n) throw new Error('来源在摘要读取前结束');
      hash.update(chunk.subarray(0, n)); blob?.update(chunk.subarray(0, n)); total += n;
    }
    if (!sameStat(expectedStat, fstatSync(fd))) throw new Error('来源在摘要读取期间变化');
    const digest = { algorithm: contentAlgorithm, canonicalization: 'raw-bytes/1', value: hash.digest('hex') };
    return blob ? { digest, oid: blob.digest('hex') } : digest;
  } finally { closeSync(fd); }
}

// Keep the public query export while all Registry entry points share the same parser.
export { parseRegistryJson } from './curia-json.mjs';

function loadInstanceRegistry(instance, index, { maxBytes = REGISTRY_BYTE_LIMIT } = {}) {
  const entries = index.get(REGISTRY_REL) ?? [];
  let entry;
  try {
    entry = ensureRegistryBoundary(instance.root, entries);
  } catch (e) {
    throw e;
  }
  let registryStat;
  try {
    registryStat = lstatSync(join(instance.root, REGISTRY_REL));
  } catch (e) {
    // ensureRegistryBoundary 已提供更精确的边界错误；这里保留并发失败原因。
    throw new Error(`Curia Registry 二次 lstat 失败：${e.message} [curia2/registry-boundary]`);
  }
  let state;
  try {
    let registryText;
    let registryBytes;
    if (maxBytes !== null && registryStat.size > maxBytes) throw new Error('Registry 字节超限');
    registryBytes = readStableFile(join(instance.root, REGISTRY_REL), registryStat, maxBytes === null ? null : maxBytes - 1);
    if (maxBytes !== null && registryBytes.length !== registryStat.size) throw new Error('Registry 字节超限');
    try {
      registryText = new TextDecoder('utf-8', { fatal: true }).decode(registryBytes);
    } catch {
      throw new Error('Curia Registry 不是合法 UTF-8');
    }
    if (registryText.includes('\0')) throw new Error('Curia Registry 含二进制 NUL');
    state = {
      registry: parseRegistryJson(registryText),
      contentSource: 'worktree-json',
      tracked: Boolean(entry),
      indexMode: entry?.mode ?? null,
      indexOid: entry?.oid ?? null,
      indexStage: entry?.stage ?? null,
    };
    Object.defineProperty(state, 'stat', { value: registryStat, enumerable: false });
    Object.defineProperty(state, 'digest', { value: digestBytes(registryBytes), enumerable: false });
    Object.defineProperty(state, 'observedAt', { value: new Date().toISOString(), enumerable: false });
    Object.defineProperty(state, 'rawRevision', { value: rawWorktreeRevision(entry, registryStat, registryBytes), enumerable: false });
  } catch (e) {
    const code = /打开后的文件身份|文件身份在读取期间变化/.test(e.message)
      ? 'registry-changed'
      : (e instanceof SyntaxError || /注册表结构非法|不是合法 UTF-8|含二进制 NUL|Registry JSON/.test(e.message) ? 'registry-invalid' : 'registry-unavailable');
    throw new Error(`${e.message} [curia2/${code}]`);
  }
  try {
    const statAfter = lstatSync(join(instance.root, REGISTRY_REL));
    if (!sameStat(registryStat, statAfter)) throw new Error('Curia Registry 在读取期间发生变化');
  } catch (e) {
    throw new Error(`${e.message} [curia2/registry-changed]`);
  }
  return state;
}

/** Read-only mount-table parsing. A same-device bind mount must not evade the dev check. */
export function parseMountPoints(text, platform) {
  const points = [];
  for (const line of text.trimEnd().split('\n')) {
    let point;
    if (platform === 'linux') {
      const fields = line.split(' ');
      if (fields.length < 10 || !/^\d+$/.test(fields[0]) || !fields.includes('-')) throw new Error('mountinfo 格式不可确认');
      point = fields[4];
      if (/\\(?!040|011|012|134)/.test(point)) throw new Error('mountinfo 转义不可确认');
      point = point.replace(/\\(040|011|012|134)/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)));
    } else if (platform === 'darwin') {
      const match = /^.+? on (\/.*) \([^\n]+\)$/.exec(line);
      if (!match || (line.match(/ on \//g) ?? []).length !== 1) throw new Error('mount 输出格式不可确认');
      point = match[1];
    } else throw new Error('当前平台未接入 mount-table parser');
    if (!point?.startsWith('/') || /[\u0000-\u001f]/.test(point)) throw new Error('mount 路径不可确认');
    points.push(point);
  }
  return [...new Set(points)].sort();
}
export function instanceMounts(root) {
  const output = process.platform === 'linux' ? readFileSync('/proc/self/mountinfo', 'utf8') : process.platform === 'darwin' ? execFileSync('/sbin/mount', [], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }) : '';
  return parseMountPoints(output, process.platform).filter((point) => point !== root && within(root, point));
}

/** Validate every path component before following any directory; never execute an authority link. */
export function checkInstancePath(root, rel, kind, index, rootStat, mounts) {
  if (rel === '.' && kind === 'directory') return lstatSync(root);
  const parts = rel.split('/');
  let stat;
  for (let i = 0; i < parts.length; i++) {
    const path = parts.slice(0, i + 1).join('/');
    const abs = join(root, path);
    const entries = index.get(path) ?? [];
    if (entries.length > 1 || entries.some((entry) => entry.stage !== 0 || !['100644', '100755'].includes(entry.mode))) throw new Error(`路径 ${path} 存在 Git 冲突、symlink 或 gitlink`);
    if (mounts.some((point) => within(point, abs))) throw new Error(`路径 ${path} 穿越 instance 内的挂载点`);
    stat = lstatSync(abs);
    if (stat.isSymbolicLink() || stat.dev !== rootStat.dev || realpathSync(abs) !== abs) throw new Error(`路径 ${path} 存在链接、挂载或大小写 / Unicode 别名`);
    const directory = i < parts.length - 1 || kind === 'directory';
    if (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1) throw new Error(`路径 ${path} 形态不符或存在硬链接`);
    if (directory) {
      try { lstatSync(join(abs, '.git')); }
      catch (e) { if (e.code === 'ENOENT') continue; throw e; }
      throw new Error(`路径 ${path} 是嵌套仓库`);
    }
  }
  return stat;
}

function inspectInstanceLayout(root, layout, index, untracked, rootStat, findings, mounts) {
  const checked = [];
  let blocked = false;
  const refs = new Map();
  const addRef = (path, kind) => refs.set(`${kind}:${path}`, { path, kind });
  for (const surface of layout.surfaces) {
    addRef(surface.entry, 'file');
    for (const path of surface.authorityLinks) addRef(path, 'file');
    if (surface.discovery) addRef(surface.discovery.path, 'directory');
  }
  for (const profile of Object.values(layout.nativeProfiles)) for (const path of profile.authorityLinks) addRef(path, 'file');
  for (const path of layout.recordStore?.authorityLinks ?? []) addRef(path, 'file');
  for (const guard of Object.values(layout.guards ?? {})) for (const path of guard.authorityLinks) addRef(path, 'file');
  for (const mapping of layout.mappings) addRef(mapping.path, mapping.kind);
  for (const { path, kind } of refs.values()) {
    try {
      const stat = checkInstancePath(root, path, kind, index, rootStat, mounts);
      checked.push({ path, kind, stat });
      if (kind === 'file' && !index.has(path)) aggregateFinding(findings, 'instance-reference-untracked', 'coverage', path, 'entry / authority link 未进入 Git index；仅验证本地路径，不执行 guard');
    } catch (e) {
      aggregateFinding(findings, 'instance-reference-invalid', 'error', path, e.message);
      blocked = true;
    }
  }
  // Discovery only enumerates Git names, never the contents of unregistered siblings.
  const paths = new Set([...index.keys(), ...untracked]);
  for (const surface of layout.surfaces.filter((candidate) => candidate.discovery)) {
    for (const path of paths) {
      if (containsPath(surface.discovery, path) && !surface.members.some((member) => containsPath(member, path)) && !surface.discovery.exclusions.some((exclusion) => containsPath(exclusion, path))) {
        aggregateFinding(findings, 'root-set-unregistered', 'error', path, `未登记的 discovery 路径；不读取正文，不自动扩张 ${surface.id}`);
      }
    }
  }
  return { checked, blocked };
}

function checkInstanceBaseline(root, layout, headTree, findings) {
  let blocked = false;
  const rootSets = layout.surfaces.filter((surface) => surface.kind === 'legacy-root-set');
  let baseline = null;
  const entry = headTree.entries.get(REGISTRY_REL);
  if (entry) {
    try {
      if (!['100644', '100755'].includes(entry.mode)) throw new Error('HEAD Registry 不是常规文件');
      // Bound the immutable baseline independently of document metadata. Size inspection is
      // not sufficient: the actual blob command also has its own hard stdout limit.
      const sizeText = gitOutput(root, ['cat-file', '-s', entry.oid], undefined, 128).trim();
      if (!/^(?:0|[1-9][0-9]*)$/.test(sizeText) || !Number.isSafeInteger(Number(sizeText)) || Number(sizeText) > REGISTRY_BYTE_LIMIT) throw new Error('HEAD Registry 字节超限或大小未知');
      const text = gitOutput(root, ['cat-file', 'blob', entry.oid], undefined, REGISTRY_BYTE_LIMIT);
      if (Buffer.byteLength(text, 'utf8') !== Number(sizeText)) throw new Error('HEAD Registry 字节数与对象大小不一致');
      const raw = parseRegistryJson(text);
      const registry = normalizeRegistry(raw);
      baseline = normalizeInstance(registry.instance, registry.types);
    } catch (e) {
      aggregateFinding(findings, 'root-set-baseline-invalid', 'error', REGISTRY_REL, e.message);
      blocked = true;
    }
  }
  // Removing the instance, renaming a set, or relabelling it as a root cannot erase a known baseline.
  for (const prior of baseline?.surfaces.filter((surface) => surface.kind === 'legacy-root-set') ?? []) {
    if (!rootSets.some((surface) => surface.id === prior.id)) {
      aggregateFinding(findings, 'root-set-topology-changed', 'error', prior.id, 'HEAD 中的 root set 被移除、改名或改为普通 root；不能绕过 no-expand');
      blocked = true;
    }
  }
  for (const surface of rootSets) {
    const prior = baseline?.surfaces.find((candidate) => candidate.id === surface.id && candidate.kind === 'legacy-root-set');
    if (!prior) {
      aggregateFinding(findings, 'root-set-baseline-unavailable', 'coverage', surface.id, 'HEAD 没有同名 root set 基线；首次登记不冒充已经验证 no-expand');
      continue;
    }
    const boundaries = (candidate) => JSON.stringify({ members: candidate.members.map(({ path, kind, role }) => ({ path, kind, role })).sort((a, b) => a.path.localeCompare(b.path)), discovery: { path: candidate.discovery.path, exclusions: candidate.discovery.exclusions.map(({ path, kind }) => ({ path, kind })).sort((a, b) => a.path.localeCompare(b.path)) } });
    if (boundaries(surface) !== boundaries(prior)) {
      aggregateFinding(findings, 'root-set-topology-changed', 'error', surface.id, '成员、职责、discovery 或 exclusions 与 HEAD 基线不同；不把本次查询当成已批准的布局扩张');
      blocked = true;
    }
  }
  return blocked;
}

function sameStat(a, b) {
  return Boolean(a && b) && a.dev === b.dev && a.ino === b.ino && a.mode === b.mode && a.nlink === b.nlink && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
}

function surfacePaths(surface, index, untrackedPaths) {
  const prefix = `${surface}/`;
  const tracked = [...index.keys()].filter((rel) => rel === surface || rel.startsWith(prefix)).sort();
  const untracked = untrackedPaths.filter((rel) => rel === surface || rel.startsWith(prefix)).sort();
  const trackedSet = new Set(tracked);
  return [...new Set([...tracked, ...untracked])].sort().map((rel) => ({
    rel,
    tracked: trackedSet.has(rel),
  }));
}

function formatOf(rel) {
  const name = basename(rel);
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return 'none';
  return name.slice(dot + 1).toLowerCase();
}

/** 只读文件开头；fd 身份在读取前后复核，短读继续补齐，避免把截断当完整头块。 */
/** Metadata remains a bounded projection, never an implicit full-worktree diff. */
export const METADATA_LIMITS = Object.freeze({ maxFiles: 2048, maxFileBytes: 16 * 1024 * 1024, maxTotalBytes: 64 * 1024 * 1024 });
const REGISTRY_BYTE_LIMIT = 1024 * 1024;
const HEADER_BYTE_LIMIT = 64 * 1024;
export function normalizeMetadataLimits(options = {}) {
  if (!plainObject(options) || Object.keys(options).some(key => !Object.hasOwn(METADATA_LIMITS, key))) throw new Error('元数据预算字段非法 [curia2/metadata-budget-invalid]');
  const limits = { ...METADATA_LIMITS, ...options }, caps = { maxFiles: 10000, maxFileBytes: LINK_SCAN_LIMIT, maxTotalBytes: 256 * 1024 * 1024 };
  for (const [key, value] of Object.entries(limits)) if (!Number.isSafeInteger(value) || value < 1 || value > caps[key]) throw new Error('元数据预算超过支持范围 [curia2/metadata-budget-invalid]');
  return limits;
}

function rawWorktreeRevision(entry, stat, bytes = null, reason = 'metadata-not-read') {
  const completeBytes = bytes !== null && bytes.length === stat.size;
  const mode = stat.mode & 0o100 ? '100755' : '100644';
  const algorithm = entry ? entry.oid.length === 64 ? 'sha256' : 'sha1' : null;
  const blobOid = completeBytes && algorithm ? createHash(algorithm).update(`blob ${bytes.length}\0`).update(bytes).digest('hex') : null;
  const matchesIndex = entry ? mode !== entry.mode ? false : completeBytes ? blobOid === entry.oid : null : null;
  return {
    schema: 'curia.raw-worktree-revision/1', basis: 'raw-bytes-and-owner-execute-bit/1', normalization: 'none-not-git-status-equivalence',
    state: !entry ? 'untracked' : completeBytes ? 'compared' : mode !== entry.mode ? 'mode-different' : 'unknown',
    matchesIndex, completeBytes, observedAt: completeBytes ? new Date().toISOString() : null,
    digest: completeBytes ? digestBytes(bytes) : null, blob: blobOid ? { algorithm, oid: blobOid, mode } : null,
    reason: completeBytes ? null : reason,
  };
}

function unknownWorktreeRevision(reason) {
  return { schema: 'curia.raw-worktree-revision/1', basis: 'raw-bytes-and-owner-execute-bit/1', normalization: 'none-not-git-status-equivalence', state: 'unknown', matchesIndex: null, completeBytes: false, observedAt: null, digest: null, blob: null, reason };
}

function parseMetadataBytes(bytes, stat, json = false) {
  if (!bytes) return { lines: [], text: null, truncated: false, encodingState: 'unread' };
  const cap = json ? JSON_NATIVE_LIMITS.maxBytes : HEADER_BYTE_LIMIT;
  const prefix = bytes.subarray(0, cap), truncated = stat.size > prefix.length;
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: json }).decode(prefix, { stream: truncated });
    return { lines: json ? [] : normalizeLines(text), text: json ? text : null, truncated, encodingState: text.includes('\0') ? 'binary' : 'valid' };
  } catch { return { lines: [], text: null, truncated, encodingState: 'invalid' }; }
}

function readMetadataBytes(root, path, stat, cap, state) {
  state.requested++;
  const desired = Math.min(stat.size, cap), allowance = Math.min(desired, state.limits.maxFileBytes, state.limits.maxTotalBytes - state.chargedBytes);
  if (state.openedFiles >= state.limits.maxFiles || (desired > 0 && allowance === 0)) { state.budgetLimited++; return { bytes: null, budgetLimited: true }; }
  const budgetLimited = allowance < desired;
  if (budgetLimited) state.budgetLimited++;
  state.openedFiles++;
  // Charge before opening, including failed reads; the descriptor cannot read outside this allowance.
  state.chargedBytes += allowance;
  const bytes = readStableFile(join(root, path), stat, allowance - 1);
  if (bytes.length !== allowance) throw new Error('元数据来源在读取期间变短');
  return { bytes, budgetLimited };
}

function fieldConsensus(header, key) {
  const values = header.fields.filter((f) => f.key === key).map((f) => f.value);
  if (!values.length) return { value: null, conflict: false, present: false };
  return { value: values[0], conflict: values.length > 1, present: true };
}

function markHeaderTruncated(env) {
  env.metadataRead = 'header-partial';
  env.gaps.push('header-truncated');
}

function aggregateFinding(findings, code, severity, path, detail) {
  const found = findings.find((f) => f.code === code && f.severity === severity);
  if (found) {
    found.count += 1;
    if (found.samples.length < 20) found.samples.push(path);
    return;
  }
  findings.push({ code, severity, count: 1, samples: [path], detail });
}

function inferRole(surface, type, rel, fallback, typeSource = null) {
  if (['evidence', 'postmortem', 'frozen'].includes(type)) return 'record';
  if (surface === '.agents' && (rel.startsWith('.agents/archive/') || rel.startsWith('.agents/notes/archived/'))) return 'record';
  if (surface === 'docs' && rel.startsWith('docs/records/')) return 'record';
  if (surface === '.agents' && (type === 'control-original' || type === 'unknown' || ['unknown', 'declared-unregistered', 'header-conflict'].includes(typeSource))) return 'unknown';
  return fallback;
}

function indexMatchesHeadEntry(indexEntry, headEntry) {
  return Boolean(indexEntry && headEntry && indexEntry.oid === headEntry.oid && indexEntry.mode === headEntry.mode);
}

function baseEnvelope({ rel, surface, role, tracked, worktreeModified = null, indexMatchesHead = null, format, indexEntry = null, headEntry = null }) {
  return {
    identity: { surface, path: rel },
    role,
    type: null,
    typeSource: null,
    owner: null,
    ownerSource: 'unknown',
    status: null,
    statusSource: null,
    maintenance: null,
    format,
    tracked,
    worktreeModified,
    git: {
      contentIdsWithheld: false,
      indexMode: indexEntry?.mode ?? null,
      indexOid: indexEntry?.oid ?? null,
      indexStage: indexEntry?.stage ?? null,
      indexMatchesHead,
      headMode: headEntry?.mode ?? null,
      headOid: headEntry?.oid ?? null,
    },
    metadataRead: format === 'md' ? 'header' : 'not-parsed',
    access: { mode: 'local-single-reader', authority: 'local-instance' },
    gaps: [],
  };
}

// A declared projection keeps its identity regardless of its surface or header contents.
// Classification alone does not check whether its bytes match the Registry.
function classifyRegistryProjection(reg, rel, env) {
  if (rel !== reg.projection) return false;
  env.type = 'projection';
  env.typeSource = 'path';
  env.status = 'unknown';
  env.statusSource = 'unknown';
  env.maintenance = 'generated';
  env.metadataRead = 'not-parsed';
  env.gaps.push('owner-unknown', 'status-unknown', 'content-unparsed');
  return true;
}

function classifyControlEnvelope(root, reg, rel, format, env, stat, parse = parseHeader, headerInput = null) {
  if (rel === '.agents/doc-types.json') {
    env.metadataRead = 'json';
    env.type = 'registry';
    env.typeSource = 'path';
    env.status = 'current';
    env.statusSource = 'registry-authority';
    env.maintenance = 'current-revisable';
    env.gaps.push('owner-unknown');
    return;
  }
  if (classifyRegistryProjection(reg, rel, env)) return;
  if (rel.startsWith('.agents/templates/')) {
    env.type = 'template';
    env.typeSource = 'path';
    env.status = 'unknown';
    env.statusSource = 'unknown';
    env.maintenance = 'current-revisable';
    env.metadataRead = 'not-parsed';
    env.gaps.push('owner-unknown', 'status-unknown', 'content-unparsed');
    return;
  }
  if (format !== 'md') {
    env.type = 'control-original';
    env.typeSource = 'format-default';
    env.status = 'unknown';
    env.statusSource = 'unknown';
    env.maintenance = 'unknown';
    env.gaps.push('owner-unknown', 'status-unknown', 'content-unparsed');
    return;
  }
  const { lines, truncated, encodingState } = headerInput ?? parseMetadataBytes(null, stat);
  const profileByLocation = classifyDoc(rel, reg, null);
  if (encodingState !== 'valid') {
    env.type = profileByLocation.type ?? 'unknown';
    env.typeSource = profileByLocation.type ? 'registry-location' : 'unknown';
    env.metadataRead = 'not-parsed';
    if (profileByLocation.type && !reg.types[profileByLocation.type]?.statuses?.length) {
      env.status = 'not-applicable';
      env.statusSource = 'registry-profile';
      env.maintenance = 'current-revisable';
    } else {
      env.status = 'unknown';
      env.statusSource = 'unknown';
      env.maintenance = 'unknown';
      env.gaps.push('status-unknown');
    }
    env.gaps.push('header-invalid', 'owner-unknown', 'content-unparsed');
    if (!profileByLocation.type) env.gaps.push('type-unknown');
    return;
  }
  if (lines[0]?.trim() === '---') {
    env.type = profileByLocation.type ?? 'unknown';
    env.typeSource = profileByLocation.type ? 'registry-location' : 'unknown';
    env.metadataRead = 'not-parsed';
    const frontmatterProfile = profileByLocation.type ? reg.types[profileByLocation.type] : null;
    if (!frontmatterProfile?.statuses?.length) {
      env.status = 'not-applicable';
      env.statusSource = 'registry-profile';
    } else {
      env.status = 'unknown';
      env.statusSource = 'unknown';
      env.gaps.push('status-unknown');
    }
    env.maintenance = frontmatterProfile?.statuses?.length ? 'unknown' : 'current-revisable';
    env.gaps.push('owner-unknown', 'content-unparsed');
    if (!profileByLocation.type) env.gaps.push('type-unknown');
    return;
  }
  const header = parse(lines);
  if (!header.titleOk) {
    env.gaps.push('header-invalid');
    if (!header.fields.length) {
      env.type = profileByLocation.type ?? 'unknown';
      env.typeSource = profileByLocation.type ? 'registry-location' : 'unknown';
      env.metadataRead = 'not-parsed';
      env.status = 'unknown';
      env.statusSource = 'unknown';
      env.maintenance = 'unknown';
      env.gaps.push('owner-unknown', 'status-unknown', 'content-unparsed');
      if (!profileByLocation.type) env.gaps.push('type-unknown');
      return;
    }
    env.metadataRead = 'header-partial';
  }
  const typeField = fieldConsensus(header, 'Type');
  const declaredValues = header.fields.filter((field) => field.key === 'Type').map((field) => field.value);
  const classified = classifyDoc(rel, reg, header);
  const locationAuthority = classified?.via === 'location';
  if (locationAuthority && declaredValues.some((value) => value !== classified.type)) {
    env.gaps.push('type-source-conflict');
  }
  if (typeField.conflict) {
    env.gaps.push('type-conflict');
    if (!locationAuthority) env.gaps.push('type-unknown');
  }
  if (locationAuthority) {
    env.type = classified.type;
    env.typeSource = 'registry-location';
  } else if (typeField.conflict) {
    env.type = 'unknown';
    env.typeSource = 'header-conflict';
  } else if (classified.type) {
    env.type = classified.type;
    env.typeSource = classified.via === 'location' ? 'registry-location' : 'header';
  } else {
    env.type = 'unknown';
    env.typeSource = declaredValues[0] ? 'declared-unregistered' : (typeField.present ? 'header-invalid' : 'unknown');
    env.gaps.push('type-unknown');
  }
  const ownerField = fieldConsensus(header, 'Owner');
  env.owner = ownerField.conflict ? null : ownerField.value;
  env.ownerSource = ownerField.conflict ? 'header-conflict' : ownerField.value ? 'header' : 'unknown';
  const profile = env.type !== 'unknown' ? reg.types[env.type] : null;
  const statusField = fieldConsensus(header, 'Status');
  if (statusField.conflict) {
    env.status = 'unknown';
    env.statusSource = 'header-conflict';
    env.gaps.push('status-unknown', 'status-conflict');
  } else {
    env.status = statusField.value;
    if (statusField.present && statusField.value) env.statusSource = 'header';
    else if (statusField.present) env.statusSource = 'header-invalid';
    else if (profile && !profile.statuses?.length) {
      env.status = 'not-applicable';
      env.statusSource = 'registry-profile';
    } else {
      env.status = 'unknown';
      env.statusSource = 'unknown';
    }
    if (env.statusSource === 'unknown') env.gaps.push('status-unknown');
    if (env.statusSource === 'header-invalid') env.gaps.push('status-unknown', 'status-invalid');
    if (env.statusSource === 'header' && profile?.header === 'none') env.gaps.push('status-unexpected');
    if (env.statusSource === 'header' && profile?.statuses?.length) {
      const statusBase = env.status.split(/\s+[—-]\s+/)[0];
      if (!profile.statuses.includes(statusBase)) {
        env.status = 'unknown';
        env.statusSource = 'header-invalid';
        env.gaps.push('status-unknown', 'status-invalid');
      }
    }
  }
  const statusBase = env.status === 'unknown' ? 'unknown' : env.status.split(/\s+[—-]\s+/)[0];
  env.maintenance = ['done', 'superseded', 'historical'].includes(statusBase)
    ? 'historical-preserved'
    : (env.status && env.status !== 'unknown' ? 'process-evolving' : 'unknown');
  if (!env.owner) env.gaps.push('owner-unknown');
  if (ownerField.conflict) env.gaps.push('owner-conflict');
  if (truncated && header.headerEnd >= lines.length - 1) markHeaderTruncated(env);
}

function classifyKnowledgeEnvelope(root, reg, rel, format, env, stat, parse = parseHeader, headerInput = null) {
  if (classifyRegistryProjection(reg, rel, env)) return;
  const isRecord = rel.startsWith('docs/records/');
  if (isRecord) env.role = 'record';
  if (format !== 'md') {
    env.type = isRecord ? 'record-original' : 'knowledge-original';
    env.typeSource = 'format-default';
    env.status = 'unknown';
    env.statusSource = 'unknown';
    env.maintenance = isRecord ? 'record-mechanism-unknown' : 'unknown';
    env.gaps.push('owner-unknown', 'status-unknown', 'content-unparsed');
    if (isRecord) env.gaps.push('record-mutation-unknown');
    return;
  }
  const { lines, truncated, encodingState } = headerInput ?? parseMetadataBytes(null, stat);
  if (encodingState !== 'valid') {
    env.type = 'unknown';
    env.typeSource = 'unknown';
    env.metadataRead = 'not-parsed';
    env.status = 'unknown';
    env.statusSource = 'unknown';
    env.maintenance = 'unknown';
    env.gaps.push('header-invalid', 'owner-unknown', 'status-unknown', 'type-unknown', 'content-unparsed');
    if (isRecord) env.gaps.push('record-mutation-unknown');
    return;
  }
  if (lines[0]?.trim() === '---') {
    env.type = isRecord ? 'record-direct' : 'knowledge-direct';
    env.typeSource = 'surface-default';
    env.metadataRead = 'not-parsed';
    env.status = 'unknown';
    env.statusSource = 'unknown';
    env.maintenance = isRecord ? 'record-mechanism-unknown' : 'unknown';
    env.gaps.push('owner-unknown', 'status-unknown', 'content-unparsed');
    if (isRecord) env.gaps.push('record-mutation-unknown');
    return;
  }
  const header = parse(lines);
  if (!header.titleOk) {
    env.gaps.push('header-invalid');
    if (!header.fields.length) {
      env.type = 'unknown';
      env.typeSource = 'unknown';
      env.metadataRead = 'not-parsed';
      env.status = 'unknown';
      env.statusSource = 'unknown';
      env.maintenance = 'unknown';
      env.gaps.push('owner-unknown', 'status-unknown', 'type-unknown', 'content-unparsed');
      if (isRecord) env.gaps.push('record-mutation-unknown');
      return;
    }
    env.metadataRead = 'header-partial';
  }
  const typeField = fieldConsensus(header, 'Type');
  const declared = typeField.value;
  if (typeField.conflict) {
    env.type = 'unknown';
    env.typeSource = 'header-conflict';
    env.gaps.push('type-unknown', 'type-conflict');
  } else if (declared && reg.types[declared]) {
    env.type = declared;
    env.typeSource = 'header';
  } else if (declared) {
    env.type = 'unknown';
    env.typeSource = 'declared-unregistered';
    env.gaps.push('type-unknown');
  } else if (typeField.present) {
    env.type = 'unknown';
    env.typeSource = 'header-invalid';
    env.gaps.push('type-unknown');
  } else {
    env.type = isRecord ? 'record-direct' : 'knowledge-direct';
    env.typeSource = 'surface-default';
  }
  const ownerField = fieldConsensus(header, 'Owner');
  env.owner = ownerField.conflict ? null : ownerField.value;
  env.ownerSource = ownerField.conflict ? 'header-conflict' : ownerField.value ? 'header' : 'unknown';
  const statusField = fieldConsensus(header, 'Status');
  const declaredProfile = env.type && Object.prototype.hasOwnProperty.call(reg.types, env.type) ? reg.types[env.type] : null;
  const directStatuses = ['current', 'historical', 'superseded', 'done'];
  const statusAuthorityKnown = Boolean(declaredProfile) || !typeField.present;
  if (statusField.conflict) {
    env.status = 'unknown';
    env.statusSource = 'header-conflict';
    env.gaps.push('status-unknown', 'status-conflict');
  } else {
    if (statusField.present) {
      env.status = statusField.value;
      env.statusSource = statusField.value ? 'header' : 'header-invalid';
    } else if (declaredProfile && !declaredProfile.statuses?.length) {
      env.status = 'not-applicable';
      env.statusSource = 'registry-profile';
    } else if (!typeField.present && header.titleOk && !(truncated && header.headerEnd >= lines.length - 1)) {
      // Only direct knowledge without a declared lifecycle gets the surface default.
      env.status = 'current';
      env.statusSource = 'surface-default';
    } else {
      env.status = 'unknown';
      env.statusSource = 'unknown';
      env.gaps.push('status-unknown');
    }
    if (env.statusSource === 'header' && declaredProfile?.header === 'none') env.gaps.push('status-unexpected');
    if (env.statusSource === 'header' && declaredProfile?.statuses?.length) {
      const statusBase = env.status.split(/\s+[—-]\s+/)[0];
      if (!declaredProfile.statuses.includes(statusBase)) {
        env.status = 'unknown';
        env.statusSource = 'header-invalid';
        env.gaps.push('status-unknown', 'status-invalid');
      }
    } else if (env.statusSource === 'header-invalid' || (env.statusSource === 'header' && !declaredProfile && !declared && !directStatuses.includes(env.status.split(/\s+[—-]\s+/)[0]))) {
      env.status = 'unknown';
      env.statusSource = 'header-invalid';
      env.gaps.push('status-unknown', 'status-invalid');
    }
  }
  const statusBase = env.status === 'unknown' ? 'unknown' : env.status.split(/\s+[—-]\s+/)[0];
  env.maintenance = !statusAuthorityKnown || isRecord || ['done', 'superseded', 'historical'].includes(statusBase)
    ? (isRecord ? 'record-mechanism-unknown' : (!statusAuthorityKnown || statusBase === 'unknown' ? 'unknown' : 'historical-preserved'))
    : (env.status && env.status !== 'unknown' ? 'current-revisable' : 'unknown');
  if (!env.owner) env.gaps.push('owner-unknown');
  if (ownerField.conflict) env.gaps.push('owner-conflict');
  if (isRecord) env.gaps.push('record-mutation-unknown');
  if (truncated && header.headerEnd >= lines.length - 1) markHeaderTruncated(env);
}

function emptyLinkCoverageState(state, reason = null) {
  return {
    state,
    reason,
    parser: null,
    scannedLines: 0,
    truncated: false,
    links: 0,
    relativeLinks: 0,
    excludedLinks: 0,
    unsupportedSyntax: 0,
    targetStates: {},
    gaps: [],
  };
}

function addLinkTargetState(link, state) {
  link.targetStates[state] = (link.targetStates[state] ?? 0) + 1;
}

function summarizeLinks(envelopes, enabled, available) {
  const rows = enabled ? envelopes.map((e) => e.linkCoverage).filter(Boolean) : [];
  const sum = (key) => rows.reduce((n, row) => n + row[key], 0);
  return {
    enabled,
    mode: !available ? 'not-applicable-no-git' : enabled ? 'markdown-relative-reachability' : 'not-enabled',
    parser: enabled && available ? LINK_PARSER : null,
    filesChecked: rows.filter((e) => e.state.startsWith('checked')).length,
    filesCheckedFully: rows.filter((e) => e.state === 'checked').length,
    filesCheckedPartial: rows.filter((e) => e.state === 'checked-partial').length,
    filesNotCovered: rows.filter((e) => !e.state.startsWith('checked') && e.state !== 'exempt').length,
    filesExempt: rows.filter((e) => e.state === 'exempt').length,
    links: sum('links'), excludedLinks: sum('excludedLinks'), unsupportedSyntax: sum('unsupportedSyntax'), relativeLinks: sum('relativeLinks'),
    targetStates: rows.reduce((acc, row) => {
      for (const [state, count] of Object.entries(row.targetStates)) acc[state] = (acc[state] ?? 0) + count;
      return acc;
    }, Object.create(null)),
  };
}

/** 只识别完整的基础内联候选；复杂、跨行或未闭合语法不猜测目标。 */
function scanLinkCandidates(line) {
  const candidates = [];
  const inlineRanges = [];
  for (let i = 0; i < line.length; i++) {
    if (line[i] !== '[') continue;
    const start = i;
    let depth = 1;
    let complex = false;
    for (i++; i < line.length && depth; i++) {
      if (line[i] === '\\') { complex = true; i++; continue; }
      if (line[i] === '[') { depth++; complex = true; }
      if (line[i] === ']') depth--;
    }
    if (depth) { candidates.push({ unsupported: true }); break; }
    if (line[i] !== '(') {
      if (line[i] === '[' || (line[i] === ':' && !line.slice(0, start).trim())) candidates.push({ unsupported: true });
      i--;
      continue;
    }
    const destStart = ++i;
    let angle = false;
    depth = 1;
    for (; i < line.length && depth; i++) {
      const ch = line[i];
      if (ch === '\\') { complex = true; i++; continue; }
      if (ch === '<' && i === destStart) angle = true;
      else if (ch === '>' && angle) angle = false;
      else if (!angle && ch === '(') { depth++; complex = true; }
      else if (!angle && ch === ')') depth--;
    }
    let target = line.slice(destStart, i - 1).trim();
    if (/^<[^<>]*>$/.test(target)) target = target.slice(1, -1);
    else if (/\s|[<>]/.test(target)) complex = true;
    if (line.slice(start, i).includes('\0')) complex = true;
    const external = LINK_SCHEME_RE.test(target) || target.startsWith('//');
    if (!external && target.split('#')[0].includes('?')) complex = true;
    let backslashes = 0;
    for (let j = start - 1; j >= 0 && line[j] === '\\'; j--) backslashes++;
    inlineRanges.push([start, i]);
    candidates.push({ target, unsupported: complex || Boolean(depth) || angle, excluded: backslashes % 2 === 1 });
    i--;
  }
  // HTML 和 autolink 只声明未支持，不发起请求，也不把坐标当作本地文件。
  let rangeIndex = 0;
  for (const match of line.matchAll(/<[^<>\r\n]+>/g)) {
    while (inlineRanges[rangeIndex]?.[1] <= match.index) rangeIndex++;
    if (inlineRanges[rangeIndex] && match.index >= inlineRanges[rangeIndex][0]) continue;
    if (/^<(?:a|img|link)\b[^>]*\b(?:href|src)\s*=/i.test(match[0]) || /^<(?:[a-z][a-z0-9+.-]*:|[^<>\s@]+@)[^>]*>$/i.test(match[0])) candidates.push({ unsupported: true });
  }
  return candidates;
}

/** 排除区保守计数；未配对的行内反引号也不作为可信链接正文。 */
function maskLinkLine(line, state) {
  const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
  if (state.fence) {
    if (fence && fence[1][0] === state.fence[0] && fence[1].length >= state.fence.length && !fence[2].trim()) state.fence = null;
    return { visible: '', excluded: scanLinkCandidates(line).length };
  }
  if (!state.comment && !state.inline && fence) {
    state.fence = fence[1];
    return { visible: '', excluded: scanLinkCandidates(line).length };
  }
  if (/^(?: {4}|\t|\s*>)/.test(line)) return { visible: '', excluded: scanLinkCandidates(line).length };
  const visible = [];
  const hidden = [];
  for (let i = 0; i < line.length;) {
    if (!state.inline && !state.comment && line.startsWith('<!--', i)) state.comment = true;
    if (state.comment) {
      const end = line.indexOf('-->', i);
      const next = end === -1 ? line.length : end + 3;
      hidden.push(line.slice(i, next)); visible.push('\0'.repeat(next - i)); i = next;
      if (end !== -1) state.comment = false;
      continue;
    }
    if (line[i] === '`') {
      let next = i + 1;
      while (line[next] === '`') next++;
      const width = next - i;
      if (!state.inline) state.inline = width;
      else if (state.inline === width) state.inline = 0;
      hidden.push(line.slice(i, next)); visible.push('\0'.repeat(width)); i = next;
      continue;
    }
    const boundaries = [line.indexOf('`', i), state.inline ? -1 : line.indexOf('<!--', i)].filter((pos) => pos >= 0);
    const next = boundaries.length ? Math.min(...boundaries) : line.length;
    const text = line.slice(i, next);
    visible.push(state.inline ? '\0'.repeat(next - i) : text);
    hidden.push(state.inline ? text : ' '.repeat(next - i));
    i = next;
  }
  return { visible: visible.join(''), excluded: scanLinkCandidates(hidden.join('')).length };
}

/** 先逐级检查，再处理 ..；不能用 resolve 提前折叠 symlink/../ 或嵌套仓库边界。 */
function linkTargetState({ root, sourceRel, target, index, untrackedPaths, includeUntracked }) {
  const pathPart = target.split('#')[0];
  if (!pathPart) return 'anchor-unverified';
  let decoded;
  try { decoded = decodeURIComponent(pathPart); } catch { return 'target-invalid'; }
  if (/[\u0000-\u001f\u007f]/.test(decoded)) return 'target-invalid';
  if (isAbsolute(decoded)) return 'target-outside-instance';
  let current = root;
  let stat;
  const visited = [];
  try {
    const rootDevice = lstatSync(root).dev;
    const parts = [...dirname(sourceRel).split('/'), ...decoded.split(sep)];
    for (const part of parts) {
      if (stat && !stat.isDirectory()) return 'target-invalid';
      current = resolve(current, part);
      if (!within(root, current)) return 'target-outside-instance';
      const rel = relative(root, current).split(sep).join('/');
      if (rel.split('/').includes('.git')) return 'target-nested-repository';
      const entries = index.get(rel) ?? [];
      if (entries.length > 1 || entries.some((entry) => entry.stage !== 0)) return 'target-index-conflict';
      if (entries[0]?.mode === '120000') return 'target-symlink';
      if (entries[0]?.mode === '160000') return 'target-nested-repository';
      stat = lstatSync(current);
      if (stat.isSymbolicLink()) return 'target-symlink';
      if (!stat.isFile() && !stat.isDirectory()) return 'target-invalid';
      if (stat.dev !== rootDevice) return 'target-outside-instance';
      if (realpathSync(current) !== current) return 'target-symlink';
      if (stat.isFile() && stat.nlink !== 1) return 'target-invalid';
      if (stat.isDirectory()) {
        if (entries.length) return 'target-invalid';
        if (current !== root) {
          try { lstatSync(join(current, '.git')); return 'target-nested-repository'; }
          catch (e) { if (e.code !== 'ENOENT') return 'target-boundary-unknown'; }
        }
      }
      visited.push([current, stat]);
    }
    for (const [path, before] of visited) if (!sameStat(before, lstatSync(path))) return 'target-boundary-unknown';
  } catch (e) {
    if (e.code === 'ENOENT') return 'target-missing';
    if (e.code === 'ENOTDIR' || e.code === 'ENAMETOOLONG') return 'target-invalid';
    return 'target-boundary-unknown';
  }
  const relTarget = relative(root, current).split(sep).join('/');
  if (stat.isDirectory()) {
    const prefix = relTarget ? `${relTarget}/` : '';
    if ([...index.keys()].some((path) => path.startsWith(prefix)) || (includeUntracked && untrackedPaths.some((path) => path.startsWith(prefix)))) return 'reachable-directory';
  } else {
    if (index.has(relTarget)) return 'reachable-tracked';
    if (includeUntracked && untrackedPaths.includes(relTarget)) return 'reachable-untracked';
  }
  return includeUntracked ? 'reachable-worktree-other' : 'reachable-worktree-untracked';
}

function applyLinkCoverage({ root, reg, index, untrackedPaths, includeUntracked, env, stat, buffer = null, excluded = null }) {
  if (reg.rawMarker && isRawExempt(root, reg, env.identity.path)) {
    env.linkCoverage = emptyLinkCoverageState('exempt', 'raw-corpus');
    return;
  }
  if (excluded) { env.linkCoverage = emptyLinkCoverageState('exempt', excluded); return; }
  if (env.format !== 'md') {
    env.linkCoverage = emptyLinkCoverageState('not-covered', 'parser-unavailable');
    env.linkCoverage.gaps.push('link-coverage-unparsed');
    return;
  }
  const link = emptyLinkCoverageState('checked');
  link.parser = LINK_PARSER;
  env.linkCoverage = link;
  if (buffer === null) {
    env.linkCoverage = emptyLinkCoverageState('not-covered', 'metadata-byte-observation-unavailable');
    env.linkCoverage.gaps.push('link-coverage-unparsed');
    return;
  }
  link.truncated = buffer.length < stat.size;
  if (link.truncated) {
    link.state = 'checked-partial'; link.reason = buffer.length >= LINK_SCAN_LIMIT ? 'size-limit' : 'read-budget-limit'; link.gaps.push('link-read-truncated');
  }
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, Math.min(buffer.length, LINK_SCAN_LIMIT)), { stream: link.truncated });
  } catch {
    env.linkCoverage = emptyLinkCoverageState('not-covered', 'invalid-utf8');
    env.linkCoverage.gaps.push('link-coverage-unparsed');
    return;
  }
  if (text.includes('\0')) {
    env.linkCoverage = emptyLinkCoverageState('not-covered', 'binary-nul');
    env.linkCoverage.gaps.push('link-coverage-unparsed');
    return;
  }
  if (link.truncated) text = text.slice(0, text.lastIndexOf('\n') + 1);
  const lines = normalizeLines(text);
  if (lines[0]?.trim() === '---') {
    env.linkCoverage = emptyLinkCoverageState('not-covered', 'frontmatter-parser-unavailable');
    env.linkCoverage.gaps.push('link-coverage-unparsed');
    return;
  }
  const mask = { fence: null, comment: false, inline: 0 };
  link.scannedLines = lines.length;
  for (const line of lines) {
    const { visible, excluded } = maskLinkLine(line, mask);
    link.excludedLinks += excluded;
    for (const candidate of scanLinkCandidates(visible)) {
      if (candidate.excluded) { link.excludedLinks++; continue; }
      if (candidate.unsupported) { link.unsupportedSyntax++; continue; }
      const { target } = candidate;
      link.links++;
      if (!target || target.startsWith('#')) {
        addLinkTargetState(link, 'anchor-unverified');
        continue;
      }
      if (LINK_SCHEME_RE.test(target) || target.startsWith('//')) {
        addLinkTargetState(link, 'external-unverified');
        continue;
      }
      link.relativeLinks++;
      addLinkTargetState(link, linkTargetState({ root, sourceRel: env.identity.path, target, index, untrackedPaths, includeUntracked }));
    }
  }
  if (!link.truncated && (link.excludedLinks || link.unsupportedSyntax)) {
    link.state = 'checked-partial';
    link.reason = 'parser-scope';
  }
  const invalidStates = ['target-missing', 'target-outside-instance', 'target-symlink', 'target-nested-repository', 'target-index-conflict', 'target-invalid', 'target-boundary-unknown'];
  if (invalidStates.some((state) => link.targetStates[state])) link.gaps.push('link-target-missing');
  if (link.excludedLinks) link.gaps.push('link-coverage-excluded-zone');
  if (link.unsupportedSyntax) link.gaps.push('link-syntax-uncovered');
}

/** Explicit selection is authorization for local reads, not a cross-user access policy. */
export function normalizeReadSelection(value) {
  if (!plainObject(value) || Object.keys(value).some((key) => !['paths', 'exclusions', 'corpus'].includes(key))) throw new Error('阅读选集含未支持字段 [curia2/read-selection-invalid]');
  const { paths = [], exclusions = [], corpus = false } = value;
  if (typeof corpus !== 'boolean') throw new Error('corpus 必须为布尔值 [curia2/read-selection-invalid]');
  for (const items of [paths, exclusions]) {
    if (!Array.isArray(items) || items.some((path) => typeof path !== 'string' || !path || /[\\:*?\[\]{}\u0000-\u001f\u007f]/u.test(path) || path.split('/').some((part) => !part || ['.', '..', '.git'].includes(part.toLowerCase()) || part !== part.trim())) || new Set(items.map((path) => path.normalize('NFC').toLowerCase())).size !== items.length) throw new Error('选集必须是无重复或等价别名的规范仓内相对路径，不接受通配 [curia2/read-selection-invalid]');
  }
  if (corpus === Boolean(paths.length)) throw new Error('显式 paths 与 corpus 必须且只能选择一个 [curia2/read-selection-invalid]');
  return { paths: [...paths].sort(), exclusions: [...exclusions].sort(), corpus };
}

const selectedPath = (path, rel) => rel === path || rel.startsWith(`${path}/`);
const digestBytes = (bytes) => ({ algorithm: 'sha256', canonicalization: 'raw-bytes/1', value: createHash('sha256').update(bytes).digest('hex') });

export { privateReadPath } from './doc-lib.mjs';

export const READ_LIMITS = Object.freeze({ maxFiles: 32, maxFileBytes: 64 * 1024, maxTotalBytes: 512 * 1024 });
export function normalizeReadLimits(options = {}) {
  if (!plainObject(options) || Object.keys(options).some((key) => !Object.hasOwn(READ_LIMITS, key))) throw new Error('阅读预算含未支持字段 [curia2/read-budget-invalid]');
  const limits = { ...READ_LIMITS, ...options };
  const caps = { maxFiles: 10000, maxFileBytes: 4 * 1024 * 1024, maxTotalBytes: 16 * 1024 * 1024 };
  for (const [key, value] of Object.entries(limits)) if (!Number.isSafeInteger(value) || value < 1 || value > caps[key]) throw new Error(`阅读预算 ${key} 必须为 1..${caps[key]} 的整数 [curia2/read-budget-invalid]`);
  return limits;
}

function checkReadSnapshot(snapshot, paths = []) {
  const { root, rootStat, registryStat, index, mounts } = snapshot;
  const instance = resolveInstance(root);
  const currentRoot = lstatSync(instance.root);
  if (currentRoot.dev !== rootStat.dev || currentRoot.ino !== rootStat.ino) throw new Error('instance root 身份变化');
  ensureRegistryBoundary(root, index.get(REGISTRY_REL));
  if (!sameStat(registryStat, lstatSync(join(root, REGISTRY_REL)))) throw new Error('Registry 在盘点后变化');
  const currentHead = gitHead(root);
  if (currentHead.state === 'unknown' || currentHead.head !== snapshot.head) throw new Error('Git HEAD 在盘点后变化或无法确认');
  if (indexFingerprint(gitIndexRecords(root)) !== snapshot.indexFingerprintBefore) throw new Error('Git index 在盘点后变化');
  if (JSON.stringify(instanceMounts(root)) !== JSON.stringify(mounts)) throw new Error('挂载表在盘点后变化');
  if (snapshot.input.includeUntracked) {
    const untracked = [...new Set(gitOutput(root, ['ls-files', '--others', '--exclude-standard', '-z', '--', ...snapshot.gitPaths]).split('\0').filter(Boolean))].sort();
    if (JSON.stringify(untracked) !== JSON.stringify(snapshot.untrackedPathsBefore)) throw new Error('未忽略 untracked 集合在盘点后变化');
  }
  if (snapshot.sourcePaths && JSON.stringify(ignoredSourcePaths(root, snapshot.sourcePaths)) !== JSON.stringify(snapshot.ignoredPathsBefore)) throw new Error('来源的忽略状态在盘点后变化');
  for (const [path, before] of snapshot.extraBoundaries ?? []) if (!sameStat(before, checkInstancePath(root, path, 'directory', index, rootStat, mounts))) throw new Error('任务目录身份变化');
  for (const [path, absent] of snapshot.impact?.missing ?? []) {
    if (!sameStat(absent.stat, checkInstancePath(root, absent.parent, 'directory', index, rootStat, mounts))) throw new Error('已声明缺失对象的父目录变化');
    let missing = false;
    try { lstatSync(join(root, path)); } catch (error) { if (error.code !== 'ENOENT') throw error; missing = true; }
    if (!missing) throw new Error('已声明缺失对象重新出现');
  }
  for (const path of paths) {
    const current = checkInstancePath(root, path, 'file', index, rootStat, mounts);
    if (!sameStat(current, snapshot.objects.get(path).stat)) throw new Error('选中原件在盘点后变化');
    if (snapshot.reg.rawMarker && isRawExempt(root, snapshot.reg, path)) throw new Error('选中原件变为原始语料排除区');
  }
}

/** Recheck a live inventory when composing read-only phases; serialized reports are not capabilities. */
export function revalidateReadInventory(inventory) {
  const snapshot = readSnapshots.get(inventory);
  if (!snapshot?.input.selection) throw new Error('复核需要本进程只读盘点 [curia2/read-snapshot-required]');
  try {
    const paths = [...snapshot.objects.keys()];
    checkReadSnapshot(snapshot, paths);
    if (snapshot.impact && JSON.stringify(ignoredSourcePaths(snapshot.root, paths.sort())) !== JSON.stringify(snapshot.impact.ignored)) return false;
    return true;
  } catch { return false; }
}

/** Git supplies tree/index metadata only. Raw working bytes are observed by the same stable-fd reader. */
export const GIT_CHANGE_LIMITS = Object.freeze({ maxFiles: 256, maxFileBytes: 16 * 1024 * 1024, maxTotalBytes: 32 * 1024 * 1024 });
export function normalizeGitChangeLimits(options = {}) {
  if (!plainObject(options) || Object.keys(options).some(key => !Object.hasOwn(GIT_CHANGE_LIMITS, key))) throw new Error('Git 观察预算字段非法 [curia2/git-change-budget-invalid]');
  const limits = { ...GIT_CHANGE_LIMITS, ...options }, caps = { maxFiles: 2048, maxFileBytes: 512 * 1024 * 1024, maxTotalBytes: 1024 * 1024 * 1024 };
  for (const [key, value] of Object.entries(limits)) if (!Number.isSafeInteger(value) || value < 1 || value > caps[key]) throw new Error('Git 观察预算超过支持范围 [curia2/git-change-budget-invalid]');
  return limits;
}

export function normalizeGitChangeOptions(options = {}) {
  if (!plainObject(options) || Object.keys(options).some(key => !['base', 'within', 'exclusions', 'includeUntracked', 'nonSensitive', 'includeRegistry'].includes(key)) || options.nonSensitive !== true || (['includeUntracked', 'includeRegistry'].some(key => options[key] !== undefined && typeof options[key] !== 'boolean'))) throw new Error('Git 观察需要独立范围与非敏感声明 [curia2/git-change-options-invalid]');
  const selection = normalizeReadSelection({ paths: options.within, exclusions: options.exclusions ?? [] });
  const base = options.base;
  // Local ref names or full object IDs only: no revision expressions, paths, options or implicit fetch.
  if (typeof base !== 'string' || base.length > 256 || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(base) || base.includes('..') || base.includes('//') || base.endsWith('/') || base.endsWith('.') || base.split('/').some(part => part.startsWith('.') || part.endsWith('.lock'))) throw new Error('Git 基线必须为本地 commit 引用或完整 OID [curia2/git-change-base-invalid]');
  if (selection.paths.length > 128 || selection.exclusions.length > 128 || [...selection.paths, ...selection.exclusions].some(path => /[#%]/u.test(path) || Buffer.byteLength(path) > 4096) || selection.paths.some(path => (privateReadPath(path) && !(options.includeRegistry && path === REGISTRY_REL)) || selection.exclusions.some(prefix => selectedPath(prefix, path)))) throw new Error('Git 观察范围不可读取 [curia2/git-change-scope-invalid]');
  return { base, selection, includeUntracked: options.includeUntracked ?? false, includeRegistry: options.includeRegistry ?? false };
}

function gitChangeBase(root, ref) {
  let value;
  try {
    if (ref !== 'HEAD' && !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(ref) && !gitOutput(root, ['rev-parse', '--verify', '--symbolic-full-name', '--end-of-options', ref]).trim().startsWith('refs/')) throw new Error();
    value = gitOutput(root, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]).trim();
  }
  catch { throw new Error('本地 Git 基线不可确认 [curia2/git-change-base-unavailable]'); }
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value) || (/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(ref) && ref !== value)) throw new Error('Git 基线不可解析 [curia2/git-change-base-unavailable]');
  return value;
}

function gitChangeMissing(snapshot, path) {
  // A removed directory is allowed only through its nearest still-existing, safe ancestor.
  let parent = dirname(path);
  while (true) {
    try { return { parent, stat: checkInstancePath(snapshot.root, parent, 'directory', snapshot.index, snapshot.rootStat, snapshot.mounts) }; }
    catch (error) { if (error.code !== 'ENOENT' || parent === '.') throw error; parent = dirname(parent); }
  }
}

function checkGitChangeSnapshot(snapshot) {
  checkReadSnapshot(snapshot, [...snapshot.objects.keys()]);
  if (gitChangeBase(snapshot.root, snapshot.baseRef) !== snapshot.baseOid) throw new Error('Git 基线引用发生变化');
  if (gitOutput(snapshot.root, ['rev-parse', '--show-object-format=storage']).trim() !== snapshot.algorithm) throw new Error('Git 对象算法发生变化');
  for (const path of snapshot.activePaths) if (isRawExempt(snapshot.root, snapshot.reg, path)) throw new Error('Git 观察对象变为 raw 排除区');
  for (const path of snapshot.rawPaths) if (!isRawExempt(snapshot.root, snapshot.reg, path)) throw new Error('Git 观察排除区发生变化');
}

/** The public selection is informational; only the private capability can authorize observation. */
export function prepareGitChangeSelection(inputRoot = ROOT, options = {}) {
  const { base, selection, includeUntracked, includeRegistry } = normalizeGitChangeOptions(options);
  const instance = resolveInstance(inputRoot), root = instance.root, rootStat = lstatSync(root), mounts = instanceMounts(root), index = gitIndexRecords(root);
  checkInstancePath(root, REGISTRY_REL, 'file', index, rootStat, mounts);
  const registryState = loadInstanceRegistry(instance, index, { maxBytes: 1024 * 1024 }), reg = normalizeRegistry(registryState.registry);
  const layout = normalizeInstance(reg.instance, reg.types);
  const head = gitHead(root), baseOid = gitChangeBase(root, base), algorithm = gitOutput(root, ['rev-parse', '--show-object-format=storage']).trim();
  if (head.state === 'unknown' || !['sha1', 'sha256'].includes(algorithm) || baseOid.length !== (algorithm === 'sha1' ? 40 : 64)) throw new Error('Git 观察身份不可确认 [curia2/git-change-git-unavailable]');
  const gitPaths = selection.paths.map(path => `:(literal)${path}`), tree = gitHeadEntries(root, baseOid, gitPaths);
  if (!tree.available || tree.invalid) throw new Error('Git 基线 tree 不可确认 [curia2/git-change-tree-unavailable]');
  const untracked = includeUntracked ? [...new Set(gitOutput(root, ['ls-files', '--others', '--exclude-standard', '-z', '--', ...gitPaths]).split('\0').filter(Boolean))].sort() : [];
  const scoped = path => selection.paths.some(prefix => selectedPath(prefix, path));
  const names = [...new Set([...tree.entries.keys(), ...[...index.keys()].filter(scoped), ...untracked])].sort();
  const findings = [], omitted = { privacy: 0, ignored: 0, raw: 0 }, objects = [], activePaths = [];
  const gap = (code, path = null) => findings.push({ code: `git-change/${code}`, path });
  const snapshot = {
    root, rootStat, reg, registryStat: registryState.stat, index, mounts, head: head.head,
    indexFingerprintBefore: indexFingerprint(index), input: { includeUntracked, includeRegistry }, gitPaths, untrackedPathsBefore: untracked,
    baseRef: base, baseOid, algorithm, objects: new Map(), impact: { missing: new Map() }, activePaths, rawPaths: [], guardImplicitOmissions: 0,
  };
  // Bound discovery before any body opens; a huge path list is never treated as a clean scope.
  if (names.length > 2048) gap('source-limit');
  else {
    for (const path of selection.paths) if (!names.some(name => selectedPath(path, name))) gap('scope-unmatched', path);
    const publicNames = names.filter(path => {
      const excluded = selection.exclusions.some(prefix => selectedPath(prefix, path));
      const sensitive = taskPrivatePath(layout, path) || (privateReadPath(path) && !(includeRegistry && selection.paths.includes(REGISTRY_REL) && path === REGISTRY_REL));
      if (sensitive || excluded) { if (sensitive && !excluded) snapshot.guardImplicitOmissions++; omitted.privacy++; return false; }
      return true;
    });
    const ignored = ignoredSourcePaths(root, publicNames);
    snapshot.sourcePaths = publicNames; snapshot.ignoredPathsBefore = ignored;
    const aliases = new Map();
    for (const path of publicNames) {
      if (ignored.includes(path)) { omitted.ignored++; continue; }
      try { normalizeReadSelection({ paths: [path] }); if (/[#%]/u.test(path) || Buffer.byteLength(path) > 4096) throw new Error(); }
      catch { gap('unrepresentable-path'); continue; }
      const folded = path.normalize('NFC').toLowerCase();
      if (aliases.has(folded) && aliases.get(folded) !== path) { gap('path-alias'); continue; }
      aliases.set(folded, path);
      const entries = index.get(path) ?? [], baseline = tree.entries.get(path) ?? null;
      if (entries.length > 1 || entries.some(entry => entry.stage !== 0 || !['100644', '100755'].includes(entry.mode)) || (baseline && !['100644', '100755'].includes(baseline.mode))) { gap('unsafe-index-or-tree', path); continue; }
      try {
        let stat = null;
        try { stat = checkInstancePath(root, path, 'file', index, rootStat, mounts); }
        catch (error) {
          if (error.code !== 'ENOENT') throw error;
          snapshot.impact.missing.set(path, gitChangeMissing(snapshot, path));
        }
        if (isRawExempt(root, reg, path)) { omitted.raw++; snapshot.rawPaths.push(path); snapshot.impact.missing.delete(path); continue; }
        activePaths.push(path);
        const item = { path, baseline, index: entries[0] ?? null, worktree: !stat ? 'missing' : !entries.length && !includeUntracked ? 'present-not-authorized' : 'present', tracked: entries.length > 0, discoveredUntracked: untracked.includes(path) };
        objects.push(item);
        if (stat) snapshot.objects.set(path, { stat, observe: item.worktree === 'present' });
      } catch { gap('unsafe-or-unavailable-source', path); }
    }
  }
  if (!objects.length && !findings.length) gap('effective-scope-empty');
  const result = {
    schema: includeRegistry ? 'curia.git-change-selection/2' : 'curia.git-change-selection/1', ...(includeRegistry ? { registryAuthorization: 'explicit-registry-path-only' } : {}), selection, base: { ref: base, oid: baseOid, algorithm },
    source: { mode: 'raw-current-worktree-with-local-git-metadata', consistency: 'non-atomic-with-postcheck', git: { head: head.head, indexDigest: { ...digestBytes(Buffer.from(snapshot.indexFingerprintBefore)), canonicalization: 'curia-git-index-records/1' } }, registry: { path: REGISTRY_REL, digest: registryState.digest } },
    includeUntracked, objects, omitted, findings,
  };
  try { checkGitChangeSnapshot(snapshot); } catch { gap('snapshot-changed'); }
  snapshot.public = structuredClone(result); snapshot.blocked = findings.length > 0;
  gitChangeSelections.set(result, snapshot);
  return result;
}

const entryChange = (before, after) => !before && !after ? 'unchanged' : !before ? 'added' : !after ? 'deleted' : before.oid !== after.oid && before.mode !== after.mode ? 'content-and-mode' : before.oid !== after.oid ? 'content' : before.mode !== after.mode ? 'mode' : 'unchanged';

/** Guard declarations must explicitly exclude implicit privacy, ignored and raw gaps. */
export function gitInputScopeComplete(selection) {
  const snapshot = gitChangeSelections.get(selection);
  if (!snapshot || JSON.stringify(selection) !== JSON.stringify(snapshot.public)) throw new Error('需要未修改的本进程选集 [curia2/git-change-selection-required]');
  return !snapshot.blocked && !snapshot.guardImplicitOmissions && !selection.omitted.ignored && !selection.omitted.raw;
}

/** Planned full-file costs, never content; only a live unchanged selection can supply this budget. */
export function gitInputCost(selection) {
  const snapshot = gitChangeSelections.get(selection);
  if (!snapshot || JSON.stringify(selection) !== JSON.stringify(snapshot.public)) throw new Error('Git 预算需要本进程未修改的选集 [curia2/git-change-selection-required]');
  const files = [...snapshot.objects.values()].filter(item => item.observe);
  return { objects: snapshot.public.objects.length, openedFiles: files.length, maxFileBytes: files.reduce((max, item) => Math.max(max, item.stat.size), 0), totalBytes: files.reduce((sum, item) => sum + item.stat.size, 0) };
}

/** Full explicit input capture shares the standalone change limit; the live capability stays process-local. */
export function captureGitInputs(selection, options = {}) { return observeGitChangeSelection(selection, options, 'standalone'); }

/** No Git status/diff/hash-object: clean filters, external diff and textconv are never invoked. */
export function observeGitChanges(selection, options = {}) {
  return observeGitChangeSelection(selection, options, 'impact');
}

function observeGitChangeSelection(selection, options, purpose) {
  const maxChanges = purpose === 'standalone' ? 2048 : IMPACT_LIMITS.maxChanges;
  const limits = normalizeGitChangeLimits(options), snapshot = gitChangeSelections.get(selection);
  if (!snapshot) throw new Error('Git 观察需要本进程显式选集 [curia2/git-change-selection-required]');
  const result = {
    schema: snapshot.input.includeRegistry ? 'curia.git-change-observation/3' : purpose === 'standalone' ? 'curia.git-change-observation/2' : 'curia.git-change-observation/1', ...(snapshot.input.includeRegistry ? { registryAuthorization: 'explicit-registry-path-only' } : {}), changeLimit: maxChanges, contentInterpretation: 'not-performed', selection: structuredClone(snapshot.public.selection), source: structuredClone(snapshot.public.source), base: structuredClone(snapshot.public.base),
    includeUntracked: snapshot.input.includeUntracked, comparison: 'baseline-to-index-and-index-to-raw-worktree/1', normalization: 'none-not-git-status-equivalence', renameDetection: 'none-old-and-new-names',
    stable: false, complete: false, observedAt: null, changed: [], objects: [], omitted: structuredClone(snapshot.public.omitted), findings: structuredClone(snapshot.public.findings), limits, chargedBytes: 0, openedFiles: 0,
  };
  gitChangeObservations.set(result, { snapshot, complete: false });
  const withdraw = code => { result.stable = result.complete = false; result.observedAt = null; result.changed = []; result.objects = []; result.findings.push({ code: `git-change/${code}`, path: null }); return result; };
  if (snapshot.blocked) return withdraw('selection-incomplete');
  try { checkGitChangeSnapshot(snapshot); } catch { return withdraw('snapshot-changed'); }
  const files = [...snapshot.objects.values()].filter(item => item.observe);
  if (snapshot.public.objects.length > limits.maxFiles || files.some(item => item.stat.size > limits.maxFileBytes) || files.reduce((n, item) => n + item.stat.size, 0) > limits.maxTotalBytes) return withdraw('byte-or-file-limit');
  try {
    for (const item of snapshot.public.objects) {
      const stat = item.worktree === 'present' ? snapshot.objects.get(item.path)?.stat : null;
      let current = null, digest = null;
      if (stat) {
        result.openedFiles++; result.chargedBytes += stat.size;
        const observed = digestStableFile(join(snapshot.root, item.path), stat, snapshot.algorithm);
        digest = observed.digest; current = { oid: observed.oid, mode: stat.mode & 0o100 ? '100755' : '100644' };
      }
      const staged = entryChange(item.baseline, item.index), worktree = item.worktree === 'present-not-authorized' ? 'not-observed-untracked' : entryChange(item.index, current);
      result.objects.push({ ...structuredClone(item), staged, worktreeChange: worktree, rawWorktree: current, digest, bytes: stat?.size ?? 0 });
      if (staged !== 'unchanged' || !['unchanged', 'not-observed-untracked'].includes(worktree)) result.changed.push(item.path);
    }
    checkGitChangeSnapshot(snapshot);
  } catch { return withdraw('snapshot-changed-or-read-failed'); }
  if (result.changed.length > maxChanges) return withdraw('change-limit');
  result.stable = result.complete = true; result.observedAt = new Date().toISOString();
  gitChangeObservations.set(result, { snapshot, complete: true, public: structuredClone(result) });
  return result;
}

/** Check both phases without trusting any public report fields or widening either scope. */
export function revalidateGitChanges(observation, inventory = null) {
  const capability = gitChangeObservations.get(observation);
  if (!capability) throw new Error('Git 观察不能从 JSON 恢复授权 [curia2/git-change-observation-required]');
  if (!capability.complete || JSON.stringify(observation) !== JSON.stringify(capability.public)) return false;
  const { snapshot } = capability;
  try {
    checkGitChangeSnapshot(snapshot);
    if (inventory !== null) {
      const scan = readSnapshots.get(inventory);
      if (!scan?.impact || scan.root !== snapshot.root || scan.head !== snapshot.head || scan.indexFingerprintBefore !== snapshot.indexFingerprintBefore || !sameStat(scan.registryStat, snapshot.registryStat)) return false;
      checkReadSnapshot(scan, [...scan.objects.keys()]);
      if (JSON.stringify(ignoredSourcePaths(scan.root, [...scan.objects.keys()].sort())) !== JSON.stringify(scan.impact.ignored)) return false;
    }
    return true;
  } catch { return false; }
}

/** Source selection is a read capability, not another managed document surface. */
function ignoredSourcePaths(root, paths) {
  if (!paths.length) return [];
  try { return gitOutput(root, ['check-ignore', '--no-index', '-z', '--stdin'], `${paths.join('\0')}\0`).split('\0').filter(Boolean).sort(); }
  catch (error) {
    if (error.status === 1 && !error.stdout && !error.stderr) return [];
    throw new Error('来源的 Git 忽略状态不可确认 [curia2/source-ignore-unknown]');
  }
}

export function prepareSourceSelection(inputRoot = ROOT, options = {}) {
  if (!plainObject(options) || Object.keys(options).some((key) => !['paths', 'exclusions', 'includeUntracked', 'nonSensitive'].includes(key)) || ['includeUntracked', 'nonSensitive'].some((key) => options[key] !== undefined && typeof options[key] !== 'boolean')) throw new Error('来源选集选项非法 [curia2/source-options-invalid]');
  const selection = normalizeReadSelection({ paths: options.paths, exclusions: options.exclusions });
  if (selection.paths.length > READ_LIMITS.maxFiles || selection.exclusions.length > 128 || [...selection.paths, ...selection.exclusions].some((path) => Buffer.byteLength(path, 'utf8') > 4096)) throw new Error('来源选集超出范围限制 [curia2/source-options-invalid]');
  const result = { schema: 'curia.source-selection/1', selection, source: null, objects: [] };
  const snapshot = { objects: new Map(), selection: structuredClone(selection), blocked: false };
  sourceSnapshots.set(result, snapshot);
  const excluded = (path) => !options.nonSensitive ? 'privacy-not-declared' : privateReadPath(path) || selection.exclusions.some((prefix) => selectedPath(prefix, path)) ? 'privacy-excluded' : null;
  for (const path of selection.paths) result.objects.push({ path, reason: excluded(path) });
  // Without an explicit non-sensitive declaration, do not even probe the source or its Registry.
  if (result.objects.some((item) => item.reason)) {
    snapshot.blocked = true; snapshot.public = structuredClone(result); return result;
  }
  const instance = resolveInstance(inputRoot);
  const root = instance.root, rootStat = lstatSync(root), mounts = instanceMounts(root), index = gitIndexRecords(root);
  checkInstancePath(root, REGISTRY_REL, 'file', index, rootStat, mounts);
  const registryState = loadInstanceRegistry(instance, index, { maxBytes: 1024 * 1024 });
  const reg = normalizeRegistry(registryState.registry);
  const layout = normalizeInstance(reg.instance, reg.types); // No expansion or reading of managed surfaces.
  for (const item of result.objects) if (taskPrivatePath(layout, item.path)) item.reason = 'privacy-excluded';
  if (result.objects.some(item => item.reason)) { snapshot.blocked = true; snapshot.public = structuredClone(result); return result; }
  const headResult = gitHead(root);
  if (headResult.state === 'unknown') throw new Error('来源 HEAD 不可确认 [curia2/source-head-unknown]');
  const gitPaths = selection.paths.map((path) => `:(literal)${path}`);
  const includeUntracked = options.includeUntracked ?? false;
  const untracked = includeUntracked ? [...new Set(gitOutput(root, ['ls-files', '--others', '--exclude-standard', '-z', '--', ...gitPaths]).split('\0').filter(Boolean))].sort() : [];
  const ignored = ignoredSourcePaths(root, selection.paths);
  const headTree = gitHeadEntries(root, headResult.head, gitPaths);
  if (headResult.head && (!headTree.available || headTree.invalid)) throw new Error('来源 HEAD tree 不可确认 [curia2/source-head-unknown]');
  Object.assign(snapshot, {
    root, rootStat, reg, layout, registryStat: registryState.stat, index, mounts, head: headResult.head,
    indexFingerprintBefore: indexFingerprint(index), input: { includeUntracked }, gitPaths,
    untrackedPathsBefore: untracked, sourcePaths: [...selection.paths], ignoredPathsBefore: ignored,
  });
  result.source = {
    mode: 'current-worktree', consistency: 'non-atomic-with-postcheck', worktreeState: 'not-attributed-to-head',
    git: { head: headResult.head, headState: headResult.state, indexDigest: { ...digestBytes(Buffer.from(snapshot.indexFingerprintBefore)), canonicalization: 'curia-git-index-records/1' } },
    registry: { path: REGISTRY_REL, digest: registryState.digest },
  };
  for (const item of result.objects) {
    if (ignored.includes(item.path)) { item.reason = 'ignored-source'; continue; }
    if (!index.has(item.path) && !untracked.includes(item.path)) { item.reason = 'not-git-visible'; continue; }
    try {
      const stat = checkInstancePath(root, item.path, 'file', index, rootStat, mounts);
      if (isRawExempt(root, reg, item.path)) { item.reason = 'privacy-excluded'; continue; }
      snapshot.objects.set(item.path, { stat, git: { index: index.get(item.path)?.[0] ?? null, head: headTree.entries.get(item.path) ?? null, tracked: index.has(item.path) } });
    } catch { item.reason = 'unsafe-or-unavailable-source'; }
  }
  snapshot.blocked = result.objects.some((item) => item.reason);
  snapshot.public = structuredClone(result);
  return result;
}

/** Recheck a live capability after parsing; never reconstruct authorization from a public report. */
export function revalidateSourceSelection(selection) {
  const snapshot = sourceSnapshots.get(selection);
  if (!snapshot) throw new Error('来源后检需要本进程显式选集 [curia2/source-snapshot-required]');
  if (snapshot.blocked || JSON.stringify(selection) !== JSON.stringify(snapshot.public)) return false;
  try { checkReadSnapshot(snapshot, [...snapshot.objects.keys()].sort()); return true; }
  catch { return false; }
}

/** Access a declared generation binding only through the same live, explicitly authorized selection. */
export function generationBindingFor(selection, path) {
  const snapshot = sourceSnapshots.get(selection);
  if (!snapshot || JSON.stringify(selection) !== JSON.stringify(snapshot.public)) throw new Error('来源绑定需要未修改的进程内选集 [curia2/source-snapshot-required]');
  if (snapshot.blocked || !snapshot.objects.has(path)) return null;
  const surface = snapshot.layout.surfaces.find(s => s.members.some(member => containsPath(member, path)));
  return surface ? structuredClone(mappingFor(snapshot.layout, surface, path).generation) : null;
}

/** A task binding does not grant access to its invocation instructions or result source. */
export function taskBindingFor(selection, boundary) {
  const snapshot = sourceSnapshots.get(selection);
  if (!snapshot || JSON.stringify(selection) !== JSON.stringify(snapshot.public)) throw new Error('任务绑定需要未修改的进程内选集 [curia2/source-snapshot-required]');
  if (snapshot.blocked) return null;
  const profile = taskProfileFor(snapshot.layout, boundary);
  if (!profile) return null;
  snapshot.extraBoundaries ??= new Map();
  snapshot.extraBoundaries.set(boundary, checkInstancePath(snapshot.root, boundary, 'directory', snapshot.index, snapshot.rootStat, snapshot.mounts));
  return structuredClone(profile);
}

/** Explicit name-only task view. Private members may be named, never read or fingerprinted. */
export function buildTaskInventory(root = ROOT, options = {}) {
  if (!plainObject(options) || Object.keys(options).some(k => !['package', 'exclusions', 'includeUntracked'].includes(k)) || typeof options.package !== 'string' || (options.includeUntracked !== undefined && typeof options.includeUntracked !== 'boolean')) throw new Error('任务盘点参数非法 [curia2/task-options-invalid]');
  const selection = normalizeReadSelection({ paths: [options.package], exclusions: options.exclusions ?? [] });
  const request = { selection, readMetadata: false, includeUntracked: options.includeUntracked ?? false };
  taskInventoryRequests.add(request);
  let inventory; try { inventory = buildInventory(root, null, request); } finally { taskInventoryRequests.delete(request); }
  const snapshot = readSnapshots.get(inventory), profile = snapshot && taskProfileFor(snapshot.layout, options.package);
  if (!profile) throw new Error('任务目录未显式登记 [curia2/task-not-registered]');
  const entries = inventory.envelopes.map(env => ({ path: env.identity.path, ...taskMemberFor(snapshot.layout, env.identity.path), content: 'not-read', contentAccess: privateReadPath(env.identity.path) || taskPrivatePath(snapshot.layout, env.identity.path) ? 'withheld' : 'explicit-only', classification: 'registry-declared', stateMechanism: 'not-verified' }));
  const withheld = path => path !== null && selection.exclusions.some(prefix => selectedPath(prefix, path));
  const packageView = { id: profile.id, boundary: profile.boundary, owner: profile.owner, sensitivity: profile.sensitivity, invocationRef: withheld(profile.invocationRef) ? null : profile.invocationRef, outcomeAuthority: withheld(profile.outcomeAuthority.path) ? null : { path: profile.outcomeAuthority.path, kind: profile.outcomeAuthority.kind }, retention: withheld(profile.retention) ? null : profile.retention };
  const gaps = [];
  if (inventory.input.selection?.excluded || profile.members.some(member => withheld(member.path))) gaps.push({ code: 'task/scope-excluded', path: null });
  if (!profile.owner) gaps.push({ code: 'task/owner-unknown', path: options.package });
  for (const entry of entries) if (!entry.role) gaps.push({ code: 'task/member-unclassified', path: entry.path });
  for (const member of profile.members) if (member.kind === 'file' && !withheld(member.path) && !entries.some(entry => entry.path === member.path)) gaps.push({ code: 'task/member-not-observed', path: member.path });
  if (!entries.length) gaps.push({ code: 'task/empty-scope', path: options.package });
  let stable = !snapshot.inventoryErrors;
  try { checkInstancePath(snapshot.root, options.package, 'directory', snapshot.index, snapshot.rootStat, snapshot.mounts); checkReadSnapshot(snapshot, [...snapshot.objects.keys()]); } catch { stable = false; }
  if (!stable) gaps.push({ code: 'task/snapshot-incomplete', path: null });
  return { schema: 'curia.task-inventory/1', state: stable && !gaps.length ? 'classified' : 'incomplete', package: stable ? packageView : null, entries: stable ? entries : [], gaps, findings: inventory.findings, coverage: { discovered: inventory.input.selection?.discovered ?? null, selected: entries.length, excluded: inventory.input.selection?.excluded ?? null, rolesKnown: entries.filter(entry => entry.role).length, documentBodiesRead: 0, privateValuesReadOrHashed: false }, observation: { stable, source: stable ? inventory.instance.registry : null, effects: ['registry-and-path-metadata-read'], persisted: false }, verification: 'member-classification-not-content-execution-or-outcome-verification' };
}

/** Full bytes only. A missing, private or unsafe peer blocks the entire comparison before reads. */
export function readSourceSelection(selection, options = {}) {
  return observeSourceSelection(selection, null, normalizeReadLimits(options), false);
}

export function readSourceSubset(selection, paths, options = {}) {
  return observeSourceSelection(selection, normalizeReadSelection({ paths }).paths, normalizeReadLimits(options), false);
}

export const DIGEST_LIMITS = Object.freeze({ maxFiles: 32, maxFileBytes: 16 * 1024 * 1024, maxTotalBytes: 32 * 1024 * 1024 });
export function normalizeDigestLimits(options = {}) {
  if (!plainObject(options) || Object.keys(options).some(key => !Object.hasOwn(DIGEST_LIMITS, key))) throw new Error('摘要预算字段非法 [curia2/digest-budget-invalid]');
  const limits = { ...DIGEST_LIMITS, ...options }, caps = { maxFiles: 32, maxFileBytes: 512 * 1024 * 1024, maxTotalBytes: 1024 * 1024 * 1024 };
  for (const [key, value] of Object.entries(limits)) if (!Number.isSafeInteger(value) || value < 1 || value > caps[key]) throw new Error('摘要预算超过支持范围 [curia2/digest-budget-invalid]');
  return limits;
}

/** A phase may narrow a capability, never widen it; every phase rechecks all authorized peers. */
export function digestSourceSubset(selection, paths, options = {}) {
  if (!plainObject(options)) throw new Error('摘要预算字段非法 [curia2/digest-budget-invalid]');
  const algorithm = Object.hasOwn(options, 'algorithm') ? options.algorithm : 'sha256';
  if (!isOriginalDigestAlgorithm(algorithm)) throw new Error('摘要算法未支持 [curia2/digest-algorithm-invalid]');
  const { algorithm: ignored, ...budgets } = options;
  return observeSourceSelection(selection, normalizeReadSelection({ paths }).paths, normalizeDigestLimits(budgets), true, algorithm);
}

function observeSourceSelection(selection, subset, limits, digestOnly, digestAlgorithm = 'sha256') {
  const snapshot = sourceSnapshots.get(selection);
  if (!snapshot) throw new Error('来源读取需要本进程显式选集，JSON 不能授权 [curia2/source-snapshot-required]');
  const authorized = snapshot.public.objects.map(item => item.path);
  if (subset?.some(path => !authorized.includes(path))) throw new Error('分阶段读取不能扩大已授权选集 [curia2/source-subset-invalid]');
  const paths = subset ?? [...snapshot.objects.keys()].sort(), allPaths = [...snapshot.objects.keys()].sort();
  const documents = snapshot.public.objects.filter(item => !subset || subset.includes(item.path)).map(({ path, reason }) => ({ path, reason, state: 'not-read', observedAt: null, size: null, bytes: null, digest: null, git: null }));
  let stable = false, chargedBytes = 0, openedFiles = 0;
  const withdraw = (reason) => {
    stable = false;
    for (const doc of documents) { doc.reason ??= reason; doc.state = 'not-read'; doc.observedAt = doc.size = doc.bytes = doc.digest = doc.git = null; }
  };
  if (snapshot.blocked) withdraw('scope-blocked');
  else {
    try { checkReadSnapshot(snapshot, allPaths); stable = true; }
    catch { withdraw('snapshot-changed'); }
  }
  // Budget preflight is all-or-nothing; no prefix may become an EvidenceRef.
  if (stable && (paths.length > limits.maxFiles || paths.some((path) => snapshot.objects.get(path).stat.size > limits.maxFileBytes) || paths.reduce((sum, path) => sum + snapshot.objects.get(path).stat.size, 0) > limits.maxTotalBytes)) withdraw('byte-or-file-limit');
  if (stable) {
    for (const doc of documents) {
      const item = snapshot.objects.get(doc.path);
      const allowance = Math.min(limits.maxFileBytes, limits.maxTotalBytes - chargedBytes);
      if (allowance < 1 && item.stat.size !== 0) { withdraw('byte-or-file-limit'); break; }
      try {
        const stat = checkInstancePath(snapshot.root, doc.path, 'file', snapshot.index, snapshot.rootStat, snapshot.mounts);
        if (!sameStat(stat, item.stat) || isRawExempt(snapshot.root, snapshot.reg, doc.path)) throw new Error();
        openedFiles++;
        // Full-byte reads include a lookahead in their hard budget. Streaming hashes read exactly the stable size.
        const bytes = digestOnly ? null : readStableFile(join(snapshot.root, doc.path), stat, allowance - 1);
        const digest = digestOnly ? digestStableFile(join(snapshot.root, doc.path), stat, null, digestAlgorithm) : digestBytes(bytes);
        chargedBytes += digestOnly ? stat.size : bytes.length;
        if ((!digestOnly && bytes.length !== stat.size) || !sameStat(checkInstancePath(snapshot.root, doc.path, 'file', snapshot.index, snapshot.rootStat, snapshot.mounts), stat)) throw new Error();
        Object.assign(doc, { state: digestOnly ? 'hashed' : 'read', observedAt: new Date().toISOString(), size: stat.size, bytes, digest, git: structuredClone(item.git) });
      } catch { chargedBytes = Math.min(limits.maxTotalBytes, chargedBytes + allowance); withdraw('source-read-failed'); break; }
    }
    if (stable) {
      try { checkReadSnapshot(snapshot, allPaths); }
      catch { withdraw('snapshot-changed'); }
    }
  }
  return {
    schema: digestOnly ? 'curia.source-digest-observation/1' : 'curia.source-observation/1', selection: subset ? { ...structuredClone(snapshot.selection), paths: [...subset], authorizationPaths: authorized } : structuredClone(snapshot.selection), source: structuredClone(snapshot.public.source),
    stable, limits, chargedBytes, openedFiles, documents,
    privacy: { mode: 'local-single-reader-explicit-non-sensitive-scope', classification: 'caller-responsible-not-secret-detection', pathFloor: 'read-path-exclusions/1', network: 'not-invoked', projectGuards: 'not-invoked', metadataCommands: 'git-and-os-mount-table-read-only' },
  };
}

function projectReadMetadata(snapshot, item, input, json) {
  const path = item.env.identity.path;
  const env = structuredClone(item.env);
  env.gaps = [];
  env.metadataRead = env.format === 'md' ? 'header' : 'not-parsed';
  const parser = hasBoundHeader(item.mapped) ? parseNativeHeader : parseHeader;
  const parsedHeader = env.format === 'md' ? parser(input.lines) : null;
  const incompleteHeader = path !== snapshot.reg.projection && parsedHeader && input.truncated && (!parsedHeader.titleOk || parsedHeader.headerEnd >= input.lines.length - 1);
  if (incompleteHeader) {
    env.metadataRead = 'header-partial';
    env.gaps.push('header-truncated', 'content-unparsed', 'type-unknown', 'owner-unknown', 'status-unknown');
  } else if (item.member.path === '.agents') classifyControlEnvelope(snapshot.root, snapshot.reg, path, env.format, env, item.stat, parser, input);
  else classifyKnowledgeEnvelope(snapshot.root, snapshot.reg, path, env.format, env, item.stat, parser, input);
  if (item.mapped) applyInstanceMetadata(env, item.mapped, item.surface, env.format === 'md' || json ? input : null, snapshot.reg, snapshot.evaluation);
  applyRepresentation(env, item.mapped, snapshot.reg);
  env.role = item.member.role === 'record' ? 'record' : inferRole(item.member.path, env.type, path, env.role, env.typeSource);
  if (!env.maintenance || env.maintenance === 'unknown') env.gaps.push('maintenance-unknown');
  if (env.role === 'record') { env.maintenance = 'record-mechanism-unknown'; env.gaps.push('record-mutation-unknown'); }
  env.gaps = [...new Set(env.gaps)];
  return env;
}

/** Move resolution is explicit and ephemeral. Serialized selections never authorize I/O. */
export function normalizeMoveOptions(options = {}) {
  const keys = ['from', 'revision', 'within', 'exclusions', 'nonSensitive', 'includeUntracked', 'limits'];
  if (!plainObject(options) || Object.keys(options).some(key => !keys.includes(key)) || options.nonSensitive !== true || (options.includeUntracked !== undefined && typeof options.includeUntracked !== 'boolean')) throw new Error('Move 需要显式非敏感声明与受支持选项 [curia2/move-options-invalid]');
  const from = normalizeReadSelection({ paths: [options.from] }).paths[0];
  const scope = normalizeReadSelection({ paths: options.within, exclusions: options.exclusions ?? [] });
  if ([from, ...scope.paths, ...scope.exclusions].some(path => Buffer.byteLength(path) > 4096 || path.split('/').length > 64) || scope.paths.length > 128 || scope.exclusions.length > 128 || typeof options.revision !== 'string' || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(options.revision)) throw new Error('Move 需要精确旧路径、完整 commit ID 与有限范围 [curia2/move-options-invalid]');
  return { from, revision: options.revision, within: scope.paths, exclusions: scope.exclusions, nonSensitive: true, includeUntracked: options.includeUntracked ?? false, limits: normalizeReadLimits(options.limits) };
}
function moveAllowed(options, path, layout = null) {
  return !taskPrivatePath(layout, path) && !privateReadPath(path) && options.within.some(prefix => selectedPath(prefix, path)) && !options.exclusions.some(prefix => selectedPath(prefix, path));
}
function moveEntry(root, revision, path) {
  // No recursive tree scan: a directory, symlink or gitlink is never a blob source.
  const out = gitOutput(root, ['ls-tree', '-z', revision, '--', `:(literal)${path}`], undefined, 16 * 1024);
  if (!out) return null;
  const records = out.split('\0').filter(Boolean);
  if (records.length !== 1) throw new Error('ambiguous historical entry');
  const match = records[0].match(/^([0-9]{6}) (blob|tree|commit) ([0-9a-f]{40}|[0-9a-f]{64})\t([\s\S]+)$/);
  if (!match || match[4] !== path) throw new Error('historical entry mismatch');
  return { mode: match[1], type: match[2], oid: match[3] };
}
function moveBlobSize(root, entry, cap) {
  if (!entry || !['100644', '100755'].includes(entry.mode) || entry.type !== 'blob') throw new Error('historical source is not a regular blob');
  const size = gitOutput(root, ['cat-file', '-s', entry.oid], undefined, 128).trim();
  if (!/^(?:0|[1-9][0-9]*)$/.test(size) || !Number.isSafeInteger(Number(size)) || Number(size) > cap) throw new Error('historical blob size unavailable or over budget');
  return Number(size);
}
function moveBlobBytes(root, entry, size) {
  const bytes = gitBytes(root, ['cat-file', 'blob', entry.oid], undefined, Math.max(1, size));
  const oid = createHash(entry.oid.length === 40 ? 'sha1' : 'sha256').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  if (bytes.length !== size || oid !== entry.oid) throw new Error('historical blob identity mismatch');
  return bytes;
}
function moveHistoryMetadata(root, options, reg) {
  if (gitOutput(root, ['cat-file', '-t', options.revision], undefined, 128).trim() !== 'commit') throw new Error('revision is not a commit');
  const entry = moveEntry(root, options.revision, options.from);
  const size = moveBlobSize(root, entry, options.limits.maxFileBytes);
  const registryEntry = moveEntry(root, options.revision, REGISTRY_REL);
  let registry = { state: 'absent', path: REGISTRY_REL }, historicalMarker = null;
  if (registryEntry) {
    const registrySize = moveBlobSize(root, registryEntry, 1024 * 1024);
    const bytes = moveBlobBytes(root, registryEntry, registrySize);
    const historical = parseRegistryJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!plainObject(historical) || historical.version !== 1 || (historical.rawMarker !== undefined && typeof historical.rawMarker !== 'string')) throw new Error('historical registry privacy unknown');
    historicalMarker = historical.rawMarker;
    registry = { state: 'observed', path: REGISTRY_REL, git: registryEntry, digest: digestBytes(bytes), size: bytes.length };
  }
  const markers = [...new Set(['.agents-raw', reg.rawMarker, historicalMarker].filter(value => value !== undefined && value !== null))];
  for (const marker of markers) {
    if (typeof marker !== 'string' || marker.includes('/') || marker.includes('\\')) throw new Error('historical privacy unknown');
    normalizeReadSelection({ paths: [marker] });
  }
  // Both the historical policy and today's floor apply; never read a historical raw payload.
  const parts = options.from.split('/'), rootStat = lstatSync(root), mounts = instanceMounts(root), index = gitIndexRecords(root);
  for (let i = 1; i < parts.length; i++) {
    const parent = parts.slice(0, i).join('/');
    let currentParent = true;
    try { checkInstancePath(root, parent, 'directory', index, rootStat, mounts); }
    catch (error) { if (error.code === 'ENOENT') currentParent = false; else throw error; }
    for (const marker of markers) {
      const path = `${parent}/${marker}`;
      if (moveEntry(root, options.revision, path)) throw new Error('historical raw exclusion');
      if (currentParent) {
        try { lstatSync(join(root, path)); throw new Error('current raw exclusion'); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
    }
  }
  return { entry, size, registry };
}

export function prepareMoveSelection(root = ROOT, input = {}) {
  const options = normalizeMoveOptions(input);
  const result = { schema: 'curia.move-selection/1', request: structuredClone(options), binding: null, source: null, gaps: [] };
  const snapshot = { public: null, live: null, history: null, options, blocked: true };
  moveSelections.set(result, snapshot);
  const finish = gap => { if (gap) result.gaps.push(gap); snapshot.public = structuredClone(result); return result; };
  if (!moveAllowed(options, options.from)) return finish('source-outside-authorized-scope');
  const instance = resolveInstance(root), index = gitIndexRecords(instance.root);
  const config = loadInstanceRegistry(instance, index, { maxBytes: 1024 * 1024 });
  const reg = normalizeRegistry(config.registry), layout = normalizeInstance(reg.instance, reg.types);
  if (taskPrivatePath(layout, options.from)) return finish('source-outside-authorized-scope');
  const matches = (layout.moves?.artifacts ?? []).flatMap(artifact => artifact.previous.filter(prior => prior.path === options.from && prior.revision === options.revision).map(prior => ({ artifact, prior })));
  if (!matches.length) return finish(layout.moves ? 'exact-locator-not-declared' : 'move-binding-not-enabled');
  if (matches.length !== 1) return finish('ambiguous-identity');
  const { artifact, prior } = matches[0], paths = [...new Set([artifact.current, ...prior.basis])].sort();
  // Unauthorized target/basis names are not disclosed in the report.
  if (paths.some(path => !moveAllowed(options, path, layout))) return finish('target-or-basis-outside-authorized-scope');
  const live = prepareSourceSelection(instance.root, { paths, exclusions: options.exclusions, includeUntracked: options.includeUntracked, nonSensitive: true });
  snapshot.live = live;
  if (!live.source || JSON.stringify(live.source.registry.digest) !== JSON.stringify(config.digest) || !revalidateSourceSelection(live)) return finish('current-source-unavailable-or-drifted');
  snapshot.root = instance.root; snapshot.reg = reg;
  try { snapshot.history = moveHistoryMetadata(instance.root, options, reg); }
  catch { return finish('historical-source-unavailable-or-excluded'); }
  const liveState = sourceSnapshots.get(live), sizes = [...liveState.objects.values()].map(item => item.stat.size);
  const count = paths.length + 1, bytes = sizes.reduce((a, b) => a + b, snapshot.history.size);
  if (count > options.limits.maxFiles || sizes.some(size => size > options.limits.maxFileBytes) || bytes > options.limits.maxTotalBytes) return finish('byte-or-file-limit');
  if (!revalidateSourceSelection(live)) return finish('snapshot-changed');
  result.binding = { id: artifact.id, from: { path: prior.path, revision: prior.revision }, current: artifact.current, basis: [...prior.basis], source: prior.source };
  result.source = { instance: { root: instance.root }, current: live.source, historicalRegistry: snapshot.history.registry };
  snapshot.blocked = false;
  return finish();
}

/** Recheck the fixed old locator and every current input; never discover new targets on drift. */
export function revalidateMoveSelection(selection) {
  const snapshot = moveSelections.get(selection);
  if (!snapshot) throw new Error('Move 后检需要本进程选集 [curia2/move-selection-required]');
  if (snapshot.blocked || JSON.stringify(selection) !== JSON.stringify(snapshot.public) || !revalidateSourceSelection(snapshot.live)) return false;
  try {
    const current = moveHistoryMetadata(snapshot.root, snapshot.options, snapshot.reg);
    return JSON.stringify(current) === JSON.stringify(snapshot.history) && revalidateSourceSelection(snapshot.live);
  } catch { return false; }
}

export function observeMoveSelection(selection) {
  const snapshot = moveSelections.get(selection);
  if (!snapshot) throw new Error('Move 读取需要本进程选集 [curia2/move-selection-required]');
  const fixed = snapshot.public, limits = snapshot.options.limits;
  const report = {
    schema: 'curia.move-resolution/1', generator: 'curia-moves/1', generatedAt: new Date().toISOString(),
    execution: { mode: 'ephemeral-read-only', persisted: false, network: 'not-invoked', receiverCompleteness: 'not-observed' },
    request: structuredClone(fixed.request), binding: null, evidence: null, source: null,
    complete: false, outcome: 'unresolved', gaps: [...fixed.gaps], limits,
    coverage: { historicalBlobs: 0, currentBlobs: 0, chargedBytes: 0, configurationBudget: 'up-to-1MiB-per-current-or-historical-registry-per-observation' },
    semantics: { identity: 'registry-declared-not-authenticated', approval: 'not-verified', authority: 'unchanged', supersession: 'not-inferred', historicalMeaning: 'not-reconstructed', automaticRedirect: false },
  };
  const fail = gap => { report.gaps = [...new Set([...report.gaps, gap])]; return report; };
  if (snapshot.blocked) return report;
  if (!revalidateMoveSelection(selection)) return fail('snapshot-changed');
  const { root, history, live } = snapshot;
  let bytes;
  // Reserve the complete payload allowance even when Git fails mid-read.
  report.coverage.chargedBytes += history.size;
  try { bytes = moveBlobBytes(root, history.entry, history.size); }
  catch { return fail('historical-payload-unavailable'); }
  const observedAt = new Date().toISOString();
  const current = digestSourceSubset(live, live.objects.map(item => item.path), { ...limits, maxFiles: Math.min(32, limits.maxFiles), maxTotalBytes: Math.max(1, limits.maxTotalBytes - bytes.length) });
  report.coverage.chargedBytes += current.chargedBytes;
  if (!current.stable || current.documents.some(item => item.state !== 'hashed') || !revalidateMoveSelection(selection)) return fail('snapshot-changed-or-incomplete');
  const from = { ...fixed.binding.from, git: history.entry, observedAt, size: bytes.length, digest: digestBytes(bytes) };
  const project = doc => ({ path: doc.path, observedAt: doc.observedAt, size: doc.size, digest: doc.digest, git: doc.git });
  const target = project(current.documents.find(doc => doc.path === fixed.binding.current));
  report.binding = structuredClone(fixed.binding); report.source = structuredClone(fixed.source);
  report.evidence = { from, current: target, basis: current.documents.filter(doc => fixed.binding.basis.includes(doc.path)).map(project), byteEquality: from.digest.value === target.digest.value ? 'equal-not-identity-proof' : 'different-not-identity-disproof' };
  report.coverage.historicalBlobs = 1; report.coverage.currentBlobs = current.documents.length;
  report.complete = true; report.outcome = 'resolved-declaration';
  return report;
}

/** Parse metadata from these same observed bytes, without making unregistered sources a surface. */
export function readSourceDocuments(selection, options = {}) {
  const read = readSourceSelection(selection, options);
  const snapshot = sourceSnapshots.get(selection);
  const evaluatedAt = new Date().toISOString();
  for (const doc of read.documents) {
    doc.envelope = doc.binding = doc.text = null;
    if (doc.state !== 'read') continue;
    const surface = snapshot.layout.surfaces.find((s) => s.members.some((member) => containsPath(member, doc.path)));
    const member = surface?.members.find((member) => containsPath(member, doc.path));
    if (!member) { doc.reason = 'unmanaged-document'; continue; }
    const mapped = mappingFor(snapshot.layout, surface, doc.path);
    doc.binding = structuredClone(mapped.relations);
    if (!mapped.relations) continue; // Relationship opt-in does not imply general content extraction.
    try {
      if (doc.bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) throw new Error();
      const text = new TextDecoder('utf-8', { fatal: true }).decode(doc.bytes);
      if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text)) throw new Error();
      const input = { text, lines: normalizeLines(text), truncated: false, encodingState: 'valid' };
      const observed = snapshot.objects.get(doc.path);
      const env = baseEnvelope({ rel: doc.path, surface: surface.id, role: member.role, tracked: observed.git.tracked, format: formatOf(doc.path), indexEntry: observed.git.index, headEntry: observed.git.head });
      doc.envelope = projectReadMetadata({ ...snapshot, evaluation: evaluatedAt }, { env, member, surface, mapped, stat: observed.stat }, input, env.format === 'json');
      doc.text = text;
    } catch { doc.reason = 'metadata-unparsed'; }
  }
  return { ...read, evaluatedAt };
}

/** Mint the dedicated reverse-scan capability; a normal read inventory does not authorize this use. */
export function buildImpactInventory(inputRoot = ROOT, selection, options = {}) {
  if (!plainObject(options) || options.nonSensitive !== true || Object.keys(options).some(key => !['changed', 'nonSensitive', 'includeUntracked', 'at', 'now', 'configuration'].includes(key))) throw new Error('影响盘点必须另行声明非敏感扫描范围 [curia2/impact-inventory-invalid]');
  if (options.configuration !== undefined && !['include', 'only'].includes(options.configuration)) throw new Error('配置依赖模式非法 [curia2/impact-inventory-invalid]');
  const scope = normalizeReadSelection(selection), changes = normalizeReadSelection({ paths: options.changed }).paths;
  if (scope.corpus || changes.length > IMPACT_LIMITS.maxChanges || scope.paths.length > 128 || scope.exclusions.length > 128 || [...changes, ...scope.paths, ...scope.exclusions].some(path => /[#%]/u.test(path) || Buffer.byteLength(path, 'utf8') > 4096) || changes.some(path => (privateReadPath(path) && !(options.configuration && path === REGISTRY_REL)) || scope.exclusions.some(prefix => selectedPath(prefix, path))) || (options.configuration && scope.exclusions.some(prefix => selectedPath(prefix, REGISTRY_REL)))) throw new Error('影响盘点范围或变更名字不符合边界 [curia2/impact-inventory-invalid]');
  const { nonSensitive, changed, configuration, ...observation } = options;
  const inventoryOptions = { ...observation, readMetadata: false, selection: scope }, request = { changes: new Set(changes), missing: new Map() };
  impactInventoryRequests.set(inventoryOptions, request);
  let inventory;
  try { inventory = buildInventory(inputRoot, null, inventoryOptions); }
  finally { impactInventoryRequests.delete(inventoryOptions); }
  const snapshot = readSnapshots.get(inventory);
  if (!snapshot) throw new Error('影响盘点未建立安全快照 [curia2/impact-inventory-unavailable]');
  // Names outside the scan are matched using already-observed Git path metadata, never probed or opened.
  const knownNames = [...new Set([...snapshot.index.keys(), ...snapshot.objects.keys()])];
  const folded = path => path.normalize('NFC').toLowerCase(), changedNames = new Set(changes), changedAliases = new Map(changes.map(path => [folded(path), path]));
  for (const known of knownNames) {
    const declared = changedAliases.get(folded(known));
    if (declared !== undefined && declared !== known) throw new Error('变更名字不能使用未经登记的等价别名 [curia2/impact-change-alias]');
    const parts = known.split('/'); parts.pop();
    while (parts.length) { if (changedNames.has(parts.join('/'))) throw new Error('变更项必须为精确文件名，不扩展目录 [curia2/impact-change-directory]'); parts.pop(); }
  }
  const sensitivePath = configuration ? configurationGuardPrivacy(snapshot) : path => taskPrivatePath(snapshot.layout, path);
  snapshot.impact = { changed: changes, configuration, sensitivePath, missing: request.missing, ignored: ignoredSourcePaths(snapshot.root, [...snapshot.objects.keys()].sort()) };
  return inventory;
}

// All declarations constrain explicit configuration analysis, even guards outside this input scope.
// Match parent paths in a set rather than scanning every declared prefix for every document or edge.
function configurationGuardPrivacy(snapshot) {
  const prefixes = new Set(Object.values(snapshot.layout.guards ?? {}).flatMap(guard => guard.privacy.sensitivePaths));
  const sensitivePath = path => {
    if (taskPrivatePath(snapshot.layout, path)) return true;
    for (let parent = path; parent; parent = parent.slice(0, Math.max(0, parent.lastIndexOf('/')))) if (prefixes.has(parent)) return true;
    return false;
  };
  // The Registry must be parsed to discover its policy, but no configuration evidence may escape it.
  if (sensitivePath(REGISTRY_REL)) throw new Error('敏感声明与配置分析来源冲突 [curia2/configuration-sensitive-registry]');
  return sensitivePath;
}

/** Registry declarations are evidence of configured dependencies, never authorization to read their targets. */
export function readInventoryConfiguration(inventory, options = {}) {
  const limits = normalizeReadLimits(options), snapshot = readSnapshots.get(inventory);
  if (!snapshot?.impact?.configuration) throw new Error('配置依赖需要独立启用的进程内盘点 [curia2/configuration-capability-required]');
  const allPaths = [...snapshot.objects.keys()].sort(), ignored = snapshot.impact.ignored;
  const paths = allPaths.filter(path => !ignored.includes(path));
  const result = { schema: 'curia.configuration-dependencies/3', guardScope: 'primary-repository-declarations-only', stable: false, complete: false, registry: null, documents: [], references: [], moves: [], findings: [], observedObjects: paths.length, truncated: false, bodiesRead: 0, consideredEdges: 0, consideredMoves: 0, limits: { maxObjects: Math.min(limits.maxFiles, IMPACT_LIMITS.maxSources), maxEdges: IMPACT_LIMITS.maxEdges, maxRegistryBytes: REGISTRY_BYTE_LIMIT } };
  const gap = (code, path = null) => { if (!result.findings.some(f => f.code === `configuration/${code}` && f.path === path)) result.findings.push({ code: `configuration/${code}`, path }); };
  const check = () => {
    checkReadSnapshot(snapshot, allPaths);
    if (JSON.stringify(ignoredSourcePaths(snapshot.root, allPaths)) !== JSON.stringify(ignored)) throw new Error('ignore changed');
    if (ignoredSourcePaths(snapshot.root, [REGISTRY_REL]).length) throw new Error('Registry excluded');
  };
  const withdraw = () => { result.stable = result.complete = false; result.registry = null; result.documents = []; result.references = []; result.moves = []; gap('snapshot-unavailable'); return result; };
  try { check(); } catch { return withdraw(); }
  if (snapshot.inventoryErrors || snapshot.input.selection.unmatched.length) { gap('inventory-incomplete'); return result; }
  if (!paths.length) { gap('scope-empty'); return result; }
  if (paths.length > result.limits.maxObjects) { result.truncated = true; gap('object-limit'); return result; }
  result.registry = { uri: `repo:${REGISTRY_REL}`, revision: structuredClone(snapshot.registryDigest), locator: { kind: 'whole-file/1' }, observedAt: snapshot.registryObservedAt, bytes: snapshot.registryStat.size };
  const within = (prefix, path) => path === prefix || path.startsWith(`${prefix}/`);
  const sensitivePath = snapshot.impact.sensitivePath;
  const withheld = target => sensitivePath(target) || (target !== REGISTRY_REL && privateReadPath(target)) || /[#%]/u.test(target) || snapshot.input.selection.exclusions.some(prefix => within(prefix, target));
  const reserve = (edges, moves = 0) => {
    if (result.consideredEdges + result.consideredMoves + edges + moves > result.limits.maxEdges) { result.truncated = true; gap('edge-limit'); return false; }
    result.consideredEdges += edges; result.consideredMoves += moves; return true;
  };
  const edge = (source, target, kind, pointer) => ({ source, target, kind, field: 'Registry', locator: { kind: 'json-pointer/1', pointer }, declaration: REGISTRY_REL });
  const add = (source, target, kind, pointer) => {
    if (!reserve(1)) return;
    // Keep even excluded authority names out of the report; caller can repair the declaration privately.
    if (withheld(target)) { gap('authority-withheld', source); return; }
    result.references.push(edge(source, target, kind, pointer));
  };
  const moves = path => {
    const artifact = snapshot.layout.moves?.artifacts.find(item => item.current === path);
    for (const prior of artifact?.previous ?? []) {
      // One revision-qualified locator and all of its basis edges are an indivisible declaration.
      // Withheld rows still consume the joint budget; historical names never become current-path edges.
      if (!reserve(prior.basis.length, 1)) break;
      if ([prior.path, ...prior.basis].some(withheld)) { gap('move-withheld', path); continue; }
      const pointer = prior.source.slice(REGISTRY_REL.length + 1);
      const basis = prior.basis.map((path, i) => ({ path, locator: { kind: 'json-pointer/1', pointer: `${pointer}/basis/${i}` } }));
      result.moves.push({ id: artifact.id, current: path, previous: { path: prior.path, revision: prior.revision }, basis, locator: { kind: 'json-pointer/1', pointer }, declaration: REGISTRY_REL });
      result.references.push(...basis.map(item => edge(path, item.path, 'move-basis', item.locator.pointer)));
    }
  };
  const links = (path, owner, kind) => {
    for (let i = 0; i < (owner?.authorityLinks?.length ?? 0) && !result.truncated; i++) add(path, owner.authorityLinks[i], kind, owner.source.slice(REGISTRY_REL.length + 1) + `/authorityLinks/${i}`);
  };
  const guards = (path, item) => {
    const matches = (prefix, target) => prefix === '.' || within(prefix, target);
    for (const [id, guard] of Object.entries(snapshot.layout.guards ?? {})) {
      if (result.truncated) break;
      const scope = guard.inputScope;
      // inputScope and command identity paths are always primary-repository declarations,
      // including guard/2. repositoryInputs never grants a cross-repository graph here.
      if (path === REGISTRY_REL || !scope.paths.some(prefix => matches(prefix, path)) || scope.exclusions.some(prefix => matches(prefix, path)) || (scope.mode === 'git' && !scope.includeUntracked && !item.env.tracked)) continue;
      if (sensitivePath(path) || privateReadPath(path)) { gap('guard-input-withheld', path); continue; }
      for (const [kind, values, suffix] of [['guard-authority', guard.authorityLinks, 'authorityLinks'], ['guard-code', guard.command.identityPaths, 'command/identityPaths']]) {
        for (let i = 0; i < values.length && !result.truncated; i++) {
          if (!reserve(1)) break;
          const target = values[i];
          if (withheld(target)) { gap('guard-dependency-withheld', path); continue; }
          result.references.push(edge(path, target, kind, `/instance/guards/${id}/${suffix}/${i}`));
        }
      }
    }
  };
  for (const path of paths) {
    if (result.truncated) break;
    const item = snapshot.objects.get(path);
    result.documents.push({ path, state: 'configuration-only', reason: 'body-not-read' });
    add(path, REGISTRY_REL, 'configuration', '');
    links(path, item.surface, 'surface-authority');
    links(path, item.mapped?.nativeProfile, 'native-profile-authority');
    if (snapshot.layout.recordStore && within(snapshot.layout.recordStore.path, path)) links(path, snapshot.layout.recordStore, 'record-store-authority');
    if (!result.truncated) moves(path);
    if (!result.truncated) guards(path, item);
  }
  try { check(); } catch { return withdraw(); }
  result.stable = true; result.complete = !result.findings.length && !result.truncated;
  return result;
}

/** A reverse scan must inspect every bound source in the explicit scope, not just the change seeds. */
export function readInventoryRelations(inventory, options = {}) {
  const limits = normalizeReadLimits(options), snapshot = readSnapshots.get(inventory);
  if (!snapshot?.input.selection || !snapshot.impact || snapshot.impact.configuration === 'only') throw new Error('影响分析需要进程内显式 paths-only 盘点 [curia2/impact-snapshot-required]');
  const allPaths = [...snapshot.objects.keys()].sort(), ignored = snapshot.impact.ignored;
  const ignoreStable = JSON.stringify(ignoredSourcePaths(snapshot.root, allPaths)) === JSON.stringify(ignored);
  const ignoredSet = new Set(ignored), paths = allPaths.filter(path => !ignoredSet.has(path));
  const overLimit = paths.length > IMPACT_LIMITS.maxSources;
  const sensitive = new Set(paths.filter(snapshot.impact.sensitivePath));
  const bound = overLimit || !ignoreStable ? [] : paths.filter(path => !sensitive.has(path) && snapshot.objects.get(path).mapped?.relations);
  const read = readSnapshotSelection(snapshot, limits, bound, snapshot.input.selection, true);
  for (const path of sensitive) read.findings.push({ code: 'impact/guard-sensitive-source', path, reason: '已登记 guard 的敏感范围在正文读取前扣留；无来源摘要或正文证据' });
  if (!ignoreStable) read.findings.push({ code: 'impact/ignore-snapshot-changed', path: null, reason: '盘点后忽略规则改变；不读取正文' });
  if (overLimit) read.findings.push({ code: 'impact/source-limit', path: null, reason: '授权扫描源数量超过硬上限；未读取正文' });
  if (!overLimit) {
    const byPath = new Map(read.documents.map(doc => [doc.path, doc]));
    read.documents = paths.map(path => ({ ...(byPath.get(path) ?? { path, state: 'not-read', reason: sensitive.has(path) ? 'guard-sensitive-source' : 'relations-unmapped', text: null, digest: null, envelope: null, observedAt: null }), binding: structuredClone(snapshot.objects.get(path).mapped?.relations ?? null) }));
  }
  if (!bound.length && paths.length && !overLimit && ignoreStable && !snapshot.inventoryErrors && !snapshot.input.selection.unmatched.length) {
    // A stable inventory with no readable bindings is not a source read; privacy findings survive.
    read.stable = true;
    read.findings = read.findings.filter(finding => finding.code !== 'read-selection-empty');
  }
  try {
    checkReadSnapshot(snapshot, allPaths);
    if (JSON.stringify(ignoredSourcePaths(snapshot.root, allPaths)) !== JSON.stringify(ignored)) throw new Error('ignore state changed');
  }
  catch { read.stable = false; }
  if (!read.stable) for (const doc of read.documents) { doc.state = 'not-read'; doc.reason = 'snapshot-incomplete'; doc.text = doc.range = doc.digest = doc.envelope = doc.observedAt = null; }
  return { ...read, privacy: { ...read.privacy, ignoredSourcesExcluded: ignored.length }, inventoryObjects: paths.length, overLimit };
}

/**
 * Read a capability minted by paths-only inventory. No serialized inventory, implicit files,
 * shell, network, cache or persistence. Metadata and context are derived from the same bytes.
 */
export function readInventorySelection(inventory, options = {}) {
  const limits = normalizeReadLimits(options), snapshot = readSnapshots.get(inventory);
  if (!snapshot?.input.selection || snapshot.impact) throw new Error('阅读需要本进程显式选集的 paths-only inventory [curia2/read-snapshot-required]');
  return readSnapshotSelection(snapshot, limits, [...snapshot.objects.keys()].sort(), snapshot.input.selection);
}

function readSnapshotSelection(snapshot, limits, paths, selection, relationJson = false) {
  const documents = [];
  const findings = [];
  const missing = selection.unmatched.length;
  const blocked = snapshot.inventoryErrors > 0 || missing > 0 || !paths.length;
  let chargedBytes = 0;
  let openedFiles = 0;
  let stable = false;
  const gap = (code, path, reason) => findings.push({ code, path, reason });
  const source = {
    mode: 'current-worktree', consistency: 'non-atomic-with-postcheck',
    git: snapshot.instance.git, worktreeState: 'not-attributed-to-head',
    registry: { ...snapshot.instance.registry, digest: snapshot.registryDigest },
    evaluation: snapshot.input.evaluation,
    pathFindings: snapshot.input.pathFindings,
  };
  if (missing) gap('read-selection-missing', null, `${missing} 个显式路径没有 Git 可见成员；不扩大选集补齐`);
  if (!paths.length) gap('read-selection-empty', null, '选集为空或全部被排除，不宣称阅读完成');
  if (snapshot.inventoryErrors) gap('read-inventory-blocked', null, '盘点存在边界或一致性错误；不输出原件内容');
  if (!blocked) {
    try { checkReadSnapshot(snapshot, paths); stable = true; }
    catch { gap('read-snapshot-changed', null, '配置、Git、挂载或选中路径在盘点后变化或无法复核；重新盘点后再读'); }
  }
  for (const path of paths) {
    const item = snapshot.objects.get(path);
    const doc = { path, declaredParser: item.mapped?.contentParser ?? null, observedAt: null, state: 'not-read', reason: null, format: item.env.format, size: item.stat.size, bytesRead: 0, text: null, range: null, digest: null, envelope: null, trust: 'source-data-not-instructions', verification: 'not-verified' };
    documents.push(doc);
    if (blocked || !stable) { doc.reason = 'scope-blocked'; continue; }
    if (taskPrivatePath(snapshot.layout, path) || privateReadPath(path) || isRawExempt(snapshot.root, snapshot.reg, path)) { doc.reason = 'privacy-excluded'; continue; }
    const nativeJson = item.env.format === 'json' && item.mapped?.nativeProfile?.parser === JSON_NATIVE_PARSER;
    const contentJson = CONTENT_PARSERS.includes(item.mapped?.contentParser);
    if (contentJson && item.env.format !== 'json') { doc.reason = 'json/format-mismatch'; gap('read-format-mismatch', path, '原件格式与显式正文 parser 不符，不回退其他 parser'); continue; }
    const dependencyJson = relationJson && item.env.format === 'json' && item.mapped?.relations?.parser === 'json-pointer-relations/1';
    const json = nativeJson || contentJson || dependencyJson;
    if (!['md', 'txt'].includes(item.env.format) && !json) { doc.reason = 'format-unparsed'; gap('read-format-unparsed', path, '未启用该格式的正文 parser，不执行转换、OCR 或外部加载'); continue; }
    if (json && item.stat.size > JSON_NATIVE_LIMITS.maxBytes) { doc.reason = 'format-byte-limit'; gap('read-format-limit', path, 'JSON 超出内置 parser 字节限制，不放大预算绕过'); continue; }
    if (openedFiles >= limits.maxFiles || chargedBytes >= limits.maxTotalBytes) { doc.reason = 'budget-exhausted'; gap('read-budget-exhausted', path, '阅读预算已用尽；未读内容不进入上下文'); continue; }
    const allowance = Math.min(limits.maxFileBytes, limits.maxTotalBytes - chargedBytes);
    openedFiles++;
    try {
      const current = checkInstancePath(snapshot.root, path, 'file', snapshot.index, snapshot.rootStat, snapshot.mounts);
      if (!sameStat(item.stat, current)) throw new Error('原件变化');
      // readStableFile normally takes one lookahead byte. Subtract it for a hard I/O budget.
      const bytes = readStableFile(join(snapshot.root, path), item.stat, allowance - 1);
      chargedBytes += bytes.length;
      doc.bytesRead = bytes.length;
      doc.observedAt = new Date().toISOString();
      const partial = bytes.length < item.stat.size;
      let text;
      try {
        text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes, { stream: partial });
      } catch {
        doc.reason = 'invalid-utf8'; gap('read-encoding-invalid', path, '不是可无损读取的 UTF-8，不用替换字符掩盖损坏'); continue;
      }
      if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text)) { doc.reason = 'binary-or-control'; gap('read-encoding-invalid', path, '包含二进制或终端控制字符，不输出正文'); continue; }
      const projectedBytes = Buffer.byteLength(text, 'utf8');
      if (json && !partial) {
        try { const data = parseDataJson(text); if (nativeJson && (!data || typeof data !== 'object' || Array.isArray(data))) throw Object.assign(new Error(), { code: 'json/root-not-object' }); }
        catch (error) { doc.reason = error.code ?? 'json/syntax-invalid'; gap('read-format-invalid', path, `JSON 原件拒绝解析（${doc.reason}）；不输出无效载荷`); continue; }
      }
      if (item.mapped?.contentParser === ORIGINALS_PARSER && !partial) {
        const inspected = inspectOriginalRegister({ text, encodingState: 'valid', truncated: false }, path);
        if (inspected.state !== 'parsed') { doc.reason = inspected.reason; gap('read-register-invalid', path, `原件登记拒绝解析（${doc.reason}）；不输出无效载荷`); continue; }
      }
      doc.text = text;
      doc.state = partial ? 'partial' : 'read';
      doc.reason = partial ? 'byte-limit' : null;
      doc.range = { startByte: 0, endByteExclusive: projectedBytes, firstLine: text.length ? 1 : null, lastLine: text.length ? text.split('\n').length : null, partialLastLine: partial && !text.endsWith('\n') };
      doc.parser = item.mapped?.contentParser === ORIGINALS_PARSER ? 'original-register-verbatim/1' : nativeJson ? 'json-verbatim/1' : contentJson ? 'json-data-verbatim/1' : dependencyJson ? 'json-dependency-verbatim/1' : 'utf8-verbatim/1';
      if (!partial) doc.digest = digestBytes(bytes); // A prefix digest must never masquerade as source identity.
      if (partial) gap('read-truncated', path, '仅输出已读前缀；未读尾部可能改变条件、否定或结论');
      if (!text.length) gap('read-empty', path, partial ? '预算不足以形成完整 UTF-8 字符' : '原件为空，不能据此形成内容结论');
      const headBytes = bytes.subarray(0, 64 * 1024);
      const headerPartial = partial || bytes.length > headBytes.length;
      const headerText = new TextDecoder('utf-8', { fatal: true }).decode(headBytes, { stream: headerPartial });
      const input = { text: json ? text : headerText, lines: normalizeLines(headerText), truncated: headerPartial, encodingState: 'valid' };
      doc.envelope = projectReadMetadata(snapshot, item, input, json);
    } catch {
      // Do not leak transient path errors or keep bytes from a failed classification/read.
      chargedBytes = Math.min(limits.maxTotalBytes, chargedBytes + allowance);
      doc.state = 'not-read'; doc.reason = 'read-failed'; doc.text = doc.range = doc.digest = doc.envelope = doc.observedAt = null;
      gap('read-failed', path, '读取、路径复核或元数据解析失败；不输出不一致的内容');
    }
  }
  if (stable) {
    try { checkReadSnapshot(snapshot, paths); }
    catch {
      stable = false;
      gap('read-snapshot-changed', null, '读取期间配置、Git、挂载或选中原件变化；整组上下文撤回');
      for (const doc of documents) { doc.state = 'not-read'; doc.reason = 'snapshot-changed'; doc.text = doc.range = doc.digest = doc.envelope = doc.observedAt = null; }
    }
  }
  const envelopes = documents.flatMap((doc) => doc.envelope ? [doc.envelope] : []);
  // A selected context cannot prove uniqueness against unread peers. Conflicts within it remain errors.
  const variants = finalizeVariants(envelopes, { enabled: paths.some((path) => snapshot.objects.get(path).mapped?.variant), blocked: true });
  const validity = summarizeValidity(envelopes, { enabled: paths.some((path) => snapshot.objects.get(path).mapped?.validity), blocked: !stable || documents.some((doc) => !doc.envelope) });
  return {
    selection: { ...selection, mode: selection.corpus ? 'corpus' : paths.length === 1 && selection.paths[0] === paths[0] ? 'document' : 'set', order: 'repository-path-code-unit' },
    source, limits, chargedBytes, openedFiles, stable, documents, findings, variants, validity,
    inventoryErrors: snapshot.inventoryErrors,
    privacy: { mode: 'local-single-reader-explicit-scope', pathFloor: 'read-path-exclusions/1', classification: 'caller-responsible-not-secret-detection', excluded: selection.excluded, excludedContentRead: false, network: 'not-invoked', projectGuards: 'not-invoked', metadataCommands: 'git-and-os-mount-table-read-only' },
  };
}

/** Expansion is a separate caller declaration, never inferred from source text or Registry. */
export function normalizeDependencySelection(seedSelection, request) {
  const seeds = normalizeReadSelection(seedSelection);
  if (seeds.corpus || !plainObject(request) || Object.keys(request).some(key => !['within', 'nonSensitive'].includes(key)) || request.nonSensitive !== true || !Array.isArray(request.within) || !request.within.length || request.within.length > 128 || seeds.paths.length > 128) throw new Error('依赖读取需要局部种子、显式 within 与非敏感声明 [curia2/dependency-options-invalid]');
  const within = normalizeReadSelection({ paths: request.within }).paths;
  const paths = [...new Set([...seeds.paths, ...within])];
  return { seeds, authorization: { within, nonSensitive: true, basis: 'explicit-local-single-reader-allowlist' }, selection: normalizeReadSelection({ paths, exclusions: seeds.exclusions }) };
}

/** Expand only within this process's original paths-only capability; do not re-inventory per hop. */
export function readInventoryDependencies(inventory, seedSelection, request, options = {}) {
  const limits = normalizeReadLimits(options), declared = normalizeDependencySelection(seedSelection, request);
  const snapshot = readSnapshots.get(inventory);
  if (!snapshot?.input.selection || snapshot.impact || ['paths', 'exclusions', 'corpus'].some(key => JSON.stringify(snapshot.input.selection[key]) !== JSON.stringify(declared.selection[key]))) throw new Error('依赖读取需要相同授权范围的进程内盘点 [curia2/dependency-snapshot-required]');
  const allowedPaths = [...snapshot.objects.keys()].sort();
  const seeds = allowedPaths.filter(path => declared.seeds.paths.some(prefix => selectedPath(prefix, path)));
  const documents = [], findings = [];
  let chargedBytes = 0, openedFiles = 0, stable = snapshot.inventoryErrors === 0 && !snapshot.input.selection.unmatched.length;
  let source = null, privacy = null;
  const closure = traverseDependencies({ allowedPaths, seeds, readDocument(path) {
    const remaining = { maxFiles: stable ? limits.maxFiles - openedFiles : 0, maxFileBytes: limits.maxFileBytes, maxTotalBytes: limits.maxTotalBytes - chargedBytes };
    const read = readSnapshotSelection(snapshot, remaining, [path], snapshot.input.selection, true);
    chargedBytes += read.chargedBytes; openedFiles += read.openedFiles; stable = stable && read.stable;
    source ??= read.source; privacy ??= read.privacy; findings.push(...read.findings);
    const doc = read.documents[0]; documents.push(doc);
    return { ...doc, binding: structuredClone(snapshot.objects.get(path).mapped?.relations ?? null) };
  } });
  // Empty/over-limit input still reports the snapshot and preflight gaps, without opening a document.
  if (!source) {
    const empty = readSnapshotSelection(snapshot, { ...limits, maxFiles: 0 }, [], snapshot.input.selection, true);
    source = empty.source; privacy = empty.privacy; findings.push(...empty.findings); stable = stable && empty.stable;
  }
  try { checkReadSnapshot(snapshot, documents.map(doc => doc.path)); }
  catch { stable = false; }
  if (!stable) {
    findings.push({ code: 'read-snapshot-incomplete', path: null, reason: '授权快照、配置或曾读原件无法共同复核；整组上下文与依赖图撤回' });
    for (const doc of documents) { doc.state = 'not-read'; doc.reason = 'snapshot-changed'; doc.text = doc.range = doc.digest = doc.envelope = doc.observedAt = null; }
    closure.state = 'incomplete'; closure.complete = false; closure.nodes = []; closure.edges = [];
    closure.findings.push({ code: 'dependency/snapshot-incomplete', path: null, reason: '输入快照不稳定，依赖图不作为本次结论' });
  }
  documents.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const envelopes = documents.flatMap(doc => doc.envelope ? [doc.envelope] : []);
  const mapped = documents.map(doc => snapshot.objects.get(doc.path).mapped);
  const variants = finalizeVariants(envelopes, { enabled: mapped.some(item => item?.variant), blocked: true });
  const validity = summarizeValidity(envelopes, { enabled: mapped.some(item => item?.validity), blocked: !stable || documents.some(doc => !doc.envelope) });
  return {
    selection: { ...declared.seeds, mode: 'dependency-closure', expandedPaths: documents.map(doc => doc.path), excluded: snapshot.input.selection.excluded, exclusionBasis: 'authorized-inventory', unmatched: snapshot.input.selection.unmatched, order: 'breadth-first-read-repository-path-output' },
    authorization: declared.authorization, source, privacy, limits, chargedBytes, openedFiles, stable, documents, findings: [...findings, ...closure.findings], variants, validity, inventoryErrors: snapshot.inventoryErrors, closure,
  };
}

/**
 * 构建 P1 基础 inventory。注意这是「头块级 Envelope 投影」：
 * classified 只说明类型可解析，contentRead 只说明元数据被读，不等于全文阅读或事实核验。
 */
export function buildInventory(inputRoot = ROOT, registry = null, options = {}) {
  // Fail before any clock callback or I/O: truthy strings must not widen reads.
  const optionKeys = ['includeUntracked', 'allowNoGit', 'linkCoverage', 'at', 'now', 'readMetadata', 'selection', 'metadataSelection', 'metadataLimits'];
  if (!plainObject(options) || Object.keys(options).some((key) => !optionKeys.includes(key)) || ['includeUntracked', 'allowNoGit', 'linkCoverage', 'readMetadata'].some((key) => options[key] !== undefined && typeof options[key] !== 'boolean') || (options.now !== undefined && !['string', 'function'].includes(typeof options.now))) {
    throw new Error('inventory 选项含未知字段、非布尔开关或非法时钟；不隐式扩大读取范围 [curia2/options-invalid]');
  }
  const { includeUntracked = false, allowNoGit = false, linkCoverage = false, readMetadata = true, at = undefined, now = () => new Date().toISOString() } = options;
  if (!readMetadata && options.metadataLimits !== undefined) throw new Error('paths-only 盘点不消费元数据预算 [curia2/options-invalid]');
  const metadataState = { schema: 'curia.metadata-observation/1', limits: normalizeMetadataLimits(options.metadataLimits ?? {}), registryMaxBytes: REGISTRY_BYTE_LIMIT, headerMaxBytes: HEADER_BYTE_LIMIT, jsonMaxBytes: JSON_NATIVE_LIMITS.maxBytes, linkMaxBytes: LINK_SCAN_LIMIT, requested: 0, openedFiles: 0, chargedBytes: 0, budgetLimited: 0, privacyExcluded: 0, stable: true, bodiesEmitted: 0 };
  const metadataObjects = new Map();
  const impactRequest = impactInventoryRequests.get(options);
  const taskInventory = taskInventoryRequests.has(options);
  if ((!readMetadata && linkCoverage) || (readMetadata && options.selection !== undefined)) throw new Error('路径盘点不能读取链接，selection 仅用于路径盘点 [curia2/options-invalid]');
  if (options.metadataSelection !== undefined && (!readMetadata || allowNoGit || options.selection !== undefined)) throw new Error('metadataSelection 仅用于有 Git 边界的元数据查询，不能混用路径盘点 selection [curia2/options-invalid]');
  const metadataSelection = options.metadataSelection === undefined ? null : normalizeReadSelection(options.metadataSelection);
  const selection = metadataSelection ?? (options.selection === undefined ? null : normalizeReadSelection(options.selection));
  const generatedAt = evaluationInstant(typeof now === 'function' ? now() : now);
  const evaluatedAt = at === undefined ? generatedAt : evaluationInstant(at);
  const evaluation = { at: evaluatedAt, source: at === undefined ? 'generated-at' : 'explicit', contentBaseline: 'current-worktree-not-historical-reconstruction' };
  const instance = resolveInstance(inputRoot, { allowNoGit });
  let rootStat;
  try {
    rootStat = lstatSync(instance.root);
  } catch (e) {
    throw new Error(`Curia instance root 二次 lstat 失败：${e.message} [curia2/root-unavailable]`);
  }
  if (!rootStat.isDirectory()) throw new Error('Curia instance root 不是真实目录 [curia2/root-unavailable]');
  const index = instance.available ? gitIndexRecords(instance.root) : new Map();
  const indexFingerprintBefore = instance.available ? indexFingerprint(index) : null;
  const initialMounts = instance.available ? instanceMounts(instance.root) : [];
  if (instance.available) {
    try { checkInstancePath(instance.root, REGISTRY_REL, 'file', index, rootStat, initialMounts); }
    catch (error) { throw new Error(`${error.message} [curia2/registry-boundary]`); }
  }
  const registryState = loadInstanceRegistry(instance, index);
  let reg;
  let layout;
  try {
    // The observed file is the only effective configuration. The legacy argument
    // may assert an identical normalized value, but cannot mask or replace it.
    reg = normalizeRegistry(registryState.registry);
    if (registry !== null) {
      normalizeRegistry(registry); // Retain schema diagnostics; never use the caller copy as configuration.
      if (!equalRegistryData(registryState.registry, registry)) {
        throw new Error('调用方 Registry 与实际来源不一致；不能替换生效配置 [curia2/registry-source-mismatch]');
      }
    }
    layout = normalizeInstance(reg.instance, reg.types);
  } catch (e) {
    throw new Error(e.message.includes('[curia2/') ? e.message : `${e.message} [curia2/registry-invalid]`);
  }
  const variantsEnabled = layout.mappings.some((mapping) => mapping.variant);
  const validityEnabled = layout.mappings.some((mapping) => mapping.validity);
  const members = layout.surfaces.flatMap((surface) => surface.members.map((member) => ({ ...member, surfaceId: surface.id, surface, state: 'unavailable-no-git' })));
  const refs = layout.surfaces.flatMap((surface) => surface.source ? [surface.entry, ...surface.authorityLinks] : []);
  for (const profile of Object.values(layout.nativeProfiles)) refs.push(...profile.authorityLinks);
  const inventoryPaths = [...new Set([...members.map((member) => member.path), ...layout.surfaces.filter((surface) => surface.discovery).map((surface) => surface.discovery.path), ...refs])];
  // Literal pathspecs prevent leading ':' and bracket-like project names from changing Git scope.
  const gitPaths = inventoryPaths.map((path) => `:(literal)${path === '.' ? '' : path}`);
  let untrackedPathsBefore = [];
  if (instance.available && includeUntracked) {
    try {
      untrackedPathsBefore = [...new Set(gitOutput(instance.root, ['ls-files', '--others', '--exclude-standard', '-z', '--', ...gitPaths]).split('\0').filter(Boolean))].sort();
    } catch (e) {
      throw new Error(`未忽略 untracked 集合不可读取：${e.message} [curia2/untracked-unavailable]`);
    }
  }
  const headResult = instance.available ? gitHead(instance.root) : { head: null, state: 'unavailable-no-git', error: null };
  const head = headResult.head;
  const headTree = instance.available ? gitHeadEntries(instance.root, head, gitPaths) : { available: false, becauseNoHead: true, invalid: false, entries: new Map() };
  let registryRevision = readMetadata ? structuredClone(registryState.rawRevision) : null;
  let registryModified = registryRevision?.matchesIndex === null || !registryRevision ? null : !registryRevision.matchesIndex;
  const registryHeadEntry = registryState.tracked && headTree.available ? headTree.entries.get(REGISTRY_REL) ?? null : null;
  const registryIndexMatchesHead = registryState.tracked && headTree.available
    ? indexMatchesHeadEntry({ mode: registryState.indexMode, oid: registryState.indexOid }, registryHeadEntry)
    : null;
  const findings = [];
  if (instance.available && headResult.state === 'unknown') {
    findings.push({
      code: 'head-unknown',
      severity: 'error',
      count: 1,
      samples: inventoryPaths,
      detail: `Git HEAD 不可确认：${headResult.error ?? '空输出'}`,
    });
  } else if (instance.available && !head) {
    findings.push({
      code: 'head-unavailable',
      severity: 'coverage',
      count: 1,
      samples: inventoryPaths,
      detail: '仓库尚无 HEAD commit；index 与提交基线不可比较',
    });
  }
  if (instance.available && head && headTree.invalid) {
    findings.push({
      code: 'head-tree-invalid',
      severity: 'error',
      count: 1,
      samples: inventoryPaths,
      detail: `${headTree.error} [curia2/head-tree-invalid]`,
    });
  } else if (instance.available && head && !headTree.available) {
    findings.push({
      code: 'head-tree-unknown',
      severity: 'error',
      count: 1,
      samples: inventoryPaths,
      detail: 'Git HEAD 可解析但 ls-tree 无法读取受管面基线；不能判断 index 与 HEAD 差异',
    });
  }
  if (instance.available && !registryState.tracked) {
    findings.push({
      code: 'registry-untracked',
      severity: 'coverage',
      count: 1,
      samples: [REGISTRY_REL],
      detail: 'Registry 只存在于工作树，尚未进入 Git index；配置 authority 不随提交固定',
    });
  } else if (registryModified === true) {
    findings.push({
      code: 'registry-worktree-modified',
      severity: 'coverage',
      count: 1,
      samples: [REGISTRY_REL],
      detail: 'Registry 工作树内容与 Git index 不同；输出使用工作树配置并显式保留 index OID',
    });
  }
  if (registryIndexMatchesHead === false) {
    findings.push({
      code: 'registry-index-differs-from-head',
      severity: 'coverage',
      count: 1,
      samples: [REGISTRY_REL],
      detail: 'Registry Git index 内容与查询时 HEAD 不同；输出保留双方对象身份',
    });
  }
  const envelopes = [];
  const readObjects = new Map();
  const selectedCounts = selection ? { discovered: 0, selected: 0, excluded: 0, matched: new Set() } : null;
  const surfaceReport = () => layout.surfaces.map((surface) => {
    const children = members.filter((member) => member.surfaceId === surface.id).map(({ surface: _surface, stat: _stat, ...member }) => member);
    return { ...surface, ...(layout.explicit ? { owner: surface.owner ?? layout.owner, ownerSource: surface.owner ? `${surface.source}/owner` : `${REGISTRY_REL}#/instance/owner` } : {}), members: children, ...(children.length === 1 ? { path: children[0].path, role: children[0].role, required: children[0].required } : {}), state: children.length === 1 ? children[0].state : children.every((member) => member.state === 'active') ? 'active' : children.some((member) => member.state.endsWith('error')) ? 'member-error' : children.every((member) => member.state === 'unavailable-no-git') ? 'unavailable-no-git' : 'partial-or-absent' };
  });
  if (!instance.available) {
    try {
      const rootAfter = lstatSync(instance.root);
      if (rootAfter.dev !== rootStat.dev || rootAfter.ino !== rootStat.ino) throw new Error('instance root inode 变化');
    } catch (e) {
      aggregateFinding(findings, 'root-changed-during-inventory', 'error', '.', e.message);
    }
    try {
      if (!sameStat(registryState.stat, lstatSync(join(instance.root, REGISTRY_REL)))) throw new Error('Registry 路径元数据变化');
    } catch (e) {
      aggregateFinding(findings, 'registry-changed-during-inventory', 'error', REGISTRY_REL, e.message);
    }
    findings.push({
      code: 'instance-no-git',
      severity: 'not-applicable',
      count: 1,
      samples: [],
      detail: '显式 allow-no-git：无 Git 边界时不生成 Envelope，不宣称任何对象已纳管',
    });
    return {
      schema: SCHEMA,
      generatedAt,
      input: {
        mode: 'unavailable-no-git',
        contentSource: 'not-read',
        evaluation: { ...evaluation, contentBaseline: 'not-read' },
        includeUntracked,
        linkCoverage,
        consistency: 'not-applicable',
      },
      instance: {
        root: instance.root,
        gitRoot: null,
        boundary: instance.boundary,
        git: { head: null, headState: 'unavailable-no-git', headTreeAvailable: false, headTreeInvalid: false },
        registry: {
          source: REGISTRY_REL,
          schemaVersion: reg.version,
          instanceSchema: layout.schema,
          layoutSource: layout.explicit ? 'instance' : 'default-two-roots',
          contentSource: registryState.contentSource,
          tracked: registryState.tracked,
          authority: 'worktree-file',
          indexMode: registryState.indexMode,
          indexOid: registryState.indexOid,
          indexStage: registryState.indexStage,
          worktreeMatchesIndex: registryModified === null ? null : !registryModified,
          ...(readMetadata ? { worktree: registryRevision } : {}),
          indexMatchesHead: registryIndexMatchesHead,
          headMode: registryHeadEntry?.mode ?? null,
          headOid: registryHeadEntry?.oid ?? null,
        },
        surfaces: surfaceReport(),
        access: { mode: 'local-single-reader', actorFiltering: 'not-required-local' },
      },
      coverage: {
        files: 0,
        bySurface: {},
        byRole: {},
        byType: {},
        byStatus: {},
        byStatusView: {},
        byNativeState: {},
        byValidity: {},
        byCellState: {},
        variants: finalizeVariants([], { enabled: variantsEnabled, available: false }),
        validity: summarizeValidity([], { enabled: validityEnabled, available: false }),
        byFormat: {},
        byOwner: {},
        byMaintenance: {},
        byRepresentation: {},
        byMetadataRead: {},
        byTracked: {},
        byWorktreeState: {},
        byIndexState: {},
        metadataRead: 0,
        contentUnparsed: 0,
        links: summarizeLinks([], linkCoverage, false),
        coverageGaps: findings.filter((f) => f.severity === 'coverage').reduce((n, f) => n + f.count, 0),
        errors: findings.filter((f) => f.severity === 'error').reduce((n, f) => n + f.count, 0),
      },
      findings,
      envelopes,
    };
  }

  const mounts = initialMounts, mountError = false;
  const metadataPaths = readMetadata ? [...new Set(members.flatMap(surface => surfacePaths(surface.path, index, untrackedPathsBefore).map(item => item.rel)))].filter(path => !metadataSelection || ((metadataSelection.corpus || metadataSelection.paths.some(prefix => selectedPath(prefix, path))) && !metadataSelection.exclusions.some(prefix => selectedPath(prefix, path)))).sort() : [];
  const baselineBlocked = checkInstanceBaseline(instance.root, layout, headTree, findings);
  const layoutState = layout.explicit && !mountError ? inspectInstanceLayout(instance.root, layout, index, untrackedPathsBefore, rootStat, findings, mounts) : { checked: [], blocked: mountError };
  layoutState.blocked ||= baselineBlocked;
  const metadataSafePaths = readMetadata && !layoutState.blocked ? metadataPaths.filter(path => {
    try { checkInstancePath(instance.root, path, 'file', index, rootStat, mounts); return true; } catch { return false; }
  }) : [];
  const metadataIgnored = readMetadata ? ignoredSourcePaths(instance.root, metadataSafePaths) : [];
  for (const surface of members) {
    if (layoutState.blocked) { surface.state = 'layout-error'; continue; }
    const abs = join(instance.root, surface.path);
    let st;
    try {
      st = lstatSync(abs);
    } catch (e) {
      if (e.code === 'ENOENT') {
        const hasEntries = surfacePaths(surface.path, index, untrackedPathsBefore).length > 0;
        const missingIsError = surface.required || hasEntries;
        surface.state = missingIsError ? 'missing-error' : 'absent-optional';
        if (missingIsError) {
          findings.push({
            code: 'surface-missing',
            severity: 'error',
            count: 1,
            samples: [surface.path],
            detail: surface.required ? '必需受管面缺失' : '可选受管面缺失，但 Git index 仍声明其对象',
          });
        }
        continue;
      }
      surface.state = 'stat-error';
      findings.push({
        code: 'surface-stat-failed',
        severity: 'error',
        count: 1,
        samples: [surface.path],
        detail: e.message,
      });
      continue;
    }
    if (st.isSymbolicLink()) {
      surface.state = 'symlink-error';
      findings.push({
        code: 'surface-symlink',
        severity: 'error',
        count: 1,
        samples: [surface.path],
        detail: '受管面根不能是符号链接',
      });
      continue;
    }
    if (surface.kind === 'file' ? !st.isFile() : !st.isDirectory()) {
      surface.state = 'not-directory-error';
      findings.push({
        code: 'surface-not-directory',
        severity: 'error',
        count: 1,
        samples: [surface.path],
        detail: `受管面成员形态与声明 ${surface.kind} 不符`,
      });
      continue;
    }
    let real;
    try {
      real = realpathSync(abs);
    } catch (e) {
      surface.state = 'boundary-error';
      findings.push({
        code: 'surface-realpath-failed',
        severity: 'error',
        count: 1,
        samples: [surface.path],
        detail: e.message,
      });
      continue;
    }
    if (real !== abs || !within(instance.root, real)) {
      surface.state = 'boundary-error';
      findings.push({
        code: 'surface-boundary-escape',
        severity: 'error',
        count: 1,
        samples: [surface.path],
        detail: `realpath 越出 instance boundary：${real}`,
      });
      continue;
    }
    if (layout.explicit) {
      try { checkInstancePath(instance.root, surface.path, surface.kind, index, rootStat, mounts); }
      catch (e) {
        surface.state = 'boundary-error';
        aggregateFinding(findings, 'member-boundary-invalid', 'error', surface.path, e.message);
        continue;
      }
    }
    surface.stat = st;
    surface.state = 'active';

    for (const item of surfacePaths(surface.path, index, untrackedPathsBefore)) {
      if (selection) {
        selectedCounts.discovered++;
        const matches = selection.paths.filter((path) => selectedPath(path, item.rel));
        if (!selection.corpus && !matches.length) continue;
        for (const path of matches) selectedCounts.matched.add(path);
        if (selection.exclusions.some((path) => selectedPath(path, item.rel)) || (!taskInventory && (privateReadPath(item.rel) || taskPrivatePath(layout, item.rel))) || isRawExempt(instance.root, reg, item.rel) || (metadataSelection && metadataIgnored.includes(item.rel))) {
          selectedCounts.excluded++;
          continue;
        }
        selectedCounts.selected++;
      }

      const absItem = join(instance.root, item.rel);
      const nested = nestedRepositoryRoot(instance.root, item.rel);
      const itemEntries = index.get(item.rel) ?? [];
      if (itemEntries.length > 1 || itemEntries.some((candidate) => candidate.stage !== 0)) {
        aggregateFinding(findings, 'index-conflict', 'error', item.rel, 'Git index 条目处于 conflict stage；不选择任一 stage 投影');
        continue;
      }
      const indexEntry = itemEntries[0] ?? null;
      const headEntry = headTree.available ? headTree.entries.get(item.rel) ?? null : null;
      const indexMatchesHead = indexEntry && headTree.available
        ? indexMatchesHeadEntry(indexEntry, headEntry)
        : null;
      const itemMode = indexEntry?.mode ?? null;
      if (itemMode === '160000') {
        aggregateFinding(findings, 'nested-repository', 'error', item.rel, 'Git gitlink 指向嵌套独立仓库；本工具不把其内容并入本实例');
        continue;
      }
      if (nested) {
        aggregateFinding(findings, 'nested-repository', 'error', nested, '受管面内发现嵌套独立仓库；本工具不把其内容并入本实例');
        continue;
      }
      if (itemMode && itemMode !== '100644' && itemMode !== '100755' && itemMode !== '120000') {
        aggregateFinding(findings, 'path-not-file', 'error', item.rel, `Git index 形态不是常规文件：${itemMode}`);
        continue;
      }
      let stat;
      try {
        stat = lstatSync(absItem);
      } catch (e) {
        if (e.code === 'ENOENT') {
          if (impactRequest?.changes.has(item.rel) && item.tracked && ['100644', '100755'].includes(itemMode)) {
            try {
              const parent = dirname(item.rel), parentStat = checkInstancePath(instance.root, parent, 'directory', index, rootStat, mounts);
              let absent = false;
              try { lstatSync(absItem); } catch (error) { if (error.code !== 'ENOENT') throw error; absent = true; }
              if (absent) { impactRequest.missing.set(item.rel, { parent, stat: parentStat }); continue; }
            } catch { /* An unsafe or unavailable parent remains an ordinary inventory error. */ }
          }
          if (item.tracked) aggregateFinding(findings, 'tracked-missing', 'error', item.rel, 'Git 条目在当前工作树缺失；默认 inventory 不读取 HEAD 替代实际输入');
          else aggregateFinding(findings, 'path-missing', 'error', item.rel, 'untracked 条目在枚举后消失；不投影竞争中的路径');
        } else {
          aggregateFinding(findings, 'path-stat-failed', 'error', item.rel, e.message);
        }
        continue;
      }
      let realItem;
      try {
        realItem = realpathSync(absItem);
      } catch (e) {
        if (e.code === 'ENOENT') {
          if (item.tracked) aggregateFinding(findings, 'tracked-missing', 'error', item.rel, 'Git 条目在当前工作树缺失；默认 inventory 不读取 HEAD 替代实际输入');
          else aggregateFinding(findings, 'path-missing', 'error', item.rel, 'untracked 条目在枚举后消失；不投影竞争中的路径');
        } else {
          aggregateFinding(findings, 'path-boundary-unknown', 'error', item.rel, `真实路径不可解析：${e.message}`);
        }
        continue;
      }
      if (stat.isSymbolicLink() || itemMode === '120000' || realItem !== absItem || !within(instance.root, realItem)) {
        aggregateFinding(findings, 'path-symlink', 'error', item.rel, '受管面内符号链接、路径别名或真实路径越界不跟随、不投影');
        continue;
      }
      if (!stat.isFile()) {
        aggregateFinding(findings, 'path-not-file', 'error', item.rel, '受管面条目不是常规文件；不按目录、FIFO 或其他特殊形态投影');
        continue;
      }
      if (stat.nlink !== 1) {
        aggregateFinding(findings, 'path-hardlink', 'error', item.rel, '受管面常规文件存在硬链接别名；无法证明内容只属于本实例，不投影');
        continue;
      }

      const env = baseEnvelope({
        rel: item.rel,
        surface: surface.surfaceId,
        role: surface.role,
        tracked: item.tracked,
        worktreeModified: null,
        indexMatchesHead,
        format: formatOf(item.rel),
        indexEntry,
        headEntry,
      });
      {
        try { checkInstancePath(instance.root, item.rel, 'file', index, rootStat, mounts); }
        catch (e) { aggregateFinding(findings, 'member-boundary-invalid', 'error', item.rel, e.message); continue; }
      }
      if (layout.explicit) env.identity.member = surface.path;
      const mapped = layout.explicit ? mappingFor(layout, surface.surface, item.rel) : null;
      if (!readMetadata) {
        env.type = env.status = env.maintenance = 'unknown';
        env.typeSource = env.statusSource = 'not-read';
        env.metadataRead = 'not-parsed';
        env.gaps.push('type-unknown', 'owner-unknown', 'status-unknown', 'maintenance-unknown', 'content-unparsed');
        readObjects.set(item.rel, { stat, surface: structuredClone(surface.surface ?? surface), member: { path: surface.path, role: surface.role }, env: structuredClone(env), mapped: structuredClone(mapped) });
        envelopes.push(env);
        continue;
      }
      let bytes = null;
      const excluded = item.rel !== REGISTRY_REL && (taskPrivatePath(layout, item.rel) || privateReadPath(item.rel) || (reg.rawMarker && isRawExempt(instance.root, reg, item.rel)) || metadataIgnored.includes(item.rel)) ? 'privacy-excluded' : null;
      metadataObjects.set(item.rel, { stat, excluded, env });
      if (excluded) metadataState.privacyExcluded++;
      try {
        const parser = hasBoundHeader(mapped) ? parseNativeHeader : parseHeader;
        const contentMismatch = mapped?.contentParser && env.format !== 'json';
        const pathClassified = item.rel === reg.projection || (surface.path === '.agents' && (item.rel === REGISTRY_REL || item.rel.startsWith('.agents/templates/')));
        const header = !contentMismatch && env.format === 'md' && (!pathClassified || mapped);
        const json = !contentMismatch && env.format === 'json' && (mapped?.nativeProfile?.parser === JSON_NATIVE_PARSER || CONTENT_PARSERS.includes(mapped?.contentParser));
        const links = linkCoverage && env.format === 'md';
        const oversizedJson = json && stat.size > JSON_NATIVE_LIMITS.maxBytes;
        let limited = false;
        if (!excluded && item.rel !== REGISTRY_REL && (header || json || links) && !oversizedJson) {
          const observed = readMetadataBytes(instance.root, item.rel, stat, links ? LINK_SCAN_LIMIT : json ? JSON_NATIVE_LIMITS.maxBytes : HEADER_BYTE_LIMIT, metadataState);
          bytes = observed.bytes; limited = observed.budgetLimited;
        }
        const input = excluded ? { ...parseMetadataBytes(null, stat), privacyExcluded: true } : oversizedJson ? { lines: [], text: null, truncated: true, encodingState: 'valid' } : parseMetadataBytes(bytes, stat, !!json);
        if (limited) env.gaps.push('metadata-read-budget');
        if (excluded) env.gaps.push('metadata-privacy-excluded');
        if (contentMismatch || excluded || (limited && bytes === null)) {
          env.type = env.status = env.maintenance = 'unknown'; env.typeSource = env.statusSource = 'unknown'; env.metadataRead = 'not-parsed';
          env.gaps.push('type-unknown', 'owner-unknown', 'status-unknown', 'content-unparsed');
        } else if (surface.path === '.agents') classifyControlEnvelope(instance.root, reg, item.rel, env.format, env, stat, parser, input);
        else classifyKnowledgeEnvelope(instance.root, reg, item.rel, env.format, env, stat, parser, input);
        if (mapped) applyInstanceMetadata(env, mapped, surface.surface, contentMismatch ? null : env.format === 'md' || json ? input : null, reg, evaluatedAt);
        if (!contentMismatch && !excluded && !(limited && bytes === null)) applyRepresentation(env, mapped, reg);
        const reason = excluded ?? (limited ? 'metadata-budget' : bytes && bytes.length !== stat.size ? 'metadata-prefix-only' : oversizedJson ? 'json-parser-limit' : 'metadata-not-read');
        env.git.worktree = item.rel === REGISTRY_REL ? structuredClone(registryRevision) : excluded ? unknownWorktreeRevision(excluded) : rawWorktreeRevision(indexEntry, stat, bytes, reason);
        env.worktreeModified = env.git.worktree.matchesIndex === null ? null : !env.git.worktree.matchesIndex;
      } catch (e) {
        env.type = 'unknown'; env.typeSource = 'unknown'; env.owner = null; env.ownerSource = 'unknown';
        env.status = 'unknown'; env.statusSource = 'unknown'; env.maintenance = 'unknown'; env.metadataRead = 'not-parsed';
        env.gaps.push('owner-unknown', 'status-unknown', 'type-unknown', 'content-unparsed');
        env.git.worktree = unknownWorktreeRevision('metadata-read-failed'); env.worktreeModified = null;
        if (mapped) applyInstanceMetadata(env, mapped, surface.surface, null, reg, evaluatedAt);
        aggregateFinding(findings, 'content-read-failed', 'error', item.rel, e.message);
      }
      if (linkCoverage) {
        applyLinkCoverage({ root: instance.root, reg, index, untrackedPaths: untrackedPathsBefore, includeUntracked, env, stat, buffer: bytes, excluded });
        for (const gap of env.linkCoverage?.gaps ?? []) if (!env.gaps.includes(gap)) env.gaps.push(gap);
        if (env.linkCoverage?.gaps.includes('link-target-missing')) aggregateFinding(findings, 'link-target-missing', 'error', item.rel, 'Markdown 相对链接目标缺失、越界或形态不安全；不宣称链接覆盖通过');
      }
      if (env.tracked && env.worktreeModified === null) env.gaps.push('worktree-revision-unobserved');
      try {
        checkInstancePath(instance.root, item.rel, 'file', index, rootStat, mounts);
        const statAfter = lstatSync(absItem);
        if (!sameStat(stat, statAfter)) throw new Error('路径元数据在读取期间变化');
      } catch (e) {
        aggregateFinding(findings, 'path-changed-during-read', 'error', item.rel, e.message);
        continue;
      }
      if (!env.maintenance || env.maintenance === 'unknown') env.gaps.push('maintenance-unknown');
      env.role = inferRole(surface.path, env.type, env.identity.path, env.role, env.typeSource);
      if (surface.role === 'record') env.role = 'record';
      if (env.role === 'unknown') {
        env.maintenance = 'unknown';
        if (!env.gaps.includes('maintenance-unknown')) env.gaps.push('maintenance-unknown');
        env.gaps.push('role-unknown');
      }
      if (env.role === 'record') {
        env.maintenance = 'record-mechanism-unknown';
        if (!env.gaps.includes('record-mutation-unknown')) env.gaps.push('record-mutation-unknown');
      }
      envelopes.push(env);
    }
  }

  if (metadataSelection) {
    for (const path of selection.paths.filter(path => !selectedCounts.matched.has(path))) aggregateFinding(findings, 'metadata-selection-unmatched', 'error', path, '显式路径未匹配可盘点的受管对象；不扩大范围补读');
    if (!selectedCounts.selected) aggregateFinding(findings, 'metadata-selection-empty', 'error', selection.paths.join(', ') || 'corpus', '显式元数据选集为空或已全排除；空范围不算检查通过');
  }

  if (instance.available) {
    try {
      const rootAfter = lstatSync(instance.root);
      if (rootAfter.dev !== rootStat.dev || rootAfter.ino !== rootStat.ino || !rootAfter.isDirectory()) throw new Error('instance root inode 或目录形态变化');
    } catch (e) {
      aggregateFinding(findings, 'root-changed-during-inventory', 'error', '.', e.message);
    }
    try {
      if (!sameStat(registryState.stat, lstatSync(join(instance.root, REGISTRY_REL)))) throw new Error('Registry 路径元数据变化');
    } catch (e) {
      aggregateFinding(findings, 'registry-changed-during-inventory', 'error', REGISTRY_REL, e.message);
    }
    if (!mountError) {
      try { if (JSON.stringify(mounts) !== JSON.stringify(instanceMounts(instance.root))) throw new Error('instance 内挂载表在查询期间变化'); }
      catch (e) { aggregateFinding(findings, 'mount-table-changed', 'error', '.', e.message); }
    }
    for (const ref of layoutState.checked) {
      try {
        const after = checkInstancePath(instance.root, ref.path, ref.kind, index, rootStat, mounts);
        if (ref.kind === 'file' ? !sameStat(ref.stat, after) : ref.stat.dev !== after.dev || ref.stat.ino !== after.ino) throw new Error('entry / authority / discovery 身份在查询期间变化');
      } catch (e) { aggregateFinding(findings, 'instance-reference-changed', 'error', ref.path, e.message); }
    }
    for (const surface of members) {
      if (surface.state.endsWith('error')) continue;
      const expected = surface.state === 'active';
      try {
        let statAfter = null;
        try {
          statAfter = lstatSync(join(instance.root, surface.path));
        } catch (e) {
          if (e.code === 'ENOENT' && !expected) continue;
          throw e;
        }
        const stillDirectory = !statAfter.isSymbolicLink() && (surface.kind === 'file' ? statAfter.isFile() : statAfter.isDirectory());
        if (stillDirectory !== expected) throw new Error(surface.state === 'active' ? '受管面根不再是无别名真实目录' : '初始缺失的受管面在 inventory 期间出现');
        if (expected) {
          if (layout.explicit) checkInstancePath(instance.root, surface.path, surface.kind, index, rootStat, mounts);
          if (statAfter.dev !== surface.stat.dev || statAfter.ino !== surface.stat.ino) throw new Error('受管面成员身份变化');
          if (!within(instance.root, realpathSync(join(instance.root, surface.path)))) throw new Error('受管面根真实路径越出 instance boundary');
        }
      } catch (e) {
        aggregateFinding(findings, 'surface-state-changed-during-inventory', 'error', surface.path, e.message);
      }
    }
    try {
      const headAfter = gitHead(instance.root);
      if (headAfter.state === 'unknown') {
        aggregateFinding(findings, 'head-consistency-unknown', 'error', inventoryPaths.join(', '), `复检 Git HEAD 失败：${headAfter.error ?? '空输出'}`);
      } else if (headAfter.head !== head) {
        aggregateFinding(findings, 'head-changed-during-inventory', 'error', inventoryPaths.join(', '), `Git HEAD 在读取期间变化：${head} -> ${headAfter.head}`);
      }
    } catch (e) {
      aggregateFinding(findings, 'head-consistency-unknown', 'error', inventoryPaths.join(', '), `复检 Git HEAD 失败：${e.message}`);
    }
    if (readMetadata) {
      try {
        if (JSON.stringify(metadataIgnored) !== JSON.stringify(ignoredSourcePaths(instance.root, metadataSafePaths))) throw new Error('元数据忽略集合变化');
        for (const [path, item] of metadataObjects) {
          if (!sameStat(item.stat, checkInstancePath(instance.root, path, 'file', index, rootStat, mounts))) throw new Error('元数据原件变化');
          const excluded = path !== REGISTRY_REL && (taskPrivatePath(layout, path) || privateReadPath(path) || (reg.rawMarker && isRawExempt(instance.root, reg, path)) || metadataIgnored.includes(path)) ? 'privacy-excluded' : null;
          if (excluded !== item.excluded) throw new Error('元数据读取排除范围变化');
        }
      } catch { aggregateFinding(findings, 'worktree-state-changed-during-inventory', 'error', inventoryPaths.join(', '), '原件或有效读取范围在查询期间变化；撤回整组工作树比较'); }
    }
    try {
      if (indexFingerprint(gitIndexRecords(instance.root)) !== indexFingerprintBefore) {
        aggregateFinding(findings, 'index-changed-during-inventory', 'error', inventoryPaths.join(', '), 'Git index 在读取期间变化；Envelope 可能混合不同输入版本');
      }
    } catch (e) {
      aggregateFinding(findings, 'index-consistency-unknown', 'error', inventoryPaths.join(', '), `复检 Git index 失败：${e.message}`);
    }
    if (includeUntracked) {
      try {
        const after = [...new Set(gitOutput(instance.root, ['ls-files', '--others', '--exclude-standard', '-z', '--', ...gitPaths]).split('\0').filter(Boolean))].sort();
        if (JSON.stringify(after) !== JSON.stringify(untrackedPathsBefore)) {
          aggregateFinding(findings, 'untracked-set-changed-during-inventory', 'error', inventoryPaths.join(', '), '未忽略 untracked 集合在读取期间变化；不宣称同快照覆盖');
        }
      } catch (e) {
        aggregateFinding(findings, 'untracked-consistency-unknown', 'error', inventoryPaths.join(', '), `复检 untracked 集合失败：${e.message}`);
      }
    }
  }

  if (readMetadata) {
    const driftCodes = new Set(['root-changed-during-inventory', 'registry-changed-during-inventory', 'mount-table-changed', 'instance-reference-changed', 'surface-state-changed-during-inventory', 'head-consistency-unknown', 'head-changed-during-inventory', 'index-changed-during-inventory', 'index-consistency-unknown', 'untracked-set-changed-during-inventory', 'untracked-consistency-unknown', 'worktree-state-changed-during-inventory', 'path-changed-during-read']);
    metadataState.stable = !findings.some(f => driftCodes.has(f.code));
    if (!metadataState.stable) {
      registryRevision = unknownWorktreeRevision('snapshot-changed'); registryModified = null;
      for (let i = 0; i < envelopes.length; i++) {
        const old = envelopes[i], path = old.identity.path;
        const env = baseEnvelope({ rel: path, surface: old.identity.surface, role: 'unknown', tracked: old.tracked, format: old.format, indexEntry: index.get(path)?.[0], headEntry: headTree.entries.get(path) });
        env.type = env.status = env.maintenance = 'unknown'; env.typeSource = env.statusSource = 'unknown'; env.metadataRead = 'not-parsed';
        env.git.worktree = unknownWorktreeRevision('snapshot-changed');
        env.gaps = ['metadata-snapshot-changed', 'type-unknown', 'status-unknown', 'owner-unknown', 'content-unparsed', ...(env.tracked ? ['worktree-revision-unobserved'] : [])];
        if (linkCoverage) env.linkCoverage = emptyLinkCoverageState('not-covered', 'snapshot-changed');
        envelopes[i] = env;
      }
    }
  }
  // Git blob IDs are content fingerprints too. Redact public views, including paths-only
  // capabilities and failed snapshot projections, without changing the private Git inventory.
  const privacyIgnored = new Set([...metadataIgnored, ...ignoredSourcePaths(instance.root, envelopes.map(env => env.identity.path))]);
  for (const env of envelopes) {
    const path = env.identity.path;
    const privacyExcluded = path !== REGISTRY_REL && (taskPrivatePath(layout, path) || privateReadPath(path) || (reg.rawMarker && isRawExempt(instance.root, reg, path)) || privacyIgnored.has(path));
    if (privacyExcluded || env.gaps.includes('metadata-snapshot-changed')) {
      env.git.indexOid = null; env.git.headOid = null; env.git.contentIdsWithheld = true;
      if (readObjects.has(path)) readObjects.get(path).env.git = structuredClone(env.git);
    }
  }
  // Evaluate before filtering and after every boundary/read postcheck; partial inventories never prove uniqueness.
  const applicabilityBlocked = !readMetadata || findings.some((finding) => finding.severity === 'error') || envelopes.some((env) => env.gaps.some((gap) => ['path-hardlink', 'path-changed-during-read', 'metadata-read-budget', 'metadata-snapshot-changed'].includes(gap)));
  // A path-scoped query cannot rule out another canonical outside the selected documents.
  const variants = finalizeVariants(envelopes, { enabled: variantsEnabled, blocked: applicabilityBlocked || Boolean(metadataSelection) });
  const validity = summarizeValidity(envelopes, { enabled: validityEnabled, blocked: applicabilityBlocked });
  envelopes.sort((a, b) => a.identity.path.localeCompare(b.identity.path));
  for (const env of envelopes) {
    const details = {
      ...APPLICABILITY_DETAILS,
      'metadata-read-budget': '元数据读取预算不足；不把未读或前缀当作完整输入',
      'metadata-snapshot-changed': '输入漂移；撤回本次元数据、关系覆盖与工作树比较',
      'metadata-privacy-excluded': '默认敏感路径、raw 或 ignored 仅登记名字，不读取元数据载荷',
      'worktree-revision-unobserved': '未取得完整原始字节且 mode 未证明变化，工作树相对 index 状态仍未知',
      'content-unparsed': '未支持的头块格式或非 Markdown 原件未被本 parser 解析，不宣称已读',
      'record-mutation-unknown': '记录路径或类型不足以证明冻结或 append-only 机制',
      'type-unknown': 'Registry 与路径均无法解析类型',
      'type-conflict': '头块存在重复或多个不一致 Type，不能静默选择第一个',
      'type-source-conflict': 'Registry 固定位置与头块 Type 指向不同类型或声明未注册；本查询按固定位置投影并保留冲突',
      'role-unknown': '现有路径、格式或类型来源不足以推断 control / knowledge / record',
      'maintenance-unknown': '现有信息不足以判定当前可修订、历史保真或记录机制',
      'head-tree-invalid': 'Git HEAD tree 输出不符合预期格式，不能判断 index 与 HEAD 差异',
      'path-hardlink': '常规文件存在硬链接别名，不能证明内容只属于本实例',
      'path-changed-during-read': '路径元数据在读取期间变化，不能宣称 Envelope 来自同一对象',
      'status-unknown': '头块没有 Status，不能用更新时间或存在性替代',
      'status-conflict': '头块存在重复或多个不一致 Status，不能静默选择第一个',
      'status-invalid': '头块 Status 不在 Registry 类型状态机内，不能派生效力',
      'status-unexpected': 'Registry 声明该类型没有 Status 头，显式值保留为意外输入',
      'header-invalid': 'Markdown 头块缺少可识别标题、不是合法 UTF-8 或含二进制内容，不能建立可信字段边界',
      'header-truncated': '头块读取达到 64 KiB 上限，可能缺少后续字段',
      'owner-conflict': '头块存在重复或多个不一致 Owner，不能静默选择第一个',
      'owner-unknown': '头块或默认继承均未提供 owner',
      'link-coverage-unparsed': '该格式没有接入链接 parser，不能宣称 JSON、YAML、Shell、SQL、引用块、代码注释或制品坐标已覆盖',
      'link-read-truncated': 'Markdown 超过链接扫描上限，只能报告已读前缀中的链接',
      'link-target-missing': 'Markdown 相对链接目标缺失、越界或形态不安全',
      'link-coverage-excluded-zone': '引用块、代码区域、转义文本或 HTML 注释中的潜在链接未纳入可达性检查',
      'link-syntax-uncovered': '引用式链接、HTML、autolink、标题、嵌套或跨行语法未被基础内联 Markdown parser 覆盖',
    };
    for (const code of env.gaps) {
      aggregateFinding(findings, code, ['variant-canonical-conflict', 'metadata-read-budget', 'metadata-snapshot-changed'].includes(code) ? 'error' : 'coverage', env.identity.path, details[code] ?? '元数据缺口');
    }
  }

  const countBy = (fn) => envelopes.reduce((acc, env) => {
    const key = fn(env);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, Object.create(null));
  const coverage = {
    ...(metadataSelection ? { scope: 'explicit-path-selection' } : {}),
    files: envelopes.length,
    bySurface: countBy((e) => e.identity.surface),
    byRole: countBy((e) => e.role),
    byType: countBy((e) => e.type ?? 'unknown'),
    byStatus: countBy((e) => e.status ?? 'unknown'),
    byStatusView: countBy((e) => e.statusView ?? 'not-applicable'),
    byNativeState: countBy((e) => e.native?.state ?? 'not-applicable'),
    byValidity: countBy((e) => e.validity?.view ?? 'not-applicable'),
    byCellState: countBy((e) => e.variant?.cellState ?? 'not-applicable'),
    variants,
    validity,
    byFormat: countBy((e) => e.format),
    originals: summarizeOriginals(envelopes),
    ...(readMetadata ? { metadataObservation: metadataState } : {}),
    byOwner: countBy((e) => e.owner ?? 'unknown'),
    byMaintenance: countBy((e) => e.maintenance ?? 'unknown'),
    byRepresentation: countBy((e) => representationKey(e, readMetadata)),
    byMetadataRead: countBy((e) => e.metadataRead),
    byTracked: countBy((e) => (e.tracked ? 'tracked' : 'untracked')),
    byWorktreeState: countBy((e) => (e.tracked ? (e.worktreeModified === null ? 'tracked-state-unknown' : e.worktreeModified ? 'tracked-raw-different' : 'tracked-raw-equal') : 'untracked')),
    byIndexState: countBy((e) => (!e.tracked
      ? 'untracked'
      : e.git.indexMatchesHead === null
        ? (head ? 'tracked-head-state-unknown' : 'tracked-no-head')
        : e.git.indexMatchesHead
          ? 'tracked-matches-head'
          : 'tracked-differs-from-head')),
    metadataRead: envelopes.filter((e) => e.metadataRead !== 'not-parsed').length,
    contentUnparsed: envelopes.filter((e) => e.metadataRead === 'not-parsed').length,
    links: summarizeLinks(envelopes, linkCoverage, instance.available),
    coverageGaps: findings.filter((f) => f.severity === 'coverage').reduce((n, f) => n + f.count, 0),
    errors: findings.filter((f) => f.severity === 'error').reduce((n, f) => n + f.count, 0),
  };
  findings.sort((a, b) => a.severity.localeCompare(b.severity) || a.code.localeCompare(b.code) || (a.samples[0] ?? '').localeCompare(b.samples[0] ?? ''));
  const result = {
    schema: SCHEMA,
    generatedAt,
    input: {
      mode: includeUntracked ? 'git-index-plus-unignored-untracked' : 'git-index-paths',
      contentSource: !readMetadata ? 'paths-only' : linkCoverage ? 'worktree-header-plus-markdown-links' : 'worktree-header',
      readMetadata,
      ...(readMetadata ? { worktreeComparison: 'curia.raw-worktree-revision/1', metadataLimits: metadataState.limits } : {}),
      ...(!readMetadata ? { pathFindings: findings.filter((finding) => !['type-unknown', 'owner-unknown', 'status-unknown', 'maintenance-unknown', 'content-unparsed'].includes(finding.code)).map(({ code, severity, count }) => ({ code, severity, count, path: null, reason: '路径盘点缺口；不泄露选集外对象，内容解析不消除此缺口' })) } : {}),
      ...(selection ? { selection: { ...selection, discovered: selectedCounts.discovered, selected: selectedCounts.selected, excluded: selectedCounts.excluded, unmatched: selection.paths.filter((path) => !selectedCounts.matched.has(path)) } } : {}),
      evaluation,
      includeUntracked,
      linkCoverage,
      consistency: 'non-atomic-with-postcheck',
    },
    instance: {
      root: instance.root,
      gitRoot: instance.gitRoot,
      boundary: instance.boundary,
      git: {
        head,
        headState: headResult.state,
        headTreeAvailable: headTree.available,
        headTreeInvalid: headTree.invalid ?? false,
      },
      registry: {
        source: REGISTRY_REL,
        schemaVersion: reg.version,
        instanceSchema: layout.schema,
        layoutSource: layout.explicit ? 'instance' : 'default-two-roots',
        contentSource: registryState.contentSource,
        tracked: registryState.tracked,
        authority: 'worktree-file',
        indexMode: registryState.indexMode,
        indexOid: registryState.indexOid,
        indexStage: registryState.indexStage,
        worktreeMatchesIndex: registryModified === null ? null : !registryModified,
        ...(readMetadata ? { worktree: registryRevision } : {}),
        indexMatchesHead: registryIndexMatchesHead,
        headMode: registryHeadEntry?.mode ?? null,
        headOid: registryHeadEntry?.oid ?? null,
      },
      surfaces: surfaceReport(),
      access: { mode: 'local-single-reader', actorFiltering: 'not-required-local' },
    },
    coverage,
    findings,
    envelopes,
  };
  if (!readMetadata && instance.available) readSnapshots.set(result, {
    root: instance.root, rootStat, registryStat: registryState.stat, registryDigest: registryState.digest, registryObservedAt: registryState.observedAt,
    reg: structuredClone(reg), layout: structuredClone(layout), index, indexFingerprintBefore, head, mounts,
    objects: readObjects, evaluation: evaluatedAt, inventoryErrors: coverage.errors, gitPaths: [...gitPaths], untrackedPathsBefore: [...untrackedPathsBefore],
    input: structuredClone(result.input), instance: structuredClone(result.instance),
  });
  return result;
}

function representationKey(env, readMetadata = true) {
  if (!readMetadata || env.gaps.some(gap => ['metadata-privacy-excluded', 'metadata-snapshot-changed'].includes(gap))) return 'unavailable';
  if (env.representation) return env.representation.state === 'conflict' ? 'conflict' : env.representation.kind;
  return ['not-parsed', 'header-partial'].includes(env.metadataRead) ? 'unavailable' : 'undeclared';
}

export function filterEnvelopes(inventory, filters = {}) {
  validateFilters(filters, inventory);
  if (filters.representation && !inventory.input.readMetadata) throw new Error('形态筛选需要元数据读取，路径盘点不能证明没有匹配 [curia2/representation-metadata-required]');
  if (filters.gap?.startsWith('link-') && !inventory.input.linkCoverage) throw new Error('链接缺口查询必须显式启用 --links [curia2/links-required]');
  return inventory.envelopes.filter((env) => {
    if (filters.surface && env.identity.surface !== filters.surface) return false;
    if (filters.role && env.role !== filters.role) return false;
    if (filters.type && env.type !== filters.type) return false;
    if (filters.status && env.status !== filters.status) return false;
    if (filters['status-view'] && (env.statusView ?? 'not-applicable') !== filters['status-view']) return false;
    if (filters.family && env.variant?.family !== filters.family) return false;
    for (const [key, axis] of [['language', 'language'], ['product-version', 'productVersion'], ['platform', 'platform'], ['audience', 'audience']]) {
      if (filters[key] && env.variant?.dimensions[axis] !== filters[key]) return false;
    }
    if (filters.canonical && (!env.variant || (env.variant.canonical == null ? 'unknown' : String(env.variant.canonical)) !== filters.canonical)) return false;
    if (filters['cell-state'] && (env.variant?.cellState ?? 'not-applicable') !== filters['cell-state']) return false;
    if (filters.validity && (env.validity?.view ?? 'not-applicable') !== filters.validity) return false;
    if (filters.format && env.format !== filters.format) return false;
    if (filters.owner !== undefined && (env.owner ?? 'unknown') !== filters.owner) return false;
    if (filters.maintenance && (env.maintenance ?? 'unknown') !== filters.maintenance) return false;
    if (filters.representation && representationKey(env) !== filters.representation) return false;
    if (filters.tracked && (env.tracked ? 'yes' : 'no') !== filters.tracked) return false;
    if (filters.gap && !env.gaps.includes(filters.gap)) return false;
    return true;
  });
}

/** Explicit complete-byte observation is separate from header-only inventory and relation scans. */
export function buildGitChangeQuery(root = ROOT, options = {}) {
  if (!plainObject(options) || Object.keys(options).some(key => !['base', 'within', 'exclusions', 'nonSensitive', 'includeUntracked', 'limits', 'inventoryOnly'].includes(key)) || (options.inventoryOnly !== undefined && typeof options.inventoryOnly !== 'boolean')) throw new Error('Git 变更查询参数非法 [curia2/git-change-query-invalid]');
  const { limits = {}, inventoryOnly = false, ...scope } = options;
  const budget = normalizeGitChangeLimits(limits);
  normalizeGitChangeOptions(scope);
  const selection = prepareGitChangeSelection(root, scope);
  return inventoryOnly ? selection : observeGitChangeSelection(selection, budget, 'standalone');
}

export function parseGitChangeArgs(argv) {
  const options = { within: [], exclusions: [], limits: {} }, flags = { root: ROOT, json: false, strict: false, help: false }, seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]; if (seen.has(arg) && !['--within', '--exclude'].includes(arg)) throw new Error('Git 变更查询参数重复 [curia2/git-change-arg-invalid]'); seen.add(arg);
    if (['--help', '--json', '--strict'].includes(arg)) flags[arg.slice(2)] = true;
    else if (arg === '--all') options.includeUntracked = true;
    else if (arg === '--non-sensitive') options.nonSensitive = true;
    else if (arg === '--inventory') options.inventoryOnly = true;
    else {
      if (!['--root', '--git-base', '--within', '--exclude', '--max-files', '--max-file-bytes', '--max-total-bytes'].includes(arg) || i + 1 >= argv.length || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error('Git 变更查询参数或取值非法 [curia2/git-change-arg-invalid]');
      const value = argv[++i];
      if (arg === '--root') flags.root = value;
      else if (arg === '--git-base') options.base = value;
      else if (arg === '--within') options.within.push(value);
      else if (arg === '--exclude') options.exclusions.push(value);
      else {
        if (!/^[1-9][0-9]*$/.test(value)) throw new Error('Git 观察预算非法 [curia2/git-change-arg-invalid]');
        options.limits[{ '--max-files': 'maxFiles', '--max-file-bytes': 'maxFileBytes', '--max-total-bytes': 'maxTotalBytes' }[arg]] = Number(value);
      }
    }
  }
  if (flags.help) { if ([...seen].some(arg => !['--help', '--json'].includes(arg))) throw new Error('帮助不能混用执行参数 [curia2/git-change-arg-invalid]'); }
  else { const { limits, inventoryOnly, ...scope } = options; normalizeGitChangeOptions(scope); normalizeGitChangeLimits(limits); }
  return { options, flags };
}

function changesMain() {
  try {
    const { options, flags } = parseGitChangeArgs(process.argv.slice(3));
    if (flags.help) {
      console.log(`node scripts/curia-query.mjs changes --git-base HEAD --within packages/contracts --non-sensitive --strict --json
--within 可重复，独立授权原始字节摘要；不要求文档 mapping，不扫描关系、不执行命令、不落记录。
--inventory 只盘点，不摘要；--all 才纳入未忽略的 untracked，--exclude 缩小范围；默认敏感 / raw / ignored 排除不变。
--max-files / --max-file-bytes / --max-total-bytes 是独立 Git 摘要预算，默认 ${JSON.stringify(GIT_CHANGE_LIMITS)}。
基线→index 与 index→原始工作树分列；不做 Git 归一化、不推断 rename。hashed 不是 read、事实核验或暂存门禁。
--strict：完整观察退出 0，不完整或仅盘点退出 1，参数或基线不可用退出 2。`);
      return;
    }
    const report = buildGitChangeQuery(flags.root, options);
    console.log(flags.json ? JSON.stringify(report, null, 2) : options.inventoryOnly ? `Git 变更来源盘点：${report.objects.length} 个对象；未摘要，未扫描关系。` : `${report.complete ? 'observed-within-scope' : 'incomplete'}: ${report.changed.length} 个变化名字\n${report.objects.map(item => `${item.staged}\t${item.worktreeChange}\t${JSON.stringify(item.path)}`).join('\n')}`);
    if (flags.strict && !report.complete) process.exitCode = 1;
  } catch { console.error('Git 变更查询参数、配置或快照不可用 [curia2/git-change-query-unavailable]'); process.exitCode = 2; }
}

export function parseArgs(argv) {
  const opts = { filters: {}, all: false, json: false, coverageOnly: false, strict: false, root: null, allowNoGit: false, links: false };
  const seen = new Set(), paths = [], exclusions = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (seen.has(arg) && !['--path', '--exclude'].includes(arg)) throw new Error(`参数 ${arg} 重复 [curia2/arg-duplicate]`);
    seen.add(arg);
    const value = () => {
      const v = argv[++i];
      if (v === undefined || v === '' || v.startsWith('--')) throw new Error(`参数 ${arg} 缺少值 [curia2/arg-value]`);
      return v;
    };
    if (arg === '--all') opts.all = true;
    else if (arg === '--allow-no-git') opts.allowNoGit = true;
    else if (arg === '--json') opts.json = true;
    else if (arg === '--coverage') opts.coverageOnly = true;
    else if (arg === '--strict') opts.strict = true;
    else if (arg === '--links') opts.links = true;
    else if (arg === '--root') opts.root = value();
    else if (arg === '--path') paths.push(value());
    else if (arg === '--exclude') exclusions.push(value());
    else if (arg === '--at') opts.at = evaluationInstant(value());
    else if (['--max-files', '--max-file-bytes', '--max-total-bytes'].includes(arg)) {
      const raw = value(); if (!/^[1-9][0-9]*$/.test(raw)) throw new Error('元数据预算必须为正整数 [curia2/metadata-budget-invalid]');
      (opts.metadataLimits ??= {})[{ '--max-files': 'maxFiles', '--max-file-bytes': 'maxFileBytes', '--max-total-bytes': 'maxTotalBytes' }[arg]] = Number(raw);
    }
    else if (arg.startsWith('--') && FILTER_KEYS.includes(arg.slice(2))) {
      const key = arg.slice(2);
      if (key in opts.filters) throw new Error(`参数 ${arg} 重复 [curia2/arg-duplicate]`);
      opts.filters[key] = value();
    } else if (arg === '-h' || arg === '--help') {
      opts.help = true;
    } else {
      throw new Error(`未知参数：${arg} [curia2/arg-unknown]`);
    }
  }
  normalizeMetadataLimits(opts.metadataLimits ?? {});
  if (paths.length || exclusions.length) {
    if (opts.allowNoGit) throw new Error('显式元数据选集不能与 --allow-no-git 混用 [curia2/options-invalid]');
    opts.metadataSelection = normalizeReadSelection({ paths, exclusions, corpus: !paths.length });
  }
  return opts;
}

function validateFilters(filters, inventory = null) {
  if (!plainObject(filters) || Object.keys(filters).some((key) => !FILTER_KEYS.includes(key))) throw new Error('筛选条件必须是仅含已支持字段的普通对象 [curia2/filter-invalid]');
  for (const [key, value] of Object.entries(filters)) {
    if (typeof value !== 'string' || !value || value.trim() !== value || /[\u0000-\u001f\u007f]/u.test(value)) throw new Error(`参数 --${key} 必须是非空且无控制字符或首尾空白的字符串 [curia2/filter-value]`);
  }
  const enums = {
    ...(inventory ? { surface: inventory.instance.surfaces.map((surface) => surface.id) } : {}),
    'status-view': STATUS_VIEWS,
    'cell-state': CELL_STATES,
    canonical: ['true', 'false', 'unknown'],
    validity: VALIDITY_STATES,
    role: ['control', 'knowledge', 'record', 'unknown'],
    tracked: ['yes', 'no'],
    maintenance: ['process-evolving', 'current-revisable', 'historical-preserved', 'record-mechanism-unknown', 'generated', 'unknown'],
    representation: [...REPRESENTATIONS, 'undeclared', 'conflict', 'unavailable'],
    gap: KNOWN_GAPS,
  };
  for (const [key, allowed] of Object.entries(enums)) {
    if (filters[key] !== undefined && !allowed.includes(filters[key])) {
      throw new Error(`参数 --${key} 的值无效：${filters[key]}；允许 ${allowed.join(' | ')} [curia2/filter-value]`);
    }
  }
}

function printHelp() {
  console.log(`curia-query —— Curia 2.0 基础纳管 inventory、查询与覆盖报告（只读）

用法：
  node scripts/curia-query.mjs [--root <Git 根>] [--all] [--coverage] [--json] [--allow-no-git]
                              [--path <文件或目录>]... [--exclude <文件或目录>]...
                              [--surface <surface-id>] [--role control|knowledge|record|unknown]
                              [--type <type>] [--status <status>] [--format <format>] [--owner <owner>]
                              [--maintenance process-evolving|current-revisable|historical-preserved|record-mechanism-unknown|generated|unknown] [--tracked yes|no]
                              [--representation original|generated|context|navigation|outbound|undeclared|conflict|unavailable]
                              [--links] [--gap <缺口代码>]
                              [--status-view current|forming|historical|unmapped|not-applicable]
                              [--family <family>] [--language <language>] [--product-version <version>]
                              [--platform <platform>] [--audience <audience>] [--canonical true|false|unknown]
                              [--cell-state ${CELL_STATES.join('|')}]
                              [--validity ${VALIDITY_STATES.join('|')}] [--at <带时区的完整时间>]
                              [--max-files <n>] [--max-file-bytes <n>] [--max-total-bytes <n>] [--strict]

显式完整修订观察：
  node scripts/curia-query.mjs changes --git-base HEAD --within docs/manuals --non-sensitive --strict --json

默认只看已入库文件；--links 才做 Markdown 相对链接可达扫描，非 Markdown 格式显式报告 parser 未覆盖；--all 并入未忽略 untracked；--allow-no-git 仅用于生成器冒烟，无 Git 边界时输出不适用而不是伪装纳管。输出不写入全局 INDEX。instance 可选配置仅来自 .agents/doc-types.json；原位映射不执行原项目 guard。
--path / --exclude 在文档打开与预算消费前限定范围；可重复、排除优先，不接受通配。仅 --exclude 从默认范围减去路径；未匹配或全排除保留 error，--strict 退出 1；不能与 --allow-no-git 混用。Registry、Git 与布局仍按实例观察；--links 只检查目标路径，不读目标正文。
变体与生效时间只读求值，须在 mapping 显式启用。canonical 在输出过滤前求值；显式路径选集不证明全局唯一，已读冲突仍报告；--at 只对当前工作树声明求值，不重建历史版本，也不改 Status。
普通 inventory 输出 curia.inventory/3：头块、映射 JSON 与显式链接共享同次字节及元数据预算，默认 ${JSON.stringify(METADATA_LIMITS)}；Registry 独立上限 1 MiB，头块 / JSON 64 KiB，链接 16 MiB。
工作树比较只复用实际完整读取的原始字节；前缀、未读或排除对象不冒充 clean。Git 归一化不参与，不调用 diff-files、filter、textconv；完整大件或其他格式另走 changes。未知状态可用 --gap worktree-revision-unobserved 检索。
缺口代码：${KNOWN_GAPS.join(' | ')}。`);
}

function printTable(rows) {
  if (!rows.length) {
    console.log('（无匹配对象）');
    return;
  }
  console.log('surface        role          type                  status              validity        cell            tracked   path');
  for (const e of rows) {
    console.log(
      [
        e.identity.surface.padEnd(14),
        e.role.padEnd(14),
        (e.type ?? 'unknown').padEnd(22),
        (e.status ?? 'unknown').padEnd(18),
        (e.validity?.view ?? 'not-applicable').padEnd(16),
        (e.variant?.cellState ?? 'not-applicable').padEnd(16),
        (e.tracked ? 'yes' : 'no').padEnd(10),
        e.identity.path,
      ].join(''),
    );
  }
  console.log(`共 ${rows.length} 个对象；仅 inventory / 头块元数据，不冒充全文阅读或事实核验。`);
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    process.exitCode = 2;
    return;
  }
  if (opts.help) {
    printHelp();
    return;
  }
  try {
    validateFilters(opts.filters);
  } catch (e) {
    console.error(e.message);
    process.exitCode = 2;
    return;
  }
  if (opts.coverageOnly && Object.keys(opts.filters).length) {
    console.error('coverage 报告始终覆盖完整 inventory；过滤查询请去掉 --coverage [curia2/coverage-filters]');
    process.exitCode = 2;
    return;
  }
  if (opts.filters.gap?.startsWith('link-') && !opts.links) {
    console.error('链接缺口查询必须显式启用 --links [curia2/links-required]');
    process.exitCode = 2;
    return;
  }
  let inventory;
  try {
    inventory = buildInventory(opts.root ?? ROOT, null, { includeUntracked: opts.all, allowNoGit: opts.allowNoGit, linkCoverage: opts.links, at: opts.at, metadataLimits: opts.metadataLimits, metadataSelection: opts.metadataSelection });
  } catch (e) {
    console.error(e.message);
    process.exitCode = 2;
    return;
  }
  let rows;
  try { rows = filterEnvelopes(inventory, opts.filters); }
  catch (e) { console.error(e.message); process.exitCode = 2; return; }
  const errors = inventory.findings.filter((f) => f.severity === 'error');
  if (!opts.json && opts.metadataSelection) console.log(`scope: explicit-path-selection; selected=${inventory.input.selection.selected}; excluded=${inventory.input.selection.excluded}; unmatched=${inventory.input.selection.unmatched.length}; not-global-uniqueness`);
  if (opts.json) {
    const out = opts.coverageOnly
      ? { schema: inventory.schema, generatedAt: inventory.generatedAt, input: inventory.input, instance: inventory.instance, coverage: inventory.coverage, findings: inventory.findings }
      : {
        ...inventory,
        selection: { filters: opts.filters, resultCount: rows.length, coverageAppliesTo: opts.metadataSelection ? 'explicit path selection before output filters' : 'all inventory objects', linkCoverage: opts.links },
        envelopes: rows,
      };
    console.log(JSON.stringify(out, null, 2));
  } else if (opts.coverageOnly) {
    console.log(`instance: ${inventory.instance.root} (${inventory.instance.boundary})`);
    console.log(`git-head: ${inventory.instance.git.head ?? 'unavailable'}`);
    console.log(`registry: ${inventory.instance.registry.source}; authority=${inventory.instance.registry.authority}; tracked=${inventory.instance.registry.tracked}; worktree-matches-index=${inventory.instance.registry.worktreeMatchesIndex === null ? 'unknown' : inventory.instance.registry.worktreeMatchesIndex ? 'yes' : 'no'}; index-matches-head=${inventory.instance.registry.indexMatchesHead === null ? 'unknown' : inventory.instance.registry.indexMatchesHead ? 'yes' : 'no'}`);
    console.log(`surfaces: ${inventory.instance.surfaces.map((s) => `${s.id}=${s.state}`).join(', ')}`);
    console.log(`objects: ${inventory.coverage.files}; metadata-read=${inventory.coverage.metadataRead}; unparsed=${inventory.coverage.contentUnparsed}`);
    console.log(`roles: ${Object.entries(inventory.coverage.byRole).map(([k, v]) => `${k}=${v}`).join(', ') || 'none'}`);
    console.log(`representations: ${Object.entries(inventory.coverage.byRepresentation).map(([k, v]) => `${k}=${v}`).join(', ') || 'none'}`);
    console.log(`statuses: ${Object.entries(inventory.coverage.byStatus).map(([k, v]) => `${k}=${v}`).join(', ') || 'none'}`);
    console.log(`evaluation: ${inventory.input.evaluation.at}; baseline=${inventory.input.evaluation.contentBaseline}`);
    console.log(`validity: ${Object.entries(inventory.coverage.byValidity).map(([k, v]) => `${k}=${v}`).join(', ') || 'none'}`);
    console.log(`validity-scope: ${inventory.coverage.validity.state}; objects=${inventory.coverage.validity.objects}; unresolved=${inventory.coverage.validity.unresolved}; unparsed=${inventory.coverage.validity.unparsed}; invalid=${inventory.coverage.validity.invalid}`);
    console.log(`variants: ${inventory.coverage.variants.state}; cells=${inventory.coverage.variants.cells}; conflicts=${inventory.coverage.variants.conflicts}; missing=${inventory.coverage.variants.missing}; unresolved=${inventory.coverage.variants.unresolved}; unassigned=${inventory.coverage.variants.unassigned}`);
    if (inventory.coverage.links.enabled) console.log(`links: checked-files=${inventory.coverage.links.filesChecked}; fully=${inventory.coverage.links.filesCheckedFully}; partial=${inventory.coverage.links.filesCheckedPartial}; not-covered=${inventory.coverage.links.filesNotCovered}; exempt=${inventory.coverage.links.filesExempt}; links=${inventory.coverage.links.links}; excluded=${inventory.coverage.links.excludedLinks}; unsupported=${inventory.coverage.links.unsupportedSyntax}; relative=${inventory.coverage.links.relativeLinks}; targets=${Object.entries(inventory.coverage.links.targetStates).map(([k, v]) => `${k}=${v}`).join(', ') || 'none'}`);
    console.log(`coverage gaps: ${inventory.coverage.coverageGaps}; errors: ${inventory.coverage.errors}`);
    for (const f of inventory.findings) console.log(`  [curia2/${f.code}] ${f.severity} ×${f.count}；样本：${f.samples.slice(0, 3).join('、')}`);
  } else {
    printTable(rows);
    if (errors.length && !opts.json) {
      console.error(`Curia inventory 存在 ${inventory.coverage.errors} 个阻断缺口；详见 [curia2/*] JSON 或 coverage 输出 [curia2/inventory-errors]`);
    }
  }
  if (opts.strict && errors.length) {
    console.error(`Curia inventory 存在 ${inventory.coverage.errors} 个阻断缺口；详见 [curia2/*] 输出 [curia2/inventory-errors]`);
    process.exitCode = 1;
  }
}

if (isMainModule(import.meta.url)) { if (process.argv[2] === 'changes') changesMain(); else main(); }
