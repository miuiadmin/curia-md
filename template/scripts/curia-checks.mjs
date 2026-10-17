#!/usr/bin/env node
/** Explicit impact -> selected guard -> one append-only Run. No discovery-driven command execution. */
import { resolve } from 'node:path';
import { ROOT, isMainModule } from './doc-lib.mjs';
import { parseRegistryJson } from './curia-query.mjs';
import { normalizeInstance } from './curia-instance.mjs';
import { buildImpactWorkflow, normalizeImpactOptions, parseImpactArgs } from './curia-workflow.mjs';
import { buildGuardPlan, reobserveGuardPlan, executeCheckGuard, guardRunSchema } from './curia-guards.mjs';
import { MULTI_GUARD_RUN_SCHEMA, MULTI_GUARD_SCHEMA, primaryGuardInput, normalizeRepositoryRequest } from './curia-guard-contract.mjs';
import { loadRecordStore, recordReadBoundary, rawDigest, recordCodeIdentity, RECORD_LIMITS, beginCheckRecord, appendCheckReceipt, finishCheckRecord } from './curia-records.mjs';
import { CONFIGURATION_CHECK_PLAN_SCHEMA, CONFIGURATION_CHECK_RUN_SCHEMA, CONFIGURATION_CHECK_GENERATOR, MULTI_CHECK_PLAN_SCHEMA, MULTI_CHECK_RUN_SCHEMA, MULTI_CHECK_GENERATOR, CHECK_PLAN_SCHEMA, CHECK_RUN_SCHEMA, CHECK_GENERATOR, CHECK_LIMITS, checkFail, checkEqual, checkDigest, impactObservationIdentity, guardMatches, checkCoverage, checkBudgets, guardResult, validateCheckBegin } from './curia-check-contract.mjs';

const plans = new WeakMap();
const contains = (prefix, path) => prefix === '.' || prefix === path || path.startsWith(`${prefix}/`);
const overlap = (a, b) => contains(a, b) || contains(b, a);
function separateOutput(scope, exclusions, store) {
  if (store && scope.some(p => overlap(p, store) && !exclusions.some(e => contains(e, store) || contains(e, p)))) checkFail('recordStore 与读取范围相交；显式排除记录目录，不隐式缩小输入范围');
}
function contextIdentity(ctx) {
  return { root: ctx.root, head: ctx.head, registry: ctx.registryDigest, index: rawDigest(ctx.indexRaw), boundary: checkDigest({ root: [ctx.rootStat.dev, ctx.rootStat.ino], mounts: ctx.mounts }, 'curia.local-boundary/1'), codeIdentity: recordCodeIdentity('impact-checks') };
}
function checkContext(root, identity, boundary) {
  if (!checkEqual(recordCodeIdentity('impact-checks'), identity.codeIdentity)) checkFail('代码身份漂移；不重新读取来源');
  if (!checkEqual(contextIdentity(loadRecordStore(root, { expectedBoundary: boundary })), identity)) checkFail('配置、代码、Git 或实例边界漂移；不按新配置扩大读取或执行');
}
const guardBegin = plan => ({ schema: guardRunSchema(plan), executionMode: 'guard-command', adapterId: plan.adapterId, adapter: plan.adapter, inputSnapshot: plan.inputSnapshot, planDigest: plan.digest, risks: plan.risks, unresolved: plan.inputSnapshot.coverage.complete ? [] : [{ code: 'sensitive-input-not-snapshotted', reason: '敏感原件没有可比对内容身份' }], codeIdentity: plan.codeIdentity, references: { corrects: null, retriedFrom: null } });
const beginPayload = (plan, references = { corrects: null, retriedFrom: null }) => ({ schema: plan.schema === CONFIGURATION_CHECK_PLAN_SCHEMA ? CONFIGURATION_CHECK_RUN_SCHEMA : plan.schema === MULTI_CHECK_PLAN_SCHEMA ? MULTI_CHECK_RUN_SCHEMA : CHECK_RUN_SCHEMA, executionMode: 'impact-checks', inputSnapshot: plan.inputSnapshot, planDigest: plan.digest, checks: plan.checks, coverage: plan.coverage, budgets: plan.budgets, risks: plan.risks, unresolved: [], codeIdentity: plan.codeIdentity, references });
function impactSnapshot(report) {
  return { identity: impactObservationIdentity(report), scope: { changed: report.scope.changed, within: report.scope.within, exclusions: report.scope.exclusions, changesWithin: report.scope.changesWithin ?? [], configuration: report.scope.configuration ?? null, ...(report.scope.configurationSchema ? { configurationSchema: report.scope.configurationSchema } : {}), changeBasis: report.scope.changeBasis, nonSensitive: true, globalCoverage: false }, targets: report.impact?.reviewPaths ?? [], sources: report.sourceRefs, checks: report.checks.map(({ id, version, state }) => ({ id, version, state })), complete: report.complete, outcome: report.outcome };
}
export function buildCheckPlan(root = ROOT, input = {}, guardIds = [], repositoryOptions = {}) {
  const repositoryRequest = normalizeRepositoryRequest(repositoryOptions);
  if (!Array.isArray(guardIds) || !guardIds.length || guardIds.length > CHECK_LIMITS.guards || new Set(guardIds).size !== guardIds.length || guardIds.some(id => typeof id !== 'string' || !/^[a-z][a-z0-9-]{0,79}$/.test(id))) checkFail('需要有限、非空、不重复的显式 guard 顺序');
  if (Object.hasOwn(input, 'now') || Object.hasOwn(input, 'inventoryOnly')) checkFail('检查计划不接受替代时钟或仅盘点模式；先独立运行 impact 盘点');
  const normalized = normalizeImpactOptions(input);
  const request = { changed: normalized.changed, within: normalized.selection.paths, exclusions: normalized.selection.exclusions, nonSensitive: true, includeUntracked: normalized.includeUntracked ?? false, limits: normalized.limits, ...(normalized.at !== undefined ? { at: normalized.at } : {}), ...(normalized.configuration ? { configuration: normalized.configuration } : {}), ...(normalized.changeOptions ? { gitBase: normalized.gitBase, changesWithin: normalized.changeOptions.within, changeLimits: normalized.changeLimits } : {}) };
  const ctx = loadRecordStore(root), context = contextIdentity(ctx), boundary = recordReadBoundary(ctx);
  if (!ctx.hasGit) checkFail('批次检查需要显式单仓 Git 边界');
  const registry = parseRegistryJson(new TextDecoder('utf-8', { fatal: true }).decode(ctx.registryBytes)), instance = normalizeInstance(registry.instance, registry.types);
  for (const id of guardIds) if (!instance.guards?.[id]) checkFail('选择了未登记 guard；不从正文发现或执行命令');
  separateOutput(request.within, request.exclusions, ctx.store?.path);
  separateOutput(request.changesWithin ?? [], request.exclusions, ctx.store?.path);
  if (ctx.store && request.changed.some(p => contains(ctx.store.path, p))) checkFail('记录输出不能作为同批变更输入');
  for (const id of guardIds) for (const sensitive of instance.guards[id].privacy.sensitivePaths) {
    if ([...request.within, ...(request.changesWithin ?? []), ...request.changed].some(p => overlap(p, sensitive) && !request.exclusions.some(e => contains(e, p) || contains(e, sensitive)))) checkFail('已声明敏感路径与影响扫描授权相交；先显式排除，不能用 non-sensitive 覆盖隐私声明');
  }
  const impact = buildImpactWorkflow(ctx.root, request), targets = impact.impact?.reviewPaths ?? [], guardPlans = new Map();
  const matching = guardIds.filter(id => targets.some(p => guardMatches(instance.guards[id], p)));
  const requiredIds = new Set(matching.flatMap(id => instance.guards[id].repositoryInputs?.map(r => r.id) ?? []));
  if (repositoryRequest.repositories.length !== requiredIds.size || repositoryRequest.repositories.some(r => !requiredIds.has(r.id))) checkFail('只绑定实际选中 guard 的必需仓库，不探测未选择成员');
  for (const key of ['timeoutMs', 'maxOutputBytes', 'maxFiles', 'maxTotalBytes']) if (matching.reduce((sum, id) => sum + instance.guards[id].limits[key], 0) > CHECK_LIMITS[key]) checkFail('所选检查的合计预算超限；拆成更小批次，不先读取超预算输入');
  const checks = guardIds.map(id => {
    const adapter = instance.guards[id], matchedPaths = targets.filter(p => guardMatches(adapter, p));
    if (!matchedPaths.length) return { id, state: 'not-applicable', matchedPaths, guard: null };
    separateOutput(adapter.inputScope.paths, adapter.inputScope.exclusions, ctx.store?.path);
    checkContext(root, context, boundary);
    const repositories = repositoryRequest.repositories.filter(r => adapter.repositoryInputs?.some(p => p.id === r.id));
    const plan = buildGuardPlan(root, id, { expectedBoundary: boundary, expectedCodeIdentity: context.codeIdentity.filter(c => c.file !== 'curia-checks.mjs'), repositories, repositoriesNonSensitive: repositories.length ? repositoryRequest.repositoriesNonSensitive : false }); guardPlans.set(id, plan);
    return { id, state: 'selected', matchedPaths, guard: guardBegin(plan) };
  });
  checkContext(root, context, boundary);
  const after = buildImpactWorkflow(ctx.root, request);
  checkContext(root, context, boundary);
  if (!checkEqual(impactObservationIdentity(impact), impactObservationIdentity(after))) checkFail('计划各阶段影响输入漂移，撤回整组计划');
  const coverage = checkCoverage(targets, checks), budgets = checkBudgets(checks);
  const unresolved = [...(!impact.complete ? [{ code: 'impact-incomplete', reason: '影响图、来源或扫描范围仍有缺口' }] : []), ...coverage.uncovered.map(path => ({ code: 'candidate-uncovered', path })), ...checks.filter(c => c.guard && (!c.guard.inputSnapshot.coverage.complete || !primaryGuardInput(c.guard.inputSnapshot).documents.length)).map(c => ({ code: 'check-input-incomplete', checkId: c.id })), ...checks.filter(c => c.guard && primaryGuardInput(c.guard.inputSnapshot).environment.some(e => e.present)).map(c => ({ code: 'check-environment-identity-unknown', checkId: c.id, reason: '已继承环境值不持久化或摘要，不能称为可比较输入' })), ...(!ctx.store ? [{ code: 'record-store-required', reason: '执行需要显式记录绑定；plan 不启用配置' }] : [])];
  const noChecks = !targets.length || !matching.length;
  if (noChecks) unresolved.push({ code: 'no-applicable-checks', reason: '有效检查集为空；不执行，不产生 passed Run' });
  const risks = [...new Set(['declared-coverage-not-business-or-rule-completeness', 'sequential-reobservation-not-cross-revision-cache', 'supervisor-loss-not-recoverable-automatically', ...checks.flatMap(c => c.guard?.risks ?? [])])];
  const multi = checks.some(c => c.guard?.schema === MULTI_GUARD_RUN_SCHEMA), configured = !!request.configuration;
  const plan = { schema: configured ? CONFIGURATION_CHECK_PLAN_SCHEMA : multi ? MULTI_CHECK_PLAN_SCHEMA : CHECK_PLAN_SCHEMA, root: ctx.root, allowlist: [...guardIds], request, impact, inputSnapshot: { ...(multi || configured ? { impactScope: 'primary-repository-only' } : {}), source: { mode: 'current-worktree', git: { root: ctx.root, head: ctx.head, repositoryCount: 1 } }, configuration: { registry: ctx.registryDigest, generator: configured ? CONFIGURATION_CHECK_GENERATOR : multi ? MULTI_CHECK_GENERATOR : CHECK_GENERATOR, identity: 'on-disk-code-not-loaded-module-attestation' }, gitIndexDigest: rawDigest(ctx.indexRaw), impact: impactSnapshot(impact) }, checks, coverage, budgets, risks, unresolved, codeIdentity: context.codeIdentity, recordStore: ctx.store?.path ?? null, readiness: !targets.length && impact.complete ? 'not-applicable' : unresolved.length ? 'blocked' : 'ready', persisted: false, commandExecuted: false };
  plan.digest = checkDigest({ schema: plan.schema, root: plan.root, allowlist: plan.allowlist, request, context, impact: plan.inputSnapshot.impact.identity, checks: checks.map(c => ({ id: c.id, state: c.state, matchedPaths: c.matchedPaths, digest: c.guard?.planDigest ?? null })), coverage, budgets, risks, unresolved, recordStore: plan.recordStore }, plan.schema);
  if (Buffer.byteLength(JSON.stringify(beginPayload(plan)), 'utf8') > RECORD_LIMITS.eventBytes - 1024) checkFail('批次 begin 超出事件预算；缩小选集，不写入截断记录');
  if (plan.readiness === 'ready') validateCheckBegin(beginPayload(plan));
  plans.set(plan, { snapshot: structuredClone(plan), context, boundary, guardPlans, requestedRoot: resolve(root) }); return plan;
}
export async function runChecks(root, input, guardIds, expectedPlan, { signal, corrects = null, retriedFrom = null, repositories = [], repositoriesNonSensitive = false } = {}) {
  if (typeof expectedPlan !== 'string' || !/^[0-9a-f]{64}$/.test(expectedPlan)) checkFail('run 必须显式确认完整 plan 摘要');
  const view = buildCheckPlan(root, input, guardIds, { repositories, repositoriesNonSensitive }), saved = plans.get(view), plan = saved.snapshot;
  if (plan.digest.value !== expectedPlan) checkFail('确认摘要不匹配；重新审阅输入、effects、privacy 和风险');
  if (plan.readiness !== 'ready') checkFail('计划没有可完整执行的检查集；缺口或不适用不等于通过');
  const { capability, run: begun } = beginCheckRecord(saved.requestedRoot, beginPayload(plan, { corrects, retriedFrom }), saved.boundary);
  try {
    const observeImpact = () => {
      checkContext(saved.requestedRoot, saved.context, saved.boundary);
      const current = buildImpactWorkflow(plan.root, plan.request);
      checkContext(saved.requestedRoot, saved.context, saved.boundary);
      if (!current.complete || !checkEqual(impactObservationIdentity(current), plan.inputSnapshot.impact.identity)) checkFail('批次影响输入漂移');
    };
    for (const check of plan.checks.filter(c => c.guard)) {
      let skipReason = null;
      try { observeImpact(); } catch { skipReason = 'plan-changed'; }
      const { handle, inputDrift } = await executeCheckGuard(saved.guardPlans.get(check.id), capability, { signal, skipReason });
      try { observeImpact(); } catch { inputDrift.push('$impact/observation'); }
      const run = appendCheckReceipt(capability, handle, inputDrift), actual = run.commands.at(-1);
      if (guardResult(check, actual.receipt, actual.receipt.endedAt).status !== 'passed') break;
    }
    const drift = [];
    for (const check of plan.checks.filter(c => c.guard)) {
      try { checkContext(saved.requestedRoot, saved.context, saved.boundary); if (reobserveGuardPlan(saved.guardPlans.get(check.id)).digest.value !== check.guard.planDigest.value) drift.push(`$guard/${check.id}`); }
      catch { drift.push(`$guard/${check.id}`); }
    }
    try { observeImpact(); } catch { drift.push('$impact/observation'); }
    return finishCheckRecord(capability, drift);
  } catch {
    const error = new Error(`检查执行或记录状态不可确认；先核对 ${begun.runId}，不自动重跑未知效果 [checks/run-unresolved]`);
    error.runId = begun.runId; throw error;
  }
}
export function parseCheckArgs(argv) {
  if (argv.length === 1 && argv[0] === '--help') return { command: 'help' };
  const command = argv[0]; if (!['plan', 'run'].includes(command)) checkFail('命令必须是 plan / run');
  const guards = [], rest = [], options = {}, repositories = []; let repositoriesNonSensitive = false;
  for (let i = 1; i < argv.length; i++) {
    const key = argv[i];
    if (key === '--repo') { const value = argv[++i]; if (!value || Buffer.byteLength(value) > 65536) checkFail('仓库绑定缺值或超限'); repositories.push(parseRegistryJson(value)); }
    else if (key === '--repositories-non-sensitive') { if (repositoriesNonSensitive) checkFail('重复的多仓隐私声明'); repositoriesNonSensitive = true; }
    else if (['--guard', '--confirm', '--corrects', '--retried-from'].includes(key)) {
      const value = argv[++i]; if (!value || value.startsWith('--') || (key !== '--guard' && (command !== 'run' || Object.hasOwn(options, key)))) checkFail('检查参数缺值、重复或不适用');
      if (key === '--guard') guards.push(value); else options[key] = value;
    } else if (['--inventory', '--list-checks', '--help'].includes(key)) checkFail('检查计划不接受仅盘点或规则列表；使用独立 impact 入口');
    else rest.push(key);
  }
  if (!guards.length || new Set(guards).size !== guards.length || guards.length > CHECK_LIMITS.guards) checkFail('guard allowlist 为空、重复或超限');
  if (command === 'run' && !/^[0-9a-f]{64}$/.test(options['--confirm'] ?? '')) checkFail('run 缺少确认摘要');
  const parsed = parseImpactArgs(rest);
  return { command, guards, input: parsed.options, flags: parsed.flags, options, repositoryOptions: normalizeRepositoryRequest({ repositories, repositoriesNonSensitive }) };
}
if (isMainModule(import.meta.url)) {
  const controller = new AbortController(), cancel = () => controller.abort();
  try {
    const args = parseCheckArgs(process.argv.slice(2));
    if (args.command === 'help') console.log('curia-checks — explicit sequential impact checks\nplan --guard <id> [--guard <id> ...] <impact selection> --json\nrun  --guard <id> [--guard <id> ...] <same selection> --confirm <digest> --json\nFor selected curia.guard/2 checks, repeat --repo {"id":"lib","root":"/absolute/path"} and --repositories-non-sensitive on both plan and run; bind only selected roles. Impact remains primary-repository-only. Use impact --within/--changed or --git-base/--changes-within, --non-sensitive and budgets. Explicitly exclude recordStore from overlapping input scopes. Commands need registered guards and an enabled recordStore; plan never executes or persists. One Run, fail-fast, no sandbox, cache, business approval or automatic recovery.');
    else {
      process.on('SIGINT', cancel); process.on('SIGTERM', cancel);
      const result = args.command === 'plan' ? buildCheckPlan(args.flags.root, args.input, args.guards, args.repositoryOptions) : await runChecks(args.flags.root, args.input, args.guards, args.options['--confirm'], { ...args.repositoryOptions, signal: controller.signal, corrects: args.options['--corrects'] ?? null, retriedFrom: args.options['--retried-from'] ?? null });
      console.log(args.flags.json ? JSON.stringify(result, null, 2) : args.command === 'plan' ? `${result.readiness}\nconfirm: ${result.digest.value}\nchecks: ${result.checks.map(c => `${c.id}:${c.state}`).join(', ')}\n${result.unresolved.map(g => g.code).join(', ')}` : `${result.runId} ${result.status}\n${result.result.checks.map(c => `${c.id}:${c.state}`).join(', ')}\nbusiness: not-evaluated`);
      process.exitCode = args.command === 'plan' ? result.readiness === 'ready' ? 0 : 2 : result.exitCode;
    }
  } catch (error) { console.error(`检查参数、确认、配置、快照或记录不可用；若已开始执行，先 show 核对 open Run，不自动重跑${/^r-[0-9a-f-]{36}$/.test(error.runId ?? '') ? `；run-id: ${error.runId}` : ''} [checks/operation-failed]`); process.exitCode = 2; }
  finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
}
