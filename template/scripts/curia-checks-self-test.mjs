/** Disposable documentation-check batches. Long-lived supervision cases are opt-in, cloud-only here. */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { ROOT, isMainModule } from './doc-lib.mjs';
import { buildCheckPlan, runChecks, parseCheckArgs } from './curia-checks.mjs';
import { buildGuardPlan, executeCheckGuard } from './curia-guards.mjs';
import { beginCheckRecord, claimCheckExecution, appendCheckReceipt, finishCheckRecord, loadRecordStore, rawDigest, showRun, validateRecordFiles, appendObservation } from './curia-records.mjs';
import { CHECK_LIMITS, validateCheckBegin, impactObservationIdentity } from './curia-check-contract.mjs';
import { MOVE_CONFIGURATION_IMPACT_RULES } from './curia-workflow.mjs';

export async function checkFixtures({ expectTrue, registry, supervision = false }) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'curia-check-batch-'))), cli = fileURLToPath(new URL('./curia-checks.mjs', import.meta.url)), store = 'docs/records/runs';
  const env = { ...process.env }; for (const key of Object.keys(env)) if (key.startsWith('GIT_') || ['CURIA_ROOT', 'CURIA_STAGED', 'CURIA_ROOT', 'CURIA_STAGED'].includes(key)) delete env[key];
  const git = (...args) => execFileSync('git', args, { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] });
  const put = (path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
  const assert = (name, value, detail = '') => expectTrue(`Curia checks [${name}]`, !!value, detail);
  const reject = async (name, fn) => { let error; try { await fn(); } catch (e) { error = e; } assert(name, error, error?.stack ?? '未拒绝'); };
  const md = (body, fields = '') => `# Fixture\n\nStatus: current\nOwner: fixture\n${fields}\n\n${body}\n`;
  const a = 'docs/input/a.md', b = 'docs/input/b.md', other = 'docs/other/unused.md';
  const guard = (id, paths) => ({ schema: 'curia.guard/1', owner: 'fixture', authorityLinks: ['docs/README.md'], activation: 'explicit', onEmpty: 'fail', command: { program: 'node', script: `checks/${id}.mjs`, args: [], cwd: '.', identityPaths: [`checks/${id}.mjs`] }, inputScope: { mode: 'git', paths, exclusions: [], includeUntracked: false, includeIgnored: false }, effects: { write: false, network: false, externalSystems: false, sensitiveRead: false }, privacy: { sensitivePaths: [], output: 'discard', args: 'non-sensitive-static' }, environment: [], expectedExitCodes: [0], parser: { id: 'aggregate-exit/1', ruleIds: [] }, limits: { timeoutMs: 2000, killGraceMs: 50, maxOutputBytes: 16384, maxFiles: 32, maxFileBytes: 1024 * 1024, maxTotalBytes: 2 * 1024 * 1024, cpuMs: null, memoryBytes: null, maxProcesses: null } });
  const cfg = structuredClone(registry);
  cfg.instance = { schema: 'curia.instance/1', owner: 'fixture', surfaces: [
    { id: 'control', kind: 'root', members: [{ path: '.agents', kind: 'directory', role: 'control' }], entry: '.agents/README.md', authorityLinks: ['AGENTS.md'] },
    { id: 'knowledge', kind: 'root', members: [{ path: 'docs', kind: 'directory', role: 'knowledge' }], entry: 'docs/README.md', authorityLinks: ['AGENTS.md'] },
  ], mappings: [{ path: 'docs', kind: 'directory', relations: { schema: 'curia.relations/1', parser: 'markdown-header-relations/1' } }], recordStore: { schema: 'curia.record-store/1', path: store, owner: 'fixture', authorityLinks: ['docs/README.md'] }, guards: {} };
  const save = () => put('.agents/doc-types.json', JSON.stringify(cfg));
  const restore = () => {
    cfg.instance.guards = { first: guard('first', [a]), second: guard('second', [b]), unused: guard('absent-never-opened', ['absent-input']) };
    put(a, md('A_BODY_NOT_EMITTED', 'Normative-refs: [B](b.md)')); put(b, md('B_BODY_NOT_EMITTED')); put(other, md('OTHER_BODY_NOT_EMITTED'));
    put('checks/first.mjs', "process.stdout.write('PRIVATE_OUTPUT_NOT_RETAINED');\n"); put('checks/second.mjs', 'process.exitCode = 0;\n'); save();
  };
  const input = { changed: [b], within: ['docs/input'], nonSensitive: true }, ids = ['first', 'unused', 'second'];
  const plan = (options = input, selected = ids) => buildCheckPlan(root, options, selected);
  const run = async (options = input, selected = ids, extra = {}) => { const p = plan(options, selected); return runChecks(root, options, selected, p.digest.value, extra); };
  const payload = p => ({ schema: 'curia.check-run/1', executionMode: 'impact-checks', inputSnapshot: p.inputSnapshot, planDigest: p.digest, checks: p.checks, coverage: p.coverage, budgets: p.budgets, risks: p.risks, unresolved: [], codeIdentity: p.codeIdentity, references: { corrects: null, retriedFrom: null } });
  const forged = (runId, change) => {
    const ctx = loadRecordStore(root), events = ctx.runs.get(runId).map(e => ({ path: e.path, data: structuredClone(e.data) })); change(events);
    let previous = null;
    for (let n = 0; n < events.length; n++) { const e = events[n]; e.data.previous = previous; const bytes = Buffer.from(JSON.stringify(e.data) + '\n'); previous = rawDigest(bytes).value; ctx.files.set(e.path, bytes); }
    return validateRecordFiles(ctx.files, store);
  };
  try {
    put('AGENTS.md', '# Rules\n'); put('.agents/README.md', '# Control\n'); put('docs/README.md', '# Authority\n'); put('.gitignore', 'ignored-probe\n'); restore();
    git('init', '-q'); git('add', '--', 'AGENTS.md', '.agents/doc-types.json', '.agents/README.md', 'docs/README.md', a, b, other, 'checks/first.mjs', 'checks/second.mjs', '.gitignore');
    git('-c', 'user.name=fixture', '-c', 'user.email=fixture@local', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'check fixture');
    const initialIndex = git('ls-files', '-sz'), p = plan();
    assert('preview-no-execution-or-record', p.readiness === 'ready' && !p.persisted && !p.commandExecuted && !existsSync(join(root, store)));
    assert('ordered-allowlist-no-unused-input-read', p.checks.map(c => `${c.id}:${c.state}`).join(',') === 'first:selected,unused:not-applicable,second:selected');
    assert('declared-coverage', p.coverage.complete && p.coverage.assignments[0].checks.join(',') === 'first' && p.coverage.assignments[1].checks.join(',') === 'second');
    assert('bounded-plan', p.budgets.commands === 2 && p.budgets.impactObservations <= CHECK_LIMITS.impactObservations && p.budgets.guardObservations <= CHECK_LIMITS.guardObservations);
    assert('preview-no-body-or-raw-output', !/A_BODY_NOT_EMITTED|B_BODY_NOT_EMITTED|PRIVATE_OUTPUT_NOT_RETAINED/.test(JSON.stringify(p)));
    assert('stable-confirmation', p.digest.value === plan().digest.value);
    const clockOnly = structuredClone(p.impact); clockOnly.sourceRefs[0].observedAt = '2000-01-01T00:00:00.000Z';
    assert('observation-clock-not-identity', impactObservationIdentity(clockOnly).value === impactObservationIdentity(p.impact).value);
    const changedRule = structuredClone(p.impact); changedRule.checks[0].version++;
    assert('rule-identity-retained', impactObservationIdentity(changedRule).value !== impactObservationIdentity(p.impact).value);
    const uncovered = plan(input, ['first']); assert('uncovered-not-ready', uncovered.readiness === 'blocked' && uncovered.coverage.uncovered.includes(b));
    await reject('uncovered-run-never-starts', () => runChecks(root, input, ['first'], uncovered.digest.value));
    assert('missing-all-checks-not-pass', plan(input, ['unused']).readiness === 'blocked');
    await reject('unknown-guard', () => plan(input, ['unknown']));
    await reject('duplicate-guard', () => plan(input, ['first', 'first']));
    await reject('forged-impact-json-not-input', () => plan({ ...input, impact: p.impact }));
    await reject('substitute-clock-not-supported', () => plan({ ...input, now: '2000-01-01T00:00:00.000Z' }));
    await reject('missing-confirmation', () => runChecks(root, input, ids));
    await reject('wrong-confirmation', () => runChecks(root, input, ids, '0'.repeat(64)));
    await reject('output-scan-needs-explicit-exclusion', () => plan({ ...input, within: ['docs'] }));
    await reject('output-git-scan-needs-explicit-exclusion', () => plan({ within: ['docs/input'], nonSensitive: true, gitBase: 'HEAD', changesWithin: ['docs'] }));
    cfg.instance.guards.first.inputScope.paths = ['docs']; save(); await reject('guard-output-scan-needs-exclusion', () => plan()); restore();
    cfg.instance.guards.first.privacy.sensitivePaths = [b]; cfg.instance.guards.first.effects.sensitiveRead = true; save();
    await reject('known-sensitive-impact-never-hashed', () => plan()); restore();
    cfg.instance.guards.first.limits.maxTotalBytes = CHECK_LIMITS.maxTotalBytes; save(); await reject('aggregate-budget-before-guard-reads', () => plan()); restore();
    put('checks/first.mjs', 'process.exitCode = 1;\n'); await reject('changed-command-invalidates-confirmation', () => runChecks(root, input, ids, p.digest.value)); restore();
    assert('rejections-did-not-record', !existsSync(join(root, store)));
    const passed = await run();
    assert('one-run-multiple-real-receipts', passed.status === 'passed' && passed.command === null && passed.commands.length === 2 && passed.commands.every(c => c.receipt.pid > 1 && c.receipt.exitCode === 0) && passed.events.length === 4 && loadRecordStore(root).runs.size === 1, JSON.stringify(passed.result));
    assert('na-not-success-or-phantom-command', passed.result.checks.find(c => c.id === 'unused').state === 'not-applicable' && passed.commands.every(c => c.checkId !== 'unused'));
    assert('business-remains-not-evaluated', passed.result.businessOutcome === 'not-evaluated' && passed.result.evidenceCompleteness.facts === 'not-verified');
    assert('raw-output-not-persisted', [...loadRecordStore(root).files.values()].every(bytes => !bytes.includes('PRIVATE_OUTPUT_NOT_RETAINED')));
    assert('show-batch-not-first-command', showRun(root, passed.runId).commands.length === 2 && showRun(root, passed.runId).schema === 'curia.check-run-view/1');
    await reject('mixed-event-version', () => forged(passed.runId, events => { events[1].data.schema = 'curia.run-event/2'; }));
    await reject('out-of-order-command', () => forged(passed.runId, events => { events[1].data.payload.checkId = 'second'; }));
    await reject('forged-terminal', () => forged(passed.runId, events => { events.at(-1).data.payload.checks[0].state = 'skipped'; }));
    await reject('manual-observation-cannot-fill-batch', () => appendObservation(root, passed.runId, passed.expectedHead, {}));
    const old = payload(plan()); old.checks[0].guard.schema = 'curia.guard-run/1'; await reject('no-privacy-downgrade', () => validateCheckBegin(old));
    const wrongRules = payload(plan()); wrongRules.inputSnapshot.impact.checks[0].version++;
    await reject('mixed-impact-rule-contracts', () => validateCheckBegin(wrongRules));
    const missingRules = payload(plan()); missingRules.inputSnapshot.impact.checks.pop();
    await reject('missing-impact-rule-contracts', () => validateCheckBegin(missingRules));
    const pp = plan(), begun = beginCheckRecord(root, payload(pp)), gp1 = buildGuardPlan(root, 'first');
    await reject('serialized-run-not-capability', () => claimCheckExecution(JSON.parse(JSON.stringify(begun.capability)), 'first', gp1.digest));
    await reject('claim-order-enforced', () => claimCheckExecution(begun.capability, 'second', pp.checks[2].guard.planDigest));
    await reject('serialized-plan-not-capability', () => executeCheckGuard(JSON.parse(JSON.stringify(gp1)), begun.capability));
    await reject('digest-alone-not-execution-capability', () => claimCheckExecution(begun.capability, 'first', gp1.digest));
    const first = await executeCheckGuard(gp1, begun.capability);
    await reject('claimed-check-cannot-run-twice', () => executeCheckGuard(gp1, begun.capability));
    await reject('fake-success-not-receipt', () => appendCheckReceipt(begun.capability, { status: 'exited', exitCode: 0 }, []));
    await reject('unknown-command-stays-open', () => finishCheckRecord(begun.capability));
    appendCheckReceipt(begun.capability, first.handle, first.inputDrift);
    const second = await executeCheckGuard(buildGuardPlan(root, 'second'), begun.capability); appendCheckReceipt(begun.capability, second.handle, second.inputDrift);
    assert('capability-sequence-real-success', finishCheckRecord(begun.capability).status === 'passed');
    await reject('terminal-capability-frozen', () => claimCheckExecution(begun.capability, 'first', gp1.digest));
    put('checks/first.mjs', 'process.exitCode = 7;\n'); const failed = await run();
    assert('fail-fast-preserves-exit-and-skips', failed.status === 'failed' && failed.commands.length === 1 && failed.commands[0].receipt.exitCode === 7 && failed.result.checks.find(c => c.id === 'second').state === 'skipped'); restore();
    await reject('failed-terminal-cannot-be-promoted', () => forged(failed.runId, events => { events.at(-1).data.payload.status = 'passed'; events.at(-1).data.payload.exitCode = 0; }));
    await reject('no-command-after-failure', () => forged(failed.runId, events => { events.at(-1).data.kind = 'command'; events.at(-1).data.payload = { checkId: 'second', receipt: events[1].data.payload.receipt }; }));
    const incomplete = beginCheckRecord(root, payload(plan()));
    const skipped = finishCheckRecord(incomplete.capability);
    assert('unexecuted-run-not-pass', skipped.status === 'incomplete' && skipped.commands.length === 0 && skipped.result.checks.filter(c => c.state === 'skipped').length === 2);
    const afterBegin = async mutate => {
      const known = new Set(loadRecordStore(root).runs.keys()), Native = globalThis.TextDecoder; let changed = false;
      globalThis.TextDecoder = class extends Native { decode(...args) {
        const text = super.decode(...args);
        if (!changed && text.includes('"executionMode": "impact-checks"')) {
          const event = JSON.parse(text);
          if (event.kind === 'begin' && !known.has(event.runId) && existsSync(join(root, store, `${event.runId}.00000000.json`))) { changed = true; mutate(); }
        }
        return text;
      } };
      try { const result = await run(); assert('after-begin-mutation-hook', changed); return result; }
      finally { globalThis.TextDecoder = Native; }
    };
    const preflight = await afterBegin(() => put(a, md('PREFLIGHT', 'Normative-refs: [B](b.md)')));
    assert('preflight-drift-no-command-start', preflight.status === 'blocked' && preflight.commands.length === 1 && preflight.commands[0].receipt.pid === null); restore();
    const changedConfig = await afterBegin(() => { cfg.instance.owner = 'changed-owner'; save(); });
    assert('configuration-drift-no-new-authority-execution', changedConfig.status === 'blocked' && changedConfig.commands[0].receipt.pid === null); cfg.instance.owner = 'fixture'; restore();
    const changedIndex = await afterBegin(() => { put(a, md('STAGED_CHANGE')); git('add', '--', a); });
    assert('index-drift-before-execution', changedIndex.status === 'blocked' && changedIndex.commands[0].receipt.pid === null); restore(); git('add', '--', a);
    const changedCommand = await afterBegin(() => put('checks/first.mjs', 'process.exitCode = 9;\n'));
    assert('command-drift-before-execution', changedCommand.status === 'blocked' && changedCommand.commands[0].receipt.pid === null); restore();
    const abort = new AbortController(); abort.abort(); const cancelled = await run(input, ids, { signal: abort.signal });
    assert('pre-cancel-no-pid-no-later-check', cancelled.status === 'cancelled' && cancelled.commands.length === 1 && cancelled.commands[0].receipt.pid === null);
    cfg.instance.guards.first.effects.write = true; save(); put('checks/first.mjs', `import { appendFileSync } from 'node:fs'; appendFileSync('${a}', '\\nchanged\\n');\n`);
    const drifted = await run(); assert('source-drift-stops-next-check', drifted.status === 'incomplete' && drifted.commands.length === 1 && drifted.result.checks[0].result.unresolved.length > 0); restore();
    cfg.instance.guards.second.effects.write = true; save(); put('checks/second.mjs', `import { appendFileSync } from 'node:fs'; appendFileSync('${a}', '\\nchanged\\n');\n`);
    const earlier = await run(); assert('later-command-invalidates-earlier-input', earlier.status === 'incomplete' && earlier.result.drift.includes('$guard/first')); restore();
    const all = { ...input, within: ['docs'], exclusions: [store, 'docs/README.md', 'docs/other'], includeUntracked: true };
    const selfOutput = await run(all); assert('all-explicit-output-exclusion-no-self-drift', selfOutput.status === 'passed', JSON.stringify(selfOutput.result));
    const none = { within: ['docs/input'], gitBase: 'HEAD', changesWithin: ['docs/input'], nonSensitive: true };
    assert('git-no-changes-not-applicable', plan(none).readiness === 'not-applicable');
    await reject('empty-run-does-not-pass', () => run(none));
    put(b, md('B_NEW')); const gitRun = await run(none); assert('observed-git-input-executes', gitRun.status === 'passed'); restore();
    put(a, md('UNRESOLVED', 'Normative-refs: [missing](outside.md)')); const graphGap = plan();
    assert('incomplete-graph-blocks-execution', graphGap.readiness === 'blocked' && !graphGap.impact.complete); await reject('graph-gap-cannot-execute', () => run()); restore();
    const extra = 'docs/input/new.md'; put(extra, md('NEW_INPUT'));
    const allNew = { ...input, changed: [extra], includeUntracked: true };
    assert('untracked-candidate-uncovered', plan(allNew).readiness === 'blocked');
    cfg.instance.guards.first.inputScope.paths = [extra]; cfg.instance.guards.first.onEmpty = 'not-applicable'; save();
    const emptyInput = plan(allNew); assert('matched-empty-input-not-coverage', emptyInput.readiness === 'blocked' && !emptyInput.coverage.complete && emptyInput.checks[0].guard.inputSnapshot.documents.length === 0);
    cfg.instance.guards.first.inputScope.includeUntracked = true; save();
    const newRun = await run(allNew); assert('authorized-untracked-source-executes', newRun.status === 'passed' && newRun.commands.length === 1);
    rmSync(join(root, extra)); restore();
    const config = { ...input, changed: ['.agents/doc-types.json'], configuration: 'only' };
    const configured = await run(config), configuredEvents = loadRecordStore(root).runs.get(configured.runId);
    assert('configuration-only-supported', configured.status === 'passed' && configured.schema === 'curia.check-run-view/3' && configuredEvents.every(e => e.data.schema === 'curia.run-event/9') && configured.inputs.impact.scope.configurationSchema === 'curia.configuration-dependencies/3');
    assert('configuration-single-no-phantom-secondary', configured.inputs.impactScope === 'primary-repository-only' && !configured.limitations.includes('secondary-inputs-not-reobserved-by-show'));
    assert('configuration-include-supported', (await run({ ...config, configuration: 'include' })).status === 'passed');
    const guardChange = { ...config, changed: ['checks/second.mjs'] }, guardChangePlan = plan(guardChange);
    assert('configuration-guard-code-reaches-batch', guardChangePlan.readiness === 'ready' && guardChangePlan.coverage.targets.join(',') === b && guardChangePlan.checks.filter(c=>c.state==='selected').map(c=>c.id).join(',') === 'second');
    assert('configuration-guard-code-batch-receipt', (await run(guardChange)).status === 'passed');
    const legacyConfigured = structuredClone(configuredEvents[0].data.payload);
    legacyConfigured.inputSnapshot.impact.scope.configurationSchema = 'curia.configuration-dependencies/2';
    legacyConfigured.inputSnapshot.impact.checks = MOVE_CONFIGURATION_IMPACT_RULES.map(c=>({id:c.id,version:c.version,state:c.id==='curia-impact/inspection'?'not-applicable':'pass'}));
    let legacyAccepted=true;try{validateCheckBegin(legacyConfigured);}catch{legacyAccepted=false;}
    assert('configuration-legacy-codec-keeps-frozen-rules',legacyAccepted);
    const downgradeConfigured=structuredClone(configuredEvents[0].data.payload);downgradeConfigured.inputSnapshot.impact.scope.configurationSchema='curia.configuration-dependencies/2';
    await reject('configuration-guard-rules-cannot-downgrade',()=>validateCheckBegin(downgradeConfigured));
    for (const [name, mutate] of [
      ['v1-downgrade', p => p.schema = 'curia.check-run/1'], ['v2-downgrade', p => p.schema = 'curia.check-run/2'],
      ['missing-config-version', p => delete p.inputSnapshot.impact.scope.configurationSchema], ['wrong-config-version', p => p.inputSnapshot.impact.scope.configurationSchema = 'curia.configuration-dependencies/1'],
      ['no-config-mode', p => p.inputSnapshot.impact.scope.configuration = null], ['rules-downgrade', p => p.inputSnapshot.impact.checks.find(c => c.id === 'curia-impact/configuration').version = 1],
      ['scope-upgrade', p => p.inputSnapshot.impactScope = 'all-repositories'],
    ]) { const bad = structuredClone(configuredEvents[0].data.payload); mutate(bad); await reject('configuration-contract-' + name, () => validateCheckBegin(bad)); }
    await reject('configuration-event-version-mix', () => forged(configured.runId, events => { events[1].data.schema = 'curia.run-event/3'; }));
    cfg.instance.moves = { schema: 'curia.moves/1', artifacts: [{ id: 'manual', current: a, previous: [{ path: b, revision: git('rev-parse', 'HEAD').toString().trim(), basis: [other] }] }] }; save();
    const moveInput = { changed: [other], within: ['docs/input'], nonSensitive: true, configuration: 'only' }, movePlan = plan(moveInput), moved = await run(moveInput);
    assert('move-basis-executable-batch', movePlan.impact.impact.reviewPaths.join(',') === a && moved.status === 'passed' && moved.commands.length === 1 && moved.commands[0].checkId === 'first' && moved.schema === 'curia.check-run-view/3');
    const reused = plan({ ...moveInput, changed: [b] }); assert('historical-path-reuse-does-not-execute-moved-check', reused.checks.find(c => c.id === 'first').state === 'not-applicable' && reused.checks.find(c => c.id === 'second').state === 'selected');
    const beforeMoveIdentity = movePlan.inputSnapshot.impact.identity.value; cfg.instance.moves.artifacts[0].previous[0].revision = 'f'.repeat(40); save();
    assert('historical-revision-is-confirmed-impact-identity', plan(moveInput).inputSnapshot.impact.identity.value !== beforeMoveIdentity);
    await reject('changed-move-invalidates-confirmation', () => runChecks(root, moveInput, ids, movePlan.digest.value)); delete cfg.instance.moves; restore();
    cfg.instance.guards.first.inputScope.paths.push(other); cfg.instance.guards.first.privacy.sensitivePaths = [other]; cfg.instance.guards.first.effects.sensitiveRead = true; save();
    const privatePlan = plan(); assert('sensitive-guard-input-blocks-batch', privatePlan.readiness === 'blocked' && privatePlan.checks[0].guard.inputSnapshot.documents.find(d => d.path === other).digest === null);
    await reject('sensitive-unknown-not-pass', () => run()); restore();
    cfg.instance.guards.first.effects.sensitiveRead = true;
    cfg.instance.guards.first.environment = [{ name: 'NATIVE_BATCH_FIXTURE_SECRET', source: 'inherit', required: false }]; save();
    delete process.env.NATIVE_BATCH_FIXTURE_SECRET;
    assert('absent-optional-environment-is-observable', plan().readiness === 'ready');
    process.env.NATIVE_BATCH_FIXTURE_SECRET = 'BATCH_PRIVATE_ENV_VALUE_NEVER_HASHED';
    const envPlan = plan(), envJSON = JSON.stringify(envPlan);
    assert('inherited-environment-unknown-not-complete', envPlan.readiness === 'blocked' && envPlan.unresolved.some(g => g.code === 'check-environment-identity-unknown'));
    assert('inherited-environment-no-value-or-digest', !envJSON.includes(process.env.NATIVE_BATCH_FIXTURE_SECRET) && !envJSON.includes(rawDigest(Buffer.from(process.env.NATIVE_BATCH_FIXTURE_SECRET)).value));
    await reject('unknown-environment-cannot-run', () => run());
    await reject('codec-refuses-inherited-environment-success', () => validateCheckBegin(payload(envPlan)));
    delete process.env.NATIVE_BATCH_FIXTURE_SECRET; restore();
    const badArgs = [['run', '--guard', 'first', '--changed', b, '--within', 'docs/input', '--non-sensitive'], ['plan', '--guard', 'first', '--guard', 'first'], ['plan', '--guard', 'first', '--inventory'], ['plan', '--guard', 'first', '--confirm', '0'.repeat(64)]];
    for (const args of badArgs) await reject('strict-cli-options', () => parseCheckArgs(args));
    const invoke = args => spawnSync(process.execPath, [cli, ...args], { cwd: root, env, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    const args = ['--root', root, '--guard', 'first', '--guard', 'second', '--changed', b, '--within', 'docs/input', '--non-sensitive', '--json'];
    const preview = invoke(['plan', ...args]); assert('real-plan-cli', preview.status === 0, preview.stderr);
    const command = invoke(['run', ...args, '--confirm', JSON.parse(preview.stdout).digest.value]); assert('real-run-cli', command.status === 0 && JSON.parse(command.stdout).commands.length === 2, command.stderr);
    const bad = invoke(['run', ...args, '--confirm', '0'.repeat(64)]); assert('real-cli-confirmation-fails', bad.status !== 0 && !bad.stdout);
    assert('shared-index-untouched-by-checks', initialIndex.equals(git('ls-files', '-sz')));
    const beforeFreeze = loadRecordStore(root), frozenPath = beforeFreeze.runs.get(passed.runId)[0].path, frozenBytes = readFileSync(join(root, frozenPath));
    git('add', '--', ...beforeFreeze.files.keys());
    git('-c', 'user.name=fixture', '-c', 'user.email=fixture@local', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'freeze batch events');
    put(frozenPath, Buffer.from(frozenBytes.toString().replace('impact-checks', 'fake-checks')));
    await reject('committed-batch-frozen', () => loadRecordStore(root)); put(frozenPath, frozenBytes);
    cfg.instance.recordStore.path = 'docs/elsewhere'; save(); await reject('record-store-move-cannot-bypass-freeze', () => loadRecordStore(root)); cfg.instance.recordStore.path = store; save();
    assert('historical-batch-remains-readable', showRun(root, passed.runId).status === 'passed');
    if (supervision) {
      put('checks/first.mjs', 'setInterval(() => {}, 1000);\n'); cfg.instance.guards.first.limits.timeoutMs = 100; save();
      const timed = await run(); assert('timeout-stops-and-preserves-status', timed.status === 'timed-out' && timed.commands.length === 1 && timed.result.checks.find(c => c.id === 'second').state === 'skipped'); restore();
      put('checks/first.mjs', "process.stdout.write('x'.repeat(65536));\n"); const limited = await run(); assert('output-limit-not-success', limited.status === 'resource-limit' && limited.commands.length === 1); restore();
      put('checks/first.mjs', 'setInterval(() => {}, 1000);\n'); const cancellation = new AbortController(), timer = setTimeout(() => cancellation.abort(), 30);
      try { const runningCancel = await run(input, ids, { signal: cancellation.signal }); assert('in-flight-cancellation-stops-batch', runningCancel.status === 'cancelled' && runningCancel.commands.length === 1); } finally { clearTimeout(timer); } restore();
      put('checks/first.mjs', 'process.kill(process.pid, "SIGKILL");\n'); const killed = await run(); assert('killed-command-not-success', killed.status === 'interrupted' && killed.commands.length === 1); restore();
    }
  } catch (error) { assert('unexpected-exception', false, error.stack); }
  finally { delete process.env.NATIVE_BATCH_FIXTURE_SECRET; rmSync(root, { recursive: true, force: true }); }
}
if (isMainModule(import.meta.url)) {
  const supervision = process.argv.includes('--supervision');
  if (supervision && process.env.CURIA_ENABLE_PROCESS_FIXTURES !== '1') throw new Error('进程监督夹具须显式启用，在本工作区通过调试云执行');
  let passed = 0; const failed = [];
  await checkFixtures({ registry: JSON.parse(readFileSync(join(ROOT, '.agents/doc-types.json'), 'utf8')), supervision, expectTrue: (name, ok, detail) => ok ? passed++ : failed.push(`${name}: ${detail}`) });
  console.log(`check batch fixtures: ${passed} passed; ${failed.length} failed`); for (const f of failed) console.error(f); if (failed.length) process.exitCode = 1;
}
