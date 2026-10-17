#!/usr/bin/env node
/**
 * Curia read workflow: explicit scope → paths → bounded verbatim context → static challenges.
 * Ephemeral stdout only. No subprocess guards, model calls, persistence, document writes or network.
 * The report is not a semantic answer, authenticated approval, tracked Run or facts verification.
 */
import { summarizeOriginals } from './curia-originals.mjs';
import { evaluationInstant } from './curia-applicability.mjs';
import { ROOT, isMainModule } from './doc-lib.mjs';
import { buildInventory, readInventorySelection, normalizeReadSelection, normalizeReadLimits, privateReadPath, readInventoryRelations, readInventoryConfiguration, buildImpactInventory, normalizeDependencySelection, readInventoryDependencies, normalizeGitChangeOptions, normalizeGitChangeLimits, prepareGitChangeSelection, observeGitChanges, revalidateGitChanges, revalidateReadInventory } from './curia-query.mjs';

import { planImpact, IMPACT_LIMITS } from './curia-impact.mjs';

export const WORKFLOW_SCHEMA = 'curia.read-workflow/1';
const workflowInputs = new WeakMap(), impactInputs = new WeakMap();
const plain = (value) => value && typeof value === 'object' && !Array.isArray(value) && [null, Object.prototype].includes(Object.getPrototypeOf(value)) && !Object.getOwnPropertySymbols(value).length;
const rule = (name, scope, onEmpty, required, positive, negative, version = 1) => Object.freeze({
  id: `curia-read/${name}`, version, owner: 'Curia workspace maintainer', scope,
  activation: 'explicit-local-read-workflow', onEmpty, required,
  verification: 'static-local-observation-not-semantic-verification',
  fixtures: Object.freeze({ file: 'scripts/self-test.mjs', positive, negative }),
});
// Version-one contracts remain readable; upgrades never reinterpret historical Runs.
export const READ_RULES_V1 = Object.freeze([
  rule('selection', 'explicit-selected-paths', 'fail', true, 'read-single', 'read-missing'),
  rule('boundary', 'declared-instance-and-selected-paths', 'fail', true, 'read-boundary', 'read-symlink'),
  rule('content', 'selected-non-excluded-documents', 'fail', true, 'read-single', 'read-truncated'),
  rule('metadata', 'selected-parsed-envelopes', 'not-applicable', false, 'read-metadata', 'read-conflict'),
  rule('snapshot', 'selected-inputs-registry-index-head-mounts', 'fail', true, 'read-stable', 'read-drift'),
  rule('variants', 'selected-variant-bindings', 'not-applicable', false, 'read-no-variants', 'read-variant-conflict'),
  rule('validity', 'selected-validity-bindings', 'not-applicable', false, 'read-no-validity', 'read-validity-unresolved'),
  rule('project-guards', 'external-project-guard-adapters', 'not-applicable', false, 'read-no-commands', 'read-options'),
]);
export const READ_RULES_V2 = Object.freeze(READ_RULES_V1.map((entry) => ['curia-read/content', 'curia-read/metadata'].includes(entry.id) ? Object.freeze({ ...entry, version: 2 }) : entry));
export const READ_RULES_V3 = Object.freeze(READ_RULES_V2.map((entry) => ['curia-read/content', 'curia-read/metadata'].includes(entry.id) ? Object.freeze({ ...entry, version: 3 }) : entry));
export const READ_RULES_V4 = Object.freeze([
  ...READ_RULES_V3.map((entry) => ['curia-read/content', 'curia-read/metadata'].includes(entry.id) ? Object.freeze({ ...entry, version: 4 }) : entry),
  rule('originals', 'selected-register-declarations-not-original-content', 'not-applicable', false, 'read-no-originals', 'read-originals-unread'),
]);
// Version 5 already identifies the historical dependency metadata check; never reuse that identity.
export const READ_RULES = Object.freeze(READ_RULES_V4.map(entry => entry.id === 'curia-read/metadata' ? Object.freeze({ ...entry, version: 6 }) : entry));
export const READ_RULE_SETS = Object.freeze([READ_RULES_V1, READ_RULES_V2, READ_RULES_V3, READ_RULES_V4, READ_RULES]);


// The opt-in scope has its own contracts. Ordinary reads and historical Run contracts stay unchanged.
export const DEPENDENCY_READ_RULES = Object.freeze([
  ...READ_RULES.map(entry => {
    const negative = { selection: 'seed-missing', boundary: 'authorized-symlink-still-blocked', content: 'prefix-not-used-for-dependency-discovery', metadata: 'status-conflict-projected', snapshot: 'later-hop-rechecks-previous-inputs' }[entry.id.slice('curia-read/'.length)];
    return negative ? Object.freeze({ ...entry, version: entry.version + 1, scope: 'explicit-authorized-dependency-closure', fixtures: { file: 'scripts/curia-dependencies-self-test.mjs', positive: 'dependency-chain', negative } }) : entry;
  }),
  Object.freeze({ ...rule('dependencies', 'explicit-authorized-declared-relations', 'fail', true, 'dependency-chain', 'dependency-outside-scope'), activation: 'explicit-local-dependency-workflow', fixtures: { file: 'scripts/curia-dependencies-self-test.mjs', positive: 'dependency-chain', negative: 'dependency-outside-scope' } }),
]);

function buildCheck(id, state, reason, count, contracts = READ_RULES) {
  const contract = contracts.find((item) => item.id === `curia-read/${id}`);
  return { ...contract, state, reason, count };
}

export function buildReadWorkflow(root = ROOT, options = {}) {
  const keys = ['selection', 'limits', 'includeUntracked', 'at', 'now', 'inventoryOnly', 'dependencies'];
  if (!plain(options) || Object.keys(options).some((key) => !keys.includes(key)) || ['includeUntracked', 'inventoryOnly'].some((key) => options[key] !== undefined && typeof options[key] !== 'boolean') || (options.now !== undefined && !['string', 'function'].includes(typeof options.now))) throw new Error('workflow 选项非法；不接受执行命令、外访或写入授权 [curia2/workflow-options-invalid]');
  const selection = normalizeReadSelection(options.selection);
  const limits = normalizeReadLimits(options.limits);
  const dependencies = options.dependencies === undefined ? null : normalizeDependencySelection(selection, options.dependencies);
  const check = (...args) => buildCheck(...args, dependencies ? DEPENDENCY_READ_RULES : READ_RULES);
  const inventory = buildInventory(root, null, { includeUntracked: options.includeUntracked ?? false, readMetadata: false, selection: dependencies?.selection ?? selection, at: options.at, now: options.now });
  if (options.inventoryOnly) return {
    schema: WORKFLOW_SCHEMA, generator: 'curia-read-workflow/1', mode: 'inventory-only', generatedAt: inventory.generatedAt,
    execution: { mode: 'ephemeral-read-only', persisted: false, effects: ['local-path-observation', 'registry-read'], output: 'stdout', receiverCompleteness: 'not-observed' },
    input: inventory.input, instance: inventory.instance,
    ...(dependencies ? { dependencies: { authorization: dependencies.authorization, seeds: selection, state: 'not-read', complete: false, global: false } } : {}),
    documents: inventory.envelopes.map((env) => ({ path: env.identity.path, surface: env.identity.surface, format: env.format, tracked: env.tracked, state: 'not-read' })),
    coverage: { selected: inventory.envelopes.length, excluded: inventory.input.selection.excluded, contentRead: 0, factVerified: 0 },
    outcome: inventory.coverage.errors || inventory.input.selection.unmatched.length || !inventory.envelopes.length ? 'blocked' : 'inventoried-not-read',
    checks: [check('selection', inventory.input.selection.unmatched.length || !inventory.envelopes.length ? 'fail' : 'pass', '只盘点路径，空选集不通过', inventory.envelopes.length), check('boundary', inventory.coverage.errors ? 'fail' : 'pass', '声明面与路径边界检查', inventory.coverage.errors)],
    unresolved: [...inventory.input.pathFindings, { code: 'read-not-requested', path: null, reason: '只做路径盘点，正文、语义与事实均未读取或核验' }],
    limitations: ['local-single-reader-only', 'not-a-secret-detector', 'not-a-tracked-run'],
  };
  const read = dependencies ? readInventoryDependencies(inventory, selection, options.dependencies, limits) : readInventorySelection(inventory, limits);
  const docs = read.documents;
  const envelopes = docs.flatMap((doc) => doc.envelope ? [doc.envelope] : []);
  const metadataGaps = envelopes.flatMap((env) => env.gaps.map((code) => ({ code, path: env.identity.path, reason: '保留原件与解析缺口，不由摘要或默认值消除' })));
  const originals = summarizeOriginals(envelopes, docs);
  const originalGaps = originals.registered ? [{ code: 'read-originals-unread', path: null, reason: `登记表声明了 ${originals.registered} 份原件，未读取、解密或核实这些原件；登记表摘要不是原件摘要` }] : [];
  const representationGaps = envelopes.filter(env => env.representation?.kind && env.representation.kind !== 'original').map(env => ({ code: 'representation-unverified', path: env.identity.path, reason: '形态仅来自配置声明；来源、生成过程、导航完整性与外发回执未由本次阅读核验' }));
  const unresolved = [...read.source.pathFindings, ...read.findings, ...metadataGaps, ...originalGaps, ...representationGaps];
  const allRead = docs.length > 0 && read.stable && docs.every((doc) => doc.state === 'read' && doc.text?.length > 0);
  const conflicts = metadataGaps.filter((gap) => /(?:conflict|invalid|unexpected)$/.test(gap.code));
  const checks = [
    check('selection', !docs.length || read.selection.unmatched.length ? 'fail' : 'pass', '显式路径不得缺失；隐私排除优先，不回退全仓', docs.length),
    check('boundary', read.inventoryErrors ? 'fail' : 'pass', '输入仅来自当前实例，不跟随链接、挂载或嵌套仓库', read.inventoryErrors),
    check('content', allRead ? 'pass' : 'evidence-gap', '读取完成只说明原文已完整读入本次输出，不证明接收端未截断、语义正确或事实已核实', docs.filter((doc) => doc.state === 'read').length),
    check('metadata', !envelopes.length ? 'not-applicable' : conflicts.length ? 'fail' : metadataGaps.length ? 'evidence-gap' : 'pass', '类型、形态、效力、owner 与限制保留来源；形态声明与正文解析不赋予权威或事实效力', metadataGaps.length),
    check('snapshot', read.stable ? 'pass' : 'fail', '原件、Registry、Git 与挂载前后复核；不是原子文件系统快照', docs.length),
    check('variants', !read.variants.enabled ? 'not-applicable' : read.variants.conflicts ? 'fail' : 'evidence-gap', '只读选集不能证明未读同族不存在；选集内冲突仍报告', read.variants.objects),
    check('validity', !read.validity.enabled ? 'not-applicable' : read.validity.invalid ? 'fail' : read.validity.complete ? 'pass' : 'evidence-gap', '文档级时间视图独立于阅读与事实核验', read.validity.objects),
    check('originals', !originals.enabled || (!originals.registered && !originals.unresolvedRegisters) ? 'not-applicable' : 'evidence-gap', '只解释登记表；原件存在性、访问权限、正文、声明与事实均未核实，空登记表也不证明原件覆盖', originals.registered),
    check('project-guards', 'not-applicable', '本切片没有接入项目 guard；不会执行正文、链接、脚本或自动访问来源', 0),
  ];
  if (dependencies) checks.push(check('dependencies', read.closure.complete ? 'pass' : 'evidence-gap', '只闭合显式授权范围内的声明关系；不推断散文、外部来源或权威效力', read.closure.nodes.length));
  const complete = allRead && (!dependencies || read.closure.complete);
  const blocking = checks.some((item) => ['fail', 'misconfigured'].includes(item.state));
  const report = {
    schema: WORKFLOW_SCHEMA, generator: 'curia-read-workflow/1', mode: 'read', generatedAt: inventory.generatedAt,
    execution: { mode: 'ephemeral-read-only', persisted: false, effects: ['local-path-observation', 'registry-read', 'bounded-selected-text-read', ...(dependencies ? ['bounded-declared-dependency-expansion'] : [])], output: 'stdout', receiverCompleteness: 'not-observed' },
    input: { ...read.source, scope: read.selection, privacy: read.privacy, ...(dependencies ? { authorization: read.authorization } : {}) },
    ...(dependencies ? { dependencies: read.closure } : {}),
    stages: [
      { action: 'Inventory', state: read.inventoryErrors ? 'fail' : 'pass', contract: 'paths-before-document-bytes' },
      { action: 'Classify', state: checks.find((item) => item.id === 'curia-read/metadata').state, contract: 'metadata-from-the-same-read-bytes' },
      { action: 'Read', state: allRead ? 'pass' : 'evidence-gap', contract: 'bounded-verbatim-no-implicit-following' },
      { action: 'Challenge', state: blocking ? 'fail' : complete ? 'pass' : 'evidence-gap', contract: 'applicable-static-checks-only' },
      { action: 'Synthesize', state: 'pass', contract: 'aggregate-findings-not-semantic-inference' },
      { action: 'Emit', state: read.stable && !blocking ? complete ? 'pass' : 'partial' : 'blocked', contract: 'stdout-context-and-summary-not-a-domain-answer' },
    ],
    limits: read.limits,
    coverage: { selected: docs.length, excluded: read.selection.excluded, complete: docs.filter((doc) => doc.state === 'read').length, partial: docs.filter((doc) => doc.state === 'partial').length, unread: docs.filter((doc) => doc.state === 'not-read').length, chargedBytes: read.chargedBytes, projectedBytes: docs.reduce((sum, doc) => sum + (doc.range?.endByteExclusive ?? 0), 0), allSelectedContentRead: allRead, factVerified: 0, originals, variants: read.variants, validity: read.validity },
    checks, unresolved, documents: docs,
    outcome: blocking ? 'blocked' : complete ? 'read-complete' : 'partial',
    summary: `选中 ${docs.length} 篇，完整读取 ${docs.filter((doc) => doc.state === 'read').length} 篇；${dependencies && !read.closure.complete ? '声明依赖未闭合；' : ''}未核实事实。语义结论由调用方依据带来源的正文与限制形成。`,
    limitations: ['local-single-reader-only', 'not-a-secret-detector', 'not-an-atomic-snapshot', 'no-semantic-verification', ...(dependencies ? ['only-declared-relations-within-explicit-scope', 'no-prose-or-external-dependency-discovery', 'no-relation-efficacy-verification', 'no-global-closure'] : ['no-link-target-fetch', 'no-dependency-closure']), 'no-project-guard-execution', 'no-persisted-run', 'no-protected-delivery'],
  };
  workflowInputs.set(report, { inventory, openedFiles: read.openedFiles });
  return report;
}

export function parseWorkflowArgs(argv) {
  const options = { selection: { paths: [], exclusions: [], corpus: false }, limits: {} };
  const flags = { json: false, strict: false, help: false, rules: false, root: ROOT };
  const seen = new Set(), expansion = { enabled: false, within: [], nonSensitive: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (seen.has(arg) && !['--path', '--exclude', '--within'].includes(arg)) throw new Error(`参数 ${arg} 重复 [curia2/workflow-arg-invalid]`);
    seen.add(arg);
    const value = () => { const value = argv[++i]; if (!value || value.startsWith('--')) throw new Error(`参数 ${arg} 缺值 [curia2/workflow-arg-invalid]`); return value; };
    if (arg === '--help') flags.help = true;
    else if (arg === '--list-checks') flags.rules = true;
    else if (arg === '--json') flags.json = true;
    else if (arg === '--strict') flags.strict = true;
    else if (arg === '--root') flags.root = value();
    else if (arg === '--dependencies') expansion.enabled = true;
    else if (arg === '--within') expansion.within.push(value());
    else if (arg === '--non-sensitive') expansion.nonSensitive = true;
    else if (arg === '--corpus') options.selection.corpus = true;
    else if (arg === '--path') options.selection.paths.push(value());
    else if (arg === '--exclude') options.selection.exclusions.push(value());
    else if (arg === '--all') options.includeUntracked = true;
    else if (arg === '--inventory') options.inventoryOnly = true;
    else if (arg === '--at') options.at = value();
    else if (['--max-files', '--max-file-bytes', '--max-total-bytes'].includes(arg)) {
      const raw = value();
      if (!/^[1-9][0-9]*$/.test(raw)) throw new Error(`参数 ${arg} 必须为正整数 [curia2/workflow-arg-invalid]`);
      options.limits[{ '--max-files': 'maxFiles', '--max-file-bytes': 'maxFileBytes', '--max-total-bytes': 'maxTotalBytes' }[arg]] = Number(raw);
    } else throw new Error(`未知参数：${arg} [curia2/workflow-arg-invalid]`);
  }
  if (flags.help || flags.rules) {
    if (argv.some((arg) => !['--help', '--list-checks', '--json', ...(flags.rules ? ['--dependencies'] : [])].includes(arg)) || (flags.help && flags.rules)) throw new Error('help / list-checks 不能与执行参数混用 [curia2/workflow-arg-invalid]');
  } else {
    options.selection = normalizeReadSelection(options.selection);
    options.limits = normalizeReadLimits(options.limits);
    if (expansion.enabled || expansion.within.length || expansion.nonSensitive) {
      if (!expansion.enabled) throw new Error('within 与 non-sensitive 只用于显式 dependencies 模式 [curia2/workflow-arg-invalid]');
      options.dependencies = { within: expansion.within, nonSensitive: expansion.nonSensitive };
      normalizeDependencySelection(options.selection, options.dependencies);
    }
  }
  if (flags.rules) flags.dependencyRules = expansion.enabled;
  return { options, flags };
}

export const IMPACT_RULES = Object.freeze([
  ['boundary', 'explicit-authorized-local-scope', 'impact-chain', 'private-change-before-io'],
  ['inspection', 'all-bound-sources-in-explicit-scope', 'impact-chain', 'unmapped-source-not-a-leaf'],
  ['snapshot', 'all-inspected-and-inventoried-sources', 'impact-chain', 'scope-drift-withdrawal'],
  ['closure', 'reverse-references-and-supersession-peers', 'impact-chain', 'outside-reference-incomplete'],
].map(([name, scope, positive, negative]) => Object.freeze({ id: `curia-impact/${name}`, version: 1, owner: 'Curia workspace maintainer', scope, activation: 'explicit-impact-plan', required: true, onEmpty: 'fail', verification: 'static-declared-relations-not-authority-or-diff-proof', fixtures: { file: 'scripts/curia-impact-self-test.mjs', positive, negative } })));

export const GIT_IMPACT_RULES = Object.freeze([
  ...IMPACT_RULES.map(contract => Object.freeze({ ...contract, version: 2, activation: 'explicit-git-impact-plan', verification: 'raw-local-change-and-declared-relations-not-authority', fixtures: { file: 'scripts/curia-git-changes-self-test.mjs', positive: 'git-impact-chain', negative: 'cross-phase-drift' } })),
  Object.freeze({ id: 'curia-impact/git-changes', version: 1, owner: 'Curia workspace maintainer', scope: 'independent-explicit-change-scope', activation: 'explicit-git-impact-plan', required: true, onEmpty: 'not-applicable', verification: 'two-axis-raw-comparison-not-git-status', fixtures: { file: 'scripts/curia-git-changes-self-test.mjs', positive: 'staged-worktree-cancellation', negative: 'malicious-drivers-not-executed' } }),
]);

// Configuration dependencies are opt-in and have no effect on ordinary reads or historical Runs.
export const CONFIGURATION_IMPACT_RULES = Object.freeze([
  ...IMPACT_RULES.map(contract => Object.freeze({ ...contract, version: 3, scope: { 'curia-impact/inspection': 'explicit-include-bound-relation-sources', 'curia-impact/snapshot': 'current-registry-and-inventoried-objects', 'curia-impact/closure': 'configured-authorities-and-optional-body-relations' }[contract.id] ?? contract.scope, activation: contract.id === 'curia-impact/inspection' ? 'explicit-configuration-include' : 'explicit-configuration-impact', verification: 'configured-dependencies-not-authority-verification', fixtures: { file: 'scripts/curia-config-impact-self-test.mjs', positive: 'configuration-only-no-body-read', negative: 'configuration-snapshot-withdrawal' } })),
  Object.freeze({ id: 'curia-impact/configuration', version: 1, owner: 'Curia workspace maintainer', scope: 'current-registry-and-effective-authority-declarations', activation: 'explicit-configuration-impact', required: true, onEmpty: 'fail', verification: 'actual-registry-bytes-not-authority-target-evidence', fixtures: { file: 'scripts/curia-config-impact-self-test.mjs', positive: 'configuration-chain', negative: 'configuration-private-authority-withheld' } }),
]);
export const GIT_CONFIGURATION_IMPACT_RULES = Object.freeze([
  ...CONFIGURATION_IMPACT_RULES,
  Object.freeze({ ...GIT_IMPACT_RULES.find(rule => rule.id === 'curia-impact/git-changes'), version: 2, activation: 'explicit-configuration-git-impact', fixtures: { file: 'scripts/curia-config-impact-self-test.mjs', positive: 'configuration-git-two-axes', negative: 'configuration-git-cross-phase-drift' } }),
]);
// Older versions remain frozen for historical check-run decoding, not selectable execution modes.
export const MOVE_CONFIGURATION_IMPACT_RULES = Object.freeze(CONFIGURATION_IMPACT_RULES.map(rule => Object.freeze({ ...rule, version: rule.id === 'curia-impact/configuration' ? 2 : 4, ...(rule.id === 'curia-impact/configuration' ? { scope: 'current-registry-authorities-and-revision-qualified-move-declarations', verification: 'registry-declarations-not-move-or-authority-verification', fixtures: { file: 'scripts/curia-config-impact-self-test.mjs', positive: 'move-basis-selective', negative: 'reused-historical-path-not-an-edge' } } : {}) })));
export const GIT_MOVE_CONFIGURATION_IMPACT_RULES = Object.freeze([...MOVE_CONFIGURATION_IMPACT_RULES, GIT_CONFIGURATION_IMPACT_RULES.find(rule => rule.id === 'curia-impact/git-changes')]);
export const GUARD_CONFIGURATION_IMPACT_RULES = Object.freeze(MOVE_CONFIGURATION_IMPACT_RULES.map(rule => Object.freeze({ ...rule, version: rule.id === 'curia-impact/configuration' ? 3 : 5, scope: rule.id === 'curia-impact/configuration' ? 'current-registry-authorities-moves-and-primary-guard-declarations' : rule.scope, verification: 'declared-dependencies-not-runtime-scan-or-execution', fixtures: { file: 'scripts/curia-config-impact-self-test.mjs', positive: 'guard-code-selective', negative: 'guard-private-dependency-withheld' } })));
export const GIT_GUARD_CONFIGURATION_IMPACT_RULES = Object.freeze([...GUARD_CONFIGURATION_IMPACT_RULES, GIT_CONFIGURATION_IMPACT_RULES.find(rule => rule.id === 'curia-impact/git-changes')]);
const impactRules = (options, git = false) => options.configuration ? git ? GIT_GUARD_CONFIGURATION_IMPACT_RULES : GUARD_CONFIGURATION_IMPACT_RULES : git ? GIT_IMPACT_RULES : IMPACT_RULES;
const impactSchema = options => options.configuration ? 'curia.impact-plan/4' : 'curia.impact-plan/1';
const configurationScope = options => options.configuration ? { configuration: options.configuration, configurationSchema: 'curia.configuration-dependencies/3', configurationBasis: 'current-registry-declarations-not-historical-reconstruction' } : {};
const withdrawConfiguration = configuration => {
  if (configuration) Object.assign(configuration, { stable: false, complete: false, registry: null, documents: [], references: [], moves: [] });
};

export function normalizeImpactOptions(input = {}) {
  const keys = ['changed', 'within', 'exclusions', 'nonSensitive', 'includeUntracked', 'inventoryOnly', 'limits', 'at', 'now', 'gitBase', 'changesWithin', 'changeLimits', 'configuration'];
  if (!plain(input) || Object.keys(input).some(key => !keys.includes(key)) || input.nonSensitive !== true || ['includeUntracked', 'inventoryOnly'].some(key => input[key] !== undefined && typeof input[key] !== 'boolean') || (input.now !== undefined && !['string', 'function'].includes(typeof input.now))) throw new Error('影响分析需要显式范围与非敏感声明，不接受额外效果 [curia2/impact-options-invalid]');
  if (input.configuration !== undefined && !['include', 'only'].includes(input.configuration)) throw new Error('配置影响只接受 include 或 only [curia2/impact-options-invalid]');
  if (input.at !== undefined) evaluationInstant(input.at);
  if (typeof input.now === 'string') evaluationInstant(input.now);
  const gitMode = Object.hasOwn(input, 'gitBase');
  if (gitMode ? input.changed !== undefined && (!Array.isArray(input.changed) || input.changed.length) : input.changesWithin !== undefined || input.changeLimits !== undefined) throw new Error('Git 观察与名字声明不能混用 [curia2/impact-options-invalid]');
  const changed = gitMode ? [] : normalizeReadSelection({ paths: input.changed }).paths;
  const selection = normalizeReadSelection({ paths: input.within, exclusions: input.exclusions ?? [] });
  if (changed.length > IMPACT_LIMITS.maxChanges || selection.paths.length > 128 || selection.exclusions.length > 128 || [...changed, ...selection.paths, ...selection.exclusions].some(path => /[#%]/u.test(path) || Buffer.byteLength(path, 'utf8') > 4096) || changed.some(path => (privateReadPath(path) && !(input.configuration && path === '.agents/doc-types.json')) || selection.exclusions.some(prefix => path === prefix || path.startsWith(prefix + '/'))) || (input.configuration && selection.exclusions.some(prefix => '.agents/doc-types.json' === prefix || '.agents/doc-types.json'.startsWith(prefix + '/')))) throw new Error('变更名字必须为未排除的非敏感仓内精确路径 [curia2/impact-scope-invalid]');
  const changeOptions = gitMode ? { base: input.gitBase, within: input.changesWithin, exclusions: input.exclusions ?? [], includeUntracked: input.includeUntracked ?? false, nonSensitive: true, ...(input.configuration ? { includeRegistry: true } : {}) } : null;
  if (changeOptions) normalizeGitChangeOptions(changeOptions);
  return { ...input, changed, selection, limits: normalizeReadLimits(input.limits ?? {}), changeOptions, changeLimits: gitMode ? normalizeGitChangeLimits(input.changeLimits ?? {}) : null };
}

export function buildImpactWorkflow(root = ROOT, input = {}) {
  const options = normalizeImpactOptions(input);
  return options.changeOptions ? buildGitImpactWorkflow(root, options) : buildDeclaredImpactWorkflow(root, options);
}

function buildGitImpactWorkflow(root, options) {
  const selection = prepareGitChangeSelection(root, options.changeOptions), contracts = impactRules(options, true);
  const initial = {
    schema: impactSchema(options), mode: options.inventoryOnly ? 'inventory' : 'impact', outcome: 'not-evaluated', complete: false,
    scope: { ...configurationScope(options), changed: [], within: options.selection.paths, exclusions: options.selection.exclusions, changesWithin: options.changeOptions.within, nonSensitive: true, globalCoverage: false, changeBasis: 'explicit-local-git-and-raw-worktree' },
    execution: { mode: 'ephemeral-read-only', persisted: false, output: 'stdout', effects: ['local-path-observation', 'registry-read'] },
    checks: contracts.map(rule => ({ ...rule, state: 'evidence-gap' })), documents: [], sourceRefs: [], evidenceRefs: [], impact: null, unresolved: [],
    coverage: { inventoryObjects: 0, inspected: 0, chargedBytes: 0, factVerified: 0, bodiesEmitted: 0 },
    limitations: ['change-scope-not-global', 'raw-comparison-not-git-status', 'no-rename-inference', 'non-atomic-local-snapshot', 'no-guard-execution', 'no-persistence-or-cache'],
  };
  if (options.inventoryOnly) { initial.changeInventory = selection; initial.summary = '仅盘点变更来源；未摘要工作树、未扫描关系源。'; return initial; }
  const observation = observeGitChanges(selection, options.changeLimits);
  let report = initial;
  report.execution.effects.push('bounded-raw-worktree-digest');
  if (observation.complete && observation.changed.length) report = buildDeclaredImpactWorkflow(root, { ...options, changed: observation.changed }, observation);
  else if (observation.complete) {
    report.complete = true; report.outcome = 'no-changes-within-scope';
    report.summary = '授权且未排除的观察范围内没有变更；未读取关系正文，不代表全仓无变化或关系图完整。';
    report.checks = contracts.map(rule => ({ ...rule, state: ['curia-impact/inspection', 'curia-impact/closure', 'curia-impact/configuration'].includes(rule.id) ? 'not-applicable' : 'pass' }));
  }
  report.scope = { ...report.scope, changesWithin: options.changeOptions.within, changeBasis: 'explicit-local-git-and-raw-worktree' };
  report.changeObservation = observation;
  report.limitations = [...new Set([...report.limitations, ...initial.limitations])];
  report.checks = contracts.map(rule => ({ ...report.checks.find(check => check.id === rule.id), ...rule, state: rule.id === 'curia-impact/git-changes' ? observation.complete ? 'pass' : 'evidence-gap' : report.checks.find(check => check.id === rule.id)?.state ?? 'evidence-gap' }));
  if (!report.execution.effects.includes('bounded-raw-worktree-digest')) report.execution.effects.push('bounded-raw-worktree-digest');
  report.unresolved.push(...observation.findings);
  if (observation.complete && (!revalidateGitChanges(observation) || report.unresolved.some(f => f.code === 'git-change/cross-phase-drift'))) {
    Object.assign(observation, { stable: false, complete: false, observedAt: null, changed: [], objects: [] });
    observation.findings.push({ code: 'git-change/cross-phase-drift', path: null });
    report.unresolved.push({ code: 'git-change/cross-phase-drift', path: null });
  }
  if (!observation.complete || report.unresolved.some(f => f.code === 'git-change/cross-phase-drift')) {
    if (report.input) report.input.stable = false;
    withdrawConfiguration(report.configuration);
    if (report.input?.source?.mode === 'current-registry-declarations') report.input.source.registry = null;
    if (report.configuration) { report.coverage.configurationObjects = 0; report.coverage.registryBytes = 0; }
    report.complete = false; report.outcome = 'incomplete'; report.scope.changed = []; report.impact = null; report.sourceRefs = []; report.evidenceRefs = [];
    report.documents = report.documents.map(doc => ({ ...doc, state: 'not-read', reason: 'git-change-incomplete' }));
    report.checks = report.checks.map(check => ({ ...check, state: 'evidence-gap' }));
    report.summary = 'Git 观察不完整或两阶段输入变化；未保留变更证据与复核结论。';
  }
  return report;
}

/** One bounded scope scan, then a smaller review set. This is not a per-change persistent index. */
function buildDeclaredImpactWorkflow(root, options, observation = null) {
  const only = options.configuration === 'only', contracts = impactRules(options);
  const inventory = buildImpactInventory(root, options.selection, { changed: options.changed, nonSensitive: true, includeUntracked: options.includeUntracked ?? false, at: options.at, now: options.now, ...(options.configuration ? { configuration: options.configuration } : {}) });
  const report = {
    schema: impactSchema(options), mode: options.inventoryOnly ? 'inventory' : 'impact', outcome: 'incomplete', complete: false,
    scope: { ...configurationScope(options), changed: options.changed, within: options.selection.paths, exclusions: options.selection.exclusions, nonSensitive: true, basis: 'explicit-local-scope', globalCoverage: false, changeBasis: 'caller-declared-paths-not-git-diff-or-deletion-proof' },
    execution: { mode: 'ephemeral-read-only', persisted: false, output: 'stdout', effects: ['local-path-observation', 'registry-read', ...(!options.inventoryOnly && !only ? ['bounded-relation-source-inspection'] : [])] },
    input: null, checks: [], documents: [], sourceRefs: [], evidenceRefs: [], impact: null, unresolved: [],
    coverage: { inventoryObjects: inventory.envelopes?.length ?? 0, inspected: 0, chargedBytes: 0, factVerified: 0, bodiesEmitted: 0 },
    limitations: ['only-explicit-declared-relations', 'scope-scan-required-for-incoming-references', 'no-global-coverage', 'no-authority-or-business-verification', ...(options.configuration ? ['current-registry-only-not-historical-config', 'move-locators-not-current-path-edges', 'move-declarations-not-identity-or-approval-verification', 'authority-and-move-basis-target-bodies-not-read-by-configuration', 'no-prose-external-or-runtime-config-dependencies', ...(only ? ['document-body-relations-not-inspected'] : [])] : ['no-prose-or-external-or-config-dependencies']), 'no-implicit-move-aliases', 'no-protected-delivery', 'no-guard-execution', 'no-persistence-or-cache', 'non-atomic-local-snapshot', 'path-floor-not-secret-detection'],
  };
  const checks = (boundary, inspected, stable, complete, configured = false) => contracts.map(contract => {
    const id = contract.id.slice('curia-impact/'.length);
    const states = { boundary, inspection: inspected, snapshot: stable, closure: complete, configuration: configured };
    const reasons = { boundary: '范围来自调用方，不能由原文扩展', inspection: only ? '明确只检查配置依赖；正文及正文关系未读' : '必须检查授权范围内全部关系源，未映射不当作叶子', snapshot: '输入必须在同次盘点与最终后检中保持一致', closure: '候选仅覆盖本次声明依赖范围，不证明全局无影响或现行效力', configuration: '只从实际读取的当前 Registry 投影依赖；不读取 authority 目标或重构旧配置' };
    return { ...contract, state: id === 'inspection' && only ? 'not-applicable' : states[id] ? 'pass' : 'evidence-gap', reason: reasons[id] };
  });
  impactInputs.set(report, inventory);
  if (options.inventoryOnly) {
    report.outcome = 'not-evaluated'; report.inventory = inventory; report.checks = checks(!inventory.coverage?.errors, false, false, false);
    return report;
  }
  if (observation && !revalidateGitChanges(observation, inventory)) {
    report.unresolved.push({ code: 'git-change/cross-phase-drift', path: null });
    report.checks = checks(false, false, false, false);
    return report;
  }
  const read = only ? null : readInventoryRelations(inventory, options.limits);
  const configuration = options.configuration ? readInventoryConfiguration(inventory, options.limits) : null;
  const findings = [...(read?.findings ?? []), ...(configuration?.findings ?? [])];
  let stable = (read?.stable ?? true) && (configuration?.stable ?? true);
  if (observation && !revalidateGitChanges(observation, inventory)) { stable = false; findings.push({ code: 'git-change/cross-phase-drift', path: null }); }
  const documents = read?.documents ?? configuration.documents;
  if (!stable) {
    withdrawConfiguration(configuration);
    for (const doc of documents) { doc.state = 'not-read'; doc.reason = 'snapshot-incomplete'; doc.text = doc.range = doc.digest = doc.envelope = doc.observedAt = null; }
  }
  if (configuration) report.configuration = configuration;
  report.input = read ? { source: read.source, privacy: read.privacy, selection: read.selection, limits: read.limits, stable } : {
    source: { mode: 'current-registry-declarations', registry: configuration.registry }, selection: inventory.input.selection, limits: configuration.limits, stable,
    privacy: { mode: 'local-single-reader-explicit-non-sensitive-scope', pathFloor: 'read-path-exclusions/1', classification: 'caller-responsible-not-secret-detection', targetContentRead: false, network: 'not-invoked' },
  };
  report.documents = documents.map(({ path, state, reason, binding }) => ({ path, state, reason, parser: only ? null : binding?.parser ?? null }));
  report.coverage = { ...report.coverage, inventoryObjects: read?.inventoryObjects ?? configuration.observedObjects, inspected: documents.filter(doc => doc.state === 'read').length, chargedBytes: read?.chargedBytes ?? 0, openedFiles: read?.openedFiles ?? 0, ...(configuration ? { configurationObjects: configuration.documents.length, registryBytes: configuration.registry?.bytes ?? 0 } : {}) };
  report.impact = planImpact(documents, options.changed, { stable, configuration, configurationOnly: only });
  if (observation) for (const item of report.impact.affected) if (item.basis === 'caller-declared-change') item.basis = 'observed-local-git-and-raw-worktree';
  if (read?.overLimit) { report.impact.truncated = true; report.impact.findings.push({ code: 'impact/source-limit', path: null }); }
  report.unresolved = [...findings, ...report.impact.findings];
  for (const doc of documents) if (doc.digest && doc.state === 'read' && stable) {
    report.sourceRefs.push({ uri: `repo:${doc.path}`, revision: doc.digest, locator: { kind: 'whole-file/1' }, observedAt: doc.observedAt });
    report.evidenceRefs.push({ kind: 'local-relation-source', path: doc.path, contentDigest: doc.digest, observedAt: doc.observedAt, verification: 'actual-complete-source-bytes-not-semantic-verification' });
  }
  if (stable && configuration?.registry) {
    const { bytes, ...source } = configuration.registry;
    report.sourceRefs.push(source);
    report.evidenceRefs.push({ kind: 'local-registry-configuration', path: '.agents/doc-types.json', contentDigest: source.revision, locator: source.locator, observedAt: source.observedAt, verification: 'actual-registry-bytes-not-authority-target-verification' });
  }
  report.complete = stable && !read?.overLimit && report.impact.complete && !findings.length;
  if (!report.complete) { report.impact.complete = false; report.impact.state = 'incomplete'; }
  report.outcome = report.complete ? 'impact-planned' : 'incomplete';
  report.checks = checks(inventory.coverage.errors === 0, !read?.overLimit && documents.length > 0 && documents.every(doc => doc.state === 'read' && doc.binding), stable, report.complete, configuration?.complete ?? false);
  report.summary = `检查 ${report.coverage.inspected} 个关系源${configuration ? `、${report.coverage.configurationObjects} 个对象的配置依赖` : ''}，列出 ${report.impact.reviewPaths.length} 个当前复核候选；${report.complete ? only ? '仅选定范围内的当前配置声明完整，正文关系未检查' : '选定范围内的声明依赖完整' : '仍有未检查或未解释范围，候选集不是完整影响结论'}。正文不输出，命令不执行。`;
  return report;
}

export const CHANGE_READ_RULES = Object.freeze([
  ['selection', 'explicit-change-and-relation-scopes', 'change-read-selected', 'change-read-private'],
  ['impact', 'current-declared-relation-candidates', 'change-read-selected', 'change-read-unmapped'],
  ['content', 'selected-current-candidate-documents', 'change-read-selected', 'change-read-budget'],
  ['snapshot', 'change-observation-relation-inventory-and-read-inventory', 'change-read-selected', 'change-read-cross-phase-drift'],
].map(([name, scope, positive, negative]) => Object.freeze({ id: `curia-change-read/${name}`, version: 1, owner: 'Curia workspace maintainer', scope, activation: 'explicit-git-change-reading', required: true, onEmpty: 'not-applicable', verification: 'scoped-current-bytes-not-cache-or-fact-verification', fixtures: { file: 'scripts/curia-git-changes-self-test.mjs', positive, negative } })));

/** Compose existing observation, reverse planning and bounded reading; nothing is persisted or reused across calls. */
export function buildChangeReadWorkflow(root = ROOT, input = {}) {
  const options = normalizeImpactOptions(input);
  if (!options.changeOptions || options.configuration === 'only') throw new Error('按变更阅读需要 Git 基线，不接受名字声明或仅配置模式 [curia2/change-read-options-invalid]');
  const planning = buildGitImpactWorkflow(root, options);
  const report = {
    schema: 'curia.change-read-workflow/1', mode: options.inventoryOnly ? 'inventory' : 'change-read',
    scope: { within: options.selection.paths, exclusions: options.selection.exclusions, changesWithin: options.changeOptions.within, globalCoverage: false },
    execution: { mode: 'ephemeral-read-only', persisted: false, output: 'stdout', receiverCompleteness: 'not-observed', effects: [...planning.execution.effects] },
    limits: { changes: options.changeLimits, relationsAndContent: options.limits },
    planning, reading: null, documents: [], outcome: 'blocked', complete: false, checks: [], unresolved: [...planning.unresolved],
    coverage: { relationSourcesInspected: planning.coverage.inspected, candidates: 0, contentRead: 0, relationBytes: planning.coverage.chargedBytes, contentBytes: 0, chargedBytes: planning.coverage.chargedBytes, openedFiles: planning.coverage.openedFiles ?? 0, factVerified: 0 },
    limitations: ['local-single-reader-only', 'current-declared-relations-only', 'relation-scan-still-required', 'not-a-persistent-cache-or-index', 'not-a-historical-configuration-reconstruction', 'no-global-coverage', 'no-forward-dependency-expansion', 'no-protected-delivery', 'no-guard-execution-or-network'],
  };
  const checks = states => { report.checks = CHANGE_READ_RULES.map(c => ({ ...c, state: states[c.id.slice('curia-change-read/'.length)] })); };
  if (options.inventoryOnly) {
    const gaps = planning.changeInventory.findings;
    report.unresolved.push(...gaps); report.outcome = gaps.length ? 'blocked' : 'inventoried-not-read';
    checks({ selection: gaps.length ? 'fail' : 'pass', impact: 'not-applicable', content: 'not-applicable', snapshot: 'not-applicable' });
    return report;
  }
  const observation = planning.changeObservation;
  const impactInventory = impactInputs.get(planning);
  let reading = null;
  const stable = () => revalidateGitChanges(observation) && (!impactInventory || revalidateReadInventory(impactInventory)) && (!reading || revalidateReadInventory(workflowInputs.get(reading).inventory));
  if (!observation?.complete || (planning.input && !planning.input.stable)) {
    checks({ selection: 'evidence-gap', impact: 'evidence-gap', content: 'not-applicable', snapshot: 'fail' });
    return report;
  }
  if (!observation.changed.length) { report.outcome = 'no-changes-within-scope'; report.complete = true; }
  else {
    const candidates = planning.impact?.reviewPaths ?? [];
    const paths = candidates.filter(path => !privateReadPath(path) && planning.documents.some(doc => doc.path === path && doc.reason !== 'guard-sensitive-source'));
    report.coverage.candidates = candidates.length;
    if (paths.length !== candidates.length) report.unresolved.push({ code: 'change-read/private-candidates-withheld', path: null });
    const maxFiles = options.limits.maxFiles - report.coverage.openedFiles, maxTotalBytes = options.limits.maxTotalBytes - report.coverage.chargedBytes;
    if (paths.length && maxFiles > 0 && maxTotalBytes > 0) {
      reading = buildReadWorkflow(root, { selection: { paths, exclusions: options.selection.exclusions }, limits: { ...options.limits, maxFiles, maxTotalBytes }, includeUntracked: options.includeUntracked ?? false, at: options.at, now: options.now });
      const { documents, ...summary } = reading;
      report.reading = summary; report.documents = documents;
      report.unresolved.push(...reading.unresolved);
      report.execution.effects = [...new Set([...report.execution.effects, ...reading.execution.effects])];
      Object.assign(report.coverage, { contentRead: reading.coverage.complete, contentBytes: reading.coverage.chargedBytes, chargedBytes: report.coverage.chargedBytes + reading.coverage.chargedBytes, openedFiles: report.coverage.openedFiles + workflowInputs.get(reading).openedFiles });
      report.complete = planning.complete && paths.length === candidates.length && reading.outcome === 'read-complete';
      report.outcome = reading.outcome === 'blocked' ? 'blocked' : report.complete ? 'read-complete' : 'partial';
    } else if (paths.length) {
      report.unresolved.push({ code: 'change-read/content-budget-exhausted', path: null }); report.outcome = 'partial';
    } else { report.complete = planning.complete && !candidates.length; report.outcome = report.complete ? 'no-documents-to-read' : 'partial'; }
  }
  const current = stable();
  checks({ selection: report.outcome === 'blocked' ? 'fail' : 'pass', impact: planning.complete ? 'pass' : 'evidence-gap', content: reading ? reading.outcome === 'read-complete' ? 'pass' : 'evidence-gap' : report.complete ? 'not-applicable' : 'evidence-gap', snapshot: current ? 'pass' : 'fail' });
  if (!current) {
    report.planning = report.reading = null; report.documents = []; report.complete = false; report.outcome = 'blocked';
    report.unresolved = [{ code: 'change-read/cross-phase-drift', path: null }];
    Object.assign(report.coverage, { relationSourcesInspected: 0, candidates: 0, contentRead: 0 });
    checks({ selection: 'evidence-gap', impact: 'evidence-gap', content: 'evidence-gap', snapshot: 'fail' });
  }
  return report;
}

function changeReadMain() {
  try {
    const { options, flags } = parseImpactArgs(process.argv.slice(3));
    if (flags.help) { console.log('node scripts/curia-workflow.mjs read-changes --git-base HEAD --changes-within packages/contracts --within docs --non-sensitive --strict --json\n先 --inventory 只盘点变更来源；读取阶段只输出当前受影响文档，不执行检查或外访。\n复用 impact 的 Git 基线、两类范围、排除、配置 include 与预算参数；不接受 --changed 或 --configuration only。\n--max-files / --max-total-bytes 在关系扫描与正文读取之间共享，Git 摘要使用独立 --max-change-* 预算。\n关系发现仍需扫描授权范围；未映射或未读关系保留缺口，不是跨次缓存、历史配置重构或全仓覆盖。'); return; }
    if (flags.rules) { console.log(JSON.stringify(CHANGE_READ_RULES, null, 2)); return; }
    const result = buildChangeReadWorkflow(flags.root, options);
    console.log(flags.json ? JSON.stringify(result, null, 2) : `read-changes: ${result.outcome}; read=${result.coverage.contentRead}; persisted=no`);
    if (flags.strict && (options.inventoryOnly ? result.outcome === 'blocked' : !result.complete)) process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 2; }
}

export function parseImpactArgs(argv) {
  const options = { changed: [], within: [], exclusions: [], limits: {} }, flags = { root: ROOT, json: false, strict: false, help: false, rules: false }, seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]; if (seen.has(flag) && !['--changed', '--within', '--exclude', '--changes-within'].includes(flag)) throw new Error('影响参数重复 [curia2/impact-arg-invalid]'); seen.add(flag);
    if (['--help', '--json', '--strict'].includes(flag)) flags[flag.slice(2)] = true;
    else if (flag === '--list-checks') flags.rules = true;
    else if (flag === '--all') options.includeUntracked = true;
    else if (flag === '--non-sensitive') options.nonSensitive = true;
    else if (flag === '--inventory') options.inventoryOnly = true;
    else {
      if (!['--root', '--changed', '--within', '--exclude', '--max-files', '--max-file-bytes', '--max-total-bytes', '--at', '--configuration', '--git-base', '--changes-within', '--max-change-files', '--max-change-file-bytes', '--max-change-total-bytes'].includes(flag) || i + 1 >= argv.length || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error('影响参数或取值非法 [curia2/impact-arg-invalid]');
      const value = argv[++i];
      if (flag === '--root') flags.root = value;
      else if (flag === '--at') options.at = value;
      else if (flag === '--configuration') { if (!['include', 'only'].includes(value)) throw new Error('配置模式非法 [curia2/impact-arg-invalid]'); options.configuration = value; }
      else if (flag === '--git-base') options.gitBase = value;
      else if (flag === '--changes-within') (options.changesWithin ??= []).push(value);
      else if (flag.startsWith('--max-change-')) {
        if (!/^[1-9][0-9]*$/.test(value)) throw new Error('Git 观察预算非法 [curia2/impact-arg-invalid]');
        (options.changeLimits ??= {})[{ '--max-change-files': 'maxFiles', '--max-change-file-bytes': 'maxFileBytes', '--max-change-total-bytes': 'maxTotalBytes' }[flag]] = Number(value);
      }
      else if (['--changed', '--within', '--exclude'].includes(flag)) options[flag === '--exclude' ? 'exclusions' : flag.slice(2)].push(value);
      else { if (!/^[1-9][0-9]*$/.test(value) || value !== value.trim()) throw new Error('影响预算非法 [curia2/impact-arg-invalid]'); options.limits[{ '--max-files': 'maxFiles', '--max-file-bytes': 'maxFileBytes', '--max-total-bytes': 'maxTotalBytes' }[flag]] = Number(value); }
    }
  }
  if (flags.help || flags.rules) { if ([...seen].some(flag => !['--help', '--list-checks', '--json', ...(flags.rules ? ['--git-base', '--configuration'] : [])].includes(flag)) || (flags.help && flags.rules)) throw new Error('影响帮助不能与执行参数混用 [curia2/impact-arg-invalid]'); }
  else normalizeImpactOptions(options);
  return { options, flags };
}

function impactMain() {
  try {
    const { options, flags } = parseImpactArgs(process.argv.slice(3));
    if (flags.help) { console.log('node scripts/curia-workflow.mjs impact --changed docs/manual.md --within docs --non-sensitive --strict --json\n--changed 是精确变更路径，可重复；删除或移动须显式提供旧、新路径，不自动推断。\n--within 是明确授权的关系扫描范围，不默认全仓。先 --inventory 盘点；未映射、截断与范围外目标保留缺口。\nGit 模式：--git-base HEAD --changes-within packages/contracts --within docs --non-sensitive；与 --changed 互斥。\n基线到 index 与 index 到原始工作树分开比较，不调用 diff / filter，不推断 rename；不是 git status 等价物。\n摘要预算独立使用 --max-change-files / --max-change-file-bytes / --max-change-total-bytes；--max-files 等约束关系读取；配置模式同时以 max-files 约束对象数量。\n配置依赖：--configuration only 仅投影当前 Registry；include 合并正文声明。显式 --changed .agents/doc-types.json 可分析配置变更；Git 摘要 Registry 时须精确 --changes-within .agents/doc-types.json。\n配置边只证明声明存在，不读取 authority 目标，不重构旧依赖；only 不宣称正文关系完整。\n只输出关系与复核候选，不输出正文、不执行命令、不落 Run。--list-checks 列规则；加 --git-base HEAD 查看 Git 模式规则。'); return; }
    if (flags.rules) { console.log(JSON.stringify(impactRules(options, options.gitBase !== undefined), null, 2)); return; }
    const result = buildImpactWorkflow(flags.root, options);
    console.log(flags.json ? JSON.stringify(result, null, 2) : `${result.outcome}\n${result.summary ?? '仅盘点授权路径，未检查关系。'}\n${result.impact?.reviewPaths.join('\n') ?? ''}`);
    if (flags.strict && !result.complete) process.exitCode = 1;
  } catch { console.error('影响分析参数、配置或快照不可用 [curia2/impact-unavailable]'); process.exitCode = 2; }
}

function main() {
  try {
    const { options, flags } = parseWorkflowArgs(process.argv.slice(2));
    if (flags.help) {
      console.log(`curia-workflow — 显式范围、预算内只读上下文，不创建 Run 或过程文档。
  node scripts/curia-workflow.mjs --path docs/manual.md --json
  node scripts/curia-workflow.mjs --path docs/api --path docs/runbooks --exclude docs/api/private --json
  node scripts/curia-workflow.mjs --corpus --inventory --json
  node scripts/curia-workflow.mjs --path docs/manual.md --dependencies --within docs --non-sensitive --json
  node scripts/curia-workflow.mjs --list-checks --dependencies --json
  node scripts/curia-workflow.mjs impact --changed docs/manual.md --within docs --non-sensitive --strict --json
  node scripts/curia-workflow.mjs extract --parser ooxml-data/1 --path docs/manual.docx --non-sensitive --json
  node scripts/curia-workflow.mjs external --help
  node scripts/curia-workflow.mjs snapshot --help
  node scripts/curia-workflow.mjs moves --help
  node scripts/curia-workflow.mjs tasks --help
tasks、moves、snapshot、extract 与 external 是独立按需入口，预算、授权与局限见各自 --help；不改普通阅读或历史 Run 合同。
可选：--root <Git 根> --all --at <instant> --max-files <n> --max-file-bytes <n> --max-total-bytes <n> --strict。
默认预算：${JSON.stringify(normalizeReadLimits())}；字节上限同时约束实际读取与输出前缀。
--all 只包含未忽略 untracked，不扩大声明面；默认仅 md/txt 正文；JSON 仅按显式 contentParser: json-data/1、json-original-register/1 或原生 json-native-object/1 映射启用；依赖模式另支持显式 json-pointer-relations/1。--json 包含带来源的原文切片。
--dependencies 只跟随 Registry 显式 relations 字段；必须另给 --within 与 --non-sensitive，排除优先，未映射或范围外目标保留缺口；默认不跟随链接。
来源内容不是执行指令；不自动跟随外部链接、不执行项目或来源命令、不调用模型、不外访、不持久化；路径元数据通过 Git 与系统挂载表读取。
--strict 对失败、配置错误和必需检查的证据缺口退出 1；参数 / 配置错误退出 2。`);
      return;
    }
    if (flags.rules) { const contracts = flags.dependencyRules ? DEPENDENCY_READ_RULES : READ_RULES; console.log(flags.json ? JSON.stringify(contracts, null, 2) : contracts.map((item) => `${item.id}@${item.version} scope=${item.scope} on-empty=${item.onEmpty}`).join('\n')); return; }
    const result = buildReadWorkflow(flags.root, options);
    if (flags.json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`workflow: ${result.outcome}; mode=${result.mode}; output=stdout; persisted=no`);
      console.log(result.summary ?? `路径盘点：${result.coverage.selected} 个对象，正文未读。`);
      for (const item of result.checks) console.log(`[${item.id}@${item.version}] ${item.state}: ${item.reason}`);
      for (const doc of result.documents) console.log(`${doc.state}\t${JSON.stringify(doc.path)}${doc.reason ? `\t${doc.reason}` : ''}`);
    }
    if (flags.strict && result.checks.some((item) => ['fail', 'misconfigured'].includes(item.state) || (item.required && ['skipped', 'evidence-gap'].includes(item.state)))) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
if (isMainModule(import.meta.url)) {
  if (process.argv[2] === 'tasks') { const { tasksMain } = await import('./curia-tasks.mjs'); tasksMain(process.argv.slice(3)); }
  else if (process.argv[2] === 'moves') { const { movesMain } = await import('./curia-moves.mjs'); movesMain(process.argv.slice(3)); }
  else if (process.argv[2] === 'snapshot') { const { snapshotsMain } = await import('./curia-snapshots.mjs'); snapshotsMain(process.argv.slice(3)); }
  else if (process.argv[2] === 'external') { const { externalMain } = await import('./curia-external.mjs'); await externalMain(process.argv.slice(3)); }
  else if (process.argv[2] === 'extract') { const { extractionMain } = await import('./curia-extract.mjs'); extractionMain(process.argv.slice(3)); }
  else if (process.argv[2] === 'impact') impactMain();
  else if (process.argv[2] === 'read-changes') changeReadMain(); else main();
}
