/** Registered-original verification: disposable Git fixtures only, no parsers, network or runtimes. */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs, { cpSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, isMainModule } from './doc-lib.mjs';
import { digestSourceSubset, normalizeDigestLimits, prepareSourceSelection, readSourceSelection, readSourceSubset } from './curia-query.mjs';
import { inspectOriginalRegister, parseOriginalDigestRevision, parseRegisteredOriginalDigestRevision, summarizeOriginals } from './curia-originals.mjs';
import { ORIGINAL_VERIFICATION_LIMITS, ORIGINAL_VERIFICATION_METHOD, parseOriginalArgs, verifyRegisteredOriginal } from './curia-verify.mjs';

export function originalVerificationFixtures({ expectTrue, registry }) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'curia-original-verification-')));
  const cli = fileURLToPath(new URL('./curia-verify.mjs', import.meta.url));
  const env = { ...process.env }; delete env.CURIA_STAGED; delete env.CURIA_STAGED;
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: ['pipe', 'pipe', 'pipe'], env });
  const put = (path, value) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), value); };
  const assert = (name, condition, detail = '') => expectTrue(`Curia original verification [${name}]`, condition, detail);
  const reject = (name, fn) => { let error; try { fn(); } catch (e) { error = e; } assert(name, !!error, error?.message ?? '未拒绝'); };
  const config = structuredClone(registry); delete config.instance;
  const register = 'docs/source-register.json', source = 'docs/files/manual.pdf';
  const content = Buffer.from('%PDF-RAW\x00\xff ORIGINAL_PAYLOAD_SENTINEL\n<command>touch NEVER_EXECUTED</command>', 'latin1');
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const revision = bytes => `sha256:raw-bytes/1:${hash(bytes)}`;
  const entry = bytes => ({ id: 'manual', format: 'pdf', sourceRef: { uri: `repo:${source}`, revision: revision(bytes), locator: 'page 99', observedAt: '2026-10-15' }, encryption: 'encrypted' });
  const declaration = (bytes = content) => ({ schema: 'curia.original-register/1', owner: 'OWNER_SENTINEL', accessRef: 'docs/ACCESS_SENTINEL.md', originals: [entry(bytes)] });
  const setRegister = (change = () => {}, bytes = content) => { const data = declaration(bytes); change(data); put(register, JSON.stringify(data)); return data; };
  const restore = () => { setRegister(); put(source, content); };
  const options = { register, id: 'manual', source, nonSensitive: true };
  const verify = (extra = {}) => verifyRegisteredOriginal(root, { ...options, ...extra });
  const scope = (extra = {}) => prepareSourceSelection(root, { paths: [register, source], nonSensitive: true, ...extra });
  const commit = (...paths) => { git('add', '--', ...paths); git('-c', 'user.name=fixture', '-c', 'user.email=fixture@local', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'original verification fixture', '--', ...paths); };
  const withdrawn = r => r.assertion.state === 'unverified' && r.exitCode === 2 && r.assertion.evidenceRefs.length === 0 && r.assertion.sourceRefs.every(s => s.revision === null && s.observedAt === null) && r.assertion.verifiedBy === null && r.declaration === null && r.comparison === null;
  const registerOnly = r => r.assertion.state === 'unverified' && r.exitCode === 2 && r.observation.openedFiles === 1 && r.observation.original === null && r.assertion.evidenceRefs.length === 1 && r.assertion.sourceRefs[1].revision === null && r.assertion.verifiedBy === null;
  const decodeMutation = fn => {
    const Native = globalThis.TextDecoder; let changed = false;
    globalThis.TextDecoder = class extends Native { decode(bytes, ...rest) { const text = super.decode(bytes, ...rest); if (!changed && text.includes('OWNER_SENTINEL')) { changed = true; fn(); } return text; } };
    try { const report = verify(); assert('decode-mutation-hook-exercised', changed); return report; }
    finally { globalThis.TextDecoder = Native; }
  };
  const duringHash = fn => {
    const nativeRead = fs.readSync; let changed = false;
    fs.readSync = (...args) => { const n = nativeRead(...args); if (!changed && args[1].length === 64 * 1024) { changed = true; fn(); } return n; };
    syncBuiltinESMExports();
    try { const report = verify(); assert('stream-mutation-hook-exercised', changed); return report; }
    finally { fs.readSync = nativeRead; syncBuiltinESMExports(); }
  };
  try {
    put('AGENTS.md', '# Rules\n'); put('.agents/README.md', '# Control\n'); put('docs/README.md', '# Knowledge\n');
    put('.agents/doc-types.json', JSON.stringify(config)); put('.gitignore', 'ignored.pdf\n'); restore();
    git('init', '-q'); commit('AGENTS.md', '.agents/README.md', 'docs/README.md', '.agents/doc-types.json', '.gitignore', register, source);
    const indexBefore = git('ls-files', '-s', '-z').toString();
    const result = verify();
    assert('confirmed-real-original', result.assertion.state === 'confirmed' && result.exitCode === 0 && result.comparison.observed.value === hash(content));
    assert('both-sources-observed', result.assertion.sourceRefs.every(s => s.revision?.algorithm === 'sha256' && s.revision.canonicalization === 'raw-bytes/1' && /Z$/.test(s.observedAt)) && result.assertion.sourceRefs[0].locator.pointer === '/originals/0' && result.assertion.sourceRefs[1].locator.kind === 'whole-file/1');
    assert('different-evidence-kinds', result.assertion.evidenceRefs[0].verification === 'actual-complete-source-bytes' && result.assertion.evidenceRefs[1].verification === 'actual-complete-source-digest');
    assert('one-capability-two-phases', result.observation.openedFiles === 2 && result.observation.register.openedFiles === 1 && result.observation.original.openedFiles === 1 && result.observation.chargedBytes === readFileSync(join(root, register)).length + content.length && result.observation.original.documents[0].state === 'hashed');
    assert('identity-not-authentication', result.assertion.verifiedBy.action === ORIGINAL_VERIFICATION_METHOD && result.verifier.authentication === 'local-self-reported-not-authenticated' && result.assertion.scope.requestedAssurance === 'local-unprotected');
    assert('encrypted-not-decrypted-or-understood', result.declaration.declaredEncryption === 'encrypted' && result.declaration.formatVerification === 'not-performed' && result.declaration.extraction === 'not-invoked' && result.declaration.decryption === 'not-invoked' && result.declaration.locatorVerification === 'not-performed');
    assert('no-body-owner-access-or-command-output', !['ORIGINAL_PAYLOAD_SENTINEL', 'OWNER_SENTINEL', 'ACCESS_SENTINEL', 'NEVER_EXECUTED', 'page 99'].some(value => JSON.stringify(result).includes(value)) && !existsSync(join(root, 'NEVER_EXECUTED')));
    assert('no-registry-index-or-run-write', git('ls-files', '-s', '-z').toString() === indexBefore && !existsSync(join(root, 'docs/records')) && readFileSync(join(root, '.agents/doc-types.json'), 'utf8') === JSON.stringify(config));
    put(source, Buffer.concat([content, Buffer.from('new revision')])); const changed = verify();
    assert('contradiction-not-unknown', changed.assertion.state === 'contradicted' && changed.exitCode === 1 && changed.assertion.evidenceRefs.length === 2 && changed.comparison.expected.value === hash(content) && changed.comparison.observed.value !== hash(content));
    assert('dirty-not-head-revision', changed.observation.original.source.worktreeState === 'not-attributed-to-head' && changed.observation.original.documents[0].git.index.oid === changed.observation.original.documents[0].git.head.oid);
    restore();
    for (const [format, bytes] of [['pdf', content], ['docx', Buffer.from('PK\x03\x04MACRO_SENTINEL')], ['png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff])], ['unknown-format', Buffer.alloc(0)]]) {
      put(source, bytes); setRegister(d => { d.originals[0].format = format; }, bytes);
      const r = verify(); assert(`raw-only-${format}`, r.assertion.state === 'confirmed' && r.observation.original.chargedBytes === bytes.length && r.declaration.formatVerification === 'not-performed' && !JSON.stringify(r).includes('MACRO_SENTINEL'));
    }
    const large = Buffer.alloc(4 * 1024 * 1024 + 19, 0x97); put(source, large); setRegister(() => {}, large);
    const largeResult = verify({ maxSourceBytes: large.length });
    assert('stream-over-text-cap-at-exact-budget', largeResult.assertion.state === 'confirmed' && largeResult.observation.original.chargedBytes === large.length && largeResult.comparison.observed.value === hash(large));
    const low = verify({ maxSourceBytes: large.length - 1 });
    assert('budget-no-prefix-evidence', withdrawn(low) && low.observation.original.openedFiles === 0 && low.observation.original.chargedBytes === 0 && low.unresolved.includes('byte-or-file-limit'));
    restore(); const registerBytes = readFileSync(join(root, register)); put(register, Buffer.concat([registerBytes, Buffer.alloc(ORIGINAL_VERIFICATION_LIMITS.registerBytes - registerBytes.length, 0x20)]));
    assert('register-exact-budget', verify().assertion.state === 'confirmed'); put(register, Buffer.alloc(ORIGINAL_VERIFICATION_LIMITS.registerBytes + 1, 0x20));
    const overRegister = verify(); assert('oversize-register-before-any-source', withdrawn(overRegister) && overRegister.observation.openedFiles === 0); restore();
    for (const [name, value] of [
      ['version', 'v1'], ['date', '2026-10-15'], ['git-sha', 'a'.repeat(40)], ['sha512-wrong-length', `sha512:raw-bytes/1:${hash(content)}`], ['canonicalization', `sha256:json-canonical/1:${hash(content)}`], ['case', revision(content).toUpperCase()], ['short', 'sha256:raw-bytes/1:' + '0'.repeat(63)], ['long', 'sha256:raw-bytes/1:' + '0'.repeat(65)], ['null', null], ['missing', undefined],
    ]) {
      setRegister(d => { d.originals[0].sourceRef.revision = value; }); const r = verify();
      assert(`revision-${name}-never-hashes`, registerOnly(r) && r.unresolved.includes('original/revision-uninterpreted') && parseOriginalDigestRevision(value) === null);
    }
    assert('strict-revision-parser', parseOriginalDigestRevision(revision(content)).value === hash(content) && parseOriginalDigestRevision(` ${revision(content)}`) === null && parseOriginalDigestRevision(revision(content) + '\n') === null);
    const nativeDeclarations = ['sha256', 'sha512'].flatMap(algorithm => {
      const bytes = createHash(algorithm).update(content).digest();
      return [[`${algorithm}-hex`, algorithm, `${algorithm}:raw-bytes/1:${bytes.toString('hex')}`], [`${algorithm}-sri`, algorithm, `${algorithm}-${bytes.toString('base64')}`]];
    });
    for (const [name, algorithm, revision] of nativeDeclarations) {
      restore(); setRegister(d => { d.originals[0].sourceRef.revision = revision; });
      const registered = readFileSync(join(root, register)), r = verify(), expected = createHash(algorithm).update(content).digest('hex');
      assert(`native-${name}-confirms-whole-bytes`, r.exitCode === 0 && r.comparison.expected.algorithm === algorithm && r.comparison.observed.algorithm === algorithm && r.comparison.observed.value === expected && r.observation.original.chargedBytes === content.length);
      assert(`native-${name}-no-backfill-or-body`, readFileSync(join(root, register)).equals(registered) && r.assertion.sourceRefs[0].revision.algorithm === 'sha256' && !JSON.stringify(r).includes('ORIGINAL_PAYLOAD_SENTINEL'));
      assert(`native-${name}-parser-scope`, parseRegisteredOriginalDigestRevision(revision).value === expected && (name === 'sha256-hex' ? parseOriginalDigestRevision(revision)?.value === expected : parseOriginalDigestRevision(revision) === null));
      put(source, Buffer.concat([content, Buffer.from('changed')])); const bad = verify();
      assert(`native-${name}-contradiction`, bad.exitCode === 1 && bad.comparison.observed.algorithm === algorithm && bad.comparison.observed.value !== expected);
    }
    restore();
    for (const [name, value] of [
      ['multiple', nativeDeclarations[1][2] + ' ' + nativeDeclarations[3][2]], ['options', nativeDeclarations[3][2] + '?foo'],
      ['leading-space', ' ' + nativeDeclarations[3][2]], ['newline', nativeDeclarations[3][2] + '\n'], ['unpadded', nativeDeclarations[3][2].replace(/=+$/, '')],
      ['url-safe', 'sha512-' + Buffer.alloc(64, 255).toString('base64').replaceAll('/', '_')], ['sha384', 'sha384-' + Buffer.alloc(48).toString('base64')],
      ['padding-bits-256', 'sha256-' + 'A'.repeat(42) + 'B='], ['padding-bits-512', 'sha512-' + 'A'.repeat(85) + 'B=='],
      ['wrong-length', 'sha512-' + Buffer.alloc(32).toString('base64')], ['wrong-case', nativeDeclarations[3][2].replace('sha512', 'SHA512')],
    ]) {
      setRegister(d => { d.originals[0].sourceRef.revision = value; }); const r = verify();
      assert(`native-invalid-${name}-no-original-read`, parseRegisteredOriginalDigestRevision(value) === null && registerOnly(r) && r.unresolved.includes(['leading-space', 'newline'].includes(name) ? 'originals/schema-invalid' : 'original/revision-uninterpreted'));
    }
    restore(); const algorithmScope = scope();
    assert('digest-api-default-remains-sha256', digestSourceSubset(algorithmScope, [source]).documents[0].digest.algorithm === 'sha256');
    const sha512Observation = digestSourceSubset(algorithmScope, [source], { algorithm: 'sha512' });
    assert('digest-api-explicit-sha512-no-body', sha512Observation.documents[0].bytes === null && sha512Observation.documents[0].digest.value === createHash('sha512').update(content).digest('hex'));
    reject('sha512-serialized-capability-not-authority', () => digestSourceSubset(JSON.parse(JSON.stringify(algorithmScope)), [source], { algorithm: 'sha512' }));
    const nativeOpen = fs.openSync; let invalidAlgorithmOpens = 0;
    fs.openSync = (...args) => { invalidAlgorithmOpens++; return nativeOpen(...args); }; syncBuiltinESMExports();
    try { for (const algorithm of ['sha1', 'sha384', 'SHA512', 'constructor', null, undefined]) {
      let error; try { digestSourceSubset(algorithmScope, [source], { algorithm }); } catch (e) { error = e; }
      assert(`invalid-algorithm-before-open-${String(algorithm)}`, error?.message.includes('curia2/digest-algorithm-invalid') && invalidAlgorithmOpens === 0);
    } } finally { fs.openSync = nativeOpen; syncBuiltinESMExports(); }
    put(source, large); setRegister(d => { d.originals[0].sourceRef.revision = 'sha512-' + createHash('sha512').update(large).digest('base64'); });
    const large512 = verify({ maxSourceBytes: large.length });
    assert('sha512-complete-stream-exact-budget', large512.exitCode === 0 && large512.observation.original.chargedBytes === large.length && large512.comparison.observed.value === createHash('sha512').update(large).digest('hex'));
    assert('sha512-no-prefix-proof-on-budget-failure', withdrawn(verify({ maxSourceBytes: large.length - 1 }))); restore();
    setRegister(d => { d.originals[0].sourceRef.revision = nativeDeclarations[3][2]; });
    assert('sha512-drift-withdraws-all-evidence', withdrawn(duringHash(() => put(source, Buffer.concat([content, Buffer.from('drift')]))))); restore();
    for (const [name, uri] of [['local-mismatch', 'repo:docs/UNSELECTED_SENTINEL.pdf'], ['https', 'https://invalid.example/UNSELECTED_SENTINEL.pdf'], ['paper', 'paper:UNSELECTED_SENTINEL']]) {
      setRegister(d => { d.originals[0].sourceRef.uri = uri; }); const r = verify();
      assert(`source-${name}-not-opened-or-disclosed`, registerOnly(r) && !JSON.stringify(r).includes('UNSELECTED_SENTINEL'));
    }
    restore(); assert('unknown-id-register-only', registerOnly(verify({ id: 'absent' })));
    const second = setRegister(d => { d.originals.unshift({ ...entry(content), id: 'other', sourceRef: { uri: 'paper:other' } }); });
    assert('actual-entry-locator', verify().assertion.sourceRefs[0].locator.pointer === '/originals/1');
    const parsed = inspectOriginalRegister({ text: JSON.stringify(second), encodingState: 'valid', truncated: false }, register);
    assert('register-parser-still-not-read', parsed.originals.every(o => o.state === 'registered-not-read' && o.digest === null));
    const summary = summarizeOriginals([{ content: { parser: 'json-original-register/1', ...parsed } }]);
    assert('coverage-does-not-auto-promote', summary.read === 0 && summary.verified === 0 && !summary.complete);
    for (const [name, invalid] of [
      ['syntax', '{"SOURCE_SECRET_SENTINEL":'], ['duplicate-key', JSON.stringify(declaration()).replace('"schema":', '"schema":"duplicate","schema":')],
      ['encoding', Buffer.from([0x7b, 0xff, 0x7d])], ['bom', '\ufeff' + JSON.stringify(declaration())], ['schema', JSON.stringify({ ...declaration(), schema: 'unknown' })],
      ['duplicate-id', JSON.stringify({ ...declaration(), originals: [entry(content), entry(content)] })], ['ownership', JSON.stringify({ ...declaration(), owner: undefined })],
      ['credential-uri', JSON.stringify({ ...declaration(), originals: [{ ...entry(content), sourceRef: { uri: 'https://user:SOURCE_SECRET_SENTINEL@invalid.example/file' } }] })],
      ['id-linebreak', JSON.stringify({ ...declaration(), originals: [{ ...entry(content), id: 'manual\n' }] })], ['format-linebreak', JSON.stringify({ ...declaration(), originals: [{ ...entry(content), format: 'pdf\n' }] })],
      ['unknown-command-field', JSON.stringify({ ...declaration(), command: 'touch SOURCE_SECRET_SENTINEL' })],
    ]) {
      put(register, invalid); const r = verify(); assert(`invalid-${name}-no-original-read`, registerOnly(r) && !JSON.stringify(r).includes('SOURCE_SECRET_SENTINEL'));
    }
    restore();
    for (const [name, extra] of [['privacy', { nonSensitive: false }], ['protected', { protected: true }]]) {
      const r = verifyRegisteredOriginal(join(root, 'not-a-repository'), { ...options, ...extra });
      assert(`${name}-before-root-or-code-io`, withdrawn(r) && r.verifier === null && r.observation === null);
    }
    const blocked = verify({ exclusions: [source] }); assert('excluded-peer-blocks-register', withdrawn(blocked) && blocked.observation.openedFiles === 0);
    for (const path of ['docs/private/source.pdf', 'docs/a.key', 'docs/ignored.pdf', 'docs/raw/source.pdf', 'docs/loose.pdf', 'docs/hard.pdf', 'docs/link.pdf', 'docs/nested/source.pdf']) {
      put(path, content);
    }
    put('docs/raw/.agents-raw', ''); git('add', '--', 'docs/raw/.agents-raw', 'docs/private/source.pdf', 'docs/a.key', 'docs/raw/source.pdf');
    git('add', '-f', '--', 'docs/ignored.pdf');
    rmSync(join(root, 'docs/hard.pdf')); linkSync(join(root, source), join(root, 'docs/hard.pdf')); git('add', '--', 'docs/hard.pdf');
    const hard = verify({ source: 'docs/hard.pdf' }); assert('hardlink-blocks-before-read', withdrawn(hard) && hard.observation.openedFiles === 0); rmSync(join(root, 'docs/hard.pdf')); git('reset', '-q', 'HEAD', '--', 'docs/hard.pdf');
    rmSync(join(root, 'docs/link.pdf')); symlinkSync('files/manual.pdf', join(root, 'docs/link.pdf')); git('add', '--', 'docs/link.pdf');
    git('add', '--', 'docs/nested/source.pdf'); put('docs/nested/.git/HEAD', 'ref: refs/heads/main\n');
    for (const [name, path] of [['private', 'docs/private/source.pdf'], ['key', 'docs/a.key'], ['ignored-tracked', 'docs/ignored.pdf'], ['raw', 'docs/raw/source.pdf'], ['untracked', 'docs/loose.pdf'], ['symlink', 'docs/link.pdf'], ['nested-repo', 'docs/nested/source.pdf'], ['missing', 'docs/missing.pdf']]) {
      setRegister(d => { d.originals[0].sourceRef.uri = `repo:${path}`; }); const r = verify({ source: path });
      assert(`${name}-blocks-both-before-read`, withdrawn(r) && r.observation.openedFiles === 0);
    }
    setRegister(d => { d.originals[0].sourceRef.uri = 'repo:docs/loose.pdf'; });
    assert('explicit-untracked-opt-in', verify({ source: 'docs/loose.pdf', includeUntracked: true }).assertion.state === 'confirmed');
    setRegister(d => { d.originals[0].sourceRef.uri = 'repo:docs/ignored.pdf'; });
    assert('all-does-not-unignore', withdrawn(verify({ source: 'docs/ignored.pdf', includeUntracked: true })));
    restore();
    const cap = scope(); const first = readSourceSubset(cap, [register]); const secondPhase = digestSourceSubset(cap, [source]);
    assert('subset-reports-actual-and-authorized', first.selection.paths.length === 1 && first.selection.authorizationPaths.length === 2 && secondPhase.selection.paths[0] === source && secondPhase.documents[0].bytes === null && secondPhase.documents[0].state === 'hashed');
    reject('serialized-capability-not-authority', () => digestSourceSubset(JSON.parse(JSON.stringify(cap)), [source]));
    reject('serialized-byte-capability-not-authority', () => readSourceSubset(JSON.parse(JSON.stringify(cap)), [register]));
    reject('subset-cannot-widen', () => digestSourceSubset(cap, ['docs/loose.pdf']));
    reject('subset-cannot-expand-directory', () => readSourceSubset(cap, ['docs']));
    reject('subset-empty-invalid', () => digestSourceSubset(cap, []));
    cap.objects = [{ path: 'docs/loose.pdf' }]; cap.selection.paths = ['docs/loose.pdf']; cap.source = null;
    assert('public-capability-cannot-mutate-authority', digestSourceSubset(cap, [source]).documents[0].digest.value === hash(content));
    reject('mutated-public-report-no-new-authority', () => digestSourceSubset(cap, ['docs/loose.pdf']));
    assert('blocked-peer-subset-no-bypass', readSourceSubset(scope({ exclusions: [source] }), [register]).openedFiles === 0);
    const c1 = scope(); put(register, readFileSync(join(root, register), 'utf8') + ' ');
    assert('subset-rechecks-other-peer', digestSourceSubset(c1, [source]).documents[0].reason === 'snapshot-changed'); restore();
    const c2 = scope(); put(source, Buffer.concat([content, Buffer.from('x')]));
    assert('subset-byte-read-rechecks-original-peer', readSourceSubset(c2, [register]).documents[0].reason === 'snapshot-changed'); restore();
    for (const [name, mutate, reset] of [
      ['register', () => put(register, readFileSync(join(root, register), 'utf8') + ' '), restore],
      ['original', () => put(source, Buffer.concat([content, Buffer.from('x')])), restore],
      ['registry', () => put('.agents/doc-types.json', JSON.stringify(config) + ' '), () => put('.agents/doc-types.json', JSON.stringify(config))],
      ['index', () => { put('docs/new-index.md', 'x'); git('add', '--', 'docs/new-index.md'); }, () => { git('reset', '-q', 'HEAD', '--', 'docs/new-index.md'); rmSync(join(root, 'docs/new-index.md')); }],
      ['raw-marker', () => put('docs/files/.agents-raw', ''), () => rmSync(join(root, 'docs/files/.agents-raw'))],
      ['ignore', () => put('.gitignore', 'ignored.pdf\n' + source + '\n'), () => put('.gitignore', 'ignored.pdf\n')],
    ]) {
      const r = decodeMutation(mutate);
      assert(`between-phases-${name}-withdraws-all`, withdrawn(r) && !r.observation.stable && r.observation.original.openedFiles === 0);
      reset(); restore();
    }
    const duringOriginal = duringHash(() => put(source, Buffer.concat([content, Buffer.from('changed')])));
    assert('during-hash-source-change-withdraws-all', withdrawn(duringOriginal) && !duringOriginal.observation.stable); restore();
    const duringRegister = duringHash(() => put(register, readFileSync(join(root, register), 'utf8') + ' '));
    assert('during-hash-register-change-withdraws-all', withdrawn(duringRegister) && !duringRegister.observation.stable); restore();
    // An empty trailing source is still a complete zero-byte observation after an exact budget.
    put('docs/zz-empty.bin', ''); git('add', '--', 'docs/zz-empty.bin'); const both = prepareSourceSelection(root, { paths: [source, 'docs/zz-empty.bin'], nonSensitive: true });
    const empty = digestSourceSubset(both, [source, 'docs/zz-empty.bin'], { maxTotalBytes: content.length, maxFileBytes: content.length });
    assert('zero-byte-peer-at-exact-total-budget', empty.stable && empty.documents.every(d => d.state === 'hashed') && empty.chargedBytes === content.length && empty.openedFiles === 2);
    const emptyBytes = readSourceSelection(both, { maxTotalBytes: content.length, maxFileBytes: content.length });
    assert('zero-byte-read-peer-at-exact-total-budget', emptyBytes.stable && emptyBytes.documents.every(d => d.state === 'read') && emptyBytes.openedFiles === 2);
    assert('legacy-full-byte-api-preserved', readSourceSelection(scope()).documents.every(d => d.state === 'read' && Buffer.isBuffer(d.bytes)));
    for (const value of [null, 0, -1, 1.1, NaN, Infinity, '1', 512 * 1024 * 1024 + 1]) reject(`invalid-source-budget-${String(value)}`, () => verify({ maxSourceBytes: value }));
    reject('unknown-digest-budget', () => normalizeDigestLimits({ unbounded: true }));
    for (const extra of [{ source: '../outside' }, { source: 'docs/%2f.pdf' }, { id: 'x/y' }, { id: 'manual\n' }, { id: '' }, { protected: 'yes' }, { nonSensitive: 1 }, { unexpected: true }]) reject('strict-input-' + JSON.stringify(extra), () => verify(extra));
    const args = ['--root', root, '--register', register, '--id', 'manual', '--source', source, '--non-sensitive', '--json'];
    const call = extra => spawnSync(process.execPath, [cli, 'original', ...args, ...(extra ?? [])], { cwd: root, env, encoding: 'utf8' });
    setRegister(d => { d.originals[0].sourceRef.revision = nativeDeclarations[3][2]; }); const nativeCLI = call();
    assert('cli-native-sha512-sri', nativeCLI.status === 0 && JSON.parse(nativeCLI.stdout).comparison.observed.algorithm === 'sha512', nativeCLI.stderr); restore();
    const good = call(); assert('cli-confirmed-zero', good.status === 0 && JSON.parse(good.stdout).assertion.state === 'confirmed', good.stderr);
    put(source, content.subarray(1)); const bad = call(); assert('cli-contradicted-one', bad.status === 1 && JSON.parse(bad.stdout).assertion.state === 'contradicted'); restore();
    setRegister(d => { d.originals[0].sourceRef.revision = 'opaque-v1'; }); const unknown = call(); assert('cli-unverified-two', unknown.status === 2 && JSON.parse(unknown.stdout).assertion.state === 'unverified'); restore();
    for (const extra of [['--algorithm', 'sha512'], ['--source', source], ['--surprise'], ['--max-source-bytes', '1e3'], ['--max-source-bytes', '1\n'], ['--max-source-bytes', '0'], ['--max-source-bytes', '9007199254740993'], ['--help'], ['--register'], ['--non-sensitive']]) reject('cli-parser-' + extra.join('-'), () => parseOriginalArgs([...args, ...extra]));
    assert('cli-invalid-two', call(['--max-source-bytes', '0']).status === 2);
    const help = spawnSync(process.execPath, [cli, 'original', '--help'], { cwd: root, env, encoding: 'utf8' });
    assert('cli-help-and-discovery', help.status === 0 && help.stdout.includes('sha256:raw-bytes/1') && JSON.parse(spawnSync(process.execPath, [cli, '--list-methods', '--json'], { cwd: root, env, encoding: 'utf8' }).stdout).original.method === ORIGINAL_VERIFICATION_METHOD);
    // Mutate only the fixture's copied implementation, never the shared workspace.
    cpSync(dirname(cli), join(root, 'copied-scripts'), { recursive: true });
    const script = `import {writeFileSync,readFileSync} from 'node:fs';import {verifyRegisteredOriginal} from './copied-scripts/curia-verify.mjs';const Native=globalThis.TextDecoder;let changed=false;globalThis.TextDecoder=class extends Native{decode(...args){const text=super.decode(...args);if(!changed&&text.includes('OWNER_SENTINEL')){changed=true;const path='./copied-scripts/curia-verify.mjs';writeFileSync(path,readFileSync(path,'utf8')+'\\n// fixture drift\\n');}return text;}};console.log(JSON.stringify(verifyRegisteredOriginal(${JSON.stringify(root)},${JSON.stringify(options)})));`;
    const codeDrift = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: root, env, encoding: 'utf8' });
    const driftResult = codeDrift.status === 0 ? JSON.parse(codeDrift.stdout) : null;
    assert('verifier-drift-withdraws-all-evidence', driftResult && withdrawn(driftResult) && driftResult.unresolved.includes('verifier-identity-changed'), codeDrift.stderr);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

if (isMainModule(import.meta.url)) {
  let passed = 0; const failures = [];
  originalVerificationFixtures({ registry: JSON.parse(readFileSync(join(ROOT, '.agents/doc-types.json'), 'utf8')), expectTrue: (name, condition, detail = '') => condition ? passed++ : failures.push(`${name}: ${detail}`) });
  console.log(JSON.stringify({ passed, failed: failures.length, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
}
