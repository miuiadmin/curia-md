/** Static documentation fixtures: actual two-repository guards, no business runtime or network. */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ROOT, isMainModule } from './doc-lib.mjs';
import { buildGuardPlan, reobserveGuardPlan, runGuard, parseGuardArgs, guardRunSchema } from './curia-guards.mjs';
import { buildCheckPlan, runChecks, parseCheckArgs } from './curia-checks.mjs';
import { normalizeGuards, validateGuardBegin, validateGuardReceipt } from './curia-guard-contract.mjs';
import { normalizeRepositoryRequest, primaryGuardInput, repositoryBindingDigest, repositoryEnvironment, REPOSITORY_ENV } from './curia-guard-contract.mjs';
import { loadRecordStore, showRun, rawDigest, validateRecordFiles, beginGuardRecord, appendGuardReceipt } from './curia-records.mjs';
import { superviseGuard } from './curia-guard-runtime.mjs';
import { runCheck } from './check-records.mjs';

export async function multiGuardFixtures({ registry, expectTrue }) {
  const base = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'curia-multiguard-'))), cases = [];
  const env = { ...process.env }; for (const k of Object.keys(env)) if (k.startsWith('GIT_') || ['CURIA_ROOT', 'CURIA_STAGED', 'CURIA_ROOT', 'CURIA_STAGED', 'NODE_OPTIONS'].includes(k)) delete env[k];
  let failures = 0;
  const assert = (name, ok, detail = '') => { if (!ok) failures++; expectTrue(`Curia multi-guard [${name}]`, !!ok, detail); };
  const reject = async (name, fn) => { let error; try { await fn(); } catch (e) { error = e; } assert(name, !!error, error?.message ?? '未拒绝'); };
  const git = (root, ...args) => execFileSync('git', args, { cwd: root, env, stdio: 'pipe' });
  const put = (root, p, bytes) => { fs.mkdirSync(dirname(join(root, p)), { recursive: true }); fs.writeFileSync(join(root, p), bytes); };
  const commit = root => git(root, '-c', 'user.name=fixture', '-c', 'user.email=fixture@local', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'documentation fixture');
  const doc = body => `# Input\n\nStatus: current\nOwner: fixture\n\n${body}\n`;
  const command = (extra = '', report = null) => `import fs from 'node:fs';const m=JSON.parse(process.env.CURIA_GUARD_REPOSITORIES),lib=m.repositories.find(r=>r.id==='lib').root;fs.readFileSync(m.primary.root+'/docs/input/a.md');fs.readFileSync(lib+'/docs/input/a.md');${extra}\nconsole.log(JSON.stringify(${report ?? "{schema:'curia.guard-status/2',checks:[{id:'pair/check',state:'pass'}],observedPaths:[{repository:'primary',path:'docs/input/a.md'},{repository:'lib',path:'docs/input/a.md'}]}"}));\n`;
  const make = (name, nested = false) => {
    const folder = join(base, name), root = join(folder, 'primary'), lib = nested ? join(root, 'vendor', 'lib') : join(folder, 'lib');
    const configs = new Map();
    for (const [id, target] of [['primary', root], ['lib', lib]]) {
      fs.mkdirSync(target, { recursive: true });
      const cfg = structuredClone(registry); cfg.instance = { schema: 'curia.instance/1', owner: 'fixture', surfaces: [
        { id: 'control', kind: 'root', members: [{ path: '.agents', kind: 'directory', role: 'control' }], entry: '.agents/README.md', authorityLinks: ['AGENTS.md'] },
        { id: 'knowledge', kind: 'root', members: [{ path: 'docs', kind: 'directory', role: 'knowledge' }], entry: 'docs/README.md', authorityLinks: ['AGENTS.md'] },
      ], mappings: [{ path: 'docs', kind: 'directory', relations: { schema: 'curia.relations/1', parser: 'markdown-header-relations/1' } }] };
      if (id === 'primary') {
        cfg.instance.recordStore = { schema: 'curia.record-store/1', path: 'docs/records/runs', owner: 'fixture', authorityLinks: ['docs/README.md'] };
        cfg.instance.guards = { pair: { schema: 'curia.guard/2', owner: 'fixture', authorityLinks: ['docs/README.md'], activation: 'explicit', onEmpty: 'fail', command: { program: 'node', script: 'checks/pair.mjs', args: [], cwd: '.', identityPaths: ['checks/pair.mjs'] }, inputScope: { mode: 'git', paths: ['docs/input'], exclusions: [], includeUntracked: false, includeIgnored: false }, repositoryInputs: [{ id: 'lib', within: ['docs/input'], exclusions: [], includeUntracked: false }], effects: { write: false, network: false, externalSystems: false, sensitiveRead: false }, privacy: { sensitivePaths: [], output: 'status-only', args: 'non-sensitive-static' }, environment: [], expectedExitCodes: [0], parser: { id: 'curia-guard-status/2', ruleIds: ['pair/check'] }, limits: { timeoutMs: 3000, killGraceMs: 50, maxOutputBytes: 16384, maxFiles: 32, maxFileBytes: 1024 * 1024, maxTotalBytes: 2 * 1024 * 1024, cpuMs: null, memoryBytes: null, maxProcesses: null } } };
        put(target, 'checks/pair.mjs', command());
      }
      put(target, 'AGENTS.md', '# Rules\n'); put(target, '.agents/README.md', '# Control\n'); put(target, 'docs/README.md', '# Authority\n'); put(target, 'docs/input/a.md', doc(id + '_BODY_NOT_RETAINED'));
      put(target, '.agents/doc-types.json', JSON.stringify(cfg)); configs.set(id, cfg);
      git(target, 'init', '-q', '-b', 'main'); git(target, 'add', '--', 'AGENTS.md', '.agents', 'docs', ...(id === 'primary' ? ['checks'] : [])); commit(target);
    }
    const options = { repositories: [{ id: 'lib', root: lib }], repositoriesNonSensitive: true };
    const f = { root, lib, cfg: configs.get('primary'), libCfg: configs.get('lib'), options, put: (p, b) => put(root, p, b), libPut: (p, b) => put(lib, p, b), save: () => put(root, '.agents/doc-types.json', JSON.stringify(configs.get('primary'))), plan: () => buildGuardPlan(root, 'pair', options), run: async () => { const p = f.plan(); return runGuard(root, 'pair', p.digest.value, options); } };
    cases.push(f); return f;
  };
  const watch = async (targets, action) => {
    let opens = 0; const original = fs.openSync;
    fs.openSync = function (p, ...args) { if (targets.includes(String(p))) opens++; return original.call(this, p, ...args); }; syncBuiltinESMExports();
    try { await action(); return opens; } finally { fs.openSync = original; syncBuiltinESMExports(); }
  };
  const afterBegin = async (f, mutate, action) => {
    let done = false; const original = fs.linkSync;
    fs.linkSync = function (from, to, ...args) { const result = original.call(this, from, to, ...args); if (!done && String(to).startsWith(f.root + '/') && String(to).endsWith('.00000000.json')) { done = true; mutate(); } return result; }; syncBuiltinESMExports();
    try { const value = await action(); assert('begin-interception-actually-fired', done); return value; } finally { fs.linkSync = original; syncBuiltinESMExports(); }
  };
  const beginPayload = p => ({ schema: guardRunSchema(p), executionMode: 'guard-command', adapterId: p.adapterId, adapter: p.adapter, inputSnapshot: p.inputSnapshot, planDigest: p.digest, risks: p.risks, unresolved: [], codeIdentity: p.codeIdentity, references: { corrects: null, retriedFrom: null } });
  const input = { changed: ['docs/input/a.md'], within: ['docs/input'], nonSensitive: true };
  try {
    const f = make('basic'), originalIndex = git(f.root, 'ls-files', '-sz'), libIndex = git(f.lib, 'ls-files', '-sz');
    const p = f.plan(); assert('versioned-independent-inputs', p.schema === 'curia.guard-plan/3' && p.inputSnapshot.schema === 'curia.guard-inputs/1' && p.inputSnapshot.coverage.repositoryCount === 2);
    assert('same-name-separate-heads', p.inputSnapshot.primary.source.git.head !== p.inputSnapshot.repositories[0].source.git.head && p.inputSnapshot.primary.documents[0].path === p.inputSnapshot.repositories[0].objects[0].path);
    assert('no-registry-merge', p.inputSnapshot.repositories[0].source.registry.digest.value !== p.inputSnapshot.primary.configuration.registry.value);
    assert('stable-confirmation', f.plan().digest.value === p.digest.value && reobserveGuardPlan(p).digest.value === p.digest.value);
    await reject('json-not-revalidation-capability', () => reobserveGuardPlan(JSON.parse(JSON.stringify(p))));
    assert('binding-hash-is-real-sha256', repositoryBindingDigest(p.inputSnapshot).value === createHash('sha256').update(repositoryEnvironment(p.inputSnapshot)).digest('hex'));
    const run = await f.run(), ctx = loadRecordStore(f.root), events = ctx.runs.get(run.runId);
    assert('actual-native-multi-run', run.status === 'passed' && run.command.pid && run.command.native.observedScope.paths.length === 2 && run.command.native.observedScope.kind === 'self-reported-multi-repository-not-traced');
    assert('new-event-container', events.every(e => e.data.schema === 'curia.run-event/7') && events[0].data.payload.schema === 'curia.guard-run/3');
    assert('actual-environment-bound-to-inputs', JSON.stringify(run.command.repositoryBindings) === JSON.stringify(repositoryBindingDigest(run.inputs)));
    assert('no-raw-input-or-output-persistence', !JSON.stringify([...ctx.files.values()].map(b => b.toString())).includes('BODY_NOT_RETAINED'));
    const batchPlan = buildCheckPlan(f.root, input, ['pair'], f.options), batch = await runChecks(f.root, input, ['pair'], batchPlan.digest.value, f.options);
    assert('batch-has-one-run-and-multi-mode', batch.status === 'passed' && batch.schema === 'curia.check-run-view/2' && batch.commands.length === 1 && batch.inputs.impactScope === 'primary-repository-only');
    assert('batch-versioned-event-eight', loadRecordStore(f.root).runs.get(batch.runId).every(e => e.data.schema === 'curia.run-event/8'));
    const configInput = { ...input, configuration: 'only' }, configuredPlan = buildCheckPlan(f.root, configInput, ['pair'], f.options), configured = await runChecks(f.root, configInput, ['pair'], configuredPlan.digest.value, f.options);
    assert('config-multi-uses-common-version-three', configured.status === 'passed' && configured.schema === 'curia.check-run-view/3' && configured.inputs.impactScope === 'primary-repository-only' && configured.limitations.includes('secondary-inputs-not-reobserved-by-show') && loadRecordStore(f.root).runs.get(configured.runId).every(e => e.data.schema === 'curia.run-event/9'));
    assert('input-indexes-untouched', originalIndex.equals(git(f.root, 'ls-files', '-sz')) && libIndex.equals(git(f.lib, 'ls-files', '-sz')));
    const recordBytes = new Map(loadRecordStore(f.root).files); fs.renameSync(f.lib, f.lib + '-offline');
    assert('history-does-not-reopen-secondary-root', showRun(f.root, run.runId).status === 'passed' && showRun(f.root, batch.runId).status === 'passed' && showRun(f.root, configured.runId).status === 'passed'); fs.renameSync(f.lib + '-offline', f.lib);
    assert('history-bytes-frozen', [...recordBytes].every(([path, bytes]) => loadRecordStore(f.root).files.get(path).equals(bytes)));
    for (const [name, mutate] of [
      ['implicit-ignored-forgery', q => q.inputSnapshot.repositories[0].omitted.ignored = 1], ['implicit-raw-forgery', q => q.inputSnapshot.repositories[0].omitted.raw = 1], ['wrong-count', q => q.inputSnapshot.coverage.repositoryCount = 1], ['wrong-head-owner', q => q.inputSnapshot.repositories[0].root = q.inputSnapshot.primary.source.git.root], ['missing-member', q => q.inputSnapshot.repositories = []], ['foreign-path', q => q.inputSnapshot.repositories[0].objects[0].path = 'elsewhere.txt'], ['mixed-state-forgery', q => q.inputSnapshot.repositories[0].inputState = 'mixed-tree'], ['privacy-downgrade', q => q.schema = 'curia.guard-run/2'], ['ambiguous-parser', q => q.adapter.parser.id = 'curia-guard-status/1'],
    ]) { const q = structuredClone(events[0].data.payload); mutate(q); await reject(name, () => validateGuardBegin(q)); }
    const receipt = structuredClone(run.command); receipt.repositoryBindings.value = '0'.repeat(64); await reject('receipt-root-binding-forgery', () => validateGuardReceipt(receipt, events[0].data.payload));
    const mixed = new Map(ctx.files), first = structuredClone(events[0].data); first.schema = 'curia.run-event/2'; mixed.set(events[0].path, Buffer.from(JSON.stringify(first) + '\n')); await reject('old-event-cannot-launder-multi-payload', () => validateRecordFiles(mixed, 'docs/records/runs'));
    for (const [name, options] of [['no-consent', { repositories: f.options.repositories }], ['missing-binding', {}], ['unknown-id', { repositories: [{ id: 'other', root: f.lib }], repositoriesNonSensitive: true }], ['duplicate-id', { repositories: [f.options.repositories[0], f.options.repositories[0]], repositoriesNonSensitive: true }], ['same-physical-root', { repositories: [{ id: 'lib', root: f.root }], repositoriesNonSensitive: true }]]) {
      const opened = await watch([join(f.lib, 'docs/input/a.md')], () => reject(name, () => buildGuardPlan(f.root, 'pair', options))); assert(name + '-no-secondary-body', opened === 0);
    }
    await reject('unknown-request-authority-not-ignored', () => normalizeRepositoryRequest({ ...f.options, authority: 'untrusted' }));
    await reject('bindings-cannot-carry-scopes', () => normalizeRepositoryRequest({ repositories: [{ ...f.options.repositories[0], within: ['elsewhere'] }], repositoriesNonSensitive: true }));
    const budget = make('budget'); budget.cfg.instance.guards.pair.limits.maxFiles = 1; budget.save();
    assert('shared-budget-before-body', await watch([join(budget.root, 'docs/input/a.md'), join(budget.lib, 'docs/input/a.md')], () => reject('whole-group-budget', () => budget.plan())) === 0);
    const sensitive = make('sensitive'); sensitive.libPut('docs/input/.env', 'PRIVATE_NEVER_HASHED'); git(sensitive.lib, 'add', '--', 'docs/input/.env');
    assert('implicit-privacy-not-complete', await watch([join(sensitive.lib, 'docs/input/.env')], () => reject('implicit-private-gap', () => sensitive.plan())) === 0);
    sensitive.cfg.instance.guards.pair.repositoryInputs[0].exclusions = ['docs/input/.env']; sensitive.save(); assert('explicit-private-exclusion-works', sensitive.plan().inputSnapshot.coverage.complete);
    const nested = make('nested', true); assert('explicit-nested-root-is-independent', (await nested.run()).status === 'passed');
    const dirty = make('dirty'); dirty.libPut('docs/input/a.md', doc('staged')); git(dirty.lib, 'add', '--', 'docs/input/a.md'); dirty.libPut('docs/input/a.md', doc('unstaged')); const dp = dirty.plan();
    assert('secondary-mixed-tree-not-primary-head', dp.inputSnapshot.repositories[0].inputState === 'mixed-tree' && dp.inputSnapshot.repositories[0].objects[0].staged === 'content' && dp.inputSnapshot.repositories[0].objects[0].worktreeChange === 'content' && dp.inputSnapshot.primary.source.worktreeState === 'matches-head-for-selected-inputs');
    await reject('dirty-secondary-invalidates-confirmation', () => runGuard(f.root, 'pair', p.digest.value, { ...f.options, repositories: [{ id: 'lib', root: dirty.lib }] }));
    const untracked = make('untracked'); git(untracked.lib, 'rm', '--cached', '--', 'docs/input/a.md'); await reject('reappeared-untracked-not-clean', () => untracked.plan()); untracked.cfg.instance.guards.pair.repositoryInputs[0].includeUntracked = true; untracked.save(); assert('explicit-untracked-source-captured', untracked.plan().inputSnapshot.repositories[0].objects[0].tracked === false);
    for (const isBatch of [false, true]) {
      const drift = make(isBatch ? 'post-batch' : 'post-single'); drift.cfg.instance.guards.pair.effects.write = true; drift.save(); drift.put('checks/pair.mjs', command("fs.appendFileSync(lib+'/docs/input/a.md','changed');"));
      const actual = isBatch ? await runChecks(drift.root, input, ['pair'], buildCheckPlan(drift.root, input, ['pair'], drift.options).digest.value, drift.options) : await drift.run();
      assert(isBatch ? 'batch-secondary-post-drift' : 'single-secondary-post-drift', actual.status === 'incomplete' && (actual.command ?? actual.commands[0].receipt).exitCode === 0);
      const before = make(isBatch ? 'pre-batch' : 'pre-single'); before.put('checks/pair.mjs', command("fs.writeFileSync('invoked.txt','yes');")); before.cfg.instance.guards.pair.effects.write = true; before.save();
      const pre = await afterBegin(before, () => before.libPut('docs/input/a.md', doc('changed-after-begin')), () => isBatch ? runChecks(before.root, input, ['pair'], buildCheckPlan(before.root, input, ['pair'], before.options).digest.value, before.options) : before.run());
      assert(isBatch ? 'batch-secondary-preflight-blocks' : 'single-secondary-preflight-blocks', pre.status === 'blocked' && !fs.existsSync(join(before.root, 'invoked.txt')) && (pre.command ?? pre.commands[0].receipt).pid === null);
    }
    const overflow = make('overflow'); overflow.put('checks/pair.mjs', command('', "{schema:'curia.guard-status/2',checks:[{id:'pair/check',state:'pass'}],observedPaths:[{repository:'foreign',path:'PRIVATE_UNEXPECTED_PATH'}]}")); const over = await overflow.run();
    assert('qualified-overflow-blocks-and-withholds-path', over.status === 'failed' && over.command.native.observedScope.outsideDeclaredCount === 1 && !JSON.stringify(over).includes('PRIVATE_UNEXPECTED_PATH'));
    const legacy = make('legacy-parser'); legacy.put('checks/pair.mjs', command('', "{schema:'curia.guard-status/1',checks:[{id:'pair/check',state:'pass'}],observedPaths:['docs/input/a.md']}")); assert('ambiguous-output-not-promoted', (await legacy.run()).status === 'incomplete');
    const combination = make('mixed-checks'), local = structuredClone(combination.cfg.instance.guards.pair);
    local.schema = 'curia.guard/1'; delete local.repositoryInputs; local.command.script = 'checks/local.mjs'; local.command.identityPaths = ['checks/local.mjs']; local.parser = { id: 'aggregate-exit/1', ruleIds: [] };
    combination.cfg.instance.guards.local = local; combination.put('checks/local.mjs', "import fs from 'node:fs';fs.readFileSync('docs/input/a.md');\n"); combination.save();
    const cp = buildCheckPlan(combination.root, input, ['local', 'pair'], combination.options);
    const cr = await runChecks(combination.root, input, ['local', 'pair'], cp.digest.value, combination.options);
    assert('mixed-legacy-multi-batch', cr.status === 'passed' && cr.commands.length === 2 && cr.commands[0].receipt.schema === 'curia.guard-receipt/1' && cr.commands[1].receipt.schema === 'curia.guard-receipt/2');
    combination.put('checks/local.mjs', 'process.exit(1);\n');
    const fp = buildCheckPlan(combination.root, input, ['local', 'pair'], combination.options);
    const fr = await runChecks(combination.root, input, ['local', 'pair'], fp.digest.value, combination.options);
    assert('mixed-batch-stops-before-secondary-command', fr.status === 'failed' && fr.commands.length === 1);
    combination.cfg.instance.guards.pair.inputScope.paths = ['docs/absent']; combination.save(); fs.renameSync(combination.lib, combination.lib + '-offline');
    const unselected = buildCheckPlan(combination.root, input, ['local', 'pair']);
    assert('unselected-secondary-not-probed-or-version-promoted', unselected.readiness === 'ready' && unselected.schema === 'curia.check-plan/1' && unselected.checks[1].state === 'not-applicable');
    await reject('unselected-binding-cannot-expand-input', () => buildCheckPlan(combination.root, input, ['local', 'pair'], combination.options));
    const binding = make('wrong-delivery'), bp = binding.plan(), begun = beginGuardRecord(binding.root, beginPayload(bp)), primary = primaryGuardInput(bp.inputSnapshot);
    const wrongEnv = repositoryEnvironment(bp.inputSnapshot).replace(binding.lib, binding.root);
    const handle = await superviseGuard(bp.adapter, { ...primary.commandIdentity.invocation, environment: { PATH: '/usr/bin:/bin', [REPOSITORY_ENV]: wrongEnv } }, { runId: begun.runId, inputPaths: [], declaredPaths: [] });
    await reject('actual-wrong-environment-cannot-sign-run', () => appendGuardReceipt(binding.root, begun.runId, begun.expectedHead, handle, [])); assert('wrong-delivery-keeps-open', showRun(binding.root, begun.runId).status === 'open');
    const cli = fileURLToPath(new URL('./curia-guards.mjs', import.meta.url));
    const cliArgs = ['plan', '--root', f.root, '--guard', 'pair', '--repo', JSON.stringify(f.options.repositories[0]), '--repositories-non-sensitive', '--json'];
    const preview = spawnSync(process.execPath, [cli, ...cliArgs], { env, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }); assert('real-cli-plan', preview.status === 0 && JSON.parse(preview.stdout).schema === 'curia.guard-plan/3', preview.stderr);
    await reject('cli-requires-independent-consent', () => parseGuardArgs(cliArgs.filter(a => a !== '--repositories-non-sensitive')));
    await reject('batch-cli-does-not-reuse-impact-consent', () => parseCheckArgs(['plan', '--guard', 'pair', '--changed', 'docs/input/a.md', '--within', 'docs/input', '--non-sensitive', '--repo', JSON.stringify(f.options.repositories[0])]));
    git(f.root, 'add', '--', ...loadRecordStore(f.root).files.keys()); commit(f.root); assert('event-seven-eight-staged-gate', runCheck(f.root, { staged: true }).ok);
    const frozen = events[0].path, bytes = fs.readFileSync(join(f.root, frozen)); put(f.root, frozen, Buffer.concat([bytes, Buffer.from(' ')])); await reject('frozen-event-seven-bytes', () => loadRecordStore(f.root)); put(f.root, frozen, bytes);
    assert('history-unchanged-after-freeze', showRun(f.root, run.runId).status === 'passed' && showRun(f.root, batch.runId).status === 'passed');
  } catch (error) { assert('unexpected-exception', false, error.stack); }
  finally { if (!failures) fs.rmSync(base, { recursive: true, force: true }); else console.error(`Multi-guard fixture retained for diagnosis: ${base}`); }
}
if (isMainModule(import.meta.url)) {
  let passed = 0; const failed = [];
  await multiGuardFixtures({ registry: JSON.parse(fs.readFileSync(join(ROOT, '.agents/doc-types.json'), 'utf8')), expectTrue: (name, ok, detail) => ok ? passed++ : failed.push(`${name}: ${detail}`) });
  console.log(JSON.stringify({ passed, failed }, null, 2)); if (failed.length) process.exitCode = 1;
}
