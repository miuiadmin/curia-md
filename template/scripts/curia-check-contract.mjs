/** Small versioned codec for explicitly selected, sequential impact checks; no execution or I/O. */
import { createHash } from 'node:crypto';
import { IMPACT_RULES, GIT_IMPACT_RULES, CONFIGURATION_IMPACT_RULES, GIT_CONFIGURATION_IMPACT_RULES, MOVE_CONFIGURATION_IMPACT_RULES, GIT_MOVE_CONFIGURATION_IMPACT_RULES, GUARD_CONFIGURATION_IMPACT_RULES, GIT_GUARD_CONFIGURATION_IMPACT_RULES } from './curia-workflow.mjs';
import { GUARD_RUN_SCHEMA, guardObject as object, guardArray as array, guardText as text, guardPath as path, validateGuardBegin, validateGuardReceipt, deriveGuardTerminal } from './curia-guard-contract.mjs';

import { MULTI_GUARD_RUN_SCHEMA, MULTI_GUARD_GENERATOR, primaryGuardInput, guardInputObservationTimes } from './curia-guard-contract.mjs';

export const CONFIGURATION_CHECK_PLAN_SCHEMA = 'curia.check-plan/3';
export const CONFIGURATION_CHECK_RUN_SCHEMA = 'curia.check-run/3';
export const CONFIGURATION_CHECK_GENERATOR = 'curia-checks/3';
export const MULTI_CHECK_PLAN_SCHEMA = 'curia.check-plan/2';
export const MULTI_CHECK_RUN_SCHEMA = 'curia.check-run/2';
export const MULTI_CHECK_GENERATOR = 'curia-checks/2';
export const CHECK_PLAN_SCHEMA = 'curia.check-plan/1';
export const CHECK_RUN_SCHEMA = 'curia.check-run/1';
export const CHECK_GENERATOR = 'curia-checks/1';
export const CHECK_LIMITS = Object.freeze({ guards: 16, impactObservations: 35, guardObservations: 64, timeoutMs: 3600000, maxOutputBytes: 16 * 1024 * 1024, maxFiles: 4096, maxTotalBytes: 256 * 1024 * 1024 });
export const checkFail = message => { throw new Error(`${message} [checks/contract]`); };
export const checkEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const checkDigest = (value, canonicalization) => ({ algorithm: 'sha256', canonicalization, value: createHash('sha256').update(JSON.stringify(value)).digest('hex') });
const digest = (v, canonicalization = 'raw-bytes/1') => { object(v, ['algorithm', 'canonicalization', 'value']); if (v.algorithm !== 'sha256' || v.canonicalization !== canonicalization || !/^[0-9a-f]{64}$/.test(v.value)) checkFail('摘要身份非法'); };
const instant = v => { if (typeof v !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString() !== v) checkFail('观察时点非法'); };
const paths = (v, root = false) => { array(v, 'paths'); for (const p of v) path(p, root); if (new Set(v).size !== v.length) checkFail('路径重复'); };
const strings = v => { array(v, 'strings'); for (const s of v) text(s, 'string'); if (new Set(v).size !== v.length) checkFail('文本重复'); };
const contains = (prefix, p) => prefix === '.' || p === prefix || p.startsWith(`${prefix}/`);
export const guardMatches = (adapter, p) => adapter.inputScope.paths.some(prefix => contains(prefix, p)) && !adapter.inputScope.exclusions.some(prefix => contains(prefix, p)) && p !== '.agents/doc-types.json';

/** Only observation clocks and counts of excluded/out-of-scope objects are non-identities.
 * Explicit validity instants, source revisions, parser/rule versions, privacy, limits and graph reasons remain. */
export function impactObservationIdentity(report) {
  const view = structuredClone(report);
  const stripClock = v => {
    if (!v || typeof v !== 'object') return;
    if (!Array.isArray(v)) delete v.observedAt;
    for (const item of Object.values(v)) stripClock(item);
  };
  stripClock(view);
  if (view.input?.source?.evaluation?.source === 'generated-at') delete view.input.source.evaluation.at;
  if (view.input?.selection) { delete view.input.selection.discovered; delete view.input.selection.excluded; }
  if (view.input?.privacy) delete view.input.privacy.excluded;
  // These are counts outside the authorized selection, not input evidence or revision identities.
  if (view.changeObservation?.omitted) delete view.changeObservation.omitted.excluded;
  return checkDigest(view, 'curia.impact-observation/1');
}
export function checkBudgets(checks) {
  const active = checks.filter(c => c.guard);
  return { limits: CHECK_LIMITS, commands: active.length, impactObservations: 3 + 2 * active.length, guardObservations: 4 * active.length, ...Object.fromEntries(['timeoutMs', 'maxOutputBytes', 'maxFiles', 'maxTotalBytes'].map(key => [key, active.reduce((sum, c) => sum + c.guard.adapter.limits[key], 0)])), cleanupAllowanceMs: active.reduce((sum, c) => sum + c.guard.adapter.limits.killGraceMs + 2000, 0), enforcement: 'bounded-observation-count-and-per-command-supervision-not-hard-total-runtime-or-memory' };
}
export function checkCoverage(targets, checks) {
  const assignments = targets.map(p => ({ path: p, checks: checks.filter(c => (c.guard && primaryGuardInput(c.guard.inputSnapshot).documents.some(d => d.path === p && d.state !== 'sensitive-metadata-only')) && c.matchedPaths.includes(p)).map(c => c.id) }));
  const uncovered = assignments.filter(a => !a.checks.length).map(a => a.path);
  return { basis: 'declared-input-scope-not-rule-completeness', targets, assignments, uncovered, complete: targets.length > 0 && !uncovered.length };
}
export function guardResult(check, receipt, endedAt) {
  return deriveGuardTerminal([{ data: { kind: 'begin', payload: check.guard } }, { data: { kind: 'command', payload: receipt } }], endedAt);
}
export function validateCheckBegin(p) {
  object(p, ['schema', 'executionMode', 'inputSnapshot', 'planDigest', 'checks', 'coverage', 'budgets', 'risks', 'unresolved', 'codeIdentity', 'references']);
  const multi = p.schema === MULTI_CHECK_RUN_SCHEMA, configured = p.schema === CONFIGURATION_CHECK_RUN_SCHEMA;
  if ((!multi && !configured && p.schema !== CHECK_RUN_SCHEMA) || p.executionMode !== 'impact-checks') checkFail('未知检查批次 schema / mode');
  digest(p.planDigest, configured ? CONFIGURATION_CHECK_PLAN_SCHEMA : multi ? MULTI_CHECK_PLAN_SCHEMA : CHECK_PLAN_SCHEMA);
  const input = p.inputSnapshot;
  object(input, ['source', 'configuration', 'gitIndexDigest', 'impact', ...(multi || configured ? ['impactScope'] : [])]);
  if ((multi || configured) && input.impactScope !== 'primary-repository-only') checkFail('多仓检查不能冒充跨仓影响图'); digest(input.gitIndexDigest);
  object(input.source, ['mode', 'git']); object(input.source.git, ['root', 'head', 'repositoryCount']); text(input.source.git.root, 'root');
  if (input.source.mode !== 'current-worktree' || !input.source.git.root.startsWith('/') || input.source.git.repositoryCount !== 1 || (input.source.git.head !== null && !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(input.source.git.head))) checkFail('仅支持单仓真实工作树');
  object(input.configuration, ['registry', 'generator', 'identity']); digest(input.configuration.registry);
  if (input.configuration.generator !== (configured ? CONFIGURATION_CHECK_GENERATOR : multi ? MULTI_CHECK_GENERATOR : CHECK_GENERATOR) || input.configuration.identity !== 'on-disk-code-not-loaded-module-attestation') checkFail('配置身份非法');
  const impact = input.impact;
  object(impact, ['identity', 'scope', 'targets', 'sources', 'checks', 'complete', 'outcome']); digest(impact.identity, 'curia.impact-observation/1'); paths(impact.targets);
  object(impact.scope, ['changed', 'within', 'exclusions', 'changesWithin', 'configuration', 'changeBasis', 'nonSensitive', 'globalCoverage', ...(configured ? ['configurationSchema'] : [])]);
  if (configured && (!['only', 'include'].includes(impact.scope.configuration) || !['curia.configuration-dependencies/2', 'curia.configuration-dependencies/3'].includes(impact.scope.configurationSchema))) checkFail('配置批次必须绑定版本化的配置依赖投影');
  for (const field of ['changed', 'within', 'exclusions', 'changesWithin']) paths(impact.scope[field], field !== 'changed');
  if (!impact.scope.within.length || ![null, 'include', 'only'].includes(impact.scope.configuration) || impact.scope.nonSensitive !== true || impact.scope.globalCoverage !== false || !['caller-declared-paths-not-git-diff-or-deletion-proof', 'explicit-local-git-and-raw-worktree'].includes(impact.scope.changeBasis)) checkFail('影响范围不能扩大授权或声称全局覆盖');
  array(impact.sources, 'sources');
  for (const source of impact.sources) {
    object(source, ['uri', 'revision', 'locator', 'observedAt']); text(source.uri, 'source uri');
    if (!source.uri.startsWith('repo:')) checkFail('影响来源仅支持本地显式观察'); path(source.uri.slice(5)); digest(source.revision); instant(source.observedAt);
    object(source.locator, ['kind']); if (source.locator.kind !== 'whole-file/1') checkFail('影响来源必须是完整文件身份');
  }
  if (new Set(impact.sources.map(s => s.uri)).size !== impact.sources.length) checkFail('来源重复');
  array(impact.checks, 'impact checks', 8);
  for (const c of impact.checks) { object(c, ['id', 'version', 'state']); text(c.id, 'rule id'); if (!c.id.startsWith('curia-impact/') || !Number.isSafeInteger(c.version) || c.version < 1 || !['pass', 'not-applicable'].includes(c.state)) checkFail('影响检查未完整'); }
  const guardConfiguration = configured && impact.scope.configurationSchema === 'curia.configuration-dependencies/3';
  const contracts = guardConfiguration ? impact.scope.changeBasis === 'explicit-local-git-and-raw-worktree' ? GIT_GUARD_CONFIGURATION_IMPACT_RULES : GUARD_CONFIGURATION_IMPACT_RULES : configured ? impact.scope.changeBasis === 'explicit-local-git-and-raw-worktree' ? GIT_MOVE_CONFIGURATION_IMPACT_RULES : MOVE_CONFIGURATION_IMPACT_RULES : impact.scope.configuration ? impact.scope.changeBasis === 'explicit-local-git-and-raw-worktree' ? GIT_CONFIGURATION_IMPACT_RULES : CONFIGURATION_IMPACT_RULES : impact.scope.changeBasis === 'explicit-local-git-and-raw-worktree' ? GIT_IMPACT_RULES : IMPACT_RULES;
  if (!checkEqual(impact.checks, contracts.map(c => ({ id: c.id, version: c.version, state: c.id === 'curia-impact/inspection' && impact.scope.configuration === 'only' ? 'not-applicable' : 'pass' })))) checkFail('影响规则缺失、被替换或混用版本');
  if (impact.complete !== true || impact.outcome !== 'impact-planned' || !impact.targets.length || !impact.checks.length || new Set(impact.checks.map(c => c.id)).size !== impact.checks.length) checkFail('不完整或空影响不能进入批次执行');
  array(p.checks, 'checks', CHECK_LIMITS.guards); if (!p.checks.length || new Set(p.checks.map(c => c.id)).size !== p.checks.length) checkFail('检查选择为空或重复');
  for (const c of p.checks) {
    object(c, ['id', 'state', 'matchedPaths', 'guard']); if (typeof c.id !== 'string' || !/^[a-z][a-z0-9-]{0,79}$/.test(c.id)) checkFail('检查 ID 非法'); paths(c.matchedPaths);
    if (c.matchedPaths.some(p => !impact.targets.includes(p))) checkFail('检查覆盖越出候选集');
    if (c.guard === null) { if (c.state !== 'not-applicable' || c.matchedPaths.length) checkFail('匹配检查不得隐藏为不适用'); continue; }
    if (c.state !== 'selected' || !c.matchedPaths.length || ![GUARD_RUN_SCHEMA, ...(multi || configured ? [MULTI_GUARD_RUN_SCHEMA] : [])].includes(c.guard.schema) || c.guard.adapterId !== c.id) checkFail('检查 guard 身份非法或隐私合同降级');
    validateGuardBegin(c.guard);
    const primary = primaryGuardInput(c.guard.inputSnapshot);
    if (!c.guard.inputSnapshot.coverage.complete || !primary.documents.length || primary.environment.some(e => e.present) || c.guard.unresolved.length || c.guard.references.corrects !== null || c.guard.references.retriedFrom !== null) checkFail('未知输入、继承环境值、空检查或嵌套引用不能执行');
    if (!checkEqual(c.matchedPaths, impact.targets.filter(p => guardMatches(c.guard.adapter, p))) || !checkEqual(primary.configuration.registry, input.configuration.registry) || !checkEqual(primary.gitIndexDigest, input.gitIndexDigest) || !checkEqual(primary.source.git, input.source.git)) checkFail('检查与影响不属于同一配置、Git 或声明范围');
  }
  if (multi && !p.checks.some(c => c.guard?.schema === MULTI_GUARD_RUN_SCHEMA)) checkFail('多仓批次必须有实际选中的多仓 guard');
  if (!checkEqual(p.coverage, checkCoverage(impact.targets, p.checks)) || !p.coverage.complete) checkFail('未覆盖候选不能冒充通过');
  if (!checkEqual(p.budgets, checkBudgets(p.checks)) || !p.budgets.commands || Object.keys(CHECK_LIMITS).some(k => k !== 'guards' && p.budgets[k] > CHECK_LIMITS[k])) checkFail('批次预算超限或被篡改');
  strings(p.risks); if (!p.risks.includes('declared-coverage-not-business-or-rule-completeness') || p.checks.some(c => c.guard?.risks.some(r => !p.risks.includes(r)))) checkFail('不能隐去风险');
  array(p.unresolved, 'unresolved', 0);
  array(p.codeIdentity, 'codeIdentity', 32); if (!p.codeIdentity.length || new Set(p.codeIdentity.map(c => c.file)).size !== p.codeIdentity.length) checkFail('代码身份缺失或重复');
  for (const c of p.codeIdentity) { object(c, ['file', 'digest']); path(c.file); digest(c.digest); }
  object(p.references, ['corrects', 'retriedFrom']);
  for (const ref of Object.values(p.references)) if (ref !== null && (typeof ref !== 'string' || !/^r-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(ref))) checkFail('引用必须是真实 Run ID');
  if (p.references.corrects && p.references.corrects === p.references.retriedFrom) checkFail('更正与重试引用重复');
}
export function validateCheckReceipt(payload, begin, previous) {
  object(payload, ['checkId', 'receipt']);
  const selected = begin.checks.filter(c => c.guard), next = selected[previous.length];
  if (!next || next.id !== payload.checkId || previous.some((p, i) => guardResult(selected[i], p.receipt, p.receipt.endedAt).status !== 'passed')) checkFail('检查必须顺序、唯一、失败即停；不能跳过或补写成功');
  validateGuardReceipt(payload.receipt, next.guard);
  if (previous.length && payload.receipt.startedAt < previous.at(-1).receipt.endedAt) checkFail('串行检查不能时间重叠');
}
export function checkObservationTimes(begin) {
  return [...begin.inputSnapshot.impact.sources.map(s => s.observedAt), ...begin.checks.flatMap(c => c.guard ? guardInputObservationTimes(c.guard.inputSnapshot) : [])];
}
export function deriveCheckTerminal(events, endedAt, drift = []) {
  strings(drift);
  const begin = events[0].data.payload, commands = events.filter(e => e.data.kind === 'command').map(e => e.data.payload);
  const checks = begin.checks.map(c => {
    const actual = commands.find(p => p.checkId === c.id);
    return { id: c.id, state: actual ? guardResult(c, actual.receipt, endedAt).status : c.guard ? 'skipped' : 'not-applicable', result: actual ? guardResult(c, actual.receipt, endedAt) : null };
  });
  const failure = checks.find(c => c.result && c.state !== 'passed');
  const status = failure?.state ?? (drift.length || checks.some(c => c.state === 'skipped') ? 'incomplete' : checks.some(c => c.state === 'passed') ? 'passed' : 'incomplete');
  return { status, terminal: true, endedAt, exitCode: { passed: 0, failed: 1, blocked: 1, incomplete: 2, 'timed-out': 124, cancelled: 130, 'resource-limit': 125, interrupted: 1 }[status], checks, drift, risks: begin.risks, coverage: begin.coverage, businessOutcome: 'not-evaluated', evidenceCompleteness: { scope: 'declared-current-review-candidates-only', execution: 'local-recorder-not-attestation', facts: 'not-verified' }, unresolved: [...checks.filter(c => c.state === 'skipped').map(c => ({ code: 'check-skipped', checkId: c.id })), ...drift.map(path => ({ code: 'batch-input-changed', path }))], outputs: [] };
}
