/** Disposable Git/document fixtures for registered-original machine evidence; no parser execution or network. */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, realpathSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { ROOT, isMainModule } from './doc-lib.mjs';
import { recordOriginalAssertion, recordAssertion, assertionHistory, inspectRecordStore, loadRecordStore, showRun, finishRun, appendObservation, validateRecordFiles, rawDigest, parseRecordArgs } from './curia-records.mjs';
import { assertionSubjectKey } from './curia-assertion-contract.mjs';
import { verifyRegisteredOriginal } from './curia-verify.mjs';
import { runCheck } from './check-records.mjs';
export function originalRecordFixtures({ expectTrue, registry }) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'curia-original-records-'))), store = 'docs/records', regPath = '.agents/doc-types.json', register = 'docs/source-register.json', source = 'docs/files/manual.pdf';
  const env = { ...process.env }; delete env.CURIA_STAGED; delete env.CURIA_STAGED;
  const cli = fileURLToPath(new URL('./curia-records.mjs', import.meta.url));
  const git = (...args) => execFileSync('git', args, { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] });
  const put = (path, data) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), data); };
  const commit = (...paths) => { git('add', '--', ...paths); git('-c', 'user.name=fixture', '-c', 'user.email=fixture@local', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'registered original fixture', '--', ...paths); };
  const assert = (name, ok, detail = '') => expectTrue(`Curia original records [${name}]`, !!ok, detail);
  const reject = (name, fn) => { let error; try { fn(); } catch (e) { error = e; } assert(name, error, error?.message ?? 'not rejected'); };
  const cfg = structuredClone(registry); delete cfg.instance;
  const binding = { schema: 'curia.instance/1', owner: 'fixture', surfaces: [
    { id: 'control', kind: 'root', entry: '.agents/README.md', authorityLinks: ['AGENTS.md'], members: [{ path: '.agents', kind: 'directory', role: 'control' }] },
    { id: 'knowledge', kind: 'root', entry: 'docs/README.md', authorityLinks: ['docs/README.md'], members: [{ path: 'docs', kind: 'directory', role: 'knowledge' }] },
  ], recordStore: { schema: 'curia.record-store/1', path: store, owner: 'recorder', authorityLinks: ['docs/README.md'] } };
  const content = Buffer.concat([Buffer.from('%PDF-PRIVATE_BODY_NOT_RECORDED\0'), Buffer.alloc(131073, 0xff)]), revision = bytes => `sha256:raw-bytes/1:${rawDigest(bytes).value}`;
  const declaration = (bytes = content) => ({ schema: 'curia.original-register/1', owner: 'DECLARED_OWNER_NOT_RECORDED', accessRef: 'docs/PRIVATE_ACCESS_NOT_RECORDED.md', originals: [{ id: 'manual', format: 'pdf', encryption: 'encrypted', sourceRef: { uri: `repo:${source}`, revision: revision(bytes), locator: 'DECLARED_LOCATOR_NOT_RECORDED', observedAt: '2026-10-15' } }] });
  const save = () => put(regPath, JSON.stringify(cfg));
  const saveRegister = (change = () => {}) => { const d = declaration(); change(d); put(register, JSON.stringify(d)); };
  const request = { register, id: 'manual', source, nonSensitive: true };
  const record = (extra = {}, verify = {}) => recordOriginalAssertion(root, { verification: { ...request, ...verify }, ...extra });
  const invoke = args => spawnSync(process.execPath, [cli, ...args, '--root', root, '--json'], { env, encoding: 'utf8', timeout: 30000 });
  const command = ['verify-original', '--register', register, '--id', 'manual', '--source', source, '--non-sensitive'];
  const files = () => new Map(loadRecordStore(root).files);
  try {
    for (const path of ['AGENTS.md', '.agents/README.md', 'docs/README.md']) put(path, '# Fixture\n');
    save(); saveRegister(); put(source, content); git('init', '-q'); commit('AGENTS.md', '.agents/README.md', 'docs/README.md', regPath, register, source);
    assert('ordinary-original-verification-still-stateless', verifyRegisteredOriginal(root, request).exitCode === 0 && !existsSync(join(root, store)));
    reject('disabled-store-no-adoption', () => record()); assert('disabled-no-records', !existsSync(join(root, store)));
    cfg.instance = binding; save(); commit(regPath);
    reject('privacy-required', () => record({}, { nonSensitive: false }));
    reject('protected-no-downgrade', () => record({}, { protected: true }));
    reject('excluded-no-record', () => record({}, { exclusions: [source] }));
    assert('refusal-no-created-store', !existsSync(join(root, store)));
    const first = record(), original = new Map(first.events.map(e => [e.path, readFileSync(join(root, e.path))]));
    const beginPath = first.events[0].path, endPath = first.events[1].path, begin = JSON.parse(original.get(beginPath)), terminal = JSON.parse(original.get(endPath));
    assert('versioned-original-observation', first.schema === 'curia.assertion-run-view/2' && begin.schema === 'curia.run-event/5' && terminal.schema === 'curia.run-event/5' && begin.payload.schema === 'curia.assertion-run/2' && first.verification.schema === 'curia.assertion-observation/2');
    assert('real-two-phase-evidence', first.status === 'passed' && first.verification.assertion.state === 'confirmed' && first.verification.capture.register.openedFiles === 1 && first.verification.capture.original.openedFiles === 1 && first.verification.capture.original.chargedBytes === content.length && first.verification.assertion.evidenceRefs[1].verification === 'actual-complete-source-digest');
    assert('declarations-not-authority', first.verification.declaration.declaredEncryption === 'encrypted' && first.verification.declaration.decryption === 'not-invoked' && first.verification.declaration.accessVerification === 'not-performed' && first.result.factVerification === 'registered-whole-original-digest-only');
    assert('no-body-owner-access-or-declared-locator', !JSON.stringify(first).match(/PRIVATE_BODY_NOT_RECORDED|DECLARED_OWNER_NOT_RECORDED|PRIVATE_ACCESS_NOT_RECORDED|DECLARED_LOCATOR_NOT_RECORDED/));
    assert('registration-pointer-and-original-whole-file', first.verification.assertion.sourceRefs[0].locator.pointer === '/originals/0' && first.verification.assertion.sourceRefs[1].locator.kind === 'whole-file/1');
    assert('history-new-view-version', assertionHistory(root, first.runId).schema === 'curia.assertion-history/2' && assertionHistory(root, first.runId).selectedConclusion === first.runId);
    assert('budget-does-not-change-subject', JSON.stringify(assertionSubjectKey({ ...first.request, maxSourceBytes: 200000 })) === JSON.stringify(first.subjectKey));
    reject('imported-report-refused', () => record({ report: verifyRegisteredOriginal(root, request) }));
    reject('caller-run-id-refused', () => record({ runId: first.runId }));
    reject('corrects-needs-reason', () => record({ corrects: first.runId }));
    reject('corrects-and-retry-exclusive', () => record({ corrects: first.runId, retriedFrom: first.runId, reason: 'ambiguous' }));
    reject('different-registration-is-not-same-claim', () => record({ corrects: first.runId, reason: 'scope mismatch' }, { id: 'another' }));
    reject('different-original-is-not-same-claim', () => record({ corrects: first.runId, reason: 'scope mismatch' }, { source: 'docs/other.pdf' }));
    reject('output-not-input', () => record({}, { source: beginPath, includeUntracked: true }));
    const changed = Buffer.from('%PDF-CHANGED'); put(source, changed);
    const different = record({ corrects: first.runId, reason: 'Observe changed original revision' });
    assert('changed-original-contradiction', different.status === 'failed' && different.exitCode === 1 && different.verification.comparison.state === 'different');
    assert('frozen-old-events-not-rewritten', [...original].every(([p,b])=>readFileSync(join(root,p)).equals(b)));
    assert('explicit-history-corrects', assertionHistory(root, first.runId).selectedConclusion === different.runId);
    const retry = record({ retriedFrom: different.runId }); assert('retry-keeps-ambiguity', assertionHistory(root, retry.runId).selectedConclusion === null);
    put(source, content);
    const missing = record({}, { id: 'missing' }); assert('missing-id-retains-register-only-evidence', missing.status === 'incomplete' && missing.verification.assertion.evidenceRefs.length === 1 && !missing.verification.capture.original.available && missing.verification.declaration === null);
    saveRegister(d => d.originals[0].sourceRef.revision = 'opaque-version');
    const opaque = record(); assert('opaque-revision-not-hashed', opaque.status === 'incomplete' && opaque.verification.capture.original.openedFiles === 0 && opaque.verification.assertion.sourceRefs[1].revision === null);
    saveRegister(d => d.originals[0].sourceRef.uri = 'paper:ARCHIVE-1');
    assert('external-reference-not-followed', record().verification.unresolved.includes('original/non-local-source'));
    saveRegister(d => d.originals[0].sourceRef.uri = 'repo:docs/other.pdf');
    assert('source-identity-mismatch-not-hashed', record().verification.capture.original.available === false);
    put(register, '{ invalid'); const invalid = record(); assert('invalid-register-retains-only-real-bytes', invalid.verification.assertion.evidenceRefs.length === 1 && invalid.status === 'incomplete'); saveRegister();
    const Native = globalThis.TextDecoder; let changedDuringParse = false;
    globalThis.TextDecoder = class extends Native { decode(bytes, ...rest) { const text = super.decode(bytes, ...rest); if (!changedDuringParse && text.includes('DECLARED_OWNER_NOT_RECORDED')) { changedDuringParse = true; put(source, Buffer.from('CHANGED_DURING_REGISTRATION_PARSE')); } return text; } };
    let drifted; try { drifted = record(); } finally { globalThis.TextDecoder = Native; put(source, content); }
    assert('two-phase-source-drift-withdrawal', changedDuringParse && drifted.status === 'incomplete' && drifted.verification.assertion.evidenceRefs.length === 0 && drifted.verification.assertion.sourceRefs.every(r=>r.revision===null));
    const unavailable = record({}, { source: 'docs/files/missing.pdf' }); assert('missing-original-never-invented', unavailable.status==='incomplete' && unavailable.verification.assertion.evidenceRefs.length===0);
    put('docs/files/new.pdf', content); saveRegister(d=>d.originals[0].sourceRef.uri='repo:docs/files/new.pdf');
    assert('untracked-original-explicit-opt-in', record({}, {source:'docs/files/new.pdf'}).status==='incomplete' && record({}, {source:'docs/files/new.pdf',includeUntracked:true}).status==='passed'); saveRegister();
    const limited = record({}, { maxSourceBytes: 8 }); assert('source-budget-withdraws-entire-evidence', limited.status === 'incomplete' && !limited.verification.assertion.evidenceRefs.length && limited.verification.declaration === null);
    const corrected = record({ corrects: limited.runId, reason: 'Increase explicitly authorized source budget' }); assert('valid-correction-retires-old-gap', assertionHistory(root, limited.runId).selectedConclusion === corrected.runId);
    const beforeIgnored = readdirSync(join(root, store)).length; put('.gitignore', source + '\n'); reject('ignored-source-refused-before-record', () => record()); rmSync(join(root, '.gitignore')); assert('ignored-refusal-writes-nothing', readdirSync(join(root,store)).length===beforeIgnored);
    const equal = recordAssertion(root, { verification: { method: 'raw-bytes-equal/1', left: { path: register }, right: { path: register }, nonSensitive: true } });
    assert('equality-v1-is-unchanged', equal.schema === 'curia.assertion-run-view/1' && equal.verification.schema === 'curia.assertion-observation/1');
    reject('equality-cannot-correct-original', () => record({ corrects: equal.runId, reason: 'not same subject' }));
    const cliOK = invoke(command); assert('real-cli-route', cliOK.status === 0 && JSON.parse(cliOK.stdout).verification.assertion.state === 'confirmed', cliOK.stderr);
    const cliBad = invoke([...command, '--protected']); assert('cli-refusal-exit-two-no-stdout', cliBad.status === 2 && cliBad.stdout === '');
    for (const tail of [['--method', 'raw-bytes-equal/1'], ['--run', first.runId], ['--non-sensitive'], ['--max-source-bytes', '0']]) reject('invalid-cli-' + tail.join('-'), () => parseRecordArgs([...command, ...tail]));
    // Codec mutations rebuild the hash chain; rejection must come from contract invariants, not stale hashes.
    const mutate = (name, fn) => { const all = files(), b = structuredClone(begin), t = structuredClone(terminal); fn(b.payload, t.payload, b, t); const raw = Buffer.from(JSON.stringify(b)); t.previous = rawDigest(raw).value; all.set(beginPath, raw); all.set(endPath, Buffer.from(JSON.stringify(t))); reject(name, () => validateRecordFiles(all, store)); };
    for (const [name, fn] of [
      ['event-version-cannot-downgrade', (b,t,be,te)=>{be.schema='curia.run-event/4';te.schema='curia.run-event/4';}],
      ['begin-contract-cannot-downgrade', b=>b.schema='curia.assertion-run/1'],
      ['observation-contract-cannot-downgrade', b=>b.verification.schema='curia.assertion-observation/1'],
      ['wrong-registration-id', b=>b.verification.declaration.registrationId='other'],
      ['wrong-register-pointer', b=>b.verification.assertion.sourceRefs[0].locator.pointer='/originals/128'],
      ['source-cannot-use-entry-pointer', b=>b.verification.assertion.sourceRefs[1].locator={kind:'json-pointer/1',pointer:'/originals/0'}],
      ['original-hash-is-not-content-read', b=>b.verification.assertion.evidenceRefs[1].verification='actual-complete-source-bytes'],
      ['register-bytes-not-original-digest', b=>b.verification.assertion.evidenceRefs[0].verification='actual-complete-source-digest'],
      ['phase-total-budget-mismatch', b=>b.verification.capture.chargedBytes++],
      ['phase-original-unobserved', b=>b.verification.capture.original.openedFiles=0],
      ['phase-budget-exceeded', b=>b.verification.capture.original.chargedBytes=513*1024*1024],
      ['missing-actual-evidence', b=>b.verification.assertion.evidenceRefs.pop()],
      ['register-digest-stays-sha256', b=>{const d={algorithm:'sha512',canonicalization:'raw-bytes/1',value:'0'.repeat(128)};b.verification.assertion.sourceRefs[0].revision=d;b.verification.assertion.evidenceRefs[0].contentDigest=d;}],
      ['registry-digest-stays-sha256', b=>b.recordContext.registryDigest={algorithm:'sha512',canonicalization:'raw-bytes/1',value:'0'.repeat(128)}],
      ['code-digest-stays-sha256', b=>b.codeIdentity[0].digest={algorithm:'sha512',canonicalization:'raw-bytes/1',value:'0'.repeat(128)}],
      ['wrong-expected-digest', b=>b.verification.comparison.expected.value='0'.repeat(64)],
      ['wrong-actual-digest', b=>b.verification.comparison.observed.value='1'.repeat(64)],
      ['false-comparison-state', b=>b.verification.comparison.state='different'],
      ['invalid-declared-format-type', b=>b.verification.declaration.declaredFormat=null],
      ['fake-access-verification', b=>b.verification.declaration.accessVerification='confirmed'],
      ['fake-decryption', b=>b.verification.declaration.decryption='done'],
      ['missing-verifier-module', b=>b.verification.verifier.implementation.pop()],
      ['missing-recorder-module', b=>b.codeIdentity=b.codeIdentity.filter(c=>c.file!=='curia-records.mjs')],
      ['fake-authentication', b=>b.verification.verifier.authentication='authenticated'],
      ['wrong-identity-canonicalization', b=>b.subjectKey.canonicalization='curia.assertion-subject/1'],
      ['raw-report-injection', b=>b.verification.sourceBody='PRIVATE'],
      ['terminal-cannot-claim-business', (b,t)=>t.businessOutcome='completed'],
    ]) mutate(name, fn);
    mutate('digest-key-order-cannot-forge-contradiction', (b,t)=>{const d=b.verification.comparison.expected;b.verification.comparison.expected={value:d.value,algorithm:d.algorithm,canonicalization:d.canonicalization};b.verification.declaration.revision=b.verification.comparison.expected;b.verification.comparison.state='different';b.verification.assertion.state='contradicted';b.verification.exitCode=1;t.status='failed';t.exitCode=1;t.assertionState='contradicted';});
    mutate('different-algorithms-cannot-forge-contradiction', (b,t)=>{
      const d={algorithm:'sha512',canonicalization:'raw-bytes/1',value:createHash('sha512').update(content).digest('hex')};
      b.verification.declaration.revision=d;b.verification.comparison.expected=d;b.verification.comparison.state='different';b.verification.assertion.state='contradicted';b.verification.exitCode=1;t.status='failed';t.exitCode=1;t.assertionState='contradicted';
    });
    for (const [name, algorithm, revision] of [
      ['sha512-hex','sha512','sha512:raw-bytes/1:'+createHash('sha512').update(content).digest('hex')],
      ['sha256-sri','sha256','sha256-'+createHash('sha256').update(content).digest('base64')],
      ['sha512-sri','sha512','sha512-'+createHash('sha512').update(content).digest('base64')],
    ]) {
      saveRegister(d=>d.originals[0].sourceRef.revision=revision);const registrationBytes=readFileSync(join(root,register)), r=record();
      const kept=new Map(r.events.map(e=>[e.path,readFileSync(join(root,e.path))]));
      assert(`native-${name}-record-and-show`,r.status==='passed'&&showRun(root,r.runId).verification.comparison.observed.algorithm===algorithm&&r.verification.comparison.observed.value===createHash(algorithm).update(content).digest('hex'));
      assert(`native-${name}-non-original-identities`,r.verification.assertion.sourceRefs[0].revision.algorithm==='sha256'&&r.verification.verifier.implementation.every(c=>c.digest.algorithm==='sha256')&&readFileSync(join(root,register)).equals(registrationBytes));
      put(source,Buffer.from('NEW_REVISION'));const correction=record({corrects:r.runId,reason:'Observe a changed native-digest original'});
      assert(`native-${name}-frozen-history`,correction.status==='failed'&&assertionHistory(root,r.runId).selectedConclusion===correction.runId&&showRun(root,r.runId).status==='passed'&&[...kept].every(([p,b])=>readFileSync(join(root,p)).equals(b)));put(source,content);
    }
    saveRegister();
    // Finishing an interrupted record consumes only the existing observation, even if the source later vanishes.
    const open = record(), oldObservation = JSON.stringify(open.verification); rmSync(join(root, open.events[1].path)); rmSync(join(root, source));
    const openView = showRun(root, open.runId); reject('manual-observation-cannot-upgrade-original', () => appendObservation(root, open.runId, openView.expectedHead, {}));
    const sealed = finishRun(root, open.runId, openView.expectedHead); assert('recovery-does-not-reverify-or-read-original', sealed.status === 'passed' && JSON.stringify(sealed.verification) === oldObservation); put(source, content);
    const stagedPaths = [...loadRecordStore(root).files.keys()]; commit(register, source, ...stagedPaths);
    assert('valid-worktree-and-staged-store', runCheck(root).ok && runCheck(root, { staged: true }).ok);
    const goodBegin = readFileSync(join(root,beginPath)); const bad = JSON.parse(goodBegin); bad.payload.verification.declaration.extraction='done'; put(beginPath,JSON.stringify(bad));git('add','--',beginPath);put(beginPath,goodBegin);
    assert('good-disk-cannot-hide-bad-index-original', !runCheck(root,{staged:true}).ok);git('add','--',beginPath);
    assert('bad-event-never-repairs-frozen-history', runCheck(root,{staged:true}).ok);
    exerciseNativeRecovery({ root, store, source, request, first, cli, env, git, assert });

  } finally { rmSync(root, { recursive: true, force: true }); }
}
/** Native backup is outside Curia; prove recovery compatibility without adding a backup engine. */
function exerciseNativeRecovery({ root, store, source, request, first, cli, env, git, assert }) {
  const work = realpathSync(mkdtempSync(join(tmpdir(), 'curia-native-recovery-')));
  const bundle = join(work, 'committed.bundle'), restored = join(work, 'restored');
  const frozen = 'docs/releases/frozen-result.md', checkpoint = 'docs/checkpoint.txt', untracked = 'docs/untracked-attachment.bin';
  const put = (base, path, bytes) => { mkdirSync(dirname(join(base, path)), { recursive: true }); writeFileSync(join(base, path), bytes); };
  const restoredGit = (...args) => execFileSync('git', ['-C', restored, ...args], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  try {
    put(root, frozen, '# Frozen result fixture\n\nThe project owns retention of this result and its original.\n');
    put(root, checkpoint, 'COMMITTED_CHECKPOINT\n');
    git('add', '--', frozen, checkpoint);
    git('-c', 'user.name=fixture', '-c', 'user.email=fixture@local', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'recovery inputs', '--', frozen, checkpoint);
    // This independently retained baseline is the recovery target, not a value learned from the restored tree.
    const expectedHead = git('rev-parse', 'HEAD').toString().trim();
    const expected = new Map(git('ls-tree', '-r', '-z', '--name-only', 'HEAD').toString().split('\0').filter(Boolean).map(path => [path, git('show', `HEAD:${path}`)]));
    const before = showRun(root, first.runId);
    const historyContent = ({ generatedAt, ...recorded }) => recorded; // Only this view timestamp is newly observed.
    const history = historyContent(assertionHistory(root, first.runId));
    const expectedEvents = [...expected].filter(([path]) => path.startsWith(`${store}/`));
    const missingOrChanged = () => [...expected].filter(([path, bytes]) => !existsSync(join(restored, path)) || !readFileSync(join(restored, path)).equals(bytes)).map(([path]) => path);
    put(root, checkpoint, 'STAGED_CHECKPOINT_NOT_BACKED_UP\n'); git('add', '--', checkpoint);
    put(root, checkpoint, 'WORKTREE_CHECKPOINT_NOT_BACKED_UP\n'); put(root, untracked, Buffer.from([0, 255, 1, 2]));
    const uncommitted = recordOriginalAssertion(root, { verification: request });
    assert('recovery-source-includes-uncommitted-run', uncommitted.baseline.uncommittedEvents === 2);
    const dirtyBefore = git('status', '--porcelain=v1', '-z');
    git('bundle', 'create', bundle, '--all'); git('bundle', 'verify', bundle);
    execFileSync('git', ['clone', '-q', '--no-checkout', '--', bundle, restored], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    restoredGit('-c', 'core.hooksPath=/dev/null', 'checkout', '-q', '--detach', expectedHead);
    restoredGit('fsck', '--full');
    assert('recovery-native-backup-does-not-change-source', git('status', '--porcelain=v1', '-z').equals(dirtyBefore));
    assert('recovery-independent-objects-and-trusted-head', restoredGit('rev-parse', 'HEAD').toString().trim() === expectedHead && !existsSync(join(restored, '.git/objects/info/alternates')));
    assert('recovery-all-committed-artifacts-exact', missingOrChanged().length === 0 && restoredGit('ls-files', '-z').toString().split('\0').filter(Boolean).length === expected.size);
    assert('recovery-frozen-result-and-binary-original-exact', readFileSync(join(restored, frozen)).equals(expected.get(frozen)) && readFileSync(join(restored, source)).equals(expected.get(source)));
    assert('recovery-does-not-include-index-or-worktree', readFileSync(join(restored, checkpoint)).equals(expected.get(checkpoint)) && !readFileSync(join(root, checkpoint)).equals(expected.get(checkpoint)));
    assert('recovery-does-not-include-untracked-attachment', !existsSync(join(restored, untracked)));
    assert('recovery-does-not-include-uncommitted-run', !loadRecordStore(restored).runs.has(uncommitted.runId) && uncommitted.events.every(event => !existsSync(join(restored, event.path))));
    const recovered = showRun(restored, first.runId);
    assert('recovery-existing-run-id-and-events-unchanged', recovered.runId === first.runId && JSON.stringify(recovered.events) === JSON.stringify(before.events) && expectedEvents.every(([path, bytes]) => readFileSync(join(restored, path)).equals(bytes)));
    assert('recovery-frozen-assertion-and-history-unchanged', JSON.stringify(recovered.verification) === JSON.stringify(before.verification) && JSON.stringify(historyContent(assertionHistory(restored, first.runId))) === JSON.stringify(history));
    assert('recovery-record-gates-worktree-and-index', runCheck(restored).ok && runCheck(restored, { staged: true }).ok);
    const displayed = spawnSync(process.execPath, [cli, 'show', '--root', restored, '--run', first.runId, '--json'], { env, encoding: 'utf8', timeout: 30000 });
    assert('recovery-real-cli-reads-frozen-record', displayed.status === 0 && JSON.stringify(JSON.parse(displayed.stdout).verification) === JSON.stringify(before.verification), displayed.stderr);
    const explicit = verifyRegisteredOriginal(restored, request);
    assert('recovery-explicit-new-original-verification', explicit.exitCode === 0 && explicit.assertion.state === 'confirmed');
    const declaration = inspectRecordStore(restored);
    assert('recovery-store-does-not-import-fixture-proof', declaration.assurance.backup === 'not-verified' && declaration.assurance.recovery === 'not-verified' && !declaration.retention.deletionAuthorized);
    // A valid event chain alone cannot establish completeness of retained artifacts.
    rmSync(join(restored, frozen));
    assert('recovery-missing-frozen-result-needs-backup-manifest', runCheck(restored).ok && missingOrChanged().includes(frozen));
    put(restored, frozen, expected.get(frozen)); rmSync(join(restored, source));
    const missing = verifyRegisteredOriginal(restored, request);
    assert('recovery-missing-original-is-not-currently-verified', missing.exitCode !== 0 && missing.assertion.state === 'unverified' && missingOrChanged().includes(source));
    assert('recovery-historical-evidence-not-recomputed-for-missing-original', showRun(restored, first.runId).verification.assertion.state === 'confirmed' && expectedEvents.every(([path, bytes]) => readFileSync(join(restored, path)).equals(bytes)));
    put(restored, source, 'CHANGED_ORIGINAL_AFTER_RECOVERY');
    const changed = verifyRegisteredOriginal(restored, request);
    assert('recovery-changed-original-contradicts-only-new-observation', changed.exitCode !== 0 && changed.assertion.state === 'contradicted' && showRun(restored, first.runId).verification.assertion.state === 'confirmed');
    put(restored, source, expected.get(source));
    const terminalPath = first.events.at(-1).path, terminalBytes = expected.get(terminalPath);
    rmSync(join(restored, terminalPath)); assert('recovery-missing-committed-event-rejected', !runCheck(restored).ok);
    put(restored, terminalPath, Buffer.concat([terminalBytes, Buffer.from('\n')])); assert('recovery-altered-committed-event-rejected', !runCheck(restored).ok);
    put(restored, terminalPath, terminalBytes);
    assert('recovery-restored-events-and-artifacts-remain-exact', runCheck(restored).ok && missingOrChanged().length === 0);
    const older = git('rev-parse', `${expectedHead}^`).toString().trim();
    restoredGit('-c', 'core.hooksPath=/dev/null', 'checkout', '-q', '--detach', older);
    assert('recovery-older-valid-tree-is-not-requested-snapshot', runCheck(restored).ok && restoredGit('rev-parse', 'HEAD').toString().trim() !== expectedHead && missingOrChanged().includes(frozen));
  } finally { rmSync(work, { recursive: true, force: true }); }
}

if (isMainModule(import.meta.url)) { let passed=0;const failed=[];originalRecordFixtures({registry:JSON.parse(readFileSync(join(ROOT,'.agents/doc-types.json'),'utf8')),expectTrue:(name,ok,detail)=>ok?passed++:failed.push({name,detail})});console.log(JSON.stringify({passed,failed},null,2));if(failed.length)process.exitCode=1; }
