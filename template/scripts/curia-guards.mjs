#!/usr/bin/env node
/** Explicit, opt-in project guards: inspect/confirm a plan, then record actual one-shot execution. */
import { constants, closeSync, fstatSync, lstatSync, openSync, readSync, readdirSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { ROOT, isMainModule } from './doc-lib.mjs';
import { checkInstancePath, instanceMounts, parseRegistryJson, privateReadPath } from './curia-query.mjs';
import { normalizeInstance, containsPath, taskPrivatePath } from './curia-instance.mjs';
import { GUARD_RUN_SCHEMA, GUARD_PLAN_SCHEMA, GUARD_GENERATOR, guardSensitivePath, guardFail, guardPath, guardText } from './curia-guard-contract.mjs';
import { loadRecordStore, recordReadBoundary, rawDigest, recordGit, recordCodeIdentity, beginGuardRecord, appendGuardReceipt, finishGuardRecord, claimCheckExecution } from './curia-records.mjs';
import { superviseGuard } from './curia-guard-runtime.mjs';
import { prepareInputSnapshots, observeInputSnapshots, revalidateInputSnapshots, inputSnapshotScopeComplete } from './curia-snapshots.mjs';
import { MULTI_GUARD_SCHEMA, MULTI_GUARD_RUN_SCHEMA, MULTI_GUARD_PLAN_SCHEMA, MULTI_GUARD_GENERATOR, MULTI_INPUT_SCHEMA, REPOSITORY_ENV, normalizeRepositoryRequest, bindRepositoryProfiles, primaryGuardInput, guardRepositories, guardInputIdentity, projectRepositoryInputs, repositoryCoverage, repositoryEnvironment, qualifiedGuardPaths } from './curia-guard-contract.mjs';

const plans = new WeakMap();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const contains = (prefix, path) => prefix === '.' || path === prefix || path.startsWith(`${prefix}/`);
const statKey = (stat) => [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs, stat.mode, stat.nlink];
const envBase = Object.freeze({ PATH: '/usr/bin:/bin', LC_ALL: 'C', LANG: 'C', TZ: 'UTC' });
function hashFile(path, expected, maxBytes, objectFormat = 'sha1', allowHardlink = false) {
  if (!expected.isFile() || expected.isSymbolicLink() || (!allowHardlink && expected.nlink !== 1) || expected.size > maxBytes) guardFail('输入不是普通文件、存在硬链接或超出字节预算');
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  const hash = createHash('sha256'); const gitHash = createHash(objectFormat).update(`blob ${expected.size}\0`);
  try {
    if (!same(statKey(fstatSync(fd)), statKey(expected))) guardFail('文件在打开时变化');
    const chunk = Buffer.alloc(256 * 1024); let total = 0;
    while (true) {
      const bytes = readSync(fd, chunk, 0, Math.min(chunk.length, maxBytes + 1 - total), null);
      if (!bytes) break; total += bytes;
      if (total > maxBytes) guardFail('读取超出字节预算，不生成前缀摘要');
      hash.update(chunk.subarray(0, bytes)); gitHash.update(chunk.subarray(0, bytes));
    }
    if (total !== expected.size || !same(statKey(fstatSync(fd)), statKey(expected)) || !same(statKey(lstatSync(path)), statKey(expected))) guardFail('文件在读取期间变化');
    return { digest: { algorithm: 'sha256', canonicalization: 'raw-bytes/1', value: hash.digest('hex') }, gitOid: gitHash.digest('hex') };
  } finally { closeSync(fd); }
}
function sourceRows(ctx, guard, paths) {
  const rows = []; const stats = new Map(); let bytes = 0;
  const objectFormat = recordGit(ctx.root, ['rev-parse', '--show-object-format']).toString().trim();
  if (!['sha1', 'sha256'].includes(objectFormat)) guardFail('Git object format 未支持');
  for (const path of paths) {
    guardPath(path);
    const entries = ctx.index.get(path) ?? [];
    if (entries.length > 1 || entries.some((entry) => entry.stage !== 0 || !['100644', '100755'].includes(entry.mode))) guardFail(`scope-overflow 或冲突：${path}`);
    const index = entries[0] ?? null; const head = ctx.headIndex.get(path)?.[0] ?? null;
    if (head && !['100644', '100755'].includes(head.mode)) guardFail(`scope-overflow：历史输入不是普通文件 ${path}`);
    const sensitive = guardSensitivePath(guard, path) || taskPrivatePath(ctx.taskInstance, path);
    if (sensitive && !guard.effects.sensitiveRead) guardFail(`privacy-risk：输入包含未授权敏感路径 ${path}`);
    const row = { path, privacy: sensitive ? 'sensitive' : 'non-sensitive', tracked: !!index, state: 'not-read', size: null, digest: null, git: { indexOid: sensitive ? null : index?.oid ?? null, indexMode: index?.mode ?? null, headOid: sensitive ? null : head?.oid ?? null, headMode: head?.mode ?? null, worktreeMatchesIndex: null, indexMatchesHead: !!index && !!head && index.oid === head.oid && index.mode === head.mode }, observedAt: new Date().toISOString() };
    let stat;
    try { stat = checkInstancePath(ctx.root, path, 'file', ctx.index, ctx.rootStat, ctx.mounts); }
    catch (error) {
      if (error.code === 'ENOENT' && (index || head)) { row.state = 'deleted'; rows.push(row); stats.set(path, null); continue; }
      guardFail(`scope-overflow：输入路径不在可确认的单仓边界内 ${path}`);
    }
    stats.set(path, statKey(stat)); row.size = stat.size;
    if (sensitive) row.state = 'sensitive-metadata-only';
    else {
      if (bytes + stat.size > guard.limits.maxTotalBytes) guardFail('输入总字节超预算');
      const hashed = hashFile(join(ctx.root, path), stat, guard.limits.maxFileBytes, objectFormat); bytes += stat.size;
      row.state = 'read'; row.digest = hashed.digest;
      row.git.worktreeMatchesIndex = index ? index.oid === hashed.gitOid && index.mode === (stat.mode & 0o111 ? '100755' : '100644') : null;
    }
    row.observedAt = new Date().toISOString(); rows.push(row);
  }
  return { rows, stats, bytes };
}
function candidates(ctx, guard) {
  const scope = guard.inputScope; const found = new Set(); let visited = 0;
  const exclusions = [...new Set([...scope.exclusions, ...(ctx.store ? [ctx.store.path] : []), '.agents/doc-types.json'])];
  const selected = (path) => scope.paths.some((prefix) => contains(prefix, path)) && !exclusions.some((prefix) => contains(prefix, path));
  const add = (path) => { if (!selected(path)) return; if (path.endsWith('/')) guardFail(`scope-overflow：Git 报告独立目录 ${path.slice(0, -1)}`); guardPath(path); found.add(path); if (found.size > guard.limits.maxFiles) guardFail('输入文件数超预算'); };
  const knownGitPaths = new Set([...ctx.index.keys(), ...ctx.headIndex.keys()]);
  for (const path of scope.paths) {
    if (scope.mode === 'git' && [...knownGitPaths].some((known) => contains(path, known))) continue;
    try { const stat = lstatSync(join(ctx.root, path)); if (stat.isSymbolicLink()) guardFail('输入入口不能是 symlink'); }
    catch (error) { if (error.code === 'ENOENT') guardFail(`input-scope 路径不存在：${path}`); throw error; }
  }
  if (scope.mode === 'git') {
    // HEAD-only paths are staged deletions, not an empty or unchanged scope.
    for (const path of knownGitPaths) add(path);
    if (scope.includeUntracked) for (const path of recordGit(ctx.root, ['ls-files', '--others', '--exclude-standard', '-z']).toString().split('\0').filter(Boolean)) add(path);
    if (scope.includeIgnored) for (const path of recordGit(ctx.root, ['ls-files', '--others', '--ignored', '--exclude-standard', '-z']).toString().split('\0').filter(Boolean)) add(path);
  } else {
    const visitedDirs = new Set();
    const walk = (path, depth) => {
      if (exclusions.some((prefix) => contains(prefix, path))) return;
      if (depth > 64 || ++visited > guard.limits.maxFiles * 8) guardFail('文件系统扫描目录深度或节点数超预算');
      const stat = lstatSync(join(ctx.root, path));
      if (!stat.isDirectory()) { if (taskPrivatePath(ctx.taskInstance, path) && !guard.effects.sensitiveRead) guardFail(`privacy-risk：filesystem 范围包含敏感路径 ${path}`); add(path); return; }
      try { checkInstancePath(ctx.root, path, 'directory', ctx.index, ctx.rootStat, ctx.mounts); } catch { guardFail(`scope-overflow：不能遍历嵌套仓库、链接或挂载 ${path}`); }
      if (visitedDirs.has(path)) return; visitedDirs.add(path);
      for (const entry of readdirSync(join(ctx.root, path)).sort()) {
        if (entry.toLowerCase() === '.git') continue;
        const child = path === '.' ? entry : `${path}/${entry}`;
        if (exclusions.some((prefix) => contains(prefix, child))) continue;
        if (privateReadPath(child) && !guard.effects.sensitiveRead) guardFail(`privacy-risk：filesystem 范围包含敏感路径 ${child}`);
        walk(child, depth + 1);
      }
    };
    for (const path of scope.paths) walk(path, 0);
  }
  return { paths: [...found].sort(), exclusions };
}
function executable(ctx, guard) {
  checkInstancePath(ctx.root, guard.command.cwd, 'directory', ctx.index, ctx.rootStat, ctx.mounts);
  const code = [];
  for (const path of guard.command.identityPaths) {
    if (taskPrivatePath(ctx.taskInstance, path) || privateReadPath(path) || guard.privacy.sensitivePaths.some((prefix) => contains(prefix, path))) guardFail('敏感文件不能作为可比对的 command identity');
    const stat = checkInstancePath(ctx.root, path, 'file', ctx.index, ctx.rootStat, ctx.mounts);
    const hashed = hashFile(join(ctx.root, path), stat, guard.limits.maxFileBytes, recordGit(ctx.root, ['rev-parse', '--show-object-format']).toString().trim());
    const entry = ctx.index.get(path)?.[0]; const head = ctx.headIndex.get(path)?.[0]; const mode = stat.mode & 0o111 ? '100755' : '100644';
    code.push({ path, digest: hashed.digest, tracked: !!entry, indexOid: entry?.oid ?? null, indexMode: entry?.mode ?? null, headOid: head?.oid ?? null, headMode: head?.mode ?? null, worktreeMode: mode, matchesIndex: !!entry && hashed.gitOid === entry.oid && entry.mode === mode, matchesHead: !!head && hashed.gitOid === head.oid && head.mode === mode });
  }
  const declared = guard.command.program === 'node' ? process.execPath : guard.command.path;
  const privateExecutable = path => {
    const rel = relative(ctx.root, path).split(sep).join('/');
    return privateReadPath(path.replace(/^\//, '')) || (rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel) && (taskPrivatePath(ctx.taskInstance, rel) || guardSensitivePath(guard, rel)));
  };
  if (privateExecutable(declared)) guardFail('执行器位置包含敏感路径，不采集摘要或执行');
  const resolved = realpathSync(declared);
  if (privateExecutable(resolved)) guardFail('执行器目标包含敏感路径，不采集摘要或执行');
  const stat = lstatSync(resolved);
  if (!(stat.mode & 0o111)) guardFail('command 不是可执行文件');
  const identity = hashFile(resolved, stat, 256 * 1024 * 1024, 'sha256', true).digest;
  const args = guard.command.program === 'node' ? [join(ctx.root, guard.command.script), ...guard.command.args] : [...guard.command.args];
  const invocation = { executable: resolved, args, cwd: join(ctx.root, guard.command.cwd) };
  return { invocation, executable: { declared: guard.command.program === 'node' ? 'current-node-runtime' : declared, resolved, digest: identity, stat: statKey(stat), authority: 'local-executable-not-authenticated' }, files: code, dependencyClosure: 'declared-identity-paths-only' };
}
function identityOf(snapshot) { return guardInputIdentity(snapshot); }
export const guardRunSchema = plan => plan.adapter.schema === MULTI_GUARD_SCHEMA ? MULTI_GUARD_RUN_SCHEMA : GUARD_RUN_SCHEMA;
function plannedInputBytes(ctx, adapter, paths) {
  let bytes = 0;
  for (const path of paths) {
    if (guardSensitivePath(adapter, path) || taskPrivatePath(ctx.taskInstance, path)) { if (!adapter.effects.sensitiveRead) guardFail('敏感输入未授权'); continue; }
    try { const stat = checkInstancePath(ctx.root, path, 'file', ctx.index, ctx.rootStat, ctx.mounts); if (stat.size > adapter.limits.maxFileBytes) guardFail('输入单文件超预算'); bytes += stat.size; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return bytes;
}
function planFingerprint(plan) {
  return { algorithm: 'sha256', canonicalization: plan.schema, value: createHash('sha256').update(JSON.stringify({ root: plan.root, adapterId: plan.adapterId, adapter: plan.adapter, input: identityOf(plan.inputSnapshot), codeIdentity: plan.codeIdentity, risks: plan.risks })).digest('hex') };
}
/** Plan performs local metadata/digest reads only. No guard, network, model or document writes. */
export function buildGuardPlan(root = ROOT, adapterId, { expectedBoundary = null, expectedCodeIdentity = null, repositories = [], repositoriesNonSensitive = false, expectedRepositories = null } = {}) {
  const repositoryRequest = normalizeRepositoryRequest({ repositories, repositoriesNonSensitive });
  guardText(adapterId, 'adapter-id', 80);
  const codes = recordCodeIdentity('guard-command');
  if (expectedCodeIdentity !== null && !same(codes, expectedCodeIdentity)) guardFail('执行代码身份变化；不重新打开输入');
  const ctx = loadRecordStore(root, { expectedBoundary }), boundary = recordReadBoundary(ctx);
  if (expectedRepositories !== null && !revalidateInputSnapshots(expectedRepositories)) guardFail('原多仓输入漂移；不按新上下文扩张读取');
  const registry = parseRegistryJson(new TextDecoder('utf-8', { fatal: true }).decode(ctx.registryBytes));
  const instance = normalizeInstance(registry.instance, registry.types);
  ctx.taskInstance = instance;
  const adapter = instance.guards?.[adapterId];
  if (!adapter) guardFail(`guard 未登记：${adapterId}`);
  for (const path of adapter.authorityLinks) checkInstancePath(ctx.root, path, 'file', ctx.index, ctx.rootStat, ctx.mounts);
  if (!ctx.hasGit) guardFail('guard 输入需要可确认的 Git 边界');
  const multi = adapter.schema === MULTI_GUARD_SCHEMA, bindings = bindRepositoryProfiles(adapter, repositoryRequest);
  const selected = candidates(ctx, adapter);
  let repositoryReport = null, repositoryInputs = [];
  if (multi) {
    const prepared = prepareInputSnapshots({ repositories: bindings, nonSensitive: true, limits: { maxRepositories: bindings.length, maxFiles: Math.min(adapter.limits.maxFiles, 2048), maxFileBytes: adapter.limits.maxFileBytes, maxTotalBytes: adapter.limits.maxTotalBytes } });
    if (prepared.members.some(member => member.root === ctx.root) || !inputSnapshotScopeComplete(prepared)) guardFail('多仓范围不可确认、与命令宿主重复或存在未显式排除的输入');
    if (selected.paths.length + prepared.coverage.selectedObjects > adapter.limits.maxFiles || plannedInputBytes(ctx, adapter, selected.paths) + prepared.coverage.plannedBytes > adapter.limits.maxTotalBytes) guardFail('多仓与主仓输入共用总预算；不打开超额正文');
    repositoryReport = observeInputSnapshots(prepared);
    if (!repositoryReport.complete) guardFail('必需仓库快照不完整，不执行或持久化部分成功');
    repositoryInputs = projectRepositoryInputs(repositoryReport);
  }
  const availableBytes = adapter.limits.maxTotalBytes - (repositoryReport?.coverage.chargedBytes ?? 0);
  const capture = sourceRows(ctx, { ...adapter, limits: { ...adapter.limits, maxTotalBytes: availableBytes } }, selected.paths);
  if (!capture.rows.length && !repositoryInputs.length && adapter.onEmpty === 'fail') guardFail('必需 guard 的输入为空，不执行也不通过');
  const commandIdentity = executable(ctx, adapter);
  const environment = { ...envBase }; const envReport = [];
  for (const item of adapter.environment) {
    const present = Object.hasOwn(process.env, item.name);
    if (item.required && !present) guardFail(`必需环境变量缺失：${item.name}`);
    if (present) environment[item.name] = process.env[item.name];
    envReport.push({ ...item, present, value: 'not-recorded' });
  }
  const modified = capture.rows.filter((row) => row.tracked && row.state === 'read' && !row.git.worktreeMatchesIndex).map((row) => row.path);
  const deleted = capture.rows.filter((row) => row.state === 'deleted').map((row) => row.path);
  const untracked = capture.rows.filter((row) => !row.tracked && row.state !== 'deleted').map((row) => row.path);
  const uncertain = capture.rows.filter((row) => row.state === 'sensitive-metadata-only').map((row) => row.path);
  const stagedChanged = capture.rows.filter((row) => (row.tracked || row.git.headMode !== null) && !row.git.indexMatchesHead).map((row) => row.path);
  const outsideManaged = capture.rows.filter((row) => !instance.surfaces.some((surface) => surface.members.some((member) => containsPath(member, row.path)))).map((row) => row.path);
  const primary = {
    source: { mode: 'current-worktree', git: { root: ctx.root, head: ctx.head, repositoryCount: 1 }, worktreeState: modified.length || deleted.length || untracked.length || stagedChanged.length ? 'mixed-tree' : uncertain.length ? 'unknown-sensitive-inputs' : 'matches-head-for-selected-inputs', trackedModified: modified, trackedDeleted: deleted, untracked, stagedChanged, sensitiveContentNotObserved: uncertain },
    configuration: { registry: ctx.registryDigest, generator: multi ? MULTI_GUARD_GENERATOR : GUARD_GENERATOR, identity: 'on-disk-code-not-loaded-module-attestation' }, gitIndexDigest: rawDigest(ctx.indexRaw),
    documents: capture.rows, commandIdentity, environment: envReport,
    scope: { ...adapter.inputScope, exclusions: selected.exclusions, verification: 'declared-union-not-traced', outsideManaged, nestedRepositories: 'not-authorized-scope-overflow-is-blocking' },
    coverage: { selected: capture.rows.length, complete: !uncertain.length, fullDigests: capture.rows.filter((row) => row.state === 'read').length, sensitiveMetadataOnly: uncertain.length, deleted: deleted.length, chargedBytes: capture.bytes }, observedAt: new Date().toISOString(),
  };
  const inputSnapshot = multi ? { schema: MULTI_INPUT_SCHEMA, primary, repositories: repositoryInputs, coverage: repositoryCoverage(primary, repositoryInputs), environment: REPOSITORY_ENV } : primary;
  if (multi) environment[REPOSITORY_ENV] = repositoryEnvironment(inputSnapshot);
  const risks = [...(multi ? ['independent-repository-inputs-not-atomic', 'secondary-inputs-not-cross-repository-authority-resolution'] : []), 'trusted-local-command-not-sandboxed', 'memory-cpu-process-count-unbounded', 'actual-access-scope-not-traced', 'command-dependency-closure-not-inferred', ...(commandIdentity.files.some((file) => !file.matchesIndex || !file.matchesHead) ? ['dirty-or-untracked-command-code'] : []), ...(outsideManaged.length ? ['declared-scope-overflow-outside-curia-surfaces'] : []), ...(Object.values(adapter.effects).some(Boolean) ? ['explicit-effects-authorization-required'] : []), ...(uncertain.length ? ['sensitive-input-content-not-snapshotted'] : [])];
  const plan = { schema: multi ? MULTI_GUARD_PLAN_SCHEMA : GUARD_PLAN_SCHEMA, root: ctx.root, adapterId, adapter, inputSnapshot, codeIdentity: codes, risks, persisted: false, commandExecuted: false, recordStore: ctx.store?.path ?? null, applicability: inputSnapshot.coverage.selected ? 'applicable' : 'not-applicable' };
  if (!same(codes, recordCodeIdentity('guard-command'))) guardFail('观察期间代码身份变化；不混用实现');
  const after = loadRecordStore(root, { expectedBoundary: boundary });
  if (ctx.head !== after.head || !ctx.indexRaw.equals(after.indexRaw) || !same(ctx.registryDigest, after.registryDigest) || !same(instanceMounts(ctx.root), ctx.mounts) || !same(selected.paths, candidates(after, adapter).paths)) guardFail('guard 盘点期间配置、Git、挂载或路径集合变化');
  for (const [path, stat] of capture.stats) {
    try { const observed = statKey(lstatSync(join(ctx.root, path))); if (stat === null || !same(stat, observed)) guardFail('guard 原件在盘点期间变化'); }
    catch (error) { if (error.code === 'ENOENT' && stat === null) continue; throw error; }
  }
  if (repositoryReport && !revalidateInputSnapshots(repositoryReport)) guardFail('共同后检撤回多仓输入，不混用观察');
  plan.digest = planFingerprint(plan);
  plans.set(plan, { execution: { ...commandIdentity.invocation, environment }, snapshot: structuredClone(plan), stamp: after.stamp, boundary, requestedRoot: resolve(root), repositoryRequest, repositoryReport });
  return plan;
}
export function reobserveGuardPlan(view) {
  const saved = plans.get(view);
  if (!saved || !same(view, saved.snapshot)) guardFail('复核需要未修改的本进程计划；JSON 不恢复读取授权');
  return buildGuardPlan(saved.requestedRoot, view.adapterId, { expectedBoundary: saved.boundary, expectedCodeIdentity: saved.snapshot.codeIdentity, ...saved.repositoryRequest, expectedRepositories: saved.repositoryReport });
}
function compareInputs(before, after) {
  const changed = [];
  if (!same(guardInputIdentity({ schema: MULTI_INPUT_SCHEMA, repositories: guardRepositories(before) }), guardInputIdentity({ schema: MULTI_INPUT_SCHEMA, repositories: guardRepositories(after) }))) changed.push('$repositories/inputs');
  before = primaryGuardInput(before); after = primaryGuardInput(after);
  const a = new Map(before.documents.map((doc) => [doc.path, { ...doc, observedAt: undefined }]));
  const b = new Map(after.documents.map((doc) => [doc.path, { ...doc, observedAt: undefined }]));
  for (const path of new Set([...a.keys(), ...b.keys()])) if (!same(a.get(path), b.get(path))) changed.push(path);
  if (!same(before.commandIdentity, after.commandIdentity)) changed.push('$command/identity');
  return changed.sort();
}
export async function runGuard(root, adapterId, expectedPlan, { signal, corrects = null, retriedFrom = null, repositories = [], repositoriesNonSensitive = false } = {}) {
  if (typeof expectedPlan !== 'string' || !/^[0-9a-f]{64}$/.test(expectedPlan)) guardFail('执行必须带 plan 输出的确认摘要，不从来源正文取授权');
  const view = buildGuardPlan(root, adapterId, { repositories, repositoriesNonSensitive }); const saved = plans.get(view); const plan = saved.snapshot;
  if (view.digest.value !== expectedPlan) guardFail('plan 已变化；重新审查 effects、privacy 与真实输入后再确认');
  if (!plan.recordStore) guardFail('跟踪执行需要显式 recordStore；plan 不会替项目开启记录');
  let run = beginGuardRecord(saved.requestedRoot, { schema: guardRunSchema(plan), executionMode: 'guard-command', adapterId, adapter: plan.adapter, inputSnapshot: plan.inputSnapshot, planDigest: plan.digest, risks: plan.risks, unresolved: plan.inputSnapshot.coverage.complete ? [] : [{ code: 'sensitive-input-not-snapshotted', reason: '敏感原件只记授权路径与状态，不保留可比对摘要' }], codeIdentity: plan.codeIdentity, references: { corrects, retriedFrom } }, saved.boundary);
  try {
    let skipReason = null;
    try { if (reobserveGuardPlan(view).digest.value !== expectedPlan) skipReason = 'plan-changed'; } catch { skipReason = 'plan-changed'; }
    const handle = await superviseGuard(plan.adapter, saved.execution, { signal, skipReason, notApplicable: plan.applicability === 'not-applicable', inputPaths: qualifiedGuardPaths(plan.inputSnapshot, plan.adapter), declaredPaths: qualifiedGuardPaths(plan.inputSnapshot, plan.adapter, true), runId: run.runId });
    let drift;
    try { drift = compareInputs(plan.inputSnapshot, reobserveGuardPlan(view).inputSnapshot); }
    catch { drift = ['$post-snapshot/unavailable']; }
    run = appendGuardReceipt(saved.requestedRoot, run.runId, run.expectedHead, handle, drift, saved.boundary);
    return finishGuardRecord(saved.requestedRoot, run.runId, run.expectedHead, saved.boundary);
  } catch {
    const error = new Error(`guard 执行或记录状态不可确认；先核对 ${run.runId}，不自动重跑未知效果 [guards/run-unresolved]`);
    error.runId = run.runId; throw error;
  }
}
/** Only the live private plan and a published batch capability can reach the supervisor. */
export async function executeCheckGuard(view, capability, { signal, skipReason = null } = {}) {
  const saved = plans.get(view);
  if (!saved || !same(view, saved.snapshot)) guardFail('批次执行需要未修改的进程内 guard plan；JSON 不授予执行能力');
  const plan = saved.snapshot;
  const claimed = claimCheckExecution(capability, plan.adapterId, plan.digest, plan);
  if (claimed.root !== plan.root) guardFail('检查计划来自不同实例');
  const reobserve = () => reobserveGuardPlan(view);
  try { if (reobserve().digest.value !== plan.digest.value) skipReason = 'plan-changed'; } catch { skipReason = 'plan-changed'; }
  const handle = await superviseGuard(plan.adapter, saved.execution, { signal, skipReason, inputPaths: qualifiedGuardPaths(plan.inputSnapshot, plan.adapter), declaredPaths: qualifiedGuardPaths(plan.inputSnapshot, plan.adapter, true), runId: claimed.runId });
  let inputDrift;
  try {
    const after = reobserve();
    inputDrift = compareInputs(plan.inputSnapshot, after.inputSnapshot);
    if (after.digest.value !== plan.digest.value) inputDrift.push('$guard/plan');
  } catch { inputDrift = ['$post-snapshot/unavailable']; }
  return { handle, inputDrift };
}
export function parseGuardArgs(argv) {
  if (argv.length === 1 && argv[0] === '--help') return { command: 'help', options: {} };
  const command = argv[0]; if (!['plan', 'run'].includes(command)) guardFail('命令必须是 plan / run');
  const options = { repositories: [] };
  for (let i = 1; i < argv.length; i++) {
    const key = argv[i];
    if (key === '--repo') { const value = argv[++i]; if (!value || Buffer.byteLength(value) > 65536) guardFail('仓库绑定缺值或超限'); options.repositories.push(parseRegistryJson(value)); continue; }
    if (!['--root', '--guard', '--json', '--repositories-non-sensitive', ...(command === 'run' ? ['--confirm', '--corrects', '--retried-from'] : [])].includes(key) || Object.hasOwn(options, key)) guardFail(`未知、重复或不适用的参数：${key}`);
    const value = ['--json', '--repositories-non-sensitive'].includes(key) ? true : argv[++i]; if (value === undefined || (typeof value === 'string' && value.startsWith('--'))) guardFail(`缺少参数值：${key}`); options[key] = value;
  }
  normalizeRepositoryRequest({ repositories: options.repositories, repositoriesNonSensitive: options['--repositories-non-sensitive'] ?? false });
  guardText(options['--guard'], 'guard-id', 80); return { command, options };
}
if (isMainModule(import.meta.url)) {
  const abort = new AbortController(); const cancel = () => abort.abort();
  try {
    const { command, options: o } = parseGuardArgs(process.argv.slice(2));
    if (command === 'help') console.log('curia-guards — explicit native project guards\nplan --guard <id> [--root <root>] --json\nrun --guard <id> --confirm <plan digest> [--corrects <run-id> | --retried-from <run-id>] --json\nFor curia.guard/2, repeat --repo {"id":"lib","root":"/absolute/path"} and --repositories-non-sensitive on both plan and run. Bind every declared role exactly once; sources stay independent, and CURIA_GUARD_REPOSITORIES passes actual roots to the command. Requires optional instance.guards; run also requires recordStore. Confirmation accepts the displayed declaration and unsandboxed risks, not protected approval. No raw output or inherited secret values are persisted.');
    else if (command === 'plan') {
      const plan = buildGuardPlan(o['--root'] ?? ROOT, o['--guard'], { repositories: o.repositories, repositoriesNonSensitive: o['--repositories-non-sensitive'] ?? false });
      console.log(o['--json'] ? JSON.stringify(plan, null, 2) : `${plan.adapterId} ${plan.applicability}\nconfirm: ${plan.digest.value}\nrisks: ${plan.risks.join(', ')}`);
    } else {
      process.on('SIGINT', cancel); process.on('SIGTERM', cancel);
      const run = await runGuard(o['--root'] ?? ROOT, o['--guard'], o['--confirm'], { signal: abort.signal, repositories: o.repositories, repositoriesNonSensitive: o['--repositories-non-sensitive'] ?? false, corrects: o['--corrects'] ?? null, retriedFrom: o['--retried-from'] ?? null });
      console.log(o['--json'] ? JSON.stringify(run, null, 2) : `${run.runId} ${run.status} terminal=${run.terminal}\ncommand-exit: ${run.command.exitCode}; business: not-evaluated`); process.exitCode = run.exitCode;
    }
  } catch (error) { console.error(`${error.message} [guards/operation-failed]`); process.exitCode = 1; }
  finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
}
