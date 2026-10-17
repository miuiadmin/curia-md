/** Task profiles, private member withholding and native outcome semantics in disposable repositories. */
import fs, { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, isMainModule } from './doc-lib.mjs';
import { normalizeInstance, taskMemberFor, taskPrivatePath } from './curia-instance.mjs';
import { buildInventory, buildTaskInventory, prepareSourceSelection, readSourceSubset, digestSourceSubset, buildGitChangeQuery } from './curia-query.mjs';
import { buildReadWorkflow, buildImpactWorkflow } from './curia-workflow.mjs';
import { buildGuardPlan } from './curia-guards.mjs';
import { observeTaskOutcome, parseTaskArgs } from './curia-tasks.mjs';

export function taskFixtures({ expectTrue, registry }) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'curia-tasks-'))), cli = fileURLToPath(new URL('./curia-workflow.mjs', import.meta.url));
  const env = { ...process.env }; for (const k of Object.keys(env)) if (k.startsWith('GIT_') || ['CURIA_STAGED', 'CURIA_STAGED', 'CURIA_ROOT', 'CURIA_ROOT'].includes(k)) delete env[k];
  const git = (...args) => execFileSync('git', args, { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] });
  const put = (path, value) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), value); };
  const assert = (name, condition, detail = '') => expectTrue(`Curia tasks [${name}]`, condition, detail);
  const reject = (name, fn) => { let error; try { fn(); } catch (e) { error = e; } assert(name, !!error, error?.message ?? '未拒绝'); };
  const base = structuredClone(registry); delete base.instance;
  const pkg = 'docs/jobs/report', receipt = pkg + '/ledger.json', secret = pkg + '/settings.json';
  const members = [
    ['README.md', 'knowledge'], ['SKILL.md', 'skill'], ['job.mjs', 'source'], ['settings.json', 'config'], ['checkpoint.json', 'checkpoint'], ['ledger.json', 'ledger'], ['report.md', 'output'], ['history', 'archive'],
  ].map(([name, role]) => ({ path: `${pkg}/${name}`, kind: name === 'history' ? 'directory' : 'file', role }));
  const profile = { schema: 'curia.task-profile/1', id: 'report-job', invocationRef: pkg + '/SKILL.md', sensitivity: 'non-sensitive', members, retention: 'docs/retention.md', outcomeAuthority: { path: receipt, kind: 'file', parser: 'json-task-outcome/1', recordsPointer: '/rounds', fields: { invocation: '/id', taskId: '/task', outcome: '/result', evidenceComplete: '/evidenceComplete', schedulerStatus: '/scheduler', exitCode: '/exitCode', observedAt: '/at' }, outcomes: { done: 'completed', noop: 'empty', failed: 'failed', busy: 'running', skipped: 'not-executed' } } };
  const instance = { schema: 'curia.instance/1', owner: 'fixture-owner', surfaces: [
    { id: 'control', kind: 'root', members: [{ path: '.agents', kind: 'directory', role: 'control' }], entry: '.agents/README.md', authorityLinks: ['AGENTS.md'] },
    { id: 'knowledge', kind: 'root', members: [{ path: 'docs', kind: 'directory', role: 'knowledge' }], entry: 'docs/README.md', authorityLinks: ['AGENTS.md'] },
  ], mappings: [{ path: pkg, kind: 'directory', task: profile }] };
  const configure = (i = instance) => put('.agents/doc-types.json', JSON.stringify({ ...base, instance: i }));
  const row = () => ({ id: 'round-1', task: 'report-job', result: 'done', evidenceComplete: true, scheduler: 'success', exitCode: 0, at: '2026-10-17T00:00:00Z', ignored: 'OUTCOME_BODY_SENTINEL' });
  const ledger = edit => { const data = { rounds: [row()], arbitrary: 'RECEIPT_SENTINEL' }; edit?.(data); put(receipt, JSON.stringify(data)); };
  const restore = () => { configure(); ledger(); };
  const options = { package: pkg, receipt, invocation: 'round-1', nonSensitive: true };
  const observe = (extra = {}) => observeTaskOutcome(root, { ...options, ...extra });
  const opens = fn => { const old = fs.openSync, paths = []; fs.openSync = (...args) => { paths.push(String(args[0])); return old(...args); }; syncBuiltinESMExports(); try { return { value: fn(), paths }; } finally { fs.openSync = old; syncBuiltinESMExports(); } };
  const duringDecode = change => { const Native = globalThis.TextDecoder; let changed = false; globalThis.TextDecoder = class extends Native { decode(...args) { const text = super.decode(...args); if (!changed && text.includes('RECEIPT_SENTINEL')) { changed = true; change(); } return text; } }; try { const result = observe(); assert('decode-hook-fired', changed); return result; } finally { globalThis.TextDecoder = Native; } };
  try {
    put('AGENTS.md', '# Fixture\n'); put('.agents/README.md', '# Control\n'); put('docs/README.md', '# Docs\n'); put('docs/retention.md', '# Retention\n');
    put(pkg + '/README.md', '# Method\n\nIndependent final documentation.\n'); put(pkg + '/SKILL.md', '# Task instructions\n\nDo not execute from inventory.\n'); put(pkg + '/job.mjs', 'throw Error("NEVER_EXECUTED");\n'); put(secret, '{"private":"PRIVATE_VALUE_SENTINEL"}\n'); put(pkg + '/checkpoint.json', '{"position":3}\n'); put(pkg + '/report.md', '# Report\n'); put(pkg + '/history/old.md', '# Frozen observation\n'); restore();
    git('init', '-q'); git('add', '--', 'AGENTS.md', '.agents', 'docs'); git('-c', 'user.name=fixture', '-c', 'user.email=fixture@local', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'task fixture', '--', 'AGENTS.md', '.agents', 'docs');
    const index = git('ls-files', '-s', '-z').toString(), rawHash = createHash('sha256').update(readFileSync(join(root, secret))).digest('hex'), gitHash = git('hash-object', '--', secret).toString().trim();
    const inv = opens(() => buildTaskInventory(root, { package: pkg }));
    assert('all-eight-roles-not-one-document', inv.value.state === 'classified' && new Set(inv.value.entries.map(e => e.role)).size === 8, JSON.stringify(inv.value));
    assert('config-default-private', inv.value.entries.find(e => e.path === secret)?.sensitivity === 'sensitive' && inv.value.entries.find(e => e.path === secret)?.contentAccess === 'withheld');
    assert('inventory-opens-no-task-member', !inv.paths.some(p => p.startsWith(join(root, pkg) + '/')) && inv.value.coverage.documentBodiesRead === 0);
    assert('directory-owner-and-retention-inherited', inv.value.package.owner === 'fixture-owner' && inv.value.package.retention === 'docs/retention.md' && inv.value.package.id === 'report-job');
    assert('inventory-no-private-body-or-fingerprint', !['PRIVATE_VALUE_SENTINEL', rawHash, gitHash].some(v => JSON.stringify(inv.value).includes(v)));
    const full = opens(() => buildInventory(root)); const secretEnv = full.value.envelopes.find(e => e.identity.path === secret);
    assert('default-metadata-withholds-private-member', secretEnv?.gaps.includes('metadata-privacy-excluded') && secretEnv.git.contentIdsWithheld && !full.paths.includes(join(root, secret)));
    assert('generic-query-hides-content-identities', !['PRIVATE_VALUE_SENTINEL', rawHash, gitHash].some(v => JSON.stringify(full.value).includes(v)));
    const workflow = opens(() => buildReadWorkflow(root, { selection: { paths: [secret] } })); assert('workflow-cannot-read-config', !workflow.paths.includes(join(root, secret)) && workflow.value.documents.length === 0);
    const source = prepareSourceSelection(root, { paths: [secret, receipt], nonSensitive: true });
    assert('explicit-non-sensitive-does-not-override-profile', readSourceSubset(source, [secret]).openedFiles === 0 && digestSourceSubset(source, [secret]).openedFiles === 0 && source.objects.some(x => x.reason === 'privacy-excluded'));
    const changes = opens(() => buildGitChangeQuery(root, { base: 'HEAD', within: [pkg], nonSensitive: true })); assert('git-observation-does-not-hash-config', !changes.paths.includes(join(root, secret)) && !JSON.stringify(changes.value).includes(gitHash));
    const normal = observe();
    assert('completion-from-receipt', normal.state === 'completed' && normal.exitCode === 0 && normal.result.businessOutcome === 'completed', JSON.stringify(normal));
    assert('signals-kept-separate', normal.result.schedulerStatus === 'success' && normal.result.exitCode === 0 && normal.result.evidenceCompleteness === 'complete' && normal.assurance.schedulerSuccessIsBusinessCompletion === false);
    assert('real-receipt-location-and-digest', normal.sourceRef.locator.pointer === '/rounds/0' && normal.sourceRef.revision.algorithm === 'sha256' && /Z$/.test(normal.sourceRef.observedAt));
    assert('receipt-body-not-echoed', !JSON.stringify(normal).includes('OUTCOME_BODY_SENTINEL') && !JSON.stringify(normal).includes('RECEIPT_SENTINEL'));
    assert('no-execution-or-record-created', !existsSync(join(root, 'NEVER_EXECUTED')) && !existsSync(join(root, 'docs/records')) && index === git('ls-files', '-s', '-z').toString());
    for (const [native, expected, code] of [['done', 'completed', 0], ['noop', 'empty', 0], ['failed', 'failed', 1], ['busy', 'running', 1], ['skipped', 'not-executed', 1]]) {
      restore(); ledger(d => { d.rounds[0].result = native; }); const result = observe(); assert('native-outcome-' + native, result.state === expected && result.exitCode === code);
    }
    restore(); ledger(d => { delete d.rounds[0].result; }); assert('scheduler-and-zero-exit-not-completion', observe().state === 'incomplete');
    restore(); ledger(d => { d.rounds = []; }); assert('no-row-not-empty', observe().gaps.includes('task/invocation-not-observed') && observe().state === 'incomplete');
    restore(); ledger(d => { d.rounds[0].id = 'previous-round'; }); assert('old-round-not-current-round', observe().gaps.includes('task/invocation-not-observed'));
    restore(); ledger(d => { d.rounds[0].task = 'another-task'; }); assert('other-task-not-authority', observe().gaps.includes('task/invocation-not-observed'));
    restore(); ledger(d => { d.rounds.push(row()); }); assert('duplicate-round-not-selected', observe().gaps.includes('task/invocation-ambiguous'));
    for (const value of [false, null, 'true']) { restore(); ledger(d => { d.rounds[0].evidenceComplete = value; }); assert('evidence-gap-' + value, observe().state === 'incomplete'); }
    restore(); ledger(d => { d.rounds[0].exitCode = 9; }); const conflict = observe(); assert('failure-not-conflated-with-business-outcome', conflict.state === 'incomplete' && conflict.result.businessOutcome === 'completed' && conflict.gaps.includes('task/completion-exit-conflict'));
    restore(); ledger(d => { d.rounds[0].result = 'unmapped-native-result'; }); assert('unknown-outcome-not-guessed', observe().gaps.includes('task/outcome-unmapped'));
    for (const edit of [d => { d.rounds[0].exitCode = 1.5; }, d => { d.rounds[0].at = '2026-02-30'; }, d => { d.rounds[0].scheduler = {}; }]) { restore(); ledger(edit); assert('invalid-signal-not-complete', observe().state === 'incomplete'); }
    restore(); ledger(d => { d.rounds.unshift({ id: 'older', task: 'other', result: {}, evidenceComplete: 'unknown' }); }); assert('unrelated-row-body-not-interpreted', observe().state === 'completed' && observe().sourceRef.locator.pointer === '/rounds/1');
    restore(); ledger(d => { d.rounds.push({ result: 'done' }); }); assert('unknown-row-identity-does-not-hide-duplicate', observe().gaps.includes('task/receipt-unparsed'));
    restore(); put(receipt, JSON.stringify({ rounds: [row()] }).replace('"exitCode":0', '"exitCode":1e-9999')); assert('underflow-is-not-zero-exit', observe().state === 'incomplete');
    restore(); put(receipt, JSON.stringify({ rounds: [row()] }).replace('"exitCode":0', '"exitCode":-1e-9999')); assert('negative-underflow-is-not-zero-exit', observe().state === 'incomplete');
    restore(); ledger(d => { d.unrelatedNumber = 1e300; }); assert('unrelated-native-fields-not-validated', observe().state === 'completed');
    for (const bytes of [Buffer.from('{"rounds":[],"rounds":[]}'), Buffer.from([0xff, 0xfe]), Buffer.from('\ufeff' + JSON.stringify({ rounds: [row()] }))]) { restore(); put(receipt, bytes); assert('ambiguous-or-invalid-json-rejected', observe().gaps.includes('task/receipt-unparsed')); }
    restore(); const shared = structuredClone(instance); shared.mappings[0].task.outcomeAuthority.path = 'docs/shared-ledger.json'; configure(shared); put('docs/shared-ledger.json', JSON.stringify({ rounds: [row(), { ...row(), task: 'other-task' }] })); git('add', '--', 'docs/shared-ledger.json'); assert('shared-authority-selects-task-and-round', observe({ receipt: 'docs/shared-ledger.json' }).state === 'completed'); delete shared.mappings[0].task.outcomeAuthority.fields.taskId; reject('shared-authority-needs-task-key', () => normalizeInstance(shared, base.types));
    restore(); const excludedInventory = buildTaskInventory(root, { package: pkg, exclusions: [secret] }); assert('inventory-explicit-exclusion-hides-member-name', !JSON.stringify(excludedInventory).includes(secret));
    restore(); const single = structuredClone(instance); delete single.mappings[0].task.outcomeAuthority.recordsPointer; configure(single); put(receipt, JSON.stringify(row())); assert('single-native-receipt', observe().state === 'completed' && observe().sourceRef.locator.pointer === '');
    restore(); const expected = 'sha256:raw-bytes/1:' + createHash('sha256').update(readFileSync(join(root, receipt))).digest('hex'); assert('expected-revision-match', observe({ expectedRevision: expected }).state === 'completed'); ledger(d => { d.extra = true; }); assert('revision-drift-keeps-outcome-unknown', observe({ expectedRevision: expected }).gaps.includes('task/receipt-revision-changed') && observe({ expectedRevision: expected }).result === null);
    restore(); assert('wrong-receipt-never-opened', opens(() => observe({ receipt: pkg + '/report.md' })).value.observation.openedFiles === 0);
    assert('explicit-exclusion-never-opened', opens(() => observe({ exclusions: [receipt] })).value.observation.openedFiles === 0);
    assert('budget-never-creates-prefix-proof', observe({ maxBytes: 8 }).observation.openedFiles === 0);
    assert('protected-no-read-or-downgrade', opens(() => observe({ protected: true })).paths.length === 0);
    reject('non-sensitive-required', () => observe({ nonSensitive: false })); reject('no-execution-option', () => observe({ execute: true })); reject('unknown-revision-encoding', () => observe({ expectedRevision: 'main' }));
    restore(); const changed = duringDecode(() => ledger(d => { d.rounds[0].result = 'failed'; })); assert('receipt-drift-withdraws-result', changed.gaps.includes('task/snapshot-changed') && !changed.sourceRef && !changed.result);
    restore(); const privacyChanged = duringDecode(() => { const next = structuredClone(instance); next.mappings[0].task.members.find(m => m.role === 'ledger').sensitivity = 'sensitive'; configure(next); }); assert('privacy-change-withdraws-result', privacyChanged.gaps.includes('task/snapshot-changed') && !privacyChanged.sourceRef);
    restore(); const boundaryChanged = duringDecode(() => put(pkg + '/new-config.json', '{"secret":"not-read"}')); assert('package-membership-change-withdraws-result', boundaryChanged.gaps.includes('task/snapshot-changed')); rmSync(join(root, pkg + '/new-config.json'));
    restore(); put(pkg + '/unknown.json', '{"private":"UNKNOWN_MEMBER_SENTINEL"}'); const unknown = opens(() => buildTaskInventory(root, { package: pkg, includeUntracked: true })); assert('new-members-not-implicitly-approved', unknown.value.state === 'incomplete' && unknown.value.entries.some(e => e.role === null && e.contentAccess === 'withheld') && !unknown.paths.includes(join(root, pkg + '/unknown.json')));
    const unknownRead = opens(() => buildReadWorkflow(root, { selection: { paths: [pkg + '/unknown.json'] }, includeUntracked: true })); assert('unknown-members-not-readable', !unknownRead.paths.includes(join(root, pkg + '/unknown.json'))); rmSync(join(root, pkg + '/unknown.json'));
    for (const edit of [i => { i.mappings[0].kind = 'file'; }, i => { i.mappings[0].task.members[0].role = 'whole-task'; }, i => { i.mappings[0].task.members[0].path = 'docs/outside.md'; }, i => { i.mappings[0].task.members.push({ ...i.mappings[0].task.members[0] }); }, i => { i.mappings[0].task.outcomeAuthority.fields.outcome = '/id'; }, i => { i.mappings.push({ path: pkg + '/nested', kind: 'directory', task: i.mappings[0].task }); }, i => { i.mappings[0].task.unknown = true; }]) { const i = structuredClone(instance); edit(i); reject('invalid-profile-rejected', () => normalizeInstance(i, base.types)); }
    const privateParent = structuredClone(instance); privateParent.mappings[0].task.members.push({ path: pkg + '/protected', kind: 'directory', role: 'config' }, { path: pkg + '/protected/child.md', kind: 'file', role: 'output', sensitivity: 'non-sensitive' }); const normalized = normalizeInstance(privateParent, base.types); assert('child-cannot-downgrade-sensitive-parent', taskPrivatePath(normalized, pkg + '/protected/child.md') && taskMemberFor(normalized, pkg + '/protected/child.md').role === 'output');
    restore(); const guarded = structuredClone(instance); const guard = { schema: 'curia.guard/1', owner: 'fixture', authorityLinks: ['docs/README.md'], activation: 'explicit', onEmpty: 'fail', command: { program: 'node', script: 'checks/doc.mjs', args: [], cwd: '.', identityPaths: ['checks/doc.mjs'] }, inputScope: { mode: 'git', paths: [secret], exclusions: [], includeUntracked: false, includeIgnored: false }, effects: { write: false, network: false, externalSystems: false, sensitiveRead: false }, privacy: { sensitivePaths: [], output: 'discard', args: 'non-sensitive-static' }, environment: [], expectedExitCodes: [0], parser: { id: 'aggregate-exit/1', ruleIds: [] }, limits: { timeoutMs: 3000, killGraceMs: 100, maxOutputBytes: 65536, maxFiles: 128, maxFileBytes: 1024 * 1024, maxTotalBytes: 4 * 1024 * 1024, cpuMs: null, memoryBytes: null, maxProcesses: null } };
    guarded.recordStore = { schema: 'curia.record-store/1', path: 'docs/records/runs', owner: 'fixture', authorityLinks: ['docs/README.md'] }; guarded.guards = { task: guard }; put('checks/doc.mjs', 'throw Error("DO_NOT_RUN");\n'); git('add', '--', 'checks/doc.mjs'); configure(guarded);
    const guardRead = opens(() => reject('guard-plan-cannot-hash-task-secret', () => buildGuardPlan(root, 'task'))); assert('guard-never-opened-secret', !guardRead.paths.includes(join(root, secret)));
    guarded.guards.task.effects.sensitiveRead = true; configure(guarded); const plan = opens(() => buildGuardPlan(root, 'task')); assert('explicit-sensitive-guard-still-metadata-only', !plan.paths.includes(join(root, secret)) && !JSON.stringify(plan.value).includes(rawHash) && !JSON.stringify(plan.value).includes(gitHash));
    guarded.guards.task.command.identityPaths = [secret]; configure(guarded); reject('private-command-identity-rejected', () => buildGuardPlan(root, 'task'));
    guarded.guards.task.effects.sensitiveRead = false; guarded.guards.task.command.identityPaths = ['checks/doc.mjs']; guarded.guards.task.inputScope = { mode: 'filesystem', paths: ['docs/jobs'], exclusions: [secret], includeUntracked: true, includeIgnored: true }; configure(guarded); let scopedPlan, scopedError; try { scopedPlan = buildGuardPlan(root, 'task'); } catch (error) { scopedError = error; } assert('filesystem-scope-allows-classified-public-members', !!scopedPlan, scopedError?.message ?? '');
    guarded.guards.task.effects.sensitiveRead = false; guarded.guards.task.inputScope.paths = [receipt]; guarded.guards.task.command = { program: 'absolute', path: join(root, secret), args: [], cwd: '.', identityPaths: ['checks/doc.mjs'] }; chmodSync(join(root, secret), 0o755); configure(guarded);
    const executableRead = opens(() => reject('task-private-executable-rejected-before-hash', () => buildGuardPlan(root, 'task'))); assert('private-executable-never-opened', !executableRead.paths.includes(join(root, secret)));
    symlinkSync(join(root, secret), join(root, 'checks/alias')); guarded.guards.task.command.path = join(root, 'checks/alias'); configure(guarded); const aliasRead = opens(() => reject('task-private-executable-alias-rejected', () => buildGuardPlan(root, 'task'))); assert('private-executable-alias-never-opened', !aliasRead.paths.includes(join(root, secret))); rmSync(join(root, 'checks/alias')); chmodSync(join(root, secret), 0o644);
    restore(); const argv = ['tasks', 'outcome', '--root', root, '--package', pkg, '--receipt', receipt, '--invocation', 'round-1', '--non-sensitive', '--json']; const command = () => spawnSync(process.execPath, [cli, ...argv], { cwd: root, env, encoding: 'utf8' });
    let cmd = command(); assert('public-cli-complete', cmd.status === 0 && JSON.parse(cmd.stdout).state === 'completed', cmd.stderr);
    ledger(d => { d.rounds[0].result = 'failed'; }); cmd = command(); assert('public-cli-failed', cmd.status === 1 && JSON.parse(cmd.stdout).state === 'failed');
    ledger(d => { d.rounds = []; }); cmd = command(); assert('public-cli-missing-not-empty', cmd.status === 2 && JSON.parse(cmd.stdout).state === 'incomplete');
    cmd = spawnSync(process.execPath, [cli, 'tasks', 'inventory', '--root', root, '--package', pkg, '--json'], { cwd: root, env, encoding: 'utf8' }); assert('public-cli-inventory', cmd.status === 0 && JSON.parse(cmd.stdout).coverage.documentBodiesRead === 0, cmd.stderr);
    reject('duplicate-cli-option', () => parseTaskArgs(['outcome', '--receipt', receipt, '--receipt', receipt])); reject('unknown-cli-command', () => parseTaskArgs(['run']));
  } finally { rmSync(root, { recursive: true, force: true }); }
}
if (isMainModule(import.meta.url)) {
  let passed = 0; const failures = [];
  taskFixtures({ registry: JSON.parse(readFileSync(join(ROOT, '.agents/doc-types.json'), 'utf8')), expectTrue: (name, ok, detail = '') => ok ? passed++ : failures.push(`${name}: ${detail}`) });
  console.log(JSON.stringify({ passed, failed: failures.length, failures }, null, 2)); if (failures.length) process.exitCode = 1;
}
