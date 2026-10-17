/** Versioned native-guard declaration and receipt codecs. Declarations are not a sandbox or approval. */
import { createHash } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
import { privateReadPath } from './doc-lib.mjs';

export const GUARD_SCHEMA = 'curia.guard/1';
export const GUARD_RUN_SCHEMA = 'curia.guard-run/2';
export const GUARD_LEGACY_RUN_SCHEMA = 'curia.guard-run/1';
export const GUARD_PLAN_SCHEMA = 'curia.guard-plan/2';
export const GUARD_GENERATOR = 'curia-guards/2';
export const guardSensitivePath = (adapter, path) => privateReadPath(path) || adapter.privacy.sensitivePaths.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
export const GUARD_RUNTIME_LIMITATIONS = Object.freeze(['no-memory-cpu-or-process-count-isolation', 'no-filesystem-or-network-sandbox', 'detached-escape-not-prevented', 'no-business-verification', 'raw-output-not-retained']);
export const GUARD_LIMITS = Object.freeze({ timeoutMs: 3600000, killGraceMs: 10000, maxOutputBytes: 16 * 1024 * 1024, maxFiles: 4096, maxFileBytes: 64 * 1024 * 1024, maxTotalBytes: 256 * 1024 * 1024 });
export const guardFail = (message) => { throw new Error(`${message} [guards/contract]`); };
export function guardObject(value, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![null, Object.prototype].includes(Object.getPrototypeOf(value)) || Object.getOwnPropertySymbols(value).length || required.some((key) => !Object.hasOwn(value, key)) || Object.keys(value).some((key) => ![...required, ...optional].includes(key))) guardFail(`字段必须为 ${required.join(', ')}，不接受未知字段`);
}
export function guardText(value, label, max = 4096) {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) guardFail(`${label} 必须是有限长单行文本`);
}
export function guardPath(value, root = false) {
  guardText(value, '路径', 1024);
  if (root && value === '.') return;
  if (/[\\:*?\[\]{}]/u.test(value) || value.split('/').some((part) => !part || part !== part.trim() || ['.', '..', '.git'].includes(part.toLowerCase()))) guardFail('必须是规范仓内相对路径');
}
export function guardArray(value, label, max = 4096) { if (!Array.isArray(value) || value.length > max) guardFail(`${label} 必须是有界数组`); }
const unique = (value, label) => { if (new Set(value).size !== value.length) guardFail(`${label} 重复`); };
const bools = (value, fields) => { guardObject(value, fields); for (const field of fields) if (typeof value[field] !== 'boolean') guardFail(`${field} 必须是布尔值`); };
const pathList = (values, label, root = false) => { guardArray(values, label); for (const path of values) guardPath(path, root); unique(values.map((p) => p.normalize('NFC').toLowerCase()), label); };
const forbiddenEnv = /^(?:NODE_OPTIONS|NODE_PATH|LD_.*|DYLD_.*|BASH_ENV|ENV|SHELLOPTS|BASHOPTS|GIT_.*|CURIA_.*|CURIA_.*)$/;
export function normalizeGuards(raw) {
  if (raw === undefined) return Object.create(null);
  guardObject(raw, Object.keys(raw ?? {}));
  if (Object.keys(raw).length > 64) guardFail('guard 声明超出数量上限');
  const guards = Object.create(null);
  for (const [id, value] of Object.entries(raw)) {
    if (!/^[a-z][a-z0-9-]{0,79}$/.test(id)) guardFail('adapter-id 必须为短 kebab-case');
    const guard = structuredClone(value);
    const multi = guard.schema === MULTI_GUARD_SCHEMA;
    guardObject(guard, ['schema', 'owner', 'authorityLinks', 'activation', 'onEmpty', 'command', 'inputScope', 'effects', 'privacy', 'environment', 'expectedExitCodes', 'parser', 'limits', ...(multi ? ['repositoryInputs'] : [])]);
    if ((!multi && guard.schema !== GUARD_SCHEMA) || guard.activation !== 'explicit') guardFail('guard schema / activation 未支持');
    if (multi) normalizeRepositoryProfiles(guard.repositoryInputs);
    guardText(guard.owner, 'owner'); pathList(guard.authorityLinks, 'authorityLinks');
    if (!guard.authorityLinks.length || !['fail', 'not-applicable'].includes(guard.onEmpty)) guardFail('authority 与 onEmpty 必须显式声明');
    const command = guard.command;
    guardObject(command, ['program', 'args', 'cwd', 'identityPaths'], ['script', 'path']);
    guardPath(command.cwd, true); pathList(command.identityPaths, 'command.identityPaths'); guardArray(command.args, 'args', 128);
    for (const arg of command.args) guardText(arg, '静态非敏感参数');
    if (command.program === 'node') {
      guardPath(command.script); if (command.path !== undefined) guardFail('node program 不能另填 executable path');
      if (!command.identityPaths.includes(command.script)) guardFail('node script 必须登记到 identityPaths');
    } else if (command.program === 'absolute') {
      guardText(command.path, 'executable path', 1024);
      if (!command.path.startsWith('/') || command.path.split('/').slice(1).some((p) => !p || ['.', '..'].includes(p)) || command.script !== undefined) guardFail('absolute program 只接受规范绝对可执行路径');
    } else guardFail('program 仅支持 node / absolute');
    const scope = guard.inputScope;
    guardObject(scope, ['mode', 'paths', 'exclusions', 'includeUntracked', 'includeIgnored']);
    if (!['git', 'filesystem'].includes(scope.mode)) guardFail('inputScope.mode 未支持');
    pathList(scope.paths, 'input paths', true); pathList(scope.exclusions, 'input exclusions');
    if (!scope.paths.length || ['includeUntracked', 'includeIgnored'].some((key) => typeof scope[key] !== 'boolean')) guardFail('必须有显式输入路径和未跟踪 / ignored 策略');
    if (scope.includeIgnored && !scope.includeUntracked) guardFail('读取 ignored 必须先允许 untracked');
    if (scope.mode === 'filesystem' && (!scope.includeUntracked || !scope.includeIgnored)) guardFail('filesystem 扫描必须显式允许 untracked 与 ignored；不能假称只扫 index');
    bools(guard.effects, ['write', 'network', 'externalSystems', 'sensitiveRead']);
    guardObject(guard.privacy, ['sensitivePaths', 'output', 'args']); pathList(guard.privacy.sensitivePaths, 'sensitive paths');
    if (!['discard', 'status-only'].includes(guard.privacy.output) || guard.privacy.args !== 'non-sensitive-static') guardFail('输出只能 discard / status-only；参数必须声明非敏感静态值');
    guardArray(guard.environment, 'environment', 32);
    for (const item of guard.environment) {
      guardObject(item, ['name', 'source', 'required']);
      if (typeof item.name !== 'string' || !/^[A-Z][A-Z0-9_]{0,63}$/.test(item.name) || forbiddenEnv.test(item.name) || item.source !== 'inherit' || typeof item.required !== 'boolean') guardFail('environment 只能显式继承普通变量名，拒绝加载器与 Git 覆盖');
    }
    unique(guard.environment.map((item) => item.name), 'environment');
    if (guard.environment.length && !guard.effects.sensitiveRead) guardFail('继承环境可能读取凭据，必须声明 sensitiveRead');
    guardArray(guard.expectedExitCodes, 'expectedExitCodes', 256); unique(guard.expectedExitCodes, 'expectedExitCodes');
    if (!guard.expectedExitCodes.length || guard.expectedExitCodes.some((code) => !Number.isInteger(code) || code < 0 || code > 255)) guardFail('expectedExitCodes 必须是非空退出码集合');
    guardObject(guard.parser, ['id', 'ruleIds']); guardArray(guard.parser.ruleIds, 'ruleIds', 256); unique(guard.parser.ruleIds, 'ruleIds');
    if (!['aggregate-exit/1', multi ? 'curia-guard-status/2' : 'curia-guard-status/1'].includes(guard.parser.id) || (guard.parser.id === 'aggregate-exit/1' && guard.parser.ruleIds.length) || (guard.parser.id !== 'aggregate-exit/1' && (!guard.parser.ruleIds.length || guard.privacy.output !== 'status-only'))) guardFail('parser 与输出策略不匹配或多仓路径缺少身份');
    for (const rule of guard.parser.ruleIds) if (typeof rule !== 'string' || !/^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/.test(rule)) guardFail('原生 rule ID 必须是稳定 scope/rule');
    guardObject(guard.limits, [...Object.keys(GUARD_LIMITS), 'cpuMs', 'memoryBytes', 'maxProcesses']);
    for (const [key, max] of Object.entries(GUARD_LIMITS)) if (!Number.isSafeInteger(guard.limits[key]) || guard.limits[key] <= 0 || guard.limits[key] > max) guardFail(`${key} 超出资源预算`);
    for (const key of ['cpuMs', 'memoryBytes', 'maxProcesses']) if (guard.limits[key] !== null) guardFail(`${key} 当前没有硬隔离适配器，不能接受并假称已生效`);
    guards[id] = guard;
  }
  return guards;
}
const digest = (value) => {
  guardObject(value, ['algorithm', 'canonicalization', 'value']);
  if (value.algorithm !== 'sha256' || value.canonicalization !== 'raw-bytes/1' || !/^[0-9a-f]{64}$/.test(value.value)) guardFail('完整摘要身份非法');
};
const instant = (value) => { if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) guardFail('观察时间不是规范 ISO instant'); };
const nullableOid = (value) => value === null || (typeof value === 'string' && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value));
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function validateGuardBegin(payload) {
  guardObject(payload, ['schema', 'executionMode', 'adapterId', 'adapter', 'inputSnapshot', 'planDigest', 'risks', 'unresolved', 'codeIdentity', 'references']);
  const legacy = payload.schema === GUARD_LEGACY_RUN_SCHEMA, multi = payload.schema === MULTI_GUARD_RUN_SCHEMA;
  if ((!legacy && !multi && payload.schema !== GUARD_RUN_SCHEMA) || payload.executionMode !== 'guard-command') guardFail('未知 guard Run schema / mode');
  if (multi !== (payload.adapter?.schema === MULTI_GUARD_SCHEMA)) guardFail('多仓声明不得降级为单仓历史协议');
  normalizeGuards({ [payload.adapterId]: payload.adapter });
  guardObject(payload.planDigest, ['algorithm', 'canonicalization', 'value']);
  if (payload.planDigest.algorithm !== 'sha256' || payload.planDigest.canonicalization !== (legacy ? 'curia.guard-plan/1' : multi ? MULTI_GUARD_PLAN_SCHEMA : GUARD_PLAN_SCHEMA) || !/^[0-9a-f]{64}$/.test(payload.planDigest.value)) guardFail('plan 摘要身份非法');
  const snapshot = primaryGuardInput(payload.inputSnapshot);
  if (!multi && snapshot !== payload.inputSnapshot) guardFail('单仓协议不得藏入多仓载荷');
  guardObject(snapshot, ['source', 'configuration', 'gitIndexDigest', 'documents', 'commandIdentity', 'environment', 'scope', 'coverage', 'observedAt']);
  instant(snapshot.observedAt); digest(snapshot.gitIndexDigest);
  guardObject(snapshot.configuration, ['registry', 'generator', 'identity']); digest(snapshot.configuration.registry);
  if (snapshot.configuration.generator !== (legacy ? 'curia-guards/1' : multi ? MULTI_GUARD_GENERATOR : GUARD_GENERATOR) || snapshot.configuration.identity !== 'on-disk-code-not-loaded-module-attestation') guardFail('配置 / generator 身份非法');
  guardObject(snapshot.source, ['mode', 'git', 'worktreeState', 'trackedModified', 'trackedDeleted', 'untracked', 'stagedChanged', 'sensitiveContentNotObserved']);
  if (snapshot.source.mode !== 'current-worktree' || !['mixed-tree', 'matches-head-for-selected-inputs', 'unknown-sensitive-inputs'].includes(snapshot.source.worktreeState)) guardFail('guard 输入必须说明实际工作树来源');
  guardObject(snapshot.source.git, ['root', 'head', 'repositoryCount']);
  guardText(snapshot.source.git.root, 'repository root');
  if (!snapshot.source.git.root.startsWith('/') || !nullableOid(snapshot.source.git.head) || snapshot.source.git.repositoryCount !== 1) guardFail('当前只接受单仓实际快照');
  for (const key of ['trackedModified', 'trackedDeleted', 'untracked', 'stagedChanged', 'sensitiveContentNotObserved']) pathList(snapshot.source[key], key);
  guardArray(snapshot.documents, 'documents');
  unique(snapshot.documents.map((doc) => doc.path), 'input paths');
  for (const doc of snapshot.documents) {
    guardObject(doc, ['path', 'tracked', 'state', 'size', 'digest', 'git', 'observedAt', ...(legacy ? [] : ['privacy'])]); guardPath(doc.path); instant(doc.observedAt);
    if (doc.observedAt > snapshot.observedAt || typeof doc.tracked !== 'boolean' || !['read', 'deleted', 'sensitive-metadata-only'].includes(doc.state) || (doc.state !== 'read' && doc.digest !== null)) guardFail('输入状态、时点或摘要范围非法');
    if (doc.state === 'read') digest(doc.digest);
    if (doc.state === 'deleted' ? doc.size !== null : !Number.isSafeInteger(doc.size) || doc.size < 0) guardFail('输入大小或删除状态非法');
    guardObject(doc.git, ['indexOid', 'indexMode', 'headOid', 'headMode', 'worktreeMatchesIndex', 'indexMatchesHead']);
    const sensitive = !legacy && guardSensitivePath(payload.adapter, doc.path);
    if (!legacy && (doc.privacy !== (sensitive ? 'sensitive' : 'non-sensitive') || (sensitive && !payload.adapter.effects.sensitiveRead) || (doc.state !== 'deleted' && (sensitive ? doc.state !== 'sensitive-metadata-only' : doc.state !== 'read')))) guardFail('输入隐私分类必须来自声明与默认路径规则，不能冒充正文覆盖');
    if (sensitive) {
      // Modes preserve existence and staged-change metadata; no content-addressed Git IDs survive.
      if (doc.git.indexOid !== null || doc.git.headOid !== null || doc.digest !== null || ![null, '100644', '100755'].includes(doc.git.indexMode) || ![null, '100644', '100755'].includes(doc.git.headMode) || doc.tracked !== (doc.git.indexMode !== null) || typeof doc.git.indexMatchesHead !== 'boolean') guardFail('敏感输入不得保存 Git 内容指纹或伪造 tracked 状态');
      if ((doc.git.indexMatchesHead && (!doc.git.indexMode || doc.git.indexMode !== doc.git.headMode)) || (doc.state === 'deleted' && !doc.git.indexMode && !doc.git.headMode)) guardFail('敏感输入的存在性、变更状态或删除来源不一致');
    } else {
      if (!nullableOid(doc.git.indexOid) || !nullableOid(doc.git.headOid) || ![null, '100644', '100755'].includes(doc.git.indexMode) || ![null, '100644', '100755'].includes(doc.git.headMode) || ![null, true, false].includes(doc.git.worktreeMatchesIndex) || typeof doc.git.indexMatchesHead !== 'boolean' || doc.tracked !== (doc.git.indexOid !== null)) guardFail('Git 史料 非法');
      if ((doc.git.indexOid === null) !== (doc.git.indexMode === null) || (doc.git.headOid === null) !== (doc.git.headMode === null) || doc.git.indexMatchesHead !== !!(doc.git.indexOid && doc.git.headOid && doc.git.indexOid === doc.git.headOid && doc.git.indexMode === doc.git.headMode) || (doc.state === 'deleted' && !doc.git.indexOid && !doc.git.headOid) || (doc.state === 'read' && (doc.tracked ? typeof doc.git.worktreeMatchesIndex !== 'boolean' : doc.git.worktreeMatchesIndex !== null))) guardFail('Git 删除、mode 或比对状态不一致');
    }
    if (doc.state !== 'read' && doc.git.worktreeMatchesIndex !== null) guardFail('未读内容不能冒充 clean');
  }
  const rows = snapshot.documents;
  const derived = {
    trackedModified: rows.filter((d) => d.tracked && d.state === 'read' && !d.git.worktreeMatchesIndex).map((d) => d.path), trackedDeleted: rows.filter((d) => d.state === 'deleted').map((d) => d.path),
    untracked: rows.filter((d) => !d.tracked && d.state !== 'deleted').map((d) => d.path), stagedChanged: rows.filter((d) => (d.tracked || (legacy ? d.git.headOid : d.git.headMode) !== null) && !d.git.indexMatchesHead).map((d) => d.path), sensitiveContentNotObserved: rows.filter((d) => d.state === 'sensitive-metadata-only').map((d) => d.path),
  };
  for (const [key, expected] of Object.entries(derived)) if (!eq(snapshot.source[key], expected)) guardFail('mixed-tree 汇总与实际载荷不一致');
  const view = derived.trackedModified.length || derived.trackedDeleted.length || derived.untracked.length || derived.stagedChanged.length ? 'mixed-tree' : derived.sensitiveContentNotObserved.length ? 'unknown-sensitive-inputs' : 'matches-head-for-selected-inputs';
  if (snapshot.source.worktreeState !== view) guardFail('不能把 mixed-tree 冒充单一 HEAD');
  guardObject(snapshot.scope, ['mode', 'paths', 'exclusions', 'includeUntracked', 'includeIgnored', 'verification', 'outsideManaged', 'nestedRepositories']);
  if (snapshot.scope.verification !== 'declared-union-not-traced' || snapshot.scope.nestedRepositories !== 'not-authorized-scope-overflow-is-blocking') guardFail('scope 不得冒充追踪或多仓覆盖');
  for (const key of ['mode', 'paths', 'includeUntracked', 'includeIgnored']) if (!eq(snapshot.scope[key], payload.adapter.inputScope[key])) guardFail('scope 与声明不一致');
  pathList(snapshot.scope.exclusions, 'scope exclusions'); pathList(snapshot.scope.outsideManaged, 'outsideManaged');
  if (snapshot.scope.outsideManaged.some((path) => !rows.some((d) => d.path === path))) guardFail('scope-overflow 引用了未登记输入');
  guardObject(snapshot.coverage, ['selected', 'complete', 'fullDigests', 'sensitiveMetadataOnly', 'deleted', 'chargedBytes']);
  const coverage = { selected: rows.length, complete: !derived.sensitiveContentNotObserved.length, fullDigests: rows.filter((d) => d.state === 'read').length, sensitiveMetadataOnly: derived.sensitiveContentNotObserved.length, deleted: derived.trackedDeleted.length, chargedBytes: rows.filter((d) => d.state === 'read').reduce((sum, d) => sum + d.size, 0) };
  if (!eq(snapshot.coverage, coverage)) guardFail('coverage 不是实际输入派生值');
  const command = snapshot.commandIdentity;
  guardObject(command, ['invocation', 'executable', 'files', 'dependencyClosure']); guardObject(command.invocation, ['executable', 'args', 'cwd']);
  guardText(command.invocation.executable, '实际 executable'); guardText(command.invocation.cwd, '实际 cwd'); guardArray(command.invocation.args, '实际 args', 129);
  for (const arg of command.invocation.args) guardText(arg, '实际静态参数');
  guardObject(command.executable, ['declared', 'resolved', 'digest', 'stat', 'authority']); digest(command.executable.digest);
  if (command.executable.resolved !== command.invocation.executable || command.executable.authority !== 'local-executable-not-authenticated' || command.dependencyClosure !== 'declared-identity-paths-only') guardFail('command 身份与覆盖声明不一致');
  guardArray(command.executable.stat, 'executable stat', 7); if (command.executable.stat.length !== 7 || command.executable.stat.some((n) => !Number.isFinite(n) || n < 0)) guardFail('executable stat 非法');
  guardArray(command.files, 'command files');
  if (!eq(command.files.map((file) => file.path), payload.adapter.command.identityPaths)) guardFail('command identityPaths 不完整');
  for (const file of command.files) { guardObject(file, ['path', 'digest', 'tracked', 'indexOid', 'indexMode', 'headOid', 'headMode', 'worktreeMode', 'matchesIndex', 'matchesHead']); guardPath(file.path); digest(file.digest); if (typeof file.tracked !== 'boolean' || typeof file.matchesIndex !== 'boolean' || typeof file.matchesHead !== 'boolean' || !nullableOid(file.indexOid) || !nullableOid(file.headOid) || ![null, '100644', '100755'].includes(file.indexMode) || ![null, '100644', '100755'].includes(file.headMode) || !['100644', '100755'].includes(file.worktreeMode)) guardFail('command 史料 非法'); }
  guardArray(snapshot.environment, 'environment', 32);
  if (snapshot.environment.length !== payload.adapter.environment.length) guardFail('环境引用数量不一致');
  snapshot.environment.forEach((item, n) => { guardObject(item, ['name', 'source', 'required', 'present', 'value']); const expected = payload.adapter.environment[n]; if (item.name !== expected.name || item.source !== expected.source || item.required !== expected.required || typeof item.present !== 'boolean' || item.value !== 'not-recorded') guardFail('环境值不能进入记录'); });
  guardArray(payload.risks, 'risks'); unique(payload.risks, 'risks');
  for (const risk of payload.risks) guardText(risk, 'risk');
  for (const required of ['trusted-local-command-not-sandboxed', 'memory-cpu-process-count-unbounded', 'actual-access-scope-not-traced', 'command-dependency-closure-not-inferred']) if (!payload.risks.includes(required)) guardFail('不能隐去未隔离的执行边界');
  if (command.files.some((file) => !file.matchesIndex || !file.matchesHead) && !payload.risks.includes('dirty-or-untracked-command-code')) guardFail('必须报告 dirty / untracked command 风险');
  guardArray(payload.unresolved, 'unresolved'); guardArray(payload.codeIdentity, 'codeIdentity', 32);
  for (const issue of payload.unresolved) { guardObject(issue, ['code', 'reason']); guardText(issue.code, '缺口 code'); guardText(issue.reason, '缺口原因'); }
  if (!payload.codeIdentity.length) guardFail('缺少执行实现身份');
  unique(payload.codeIdentity.map((item) => item.file), 'codeIdentity');
  for (const item of payload.codeIdentity) { guardObject(item, ['file', 'digest']); guardPath(item.file); digest(item.digest); }
  guardObject(payload.references, ['corrects', 'retriedFrom']);
  if (payload.references.corrects && payload.references.corrects === payload.references.retriedFrom) guardFail('更正与重试引用不得重复');
  if (multi) {
    validateRepositoryInputs(payload.inputSnapshot, payload.adapter);
    for (const risk of ['independent-repository-inputs-not-atomic', 'secondary-inputs-not-cross-repository-authority-resolution']) if (!payload.risks.includes(risk)) guardFail('不能隐藏多仓非原子与 authority 限制');
  }
}
/** Historical byte records remain untouched; presentation must not re-emit old sensitive blob IDs. */
export function guardInputView(begin) {
  if (begin.schema !== GUARD_LEGACY_RUN_SCHEMA) return { snapshot: begin.inputSnapshot, limitations: [] };
  const snapshot = structuredClone(begin.inputSnapshot); let redacted = false;
  for (const doc of snapshot.documents) {
    if (!guardSensitivePath(begin.adapter, doc.path)) continue;
    doc.git.indexOid = null; doc.git.headOid = null; doc.digest = null; redacted = true;
  }
  return { snapshot, limitations: redacted ? ['legacy-sensitive-git-revisions-redacted-in-view-not-records'] : [] };
}
export const GUARD_COMMAND_STATES = ['exited', 'preflight-changed', 'spawn-failed', 'timed-out', 'cancelled', 'output-limit', 'interrupted', 'cleanup-unconfirmed', 'not-applicable'];
export function validateGuardReceipt(receipt, begin) {
  const multi = begin.schema === MULTI_GUARD_RUN_SCHEMA;
  guardObject(receipt, ['schema', 'startedAt', 'endedAt', 'pid', 'status', 'exitCode', 'signal', 'spawnError', 'output', 'cleanup', 'native', 'inputDrift', 'limitations', ...(multi ? ['repositoryBindings'] : [])]);
  if (receipt.schema !== (multi ? 'curia.guard-receipt/2' : 'curia.guard-receipt/1') || !GUARD_COMMAND_STATES.includes(receipt.status)) guardFail('命令回执 schema / status 非法');
  if (multi && !eq(receipt.repositoryBindings, repositoryBindingDigest(begin.inputSnapshot))) guardFail('实际传入命令的仓库定位与已确认输入不符');
  instant(receipt.startedAt); instant(receipt.endedAt); if (receipt.endedAt < receipt.startedAt) guardFail('命令时点倒退');
  if (receipt.exitCode !== null && (!Number.isInteger(receipt.exitCode) || receipt.exitCode < 0 || receipt.exitCode > 255)) guardFail('命令退出码非法');
  if (receipt.pid !== null && (!Number.isSafeInteger(receipt.pid) || receipt.pid <= 1)) guardFail('命令 PID 非法');
  if (receipt.signal !== null && (typeof receipt.signal !== 'string' || !/^SIG[A-Z0-9]+$/.test(receipt.signal))) guardFail('命令 signal 非法');
  if ((receipt.status === 'exited' && (receipt.pid === null || receipt.exitCode === null || receipt.signal !== null)) || (receipt.status === 'interrupted' && (receipt.signal === null || receipt.exitCode !== null))) guardFail('退出状态与实际信号不一致');
  guardObject(receipt.output, ['stdoutBytes', 'stderrBytes', 'retained', 'parser', 'parserState']);
  if (receipt.output.retained !== 'none' || receipt.output.parser !== begin.adapter.parser.id || !['aggregate-only', 'parsed', 'unparsed', 'not-applicable', 'not-executed'].includes(receipt.output.parserState) || ['stdoutBytes', 'stderrBytes'].some((key) => !Number.isSafeInteger(receipt.output[key]) || receipt.output[key] < 0)) guardFail('输出不能保存原始文本，必须声明真实覆盖');
  guardObject(receipt.cleanup, ['boundary', 'state', 'signals']);
  if (receipt.cleanup.boundary !== 'posix-process-group-not-sandbox' || !['not-started', 'group-absent', 'unconfirmed'].includes(receipt.cleanup.state) || !Array.isArray(receipt.cleanup.signals) || receipt.cleanup.signals.some((signal) => !['SIGTERM', 'SIGKILL'].includes(signal))) guardFail('清理回执不支持');
  guardObject(receipt.native, ['aggregate', 'checks', 'observedScope', 'scopeOverflow']);
  const aggregate = receipt.status === 'not-applicable' ? 'not-applicable' : receipt.pid === null ? 'skipped' : receipt.status === 'exited' && begin.adapter.expectedExitCodes.includes(receipt.exitCode) ? 'pass' : 'fail';
  if (receipt.native.aggregate !== aggregate) guardFail('不能用 parser 洗白非允许退出码或未完成命令');
  if ((receipt.pid === null) !== (receipt.cleanup.state === 'not-started') || (receipt.pid === null && (receipt.exitCode !== null || receipt.signal !== null || receipt.output.stdoutBytes || receipt.output.stderrBytes || receipt.cleanup.signals.length))) guardFail('未启动的进程不能有退出码、输出、清理信号或 PID');
  if (receipt.exitCode !== null && receipt.signal !== null) guardFail('退出码与终止信号不能同时存在');
  if (receipt.status === 'exited' && (receipt.cleanup.state !== 'group-absent' || receipt.spawnError !== null)) guardFail('成功退出必须有实际清理结果且没有启动错误');
  if (receipt.output.stdoutBytes + receipt.output.stderrBytes > begin.adapter.limits.maxOutputBytes && !['output-limit', 'timed-out', 'cancelled', 'cleanup-unconfirmed'].includes(receipt.status)) guardFail('输出超限不能冒充正常退出');
  const expectedParserState = receipt.status === 'not-applicable' ? 'not-applicable' : receipt.pid === null ? 'not-executed' : begin.adapter.parser.id === 'aggregate-exit/1' ? 'aggregate-only' : null;
  if (expectedParserState ? receipt.output.parserState !== expectedParserState : !['parsed', 'unparsed'].includes(receipt.output.parserState)) guardFail('parser 状态必须与实际执行和原生 parser 一致');
  if (receipt.output.parserState === 'parsed' && receipt.status !== 'exited') guardFail('未完成命令不能冒充完整解析');
  if (!eq(receipt.limitations, GUARD_RUNTIME_LIMITATIONS)) guardFail('执行限制必须完整保留，不得隐藏未隔离风险');
  guardArray(receipt.native.checks, 'native checks', 256);
  for (const check of receipt.native.checks) {
    guardObject(check, ['id', 'state']);
    if (!begin.adapter.parser.ruleIds.includes(check.id) || !['pass', 'fail', 'not-applicable'].includes(check.state)) guardFail('输出只能包含登记的原生 rule ID 与状态');
  }
  unique(receipt.native.checks.map((check) => check.id), 'native checks');
  if (receipt.status === 'preflight-changed' && (receipt.pid !== null || receipt.output.parserState !== 'not-executed')) guardFail('启动前漂移必须停止执行');
  if (receipt.output.parserState === 'parsed' && receipt.native.checks.length !== begin.adapter.parser.ruleIds.length) guardFail('parser 不得遗漏声明的原生规则');
  guardArray(receipt.inputDrift, 'inputDrift'); guardArray(receipt.limitations, 'limitations');
  for (const value of [...receipt.inputDrift, ...receipt.limitations]) guardText(value, '限制或漂移');
  if (typeof receipt.native.scopeOverflow !== 'boolean') guardFail('scopeOverflow 必须是布尔值');
  const observed = receipt.native.observedScope;
  guardObject(observed, ['kind', 'paths'], ['outsideDeclaredCount']);
  if (multi) { guardArray(observed.paths, 'observed paths'); for (const p of observed.paths) validateQualifiedPath(p, true); unique(observed.paths.map(qualifiedPathKey), 'qualified paths'); }
  else pathList(observed.paths, 'observed paths', true);
  const declaredKind = multi ? 'declared-multi-repository-union-not-traced' : 'declared-union-not-traced', reportedKind = multi ? 'self-reported-multi-repository-not-traced' : 'self-reported-not-traced';
  if (receipt.output.parserState === 'not-executed' && (receipt.pid !== null || observed.kind !== 'not-observed' || observed.paths.length || receipt.exitCode !== null)) guardFail('未执行检查不能伪造读取或退出码');
  if (![declaredKind, reportedKind, 'not-applicable', 'not-observed'].includes(observed.kind)) guardFail('observed-scope 不能冒充认证追踪');
  if (observed.kind === reportedKind) {
    if (!Number.isSafeInteger(observed.outsideDeclaredCount) || observed.outsideDeclaredCount < 0 || receipt.native.scopeOverflow !== (observed.outsideDeclaredCount > 0)) guardFail('scope-overflow 统计不一致');
    const key = multi ? qualifiedPathKey : value => value;
    const allowed = new Set(qualifiedGuardPaths(begin.inputSnapshot, begin.adapter).map(key));
    if (observed.paths.some(path => !allowed.has(key(path)))) guardFail('不能在回执泄露范围外路径或归错仓库');
  } else if (observed.outsideDeclaredCount !== undefined || receipt.native.scopeOverflow) guardFail('未解析范围不能捏造 observed-scope');
  if (receipt.output.parserState !== 'parsed' && receipt.native.checks.length) guardFail('未解析输出不能伪造子规则');
  if (receipt.output.parserState === 'parsed' && (begin.adapter.parser.id !== (multi ? 'curia-guard-status/2' : 'curia-guard-status/1') || observed.kind !== reportedKind)) guardFail('parser 与 observed-scope 不一致');
  if (receipt.output.parserState === 'aggregate-only' && (begin.adapter.parser.id !== 'aggregate-exit/1' || !eq(observed.paths, qualifiedGuardPaths(begin.inputSnapshot, begin.adapter, true)))) guardFail('聚合结果只能声明最宽登记范围');
  if (receipt.cleanup.state === 'unconfirmed' && receipt.status !== 'cleanup-unconfirmed') guardFail('清理未确认不能报执行成功');
  if (receipt.spawnError !== null && (typeof receipt.spawnError !== 'string' || !/^[A-Z0-9_]+$/.test(receipt.spawnError))) guardFail('spawnError 不保存敏感错误文本');
  if (receipt.status === 'not-applicable' && (begin.adapter.onEmpty !== 'not-applicable' || begin.inputSnapshot.coverage.selected || receipt.pid !== null || receipt.exitCode !== null || observed.kind !== 'not-applicable' || observed.paths.length || receipt.spawnError !== null)) guardFail('非空或必需检查不能冒充不适用');
}
export function deriveGuardTerminal(events, endedAt) {
  const begin = events[0].data.payload;
  const commands = events.filter((event) => event.data.kind === 'command');
  if (commands.length !== 1) guardFail('guard 终态必须恰好有一份实际命令回执');
  const receipt = commands[0].data.payload; validateGuardReceipt(receipt, begin);
  const gates = [
    { id: `native/${begin.adapterId}`, state: receipt.native.aggregate, authority: 'declared-project-guard-not-curia' },
    ...receipt.native.checks.map((check) => ({ ...check, authority: 'native-parser-status-not-authenticated' })),
    { id: 'curia-guard/parser', state: receipt.output.parserState === 'unparsed' ? 'evidence-gap' : receipt.output.parserState === 'not-executed' ? 'skipped' : receipt.output.parserState === 'not-applicable' ? 'not-applicable' : 'pass' },
    { id: 'curia-guard/cleanup', state: receipt.cleanup.state === 'unconfirmed' ? 'fail' : 'pass' },
    { id: 'curia-guard/snapshot', state: receipt.inputDrift.length || begin.unresolved.length ? 'evidence-gap' : 'pass' },
    { id: 'curia-guard/scope', state: receipt.native.scopeOverflow ? 'fail' : 'pass' },
  ];
  const interrupted = { 'preflight-changed': 'blocked', 'timed-out': 'timed-out', cancelled: 'cancelled', 'output-limit': 'resource-limit', interrupted: 'interrupted', 'spawn-failed': 'failed', 'cleanup-unconfirmed': 'failed' }[receipt.status];
  const status = interrupted ?? (gates.some((gate) => gate.state === 'fail') ? 'failed' : gates.some((gate) => gate.state === 'evidence-gap') ? 'incomplete' : receipt.status === 'not-applicable' ? 'not-applicable' : 'passed');
  return { status, terminal: true, endedAt, exitCode: { passed: 0, 'not-applicable': 0, failed: 1, blocked: 1, incomplete: 2, 'timed-out': 124, cancelled: 130, 'resource-limit': 125, interrupted: 1 }[status], commandExitCode: receipt.exitCode, risks: [...begin.risks], gates, errors: [...gates.filter((gate) => gate.state === 'fail').map(({ id, state }) => ({ code: id, state })), ...(!['exited', 'not-applicable'].includes(receipt.status) ? [{ code: `command/${receipt.status}`, state: 'fail' }] : [])], businessOutcome: 'not-evaluated', evidenceCompleteness: { inputBytes: begin.inputSnapshot.coverage.complete ? 'complete-for-declared-inputs' : 'incomplete', execution: 'local-recorder-not-attestation', facts: 'not-verified', observedScope: receipt.native.observedScope }, outputs: [], unresolved: [...begin.unresolved, ...receipt.inputDrift.map((path) => ({ code: 'input-changed-during-guard', path }))] };
}

/** Repository evidence is part of this codec, preserving frozen verifier module closures. */

export const MULTI_GUARD_SCHEMA = 'curia.guard/2';
export const MULTI_GUARD_RUN_SCHEMA = 'curia.guard-run/3';
export const MULTI_GUARD_PLAN_SCHEMA = 'curia.guard-plan/3';
export const MULTI_GUARD_GENERATOR = 'curia-guards/3';
export const MULTI_INPUT_SCHEMA = 'curia.guard-inputs/1';
export const REPOSITORY_ENV = 'CURIA_GUARD_REPOSITORIES';
export const REPOSITORY_LIMIT = 8;
const repositoryFail = message => { throw new Error(`${message} [guard-repositories/contract]`); };
const repositorySame = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const repositoryObject = (v, keys) => { if (!v || typeof v !== 'object' || Array.isArray(v) || ![null, Object.prototype].includes(Object.getPrototypeOf(v)) || Object.getOwnPropertySymbols(v).length || Object.keys(v).length !== keys.length || keys.some(k => !Object.hasOwn(v, k))) repositoryFail('字段不完整或未知'); };
const repositoryText = (v, max = 4096) => { if (typeof v !== 'string' || !v.length || v.trim() !== v || Buffer.byteLength(v) > max || /[\u0000-\u001f\u007f]/u.test(v)) repositoryFail('文本非法'); };
const repositoryArray = (v, max = 4096) => { if (!Array.isArray(v) || v.length > max) repositoryFail('数组非法或超限'); };
const repositoryUnique = v => { if (new Set(v).size !== v.length) repositoryFail('身份重复'); };
const repositoryId = v => { if (typeof v !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(v) || v === 'primary') repositoryFail('仓库 ID 非法或占用 primary'); };
const repositoryRootPath = v => { repositoryText(v); if (!isAbsolute(v) || resolve(v) !== v) repositoryFail('根必须为显式规范绝对路径'); };
const repositoryPath = (v, dot = false) => { repositoryText(v, 1024); if (dot && v === '.') return; if (/[\\:*?\[\]{}#%]/u.test(v) || v.split('/').some(p => !p || p.trim() !== p || ['.', '..', '.git'].includes(p.toLowerCase()))) repositoryFail('仓内路径非法'); };
const repositoryPaths = (v, dot = false) => { repositoryArray(v); v.forEach(p => repositoryPath(p, dot)); repositoryUnique(v.map(p => p.normalize('NFC').toLowerCase())); };
const repositoryInstant = v => { if (typeof v !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString() !== v) repositoryFail('时点非法'); };
const repositoryInteger = v => { if (!Number.isSafeInteger(v) || v < 0) repositoryFail('计数非法'); };
const repositoryOid = v => typeof v === 'string' && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(v);
const repositoryDigest = (v, canonicalization = 'raw-bytes/1') => { repositoryObject(v, ['algorithm', 'canonicalization', 'value']); if (v.algorithm !== 'sha256' || v.canonicalization !== canonicalization || !/^[0-9a-f]{64}$/.test(v.value)) repositoryFail('摘要身份非法'); };
const repositoryContains = (prefix, p) => prefix === '.' || prefix === p || p.startsWith(prefix + '/');
const repositoryChange = (a, b) => !a && !b ? 'unchanged' : !a ? 'added' : !b ? 'deleted' : a.oid !== b.oid && a.mode !== b.mode ? 'content-and-mode' : a.oid !== b.oid ? 'content' : a.mode !== b.mode ? 'mode' : 'unchanged';

export function normalizeRepositoryProfiles(profiles) {
  repositoryArray(profiles, REPOSITORY_LIMIT); if (!profiles.length) repositoryFail('多仓声明不得为空');
  for (const p of profiles) {
    repositoryObject(p, ['id', 'within', 'exclusions', 'includeUntracked']); repositoryId(p.id); repositoryPaths(p.within, true); repositoryPaths(p.exclusions, true);
    if (!p.within.length || typeof p.includeUntracked !== 'boolean' || p.within.some(p => privateReadPath(p))) repositoryFail('来源范围为空、敏感或未显式声明未跟踪策略');
  }
  repositoryUnique(profiles.map(p => p.id)); return structuredClone(profiles);
}
/** Pure validation before any root or source probe. No environment, URLs or inferred roots. */
export function normalizeRepositoryRequest(request = {}) {
  if (!request || typeof request !== 'object' || Array.isArray(request) || ![null, Object.prototype].includes(Object.getPrototypeOf(request)) || Object.getOwnPropertySymbols(request).length || Object.keys(request).some(k => !['repositories', 'repositoriesNonSensitive'].includes(k))) repositoryFail('请求字段非法或未知');
  const { repositories = [], repositoriesNonSensitive = false } = request;
  repositoryArray(repositories, REPOSITORY_LIMIT);
  if (typeof repositoriesNonSensitive !== 'boolean' || repositories.length && !repositoriesNonSensitive || !repositories.length && repositoriesNonSensitive) repositoryFail('每次多仓请求必须单独确认完整来源和连接路径非敏感');
  for (const b of repositories) { repositoryObject(b, ['id', 'root']); repositoryId(b.id); repositoryRootPath(b.root); }
  repositoryUnique(repositories.map(b => b.id)); return { repositories: structuredClone(repositories), repositoriesNonSensitive };
}
export function bindRepositoryProfiles(adapter, request) {
  const r = normalizeRepositoryRequest(request);
  if (adapter.schema !== MULTI_GUARD_SCHEMA) { if (r.repositories.length) repositoryFail('单仓 guard 不接受额外来源'); return []; }
  const profiles = normalizeRepositoryProfiles(adapter.repositoryInputs);
  if (r.repositories.length !== profiles.length || profiles.some(p => !r.repositories.some(b => b.id === p.id))) repositoryFail('必需仓库绑定缺失或存在未声明成员');
  return profiles.map(p => ({ ...p, root: r.repositories.find(b => b.id === p.id).root }));
}
export const primaryGuardInput = input => input.schema === MULTI_INPUT_SCHEMA ? input.primary : input;
export const guardRepositories = input => input.schema === MULTI_INPUT_SCHEMA ? input.repositories : [];
export function repositoryEnvironment(input) {
  if (input.schema !== MULTI_INPUT_SCHEMA) return null;
  return JSON.stringify({ schema: 'curia.guard-repositories/1', primary: { root: input.primary.source.git.root }, repositories: input.repositories.map(r => ({ id: r.id, root: r.root })) });
}
export function repositoryBindingDigest(input) {
  const value = repositoryEnvironment(input); return value === null ? null : { algorithm: 'sha256', canonicalization: 'raw-bytes/1', value: createHash('sha256').update(value).digest('hex') };
}
export function projectRepositoryInputs(report) {
  if (!report.complete || !report.stable || report.mode !== 'input-snapshots') repositoryFail('只能投影完整的实际输入观察');
  return report.members.map(m => ({ id: m.id, requestedRoot: m.requestedRoot, root: m.root, scope: structuredClone(m.scope), source: structuredClone(m.source), observedAt: m.observation.observedAt, objects: structuredClone(m.observation.objects), omitted: structuredClone(m.omitted), inputState: m.inputState }));
}
export function repositoryCoverage(primary, repositories) {
  const objects = repositories.flatMap(r => r.objects);
  return { repositoryCount: 1 + repositories.length, selected: primary.coverage.selected + objects.length, complete: primary.coverage.complete, fullDigests: primary.coverage.fullDigests + objects.filter(o => o.worktree === 'present').length, sensitiveMetadataOnly: primary.coverage.sensitiveMetadataOnly, deleted: primary.coverage.deleted + objects.filter(o => o.worktree === 'missing').length, chargedBytes: primary.coverage.chargedBytes + objects.reduce((n, o) => n + o.bytes, 0) };
}
function repositoryEntry(e, kind) {
  if (e === null) return;
  repositoryObject(e, kind === 'head' ? ['mode', 'type', 'oid'] : kind === 'index' ? ['mode', 'oid', 'stage'] : ['oid', 'mode']);
  if (!['100644', '100755'].includes(e.mode) || !repositoryOid(e.oid) || kind === 'head' && e.type !== 'blob' || kind === 'index' && e.stage !== 0) repositoryFail('Git 条目非法');
}
export function validateRepositoryInputs(input, adapter) {
  repositoryObject(input, ['schema', 'primary', 'repositories', 'coverage', 'environment']);
  if (input.schema !== MULTI_INPUT_SCHEMA || input.environment !== REPOSITORY_ENV) repositoryFail('多仓输入协议非法');
  const profiles = normalizeRepositoryProfiles(adapter.repositoryInputs), primary = input.primary;
  repositoryArray(input.repositories, REPOSITORY_LIMIT);
  if (profiles.length !== input.repositories.length) repositoryFail('必需仓库证据缺失');
  const roots = [primary.source.git.root];
  for (let n = 0; n < profiles.length; n++) {
    const r = input.repositories[n], p = profiles[n];
    repositoryObject(r, ['id', 'requestedRoot', 'root', 'scope', 'source', 'observedAt', 'objects', 'omitted', 'inputState']);
    if (r.id !== p.id) repositoryFail('仓库次序或身份错配'); repositoryRootPath(r.requestedRoot); repositoryRootPath(r.root); roots.push(r.root);
    if (!repositorySame(r.scope, { within: p.within, exclusions: p.exclusions, includeUntracked: p.includeUntracked })) repositoryFail('记录范围不能扩张声明');
    repositoryInstant(r.observedAt); if (r.observedAt > primary.observedAt) repositoryFail('共同后检时点不完整');
    repositoryObject(r.source, ['mode', 'consistency', 'git', 'registry']);
    if (r.source.mode !== 'raw-current-worktree-with-local-git-metadata' || r.source.consistency !== 'non-atomic-with-postcheck') repositoryFail('不得冒充原子或已理解输入');
    repositoryObject(r.source.git, ['head', 'indexDigest']); if (!repositoryOid(r.source.git.head)) repositoryFail('独立 HEAD 缺失'); repositoryDigest(r.source.git.indexDigest, 'curia-git-index-records/1');
    repositoryObject(r.source.registry, ['path', 'digest']); if (r.source.registry.path !== '.agents/doc-types.json') repositoryFail('独立 Registry 缺失'); repositoryDigest(r.source.registry.digest);
    repositoryObject(r.omitted, ['privacy', 'ignored', 'raw']); Object.values(r.omitted).forEach(repositoryInteger);
    if (r.omitted.ignored || r.omitted.raw) repositoryFail('隐式遗漏不能签为完整 guard 输入');
    repositoryArray(r.objects, adapter.limits.maxFiles); if (!r.objects.length) repositoryFail('必需成员不可为空');
    for (const o of r.objects) {
      repositoryObject(o, ['path', 'baseline', 'index', 'worktree', 'tracked', 'discoveredUntracked', 'staged', 'worktreeChange', 'rawWorktree', 'digest', 'bytes']); repositoryPath(o.path);
      if (privateReadPath(o.path) || !p.within.some(s => repositoryContains(s, o.path)) || p.exclusions.some(s => repositoryContains(s, o.path))) repositoryFail('敏感或未声明来源不能进入证据');
      repositoryEntry(o.baseline, 'head'); repositoryEntry(o.index, 'index'); repositoryEntry(o.rawWorktree, 'worktree'); repositoryInteger(o.bytes);
      if (o.tracked !== (o.index !== null) || typeof o.discoveredUntracked !== 'boolean' || o.discoveredUntracked && (o.tracked || !p.includeUntracked) || !['present', 'missing'].includes(o.worktree)) repositoryFail('实际输入状态非法');
      if (o.worktree === 'present') { repositoryDigest(o.digest); if (!o.rawWorktree || o.bytes > adapter.limits.maxFileBytes || !o.tracked && !p.includeUntracked) repositoryFail('未授权或超预算的当前输入'); }
      else if (o.digest !== null || o.rawWorktree !== null || o.bytes !== 0 || !o.baseline && !o.index) repositoryFail('删除状态不可伪造');
      for (const e of [o.baseline, o.index, o.rawWorktree]) if (e && e.oid.length !== r.source.git.head.length) repositoryFail('混用 Git 对象算法');
      if (o.staged !== repositoryChange(o.baseline, o.index) || o.worktreeChange !== repositoryChange(o.index, o.rawWorktree)) repositoryFail('暂存与工作树两轴状态错配');
    }
    repositoryUnique(r.objects.map(o => o.path.normalize('NFC').toLowerCase()));
    const mixed = r.objects.some(o => o.staged !== 'unchanged' || o.worktreeChange !== 'unchanged');
    if (r.inputState !== (mixed ? 'mixed-tree' : 'matches-head-in-selected-scope')) repositoryFail('不把脏输入归给主仓或单一 commit');
  }
  repositoryUnique(roots);
  if (!repositorySame(input.coverage, repositoryCoverage(primary, input.repositories)) || input.coverage.selected > adapter.limits.maxFiles || input.coverage.chargedBytes > adapter.limits.maxTotalBytes) repositoryFail('全组覆盖或总预算不符');
}
export function guardInputIdentity(input) {
  const result = structuredClone(input);
  const strip = v => { if (!v || typeof v !== 'object') return; delete v.observedAt; for (const x of Object.values(v)) strip(x); };
  strip(result);
  for (const r of guardRepositories(result)) delete r.omitted;
  return result;
}
export function qualifiedGuardPaths(input, adapter, declared = false) {
  const primary = primaryGuardInput(input);
  if (input.schema !== MULTI_INPUT_SCHEMA) return declared ? [...adapter.inputScope.paths] : [...primary.documents.map(d => d.path), ...adapter.command.identityPaths];
  return [...(declared ? adapter.inputScope.paths : [...primary.documents.map(d => d.path), ...adapter.command.identityPaths]).map(path => ({ repository: 'primary', path })), ...input.repositories.flatMap(r => (declared ? r.scope.within : r.objects.map(o => o.path)).map(path => ({ repository: r.id, path })))];
}
export function validateQualifiedPath(value, dot = false) {
  repositoryObject(value, ['repository', 'path']); if (value.repository !== 'primary') repositoryId(value.repository); repositoryPath(value.path, dot);
}
export const qualifiedPathKey = value => `${value.repository}\0${value.path}`;

export function guardInputObservationTimes(input) {
  const primary = primaryGuardInput(input);
  return [primary.observedAt, ...primary.documents.map(d => d.observedAt), ...guardRepositories(input).map(r => r.observedAt)];
}
