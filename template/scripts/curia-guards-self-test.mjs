/** Curia documentation-guard fixtures. Long-lived process simulations require the explicit supervision suite. */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { ROOT, isMainModule } from './doc-lib.mjs';
import { GUARD_RUN_SCHEMA, normalizeGuards, validateGuardBegin, validateGuardReceipt } from './curia-guard-contract.mjs';
import { buildGuardPlan, runGuard, parseGuardArgs } from './curia-guards.mjs';
import { appendGuardReceipt, beginGuardRecord, finishRun, finishGuardRecord, loadRecordStore, rawDigest, showRun } from './curia-records.mjs';
import { runCheck } from './check-records.mjs';
import { superviseGuard } from './curia-guard-runtime.mjs';

export async function guardFixtures({ expectTrue, registry, supervision = false }) {
  const root = mkdtempSync(join(tmpdir(), 'curia-native-guards-'));
  const store = 'docs/records/runs';
  const put = (path, content) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), content); };
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
  const assert = (name, value, detail = '') => expectTrue(`Curia guard [${name}]`, value, detail);
  const reject = async (name, fn, pattern = /guards\/|records\/|curia2\//) => { let error; try { await fn(); } catch (e) { error = e; } assert(name, !!error && pattern.test(error.message), error?.stack ?? '未拒绝'); };
  const cfg = structuredClone(registry);
  const guard = {
    schema: 'curia.guard/1', owner: 'native-project-owner', authorityLinks: ['docs/README.md'], activation: 'explicit', onEmpty: 'fail',
    command: { program: 'node', script: 'checks/doc.mjs', args: [], cwd: '.', identityPaths: ['checks/doc.mjs'] },
    inputScope: { mode: 'git', paths: ['docs/input'], exclusions: [], includeUntracked: false, includeIgnored: false },
    effects: { write: false, network: false, externalSystems: false, sensitiveRead: false },
    privacy: { sensitivePaths: [], output: 'discard', args: 'non-sensitive-static' }, environment: [], expectedExitCodes: [0], parser: { id: 'aggregate-exit/1', ruleIds: [] },
    limits: { timeoutMs: 3000, killGraceMs: 100, maxOutputBytes: 65536, maxFiles: 128, maxFileBytes: 1024 * 1024, maxTotalBytes: 4 * 1024 * 1024, cpuMs: null, memoryBytes: null, maxProcesses: null },
  };
  cfg.instance = { schema: 'curia.instance/1', owner: 'fixture-owner', surfaces: [
    { id: 'control', kind: 'root', entry: '.agents/README.md', authorityLinks: ['AGENTS.md'], members: [{ path: '.agents', kind: 'directory', role: 'control' }] },
    { id: 'knowledge', kind: 'root', entry: 'docs/README.md', authorityLinks: ['docs/README.md'], members: [{ path: 'docs', kind: 'directory', role: 'knowledge' }] },
  ], recordStore: { schema: 'curia.record-store/1', path: store, owner: 'fixture-owner', authorityLinks: ['docs/README.md'] }, guards: { docs: guard } };
  const save = () => put('.agents/doc-types.json', `${JSON.stringify(cfg, null, 2)}\n`);
  const script = (source) => put('checks/doc.mjs', source);
  const run = async () => { const plan = buildGuardPlan(root, 'docs'); return runGuard(root, 'docs', plan.digest.value); };
  const commit = (...paths) => { if (paths.length) git('add', '--', ...paths); git('-c', 'user.name=fixture', '-c', 'user.email=fixture@local', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'native guard fixture'); };
  try {
    put('AGENTS.md', '# Rules\n'); put('.agents/README.md', '# Control\n'); put('docs/README.md', '# Native authority\n');
    put('docs/input/manual.md', '# Manual\n\nBODY_NOT_COPIED\n'); put('docs/input/schema.json', '{"type":"object"}\n');
    script("import { readFileSync } from 'node:fs'; JSON.parse(readFileSync('docs/input/schema.json','utf8')); process.stdout.write('GUARD_SECRET_OUTPUT_NOT_RETAINED');\n"); save();
    git('init', '-q'); commit('AGENTS.md', '.agents/README.md', '.agents/doc-types.json', 'docs/README.md', 'docs/input/manual.md', 'docs/input/schema.json', 'checks/doc.mjs');
    const plan = buildGuardPlan(root, 'docs');
    assert('guard-plan-no-effects', !plan.commandExecuted && !plan.persisted && !loadRecordStore(root).runs.size);
    assert('guard-plan-stable', plan.digest.value === buildGuardPlan(root, 'docs').digest.value);
    assert('guard-snapshot-native-json', plan.inputSnapshot.documents.some((doc) => doc.path.endsWith('.json') && doc.digest) && plan.inputSnapshot.source.worktreeState === 'matches-head-for-selected-inputs');
    assert('guard-privacy-plan', !JSON.stringify(plan).includes('BODY_NOT_COPIED') && plan.risks.includes('trusted-local-command-not-sandboxed'));
    rmSync(join(root, 'docs/input/manual.md'));
    const unstagedDeletion = buildGuardPlan(root, 'docs');
    assert('guard-worktree-deletion-readable', unstagedDeletion.inputSnapshot.documents.some((doc) => doc.path === 'docs/input/manual.md' && doc.state === 'deleted' && doc.tracked));
    git('restore', '--worktree', '--', 'docs/input/manual.md');
    git('rm', '--', 'docs/input/manual.md');
    const stagedDeletion = buildGuardPlan(root, 'docs');
    assert('guard-staged-deletion-not-omitted', stagedDeletion.inputSnapshot.documents.some((doc) => doc.path === 'docs/input/manual.md' && doc.state === 'deleted' && doc.git.indexOid === null && doc.git.headOid) && stagedDeletion.inputSnapshot.source.stagedChanged.includes('docs/input/manual.md') && !stagedDeletion.inputSnapshot.source.untracked.includes('docs/input/manual.md'));
    const deletionRun = await runGuard(root, 'docs', stagedDeletion.digest.value);
    assert('guard-staged-deletion-run', deletionRun.status === 'passed' && deletionRun.inputs.source.worktreeState === 'mixed-tree' && deletionRun.inputs.source.trackedDeleted.includes('docs/input/manual.md'));
    git('rm', '--', 'docs/input/schema.json');
    const deletedDirectory = buildGuardPlan(root, 'docs');
    assert('guard-deleted-directory-not-empty', deletedDirectory.applicability === 'applicable' && deletedDirectory.inputSnapshot.documents.length === 2 && deletedDirectory.inputSnapshot.documents.every((doc) => doc.state === 'deleted'));
    git('restore', '--source=HEAD', '--staged', '--worktree', '--', 'docs/input/manual.md', 'docs/input/schema.json');
    await reject('guard-needs-confirmation', () => runGuard(root, 'docs', 'yes'));
    put('docs/input/manual.md', '# Modified input\n');
    await reject('guard-stale-plan', () => runGuard(root, 'docs', plan.digest.value));
    const mixed = buildGuardPlan(root, 'docs');
    assert('guard-mixed-tree', mixed.inputSnapshot.source.worktreeState === 'mixed-tree' && mixed.inputSnapshot.source.trackedModified.includes('docs/input/manual.md'));
    const first = await runGuard(root, 'docs', mixed.digest.value);
    assert('guard-actual-pass', first.status === 'passed' && first.terminal && first.command.exitCode === 0 && first.command.pid > 1 && first.result.businessOutcome === 'not-evaluated', JSON.stringify(first.result));
    assert('guard-no-raw-output', !JSON.stringify(first).includes('GUARD_SECRET_OUTPUT_NOT_RETAINED') && first.command.output.stdoutBytes > 0 && first.command.output.retained === 'none');
    assert('guard-aggregate-honest', first.command.output.parserState === 'aggregate-only' && first.command.native.checks.length === 0 && first.command.native.observedScope.kind === 'declared-union-not-traced');
    await reject('guard-manual-finish-forbidden', () => finishRun(root, first.runId, first.expectedHead));
    assert('guard-record-gate', runCheck(root).ok, JSON.stringify(runCheck(root).errors));
    const begin = loadRecordStore(root).runs.get(first.runId)[0].data.payload;
    for (const [name, edit] of [
      ['cleanup-not-started-with-pid', (r) => { r.cleanup.state = 'not-started'; }],
      ['hide-limitations', (r) => { r.limitations = []; }],
      ['optional-parser-for-executed-command', (r) => { r.output.parserState = 'not-applicable'; r.native.observedScope = { kind: 'not-applicable', paths: [] }; }],
      ['success-after-output-overflow', (r) => { r.output.stdoutBytes = begin.adapter.limits.maxOutputBytes + 1; }],
      ['unparsed-aggregate-only', (r) => { r.output.parserState = 'unparsed'; }],
    ]) {
      const invalid = structuredClone(first.command); edit(invalid);
      await reject(`guard-receipt-${name}`, () => validateGuardReceipt(invalid, begin));
    }

    script('process.exitCode = 7;\n');
    const failed = await run(); assert('guard-nonzero-fails', failed.status === 'failed' && failed.command.exitCode === 7 && failed.command.native.aggregate === 'fail');
    guard.expectedExitCodes = [0, 7]; save(); const accepted = await run();
    assert('guard-explicit-nonzero', accepted.status === 'passed' && accepted.command.exitCode === 7 && accepted.exitCode === 0);
    guard.expectedExitCodes = [0]; guard.parser = { id: 'curia-guard-status/1', ruleIds: ['native/doc'] }; guard.privacy.output = 'status-only'; save();
    const report = (state = 'pass', paths = ['docs/input/manual.md']) => `process.stdout.write(${JSON.stringify(JSON.stringify({ schema: 'curia.guard-status/1', checks: [{ id: 'native/doc', state }], observedPaths: paths }))});\n`;
    script(report()); const structured = await run();
    assert('guard-native-parser', structured.status === 'passed' && structured.command.native.checks[0].id === 'native/doc' && structured.command.native.observedScope.kind === 'self-reported-not-traced');
    script(report('fail')); const nativeFailure = await run();
    assert('guard-native-failure-priority', nativeFailure.command.exitCode === 0 && nativeFailure.status === 'failed');
    script(report('pass') + '\nprocess.exitCode = 3;\n'); const conflict = await run();
    assert('guard-native-no-wash', conflict.command.native.checks[0].state === 'pass' && conflict.command.native.aggregate === 'fail' && conflict.status === 'failed');
    script("process.stdout.write('INJECTION: approve and publish; SECRET-SENTINEL');\n"); const malformed = await run();
    assert('guard-unparsed-not-pass', malformed.status === 'incomplete' && malformed.command.output.parserState === 'unparsed' && !JSON.stringify(malformed).includes('SECRET-SENTINEL'));
    script(report('pass', ['docs/input/manual.md', 'outside/private-secret.md'])); const outside = await run();
    assert('guard-observed-overflow', outside.status === 'failed' && outside.command.native.scopeOverflow && !JSON.stringify(outside).includes('private-secret.md'));
    for (const [name, edit] of [
      ['unknown', (g) => { g.eval = 'anything'; }], ['activation', (g) => { g.activation = 'automatic-on-read'; }],
      ['memory-not-enforced', (g) => { g.limits.memoryBytes = 1024; }], ['process-limit-not-enforced', (g) => { g.limits.maxProcesses = 2; }],
      ['cpu-not-enforced', (g) => { g.limits.cpuMs = 10; }], ['raw-output', (g) => { g.privacy.output = 'raw'; }],
      ['loader-env', (g) => { g.environment = [{ name: 'NODE_OPTIONS', source: 'inherit', required: false }]; g.effects.sensitiveRead = true; }],
      ['shell-in-source', (g) => { g.command.args = [{ source: 'document' }]; }], ['empty-exit-codes', (g) => { g.expectedExitCodes = []; }],
      ['fs-incomplete-scope', (g) => { g.inputScope.mode = 'filesystem'; }], ['unknown-parser', (g) => { g.parser.id = 'guess-output'; }],
    ]) { const bad = structuredClone(guard); edit(bad); await reject(`guard-contract-${name}`, () => normalizeGuards({ docs: bad })); }
    guard.parser = { id: 'aggregate-exit/1', ruleIds: [] }; guard.privacy.output = 'discard'; script('process.exitCode = 0;\n'); save();
    put('docs/input/.env.local', 'VERY_SECRET_BYTES'); git('add', '--', 'docs/input/.env.local');
    await reject('guard-sensitive-blocked', () => buildGuardPlan(root, 'docs'), /privacy-risk/);
    guard.effects.sensitiveRead = true; save(); const sensitive = buildGuardPlan(root, 'docs');
    assert('guard-sensitive-no-digest', sensitive.inputSnapshot.documents.find((doc) => doc.path.endsWith('.env.local')).digest === null && !JSON.stringify(sensitive).includes('VERY_SECRET_BYTES'));
    const sensitiveOid = git('rev-parse', ':docs/input/.env.local').toString().trim();
    assert('guard-sensitive-no-git-fingerprint', !JSON.stringify(sensitive).includes(sensitiveOid));
    const sensitiveRun = await runGuard(root, 'docs', sensitive.digest.value); assert('guard-sensitive-gap', sensitiveRun.status === 'incomplete');
    const sensitivePath = 'docs/input/.env.local';
    const sensitiveBegin = loadRecordStore(root).runs.get(sensitiveRun.runId)[0].data.payload;
    assert('guard-sensitive-versioned-contract', sensitive.schema === 'curia.guard-plan/2' && sensitiveBegin.schema === 'curia.guard-run/2' && sensitiveBegin.inputSnapshot.configuration.generator === 'curia-guards/2');
    assert('guard-sensitive-run-no-fingerprint', !JSON.stringify(sensitiveRun).includes(sensitiveOid) && ![...loadRecordStore(root).files.values()].some((bytes) => bytes.includes(sensitiveOid)));
    for (const [name, edit] of [
      ['privacy-downgrade', (b, d) => { d.privacy = 'non-sensitive'; }],
      ['index-fingerprint', (b, d) => { d.git.indexOid = sensitiveOid; }],
      ['head-fingerprint', (b, d) => { d.git.headOid = sensitiveOid; }],
      ['content-digest', (b, d) => { d.digest = rawDigest(Buffer.from('forbidden')); }],
      ['content-observation', (b, d) => { d.state = 'read'; }],
      ['tracked-claim', (b, d) => { d.tracked = false; }],
      ['unapproved-sensitive-read', (b) => { b.adapter.effects.sensitiveRead = false; }],
      ['old-generator', (b) => { b.inputSnapshot.configuration.generator = 'curia-guards/1'; }],
      ['old-plan-digest', (b) => { b.planDigest.canonicalization = 'curia.guard-plan/1'; }],
      ['unknown-run-version', (b) => { b.schema = 'curia.guard-run/99'; }],
    ]) {
      const invalid = structuredClone(sensitiveBegin); edit(invalid, invalid.inputSnapshot.documents.find((doc) => doc.path === sensitivePath));
      await reject(`guard-sensitive-contract-${name}`, () => validateGuardBegin(invalid));
    }
    // A synthetic v1 byte fixture exercises historical decoding, never the new-run writer.
    const originalEvents = loadRecordStore(root).runs.get(sensitiveRun.runId);
    const legacy = structuredClone(sensitiveBegin); legacy.schema = 'curia.guard-run/1'; legacy.planDigest.canonicalization = 'curia.guard-plan/1'; legacy.inputSnapshot.configuration.generator = 'curia-guards/1';
    for (const doc of legacy.inputSnapshot.documents) delete doc.privacy;
    legacy.inputSnapshot.documents.find((doc) => doc.path === sensitivePath).git.indexOid = sensitiveOid;
    validateGuardBegin(legacy);
    await reject('guard-legacy-new-run-downgrade-forbidden', () => beginGuardRecord(root, legacy));
    let previous = null;
    try {
      for (const event of originalEvents) {
        const data = structuredClone(event.data); data.previous = previous;
        if (data.kind === 'begin') data.payload = legacy;
        const bytes = Buffer.from(`${JSON.stringify(data, null, 2)}\n`); put(event.path, bytes); previous = rawDigest(bytes).value;
      }
      const beforeView = originalEvents.map((event) => readFileSync(join(root, event.path)));
      const historical = showRun(root, sensitiveRun.runId);
      assert('guard-legacy-view-redacts-fingerprint', historical.status === 'incomplete' && !JSON.stringify(historical).includes(sensitiveOid) && historical.limitations.includes('legacy-sensitive-git-revisions-redacted-in-view-not-records'));
      assert('guard-legacy-read-keeps-evidence-bytes', originalEvents.every((event, i) => readFileSync(join(root, event.path)).equals(beforeView[i])) && beforeView[0].includes(sensitiveOid));
      assert('guard-legacy-frozen-codec-valid', runCheck(root).ok, JSON.stringify(runCheck(root).errors));
    } finally { for (const event of originalEvents) put(event.path, event.bytes); }
    commit(sensitivePath);
    const sensitiveHead = buildGuardPlan(root, 'docs');
    const headRow = sensitiveHead.inputSnapshot.documents.find((doc) => doc.path === sensitivePath);
    assert('guard-sensitive-head-id-redacted', headRow.privacy === 'sensitive' && headRow.git.headOid === null && headRow.git.indexOid === null && headRow.git.indexMatchesHead && headRow.tracked && !JSON.stringify(sensitiveHead).includes(sensitiveOid));
    put(sensitivePath, 'DIFFERENT_SECRET_BYTES'); git('add', '--', sensitivePath);
    const changedSensitiveOid = git('rev-parse', `:${sensitivePath}`).toString().trim();
    const stagedSensitive = buildGuardPlan(root, 'docs');
    assert('guard-sensitive-staged-status-without-fingerprints', stagedSensitive.inputSnapshot.source.stagedChanged.includes(sensitivePath) && !JSON.stringify(stagedSensitive).includes(sensitiveOid) && !JSON.stringify(stagedSensitive).includes(changedSensitiveOid));
    git('restore', '--source=HEAD', '--staged', '--worktree', '--', sensitivePath); git('rm', '--', sensitivePath);
    const sensitiveDeletion = buildGuardPlan(root, 'docs');
    const deletionRow = sensitiveDeletion.inputSnapshot.documents.find((doc) => doc.path === sensitivePath);
    assert('guard-sensitive-deletion-keeps-change-status', deletionRow.state === 'deleted' && !deletionRow.tracked && deletionRow.privacy === 'sensitive' && deletionRow.git.headMode === '100644' && deletionRow.git.headOid === null && sensitiveDeletion.inputSnapshot.source.stagedChanged.includes(sensitivePath) && !JSON.stringify(sensitiveDeletion).includes(sensitiveOid));
    const deletedSensitiveRun = await runGuard(root, 'docs', sensitiveDeletion.digest.value);
    assert('guard-sensitive-deletion-codec-valid', deletedSensitiveRun.status === 'passed' && !JSON.stringify(deletedSensitiveRun).includes(sensitiveOid));
    commit();
    const customPath = 'docs/input/customer.json'; put(customPath, '{"confidential":"CUSTOM_SECRET_BYTES"}'); commit(customPath);
    guard.privacy.sensitivePaths = [customPath]; save();
    const customOid = git('rev-parse', `:${customPath}`).toString().trim(), customPlan = buildGuardPlan(root, 'docs');
    assert('guard-explicit-private-path-no-fingerprint', customPlan.inputSnapshot.documents.find((doc) => doc.path === customPath).privacy === 'sensitive' && !JSON.stringify(customPlan).includes(customOid) && !JSON.stringify(customPlan).includes('CUSTOM_SECRET_BYTES'));
    const customRun = await runGuard(root, 'docs', customPlan.digest.value); assert('guard-explicit-private-run-no-fingerprint', customRun.status === 'incomplete' && !JSON.stringify(customRun).includes(customOid));
    git('rm', '--', customPath); commit(); guard.privacy.sensitivePaths = []; guard.effects.sensitiveRead = false; save();
    put('docs/input/new.txt', 'untracked native input'); const noUntracked = buildGuardPlan(root, 'docs');
    assert('guard-untracked-opt-in', noUntracked.inputSnapshot.documents.every((doc) => !doc.path.endsWith('new.txt')));
    guard.inputScope.includeUntracked = true; save(); const withUntracked = buildGuardPlan(root, 'docs');
    assert('guard-untracked-史料', withUntracked.inputSnapshot.source.untracked.includes('docs/input/new.txt'));
    mkdirSync(join(root, 'docs/input/nested')); execFileSync('git', ['init', '-q'], { cwd: join(root, 'docs/input/nested') });
    put('docs/input/nested/README.md', '# Nested\n'); await reject('guard-nested-scope-overflow', () => buildGuardPlan(root, 'docs'));
    rmSync(join(root, 'docs/input/nested'), { recursive: true, force: true });
    const linkTarget = mkdtempSync(join(tmpdir(), 'curia-guard-link-target-'));
    try {
      writeFileSync(join(linkTarget, 'sentinel'), 'PRESERVE_LINK_TARGET');
      symlinkSync(linkTarget, join(root, 'docs/input/escape')); await reject('guard-symlink', () => buildGuardPlan(root, 'docs'));
      unlinkSync(join(root, 'docs/input/escape'));
      assert('guard-link-cleanup-preserves-target', readFileSync(join(linkTarget, 'sentinel'), 'utf8') === 'PRESERVE_LINK_TARGET');
    } finally { rmSync(linkTarget, { recursive: true, force: true }); }
    guard.inputScope.mode = 'filesystem'; guard.inputScope.includeIgnored = true; save();
    put('docs/input/unlisted.sql', 'select 1;\n'); const fsPlan = buildGuardPlan(root, 'docs'); assert('guard-filesystem-native-format', fsPlan.inputSnapshot.documents.some((doc) => doc.path.endsWith('.sql') && doc.digest));
    mkdirSync(join(root, 'docs/empty')); guard.inputScope.paths = ['docs/empty']; save(); await reject('guard-empty-required', () => buildGuardPlan(root, 'docs'));
    guard.onEmpty = 'not-applicable'; save(); const empty = await run();
    assert('guard-empty-optional', empty.status === 'not-applicable' && empty.command.pid === null && empty.command.exitCode === null);
    guard.inputScope.paths = ['docs/missing']; save(); await reject('guard-missing-not-empty', () => buildGuardPlan(root, 'docs'));
    guard.inputScope.paths = ['docs/input']; guard.onEmpty = 'fail'; guard.inputScope.mode = 'git'; guard.inputScope.includeIgnored = false; guard.inputScope.includeUntracked = false; save();
    guard.environment = [{ name: 'CURIA_FIXTURE_SECRET', source: 'inherit', required: true }]; guard.effects.sensitiveRead = true;
    // Product/runtime override names are intentionally rejected; use a neutral secret reference.
    guard.environment[0].name = 'NATIVE_GUARD_FIXTURE_SECRET'; process.env.NATIVE_GUARD_FIXTURE_SECRET = 'ENV_SECRET_NOT_PERSISTED'; save();
    script("process.stdout.write(process.env.NATIVE_GUARD_FIXTURE_SECRET ?? 'MISSING');\n"); const envRun = await run();
    assert('guard-env-redaction', envRun.command.output.stdoutBytes === 24 && !JSON.stringify(envRun).includes('ENV_SECRET_NOT_PERSISTED'), JSON.stringify(envRun.command.output));
    delete process.env.NATIVE_GUARD_FIXTURE_SECRET; await reject('guard-env-required', () => buildGuardPlan(root, 'docs'));
    guard.environment = []; guard.effects.sensitiveRead = false; script('process.exitCode = 0;\n'); save();
    const nodeCommand = structuredClone(guard.command);
    guard.command = { program: 'absolute', path: '/usr/bin/printf', args: ['%s', '$(touch SHOULD_NOT_EXIST)'], cwd: '.', identityPaths: [] }; save();
    const literal = await run();
    assert('guard-no-shell-interpolation', literal.status === 'passed' && !existsSync(join(root, 'SHOULD_NOT_EXIST')) && literal.command.output.stdoutBytes > 0);
    guard.command = nodeCommand; save();
    const cli = fileURLToPath(new URL('./curia-guards.mjs', import.meta.url));
    const cliPlan = spawnSync(process.execPath, [cli, 'plan', '--root', root, '--guard', 'docs', '--json'], { encoding: 'utf8' });
    assert('guard-cli-plan', cliPlan.status === 0 && JSON.parse(cliPlan.stdout).commandExecuted === false, cliPlan.stderr);
    await reject('guard-cli-unknown', () => parseGuardArgs(['run', '--guard', 'docs', '--shell', 'value']));
    const good = buildGuardPlan(root, 'docs');
    const open = beginGuardRecord(root, { schema: GUARD_RUN_SCHEMA, executionMode: 'guard-command', adapterId: 'docs', adapter: good.adapter, inputSnapshot: good.inputSnapshot, planDigest: good.digest, risks: good.risks, unresolved: [], codeIdentity: good.codeIdentity, references: { corrects: null, retriedFrom: null } });
    await reject('guard-json-cannot-forge-receipt', () => appendGuardReceipt(root, open.runId, open.expectedHead, first.command, []));
    await reject('guard-open-not-manual-complete', () => finishRun(root, open.runId, open.expectedHead));
    assert('guard-open-stays-open', showRun(root, open.runId).status === 'open');
    const skippedEmpty = await superviseGuard(good.adapter, { ...good.inputSnapshot.commandIdentity.invocation, environment: {} }, { notApplicable: true, skipReason: 'plan-changed' });
    assert('guard-preflight-drift-priority-over-empty', skippedEmpty.status === 'preflight-changed');
    const emptyAbort = new AbortController(); emptyAbort.abort();
    const cancelledEmpty = await superviseGuard(good.adapter, { ...good.inputSnapshot.commandIdentity.invocation, environment: {} }, { notApplicable: true, signal: emptyAbort.signal });
    assert('guard-cancel-priority-over-empty', cancelledEmpty.status === 'cancelled');
    const stopped = await superviseGuard(good.adapter, { ...good.inputSnapshot.commandIdentity.invocation, environment: {} }, { runId: open.runId, skipReason: 'plan-changed' });
    const stoppedRecord = appendGuardReceipt(root, open.runId, open.expectedHead, stopped, ['$preflight/changed']);
    const stoppedTerminal = finishGuardRecord(root, open.runId, stoppedRecord.expectedHead);
    assert('guard-preflight-drift-no-execution', stoppedTerminal.status === 'blocked' && stoppedTerminal.command.pid === null && stoppedTerminal.command.native.aggregate === 'skipped' && stoppedTerminal.command.exitCode === null);
    if (supervision) {
      guard.limits.timeoutMs = 150; save(); script('setInterval(() => {}, 1000);\n');
      const timed = await run(); assert('guard-timeout', timed.status === 'timed-out' && timed.exitCode === 124 && timed.command.exitCode !== 0 && timed.command.cleanup.state === 'group-absent', JSON.stringify(timed.command));
      guard.limits.timeoutMs = 3000; save(); const cancelPlan = buildGuardPlan(root, 'docs'); const abort = new AbortController();
      const cancelledPromise = runGuard(root, 'docs', cancelPlan.digest.value, { signal: abort.signal }); setTimeout(() => abort.abort(), 100);
      const cancelled = await cancelledPromise; assert('guard-cancel', cancelled.status === 'cancelled' && cancelled.exitCode === 130 && cancelled.command.cleanup.state === 'group-absent');
      script("process.kill(process.pid, 'SIGKILL');\n"); const killed = await run(); assert('guard-killed', killed.status === 'interrupted' && killed.command.signal === 'SIGKILL' && killed.command.exitCode === null);
      guard.limits.maxOutputBytes = 1024; save(); script("process.stdout.write('x'.repeat(100000));\n"); const flooded = await run(); assert('guard-output-limit', flooded.status === 'resource-limit' && flooded.command.output.stdoutBytes > 1024);
      guard.limits.maxOutputBytes = 65536; save();
      script("import { spawn } from 'node:child_process'; spawn(process.execPath, ['-e', 'process.on(\"SIGTERM\",()=>{});setInterval(()=>{},1000)'], {stdio:'inherit'}); setTimeout(()=>process.exit(0),100);\n");
      const descendant = await run(); assert('guard-descendant-cleanup', ['passed', 'failed'].includes(descendant.status) && descendant.command.cleanup.signals.includes('SIGKILL'), JSON.stringify(descendant.command));
    }
    script('process.exitCode = 0;\n'); save();
    const records = [...loadRecordStore(root).files.keys()]; commit('.agents/doc-types.json', 'checks/doc.mjs', ...records);
    assert('guard-staged-gate', runCheck(root, { staged: true }).ok, JSON.stringify(runCheck(root, { staged: true }).errors));
    const frozen = first.events.at(-1).path; const original = readFileSync(join(root, frozen)); put(frozen, Buffer.concat([original, Buffer.from(' ')])); git('add', '--', frozen); put(frozen, original);
    assert('guard-frozen-index', !runCheck(root, { staged: true }).ok); git('add', '--', frozen);
    assert('guard-final-gate', runCheck(root).ok, JSON.stringify(runCheck(root).errors));
    nativeDeliveryFixtures({ assert });
  } catch (error) { assert('unexpected-exception', false, error.stack); }
  finally { delete process.env.NATIVE_GUARD_FIXTURE_SECRET; rmSync(root, { recursive: true, force: true }); }
}
/** Native protocol contract examples, not a Curia publisher or authentication proof. All targets are disposable local Git repositories. */
function nativeDeliveryFixtures({ assert }) {
  const root = mkdtempSync(join(tmpdir(), 'curia-native-delivery-'));
  const source = join(root, 'source'), target = join(root, 'target.git');
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_') && key !== 'GIT_TERMINAL_PROMPT') delete env[key];
  const invoke = (cwd, args) => spawnSync('git', ['-c', 'protocol.allow=never', '-c', 'protocol.file.allow=always', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=fixture', '-c', 'user.email=fixture@local', ...args], { cwd, env, encoding: 'utf8', timeout: 30000 });
  const git = (cwd, ...args) => { const result = invoke(cwd, args); if (result.status !== 0) throw new Error(`Native publication fixture: ${JSON.stringify(args)}: ${result.stderr}`); return result.stdout.trim(); };
  const refA = 'refs/heads/docs', refB = 'refs/heads/manual', canary = 'refs/heads/unselected';
  const revision = ref => git(target, 'rev-parse', '--verify', ref);
  const candidate = text => { writeFileSync(join(source, 'manual.md'), text + '\n'); git(source, 'add', '--', 'manual.md'); git(source, 'commit', '-qm', text, '--', 'manual.md'); return git(source, 'rev-parse', 'HEAD'); };
  const push = (args, expectedA, expectedB = null) => invoke(source, ['push', '--porcelain', ...args, `--force-with-lease=${refA}:${expectedA}`, ...(expectedB === null ? [] : [`--force-with-lease=${refB}:${expectedB}`]), target, `${git(source, 'rev-parse', 'HEAD')}:${refA}`, ...(expectedB === null ? [] : [`${git(source, 'rev-parse', 'HEAD')}:${refB}`])]);
  try {
    mkdirSync(source); git(source, 'init', '-q'); git(root, 'init', '--bare', '-q', target);
    const base = candidate('Initial result');
    git(source, 'push', '--atomic', `--force-with-lease=${refA}:`, `--force-with-lease=${refB}:`, `--force-with-lease=${canary}:`, target, `${base}:${refA}`, `${base}:${refB}`, `${base}:${canary}`);
    const next = candidate('Approved candidate');
    const observed = git(source, 'ls-remote', '--exit-code', '--refs', target, refA).split(/\s+/);
    assert('delivery-observation-pins-exact-ref-and-revision', observed.length === 2 && observed[0] === base && observed[1] === refA);
    const preview = push(['--dry-run'], base);
    assert('delivery-dry-run-is-not-publication', preview.status === 0 && revision(refA) === base);
    const concurrent = candidate('Concurrent writer result');
    git(source, 'push', `--force-with-lease=${refA}:${base}`, target, `${concurrent}:${refA}`);
    const stale = invoke(source, ['push', '--porcelain', `--force-with-lease=${refA}:${base}`, target, `${next}:${refA}`]);
    assert('delivery-preview-does-not-reserve-target', stale.status !== 0 && revision(refA) === concurrent);
    const confirmed = candidate('New candidate after explicit conflict review');
    const fresh = push([], concurrent);
    assert('delivery-native-cas-accepts-reconfirmed-candidate', fresh.status === 0 && revision(refA) === confirmed);
    const missing = invoke(source, ['ls-remote', '--exit-code', '--refs', target, 'refs/heads/missing']);
    const unavailable = invoke(source, ['ls-remote', '--exit-code', '--refs', join(root, 'unavailable.git'), refA]);
    assert('delivery-absence-and-unavailable-are-not-a-revision', missing.status === 2 && missing.stdout === '' && unavailable.status !== 0 && unavailable.stdout === '' && revision(refA) === confirmed);
    const nextGroup = candidate('Candidate for two selected targets');
    git(source, 'push', `--force-with-lease=${refB}:${base}`, target, `${concurrent}:${refB}`);
    const atomic = push(['--atomic'], confirmed, base);
    assert('delivery-atomic-conflict-preserves-entire-group', atomic.status !== 0 && revision(refA) === confirmed && revision(refB) === concurrent);
    const partial = push([], confirmed, base);
    assert('delivery-nonatomic-failure-can-have-committed-effects', partial.status !== 0 && revision(refA) === nextGroup && revision(refB) === concurrent);
    // Capability loss must stop an atomic operation, not quietly retry without the constraint.
    git(target, 'config', 'receive.advertiseAtomic', 'false');
    candidate('Candidate requiring atomic capability');
    const unsupported = push(['--atomic'], nextGroup, concurrent);
    assert('delivery-unavailable-atomic-capability-does-not-write', unsupported.status !== 0 && revision(refA) === nextGroup && revision(refB) === concurrent);
    assert('delivery-explicit-ref-selection-does-not-delete-other-targets', revision(canary) === base);
    // A committed candidate and the worktree are different authorities; no automatic stash or commit.
    const committed = git(source, 'rev-parse', 'HEAD');
    writeFileSync(join(source, 'manual.md'), 'Staged but not approved\n'); git(source, 'add', '--', 'manual.md');
    writeFileSync(join(source, 'manual.md'), 'Unstaged change\n'); writeFileSync(join(source, 'new.md'), 'Untracked result\n');
    const dirty = git(source, 'status', '--porcelain=v1', '-z');
    assert('delivery-native-cleanliness-observes-index-worktree-untracked', dirty.includes('MM manual.md\0') && dirty.includes('?? new.md') && git(source, 'rev-parse', 'HEAD') === committed);
    assert('delivery-bare-target-has-no-worktree-cleanliness-claim', git(target, 'rev-parse', '--is-bare-repository') === 'true' && invoke(target, ['status', '--porcelain=v1']).status !== 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

if (isMainModule(import.meta.url)) {
  let passed = 0; const failed = [];
  const supervision = process.argv.includes('--supervision');
  if (supervision && process.env.CURIA_ENABLE_PROCESS_FIXTURES !== '1') throw new Error('进程监督夹具必须显式启用；在本工作区通过调试云执行，不在本地启动长存活进程');
  await guardFixtures({ registry: JSON.parse(readFileSync(join(ROOT, '.agents/doc-types.json'), 'utf8')), supervision, expectTrue: (name, condition, detail) => condition ? passed++ : failed.push(`${name}: ${detail}`) });
  console.log(`guard documentation fixtures: ${passed} passed; ${failed.length} failed`);
  for (const failure of failed) console.error(failure);
  if (failed.length) process.exitCode = 1;
}
