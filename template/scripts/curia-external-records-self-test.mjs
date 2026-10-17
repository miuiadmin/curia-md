/** No-network Git fixtures for versioned HTTPS assertion recording and historical read-only views. */
import https from 'node:https';
import { Resolver } from 'node:dns/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, realpathSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { ROOT, isMainModule } from './doc-lib.mjs';
import { recordExternalOriginalAssertion, recordOriginalAssertion, recordCodeIdentity, assertionHistory, loadRecordStore, showRun, finishRun, appendObservation, validateRecordFiles, rawDigest } from './curia-records.mjs';
import { externalAssertionSubjectKey } from './curia-external-assertion-contract.mjs';
import { runCheck } from './check-records.mjs';
export async function externalRecordFixtures({ expectTrue }) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'curia-external-records-'))), store = 'docs/records', register = 'docs/source-register.json', regPath = '.agents/doc-types.json';
  const env = { ...process.env }; delete env.CURIA_STAGED; delete env.CURIA_STAGED;
  const git = (...args) => execFileSync('git', args, { cwd: root, env, stdio: 'pipe' });
  const put = (path, data) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), data); };
  const commit = (...paths) => { git('add', '--', ...paths); git('-c', 'user.name=fixture', '-c', 'user.email=fixture@local', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'external records fixture', '--', ...paths); };
  const assert = (name, ok, detail = '') => expectTrue(`Curia external records [${name}]`, !!ok, detail);
  const reject = async (name, fn) => { let error; try { await fn(); } catch (e) { error = e; } assert(name, !!error, error?.message ?? 'not rejected'); };
  const cfg = JSON.parse(readFileSync(join(ROOT, regPath))); delete cfg.instance;
  const binding = { schema: 'curia.instance/1', owner: 'fixture', surfaces: [
    { id: 'control', kind: 'root', entry: '.agents/README.md', authorityLinks: ['AGENTS.md'], members: [{ path: '.agents', kind: 'directory', role: 'control' }] },
    { id: 'knowledge', kind: 'root', entry: 'docs/README.md', authorityLinks: ['docs/README.md'], members: [{ path: 'docs', kind: 'directory', role: 'knowledge' }] },
  ], recordStore: { schema: 'curia.record-store/1', path: store, owner: 'fixture', authorityLinks: ['docs/README.md'] } };
  const table = { schema: 'curia.original-register/1', owner: 'DO_NOT_COPY_OWNER', accessRef: 'docs/DO_NOT_COPY_ACCESS.md', originals: [{ id: 'manual', format: 'pdf', sourceRef: { uri: 'https://invalid.example/manual.pdf', locator: 'DO_NOT_COPY_LOCATOR' } }] };
  const input = { register, id: 'manual', url: table.originals[0].sourceRef.uri, allowOrigin: 'https://invalid.example', mediaType: 'application/pdf', nonSensitive: true };
  const record = (extra = {}, verification = {}) => recordExternalOriginalAssertion(root, { verification: { ...input, ...verification }, ...extra });
  const savedRequest = https.request, saved4 = Resolver.prototype.resolve4, saved6 = Resolver.prototype.resolve6; let requests = 0, dns = 0;
  https.request = () => { requests++; throw new Error('UNEXPECTED_NETWORK'); }; Resolver.prototype.resolve4 = Resolver.prototype.resolve6 = async () => { dns++; throw new Error('UNEXPECTED_DNS'); };
  try {
    for (const path of ['AGENTS.md', '.agents/README.md', 'docs/README.md']) put(path, '# Fixture\n');
    put(regPath, JSON.stringify(cfg)); put(register, JSON.stringify(table)); git('init', '-q'); git('config', 'gc.auto', '0'); commit('AGENTS.md', '.agents/README.md', 'docs/README.md', regPath, register);
    await reject('disabled-store-before-network', () => record()); assert('no-default-store', !existsSync(join(root, store)));
    cfg.instance = binding; put(regPath, JSON.stringify(cfg)); commit(regPath);
    await reject('privacy-before-record-store', () => record({}, { nonSensitive: false }));
    await reject('protected-not-downgraded', () => record({}, { protected: true }));
    await reject('excluded-not-recorded', () => record({}, { exclusions: [register] }));
    await reject('sensitive-register-not-recorded', () => record({}, { register: 'docs/.env' }));
    await reject('no-report-import', () => record({ report: {} })); await reject('no-caller-run-id', () => record({ runId: 'r-fake' }));
    const cancelled = new AbortController(); cancelled.abort(); await reject('pre-abort-no-record', () => recordExternalOriginalAssertion(root, { verification: input }, cancelled.signal));
    assert('refusals-do-not-create-store', !existsSync(join(root, store)));
    const first = await record(), bytes = new Map(first.events.map(e => [e.path, readFileSync(join(root, e.path))]));
    const begin = JSON.parse(bytes.get(first.events[0].path));
    assert('new-mode-and-event-without-expanding-old-closure', first.executionMode === 'external-verification' && first.schema === 'curia.external-assertion-run-view/1' && begin.schema === 'curia.run-event/6' && begin.payload.codeIdentity.length === 19 && recordCodeIdentity('local-verification').length === 16);
    assert('unknown-revision-records-an-honest-gap', first.status === 'incomplete' && first.exitCode === 2 && first.verification.assertion.state === 'unverified' && first.verification.capture.network === null && first.verification.assertion.evidenceRefs.length === 1 && first.verification.unresolved.includes('external-original/revision-uninterpreted'));
    assert('observation-not-body-or-owner-copy', !JSON.stringify(first).includes('DO_NOT_COPY') && first.verification.schema === 'curia.external-assertion-observation/1');
    assert('history-cannot-upgrade-unverified', assertionHistory(root, first.runId).schema === 'curia.external-assertion-history/1' && assertionHistory(root, first.runId).selectedConclusion === null);
    assert('budget-not-subject-identity', JSON.stringify(externalAssertionSubjectKey({ ...first.request, maxBytes: 1024 })) === JSON.stringify(first.subjectKey));
    await reject('correction-requires-reason', () => record({ corrects: first.runId }));
    await reject('correction-and-retry-exclusive', () => record({ corrects: first.runId, retriedFrom: first.runId, reason: 'ambiguous' }));
    await reject('different-url-not-same-subject', () => record({ corrects: first.runId, reason: 'scope' }, { url: 'https://invalid.example/other.pdf' }));
    await reject('different-id-not-same-subject', () => record({ corrects: first.runId, reason: 'scope' }, { id: 'other' }));
    await reject('output-not-an-input', () => record({}, { register: first.events[0].path, includeUntracked: true }));
    const next = await record({ corrects: first.runId, reason: 'Re-observe declared version' });
    const history = assertionHistory(root, first.runId); assert('explicit-correction-keeps-old-bytes', history.nodes.length === 2 && history.edges[0].effective && [...bytes].every(([p,b]) => readFileSync(join(root,p)).equals(b)));
    const retry = await record({ retriedFrom: next.runId }); assert('retry-does-not-retire', assertionHistory(root, retry.runId).conclusionHeads.length === 2);
    const mismatch = await record({}, { url: 'https://invalid.example/other.pdf' }); assert('url-mismatch-retains-no-response-proof', mismatch.status === 'incomplete' && mismatch.verification.capture.network === null && mismatch.verification.assertion.evidenceRefs.length === 1);
    const emptyId = await record({}, { id: 'absent' }); assert('missing-entry-persists-only-registration', emptyId.status === 'incomplete' && emptyId.verification.capture.network === null);
    put('docs/manual.pdf', 'test'); const localTable = { schema: 'curia.original-register/1', originals: [{ id: 'manual', format: 'pdf', sourceRef: { uri: 'repo:docs/manual.pdf', revision: `sha256:raw-bytes/1:${rawDigest(Buffer.from('test')).value}` } }] };
    put('docs/local.json', JSON.stringify(localTable)); commit('docs/local.json', 'docs/manual.pdf');
    const local = recordOriginalAssertion(root, { verification: { register: 'docs/local.json', id: 'manual', source: 'docs/manual.pdf', nonSensitive: true } });
    await reject('local-history-not-cross-certified', () => record({ corrects: local.runId, reason: 'wrong mode' })); assert('old-original-view-remains-v2', local.schema === 'curia.assertion-run-view/2');
    const mutations = [
      ['event-downgrade', b => { b.schema = 'curia.run-event/5'; }],
      ['run-downgrade', b => { b.payload.schema = 'curia.assertion-run/2'; }],
      ['unknown-field', b => { b.payload.verification.rawBody = 'FAKE'; }],
      ['scope-mismatch', b => { b.payload.verification.assertion.scope.url = 'https://other.example/'; }],
      ['forged-pass', b => { b.payload.verification.assertion.state = 'confirmed'; b.payload.verification.exitCode = 0; }],
      ['missing-evidence', b => { b.payload.verification.assertion.evidenceRefs = []; }],
      ['malformed-register-pointer', b => { b.payload.verification.assertion.sourceRefs[0].locator.pointer = '/originals/999'; }],
      ['identity-upgrade', b => { b.payload.verification.verifier.authentication = 'authenticated'; }],
      ['missing-code', b => { b.payload.codeIdentity.pop(); }],
      ['source-body-field', b => { b.payload.verification.capture.body = 'PRIVATE'; }],
    ];
    for (const [name, change] of mutations) await reject(name, () => { const b = structuredClone(begin); change(b); validateRecordFiles(new Map([[first.events[0].path, Buffer.from(JSON.stringify(b))]]), store); });
    const open = await record(), observation = JSON.stringify(open.verification); rmSync(join(root, open.events[1].path)); rmSync(join(root, register));
    const view = showRun(root, open.runId); await reject('manual-observation-cannot-upgrade-external', () => appendObservation(root, open.runId, view.expectedHead, {}));
    const sealed = finishRun(root, open.runId, view.expectedHead); assert('finish-does-not-refetch-or-read-registration', sealed.status === 'incomplete' && JSON.stringify(sealed.verification) === observation); put(register, JSON.stringify(table));
    const indexBefore = git('ls-files', '-s', '-z'); showRun(root, first.runId); assertionHistory(root, first.runId); assert('historical-read-does-not-write-index', git('ls-files', '-s', '-z').equals(indexBefore));
    const cli = fileURLToPath(new URL('./curia-records.mjs', import.meta.url));
    const result = spawnSync(process.execPath, [cli, 'verify-external-original', '--register', register, '--id', 'manual', '--url', input.url, '--allow-origin', input.allowOrigin, '--media-type', input.mediaType, '--non-sensitive', '--root', root, '--json'], { env, encoding: 'utf8', timeout: 30000 });
    assert('real-cli-unknown-no-network', result.status === 2 && JSON.parse(result.stdout).verification.capture.network === null, result.stderr);
    const paths = [...loadRecordStore(root).files.keys()]; commit(register, ...paths); assert('staged-and-worktree-new-mode-valid', runCheck(root).ok && runCheck(root, { staged: true }).ok);
    const poisoned = structuredClone(begin); poisoned.payload.verification.assertion.state = 'confirmed'; put(first.events[0].path, JSON.stringify(poisoned)); git('add', '--', first.events[0].path); put(first.events[0].path, bytes.get(first.events[0].path));
    assert('good-working-tree-cannot-mask-poisoned-index', !runCheck(root, { staged: true }).ok); git('add', '--', first.events[0].path);
    assert('all-local-record-cases-have-zero-network', requests === 0 && dns === 0, JSON.stringify({ requests, dns }));
  } finally { https.request = savedRequest; Resolver.prototype.resolve4 = saved4; Resolver.prototype.resolve6 = saved6; rmSync(root, { recursive: true, force: true }); }
}
if (isMainModule(import.meta.url)) { let passed = 0; const failed = []; await externalRecordFixtures({ expectTrue: (name, ok, detail) => ok ? passed++ : failed.push({ name, detail }) }); console.log(JSON.stringify({ passed, failed }, null, 2)); if (failed.length) process.exitCode = 1; }
