#!/usr/bin/env node
/** Explicit independent repository inputs; no registry merge, commands, network or persistent records. */
import { isAbsolute, resolve, dirname, join } from 'node:path';
import { lstatSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { isMainModule } from './doc-lib.mjs';
import { resolveInstance, readStableFile, parseRegistryJson, normalizeGitChangeOptions, normalizeGitChangeLimits, prepareGitChangeSelection, gitInputCost, gitInputScopeComplete, captureGitInputs, revalidateGitChanges } from './curia-query.mjs';

export const SNAPSHOT_SCHEMA = 'curia.input-snapshots/1';
export const SNAPSHOT_LIMITS = Object.freeze({ maxRepositories: 8, maxFiles: 256, maxFileBytes: 16 * 1024 * 1024, maxTotalBytes: 32 * 1024 * 1024 });
export const SNAPSHOT_RULES = Object.freeze([
  ['authorization', 'explicit-repository-roots-and-independent-non-sensitive-scopes', 'multi-repository', 'privacy-before-probe'],
  ['boundary', 'separate-git-roots-and-registries', 'nested-explicit-repositories', 'duplicate-canonical-root'],
  ['budget', 'whole-request-files-and-worktree-byte-budget', 'shared-byte-budget', 'whole-set-file-limit'],
  ['capture', 'head-index-and-raw-worktree-not-git-status', 'mixed-inputs', 'untracked-not-observed'],
  ['consistency', 'all-members-postchecked-without-atomicity-claim', 'revalidate-live', 'later-member-revokes-earlier-evidence'],
].map(([name, scope, positive, negative]) => Object.freeze({ id: `curia-snapshot/${name}`, version: 1, owner: 'Curia workspace maintainer', scope, activation: 'explicit-multi-repository-input-capture', onEmpty: 'fail', required: true, verification: 'actual-local-raw-input-observation-not-fact-or-command-verification', fixtures: { file: 'scripts/curia-snapshots-self-test.mjs', positive, negative } })));
const selections = new WeakMap(), observations = new WeakMap(), ownErrors = new WeakSet();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const plain = v => v && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v)) && !Object.getOwnPropertySymbols(v).length;
const fail = (code, text) => { const error = new Error(`${text} [curia-snapshot/${code}]`); ownErrors.add(error); throw error; };
const clone = v => structuredClone(v);
const limitsOf = value => {
  if (value !== undefined && (!plain(value) || Object.keys(value).some(k => !Object.hasOwn(SNAPSHOT_LIMITS, k)))) fail('budget-invalid', '快照预算字段非法');
  const limits = { ...SNAPSHOT_LIMITS, ...value }, { maxRepositories, ...bytes } = limits;
  if (!Number.isSafeInteger(maxRepositories) || maxRepositories < 1 || maxRepositories > 16) fail('budget-invalid', '仓库数预算非法');
  normalizeGitChangeLimits(bytes); return limits;
};
const rule = (id, state, reason) => ({ ...SNAPSHOT_RULES.find(r => r.id === `curia-snapshot/${id}`), state, reason });
const limitations = () => ['independent-local-single-reader-instances', 'not-an-atomic-cross-repository-snapshot', 'selected-input-state-not-whole-repository-dirty-status', 'raw-bytes-not-git-normalization-or-rename-detection', 'no-document-reading-or-fact-verification', 'no-cross-repository-authority-resolution', 'no-guard-execution-or-run-persistence', 'no-authenticated-multi-reader-or-protected-delivery', 'path-privacy-floor-not-secret-detection', 'bounded-input-accounting-not-os-resource-isolation', 'host-clock-not-certified', 'on-disk-code-not-loaded-module-or-git-binary-attestation'];

export function snapshotCodeIdentity() {
  const dir = dirname(fileURLToPath(import.meta.url));
  return ['curia-snapshots.mjs', 'curia-query.mjs', 'curia-dependencies.mjs', 'curia-impact.mjs', 'curia-relations.mjs', 'curia-instance.mjs', 'curia-json.mjs', 'curia-originals.mjs', 'curia-applicability.mjs', 'curia-guard-contract.mjs', 'doc-lib.mjs'].map(file => {
    const path = join(dir, file), stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || realpathSync(path) !== path || stat.size > 1024 * 1024) fail('code-identity', '观察器代码身份不可确认');
    const bytes = readStableFile(path, stat, 1024 * 1024 - 1), after = lstatSync(path);
    if (bytes.length !== stat.size || ['dev', 'ino', 'mode', 'nlink', 'size', 'mtimeMs', 'ctimeMs'].some(k => after[k] !== stat[k])) fail('code-identity', '观察器代码身份变化');
    return { file, digest: { algorithm: 'sha256', canonicalization: 'raw-bytes/1', value: createHash('sha256').update(bytes).digest('hex') } };
  });
}
function codeMatches(codes) { try { return same(codes, snapshotCodeIdentity()); } catch { return false; } }

export function normalizeSnapshotOptions(options) {
  if (!plain(options) || Object.keys(options).some(k => !['repositories', 'nonSensitive', 'limits', 'inventoryOnly'].includes(k)) || options.nonSensitive !== true || options.inventoryOnly !== undefined && typeof options.inventoryOnly !== 'boolean') fail('options-invalid', '必须独立声明整个请求的非敏感范围；不接受执行、网络或受保护授权');
  const limits = limitsOf(options.limits), repositories = options.repositories;
  if (!Array.isArray(repositories) || !repositories.length || repositories.length > limits.maxRepositories) fail('repository-limit', '仓库集合为空或超预算');
  const ids = new Set();
  const members = repositories.map(r => {
    if (!plain(r) || Object.keys(r).some(k => !['id', 'root', 'within', 'exclusions', 'includeUntracked'].includes(k)) || typeof r.id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(r.id) || ids.has(r.id)) fail('repository-invalid', '仓库声明字段或局部 ID 非法');
    ids.add(r.id);
    if (typeof r.root !== 'string' || r.root !== r.root.trim() || Buffer.byteLength(r.root) > 4096 || /[\u0000-\u001f\u007f]/u.test(r.root) || !isAbsolute(r.root) || resolve(r.root) !== r.root) fail('root-invalid', '仓库根必须为显式规范绝对路径');
    const n = normalizeGitChangeOptions({ base: 'HEAD', within: r.within, exclusions: r.exclusions ?? [], includeUntracked: r.includeUntracked ?? false, nonSensitive: true });
    return { id: r.id, requestedRoot: r.root, scope: { within: n.selection.paths, exclusions: n.selection.exclusions, includeUntracked: n.includeUntracked } };
  });
  return { members, limits, inventoryOnly: options.inventoryOnly ?? false };
}
function rootMatches(member, root) { try { return resolveInstance(member.requestedRoot).root === root; } catch { return false; } }
function safeCode(error) {
  const code = /\[([a-z0-9/-]+)\]$/u.exec(String(error?.message))?.[1];
  return ['curia2/root-unavailable', 'curia2/root-not-git', 'curia2/root-boundary', 'curia2/git-env-override', 'curia2/git-boundary-unknown', 'curia2/registry-invalid', 'curia2/git-change-base-unavailable', 'curia2/git-change-tree-unavailable', 'curia2/git-change-scope-invalid', 'curia2/git-change-options-invalid', 'curia2/git-change-budget-invalid', 'curia2/git-change-selection-required'].includes(code) ? code : 'curia-snapshot/repository-unavailable';
}
function independentState(observation) {
  if (observation.objects.some(o => o.worktree === 'present-not-authorized')) return 'unknown-untracked-input';
  return observation.changed.length ? 'mixed-tree' : 'matches-head-in-selected-scope';
}

/** A live preparation capability cannot be recovered from serialized metadata. */
export function prepareInputSnapshots(options) {
  const n = normalizeSnapshotOptions(options), startedAt = new Date().toISOString(), codes = snapshotCodeIdentity(), members = [], live = [], roots = new Set();
  for (const member of n.members) {
    const row = { ...clone(member), root: null, state: 'blocked', source: null, selectedObjects: 0, objects: [], objectsWithheld: false, omitted: null, findings: [] };
    members.push(row);
    try {
      const root = resolveInstance(member.requestedRoot).root; row.root = root;
      if (roots.has(root)) { row.findings.push({ code: 'curia-snapshot/duplicate-canonical-root', path: null }); continue; }
      roots.add(root);
      const selection = prepareGitChangeSelection(root, { base: 'HEAD', ...member.scope, nonSensitive: true });
      row.source = clone(selection.source); row.omitted = clone(selection.omitted); row.findings = clone(selection.findings);
      row.selectedObjects = selection.objects.length;
      row.objects = selection.objects.map(({ path, tracked, worktree, discoveredUntracked }) => ({ path, tracked, worktree, discoveredUntracked }));
      row.state = row.findings.length ? 'blocked' : 'inventoried-not-captured';
      live.push({ member, root, selection, cost: gitInputCost(selection) });
    } catch (error) { row.findings.push({ code: 'curia-snapshot/member-unavailable', causeRule: safeCode(error), path: null }); }
  }
  const selected = members.reduce((sum, m) => sum + m.selectedObjects, 0), blocked = members.some(m => m.state === 'blocked');
  const plannedBytes = live.reduce((sum, item) => sum + item.cost.totalBytes, 0);
  const budgetExceeded = selected > n.limits.maxFiles || plannedBytes > n.limits.maxTotalBytes || live.some(item => item.cost.maxFileBytes > n.limits.maxFileBytes);
  if (budgetExceeded) for (const row of members) { row.objects = []; row.objectsWithheld = true; row.source = null; }
  const result = { schema: SNAPSHOT_SCHEMA, generator: 'curia-snapshots/1', mode: 'inventory-only', startedAt, completedAt: new Date().toISOString(),
    tool: { kind: 'tool', id: 'curia-snapshots/1', authentication: 'local-self-reported-not-authenticated', implementation: codes, runtime: { name: 'node', version: process.version, platform: process.platform, arch: process.arch } },
    execution: { mode: 'ephemeral-read-only', persisted: false, effects: ['explicit-local-repository-metadata', 'independent-registry-read'], receiverCompleteness: 'not-observed' },
    limits: n.limits, members, complete: false, stable: false, outcome: blocked || budgetExceeded ? 'incomplete' : 'inventoried-not-captured', exitCode: blocked || budgetExceeded ? 2 : 0,
    coverage: { requestedRepositories: n.members.length, inventoriedRepositories: members.filter(m => m.state !== 'blocked').length, selectedObjects: selected, plannedBytes, capturedObjects: 0, chargedBytes: 0, openedFiles: 0, contentRead: 0, factVerified: 0 },
    checks: [rule('authorization', 'pass', '逐仓显式范围与整组非敏感声明，不由来源扩张'), rule('boundary', blocked ? 'evidence-gap' : 'pass', '各仓边界与配置独立；无隐式发现'), rule('budget', budgetExceeded ? 'fail' : 'pass', '整组对象数、单文件与总字节预检；未打开工作树正文'), rule('capture', 'skipped', '只盘点，不构成输入快照'), rule('consistency', 'skipped', '未形成跨仓观察')], limitations: limitations() };
  selections.set(result, { request: n, live, public: clone(result), blocked: blocked || budgetExceeded, codes });
  return result;
}
/** Non-executing live-scope check; serialized inventory cannot authorize a guard. */
export function inputSnapshotScopeComplete(prepared) {
  const cap = selections.get(prepared);
  if (!cap || !same(prepared, cap.public)) fail('selection-required', '检查需要本进程未修改的盘点');
  return !cap.blocked && cap.live.every(item => gitInputScopeComplete(item.selection));
}
function validMemberInput(item) {
  return rootMatches(item.member, item.root) && item.observation?.complete && item.observation.base.oid === item.observation.source.git.head && revalidateGitChanges(item.observation);
}
/** Capture all prepared inputs, then withdraw the entire group when any required member is incomplete. */
export function observeInputSnapshots(prepared) {
  const cap = selections.get(prepared);
  if (!cap || !same(prepared, cap.public)) fail('selection-required', '快照需要本进程未修改的显式盘点能力');
  const result = clone(prepared); result.mode = 'input-snapshots'; result.execution.effects.push('bounded-authorized-worktree-digests');
  let remaining = result.limits.maxTotalBytes, unavailable = cap.blocked, drift = !codeMatches(cap.codes);
  if (drift) unavailable = true;
  const captured = [];
  if (!unavailable) for (const item of cap.live) {
    const row = result.members.find(m => m.id === item.member.id);
    if (!rootMatches(item.member, item.root)) { row.findings.push({ code: 'curia-snapshot/root-changed', path: null }); unavailable = drift = true; break; }
    const { maxFiles, maxFileBytes } = result.limits;
    let observation;
    try { observation = captureGitInputs(item.selection, { maxFiles, maxFileBytes, maxTotalBytes: result.limits.maxTotalBytes }); }
    catch (error) { row.findings.push({ code: 'curia-snapshot/capture-failed', causeRule: safeCode(error), path: null }); unavailable = true; break; }
    captured.push({ ...item, observation });
    result.coverage.chargedBytes += observation.chargedBytes; result.coverage.openedFiles += observation.openedFiles;
    remaining -= observation.chargedBytes;
    if (observation.chargedBytes > item.cost.totalBytes || remaining < 0) { row.findings.push({ code: 'curia-snapshot/shared-byte-budget', path: null }); unavailable = true; break; }
    row.findings.push(...clone(observation.findings));
    if (!observation.complete || !observation.objects.length || observation.objects.some(o => o.worktree === 'present-not-authorized')) {
      if (observation.objects.some(o => o.worktree === 'present-not-authorized')) row.findings.push({ code: 'curia-snapshot/untracked-input-not-observed', path: null });
      unavailable = true; break;
    }
  }
  if (captured.length !== cap.live.length) unavailable = true;
  if (!unavailable && (!captured.every(validMemberInput) || !codeMatches(cap.codes))) unavailable = drift = true;
  result.complete = result.stable = !unavailable;
  result.outcome = unavailable ? 'incomplete' : 'inputs-captured'; result.exitCode = unavailable ? 2 : 0;
  for (const row of result.members) {
    const observation = captured.find(c => c.member.id === row.id)?.observation;
    row.observation = unavailable ? null : clone(observation);
    row.inputState = unavailable ? 'unknown' : independentState(observation);
    row.state = unavailable ? 'withheld-incomplete-group' : 'captured';
    if (unavailable) row.source = null;
  }
  result.coverage.capturedObjects = unavailable ? 0 : captured.reduce((sum, c) => sum + c.observation.objects.length, 0);
  result.completedAt = new Date().toISOString();
  result.checks = [prepared.checks[0], prepared.checks[1], rule('budget', remaining < 0 || prepared.checks[2].state === 'fail' ? 'fail' : 'pass', '所有仓库共享文件数和工作树字节预算；配置读取另按单仓上限'), rule('capture', unavailable ? 'evidence-gap' : 'pass', '只证明各自选中输入的实际字节与 Git 两轴状态，不是正文理解'), rule('consistency', drift || unavailable ? 'evidence-gap' : 'pass', '所有成功观察共同后检；不宣称原子性，任何缺口撤回整组快照')];
  observations.set(result, { captured, codes: cap.codes, public: clone(result) });
  return result;
}
export function revalidateInputSnapshots(report) {
  const cap = observations.get(report);
  if (!cap || !report.complete || !same(report, cap.public)) return false;
  return codeMatches(cap.codes) && cap.captured.every(validMemberInput);
}
export function buildInputSnapshots(options) { const n = normalizeSnapshotOptions(options), prepared = prepareInputSnapshots(options); return n.inventoryOnly ? prepared : observeInputSnapshots(prepared); }

export function parseSnapshotArgs(argv) {
  const options = { repositories: [], limits: {}, nonSensitive: false }, flags = { json: false, help: false, rules: false }, seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]; if (seen.has(arg) && arg !== '--repo') fail('arg-invalid', '参数重复'); seen.add(arg);
    const value = () => { const v = argv[++i]; if (!v || v.startsWith('--')) fail('arg-invalid', '参数缺值'); return v; };
    if (arg === '--repo') { const text = value(); if (Buffer.byteLength(text) > 64 * 1024) fail('arg-invalid', '仓库声明超限'); options.repositories.push(parseRegistryJson(text)); }
    else if (arg === '--non-sensitive') options.nonSensitive = true;
    else if (arg === '--inventory') options.inventoryOnly = true;
    else if (arg === '--json') flags.json = true;
    else if (arg === '--help') flags.help = true;
    else if (arg === '--list-checks') flags.rules = true;
    else if (['--max-repositories', '--max-files', '--max-file-bytes', '--max-total-bytes'].includes(arg)) { const v = value(); if (!/^[1-9][0-9]*$/.test(v)) fail('arg-invalid', '预算必须为正整数'); options.limits[{ '--max-repositories': 'maxRepositories', '--max-files': 'maxFiles', '--max-file-bytes': 'maxFileBytes', '--max-total-bytes': 'maxTotalBytes' }[arg]] = Number(v); }
    else fail('arg-invalid', '未知参数；不接受命令、凭据或受保护降级');
  }
  if (flags.help || flags.rules) { if (flags.help && flags.rules || argv.some(a => !['--help', '--list-checks', '--json'].includes(a))) fail('arg-invalid', '帮助不能与执行参数混用'); }
  else normalizeSnapshotOptions(options);
  return { options, flags };
}
export function snapshotsMain(argv = process.argv.slice(2)) {
  try {
    const { options, flags } = parseSnapshotArgs(argv);
    if (flags.help) { console.log(`Curia explicit independent repository input snapshots\nnode scripts/curia-workflow.mjs snapshot --repo '<JSON>' [--repo '<JSON>'] --non-sensitive [--inventory] [--json]\nEach JSON: {"id":"app","root":"/absolute/path/app","within":["docs"],"exclusions":[],"includeUntracked":false}\n--max-repositories / --max-files / --max-file-bytes / --max-total-bytes are shared request budgets.\nNo discovery, registry merge, network, commands, protected access, document understanding or Run persistence.\nHEAD/index/raw-worktree observations are separate per repository, not atomic and not git-status-equivalent.\nOnly authorized visible inputs are covered; ignored/private/raw exclusions and omitted untracked files are not captured.\nAny missing member, drift or budget gap withholds all snapshots; inventory is not capture.\nExit 0: complete capture or valid inventory; exit 2: incomplete or invalid. --list-checks --json lists contracts.`); return; }
    if (flags.rules) { console.log(JSON.stringify(SNAPSHOT_RULES, null, 2)); return; }
    const result = buildInputSnapshots(options);
    if (flags.json) console.log(JSON.stringify(result, null, 2));
    else { console.log(`${result.outcome}: ${result.coverage.requestedRepositories} repositories; ${result.coverage.capturedObjects} captured objects; no fact verification`); for (const m of result.members) console.log(`${m.id}\t${m.state}\t${m.inputState ?? 'not-captured'}`); }
    process.exitCode = result.exitCode;
  } catch (error) { console.error(ownErrors.has(error) ? error.message : `快照请求非法或无法确认 [curia-snapshot/request-failed] (${safeCode(error)})`); process.exitCode = 2; }
}
if (isMainModule(import.meta.url)) snapshotsMain();
