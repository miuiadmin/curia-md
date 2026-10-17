/** Static record-store fixtures. Disposable Git repositories only; no application runtime. */
import { execFileSync, spawnSync } from 'node:child_process';
import fs, { cpSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, readFileSync, rmSync, unlinkSync, writeFileSync, symlinkSync, linkSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ROOT, isMainModule } from './doc-lib.mjs';
import { normalizeInstance } from './curia-instance.mjs';
import { inspectRecordStore, startRun, appendObservation, finishRun, showRun, loadRecordStore, validateRecordFiles, rawDigest, parseRecordArgs, recordCodeIdentity } from './curia-records.mjs';
import { READ_RULES_V1, READ_RULES_V2, READ_RULES_V3 } from './curia-workflow.mjs';
import { runCheck } from './check-records.mjs';

export function recordFixtures({ expectTrue, registry }) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'curia-curia-records-')));
  const store = 'docs/records/runs';
  const cli = fileURLToPath(new URL('./curia-records.mjs', import.meta.url));
  const env = { ...process.env }; delete env.CURIA_STAGED; delete env.CURIA_STAGED;
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: ['pipe', 'pipe', 'pipe'], env });
  const put = (p, bytes) => { mkdirSync(dirname(join(root, p)), { recursive: true }); writeFileSync(join(root, p), bytes); };
  const assert = (name, cond, detail = '') => expectTrue(`Curia records [${name}]`, cond, detail);
  const reject = (name, fn, pattern = /records\/|curia2\//) => { let error; try { fn(); } catch (e) { error = e; } assert(name, !!error && pattern.test(error.message), error?.stack ?? '未拒绝'); };
  const config = structuredClone(registry);
  delete config.instance;
  const binding = {
    schema: 'curia.instance/1', owner: 'records-owner',
    surfaces: [
      { id: 'control', kind: 'root', entry: '.agents/README.md', authorityLinks: ['AGENTS.md'], members: [{ path: '.agents', kind: 'directory', role: 'control' }] },
      { id: 'knowledge', kind: 'root', entry: 'docs/README.md', authorityLinks: ['docs/README.md'], members: [{ path: 'docs', kind: 'directory', role: 'knowledge' }] },
    ],
    recordStore: { schema: 'curia.record-store/1', path: store, owner: 'recorder', authorityLinks: ['docs/README.md'] },
  };
  const registryPath = '.agents/doc-types.json';
  const saveRegistry = () => put(registryPath, `${JSON.stringify(config, null, 2)}\n`);
  const commit = (...paths) => { git('add', '--', ...paths); git('-c', 'user.email=fixture@local', '-c', 'user.name=fixture', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'record fixture'); };
  const start = (extra = {}) => startRun(root, { selection: { paths: ['.agents/plans/input.md'] }, ...extra });
  const observe = (run, overrides = {}) => appendObservation(root, run.runId, run.expectedHead, { checkId: 'review', subject: '.agents/plans/input.md', statement: '已观察到条件限定；不是事实认证。', state: 'satisfied', evidencePaths: ['.agents/plans/input.md'], gapReason: null, observer: 'self-reported-reader', ...overrides });
  const finish = (run, options) => finishRun(root, run.runId, run.expectedHead, options);
  try {
    put('AGENTS.md', '# 规则\n'); put('.agents/README.md', '# 控制\n'); put('docs/README.md', '# 记录归属\n');
    saveRegistry();
    put('.agents/plans/input.md', '# 计划\n\nType: plan\nStatus: active\nOwner: fixture\nUpdated: 2026-10-15\n\n## 目标\n\nINPUT_BODY_SENTINEL：不运行来源命令。\n');
    put('docs/input.pdf', 'NOT_A_REAL_PDF');
    git('init', '-q'); commit('AGENTS.md', '.agents/README.md', registryPath, '.agents/plans/input.md', 'docs/README.md', 'docs/input.pdf');
    assert('opt-out', runCheck(root).ok && runCheck(root).state === 'not-applicable' && !existsSync(join(root, store)));
    reject('opt-out-write', () => start());
    for (const [name, edit] of [
      ['schema', (s) => { s.schema = 'future'; }], ['unknown', (s) => { s.command = 'rm -rf /'; }],
      ['outside', (s) => { s.path = 'new-root/runs'; }], ['surface-root', (s) => { s.path = 'docs'; }],
      ['traversal', (s) => { s.path = 'docs/../other'; }], ['blank-owner', (s) => { s.owner = ''; }],
      ['own-authority', (s) => { s.authorityLinks = [`${store}/rule.md`]; }],
    ]) { const b = structuredClone(binding); edit(b.recordStore); reject(`config-${name}`, () => normalizeInstance(b, config.types)); }
    assert('store-inspection-opt-out', inspectRecordStore(root).state === 'not-applicable');
    config.instance = binding; saveRegistry(); commit(registryPath);
    const absentPolicy = inspectRecordStore(root); assert('preservation-missing-not-backup-success', absentPolicy.state === 'incomplete' && absentPolicy.exitCode === 2 && absentPolicy.configurationGaps.some(g => g.code === 'preservation/backup-not-declared'));
    const policyPath = 'docs/backup-policy.md', procedurePath = 'docs/recovery.md', evidencePath = 'docs/backup-evidence.json';
    put(policyPath, 'POLICY_CONTENT_SENTINEL'); put(procedurePath, 'RECOVERY_CONTENT_SENTINEL'); put(evidencePath, '{"verified":true,"secret":"EVIDENCE_CONTENT_SENTINEL"}');
    const policy = { schema: 'curia.record-preservation/1', backup: { authorityLinks: ['docs/README.md'], policyRef: policyPath, evidenceRef: evidencePath }, recovery: { authorityLinks: ['docs/README.md'], procedureRef: procedurePath } };
    binding.recordStore.preservation = structuredClone(policy); saveRegistry();
    const oldOpen = fs.openSync, opened = []; fs.openSync = (...args) => { opened.push(String(args[0])); return oldOpen(...args); }; syncBuiltinESMExports(); let declared;
    try { declared = inspectRecordStore(root); } finally { fs.openSync = oldOpen; syncBuiltinESMExports(); }
    assert('preservation-declarations-complete', declared.state === 'declarations-complete' && declared.exitCode === 0 && declared.observation.stable);
    assert('record-read-interceptor-observed-registry', opened.includes(join(root, registryPath)));
    assert('policy-and-evidence-bodies-never-opened', [policyPath, procedurePath, evidencePath].every(p => !opened.includes(join(root, p))) && declared.observation.policyBodiesRead === 0 && declared.observation.evidenceBodiesRead === 0);
    assert('existing-receipt-not-backup-or-recovery-proof', declared.assurance.backup === 'not-verified' && declared.assurance.recovery === 'not-verified' && declared.assurance.authority === 'not-authenticated' && declared.verificationGaps.includes('preservation/input-bytes-not-guaranteed-recoverable'));
    assert('no-body-echo-or-cleanup-authority', !JSON.stringify(declared).includes('CONTENT_SENTINEL') && declared.retention.deletionAuthorized === false && !existsSync(join(root, store)));
    const call = (...args) => spawnSync(process.execPath, [cli, 'store', '--root', root, ...args], { cwd: root, env, encoding: 'utf8' });
    let inspected = call('--json'); assert('store-cli-json', inspected.status === 0 && JSON.parse(inspected.stdout).state === 'declarations-complete', inspected.stderr); inspected = call(); assert('store-cli-readable', inspected.status === 0 && inspected.stdout.includes('declarations-complete') && !inspected.stdout.includes('undefined'));
    reject('store-no-write-option', () => parseRecordArgs(['store', '--restore'])); reject('store-no-run-option', () => parseRecordArgs(['store', '--run', 'x']));
    for (const [name, edit] of [
      ['schema', p => { p.schema = 'future'; }], ['unknown', p => { p.restoreNow = true; }], ['missing-authority', p => { p.backup.authorityLinks = []; }], ['duplicate-authority', p => { p.backup.authorityLinks.push('docs/README.md'); }], ['external-reference', p => { p.backup.policyRef = 'https://example.com/'; }], ['event-directory-reference', p => { p.backup.policyRef = store + '/policy.md'; }], ['registry-reference', p => { p.recovery.procedureRef = registryPath; }], ['missing-procedure', p => { delete p.recovery.procedureRef; }], ['unknown-inner-field', p => { p.recovery.command = 'restore'; }],
    ]) { const copy = structuredClone(binding); edit(copy.recordStore.preservation); reject('preservation-config-' + name, () => normalizeInstance(copy, config.types)); }
    binding.recordStore.preservation.backup.policyRef = 'docs/unavailable.md'; saveRegistry(); assert('missing-reference-is-gap', inspectRecordStore(root).configurationGaps.some(g => g.code === 'preservation/reference-unavailable'));
    symlinkSync(join(root, policyPath), join(root, 'docs/policy-link.md')); binding.recordStore.preservation.backup.policyRef = 'docs/policy-link.md'; saveRegistry(); assert('symlink-reference-not-accepted', inspectRecordStore(root).state === 'incomplete'); unlinkSync(join(root, 'docs/policy-link.md'));
    binding.recordStore.preservation.backup.policyRef = 'docs/private/policy.md'; saveRegistry(); const hidden = inspectRecordStore(root); assert('private-reference-withheld-before-stat', hidden.declarations.backup.policyRef.state === 'withheld' && !JSON.stringify(hidden).includes('docs/private/policy.md'));
    binding.recordStore.preservation = structuredClone(policy); saveRegistry();
    for (const kind of ['policy', 'registry']) {
      const oldStat = fs.lstatSync; let changed = false;
      fs.lstatSync = (...args) => { const stat = oldStat(...args); if (!changed && String(args[0]) === join(root, evidencePath)) { changed = true; if (kind === 'policy') put(policyPath, 'CHANGED_POLICY'); else { binding.recordStore.owner = 'changed-owner'; saveRegistry(); } } return stat; }; syncBuiltinESMExports();
      try { const drift = inspectRecordStore(root); assert('preservation-joint-postcheck-' + kind, changed && drift.state === 'incomplete' && drift.store === null && drift.configurationGaps.some(g => g.code === 'preservation/snapshot-changed'), JSON.stringify({ changed, report: drift })); } finally { fs.lstatSync = oldStat; syncBuiltinESMExports(); binding.recordStore.owner = 'recorder'; put(policyPath, 'POLICY_CONTENT_SENTINEL'); saveRegistry(); }
    }
    delete binding.recordStore.preservation; saveRegistry(); inspected = call('--json'); assert('store-cli-missing-policy-nonzero', inspected.status === 2 && JSON.parse(inspected.stdout).state === 'incomplete');
    const open = start({ manualChecks: ['review'] });
    const openStore = inspectRecordStore(root); assert('open-run-retention-not-cleanup-permission', openStore.recordCoverage.openRuns === 1 && openStore.retention.deletionAuthorized === false && openStore.recordCoverage.localEventsWithoutHeadBaseline === 1);

    assert('records-start', !open.terminal && open.status === 'open' && open.exitCode === null && open.inputs.source.mode === 'current-worktree');
    assert('records-no-body', !JSON.stringify(open).includes('INPUT_BODY_SENTINEL') && !readFileSync(join(root, open.events[0].path), 'utf8').includes('INPUT_BODY_SENTINEL'));
    assert('records-unsealed', open.baseline.committedEvents === 0 && open.baseline.uncommittedEvents === 1);
    assert('records-references', open.inputs.documents[0].sourceRef.observedAt && open.inputs.documents[0].evidenceRef.contentDigest.algorithm === 'sha256' && open.inputs.documents[0].sourceRef.revision.canonicalization === 'raw-bytes/1');
    reject('caller-run-id', () => start({ runId: open.runId }));
    reject('unknown-command', () => observe(open, { command: 'echo forged' }));
    reject('outside-evidence', () => observe(open, { evidencePaths: ['docs/unread.md'] }));
    reject('source-not-read', () => observe(open, { evidencePaths: ['docs/input.pdf'] }));
    reject('pass-with-gap', () => observe(open, { gapReason: '无法核实' }));
    reject('empty-evidence', () => observe(open, { evidencePaths: [] }));
    reject('undeclared-check', () => observe(open, { checkId: 'other' }));
    const appended = observe(open);
    assert('records-observation', appended.observations[0].command === null && appended.observations[0].exitCode === null && appended.observations[0].verification === 'self-reported-not-authenticated');
    reject('stale-head', () => observe(open));
    reject('duplicate-check', () => observe(appended));
    const terminal = finish(appended);
    assert('records-terminal', terminal.terminal && terminal.status === 'passed' && terminal.exitCode === 0 && terminal.result.businessOutcome === 'not-evaluated' && terminal.result.evidenceCompleteness.factVerification === 'not-verified', JSON.stringify(terminal.result));
    reject('terminal-append', () => observe(terminal)); reject('terminal-finish', () => finish(terminal));
    const corrected = start({ corrects: terminal.runId });
    const correction = finish(corrected);
    assert('records-corrects', correction.runId !== terminal.runId && correction.workflowId !== terminal.workflowId && runCheck(root).ok);
    reject('nonterminal-ref', () => start({ corrects: start().runId }));
    reject('dangling-ref', () => start({ corrects: 'r-00000000-0000-4000-8000-000000000000' }));
    const retry = start({ retriedFrom: terminal.runId }); finish(retry);
    const missing = finish(start({ manualChecks: ['review'] }));
    assert('records-skipped', missing.status === 'incomplete' && missing.result.gates.some((g) => g.id === 'manual/review' && g.state === 'skipped'));
    const failed = finish(observe(start({ manualChecks: ['review'] }), { state: 'unsatisfied' }));
    assert('records-failed', failed.status === 'failed' && failed.exitCode === 1);
    const gap = finish(observe(start({ manualChecks: ['review'] }), { state: 'evidence-gap', evidencePaths: [], gapReason: '来源缺失' }));
    assert('records-gap', gap.status === 'incomplete' && gap.result.evidenceCompleteness.factVerification === 'not-verified');
    const unsupported = finish(start({ selection: { paths: ['docs/input.pdf'] } }));
    assert('records-unread', unsupported.status === 'incomplete' && unsupported.inputs.documents[0].evidenceRef === null && unsupported.inputs.documents[0].observedAt === null);
    const partial = finish(start({ limits: { maxFileBytes: 5 } }));
    assert('records-partial', partial.inputs.documents[0].state === 'partial' && partial.inputs.documents[0].sourceRef.revision === null && partial.status !== 'passed');
    const empty = finish(start({ selection: { paths: ['docs/missing.md'] } }));
    assert('records-empty', empty.status === 'failed');
    const cancelled = finish(start(), { cancel: true, reason: '人工确认取消；不推断进程被杀。' });
    assert('records-cancelled', cancelled.status === 'cancelled' && cancelled.exitCode === 130);
    const openInterrupted = start();
    assert('records-open-not-success', showRun(root, openInterrupted.runId).status === 'open');
    const before = start();
    config.instance.owner = 'new-owner'; saveRegistry();
    reject('records-config-drift', () => finish(before));
    const cancelledDrift = finish(before, { cancel: true, reason: '生效配置已变化，重新开始。' });
    assert('records-drift-cancel', cancelledDrift.result.drift.includes('registry'));
    config.instance.owner = 'records-owner'; saveRegistry();
    const input = readFileSync(join(root, '.agents/plans/input.md'));
    put('.agents/plans/input.md', Buffer.concat([input, Buffer.from('额外未提交内容。\n')]));
    const mixed = start();
    assert('records-worktree-digest', mixed.inputs.documents[0].sourceRef.revision.value === rawDigest(readFileSync(join(root, '.agents/plans/input.md'))).value && mixed.inputs.source.worktreeState === 'not-attributed-to-head');
    put('.agents/plans/input.md', input);

    // Pure negative fixtures mutate a private copy, not the live history.
    const corpus = start({ selection: { corpus: true }, includeUntracked: true });
    assert('records-no-output-feedback', corpus.inputs.source.scope.exclusions.includes(store) && corpus.inputs.documents.every((doc) => !doc.path.startsWith(`${store}/`)) && corpus.inputs.source.scope.excluded > 0);
    const view = loadRecordStore(root); const targetPath = terminal.events.at(-1).path;
    const testBad = (name, edit) => { const files = new Map(view.files); edit(files); reject(name, () => validateRecordFiles(files, store), /records\/|重复键/); };
    const change = (files, path, edit) => { const data = JSON.parse(files.get(path)); edit(data); files.set(path, Buffer.from(`${JSON.stringify(data, null, 2)}\n`)); };
    const originalBegin = view.files.get(corpus.events[0].path);
    const legacyBegin = JSON.parse(originalBegin);
    legacyBegin.payload.checks = READ_RULES_V1.map((rule) => ({ ...legacyBegin.payload.checks.find((check) => check.id === rule.id), ...rule }));
    const legacyBytes = Buffer.from(`${JSON.stringify(legacyBegin)}\n`);
    const legacyMap = new Map([[corpus.events[0].path, legacyBytes]]);
    assert('records-historical-read-rules', validateRecordFiles(legacyMap, store).has(corpus.runId) && view.files.get(corpus.events[0].path).equals(originalBegin));
    const versionTwo = JSON.parse(originalBegin);
    versionTwo.payload.checks = READ_RULES_V2.map((rule) => ({ ...versionTwo.payload.checks.find((check) => check.id === rule.id), ...rule }));
    assert('records-historical-json-rules', validateRecordFiles(new Map([[corpus.events[0].path, Buffer.from(JSON.stringify(versionTwo))]]), store).has(corpus.runId));
    const versionThree = JSON.parse(originalBegin);
    versionThree.payload.checks = READ_RULES_V3.map((rule) => ({ ...versionThree.payload.checks.find((check) => check.id === rule.id), ...rule }));
    versionThree.payload.codeIdentity = versionThree.payload.codeIdentity.filter((entry) => entry.file !== 'curia-originals.mjs');
    assert('records-historical-content-rules', validateRecordFiles(new Map([[corpus.events[0].path, Buffer.from(JSON.stringify(versionThree))]]), store).has(corpus.runId));
    testBad('records-missing-originals-rule', (f) => change(f, corpus.events[0].path, (d) => { d.payload.checks = d.payload.checks.filter((c) => c.id !== 'curia-read/originals'); }));
    testBad('records-mixed-content-rule-versions', (f) => change(f, corpus.events[0].path, (d) => { d.payload.checks.find((c) => c.id === 'curia-read/content').version = 3; }));
    testBad('records-mixed-json-rule-versions', (f) => change(f, corpus.events[0].path, (d) => { d.payload.checks.find((c) => c.id === 'curia-read/content').version = 2; }));
    testBad('records-mixed-rule-versions', (f) => change(f, corpus.events[0].path, (d) => { d.payload.checks.find((c) => c.id === 'curia-read/content').version = 1; }));
    testBad('records-unknown-rule-version', (f) => change(f, corpus.events[0].path, (d) => { d.payload.checks[0].version = 999; }));
    const corrupted = JSON.parse(legacyBytes); corrupted.payload.checks[0].owner = 'forged';
    reject('records-historical-contract-tamper', () => validateRecordFiles(new Map([[corpus.events[0].path, Buffer.from(JSON.stringify(corrupted))]]), store));
    assert('records-json-parser-code-identity', legacyBegin.payload.codeIdentity.some((entry) => entry.file === 'curia-json.mjs'));
    testBad('records-forged-status', (f) => change(f, targetPath, (d) => { d.payload.businessOutcome = 'fully-verified'; }));
    testBad('records-forged-exit', (f) => change(f, targetPath, (d) => { d.payload.exitCode = 99; }));
    testBad('records-chain', (f) => change(f, targetPath, (d) => { d.previous = '0'.repeat(64); }));
    testBad('records-workflow-id', (f) => change(f, targetPath, (d) => { d.workflowId = 'w-reused'; }));
    testBad('records-unknown-event', (f) => change(f, targetPath, (d) => { d.command = 'no'; }));
    testBad('records-sequence-gap', (f) => { f.delete(terminal.events[1].path); });
    testBad('records-duplicate-json', (f) => { const b = f.get(targetPath).toString().replace('"schema":', '"schema":"duplicate", "schema":'); f.set(targetPath, Buffer.from(b)); });
    testBad('records-postterminal', (f) => {
      const data = JSON.parse(f.get(targetPath)); data.sequence++; data.previous = rawDigest(f.get(targetPath)).value;
      f.set(`${store}/${terminal.runId}.${String(data.sequence).padStart(8, '0')}.json`, Buffer.from(`${JSON.stringify(data)}\n`));
    });
    testBad('records-reference-cycle', (files) => {
      const at = new Date().toISOString();
      for (const [run, ref] of [[terminal, correction.runId], [correction, terminal.runId]]) {
        let prev = null;
        for (const entry of run.events) {
          const data = JSON.parse(files.get(entry.path)); data.previous = prev; data.observedAt = at;
          if (data.kind === 'begin') data.payload.references = { corrects: ref, retriedFrom: null };
          if (data.kind === 'terminal') data.payload.endedAt = at;
          const bytes = Buffer.from(`${JSON.stringify(data, null, 2)}\n`); files.set(entry.path, bytes); prev = rawDigest(bytes).value;
        }
      }
    });
    testBad('records-pending', (f) => { f.set(`${store}/.pending-crashed`, Buffer.from('{}')); });
    testBad('records-oversize', (f) => { f.set(targetPath, Buffer.alloc(1024 * 1024 + 1)); });

    const recordPaths = [...view.files.keys()]; commit(...recordPaths);
    const sealed = showRun(root, terminal.runId);
    assert('records-head-sealed', sealed.baseline.committedEvents === sealed.events.length && sealed.baseline.uncommittedEvents === 0);
    assert('records-positive-guard', runCheck(root).ok && runCheck(root, { staged: true }).ok);
    const frozenBytes = readFileSync(join(root, targetPath));
    put(targetPath, Buffer.concat([frozenBytes, Buffer.from(' ')]));
    assert('records-frozen-worktree', !runCheck(root).ok && runCheck(root, { staged: true }).ok);
    git('add', '--', targetPath); put(targetPath, frozenBytes);
    const stagedBad = runCheck(root, { staged: true });
    assert('records-frozen-index', !stagedBad.ok && stagedBad.errors.some((e) => /不得改写或删除/.test(e)), JSON.stringify(stagedBad.errors));
    git('add', '--', targetPath);
    git('rm', '--cached', '--', targetPath);
    assert('records-staged-delete', !runCheck(root, { staged: true }).ok); git('add', '--', targetPath);
    config.instance.recordStore = undefined; saveRegistry();
    assert('records-no-optout-bypass', !runCheck(root).ok);
    git('add', '--', registryPath);
    config.instance.recordStore = binding.recordStore = { schema: 'curia.record-store/1', path: store, owner: 'recorder', authorityLinks: ['docs/README.md'] }; saveRegistry();
    assert('records-index-optout-bypass', !runCheck(root, { staged: true }).ok); git('add', '--', registryPath);
    put(`${store}/.pending-crash`, '{}'); assert('records-incomplete-publication', !runCheck(root).ok); rmSync(join(root, store, '.pending-crash'));
    rmSync(join(root, targetPath)); symlinkSync(join(root, '.agents/plans/input.md'), join(root, targetPath));
    assert('records-symlink', !runCheck(root).ok); unlinkSync(join(root, targetPath)); put(targetPath, frozenBytes);
    const alias = `${store}/alias.json`; linkSync(join(root, targetPath), join(root, alias));
    assert('records-hardlink', !runCheck(root).ok); rmSync(join(root, alias));
    put('docs/ignored.md', '# Ignored\n'); put('.gitignore', `${store}/\n`);
    reject('records-ignored-store', () => start()); rmSync(join(root, '.gitignore')); rmSync(join(root, 'docs/ignored.md'));
    // In a fresh clone of the same configuration, even an empty opt-in store may not cross an index symlink.
    const shapeRoot = mkdtempSync(join(tmpdir(), 'curia-record-shape-'));
    try {
      const sg = (...args) => execFileSync('git', args, { cwd: shapeRoot, stdio: ['pipe', 'pipe', 'pipe'] });
      const sp = (p, bytes) => { mkdirSync(dirname(join(shapeRoot, p)), { recursive: true }); writeFileSync(join(shapeRoot, p), bytes); };
      sp(registryPath, JSON.stringify(config)); sp('AGENTS.md', '# Rules\n'); sp('.agents/README.md', '# Control\n'); sp('docs/README.md', '# Docs\n');
      sg('init', '-q'); sg('add', '--', registryPath, 'AGENTS.md', '.agents/README.md', 'docs/README.md');
      symlinkSync('outside', join(shapeRoot, 'docs/records')); sg('add', '--', 'docs/records');
      assert('records-index-symlink-ancestor', !runCheck(shapeRoot, { staged: true }).ok);
      sg('rm', '--cached', '--', 'docs/records'); unlinkSync(join(shapeRoot, 'docs/records'));
      let linkRemoved = false; try { lstatSync(join(shapeRoot, 'docs/records')); } catch (error) { linkRemoved = error.code === 'ENOENT'; }
      assert('records-broken-link-cleanup', linkRemoved);
      sp('docs/Records/runs/unknown.json', '{}'); sg('add', '--', 'docs/Records/runs/unknown.json');
      assert('records-index-case-alias', !runCheck(shapeRoot, { staged: true }).ok);
    } finally { rmSync(shapeRoot, { recursive: true, force: true }); }
    const savedIndex = process.env.GIT_INDEX_FILE;
    process.env.GIT_INDEX_FILE = join(root, '.git', 'index');
    try { assert('records-index-env-guard', runCheck(root, { staged: true }).ok); reject('records-index-env-writer', () => start()); }
    finally { if (savedIndex === undefined) delete process.env.GIT_INDEX_FILE; else process.env.GIT_INDEX_FILE = savedIndex; }

    for (const args of [['append', '--command', 'true'], ['show', '--run', terminal.runId, '--check', 'x'], ['start', '--path'], ['finish', '--run', terminal.runId, '--run', terminal.runId], ['start', '--json', '--json']]) reject(`records-cli-reject-${args.join('-')}`, () => parseRecordArgs(args));
    const cliShow = spawnSync(process.execPath, [cli, 'show', '--root', root, '--run', terminal.runId, '--json'], { encoding: 'utf8', env });
    assert('records-cli-show', cliShow.status === 0 && JSON.parse(cliShow.stdout).terminal, cliShow.stderr);
    const cliStart = spawnSync(process.execPath, [cli, 'start', '--root', root, '--path', '.agents/plans/input.md', '--json'], { encoding: 'utf8', env });
    assert('records-cli-start', cliStart.status === 0, cliStart.stderr);
    if (cliStart.status === 0) {
      const r = JSON.parse(cliStart.stdout);
      const c = spawnSync(process.execPath, [cli, 'finish', '--root', root, '--run', r.runId, '--expect', r.expectedHead, '--cancel', '--reason', 'fixture cancellation', '--json'], { encoding: 'utf8', env });
      assert('records-cli-terminal-exit', c.status === 130 && JSON.parse(c.stdout).exitCode === 130, c.stderr);
    }
    const oversizedCode = mkdtempSync(join(tmpdir(), 'curia-record-code-'));
    try {
      // A frozen observation manifest is not an installation manifest: include optional mode codecs for module linking.
      for (const { file } of recordCodeIdentity('external-verification')) cpSync(join(dirname(cli), file), join(oversizedCode, file));
      const loadable = spawnSync(process.execPath, [join(oversizedCode, 'curia-records.mjs'), 'show', '--root', root, '--run', terminal.runId, '--json'], { env, encoding: 'utf8' });
      assert('records-code-limit-control-loads', loadable.status === 0 && JSON.parse(loadable.stdout).terminal, loadable.stderr);
      writeFileSync(join(oversizedCode, 'curia-applicability.mjs'), readFileSync(join(oversizedCode, 'curia-applicability.mjs'), 'utf8') + `\n/*${'x'.repeat(1024 * 1024)}*/\n`);
      const big = spawnSync(process.execPath, [join(oversizedCode, 'curia-records.mjs'), 'start', '--root', root, '--path', '.agents/plans/input.md', '--json'], { env, encoding: 'utf8' });
      assert('records-no-prefix-code-digest', big.status === 1 && big.stderr.includes('代码文件超预算'), big.stderr);
    } finally { rmSync(oversizedCode, { recursive: true, force: true }); }
    const racing = start({ manualChecks: ['review'] });
    const argv = [cli, 'append', '--root', root, '--run', racing.runId, '--expect', racing.expectedHead, '--check', 'review', '--subject', 'race', '--statement', 'one append only', '--state', 'satisfied', '--evidence', '.agents/plans/input.md', '--observer', 'self-reported', '--json'];
    const parallel = spawnSync(process.execPath, ['--input-type=module', '-e', `import { spawn } from 'node:child_process'; const argv = ${JSON.stringify(argv)}; const run = () => new Promise(resolve => { let out='', err=''; const child=spawn(process.execPath, argv); child.stdout.on('data',d=>out+=d); child.stderr.on('data',d=>err+=d); child.on('close', code=>resolve({code,out,err})); }); console.log(JSON.stringify(await Promise.all([run(),run()])));`], { encoding: 'utf8', env, timeout: 30000 });
    const raced = parallel.status === 0 ? JSON.parse(parallel.stdout) : [];
    assert('records-concurrent-cas', raced.filter((r) => r.code === 0).length === 1 && showRun(root, racing.runId).events.length === 2, JSON.stringify(raced));
    assert('records-final-clean-check', runCheck(root).ok, JSON.stringify(runCheck(root).errors));
  } catch (e) { assert('unexpected-exception', false, e.stack); }
  finally { rmSync(root, { recursive: true, force: true }); }
}
if (isMainModule(import.meta.url)) {
  let passed = 0; const failed = [];
  recordFixtures({ registry: JSON.parse(readFileSync(join(ROOT, '.agents/doc-types.json'), 'utf8')), expectTrue: (name, condition, detail) => condition ? passed++ : failed.push(`${name}: ${detail}`) });
  console.log(`records self-test: ${passed} passed; ${failed.length} failed`);
  for (const error of failed) console.error(error);
  if (failed.length) process.exitCode = 1;
}
