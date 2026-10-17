/** Disposable local documentation and Git fixtures only; no product runtime or external effects. */
import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { ROOT, isMainModule } from './doc-lib.mjs';
import { recordAssertion, assertionHistory, loadRecordStore, showRun, finishRun, appendObservation, validateRecordFiles, rawDigest, parseRecordArgs } from './curia-records.mjs';
import { assertionSubjectKey, ASSERTION_HISTORY_LIMIT } from './curia-assertion-contract.mjs';
import { verifySources } from './curia-verify.mjs';
import { runCheck } from './check-records.mjs';

export function assertionFixtures({ expectTrue, registry }) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'curia-assertions-'))), store = 'docs/records', registryPath = '.agents/doc-types.json';
  const env = { ...process.env }; delete env.CURIA_STAGED; delete env.CURIA_STAGED;
  const cli = fileURLToPath(new URL('./curia-records.mjs', import.meta.url));
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: ['pipe', 'pipe', 'pipe'], env });
  const put = (path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
  const commit = (...paths) => { git('add', '--', ...paths); git('-c', 'user.name=fixture', '-c', 'user.email=fixture@local', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'assertion fixture'); };
  const assert = (name, condition, details = '') => expectTrue(`Curia assertions [${name}]`, condition, details);
  const reject = (name, fn) => { let error; try { fn(); } catch (e) { error = e; } assert(name, !!error, error?.stack ?? 'not rejected'); };
  const cfg = structuredClone(registry); delete cfg.instance;
  const binding = { schema: 'curia.instance/1', owner: 'assertion-owner', surfaces: [
    { id: 'control', kind: 'root', entry: '.agents/README.md', authorityLinks: ['AGENTS.md'], members: [{ path: '.agents', kind: 'directory', role: 'control' }] },
    { id: 'knowledge', kind: 'root', entry: 'docs/README.md', authorityLinks: ['docs/README.md'], members: [{ path: 'docs', kind: 'directory', role: 'knowledge' }] },
  ], recordStore: { schema: 'curia.record-store/1', path: store, owner: 'recorder', authorityLinks: ['docs/README.md'] } };
  const save = () => put(registryPath, JSON.stringify(cfg));
  const left = 'packages/api.json', right = 'docs/api.json';
  const good = '{"version":9007199254740993,"body":"SOURCE_BODY_MUST_NOT_BE_RECORDED"}';
  const request = { method: 'json-value-equal/1', left: { path: left, pointer: '/version' }, right: { path: right, pointer: '/version' }, nonSensitive: true };
  const record = (extra = {}, verification = {}) => recordAssertion(root, { verification: { ...request, ...verification }, ...extra });
  const frozen = run => new Map(run.events.map(e => [e.path, readFileSync(join(root, e.path))]));
  const invoke = (...args) => spawnSync(process.execPath, [cli, ...args, '--root', root, '--json'], { env, encoding: 'utf8', timeout: 30000 });
  const commandArgs = ['verify', '--method', request.method, '--left', left, '--left-pointer', '/version', '--right', right, '--right-pointer', '/version', '--non-sensitive'];
  try {
    for (const path of ['AGENTS.md', '.agents/README.md', 'docs/README.md']) put(path, '# Fixture\n');
    save(); put(left, good); put(right, good);
    git('init', '-q'); commit('AGENTS.md', '.agents/README.md', 'docs/README.md', registryPath, left, right);
    assert('ordinary-verifier-does-not-create-records', verifySources(root, request).exitCode === 0 && !existsSync(join(root, store)));
    reject('disabled-record-store', () => record()); assert('disabled-no-write', !existsSync(join(root, store)));
    cfg.instance = binding; save(); commit(registryPath);
    reject('non-sensitive-required', () => record({}, { nonSensitive: false }));
    reject('protected-does-not-downgrade', () => record({}, { protected: true }));
    reject('excluded-source-not-persisted', () => record({}, { exclusions: [left] }));
    reject('private-source-not-persisted', () => record({}, { left: { path: '.env', pointer: '/a' } }));
    put('.gitignore', 'docs/ignored.json\n'); put('docs/ignored.json', good);
    reject('ignored-source-not-persisted', () => record({}, { left: { path: 'docs/ignored.json', pointer: '/a' } }));
    assert('privacy-refusals-have-no-record-effects', !existsSync(join(root, store)));
    const first = record(), original = frozen(first);
    assert('one-run-two-events', first.status === 'passed' && first.events.length === 2 && first.events[0].kind === 'begin' && first.events[1].kind === 'terminal');
    assert('real-comparison-receipt', first.verification.assertion.state === 'confirmed' && first.verification.assertion.evidenceRefs.length === 2 && first.command === null && !first.observations.length);
    assert('no-body-no-values', !JSON.stringify(first).includes('SOURCE_BODY_MUST_NOT_BE_RECORDED') && ![...original.values()].some(b => b.includes('SOURCE_BODY_MUST_NOT_BE_RECORDED') || b.includes('9007199254740993')));
    assert('different-schema-not-manual', JSON.parse(original.values().next().value).schema === 'curia.run-event/4' && first.executionMode === 'local-verification');
    assert('historical-not-current', first.result.sourceCurrency === 'not-revalidated-at-seal' && first.result.factVerification === 'selected-local-equality-only' && first.result.businessOutcome === 'not-evaluated');
    assert('standalone-history', assertionHistory(root, first.runId).selectedConclusion === first.runId);
    reject('imported-report-not-a-capability', () => recordAssertion(root, { verification: request, report: verifySources(root, request) }));
    reject('caller-assigned-id', () => record({ runId: first.runId }));
    reject('corrects-requires-reason', () => record({ corrects: first.runId }));
    reject('reason-requires-correction', () => record({ reason: 'unused' }));
    reject('references-mutually-exclusive', () => record({ corrects: first.runId, retriedFrom: first.runId, reason: 'ambiguous' }));
    reject('cross-subject-correction', () => record({ corrects: first.runId, reason: 'wrong scope' }, { left: { path: left, pointer: '/body' } }));
    reject('cross-method-correction', () => record({ corrects: first.runId, reason: 'wrong method' }, { method: 'raw-bytes-equal/1', left: { path: left }, right: { path: right } }));
    reject('input-cannot-read-record-output', () => record({}, { left: { path: first.events[0].path, pointer: '' }, includeUntracked: true }));
    put(right, good.replace('9007199254740993', '9007199254740992'));
    const correction = record({ corrects: first.runId, reason: 'Compare the corrected source revision' });
    assert('contradiction-is-not-passed', correction.status === 'failed' && correction.exitCode === 1 && correction.verification.assertion.state === 'contradicted');
    assert('old-evidence-preserved', [...original].every(([p, b]) => readFileSync(join(root, p)).equals(b)));
    const history = assertionHistory(root, first.runId);
    assert('explicit-correction-retires-old-conclusion', history.nodes.length === 2 && history.selectedConclusion === correction.runId && history.edges[0].kind === 'corrects');
    assert('history-both-directions-same-component', JSON.stringify(assertionHistory(root, correction.runId).nodes) === JSON.stringify(history.nodes));
    const independent = record();
    assert('same-subject-is-not-implicit-global-history', assertionHistory(root, independent.runId).nodes.length === 1 && history.scope.allMatchingSubjects === false);
    put(right, good); const fork = record({ corrects: first.runId, reason: 'Second independent correction' });
    const forked = assertionHistory(root, first.runId);
    assert('fork-does-not-select-newest', forked.exitCode === 2 && forked.selectedConclusion === null && forked.conclusionHeads.includes(fork.runId) && forked.conclusionHeads.includes(correction.runId));
    const retry = record({ retriedFrom: independent.runId });
    const retried = assertionHistory(root, retry.runId);
    assert('retry-is-not-supersession', retried.exitCode === 2 && retried.conclusionHeads.includes(independent.runId) && retried.conclusionHeads.includes(retry.runId) && retried.edges.every(e => !e.effective));
    const missing = record({}, { left: { path: left, pointer: '/missing' }, right: { path: right, pointer: '/missing' } });
    assert('unknown-preserves-gaps', missing.status === 'incomplete' && missing.exitCode === 2 && missing.verification.assertion.verifiedBy === null && missing.verification.comparison.state === 'missing');
    put(left, '{"missing":1}'); put(right, '{"missing":1}');
    const resolved = record({ corrects: missing.runId, reason: 'Sources now expose the requested fields' }, { left: { path: left, pointer: '/missing' }, right: { path: right, pointer: '/missing' } });
    assert('corrected-incomplete-history-can-resolve', assertionHistory(root, resolved.runId).selectedConclusion === resolved.runId);
    put(left, good); put(right, good);
    const rootComparison = record({}, { left: { path: left, pointer: '' }, right: { path: right, pointer: '' } });
    assert('root-pointer-keeps-empty-locator', rootComparison.status === 'passed' && rootComparison.verification.assertion.sourceRefs[0].locator.pointer === '');
    const raw = record({}, { method: 'raw-bytes-equal/1', left: { path: left }, right: { path: right } });
    assert('raw-comparison-same-storage-no-json-assumption', raw.status === 'passed' && raw.verification.assertion.sourceRefs[0].locator.kind === 'whole-file/1');
    put(left, '{"key ":1}'); put(right, '{"key ":1}');
    const spaced = record({}, { left: { path: left, pointer: '/key ' }, right: { path: right, pointer: '/key ' } });
    assert('pointer-whitespace-is-data-not-normalized', spaced.status === 'passed' && spaced.verification.assertion.sourceRefs[0].locator.pointer === '/key ');
    put(left, good); put(right, good);
    const withdrawn = record(); rmSync(join(root, right));
    const unknownCorrection = record({ corrects: withdrawn.runId, reason: 'The source is unavailable for a renewed comparison' });
    const unknownHistory = assertionHistory(root, withdrawn.runId);
    assert('unverified-correction-never-revives-old-confirmation', unknownCorrection.status === 'incomplete' && unknownHistory.selectedConclusion === null && !unknownHistory.conclusionHeads.includes(withdrawn.runId));
    put(right, good);
    const unsealed = record(); rmSync(join(root, unsealed.events[1].path));
    const open = showRun(root, unsealed.runId);
    assert('unsealed-is-open-not-passed', !open.terminal && open.status === 'open' && assertionHistory(root, open.runId).selectedConclusion === null);
    reject('unsealed-not-a-correction-target', () => record({ corrects: open.runId, reason: 'not sealed' }));
    reject('manual-observation-cannot-fill-verification', () => appendObservation(root, open.runId, open.expectedHead, {}));
    reject('wrong-expected-head', () => finishRun(root, open.runId, 'wrong'));
    reject('cancel-cannot-rewrite-completed-observation', () => finishRun(root, open.runId, open.expectedHead, { cancel: true, reason: 'pretend never verified' }));
    rmSync(join(root, right));
    const sealed = finishRun(root, open.runId, open.expectedHead);
    assert('sealing-never-reexecutes-or-reads-sources', sealed.status === 'passed' && !existsSync(join(root, right)) && sealed.verification.completedAt === open.verification.completedAt);
    put(right, good);
    const cliGood = invoke(...commandArgs); assert('cli-real-verify', cliGood.status === 0 && JSON.parse(cliGood.stdout).verification.assertion.state === 'confirmed', cliGood.stderr);
    const cliId = JSON.parse(cliGood.stdout).runId;
    const cliHistory = invoke('history', '--run', cliId); assert('cli-history', cliHistory.status === 0 && JSON.parse(cliHistory.stdout).selectedConclusion === cliId);
    put(right, '{"version":0}'); const cliBad = invoke(...commandArgs); assert('cli-contradiction-exit', cliBad.status === 1 && JSON.parse(cliBad.stdout).verification.assertion.state === 'contradicted'); put(right, good);
    const privateCli = invoke(...commandArgs, '--protected'); assert('cli-protected-no-result', privateCli.status !== 0 && privateCli.stdout.length === 0);
    for (const args of [['verify', '--json', '--unknown'], [...commandArgs, '--corrects', first.runId, '--corrects', first.runId], ['history', '--run', first.runId, '--path', left]]) reject('strict-cli-options', () => parseRecordArgs(args));
    const orderA = { ...request, exclusions: [], includeUntracked: false }, orderB = { ...orderA, left: { pointer: '/version', path: left } };
    assert('subject-key-canonical-field-order', JSON.stringify(assertionSubjectKey(orderA)) === JSON.stringify(assertionSubjectKey(orderB)));
    const all = loadRecordStore(root).files, beginPath = first.events[0].path, terminalPath = first.events[1].path;
    const mutate = (label, change, terminal = false) => {
      const files = new Map(all), target = terminal ? terminalPath : beginPath, data = JSON.parse(files.get(target)); change(data);
      files.set(target, Buffer.from(JSON.stringify(data)));
      if (!terminal) { const end = JSON.parse(files.get(terminalPath)); end.previous = rawDigest(files.get(beginPath)).value; files.set(terminalPath, Buffer.from(JSON.stringify(end))); }
      reject(`decoder-${label}`, () => validateRecordFiles(files, store));
    };
    for (const [label, change] of [
      ['wrong-container', d => { d.schema = 'curia.run-event/1'; }], ['unknown-field', d => { d.payload.authorized = true; }],
      ['wrong-subject', d => { d.payload.subjectKey.value = '0'.repeat(64); }], ['different-store', d => { d.payload.recordContext.recordStore = 'docs/elsewhere'; }],
      ['future-observation', d => { d.payload.verification.completedAt = '2099-01-01T00:00:00.000Z'; }],
      ['fake-identity', d => { d.payload.verification.verifier.authentication = 'authenticated'; }],
      ['code-mismatch', d => { d.payload.verification.verifier.implementation[0].digest.value = '0'.repeat(64); }],
      ['no-evidence-success', d => { d.payload.verification.assertion.evidenceRefs = []; }],
      ['duplicate-evidence', d => { d.payload.verification.assertion.evidenceRefs[1] = d.payload.verification.assertion.evidenceRefs[0]; }],
      ['source-not-requested', d => { d.payload.verification.assertion.sourceRefs[0].uri = 'repo:docs/other.json'; }],
      ['fake-revision', d => { d.payload.verification.assertion.sourceRefs[0].revision.value = '0'.repeat(64); }],
      ['comparison-contradicts-state', d => { d.payload.verification.comparison.state = 'different'; }],
      ['comparison-value-leak', d => { d.payload.verification.comparison.left.value = 'secret'; }],
      ['unstable-success', d => { d.payload.verification.capture.stable = false; }],
      ['partial-implementation', d => { d.payload.verification.verifier.implementation.pop(); }],
      ['insufficient-open-files', d => { d.payload.verification.capture.openedFiles = 1; }],
      ['empty-implementation', d => { d.payload.verification.verifier.implementation = []; }],
      ['limits-removed', d => { d.payload.verification.assertion.limits = []; }],
      ['wrong-action', d => { d.payload.verification.assertion.verifiedBy.action = 'approved'; }],
      ['manual-event', d => { d.kind = 'observation'; }],
    ]) mutate(label, change);
    mutate('forged-terminal', d => { d.payload.businessOutcome = 'approved'; }, true);
    const changed = JSON.parse(all.get(correction.events[0].path)); changed.payload.references.corrects = raw.runId;
    const mismatched = new Map(all); mismatched.set(correction.events[0].path, Buffer.from(JSON.stringify(changed))); mismatched.delete(correction.events[1].path);
    reject('decoder-cross-subject-reference', () => validateRecordFiles(mismatched, store));
    const recordPaths = [...loadRecordStore(root).files.keys()]; commit(...recordPaths);
    assert('records-guard-sees-new-mode', runCheck(root).ok && runCheck(root, { staged: true }).ok);
    put(beginPath, 'modified frozen event'); reject('frozen-git-history-cannot-be-rewritten', () => showRun(root, first.runId)); put(beginPath, original.get(beginPath));
    // Synthetic codec fixtures have no execution claim. They exercise bounded traversal, not authenticated history.
    const templateBegin = JSON.parse(original.get(beginPath)), templateEnd = JSON.parse(original.get(terminalPath));
    let parent = first.runId; const extraPaths = [], at = new Date().toISOString();
    for (let i = 0; i < ASSERTION_HISTORY_LIMIT; i++) {
      const id = `r-${randomUUID()}`, b = structuredClone(templateBegin), e = structuredClone(templateEnd);
      for (const event of [b, e]) { event.runId = id; event.workflowId = `w-${id.slice(2)}`; event.observedAt = at; }
      b.payload.references = { corrects: parent, retriedFrom: null }; b.payload.correctionReason = 'Bounded history fixture';
      const bytes = Buffer.from(JSON.stringify(b)); e.previous = rawDigest(bytes).value; e.payload.endedAt = at;
      const bp = `${store}/${id}.00000000.json`, ep = `${store}/${id}.00000001.json`; put(bp, bytes); put(ep, JSON.stringify(e)); extraPaths.push(bp, ep); parent = id;
    }
    reject('history-budget-refuses-partial-success', () => assertionHistory(root, parent));
    for (const path of extraPaths) rmSync(join(root, path));
    assert('fixtures-leave-complete-valid-store', loadRecordStore(root).runs.size > 0 && runCheck(root).ok);
  } finally { rmSync(root, { recursive: true, force: true }); }
}
if (isMainModule(import.meta.url)) {
  let passed = 0, failed = 0;
  assertionFixtures({ registry: JSON.parse(readFileSync(join(ROOT, '.agents/doc-types.json'), 'utf8')), expectTrue: (name, condition, details) => { if (condition) passed++; else { failed++; console.error(name, details); } } });
  console.log(`assertion recording fixtures: ${passed} passed; ${failed} failed`); process.exitCode = failed ? 1 : 0;
}
