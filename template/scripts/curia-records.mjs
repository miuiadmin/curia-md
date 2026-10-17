#!/usr/bin/env node
/** Opt-in append-only Runs. Verification, command execution and manual observation retain distinct contracts. */
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants, closeSync, fstatSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readdirSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, isMainModule, privateReadPath } from './doc-lib.mjs';
import { checkInstancePath, instanceMounts, normalizeReadSelection, parseRegistryJson, readStableFile, prepareSourceSelection, revalidateSourceSelection } from './curia-query.mjs';
import { normalizeInstance, taskPrivatePath, containsPath } from './curia-instance.mjs';
import { buildReadWorkflow, READ_RULE_SETS } from './curia-workflow.mjs';
import { GUARD_RUN_SCHEMA, validateGuardBegin, validateGuardReceipt, deriveGuardTerminal, guardInputView } from './curia-guard-contract.mjs';
import { MULTI_GUARD_RUN_SCHEMA, primaryGuardInput, guardInputIdentity, guardInputObservationTimes, repositoryBindingDigest } from './curia-guard-contract.mjs';
import { CONFIGURATION_CHECK_RUN_SCHEMA, MULTI_CHECK_RUN_SCHEMA } from './curia-check-contract.mjs';
import { commandReceipt } from './curia-guard-runtime.mjs';
import { validateCheckBegin, validateCheckReceipt, checkObservationTimes, deriveCheckTerminal, guardResult } from './curia-check-contract.mjs';
import { verifySources, normalizeVerificationOptions, parseVerifyArgs, verifyRegisteredOriginal, normalizeOriginalOptions, parseOriginalArgs } from './curia-verify.mjs';
import { ASSERTION_RUN_SCHEMA, ORIGINAL_ASSERTION_RUN_SCHEMA, ORIGINAL_ASSERTION_EVENT_SCHEMA, ORIGINAL_ASSERTION_METHOD, assertionEventSchema, ASSERTION_MODE, ASSERTION_EVENT_SCHEMA, ASSERTION_HISTORY_LIMIT, ASSERTION_RECORD_LIMITATIONS, assertionSubjectKey, assertionObservation, validateAssertionBegin, validateAssertionReferences, deriveAssertionTerminal } from './curia-assertion-contract.mjs';

import { EXTERNAL_ASSERTION_MODE, EXTERNAL_ASSERTION_RUN_SCHEMA, EXTERNAL_ASSERTION_EVENT_SCHEMA, EXTERNAL_ASSERTION_METHOD, EXTERNAL_ASSERTION_LIMITATIONS, externalAssertionSubjectKey, externalAssertionObservation, validateExternalAssertionBegin, validateExternalAssertionReferences, deriveExternalAssertionTerminal } from './curia-external-assertion-contract.mjs';
const isAssertionMode = mode => [ASSERTION_MODE, EXTERNAL_ASSERTION_MODE].includes(mode);
const assertionLimits = mode => mode === EXTERNAL_ASSERTION_MODE ? EXTERNAL_ASSERTION_LIMITATIONS : ASSERTION_RECORD_LIMITATIONS;
const guardEventSchema = begin => begin.schema === MULTI_GUARD_RUN_SCHEMA ? 'curia.run-event/7' : 'curia.run-event/2';
const checkEventSchema = begin => begin.schema === CONFIGURATION_CHECK_RUN_SCHEMA ? 'curia.run-event/9' : begin.schema === MULTI_CHECK_RUN_SCHEMA ? 'curia.run-event/8' : 'curia.run-event/3';
const recordedAssertionSchema = begin => begin.executionMode === EXTERNAL_ASSERTION_MODE ? EXTERNAL_ASSERTION_EVENT_SCHEMA : assertionEventSchema(begin);
const recordedAssertionTerminal = (events, endedAt, drift) => events[0].data.payload.executionMode === EXTERNAL_ASSERTION_MODE ? deriveExternalAssertionTerminal(events, endedAt, drift) : deriveAssertionTerminal(events, endedAt, drift);
const recordedAssertionReferences = (begin, runs) => begin.executionMode === EXTERNAL_ASSERTION_MODE ? validateExternalAssertionReferences(begin, runs) : validateAssertionReferences(begin, runs);

export const RUN_SCHEMA = 'curia.run-event/1';
export const RECORD_LIMITS = Object.freeze({ files: 10000, eventBytes: 1024 * 1024, totalBytes: 32 * 1024 * 1024 });
const REGISTRY = '.agents/doc-types.json';
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const RUN_ID = new RegExp(`^r-${UUID}$`);
const EVENT_NAME = new RegExp(`^(r-${UUID})\\.(\\d{8})\\.json$`);
const HASH = /^[0-9a-f]{64}$/;
const plain = (v) => v && typeof v === 'object' && !Array.isArray(v) && [null, Object.prototype].includes(Object.getPrototypeOf(v)) && !Object.getOwnPropertySymbols(v).length;
const fail = (s) => { throw new Error(`${s} [records/contract]`); };
export const rawDigest = (bytes) => ({ algorithm: 'sha256', canonicalization: 'raw-bytes/1', value: createHash('sha256').update(bytes).digest('hex') });
const encode = (v) => Buffer.from(`${JSON.stringify(v, null, 2)}\n`);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const eventName = (id, seq) => `${id}.${String(seq).padStart(8, '0')}.json`;
const headToken = (event) => `${event.data.sequence}:${rawDigest(event.bytes).value}`;
function object(v, required, optional = []) {
  if (!plain(v) || Object.keys(v).some((k) => ![...required, ...optional].includes(k)) || required.some((k) => !Object.hasOwn(v, k))) fail(`字段必须为 ${required.join(', ')}；不接受未知字段`);
}
function text(v, label, max = 4000) {
  if (typeof v !== 'string' || !v.trim() || v !== v.trim() || v.length > max || /[\u0000-\u001f\u007f]/u.test(v)) fail(`${label} 必须是有限长单行文本`);
}
function array(v, label, max = 10000) { if (!Array.isArray(v) || v.length > max) fail(`${label} 必须是有界数组`); }
function instant(v) { if (typeof v !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString() !== v) fail('观察时间必须是有效 UTC ISO 时点'); }
function digest(v) { object(v, ['algorithm', 'canonicalization', 'value']); if (v.algorithm !== 'sha256' || v.canonicalization !== 'raw-bytes/1' || !HASH.test(v.value)) fail('摘要身份未支持'); }
function id(v) { if (typeof v !== 'string' || !RUN_ID.test(v)) fail('run-id 必须是系统分配的 UUID'); }
function relativePath(v) { text(v, '路径', 1024); if (v.includes('\\') || /[:*?\[\]{}]/.test(v) || v.split('/').some((p) => !p || p !== p.trim() || ['.', '..', '.git'].includes(p.toLowerCase()))) fail('只接受规范仓内相对路径'); }
export function recordGit(root, args, input) {
  return execFileSync('git', ['--no-replace-objects', '--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', '-c', 'core.preloadIndex=false', ...args], { cwd: root, input, maxBuffer: RECORD_LIMITS.totalBytes * 2, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, LC_ALL: 'C', LANGUAGE: 'C' } });
}
const git = recordGit;
function gitBoundary(root, staged) {
  // The index selected by pre-commit is allowed only for the read-only staged guard.
  const allowed = new Set(staged ? ['GIT_INDEX_FILE'] : []);
  for (const key of Object.keys(process.env)) if ((key.startsWith('GIT_CONFIG_') || ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE', 'GIT_NAMESPACE', 'GIT_CEILING_DIRECTORIES', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_EXTERNAL_DIFF', 'GIT_EXTERNAL_DIFF_TRUST_EXIT_CODE', 'GIT_ATTR_SOURCE', 'GIT_ATTRIBUTES_FILE'].includes(key)) && !allowed.has(key)) fail(`Git 环境覆盖不允许：${key}`);
  try { if (realpathSync(git(root, ['rev-parse', '--show-toplevel']).toString().trim()) !== root) fail('记录边界必须等于 Git 根'); return true; }
  catch (e) { if (e.status === 128 && /not a git repository/.test(String(e.stderr))) { if (staged) fail('暂存记录检查缺少 Git'); return false; } throw e; }
}
function headRevision(root) {
  try { return git(root, ['rev-parse', '--verify', 'HEAD']).toString().trim(); }
  catch (e) {
    if (e.status !== 128) throw e;
    const ref = git(root, ['symbolic-ref', '-q', 'HEAD']).toString().trim();
    try { git(root, ['show-ref', '--verify', '--quiet', ref]); } catch (missing) { if (missing.status === 1) return null; throw missing; }
    throw e;
  }
}
function indexEntries(bytes) {
  const out = new Map();
  for (const row of bytes.toString().split('\0').filter(Boolean)) {
    const m = /^(\d{6}) ([0-9a-f]+) ([0-3])\t(.+)$/u.exec(row);
    if (!m) fail('Git index 条目不可解析');
    const entries = out.get(m[4]) ?? [];
    entries.push({ mode: m[1], oid: m[2], stage: Number(m[3]) }); out.set(m[4], entries);
  }
  return out;
}
function treeEntries(root, revision) {
  const out = new Map();
  if (!revision) return out;
  for (const row of git(root, ['ls-tree', '-rz', '--full-tree', revision]).toString().split('\0').filter(Boolean)) {
    const m = /^(\d{6}) (blob|commit) ([0-9a-f]+)\t(.+)$/u.exec(row);
    if (!m) fail('HEAD 树不可解析');
    out.set(m[4], [{ mode: m[1], oid: m[3], stage: 0 }]);
  }
  return out;
}
const pathNames = new WeakMap();
function gitPathShape(entries, path, kind) {
  const fold = (p) => p.normalize('NFC').toLowerCase();
  let names = pathNames.get(entries);
  if (!names) {
    names = new Map();
    for (const candidate of entries.keys()) {
      const parts = candidate.split('/');
      for (let n = 1; n <= parts.length; n++) {
        const prefix = parts.slice(0, n).join('/');
        const values = names.get(fold(prefix)) ?? new Set(); values.add(prefix); names.set(fold(prefix), values);
      }
    }
    pathNames.set(entries, names);
  }
  const parts = path.split('/');
  for (let n = 1; n <= parts.length; n++) {
    const prefix = parts.slice(0, n).join('/');
    if ([...(names.get(fold(prefix)) ?? [])].some((name) => name !== prefix)) fail(`Git 路径存在大小写或 Unicode 别名：${path}`);
    if ((n < parts.length || kind === 'directory') && entries.has(prefix)) fail(`Git 路径祖先不是目录：${path}`);
  }
}
function gitFile(entries, path) {
  gitPathShape(entries, path, 'file');
  const row = entries.get(path);
  if (!row) return null;
  if (row.length !== 1 || row[0].stage !== 0 || !['100644', '100755'].includes(row[0].mode)) fail(`Git 路径不是无冲突普通文件：${path}`);
  return row[0];
}
function blobs(root, entries, paths) {
  const out = new Map();
  if (!paths.length) return out;
  const oids = paths.map((path) => { const row = gitFile(entries, path); if (!row) fail(`Git 路径缺失：${path}`); return row.oid; });
  const input = Buffer.from(`${oids.join('\n')}\n`);
  const metadata = git(root, ['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'], input).toString().trimEnd().split('\n');
  if (metadata.length !== paths.length) fail('Git 批量元数据不完整');
  let total = 0;
  const sizes = metadata.map((line, i) => {
    const m = /^([0-9a-f]+) blob (\d+)$/.exec(line); const size = m ? Number(m[2]) : NaN;
    if (!m || m[1] !== oids[i] || !Number.isSafeInteger(size) || size > RECORD_LIMITS.eventBytes) fail('Git blob 身份、形态或字节预算非法');
    total += size; if (total > RECORD_LIMITS.totalBytes) fail('Git blob 总字节超预算'); return size;
  });
  const bytes = git(root, ['cat-file', '--batch'], input); let offset = 0;
  for (let i = 0; i < paths.length; i++) {
    const newline = bytes.indexOf(10, offset);
    if (newline < 0 || bytes.subarray(offset, newline).toString() !== `${oids[i]} blob ${sizes[i]}`) fail('Git blob 批量头不匹配');
    const end = newline + 1 + sizes[i];
    if (end >= bytes.length || bytes[end] !== 10) fail('Git blob 批量正文截断');
    out.set(paths[i], bytes.subarray(newline + 1, end)); offset = end + 1;
  }
  if (offset !== bytes.length) fail('Git blob 批量输出存在额外字节');
  return out;
}
function blob(root, entries, path) {
  return gitFile(entries, path) ? blobs(root, entries, [path]).get(path) : null;
}
function diskBytes(ctx, path) {
  const stat = checkInstancePath(ctx.root, path, 'file', ctx.index, ctx.rootStat, ctx.mounts);
  if (stat.size > RECORD_LIMITS.eventBytes) fail(`单文件超预算：${path}`);
  const bytes = readStableFile(join(ctx.root, path), stat, RECORD_LIMITS.eventBytes);
  if (bytes.length > RECORD_LIMITS.eventBytes) fail(`单文件超预算：${path}`);
  return bytes;
}
function registryStore(bytes) {
  if (!bytes) return null;
  const reg = parseRegistryJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (reg.version !== 1 || !plain(reg.types)) fail('Registry 版本或 types 不可解析');
  return normalizeInstance(reg.instance, reg.types).recordStore ?? null;
}
function filesFor(ctx, store, source) {
  const files = new Map();
  if (!store) return files;
  if (source === 'worktree') {
    try { checkInstancePath(ctx.root, store.path, 'directory', ctx.index, ctx.rootStat, ctx.mounts); }
    catch (e) { if (e.code === 'ENOENT') { // Missing store is OK only if no tracked events disappeared.
      if ([...ctx.index.keys()].some((p) => p === store.path || p.startsWith(`${store.path}/`))) fail('记录目录缺失，但索引仍有记录');
      return files;
    } throw e; }
    const names = readdirSync(join(ctx.root, store.path));
    if (names.length > RECORD_LIMITS.files) fail('记录数量超预算');
    for (const name of names.sort()) files.set(`${store.path}/${name}`, diskBytes(ctx, `${store.path}/${name}`));
  } else {
    const entries = source === 'head' ? ctx.headIndex : ctx.index;
    gitPathShape(entries, store.path, 'directory');
    const paths = [...entries.keys()].filter((p) => p.startsWith(`${store.path}/`)).sort();
    if (paths.length > RECORD_LIMITS.files) fail('记录数量超预算');
    for (const [path, bytes] of blobs(ctx.root, entries, paths)) files.set(path, bytes);
  }
  let total = 0;
  for (const bytes of files.values()) { total += bytes.length; if (total > RECORD_LIMITS.totalBytes) fail('记录字节超预算'); }
  return files;
}
/** Reads a bounded record store. Staged mode never substitutes worktree bytes for index blobs. */
const readStoreIdentity = store => rawDigest(encode(store ? { schema: store.schema, path: store.path, owner: store.owner, authorityLinks: store.authorityLinks } : null));
/** A comparison constraint, not an execution capability or a promise of atomic filesystem isolation. */
export function recordReadBoundary(ctx) {
  return structuredClone({ root: ctx.root, rootIdentity: [ctx.rootStat.dev, ctx.rootStat.ino], mounts: ctx.mounts, head: ctx.head, index: rawDigest(ctx.indexRaw), registry: ctx.registryDigest, store: ctx.store?.path ?? null, storeIdentity: readStoreIdentity(ctx.store), baselineStore: ctx.baselineStore, baselineStoreIdentity: ctx.baselineStoreIdentity });
}
function validateReadBoundary(value) {
  object(value, ['root', 'rootIdentity', 'mounts', 'head', 'index', 'registry', 'store', 'storeIdentity', 'baselineStore', 'baselineStoreIdentity']);
  text(value.root, '固定根'); if (!value.root.startsWith('/') || resolve(value.root) !== value.root) fail('固定根必须是规范绝对路径');
  array(value.rootIdentity, '根身份', 2); if (value.rootIdentity.length !== 2 || value.rootIdentity.some(v => !Number.isSafeInteger(v) || v < 0)) fail('固定根身份非法');
  array(value.mounts, '固定挂载'); for (const path of value.mounts) { text(path, '挂载路径'); if (!path.startsWith('/')) fail('固定挂载非法'); }
  if (value.head !== null && !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value.head)) fail('固定 HEAD 非法');
  digest(value.index); digest(value.registry); digest(value.storeIdentity); digest(value.baselineStoreIdentity); if (value.store !== null) relativePath(value.store); if (value.baselineStore !== null) relativePath(value.baselineStore);
}
export function loadRecordStore(inputRoot = ROOT, { staged = false, expectedBoundary = null, boundaryMode = 'exact' } = {}) {
  if (!['exact', 'store-only'].includes(boundaryMode) || (boundaryMode === 'store-only' && expectedBoundary === null) || (staged && expectedBoundary !== null)) fail('固定读取边界模式非法');
  if (expectedBoundary !== null) validateReadBoundary(expectedBoundary);
  const root = realpathSync(resolve(inputRoot));
  if (expectedBoundary !== null && root !== expectedBoundary.root) fail('固定根已变化；不探测新仓库');
  const rootStat = lstatSync(root), mounts = staged ? [] : instanceMounts(root);
  if (expectedBoundary !== null && (!equal([rootStat.dev, rootStat.ino], expectedBoundary.rootIdentity) || !equal(mounts, expectedBoundary.mounts))) fail('根或挂载已变化；不探测新仓库');
  const hasGit = gitBoundary(root, staged);
  const head = hasGit ? headRevision(root) : null;
  const indexRaw = hasGit ? git(root, ['ls-files', '-sz']) : Buffer.alloc(0);
  if (expectedBoundary !== null && boundaryMode === 'exact' && (head !== expectedBoundary.head || !equal(rawDigest(indexRaw), expectedBoundary.index))) fail('Git 已变化；不按新上下文读取来源');
  const ctx = { root, hasGit, head, indexRaw, index: indexEntries(indexRaw), headIndex: hasGit ? treeEntries(root, head) : new Map(), rootStat, mounts, staged };
  const registryBytes = staged ? blob(root, ctx.index, REGISTRY) : diskBytes(ctx, REGISTRY);
  if (!registryBytes) fail('当前 Registry 缺失');
  if (expectedBoundary !== null && boundaryMode === 'exact' && !equal(rawDigest(registryBytes), expectedBoundary.registry)) fail('固定 Registry 已变化；不解析新声明或读取新记录目录');
  const store = registryStore(registryBytes);
  if (expectedBoundary !== null && ((store?.path ?? null) !== expectedBoundary.store || !equal(readStoreIdentity(store), expectedBoundary.storeIdentity))) fail('记录绑定已变化；不读取新记录目录');
  const headRegistry = hasGit ? blob(root, ctx.headIndex, REGISTRY) : null;
  const previousStore = registryStore(headRegistry);
  if (expectedBoundary !== null && ((previousStore?.path ?? null) !== expectedBoundary.baselineStore || !equal(readStoreIdentity(previousStore), expectedBoundary.baselineStoreIdentity))) fail('历史记录绑定已变化；不读取另一基线目录');
  if (store && !hasGit) fail('持久化 Run 需要 Git 基线能力；无 Git 不降级写入');
  for (const ref of store?.authorityLinks ?? []) {
    if (staged ? !gitFile(ctx.index, ref) : !checkInstancePath(root, ref, 'file', ctx.index, ctx.rootStat, ctx.mounts)) fail(`recordStore authority 不存在：${ref}`);
  }
  const files = filesFor(ctx, store, staged ? 'index' : 'worktree');
  const baseline = filesFor(ctx, previousStore, 'head');
  if (baseline.size && store?.path !== previousStore.path) fail('已有记录时不能删除绑定或改存储路径来绕过冻结');
  for (const [path, bytes] of baseline) if (!files.get(path)?.equals(bytes)) fail(`已有 HEAD 记录不得改写或删除：${path}`);
  const runs = validateRecordFiles(files, store?.path);
  if (hasGit && (headRevision(root) !== head || !git(root, ['ls-files', '-sz']).equals(indexRaw))) fail('读取记录期间 Git 发生变化');
  if (!staged) {
    if (!diskBytes(ctx, REGISTRY).equals(registryBytes) || !equal(instanceMounts(root), ctx.mounts)) fail('读取记录期间配置或挂载变化');
    const again = filesFor(ctx, store, 'worktree');
    if (again.size !== files.size || [...files].some(([p, b]) => !again.get(p)?.equals(b))) fail('读取记录期间事件变化');
  }
  const stamp = rawDigest(encode({ head, index: rawDigest(indexRaw), registry: rawDigest(registryBytes), mounts: ctx.mounts, records: [...files].map(([p, b]) => [p, rawDigest(b)]) })).value;
  return { ...ctx, registryBytes, store, baselineStore: previousStore?.path ?? null, baselineStoreIdentity: readStoreIdentity(previousStore), files, runs, baseline, registryDigest: rawDigest(registryBytes), stamp, baselineState: head ? 'head-compared-not-worm' : hasGit ? 'unborn-no-history-baseline' : 'unavailable-not-git' };
}

function validateCheck(check) {
  // Read checks carry their complete versioned contract; claims cannot supply a command execution.
  object(check, ['id', 'version', 'owner', 'scope', 'activation', 'onEmpty', 'required', 'verification', 'fixtures', 'state', 'reason', 'count']);
  for (const key of ['id', 'owner', 'scope', 'activation', 'onEmpty', 'verification', 'reason']) text(check[key], key);
  if (!Number.isSafeInteger(check.version) || check.version < 1 || typeof check.required !== 'boolean' || !['pass', 'fail', 'not-applicable', 'evidence-gap', 'misconfigured', 'skipped'].includes(check.state) || !Number.isSafeInteger(check.count) || check.count < 0) fail('check 合同非法');
  object(check.fixtures, ['file', 'positive', 'negative']);
  for (const value of Object.values(check.fixtures)) text(value, 'fixture');
  const contract = READ_RULE_SETS.flat().find((rule) => rule.id === check.id && rule.version === check.version);
  if (!contract || Object.keys(contract).some((key) => !equal(contract[key], check[key])) || (check.required && check.state === 'not-applicable')) fail('内置检查合同不匹配或必需检查被标为不适用');
}
function validateInput(input) {
  object(input, ['source', 'documents', 'configuration', 'gitIndexDigest', 'receiverCompleteness']);
  object(input.source, ['mode', 'consistency', 'git', 'worktreeState', 'registry', 'evaluation', 'pathFindings', 'scope', 'privacy']);
  if (!plain(input.source) || input.source.mode !== 'current-worktree' || input.receiverCompleteness !== 'not-observed') fail('输入必须声明真实工作树与未观察的接收端完整性');
  digest(input.gitIndexDigest);
  object(input.configuration, ['registry', 'generator', 'identity']); digest(input.configuration.registry);
  if (!equal(input.source.registry?.digest, input.configuration.registry)) fail('Registry 身份必须与真实读取来源一致');
  if (input.configuration.generator !== 'curia-records/1' || input.configuration.identity !== 'on-disk-code-not-loaded-module-attestation') fail('generator 身份未支持');
  array(input.documents, 'inputs');
  const seen = new Set();
  for (const doc of input.documents) {
    object(doc, ['path', 'state', 'observedAt', 'size', 'range', 'sourceRef', 'evidenceRef', 'git']);
    relativePath(doc.path);
    if (doc.observedAt !== null) instant(doc.observedAt);
    if (doc.state !== 'not-read' && doc.observedAt === null) fail('已读输入必须有实际观察时间');
    if (seen.has(doc.path)) fail('输入路径重复'); seen.add(doc.path);
    if (!['read', 'partial', 'not-read'].includes(doc.state) || !Number.isSafeInteger(doc.size) || doc.size < 0) fail('输入状态或大小非法');
    object(doc.sourceRef, ['uri', 'revision', 'locator', 'observedAt']);
    if (doc.sourceRef.uri !== `repo:${doc.path}` || doc.sourceRef.observedAt !== doc.observedAt || !equal(doc.sourceRef.locator, doc.range)) fail('SourceRef 未绑定实际原件');
    if (doc.state === 'read') {
      object(doc.evidenceRef, ['kind', 'path', 'contentDigest', 'observedAt', 'verification']);
      digest(doc.evidenceRef.contentDigest);
      if (doc.evidenceRef.kind !== 'local-source-bytes' || doc.evidenceRef.path !== doc.path || doc.evidenceRef.observedAt !== doc.observedAt || doc.evidenceRef.verification !== 'not-verified' || !equal(doc.sourceRef.revision, doc.evidenceRef.contentDigest) || doc.range?.startByte !== 0 || doc.range?.endByteExclusive !== doc.size) fail('EvidenceRef 未绑定完整实际字节');
    } else if (doc.evidenceRef !== null || doc.sourceRef.revision !== null) fail('部分或未读输入不能持有全文摘要');
    if (doc.git !== null && !plain(doc.git)) fail('Git 来源形态错误');
  }
}
function validateBegin(payload) {
  if (payload?.executionMode === EXTERNAL_ASSERTION_MODE) { validateExternalAssertionBegin(payload); return; }
  if (payload?.executionMode === ASSERTION_MODE) { validateAssertionBegin(payload); return; }
  if (payload?.executionMode === 'impact-checks') { validateCheckBegin(payload); return; }
  if (payload?.executionMode === 'guard-command') {
    validateGuardBegin(payload); object(payload.references, ['corrects', 'retriedFrom']);
    for (const ref of Object.values(payload.references)) if (ref !== null) id(ref);
    return;
  }
  object(payload, ['executionMode', 'inputSnapshot', 'checks', 'manualChecks', 'references', 'unresolved', 'codeIdentity']);
  if (payload.executionMode !== 'manual-observation') fail('未支持的执行模式');
  validateInput(payload.inputSnapshot);
  array(payload.checks, 'checks'); payload.checks.forEach(validateCheck);
  if (!READ_RULE_SETS.some((rules) => rules.length === payload.checks.length && rules.every((rule) => payload.checks.some((check) => check.id === rule.id && check.version === rule.version))) || new Set(payload.checks.map((c) => c.id)).size !== payload.checks.length) fail('checks 缺失、重复或混用不兼容版本');
  array(payload.manualChecks, 'manualChecks', 128);
  for (const check of payload.manualChecks) if (typeof check !== 'string' || !/^[a-z][a-z0-9-]{0,79}$/.test(check)) fail('manual check 必须是短 kebab-case ID');
  if (new Set(payload.manualChecks).size !== payload.manualChecks.length) fail('manual checks 重复');
  object(payload.references, ['corrects', 'retriedFrom']);
  for (const ref of Object.values(payload.references)) if (ref !== null) id(ref);
  if (payload.references.corrects && payload.references.corrects === payload.references.retriedFrom) fail('更正与重试不能重复引用同一 Run');
  array(payload.unresolved, 'unresolved');
  for (const issue of payload.unresolved) if (!plain(issue) || typeof issue.code !== 'string') fail('缺口必须有 code');
  array(payload.codeIdentity, 'codeIdentity', 16);
  if (!payload.codeIdentity.length) fail('缺少代码文件身份');
  for (const item of payload.codeIdentity) { object(item, ['file', 'digest']); text(item.file, 'code file'); digest(item.digest); }
}
function validateObservation(payload, begin, seen) {
  object(payload, ['checkId', 'subject', 'statement', 'state', 'evidencePaths', 'gapReason', 'observer']);
  if (!begin.manualChecks.includes(payload.checkId) || seen.has(payload.checkId)) fail('检查未预声明或已经有观察；更正请新开 Run');
  seen.add(payload.checkId);
  for (const key of ['subject', 'statement', 'observer']) text(payload[key], key);
  if (!['satisfied', 'unsatisfied', 'evidence-gap'].includes(payload.state)) fail('人工观察状态非法');
  array(payload.evidencePaths, 'evidencePaths');
  if (new Set(payload.evidencePaths).size !== payload.evidencePaths.length) fail('证据路径重复');
  for (const path of payload.evidencePaths) if (!begin.inputSnapshot.documents.some((doc) => doc.path === path && doc.evidenceRef)) fail('证据只能引用本次实际完整读取的输入');
  if (payload.gapReason !== null) text(payload.gapReason, 'gapReason');
  if (!payload.evidencePaths.length && !payload.gapReason) fail('finding 必须有依据或明确的证据缺口');
  if (payload.state === 'satisfied' && (!payload.evidencePaths.length || payload.gapReason)) fail('有证据缺口的观察不能标为 satisfied');
}
export function deriveTerminal(events, endedAt, disposition = 'complete', reason = null, drift = []) {
  const begin = events[0].data.payload;
  if (isAssertionMode(begin.executionMode)) return recordedAssertionTerminal(events, endedAt, drift);
  if (begin.executionMode === 'guard-command') return deriveGuardTerminal(events, endedAt);
  if (begin.executionMode === 'impact-checks') return deriveCheckTerminal(events, endedAt, drift);
  const observations = events.filter((e) => e.data.kind === 'observation').map((e) => e.data.payload);
  const gates = [...begin.checks.map(({ id, state, required }) => ({ id, state, required, verification: 'static-local-observation' })), ...begin.manualChecks.map((id) => {
    const item = observations.find((x) => x.checkId === id);
    return { id: `manual/${id}`, state: !item ? 'skipped' : { satisfied: 'pass', unsatisfied: 'fail', 'evidence-gap': 'evidence-gap' }[item.state], required: true, verification: 'self-reported-not-authenticated' };
  })];
  if (!['complete', 'cancel'].includes(disposition)) fail('终态只接受 complete 或 cancel');
  if (disposition === 'cancel') text(reason, '取消原因'); else if (reason !== null) fail('完成不能带取消原因');
  const status = disposition === 'cancel' ? 'cancelled' : gates.some((g) => ['fail', 'misconfigured'].includes(g.state)) ? 'failed' : gates.some((g) => ['evidence-gap', 'skipped'].includes(g.state)) || begin.unresolved.length ? 'incomplete' : 'passed';
  return { status, terminal: true, endedAt, exitCode: { passed: 0, failed: 1, incomplete: 2, cancelled: 130 }[status], gates, errors: gates.filter((g) => ['fail', 'misconfigured'].includes(g.state)).map((g) => ({ code: g.id, state: g.state })), disposition, reason, drift, businessOutcome: 'not-evaluated', evidenceCompleteness: { sourceBytes: begin.inputSnapshot.documents.every((d) => d.evidenceRef) && begin.inputSnapshot.documents.length > 0 ? 'complete-for-selected-inputs' : 'incomplete', factVerification: 'not-verified', receiver: 'not-observed' }, outputs: [], unresolved: [...begin.unresolved, ...gates.filter((g) => ['evidence-gap', 'skipped'].includes(g.state)).map((g) => ({ code: g.id, reason: g.state }))] };
}
/** Pure decoder shared by CLI and staged guard; hash chaining is integrity, not a signature or WORM. */
export function validateRecordFiles(files, storePath) {
  const runs = new Map();
  if (files.size && !storePath) fail('有事件却无 recordStore 绑定');
  for (const [path, bytes] of files) {
    if (!path.startsWith(`${storePath}/`)) fail('事件路径越出 recordStore');
    const name = path.slice(storePath.length + 1);
    const match = EVENT_NAME.exec(name);
    if (!match) fail(`记录目录只允许事件；临时或未知文件需人工核对：${path}`);
    if (bytes.length > RECORD_LIMITS.eventBytes) fail('事件超预算');
    const data = parseRegistryJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    object(data, ['schema', 'runId', 'workflowId', 'sequence', 'previous', 'kind', 'observedAt', 'payload']);
    if (![RUN_SCHEMA, 'curia.run-event/2', 'curia.run-event/3', 'curia.run-event/7', 'curia.run-event/8', 'curia.run-event/9', ASSERTION_EVENT_SCHEMA, ORIGINAL_ASSERTION_EVENT_SCHEMA, EXTERNAL_ASSERTION_EVENT_SCHEMA].includes(data.schema) || data.runId !== match[1] || data.workflowId !== `w-${data.runId.slice(2)}` || data.sequence !== Number(match[2])) fail('事件身份、名称或 workflow-id 不一致');
    instant(data.observedAt);
    const events = runs.get(data.runId) ?? []; events.push({ path, bytes, data }); runs.set(data.runId, events);
  }
  for (const [runId, events] of runs) {
    events.sort((a, b) => a.data.sequence - b.data.sequence);
    const seen = new Set();
    for (let i = 0; i < events.length; i++) {
      const data = events[i].data;
      const assertion = isAssertionMode(events[0].data.payload.executionMode);
      const guarded = events[0].data.payload.executionMode === 'guard-command';
      const batch = events[0].data.payload.executionMode === 'impact-checks';
      if (data.schema !== (assertion ? recordedAssertionSchema(events[0].data.payload) : batch ? checkEventSchema(events[0].data.payload) : guarded ? guardEventSchema(events[0].data.payload) : RUN_SCHEMA)) fail('事件 schema 与执行模式不匹配或被混用');
      if (data.sequence !== i || data.previous !== (i ? rawDigest(events[i - 1].bytes).value : null)) fail(`序号或摘要链不连续：${runId}`);
      if (i && (data.observedAt < events[i - 1].data.observedAt || events[i - 1].data.kind === 'terminal')) fail('事件时点倒退或 terminal 后追加');
      if (!i) { if (data.kind !== 'begin') fail('Run 必须从 begin 开始'); validateBegin(data.payload); if (assertion && data.payload.recordContext.recordStore !== storePath) fail('断言存储声明与事件位置不一致'); if ((assertion ? [data.payload.verification.completedAt] : batch ? checkObservationTimes(data.payload) : guarded ? guardInputObservationTimes(data.payload.inputSnapshot) : data.payload.inputSnapshot.documents.map(doc => doc.observedAt)).some(at => at !== null && at > data.observedAt)) fail('输入采集晚于 Run 开始'); }
      else if (data.kind === 'observation') { if (assertion || guarded || batch) fail('人工观察不能伪造命令执行'); validateObservation(data.payload, events[0].data.payload, seen); }
      else if (data.kind === 'command') {
        if (batch) {
          validateCheckReceipt(data.payload, events[0].data.payload, events.slice(1, i).map(e => e.data.payload));
          if (data.payload.receipt.startedAt < events[i - 1].data.observedAt || data.payload.receipt.endedAt > data.observedAt) fail('批次命令时间不属于当前串行阶段');
          continue;
        }
        if (!guarded || i !== 1) fail('每个 guard Run 恰好有一份命令回执');
        validateGuardReceipt(data.payload, events[0].data.payload);
        if (data.payload.startedAt < events[0].data.observedAt || data.payload.endedAt > data.observedAt) fail('命令观察时间不属于本次 Run');
      }
      else if (data.kind === 'terminal') {
        const p = data.payload;
        if (assertion) {
          if (i !== 1 || !plain(p) || !equal(p, recordedAssertionTerminal(events.slice(0, i), data.observedAt, p.drift))) fail('断言封存只能由本次核验观察与上下文派生');
          continue;
        }
        if (batch) {
          if (!plain(p) || !equal(p, deriveCheckTerminal(events.slice(0, i), data.observedAt, p.drift))) fail('批次 terminal 只能由实际回执与缺口派生');
          continue;
        }
        if (guarded) {
          if (!equal(p, deriveGuardTerminal(events.slice(0, i), data.observedAt))) fail('guard terminal 只能由真实命令回执派生');
          continue;
        }
        if (!plain(p) || !Array.isArray(p.drift) || p.drift.some((v) => !['registry', 'code', 'head', 'index'].includes(v)) || new Set(p.drift).size !== p.drift.length) fail('终态漂移列表非法');
        if (p.disposition !== 'cancel' && p.drift.some((v) => ['registry', 'code'].includes(v))) fail('配置漂移不得混用完成');
        if (!equal(p, deriveTerminal(events.slice(0, i), data.observedAt, p.disposition, p.reason, p.drift))) fail('terminal 必须由实际 checks 与缺口派生，不接受手填成功');
      } else fail('事件种类非法或重复 begin');
    }
  }
  const visited = new Set(); const visiting = new Set();
  const visit = (runId) => {
    if (visiting.has(runId)) fail('corrects / retried-from 引用成环');
    if (visited.has(runId)) return;
    visiting.add(runId);
    const events = runs.get(runId);
    if (isAssertionMode(events[0].data.payload.executionMode)) recordedAssertionReferences(events[0].data.payload, runs);
    for (const ref of Object.values(events[0].data.payload.references).filter(Boolean)) {
      const target = runs.get(ref);
      if (!target || target.at(-1).data.kind !== 'terminal') fail('引用目标必须是已有终态 Run');
      if (target.at(-1).data.observedAt > events[0].data.observedAt) fail('引用的终态晚于本次 Run 开始');
      visit(ref);
    }
    visiting.delete(runId); visited.add(runId);
  };
  for (const runId of runs.keys()) visit(runId);
  return runs;
}

export function recordCodeIdentity(mode = 'manual-observation') {
  const dir = dirname(fileURLToPath(import.meta.url));
  const files = ['curia-records.mjs', 'curia-workflow.mjs', 'curia-query.mjs', 'curia-dependencies.mjs', 'curia-impact.mjs', 'curia-relations.mjs', 'curia-instance.mjs', 'curia-json.mjs', 'curia-originals.mjs', 'curia-applicability.mjs', 'curia-guard-contract.mjs', 'curia-guard-runtime.mjs', 'curia-check-contract.mjs', 'curia-verify.mjs', 'curia-assertion-contract.mjs', 'doc-lib.mjs'];
  if (mode === EXTERNAL_ASSERTION_MODE) files.push('curia-external.mjs', 'curia-network.mjs', 'curia-external-assertion-contract.mjs');
  if (['guard-command', 'impact-checks'].includes(mode)) files.push('curia-guards.mjs', 'curia-snapshots.mjs');
  if (mode === 'impact-checks') files.push('curia-checks.mjs');
  return files.map((file) => {
    const path = join(dir, file); const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) fail('执行代码文件身份不可确认');
    if (stat.size > RECORD_LIMITS.eventBytes) fail('代码文件超预算；拒绝把前缀摘要当成完整代码身份');
    return { file, digest: rawDigest(readStableFile(path, stat, RECORD_LIMITS.eventBytes)) };
  });
}
const codeIdentity = recordCodeIdentity;
function writable(root, options = {}) {
  const ctx = loadRecordStore(root, options);
  if (!ctx.store) fail('未启用 instance.recordStore；普通阅读不会自动启用记录');
  return ctx;
}
function createStoreDirectory(ctx) {
  const parts = ctx.store.path.split('/');
  for (let i = 1; i <= parts.length; i++) {
    const path = parts.slice(0, i).join('/');
    try { checkInstancePath(ctx.root, path, 'directory', ctx.index, ctx.rootStat, ctx.mounts); }
    catch (e) { if (e.code !== 'ENOENT') throw e; mkdirSync(join(ctx.root, path), { mode: 0o700 }); checkInstancePath(ctx.root, path, 'directory', ctx.index, ctx.rootStat, ctx.mounts); }
  }
}
function publish(ctx, runId, kind, payload, expected) {
  const events = ctx.runs.get(runId) ?? [];
  if (events.length && events.at(-1).data.kind === 'terminal') fail('Run 已终态；更正或重试必须新开 Run');
  if (expected !== (events.length ? headToken(events.at(-1)) : null)) fail('expected-head 不匹配；拒绝自动重试覆盖');
  const observedAt = new Date().toISOString();
  if (events.length && observedAt < events.at(-1).data.observedAt) fail('时钟回拨；拒绝颠倒事件顺序');
  if (kind === 'terminal') payload = deriveTerminal(events, observedAt, payload.disposition, payload.reason, payload.drift);
  const mode = events[0]?.data.payload.executionMode ?? payload.executionMode;
  const data = { schema: isAssertionMode(mode) ? recordedAssertionSchema(events[0]?.data.payload ?? payload) : mode === 'impact-checks' ? checkEventSchema(events[0]?.data.payload ?? payload) : mode === 'guard-command' ? guardEventSchema(events[0]?.data.payload ?? payload) : RUN_SCHEMA, runId, workflowId: `w-${runId.slice(2)}`, sequence: events.length, previous: events.length ? rawDigest(events.at(-1).bytes).value : null, kind, observedAt, payload };
  const bytes = encode(data); const path = `${ctx.store.path}/${eventName(runId, events.length)}`;
  const candidate = new Map([...ctx.files, [path, bytes]]); validateRecordFiles(candidate, ctx.store.path);
  if (candidate.size > RECORD_LIMITS.files || [...candidate.values()].reduce((n, b) => n + b.length, 0) > RECORD_LIMITS.totalBytes) fail('记录存储超预算');
  const fresh = writable(ctx.root, { expectedBoundary: recordReadBoundary(ctx) });
  if (fresh.stamp !== ctx.stamp) fail('记录、配置或 Git 在操作期间变化；未写入');
  if (kind === 'begin' && !equal(payload.codeIdentity, codeIdentity(mode))) fail('代码文件在读取输入期间变化；未写入');
  if (mode === 'manual-observation' && kind !== 'begin' && !(kind === 'terminal' && payload.disposition === 'cancel') && !equal(events[0].data.payload.codeIdentity, codeIdentity())) fail('代码文件在追加期间变化；未写入');
  try { git(ctx.root, ['check-ignore', '--no-index', '-q', '--', path]); fail('记录路径被 Git 忽略，不能建立可审查基线'); } catch (e) { if (e.status !== 1) throw e; }
  createStoreDirectory(fresh);
  const tmp = join(ctx.root, ctx.store.path, `.pending-${randomUUID()}`);
  const target = join(ctx.root, path);
  let created = false;
  let published = false;
  const dirfd = openSync(join(ctx.root, ctx.store.path), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  const directory = fstatSync(dirfd);
  try {
    const fd = openSync(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); created = true;
    try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
    // link is an exclusive atomic publication: identical expected heads compete for one sequence name.
    const currentDirectory = checkInstancePath(ctx.root, ctx.store.path, 'directory', fresh.index, fresh.rootStat, fresh.mounts);
    if (currentDirectory.dev !== directory.dev || currentDirectory.ino !== directory.ino) fail('记录目录在写入期间被替换');
    linkSync(tmp, target); published = true;
  } finally {
    try { if (created) unlinkSync(tmp); if (published) fsyncSync(dirfd); }
    catch (e) { fail(`发布或目录同步状态需核对：${runId} ${path}；不得盲重试：${e.message}`); }
    finally { closeSync(dirfd); }
  }
  try {
    if (!diskBytes(fresh, path).equals(bytes)) fail('发布的事件字节变化');
    return { ...describeRun({ ...fresh, files: candidate, runs: validateRecordFiles(candidate, ctx.store.path) }, runId), receiptScope: 'published-event-snapshot-not-latest-store' };
  }
  catch (e) { fail(`事件已发布但回执复核失败：${runId} ${path}；先 show 核对，不得盲重试：${e.message}`); }
}
function snapshot(report, ctx) {
  return {
    source: report.input,
    documents: report.documents.map((doc) => ({ path: doc.path, state: doc.state, observedAt: doc.observedAt, size: doc.size, range: doc.range, sourceRef: { uri: `repo:${doc.path}`, revision: doc.digest ?? null, locator: doc.range, observedAt: doc.observedAt }, evidenceRef: doc.digest ? { kind: 'local-source-bytes', path: doc.path, contentDigest: doc.digest, observedAt: doc.observedAt, verification: 'not-verified' } : null, git: doc.envelope?.git ?? null })),
    configuration: { registry: ctx.registryDigest, generator: 'curia-records/1', identity: 'on-disk-code-not-loaded-module-attestation' },
    gitIndexDigest: rawDigest(ctx.indexRaw), receiverCompleteness: 'not-observed',
  };
}
/** Explicit start is the sole persistent-read entry; IDs are never caller supplied. */
export function startRun(root = ROOT, options = {}) {
  object(options, ['selection'], ['limits', 'includeUntracked', 'manualChecks', 'corrects', 'retriedFrom']);
  const ctx = writable(root);
  const codes = codeIdentity();
  const selected = normalizeReadSelection(options.selection);
  // Output records are never silently fed back into their own persistent-read workflow.
  const selection = { ...selected, exclusions: [...selected.exclusions] };
  if (!selection.exclusions.some((p) => ctx.store.path === p || ctx.store.path.startsWith(`${p}/`))) selection.exclusions.push(ctx.store.path);
  const report = buildReadWorkflow(ctx.root, { selection, ...(options.limits ? { limits: options.limits } : {}), includeUntracked: options.includeUntracked ?? false });
  if (!equal(report.input.registry.digest, ctx.registryDigest)) fail('输入与记录配置身份不同');
  const runId = `r-${randomUUID()}`;
  const payload = { executionMode: 'manual-observation', inputSnapshot: snapshot(report, ctx), checks: report.checks, manualChecks: options.manualChecks ?? [], references: { corrects: options.corrects ?? null, retriedFrom: options.retriedFrom ?? null }, unresolved: report.unresolved, codeIdentity: codes };
  return publish(ctx, runId, 'begin', payload, null);
}
function currentRun(ctx, runId, expected) {
  id(runId);
  const events = ctx.runs.get(runId);
  if (!events) fail('Run 不存在');
  if (typeof expected !== 'string' || expected !== headToken(events.at(-1))) fail('必须提供准确 expected-head');
  if (events.at(-1).data.kind === 'terminal') fail('Run 已终态；不能覆盖、更正或再结束');
  return events;
}
function driftFor(ctx, events) {
  const begin = events[0].data.payload;
  if (isAssertionMode(begin.executionMode)) {
    const c = begin.recordContext;
    return [...(!equal(c.registryDigest, ctx.registryDigest) ? ['registry'] : []), ...(!equal(begin.codeIdentity, codeIdentity(begin.executionMode)) ? ['code'] : []), ...(c.head !== ctx.head ? ['head'] : []), ...(!equal(c.gitIndexDigest, rawDigest(ctx.indexRaw)) ? ['index'] : [])];
  }
  const input = begin.executionMode === 'guard-command' ? primaryGuardInput(begin.inputSnapshot) : begin.inputSnapshot;
  return [...(!equal(input.configuration.registry, ctx.registryDigest) ? ['registry'] : []), ...(!equal(begin.codeIdentity, codeIdentity(begin.executionMode)) ? ['code'] : []), ...(input.source.git.head !== ctx.head ? ['head'] : []), ...(!equal(input.gitIndexDigest, rawDigest(ctx.indexRaw)) ? ['index'] : [])];
}
export function appendObservation(root, runId, expected, observation) {
  const ctx = writable(root); const events = currentRun(ctx, runId, expected);
  if (events[0].data.payload.executionMode !== 'manual-observation') fail('命令 Run 不能用人工观察补写');
  if (driftFor(ctx, events).some((v) => ['registry', 'code'].includes(v))) fail('配置或代码身份漂移；只能明确取消后重开');
  return publish(ctx, runId, 'observation', observation, expected);
}
export function finishRun(root, runId, expected, options = {}) {
  object(options, [], ['cancel', 'reason']);
  if (options.cancel !== undefined && typeof options.cancel !== 'boolean') fail('cancel 必须是布尔值');
  const ctx = writable(root); const events = currentRun(ctx, runId, expected); const drift = driftFor(ctx, events);
  if (isAssertionMode(events[0].data.payload.executionMode)) {
    if (options.cancel || options.reason != null) fail('已有核验观察只能按 expected-head 封存，不能改写或伪造取消');
    return publish(ctx, runId, 'terminal', { drift }, expected);
  }
  if (events[0].data.payload.executionMode !== 'manual-observation') fail('命令 Run 必须由 supervisor 实际回执结束');
  if (!options.cancel && drift.some((v) => ['registry', 'code'].includes(v))) fail('配置或代码漂移；不得混用完成，只能明确取消后重开');
  return publish(ctx, runId, 'terminal', { disposition: options.cancel ? 'cancel' : 'complete', reason: options.reason ?? null, drift }, expected);
}
export function beginGuardRecord(root, payload, expectedBoundary = null) {
  if (![GUARD_RUN_SCHEMA, MULTI_GUARD_RUN_SCHEMA].includes(payload?.schema)) fail('历史 guard Run 只读兼容；新 Run 不得降级到旧隐私合同');
  const ctx = writable(root, { expectedBoundary }); validateGuardBegin(payload);
  const primary = primaryGuardInput(payload.inputSnapshot);
  if (!equal(primary.configuration.registry, ctx.registryDigest) || !equal(primary.gitIndexDigest, rawDigest(ctx.indexRaw)) || primary.source.git.root !== ctx.root || primary.source.git.head !== ctx.head) fail('guard plan 与记录配置 / index 不一致');
  return publish(ctx, `r-${randomUUID()}`, 'begin', payload, null);
}
export function appendGuardReceipt(root, runId, expected, handle, inputDrift, expectedBoundary = null) {
  const ctx = writable(root, expectedBoundary === null ? {} : { expectedBoundary, boundaryMode: 'store-only' }); const events = currentRun(ctx, runId, expected); const begin = events[0].data.payload;
  if (begin.executionMode !== 'guard-command') fail('不能把命令结果塞入人工观察 Run');
  const receipt = commandReceipt(handle, { runId, adapter: begin.adapter, invocation: primaryGuardInput(begin.inputSnapshot).commandIdentity.invocation, repositoryBindings: repositoryBindingDigest(begin.inputSnapshot) });
  array(inputDrift, 'inputDrift');
  for (const path of inputDrift) text(path, 'drift path');
  receipt.inputDrift = [...new Set([...inputDrift, ...driftFor(ctx, events).map((kind) => `$context/${kind}`)])];
  return publish(ctx, runId, 'command', receipt, expected);
}
export function finishGuardRecord(root, runId, expected, expectedBoundary = null) {
  const ctx = writable(root, expectedBoundary === null ? {} : { expectedBoundary, boundaryMode: 'store-only' }); const events = currentRun(ctx, runId, expected);
  if (events[0].data.payload.executionMode !== 'guard-command') fail('不是 guard Run');
  return publish(ctx, runId, 'terminal', {}, expected);
}
// A published begin grants a process-local, single-use sequence. JSON is never an execution capability.
const checkRuns = new WeakMap();
export function beginCheckRecord(root, payload, expectedBoundary = null) {
  const ctx = writable(root, { expectedBoundary }); validateCheckBegin(payload);
  if (!equal(payload.inputSnapshot.configuration.registry, ctx.registryDigest) || !equal(payload.inputSnapshot.gitIndexDigest, rawDigest(ctx.indexRaw)) || payload.inputSnapshot.source.git.head !== ctx.head || payload.inputSnapshot.source.git.root !== ctx.root) fail('批次计划与当前配置 / Git 不一致');
  const run = publish(ctx, `r-${randomUUID()}`, 'begin', payload, null), capability = Object.freeze({});
  checkRuns.set(capability, { root: ctx.root, boundary: recordReadBoundary(ctx), runId: run.runId, expected: run.expectedHead, begin: structuredClone(payload), claimed: null, closed: false });
  return { run, capability };
}
function checkCapability(capability) {
  const saved = checkRuns.get(capability);
  if (!saved || saved.closed) fail('批次需要本进程真实 begin 的 open 能力，不能从 JSON 或历史 Run 恢复');
  const ctx = writable(saved.root, { expectedBoundary: saved.boundary, boundaryMode: 'store-only' }), events = currentRun(ctx, saved.runId, saved.expected);
  if (!equal(events[0].data.payload, saved.begin)) fail('批次 begin 被改写；不自动恢复或重跑');
  return { saved, ctx, events };
}
export function claimCheckExecution(capability, adapterId, planDigest, observedPlan) {
  const { saved, events } = checkCapability(capability);
  const commands = events.filter(e => e.data.kind === 'command').map(e => e.data.payload);
  const selected = saved.begin.checks.filter(c => c.guard), next = selected[commands.length];
  if (saved.claimed || !next || next.id !== adapterId || !equal(next.guard.planDigest, planDigest) || commands.some((c, i) => guardResult(selected[i], c.receipt, c.receipt.endedAt).status !== 'passed')) fail('批次执行已领取、顺序不符、计划变化或前项未通过；未知效果不得重跑');
  const snapshotIdentity = guardInputIdentity;
  if (!observedPlan?.inputSnapshot || ['adapter', 'codeIdentity', 'risks'].some(key => !equal(next.guard[key], observedPlan[key])) || !equal(snapshotIdentity(next.guard.inputSnapshot), snapshotIdentity(observedPlan.inputSnapshot))) fail('真实 guard plan 与预声明执行不一致；摘要字符串本身不是能力');
  saved.claimed = adapterId;
  return { root: saved.root, runId: saved.runId };
}
export function appendCheckReceipt(capability, handle, inputDrift) {
  const { saved, ctx, events } = checkCapability(capability);
  const check = saved.begin.checks.find(c => c.id === saved.claimed);
  if (!check?.guard) fail('没有已领取的检查执行');
  const receipt = commandReceipt(handle, { runId: saved.runId, adapter: check.guard.adapter, invocation: primaryGuardInput(check.guard.inputSnapshot).commandIdentity.invocation, repositoryBindings: repositoryBindingDigest(check.guard.inputSnapshot) });
  array(inputDrift, 'inputDrift'); for (const path of inputDrift) text(path, 'input drift');
  receipt.inputDrift = [...new Set([...inputDrift, ...driftFor(ctx, events).map(kind => `$context/${kind}`)])];
  const run = publish(ctx, saved.runId, 'command', { checkId: check.id, receipt }, saved.expected);
  saved.expected = run.expectedHead; saved.claimed = null;
  return run;
}
export function finishCheckRecord(capability, inputDrift = []) {
  const { saved, ctx, events } = checkCapability(capability);
  if (saved.claimed) fail('命令效果未记录；保持 open，不猜终态或重跑');
  array(inputDrift, 'inputDrift'); for (const path of inputDrift) text(path, 'input drift');
  const drift = [...new Set([...inputDrift, ...driftFor(ctx, events).map(kind => `$context/${kind}`)])];
  const run = publish(ctx, saved.runId, 'terminal', { drift }, saved.expected); saved.closed = true; return run;
}
/** Explicit verification and persistence are one local action; serialized reports are never accepted. */
export function recordAssertion(root = ROOT, options = {}) { return recordLocalAssertion(root, options, false); }
export function recordOriginalAssertion(root = ROOT, options = {}) { return recordLocalAssertion(root, options, true); }
function recordLocalAssertion(root, options, original) {
  object(options, ['verification'], ['corrects', 'retriedFrom', 'reason']);
  const normalized = original ? normalizeOriginalOptions(options.verification) : normalizeVerificationOptions(options.verification);
  if (!normalized.nonSensitive || normalized.protected) fail('断言记录只接受显式非敏感本地核验；受保护请求不降级');
  const request = original ? { method: ORIGINAL_ASSERTION_METHOD, register: normalized.register, id: normalized.id, source: normalized.source, exclusions: normalized.exclusions, includeUntracked: normalized.includeUntracked, nonSensitive: true, maxSourceBytes: normalized.maxSourceBytes } : { method: normalized.method, left: normalized.left, right: normalized.right, exclusions: normalized.exclusions, includeUntracked: normalized.includeUntracked, nonSensitive: true };
  const subjectKey = assertionSubjectKey(request), ctx = writable(root), codes = codeIdentity(ASSERTION_MODE);
  const references = { corrects: options.corrects ?? null, retriedFrom: options.retriedFrom ?? null }, correctionReason = options.reason ?? null;
  validateAssertionReferences({ references, correctionReason, subjectKey }, ctx.runs);
  if (normalized.paths.some(path => path === ctx.store.path || path.startsWith(`${ctx.store.path}/`) || ctx.store.path.startsWith(`${path}/`))) fail('核验输入与记录输出必须分离');
  const selected = prepareSourceSelection(ctx.root, { paths: normalized.paths, exclusions: normalized.exclusions, includeUntracked: normalized.includeUntracked, nonSensitive: true });
  if (selected.objects.some(item => ['privacy-excluded', 'privacy-not-declared', 'ignored-source'].includes(item.reason))) fail('敏感、排除或忽略的来源不进入持久化记录');
  const { method: originalMethod, ...originalRequest } = request;
  const report = original ? verifyRegisteredOriginal(ctx.root, originalRequest) : verifySources(ctx.root, request);
  if (report.unresolved.some(issue => ['privacy-excluded', 'privacy-not-declared', 'ignored-source'].includes(issue))) fail('来源隐私发生变化，不持久化核验结果');
  for (const source of original ? [report.observation?.register?.source, report.observation?.original?.source] : [report.observation?.source]) if (source && (!equal(source.registry.digest, ctx.registryDigest) || source.git.head !== ctx.head)) fail('核验与记录上下文不一致，未写入');
  const payload = { schema: original ? ORIGINAL_ASSERTION_RUN_SCHEMA : ASSERTION_RUN_SCHEMA, executionMode: ASSERTION_MODE, request, subjectKey,
    recordContext: { root: ctx.root, head: ctx.head, registryDigest: ctx.registryDigest, gitIndexDigest: rawDigest(ctx.indexRaw), recordStore: ctx.store.path },
    verification: assertionObservation(report), references, correctionReason, codeIdentity: codes };
  validateAssertionBegin(payload);
  const run = publish(ctx, `r-${randomUUID()}`, 'begin', payload, null);
  try { return finishRun(ctx.root, run.runId, run.expectedHead); }
  catch { fail(`核验观察已发布但尚未确认封存：${run.runId}；先 show 核对，按 expected-head finish，不得盲重跑`); }
}
/** Explicit external observation then ordinary append-only recording. No caller-supplied report is accepted. */
export async function recordExternalOriginalAssertion(root = ROOT, options = {}, signal = null) {
  object(options, ['verification'], ['corrects', 'retriedFrom', 'reason']);
  const { normalizeExternalOriginalOptions, verifyRegisteredExternal, unsafeTlsEnvironment } = await import('./curia-external.mjs');
  const n = normalizeExternalOriginalOptions(options.verification), network = n.network;
  if (signal !== null && !(signal instanceof AbortSignal)) fail('取消信号非法');
  if (!network.nonSensitive || network.protected || unsafeTlsEnvironment() || signal?.aborted) fail('外部记录需要非敏感范围和安全的未认证读取；拒绝受保护降级或预先取消');
  const request = { method: EXTERNAL_ASSERTION_METHOD, register: n.register, id: n.id, url: network.url, allowOrigin: network.origin, allowInternalOrigin: network.allowInternal ? network.origin : null, mediaType: network.mediaType, trustCert: options.verification.trustCert ?? null, exclusions: n.exclusions, includeUntracked: n.includeUntracked, nonSensitive: true, maxBytes: network.maxBytes, timeoutMs: network.timeoutMs };
  const subjectKey = externalAssertionSubjectKey(request), ctx = writable(root), codes = codeIdentity(EXTERNAL_ASSERTION_MODE);
  const references = { corrects: options.corrects ?? null, retriedFrom: options.retriedFrom ?? null }, correctionReason = options.reason ?? null;
  validateExternalAssertionReferences({ references, correctionReason, subjectKey }, ctx.runs);
  if (n.paths.some(path => path === ctx.store.path || path.startsWith(`${ctx.store.path}/`) || ctx.store.path.startsWith(`${path}/`))) fail('登记、CA 与记录输出必须分离');
  const selection = { paths: n.paths, exclusions: n.exclusions, includeUntracked: n.includeUntracked, nonSensitive: true };
  const privateSelection = cap => cap.objects.some(item => ['privacy-excluded', 'privacy-not-declared', 'ignored-source'].includes(item.reason));
  const selected = prepareSourceSelection(ctx.root, selection);
  if (privateSelection(selected)) fail('敏感、排除或忽略的来源不进入外部记录');
  const report = await verifyRegisteredExternal(ctx.root, options.verification, signal);
  try {
    if (privateSelection(prepareSourceSelection(ctx.root, selection))) fail('来源隐私发生变化');
    if (report.assertion.evidenceRefs.length && !revalidateSourceSelection(selected)) fail('记录释放前来源变化');
    const source = report.observation?.registration?.source;
    if (source && (!equal(source.registry.digest, ctx.registryDigest) || source.git.head !== ctx.head)) fail('核验与记录上下文不一致');
    const payload = { schema: EXTERNAL_ASSERTION_RUN_SCHEMA, executionMode: EXTERNAL_ASSERTION_MODE, request, subjectKey, recordContext: { root: ctx.root, head: ctx.head, registryDigest: ctx.registryDigest, gitIndexDigest: rawDigest(ctx.indexRaw), recordStore: ctx.store.path }, verification: externalAssertionObservation(report), references, correctionReason, codeIdentity: codes };
    validateExternalAssertionBegin(payload);
    const run = publish(ctx, `r-${randomUUID()}`, 'begin', payload, null);
    try { return finishRun(ctx.root, run.runId, run.expectedHead); }
    catch { fail(`外部观察已发布但尚未确认封存：${run.runId}；先 show 核对，按 expected-head finish，不得盲重跑`); }
  } catch (error) { fail(`外部核验已尝试，记录未确认完成；核对已有记录，不得盲重跑：${error.message}`); }
}
/** Explicit connected history only: retries do not retire conclusions, and forks never pick a winner. */
export function assertionHistory(root, runId) {
  id(runId); const ctx = writable(root), anchor = ctx.runs.get(runId);
  if (!isAssertionMode(anchor?.[0].data.payload.executionMode)) fail('history 只接受断言 Run');
  const adjacency = new Map();
  for (const [name, events] of ctx.runs) {
    const begin = events[0].data.payload; if (!isAssertionMode(begin.executionMode)) continue;
    for (const ref of Object.values(begin.references).filter(Boolean)) { (adjacency.get(name) ?? adjacency.set(name, new Set()).get(name)).add(ref); (adjacency.get(ref) ?? adjacency.set(ref, new Set()).get(ref)).add(name); }
  }
  const names = new Set([runId]), queue = [runId];
  for (let n = 0; n < queue.length; n++) for (const next of adjacency.get(queue[n]) ?? []) if (!names.has(next)) { names.add(next); queue.push(next); if (names.size > ASSERTION_HISTORY_LIMIT) fail('显式断言历史组件超过有界视图，未返回部分成功'); }
  const nodes = [...names].sort().map(name => {
    const events = ctx.runs.get(name), begin = events[0].data.payload, last = events.at(-1).data, terminal = last.kind === 'terminal';
    return { runId: name, subjectKey: begin.subjectKey, references: begin.references, correctionReason: begin.correctionReason, recordedAt: events[0].data.observedAt, terminal, runStatus: terminal ? last.payload.status : 'open', assertion: begin.verification.assertion, evaluatedAt: begin.verification.evaluatedAt, completedAt: begin.verification.completedAt, unresolved: begin.verification.unresolved, evidenceEvent: { path: events[0].path, digest: rawDigest(events[0].bytes) } };
  });
  const edges = nodes.flatMap(node => Object.entries(node.references).filter(([, target]) => target).map(([kind, target]) => ({ from: node.runId, to: target, kind, effective: node.terminal && kind === 'corrects' })));
  const retired = new Set(edges.filter(edge => edge.effective).map(edge => edge.to));
  const heads = nodes.filter(node => node.terminal && !retired.has(node.runId)).map(node => node.runId);
  const unresolved = [...nodes.filter(node => !node.terminal || node.runStatus === 'incomplete' && !retired.has(node.runId)).map(node => ({ code: node.terminal ? 'incomplete-record' : 'unsealed-observation', runId: node.runId })), ...(heads.length !== 1 ? [{ code: 'ambiguous-recorded-conclusions' }] : [])];
  return { schema: anchor[0].data.payload.executionMode === EXTERNAL_ASSERTION_MODE ? 'curia.external-assertion-history/1' : anchor[0].data.payload.schema === ORIGINAL_ASSERTION_RUN_SCHEMA ? 'curia.assertion-history/2' : 'curia.assertion-history/1', generatedAt: new Date().toISOString(), runId, subjectKey: anchor[0].data.payload.subjectKey, scope: { recordStore: ctx.store.path, basis: 'explicit-reference-component', allMatchingSubjects: false, sourceBodiesRead: 0 }, nodes, edges, conclusionHeads: heads, selectedConclusion: unresolved.length ? null : heads[0], state: unresolved.length ? 'incomplete' : 'resolved-recorded-history', exitCode: unresolved.length ? 2 : 0, unresolved, limits: [...assertionLimits(anchor[0].data.payload.executionMode)] };
}
/** Inspect configured responsibility and record integrity; never read policy/evidence bodies or run recovery. */
export function inspectRecordStore(root = ROOT) {
  const ctx = loadRecordStore(root), registry = parseRegistryJson(new TextDecoder('utf-8', { fatal: true }).decode(ctx.registryBytes)), instance = normalizeInstance(registry.instance, registry.types);
  const report = { schema: 'curia.record-preservation-report/1', state: 'not-applicable', exitCode: 0, store: null, declarations: {}, configurationGaps: [], verificationGaps: [], recordCoverage: null, observation: { stable: false, registryDigest: null, policyBodiesRead: 0, evidenceBodiesRead: 0 }, retention: { deletionAuthorized: false, automaticCleanup: false, externalReferences: 'not-completely-indexed' }, assurance: { authority: 'not-authenticated', backup: 'not-verified', recovery: 'not-verified', cacheIsBackup: false }, effects: ['registry-records-and-reference-metadata-read'] };
  const metadata = ref => {
    if (privateReadPath(ref) || taskPrivatePath(instance, ref) || Object.values(instance.guards ?? {}).some(g => g.privacy.sensitivePaths.some(prefix => containsPath({ path: prefix, kind: 'directory' }, ref)))) return { state: 'withheld', path: null };
    try { const st = checkInstancePath(ctx.root, ref, 'file', ctx.index, ctx.rootStat, ctx.mounts); return { state: 'present', path: ref, identity: [st.dev, st.ino, st.mode, st.nlink, st.size, st.mtimeMs, st.ctimeMs] }; }
    catch { return { state: 'unavailable', path: ref }; }
  };
  const before = new Map();
  const observe = (role, ref) => { if (!before.has(ref)) before.set(ref, metadata(ref)); const value = before.get(ref); if (value.state !== 'present') report.configurationGaps.push({ code: 'preservation/reference-' + value.state, role, path: value.path }); return { state: value.state, path: value.path, content: 'not-read' }; };
  if (ctx.store) {
    report.store = { path: ctx.store.path, owner: ctx.store.owner, authorityLinks: ctx.store.authorityLinks.map(ref => observe('storage-authority', ref)), baseline: ctx.baselineState };
    if (!ctx.store.authorityLinks.length) report.configurationGaps.push({ code: 'preservation/storage-authority-not-declared', role: 'storage', path: null });
    report.verificationGaps = ['preservation/authority-not-authenticated', 'preservation/backup-not-verified', 'preservation/recovery-not-verified', 'preservation/input-bytes-not-guaranteed-recoverable'];
    for (const [kind, procedure] of [['backup', 'policyRef'], ['recovery', 'procedureRef']]) {
      const declared = ctx.store.preservation?.[kind];
      if (!declared) { report.declarations[kind] = null; report.configurationGaps.push({ code: 'preservation/' + kind + '-not-declared', role: kind, path: null }); continue; }
      report.declarations[kind] = { authorityLinks: declared.authorityLinks.map(ref => observe(kind + '-authority', ref)), [procedure]: observe(kind + '-procedure', declared[procedure]), evidenceRef: declared.evidenceRef === undefined ? null : observe(kind + '-evidence', declared.evidenceRef) };
      if (declared.evidenceRef === undefined) report.verificationGaps.push('preservation/' + kind + '-evidence-not-declared');
    }
    report.recordCoverage = { runs: ctx.runs.size, openRuns: [...ctx.runs.values()].filter(events => events.at(-1).data.kind !== 'terminal').length, events: ctx.files.size, headProtectedEvents: ctx.baseline.size, localEventsWithoutHeadBaseline: [...ctx.files.keys()].filter(p => !ctx.baseline.has(p)).length, integrity: 'current-record-codec-and-head-comparison-not-worm', liveReferenceClosure: 'not-proven' };
    report.state = report.configurationGaps.length ? 'incomplete' : 'declarations-complete'; report.exitCode = report.configurationGaps.length ? 2 : 0;
  }
  try {
    const fresh = loadRecordStore(ctx.root, { expectedBoundary: recordReadBoundary(ctx) });
    if (fresh.stamp !== ctx.stamp || [...before].some(([ref, stat]) => !equal(stat, metadata(ref)))) throw Error();
    report.observation.stable = true; report.observation.registryDigest = ctx.registryDigest;
  } catch { report.state = 'incomplete'; report.exitCode = 2; report.store = null; report.declarations = {}; report.recordCoverage = null; report.configurationGaps = [{ code: 'preservation/snapshot-changed', role: null, path: null }]; }
  report.generatedAt = new Date().toISOString();
  return report;
}

export function showRun(root, runId) {
  id(runId); return { ...describeRun(writable(root), runId), receiptScope: 'observed-store-snapshot' };
}
function describeRun(ctx, runId) {
  const events = ctx.runs.get(runId);
  if (!events) fail('Run 不存在');
  const last = events.at(-1).data;
  const terminal = last.kind === 'terminal';
  const begin = events[0].data.payload;
  const batch = begin.executionMode === 'impact-checks';
  if (isAssertionMode(begin.executionMode)) return { schema: begin.executionMode === EXTERNAL_ASSERTION_MODE ? 'curia.external-assertion-run-view/1' : begin.schema === ORIGINAL_ASSERTION_RUN_SCHEMA ? 'curia.assertion-run-view/2' : 'curia.assertion-run-view/1', runId, workflowId: last.workflowId, executionMode: begin.executionMode, status: terminal ? last.payload.status : 'open', terminal, exitCode: terminal ? last.payload.exitCode : null, expectedHead: headToken(events.at(-1)), recordStore: ctx.store.path, currentDrift: driftFor(ctx, events), request: begin.request, subjectKey: begin.subjectKey, references: begin.references, correctionReason: begin.correctionReason, verification: begin.verification, result: terminal ? last.payload : null, command: null, observations: [], baseline: { state: ctx.baselineState, committedEvents: events.filter(e => ctx.baseline.has(e.path)).length, uncommittedEvents: events.filter(e => !ctx.baseline.has(e.path)).length }, events: events.map(e => ({ path: e.path, kind: e.data.kind, sequence: e.data.sequence, digest: rawDigest(e.bytes) })), limitations: [...assertionLimits(begin.executionMode)] };
  const view = begin.executionMode === 'guard-command' ? guardInputView(begin) : { snapshot: begin.inputSnapshot, limitations: [] };
  return { schema: batch ? begin.schema === CONFIGURATION_CHECK_RUN_SCHEMA ? 'curia.check-run-view/3' : begin.schema === MULTI_CHECK_RUN_SCHEMA ? 'curia.check-run-view/2' : 'curia.check-run-view/1' : begin.schema === MULTI_GUARD_RUN_SCHEMA ? 'curia.guard-run-view/3' : 'curia.run/1', runId, workflowId: last.workflowId, executionMode: begin.executionMode, risks: begin.risks ?? [], command: batch ? null : events.find((event) => event.data.kind === 'command')?.data.payload ?? null, ...(batch ? { commands: events.filter(e => e.data.kind === 'command').map(e => e.data.payload) } : {}), status: terminal ? last.payload.status : 'open', terminal, endedAt: terminal ? last.payload.endedAt : null, exitCode: terminal ? last.payload.exitCode : null, expectedHead: headToken(events.at(-1)), recordStore: ctx.store.path, baseline: { state: ctx.baselineState, committedEvents: events.filter((e) => ctx.baseline.has(e.path)).length, uncommittedEvents: events.filter((e) => !ctx.baseline.has(e.path)).length }, currentDrift: driftFor(ctx, events), inputs: view.snapshot, checks: begin.checks ?? [], observations: events.filter((e) => e.data.kind === 'observation').map((e) => ({ ...e.data.payload, observedAt: e.data.observedAt, verification: 'self-reported-not-authenticated', command: null, exitCode: null })), result: terminal ? last.payload : null, events: events.map((e) => ({ path: e.path, kind: e.data.kind, sequence: e.data.sequence, digest: rawDigest(e.bytes) })), limitations: [...view.limitations, ...(begin.schema === MULTI_GUARD_RUN_SCHEMA || (batch && begin.checks.some(check => check.guard?.schema === MULTI_GUARD_RUN_SCHEMA)) ? ['secondary-inputs-not-reobserved-by-show'] : []), 'not-worm-or-authenticated-approval', ...(begin.executionMode === 'manual-observation' ? ['no-project-command-execution'] : ['no-command-sandbox-or-identity-attestation']), 'no-fact-verification', 'no-automatic-gc-or-backup', 'interruption-not-inferred-from-open-state', 'source-snapshot-not-current-source-assertion', 'no-automatic-source-body-persistence', 'input-bytes-not-archived-or-guaranteed-replayable'] };
}

function verificationRecordFlags(argv) {
  const tail = [], references = {};
  for (let n = 1; n < argv.length; n++) {
    if (['--corrects', '--retried-from', '--reason'].includes(argv[n])) { const key = argv[n], value = argv[++n]; if (Object.hasOwn(references, key) || !value || value.startsWith('--')) fail('断言引用参数无效'); references[key] = value; }
    else tail.push(argv[n]);
  }
  return { tail, references };
}
async function parseExternalRecordArgs(argv) {
  const { parseExternalOriginalArgs } = await import('./curia-external.mjs');
  const { tail, references } = verificationRecordFlags(argv), parsed = parseExternalOriginalArgs(tail);
  if (parsed.flags.help) fail('记录用法见 curia-records --help；网络用法见 curia-workflow external verify-original --help');
  return { command: 'verify-external-original', options: { '--root': parsed.flags.root, '--json': parsed.flags.json, verification: parsed.options, ...references } };
}
export function parseRecordArgs(argv) {
  const command = argv[0];
  if (command === '--help' && argv.length === 1) return { command: 'help' };
  if (['verify', 'verify-original'].includes(command)) {
    const { tail, references } = verificationRecordFlags(argv);
    const parsed = command === 'verify-original' ? parseOriginalArgs(tail) : parseVerifyArgs(tail);
    if (parsed.help || parsed.listMethods) fail('核验用法见 curia-verify --help；记录用法见 curia-records --help');
    return { command, options: { '--root': parsed.root, '--json': parsed.json, verification: parsed.options, ...references } };
  }
  if (!['start', 'append', 'finish', 'show', 'history', 'store'].includes(command)) fail('命令必须是 start / append / finish / show / store / verify / verify-original / history');
  const common = ['--root', '--json'];
  const allowed = { start: ['--path', '--exclude', '--corpus', '--all', '--check', '--corrects', '--retried-from'], append: ['--run', '--expect', '--check', '--subject', '--statement', '--state', '--evidence', '--gap', '--observer'], finish: ['--run', '--expect', '--cancel', '--reason'], show: ['--run'], history: ['--run'], store: [] };
  const options = {}; const repeated = ['--path', '--exclude', '--evidence', '--check'];
  for (let n = 1; n < argv.length; n++) {
    const key = argv[n];
    if (![...common, ...allowed[command]].includes(key)) fail(`参数不适用于 ${command}：${key}`);
    if (Object.hasOwn(options, key) && !(repeated.includes(key) && (command === 'start' || key === '--evidence'))) fail(`重复参数：${key}`);
    const flag = ['--json', '--corpus', '--all', '--cancel'].includes(key);
    const value = flag ? true : argv[++n];
    if (value === undefined || (!flag && value.startsWith('--'))) fail(`参数缺值：${key}`);
    if (repeated.includes(key) && (command === 'start' || key === '--evidence')) (options[key] ??= []).push(value); else options[key] = value;
  }
  return { command, options };
}
if (isMainModule(import.meta.url)) {
  const external = process.argv[2] === 'verify-external-original', controller = new AbortController(); let signalCode = 0;
  const interrupt = () => { signalCode = 130; controller.abort(); }, terminate = () => { signalCode = 143; controller.abort(); };
  try {
    if (external) { process.once('SIGINT', interrupt); process.once('SIGTERM', terminate); }
    const { command, options: o } = external ? await parseExternalRecordArgs(process.argv.slice(2)) : parseRecordArgs(process.argv.slice(2));
    if (command === 'help') console.log('curia-records — opt-in Run records\nRequires .agents/doc-types.json instance.recordStore: {schema: curia.record-store/1, path, owner, authorityLinks}. The store is a subdirectory of a declared surface; default is disabled.\nstart --path <path> [--check <id>] [--corrects <run-id> | --retried-from <run-id>]\nappend --run <id> --expect <sequence:sha256> --check <id> --subject <text> --statement <text> --state <satisfied|unsatisfied|evidence-gap> --observer <self-reported label> [--evidence <selected input path>] [--gap <reason>]\nfinish --run <id> --expect <sequence:sha256> [--cancel --reason <reason>]\nshow --run <id>\nstore — inspect storage/backup/recovery declarations and gaps; never backup, restore or delete\nverify <curia-verify equality options> [--corrects <id> --reason <non-sensitive reason> | --retried-from <id>]\nverify-original <curia-verify original options> [--corrects <id> --reason <non-sensitive reason> | --retried-from <id>]\nverify-external-original <external verify-original options> [--corrects <id> --reason <non-sensitive reason> | --retried-from <id>]\nhistory --run <assertion-id>\nverify runs the local comparison itself; verify-external-original performs one explicitly authorized HTTPS verification. No imported reports. Historical show/history/finish never fetch sources. finish can seal an interrupted assertion recording without rerunning the verification. All commands accept --root and --json. No project commands, publication or authenticated verification.');
    else {
      const root = o['--root'] ?? ROOT;
      const result = external ? await recordExternalOriginalAssertion(root, { verification: o.verification, corrects: o['--corrects'] ?? null, retriedFrom: o['--retried-from'] ?? null, reason: o['--reason'] ?? null }, controller.signal) : ['verify', 'verify-original'].includes(command) ? (command === 'verify-original' ? recordOriginalAssertion : recordAssertion)(root, { verification: o.verification, corrects: o['--corrects'] ?? null, retriedFrom: o['--retried-from'] ?? null, reason: o['--reason'] ?? null }) : command === 'store' ? inspectRecordStore(root) : command === 'history' ? assertionHistory(root, o['--run']) : command === 'start' ? startRun(root, { selection: { paths: o['--path'] ?? [], exclusions: o['--exclude'] ?? [], corpus: o['--corpus'] ?? false }, includeUntracked: o['--all'] ?? false, manualChecks: o['--check'] ?? [], corrects: o['--corrects'] ?? null, retriedFrom: o['--retried-from'] ?? null }) : command === 'append' ? appendObservation(root, o['--run'], o['--expect'], { checkId: o['--check'], subject: o['--subject'], statement: o['--statement'], state: o['--state'], evidencePaths: o['--evidence'] ?? [], gapReason: o['--gap'] ?? null, observer: o['--observer'] }) : command === 'finish' ? finishRun(root, o['--run'], o['--expect'], { cancel: o['--cancel'] ?? false, reason: o['--reason'] ?? null }) : showRun(root, o['--run']);
      console.log(o['--json'] ? JSON.stringify(result, null, 2) : command === 'store' ? `${result.state}; backup: not-verified; recovery: not-verified; deletion: not-authorized` : command === 'history' ? `${result.runId} ${result.state}; current source: not revalidated` : isAssertionMode(result.executionMode) ? `${result.runId} ${result.status}; assertion: ${result.verification.assertion.state}; method: ${result.request.method}; recorded evidence only` : `${result.runId} ${result.status} terminal=${result.terminal}\nexpected-head: ${result.expectedHead}\nbusiness: not-evaluated; verification: not-verified`);
      if (external || ['finish', 'verify', 'verify-original', 'history', 'store'].includes(command)) process.exitCode = signalCode || result.exitCode;
    }
  } catch (e) { console.error(`${e.message} [records/operation-failed]`); process.exitCode = signalCode || (external || ['verify', 'verify-original', 'history', 'store'].includes(process.argv[2]) ? 2 : 1); }
  finally { if (external) { process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', terminate); } }
}
