/** Stateless verifier fixtures: only disposable files and Git, no business runtime. */
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { ROOT, isMainModule } from './doc-lib.mjs';
import { compareJsonPointers } from './curia-json.mjs';
import { prepareSourceSelection, readSourceSelection } from './curia-query.mjs';
import { parseVerifyArgs, verifySources, VERIFIER_FILES, VERIFICATION_LIMITS } from './curia-verify.mjs';

export function verificationFixtures({ expectTrue, registry }) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'curia-verification-')));
  const cli = fileURLToPath(new URL('./curia-verify.mjs', import.meta.url));
  const env = { ...process.env }; delete env.CURIA_STAGED; delete env.CURIA_STAGED;
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: ['pipe', 'pipe', 'pipe'], env });
  const put = (path, value) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), value); };
  const assert = (name, condition, details = '') => expectTrue(`Curia verification [${name}]`, condition, details);
  const reject = (name, fn) => { let error; try { fn(); } catch (e) { error = e; } assert(name, !!error, error?.message ?? '未拒绝'); };
  const config = structuredClone(registry); delete config.instance;
  const left = 'packages/contracts/openapi.json', right = 'docs/api.json';
  const data = '{"info":{"version":"1"},"value":9007199254740993,"$ref":"https://invalid.example/not-an-authorization","command":"touch NEVER_EXECUTED"}';
  const options = { method: 'json-value-equal/1', left: { path: left, pointer: '/info/version' }, right: { path: right, pointer: '/info/version' }, nonSensitive: true };
  const verify = (extra = {}) => verifySources(root, { ...options, ...extra });
  const scope = (extra = {}) => prepareSourceSelection(root, { paths: [left, right], nonSensitive: true, ...extra });
  const commit = (...paths) => { git('add', '--', ...paths); git('-c', 'user.name=fixture', '-c', 'user.email=fixture@local', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'verification fixture', '--', ...paths); };
  const raw = (a = left, b = right) => ({ method: 'raw-bytes-equal/1', left: { path: a }, right: { path: b }, nonSensitive: true });
  try {
    put('AGENTS.md', '# Rules\n'); put('.agents/README.md', '# Control\n'); put('docs/README.md', '# Knowledge\n');
    put('.agents/doc-types.json', JSON.stringify(config)); put(left, data); put(right, data); put('.gitignore', 'ignored.json\n');
    git('init', '-q'); commit('AGENTS.md', '.agents/README.md', '.agents/doc-types.json', 'docs/README.md', '.gitignore', left, right);
    const indexBefore = git('ls-files', '-s', '-z').toString();
    const same = verify();
    assert('actual-json-equality', same.assertion.state === 'confirmed' && same.exitCode === 0 && same.assertion.verifiedBy.action === options.method && same.observation.openedFiles === 2);
    assert('no-surface-expansion', !config.instance && same.observation.source.mode === 'current-worktree' && same.assertion.sourceRefs[0].uri === `repo:${left}`);
    assert('complete-digest-identity', same.assertion.sourceRefs.every((s) => s.revision.algorithm === 'sha256' && s.revision.canonicalization === 'raw-bytes/1' && /^[a-f0-9]{64}$/.test(s.revision.value) && /Z$/.test(s.observedAt)) && same.assertion.evidenceRefs.length === 2);
    assert('non-atomic-real-clock', same.observation.source.consistency === 'non-atomic-with-postcheck' && same.evaluatedAt.endsWith('Z') && same.assertion.limits.includes('host-clock-not-certified'));
    assert('identity-not-approval', same.verifier.authentication === 'local-self-reported-not-authenticated' && JSON.stringify(same.verifier.implementation.map(({ file }) => file)) === JSON.stringify(VERIFIER_FILES));
    assert('no-source-values-or-commands', !JSON.stringify(same).includes('NEVER_EXECUTED') && !JSON.stringify(same).includes('9007199254740993') && !existsSync(join(root, 'NEVER_EXECUTED')));
    assert('no-index-or-record-write', git('ls-files', '-s', '-z').toString() === indexBefore && !existsSync(join(root, 'docs/records')));
    put(right, data.replace('"version":"1"', '"version":"2"'));
    const different = verify();
    assert('contradiction-retains-both-sources', different.assertion.state === 'contradicted' && different.exitCode === 1 && different.assertion.evidenceRefs.length === 2 && different.assertion.sourceRefs[0].revision.value !== different.assertion.sourceRefs[1].revision.value);
    assert('dirty-not-attributed-to-head', different.observation.source.worktreeState === 'not-attributed-to-head' && different.observation.documents.every((d) => d.git.head.oid === d.git.index.oid));
    put(right, data);
    const missed = verify({ left: { path: left, pointer: '/missing' }, right: { path: right, pointer: '/missing' } });
    assert('both-missing-not-pass-or-na', missed.assertion.state === 'unverified' && missed.exitCode === 2 && missed.comparison.state === 'missing' && missed.assertion.verifiedBy === null);
    const repeated = verify({ right: { path: left, pointer: '/info/version' } });
    assert('same-source-read-once', repeated.assertion.state === 'confirmed' && repeated.observation.openedFiles === 1);
    put('.agents/doc-types.json', JSON.stringify(config) + ' '.repeat(1024 * 1024));
    const hugeRegistry = verify();
    assert('oversize-registry-before-source-read', hugeRegistry.assertion.state === 'unverified' && hugeRegistry.observation === null && hugeRegistry.assertion.evidenceRefs.length === 0);
    put('.agents/doc-types.json', JSON.stringify(config));
    const rootJson = verify({ left: { path: left, pointer: '' }, right: { path: right, pointer: '' } });
    assert('explicit-root-pointer', rootJson.assertion.state === 'confirmed');
    for (const [name, a, b, equal] of [
      ['large-integers', '9007199254740992', '9007199254740993', false], ['underflow', '1e-9999', '0', false],
      ['overflow', '1e9999', '2e9999', false], ['large-exponent-equivalence', '1e9999', '10e9998', true],
      ['decimal-equivalence', '120.00', '1.2e2', true], ['negative-zero', '-0.0e-100', '0', true],
      ['number-vs-string', '1', '"1"', false], ['null-vs-false', 'null', 'false', false], ['empty-vs-null', '{}', 'null', false],
      ['object-order', '{"a":1,"b":2}', '{"b":2,"a":1.0}', true], ['array-order', '[1,2]', '[2,1]', false],
      ['decoded-strings', '"a"', '"\\u0061"', true], ['unicode-not-normalized', '"é"', '"é"', false],
      ['prototype-key', '{"__proto__":{"x":1}}', '{"__proto__":{"x":1.0}}', true],
    ]) assert(name, compareJsonPointers(a, '', b, '').state === (equal ? 'equal' : 'different'));
    assert('escaped-pointer', compareJsonPointers('{"a/b":{"~key":[0,42]}}', '/a~1b/~0key/1', '42', '').state === 'equal');
    assert('array-index-exact', compareJsonPointers('[0,1]', '/01', '1', '').state === 'missing');
    assert('number-internals-not-json', compareJsonPointers('{"n":1}', '/n/key', '"1e0"', '').state === 'missing');
    assert('no-prototype-traversal', compareJsonPointers('{}', '/toString', 'null', '').state === 'missing');
    reject('unknown-json-after-selected-field', () => compareJsonPointers('{\"a\":1,\"unused\":{\"x\":1,\"x\":2}}', '/a', '1', ''));
    assert('big-exponent-no-expansion', compareJsonPointers('1e' + '9'.repeat(4000), '', '1e' + '9'.repeat(4000), '').state === 'equal');
    for (const [name, value, reason] of [
      ['duplicate-keys', '{"info":{"version":1,"version":1}}', 'json/duplicate-key'],
      ['decoded-duplicate-keys', '{"info":{"version":1,"\\u0076ersion":1}}', 'json/duplicate-key'],
      ['malformed-json', '{"secret":"SOURCE_VALUE_SENTINEL",', 'json/syntax-invalid'],
      ['invalid-utf8', Buffer.from([123, 0xff, 125]), 'json/invalid-utf8'],
      ['bom', '\ufeff' + data, 'json/bom'], ['depth-limit', '['.repeat(65) + '0' + ']'.repeat(65), 'json/depth-exceeded'],
    ]) {
      put(right, value); const result = verify();
      assert(name, result.assertion.state === 'unverified' && result.unresolved.includes(reason) && !JSON.stringify(result).includes('SOURCE_VALUE_SENTINEL') && result.assertion.verifiedBy === null);
    }
    put(right, data); put(left, '{"info":{"version":9007199254740992}}'); put(right, '{"info":{"version":9007199254740993}}');
    assert('end-to-end-exact-numbers', verify().assertion.state === 'contradicted');
    put(left, data); put(right, data + ' ');
    assert('json-vs-bytes-semantics', verify().assertion.state === 'confirmed' && verifySources(root, raw()).assertion.state === 'contradicted');
    put(left, ''); put(right, '');
    assert('empty-bytes-equality-not-business-truth', verifySources(root, raw()).assertion.state === 'confirmed' && verify().assertion.state === 'unverified');
    put(left, data); put(right, 'x'.repeat(VERIFICATION_LIMITS.maxFileBytes + 1));
    const oversize = verify();
    assert('full-source-or-no-evidence', oversize.assertion.state === 'unverified' && oversize.observation.openedFiles === 0 && !oversize.assertion.evidenceRefs.length && oversize.assertion.sourceRefs.every((s) => s.revision === null));
    const exactBytes = data + ' '.repeat(VERIFICATION_LIMITS.maxFileBytes - Buffer.byteLength(data));
    put(left, exactBytes); put(right, exactBytes);
    const exact = verifySources(root, raw());
    assert('exact-byte-budget', exact.assertion.state === 'confirmed' && exact.observation.chargedBytes === VERIFICATION_LIMITS.maxTotalBytes);
    put(left, data); put(right, data);
    const protectedResult = verify({ protected: true });
    const undeclared = verify({ nonSensitive: false });
    assert('protected-never-downgraded', protectedResult.assertion.state === 'unverified' && protectedResult.observation === null && protectedResult.verifier === null && protectedResult.unresolved.includes('authenticated-verifier-required'));
    assert('privacy-default-no-probe', undeclared.assertion.state === 'unverified' && undeclared.observation === null && undeclared.assertion.sourceRefs.every((s) => s.revision === null));
    for (const path of ['docs/secrets/tokens.json', 'private/data.json', 'docs/auth.key', '.env', '.agents/doc-types.json']) {
      const blocked = verify({ right: { path, pointer: '' }, includeUntracked: true });
      assert(`private-${path}`, blocked.assertion.state === 'unverified' && blocked.observation.openedFiles === 0 && blocked.assertion.evidenceRefs.length === 0);
    }
    const excluded = verify({ exclusions: ['packages'] });
    assert('caller-exclusion-narrows', excluded.assertion.state === 'unverified' && excluded.observation.openedFiles === 0);
    put('docs/new.json', data);
    assert('untracked-opt-in', verify({ right: { path: 'docs/new.json', pointer: '/info/version' } }).assertion.state === 'unverified' && verify({ right: { path: 'docs/new.json', pointer: '/info/version' }, includeUntracked: true }).assertion.state === 'confirmed');
    put('ignored.json', data); git('add', '-f', '--', 'ignored.json');
    const ignored = verify({ right: { path: 'ignored.json', pointer: '/info/version' }, includeUntracked: true });
    assert('forced-tracked-ignored-still-excluded', ignored.assertion.state === 'unverified' && ignored.observation.openedFiles === 0 && ignored.unresolved.includes('ignored-source'));
    git('reset', '-q', '--', 'ignored.json');
    put('docs/raw/item.json', data); put(`docs/raw/${config.rawMarker}`, '');
    assert('raw-marker-not-an-authority', verify({ right: { path: 'docs/raw/item.json', pointer: '/info/version' }, includeUntracked: true }).assertion.state === 'unverified');
    symlinkSync(join(root, left), join(root, 'docs/link.json')); git('add', '--', 'docs/link.json');
    assert('symlink-source', verify({ right: { path: 'docs/link.json', pointer: '/info/version' } }).assertion.state === 'unverified');
    symlinkSync(join(root, 'packages/contracts'), join(root, 'docs/linked-dir')); git('add', '--', 'docs/linked-dir');
    assert('ancestor-symlink', verify({ right: { path: 'docs/linked-dir/openapi.json', pointer: '/info/version' }, includeUntracked: true }).assertion.state === 'unverified');
    linkSync(join(root, left), join(root, 'docs/hard.json'));
    const hard = verify();
    assert('hardlink-source', hard.assertion.state === 'unverified' && hard.observation.openedFiles === 0); rmSync(join(root, 'docs/hard.json'));
    put('docs/nested/item.json', data); git('add', '--', 'docs/nested/item.json'); put('docs/nested/.git', 'not a parent instance');
    assert('nested-repository', verify({ right: { path: 'docs/nested/item.json', pointer: '/info/version' } }).assertion.state === 'unverified');
    rmSync(join(root, 'docs/nested/.git'));
    assert('directory-not-expanded', verify({ right: { path: 'packages', pointer: '' }, includeUntracked: true }).assertion.state === 'unverified');
    reject('serialized-capability', () => readSourceSelection(JSON.parse(JSON.stringify(scope()))));
    const mutable = scope(); mutable.selection.paths.push('docs/secrets/tokens.json'); mutable.objects.push({ path: 'docs/secrets/tokens.json', reason: null });
    assert('caller-cannot-expand-capability', readSourceSelection(mutable).documents.length === 2);
    const blockedScope = scope({ nonSensitive: false }); blockedScope.objects.forEach((item) => { item.reason = null; });
    assert('caller-cannot-clear-privacy', readSourceSelection(blockedScope).documents.every((item) => item.bytes === null));
    const drift = (name, change, restore) => { const selected = scope(); change(); const report = readSourceSelection(selected); assert(name, !report.stable && report.openedFiles === 0 && report.documents.every((d) => d.bytes === null && d.digest === null)); restore(); };
    drift('source-drift', () => put(right, data + ' '), () => put(right, data));
    drift('registry-drift', () => put('.agents/doc-types.json', JSON.stringify(config) + ' '), () => put('.agents/doc-types.json', JSON.stringify(config)));
    drift('ignored-after-selection', () => put('.gitignore', 'ignored.json\ndocs/api.json\n'), () => put('.gitignore', 'ignored.json\n'));
    drift('raw-after-selection', () => put(`packages/${config.rawMarker}`, ''), () => rmSync(join(root, `packages/${config.rawMarker}`)));
    drift('index-drift', () => { put('extra.txt', 'x'); git('add', '--', 'extra.txt'); }, () => git('reset', '-q', '--', 'extra.txt'));
    drift('head-drift', () => { put('head-change.txt', 'new head'); commit('head-change.txt'); }, () => {});
    const untrackedScope = scope({ paths: ['docs/new.json'], includeUntracked: true });
    rmSync(join(root, 'docs/new.json'));
    assert('untracked-drift', !readSourceSelection(untrackedScope).stable);
    const noGit = realpathSync(mkdtempSync(join(tmpdir(), 'curia-no-git-source-')));
    try { assert('missing-instance-no-fallback', verifySources(noGit, options).assertion.state === 'unverified'); }
    finally { rmSync(noGit, { recursive: true, force: true }); }
    for (const path of ['../elsewhere.json', '/tmp/source.json', 'https://host/a.json', 'docs/./api.json', 'docs/*', '.git/config', 'docs/a#fragment.json', 'docs/a%2fpart.json']) reject(`invalid-path-${path}`, () => verify({ left: { path, pointer: '' } }));
    reject('case-alias-selection', () => verify({ right: { path: left.toUpperCase(), pointer: '/info/version' } }));
    reject('unknown-option', () => verify({ execute: true })); reject('unknown-method', () => verify({ method: 'custom-command/1' }));
    reject('implicit-root-pointer', () => verify({ left: { path: left } })); reject('bytes-with-pointer', () => verify({ method: 'raw-bytes-equal/1' }));
    reject('bad-pointer', () => verify({ left: { path: left, pointer: '/bad~2' } }));
    const cliArgs = ['--root', root, '--method', options.method, '--left', left, '--left-pointer', '/info/version', '--right', right, '--right-pointer', '/info/version', '--non-sensitive', '--json'];
    const invoke = (args, script = cli) => spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8', env });
    const okCli = invoke(cliArgs); assert('actual-cli-confirmed', okCli.status === 0 && JSON.parse(okCli.stdout).assertion.state === 'confirmed', okCli.stderr);
    put(right, data.replace('"version":"1"', '"version":"2"'));
    assert('actual-cli-contradicted-exit', invoke(cliArgs).status === 1); put(right, data);
    assert('actual-cli-unverified-exit', invoke(cliArgs.filter((flag) => flag !== '--non-sensitive')).status === 2);
    reject('cli-repeat-flag', () => parseVerifyArgs([...cliArgs, '--left', right])); reject('cli-list-does-not-hide-write', () => parseVerifyArgs(['--list-methods', '--protected']));
    assert('cli-error-no-argv-echo', !invoke([...cliArgs, '--execute', 'SECRET_ARG_SENTINEL']).stderr.includes('SECRET_ARG_SENTINEL'));
    const sourceDir = dirname(cli); mkdirSync(join(root, 'scripts'), { recursive: true });
    for (const file of VERIFIER_FILES) cpSync(join(sourceDir, file), join(root, 'scripts', file), { recursive: true });
    const copiedCli = join(root, 'scripts/curia-verify.mjs');
    assert('copied-implementation-closure', invoke(cliArgs, copiedCli).status === 0);
    put('scripts/curia-json.mjs', readFileSync(join(root, 'scripts/curia-json.mjs'), 'utf8') + '\n/*' + 'x'.repeat(1024 * 1024) + '*/\n');
    const bigCode = invoke(cliArgs, copiedCli);
    assert('oversize-code-not-prefix-identity', bigCode.status === 2 && JSON.parse(bigCode.stdout).unresolved.includes('verifier-identity-unavailable'));
  } finally { rmSync(root, { recursive: true, force: true }); }
}

if (isMainModule(import.meta.url)) {
  let passed = 0; const failures = [];
  verificationFixtures({ registry: JSON.parse(readFileSync(join(ROOT, '.agents/doc-types.json'), 'utf8')), expectTrue: (name, condition, detail = '') => condition ? passed++ : failures.push(`${name}: ${detail}`) });
  console.log(JSON.stringify({ passed, failed: failures.length, failures }, null, 2));
  process.exitCode = failures.length ? 1 : 0;
}
