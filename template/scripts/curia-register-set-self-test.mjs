/** Bounded document/Git fixtures for cross-register declarations, never the referenced originals. */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, realpathSync, existsSync, rmSync, symlinkSync, linkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { ROOT, isMainModule } from './doc-lib.mjs';
import { buildInventory, prepareSourceSelection, revalidateSourceSelection } from './curia-query.mjs';
import { verifyRegisterSet, verifyRegisteredOriginal, parseRegisterSetArgs, REGISTER_SET_LIMITS, VERIFIER_FILES } from './curia-verify.mjs';

import { buildReadWorkflow } from './curia-workflow.mjs';
import { inspectOriginalRegister } from './curia-originals.mjs';

export function registerSetFixtures({ expectTrue, registry }) {
  encryptedRegisterBoundaries({ expectTrue, registry });
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'curia-register-set-')));
  const cli = fileURLToPath(new URL('./curia-verify.mjs', import.meta.url));
  const env = { ...process.env }; delete env.CURIA_STAGED; delete env.CURIA_STAGED;
  const git = (...args) => execFileSync('git', args, { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] });
  const put = (path, value) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), value); };
  const commit = (...paths) => { git('add', '--', ...paths); git('-c', 'user.name=fixture', '-c', 'user.email=fixture@local', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'register set fixture', '--', ...paths); };
  const assert = (name, ok, detail = '') => expectTrue(`Curia register set [${name}]`, !!ok, detail);
  const reject = (name, fn) => { let error; try { fn(); } catch (e) { error = e; } assert(name, error, error?.message ?? 'not rejected'); };
  const cfg = structuredClone(registry); delete cfg.instance;
  const a = 'docs/a.json', b = 'docs/b.json', paths = [a, b];
  const entry = (uri = 'repo:unopened/missing.pdf', revision = 'v1', extra = {}) => ({ id: 'manual', format: 'pdf', sourceRef: { uri, revision, locator: 'PRIVATE_LOCATOR_NOT_IN_REPORT' }, location: 'PRIVATE_LOCATION_NOT_IN_REPORT', ...extra });
  const table = originals => JSON.stringify({ schema: 'curia.original-register/1', owner: 'DECLARED_OWNER_NOT_IN_REPORT', accessRef: 'docs/access.md', originals });
  const reset = () => { put(a, table([entry()])); put(b, table([entry('paper:Different')])); };
  const check = extra => verifyRegisterSet(root, { paths, nonSensitive: true, ...extra });
  const run = (...args) => spawnSync(process.execPath, [cli, 'registers', '--root', root, ...args], { cwd: root, env, encoding: 'utf8' });
  const noComparison = r => r.state === 'incomplete' && r.comparison === null && !r.coverage.allSelectedRegistersParsed;
  try {
    put('AGENTS.md', '# Rules\n'); put('.agents/README.md', '# Control\n'); put('docs/README.md', '# Knowledge\n');
    put('.agents/doc-types.json', JSON.stringify(cfg)); put('.gitignore', 'ignored.json\n'); reset();
    git('init', '-q'); commit('AGENTS.md', '.agents/README.md', '.agents/doc-types.json', 'docs/README.md', '.gitignore', ...paths);
    const indexBefore = git('ls-files', '-s', '-z').toString(), clean = check();
    assert('exact-selected-distinct-declarations', clean.state === 'pass' && clean.exitCode === 0 && clean.coverage.allSelectedRegistersParsed && clean.coverage.comparedDeclarations === 2);
    assert('local-ids-can-repeat-across-tables', clean.comparison.identities === 2 && clean.comparison.duplicateDeclarations.length === 0);
    assert('register-only-read-count', clean.observation.openedFiles === 2 && clean.coverage.originalsRead === 0 && clean.coverage.originalsVerified === 0 && !existsSync(join(root, 'unopened')));
    assert('actual-table-digests-not-source-digests', clean.sourceRefs.every(r => r.revision.value === createHash('sha256').update(readFileSync(join(root, r.uri.slice(5)))).digest('hex')) && clean.evidenceRefs.length === 2);
    assert('no-owner-location-access-or-body-copy', !['DECLARED_OWNER_NOT_IN_REPORT', 'PRIVATE_LOCATOR_NOT_IN_REPORT', 'PRIVATE_LOCATION_NOT_IN_REPORT', 'docs/access.md'].some(v => JSON.stringify(clean).includes(v)));
    assert('no-surface-or-persistence', !cfg.instance && !existsSync(join(root, 'docs/records')) && git('ls-files', '-s', '-z').toString() === indexBefore);
    assert('known-narrow-verifier-closure', JSON.stringify(clean.verifier.implementation.map(e => e.file)) === JSON.stringify(VERIFIER_FILES) && VERIFIER_FILES.length === 11);
    assert('non-atomic-current-worktree-not-global', clean.scope.globalCoverage === false && clean.observation.source.consistency === 'non-atomic-with-postcheck' && clean.observation.postcheck.stable);
    assert('no-alias-or-current-selection-claims', !clean.coverage.aliasesChecked && clean.comparison.currentSelection === 'not-performed');
    const noPrivacy = verifyRegisterSet('/missing/root', { paths }), protectedResult = verifyRegisterSet('/missing/root', { paths, nonSensitive: true, protected: true });
    assert('privacy-before-root-or-code-probe', noComparison(noPrivacy) && noPrivacy.observation === null && noPrivacy.verifier === null);
    assert('protected-not-downgraded', noComparison(protectedResult) && protectedResult.observation === null && protectedResult.scope.assurance === 'protected-requested');
    put(b, table([entry(undefined, undefined, { id: 'other-local-id' })]));
    const duplicate = check(), d = duplicate.comparison.duplicateDeclarations[0];
    assert('cross-table-duplicate-fails', duplicate.state === 'fail' && duplicate.exitCode === 1 && d.entries.length === 2 && d.differingFields.length === 0);
    assert('precise-entry-evidence-locators', d.entries.map(e => e.register).join(',') === paths.join(',') && d.entries.every(e => e.locator.pointer === '/originals/0' && duplicate.sourceRefs[e.sourceRef].uri === `repo:${e.register}`));
    put(b, table([entry(undefined, undefined, { owner: 'OTHER_OWNER', accessRef: 'docs/other-access.md', format: 'docx', encryption: 'encrypted', location: 'OTHER_LOCATION', sourceRef: { uri: 'repo:unopened/missing.pdf', revision: 'v1', locator: 'OTHER_LOCATOR' } })]));
    const differences = check();
    assert('effective-declaration-differences-not-values', JSON.stringify(differences.comparison.duplicateDeclarations[0].differingFields) === JSON.stringify(['format', 'owner', 'accessRef', 'location', 'encryption', 'sourceRef.locator']) && !JSON.stringify(differences).includes('OTHER_OWNER'));
    put(b, table([entry(undefined, 'v2')]));
    const versions = check();
    assert('different-known-versions-not-duplicates-or-latest', versions.state === 'pass' && versions.comparison.revisionSets[0].state === 'distinct-declared-revisions' && versions.comparison.currentSelection === 'not-performed');
    put(b, table([entry(undefined, null)]));
    const overlap = check();
    assert('unknown-known-version-overlap-not-pass', overlap.state === 'incomplete' && overlap.exitCode === 2 && !overlap.comparison.complete && overlap.comparison.revisionSets[0].state === 'unresolved-overlap');
    put(a, table([entry(undefined, null)]));
    assert('two-unknowns-are-duplicate-declarations-not-verified-identities', check().state === 'fail');
    put(a, table([entry(undefined, 'sha256:raw-bytes/1:' + 'a'.repeat(64))])); put(b, table([entry('repo:another/missing.pdf', 'sha256:raw-bytes/1:' + 'a'.repeat(64))]));
    assert('equal-declared-digests-not-same-source-identity', check().state === 'pass' && check().comparison.identities === 2);
    put(a, table([entry('repo:unopened/Missing.pdf')])); put(b, table([entry('repo:unopened/missing.pdf')]));
    assert('source-case-never-silently-normalized', check().state === 'pass' && !check().coverage.aliasesChecked);
    put(a, table([entry('https://invalid.example/unopened.pdf')])); put(b, table([entry('https://invalid.example/unopened.pdf')]));
    assert('https-identity-compared-without-network', check().state === 'fail' && check().observation.openedFiles === 2);
    put(a, table([])); put(b, table([]));
    assert('empty-registers-not-vacuous-original-pass', check().state === 'not-applicable' && check().coverage.comparedDeclarations === 0);
    for (const [name, bad] of [
      ['duplicate-within-register', table([entry(), entry(undefined, undefined, { id: 'second' })])],
      ['duplicate-json-key', table([entry()]).replace('"schema":', '"schema":"curia.original-register/1","schema":')],
      ['unknown-schema', table([entry()]).replace('curia.original-register/1', 'curia.original-register/999')],
      ['unknown-field', table([entry()]).replace('"originals":', '"evil":"SECRET_NOT_REPORTED","originals":')],
      ['missing-owner', JSON.stringify({ schema: 'curia.original-register/1', accessRef: 'docs/access.md', originals: [entry()] })],
      ['invalid-json', '{'], ['leading-bom', '\ufeff' + table([])], ['invalid-utf8', Buffer.from([0xff])],
      ['over-file-budget', ' '.repeat(REGISTER_SET_LIMITS.maxFileBytes + 1)],
    ]) { reset(); put(b, bad); const r = check(); assert(name, noComparison(r) && r.coverage.comparedDeclarations === 0 && !JSON.stringify(r).includes('SECRET_NOT_REPORTED')); }
    reset();
    for (const [name, extra] of [ ['excluded-peer', { exclusions: [b] }], ['missing-peer', { paths: [a, 'docs/missing.json'] }], ['directory-not-expanded', { paths: ['docs'] }] ]) {
      const r = check(extra); assert(name, noComparison(r) && r.observation.openedFiles === 0);
    }
    put('ignored.json', table([entry()]));
    assert('all-never-includes-ignored', noComparison(check({ paths: [a, 'ignored.json'], includeUntracked: true })));
    put('docs/untracked.json', table([entry('paper:Untracked')]));
    assert('untracked-explicit-opt-in', noComparison(check({ paths: [a, 'docs/untracked.json'] })) && check({ paths: [a, 'docs/untracked.json'], includeUntracked: true }).state === 'pass');
    put(`docs/${cfg.rawMarker}`, ''); assert('raw-subtree-excluded', noComparison(check())); rmSync(join(root, `docs/${cfg.rawMarker}`));
    symlinkSync(a.slice(5), join(root, 'docs/link.json')); assert('symlink-never-followed', noComparison(check({ paths: ['docs/link.json'], includeUntracked: true }))); rmSync(join(root, 'docs/link.json'));
    linkSync(join(root, a), join(root, 'docs/hard.json')); assert('hardlink-rejected', noComparison(check())); rmSync(join(root, 'docs/hard.json'));
    const bigPaths = Array.from({ length: 9 }, (_, i) => `docs/big-${i}.json`);
    for (const p of bigPaths) put(p, table([]).padEnd(60000, ' '));
    const big = check({ paths: bigPaths, includeUntracked: true }); assert('total-budget-before-content-read', noComparison(big) && big.observation.openedFiles === 0);
    for (const p of bigPaths) rmSync(join(root, p));
    const Native = globalThis.TextDecoder;
    for (const [name, change, restore] of [
      ['source-drift-during-parsing', () => put(b, table([entry('paper:Changed')])), reset],
      ['registry-drift-during-parsing', () => put('.agents/doc-types.json', JSON.stringify(cfg) + '\n'), () => put('.agents/doc-types.json', JSON.stringify(cfg))],
      ['ignore-drift-during-parsing', () => put('.gitignore', 'ignored.json\ndocs/b.json\n'), () => put('.gitignore', 'ignored.json\n')],
    ]) {
      let changed = false, r;
      globalThis.TextDecoder = class extends Native { decode(bytes, ...rest) { const text = super.decode(bytes, ...rest); if (!changed && text.includes('DECLARED_OWNER_NOT_IN_REPORT')) { changed = true; change(); } return text; } };
      try { r = check(); } finally { globalThis.TextDecoder = Native; restore(); }
      assert(name, changed && noComparison(r) && r.sourceRefs.length === 0 && r.evidenceRefs.length === 0 && !r.observation.stable);
    }
    const cap = prepareSourceSelection(root, { paths, nonSensitive: true });
    assert('live-capability-postcheck', revalidateSourceSelection(cap));
    reject('json-does-not-restore-read-capability', () => revalidateSourceSelection(JSON.parse(JSON.stringify(cap))));
    cap.selection.paths.push('docs/elsewhere.json'); assert('tampered-capability-cannot-postcheck', !revalidateSourceSelection(cap));
    for (const [name, extra] of [ ['no-paths', { paths: [] }], ['duplicate-path', { paths: [a, a] }], ['case-alias-path', { paths: [a, 'docs/A.json'] }], ['too-many-files', { paths: Array.from({ length: 17 }, (_, i) => `docs/${i}.json`) }], ['unknown-option', { paths, data: [] }], ['string-privacy', { paths, nonSensitive: 'true' }] ]) reject(name, () => check(extra));
    for (const [name, args] of [ ['cli-duplicate-scalar', ['--non-sensitive', '--non-sensitive']], ['cli-no-implicit-corpus', ['--corpus']], ['cli-no-source-expansion', ['--source', 'docs/manual.pdf']], ['cli-no-path-alias-flag', ['--path', a]], ['cli-missing-value', ['--register']] ]) reject(name, () => parseRegisterSetArgs(args));
    const cliPass = run('--register', a, '--register', b, '--non-sensitive', '--json');
    assert('real-cli-pass', cliPass.status === 0 && JSON.parse(cliPass.stdout).state === 'pass', cliPass.stderr);
    put(b, table([entry()])); const cliFail = run('--register', a, '--register', b, '--non-sensitive', '--json');
    assert('real-cli-fail', cliFail.status === 1 && JSON.parse(cliFail.stdout).state === 'fail');
    const cliDenied = run('--register', a, '--json'); assert('real-cli-privacy-exit', cliDenied.status === 2 && JSON.parse(cliDenied.stdout).verifier === null);
    const cliInvalid = run('--register', a, '--nonsense', 'PRIVATE_ARG'); assert('cli-invalid-no-value-leak', cliInvalid.status === 2 && cliInvalid.stdout === '' && !cliInvalid.stderr.includes('PRIVATE_ARG'));
    assert('final-index-unchanged', git('ls-files', '-s', '-z').toString() === indexBefore);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

/** Encryption is an unverified declaration; native key/adapter policy is never an implicit input. */
function encryptedRegisterBoundaries({ expectTrue, registry }) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'curia-encrypted-originals-')));
  const env = { ...process.env }; delete env.CURIA_STAGED; delete env.CURIA_STAGED;
  let gitFailed = false;
  const git = (...args) => { try { return execFileSync('git', args, { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] }); } catch (error) { gitFailed = true; throw error; } };
  const put = (p, data) => { mkdirSync(dirname(join(root, p)), { recursive: true }); writeFileSync(join(root, p), data); };
  const register = 'docs/register.json', original = 'docs/cipher.pdf', policy = 'docs/access.md', key = '.secrets/native.key', adapter = 'docs/native-decrypt.mjs';
  const body = Buffer.from('CIPHERTEXT_SENTINEL\x00\xff', 'latin1'), keyBody = 'SYNTHETIC_KEY_MUST_NOT_BE_READ', plaintext = 'PLAINTEXT_MUST_NOT_EXIST';
  const cfg = structuredClone(registry); delete cfg.instance;
  cfg.instance = { schema: 'curia.instance/1', owner: 'curator', surfaces: [
    { id: 'control', kind: 'root', members: [{ path: '.agents', kind: 'directory', role: 'control' }], entry: '.agents/README.md', authorityLinks: ['AGENTS.md'] },
    { id: 'knowledge', kind: 'root', members: [{ path: 'docs', kind: 'directory', role: 'knowledge' }], entry: 'docs/README.md', authorityLinks: ['AGENTS.md'] },
  ], mappings: [{ path: register, kind: 'file', contentParser: 'json-original-register/1' }] };
  const declaration = { schema: 'curia.original-register/1', owner: 'curator', accessRef: policy, originals: [{ id: 'sealed', format: 'pdf', encryption: 'encrypted', sourceRef: { uri: `repo:${original}`, revision: `sha256:raw-bytes/1:${createHash('sha256').update(body).digest('hex')}` } }] };
  const assert = (name, ok, detail = '') => expectTrue(`Curia encrypted originals [${name}]`, !!ok, detail);
  const save = data => put(register, JSON.stringify(data));
  const read = extra => buildReadWorkflow(root, { selection: { paths: [register] }, ...extra });
  const inspect = data => inspectOriginalRegister({ text: JSON.stringify(data), encodingState: 'valid', truncated: false }, register);
  const protectedPaths = [original, policy, key, adapter];
  const observe = (fn, denied = protectedPaths) => {
    const opened = [], blocked = [], oldOpen = fs.openSync;
    fs.openSync = (...args) => {
      const p = String(args[0]); opened.push(p);
      if (denied.some(rel => p === join(root, rel))) { blocked.push(p); throw Object.assign(new Error('fixture forbids undeclared content reads'), { code: 'EACCES' }); }
      return oldOpen(...args);
    }; syncBuiltinESMExports();
    try { return { result: fn(), opened, blocked }; }
    finally { fs.openSync = oldOpen; syncBuiltinESMExports(); }
  };
  const names = (dir = root, prefix = '') => fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.name !== '.git').flatMap(e => e.isDirectory() ? names(join(dir, e.name), `${prefix}${e.name}/`) : [`${prefix}${e.name}`]).sort();
  try {
    put('AGENTS.md', '# Authority\n'); put('.agents/README.md', '# Control\n'); put('docs/README.md', '# Knowledge\n'); put('.agents/doc-types.json', JSON.stringify(cfg)); put('.gitignore', '.secrets/\n');
    put(original, body); put(key, keyBody); put(policy, `# Native access rules\n\nSensitivity: internal\nKeyRef: ${key}\nAdapter: ${adapter}\nPOLICY_MUST_NOT_BE_READ\n`);
    put(adapter, `import fs from 'node:fs';fs.writeFileSync('DECRYPTION_EXECUTED', '${plaintext}');\n`); save(declaration);
    git('init', '-q'); git('add', '--', 'AGENTS.md', '.agents', 'docs', '.gitignore'); git('-c', 'user.name=fixture', '-c', 'user.email=fixture@local', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'encrypted-original fixture');
    const index = git('ls-files', '-s', '-z').toString(), beforeNames = names();
    const inventory = observe(() => read({ inventoryOnly: true }));
    assert('inventory-does-not-follow-or-disclose-native-policy', inventory.result.outcome === 'inventoried-not-read' && !inventory.blocked.length && !inventory.opened.includes(join(root, register)) && !JSON.stringify(inventory.result).includes('"encryption"'));
    const queried = observe(() => buildInventory(root, null, { metadataSelection: { paths: [register] } }));
    assert('query-keeps-declaration-unverified', !queried.blocked.length && queried.result.coverage.originals.registered === 1 && queried.result.coverage.originals.read === 0 && queried.result.coverage.originals.verified === 0);
    const observed = observe(() => read()), report = observed.result, item = report.documents[0].envelope.content.originals[0];
    assert('open-interceptor-observed-register-and-registry', [register, '.agents/doc-types.json'].every(p => observed.opened.includes(join(root, p))));
    assert('encrypted-original-policy-key-and-adapter-never-opened', observed.blocked.length === 0 && protectedPaths.every(p => !observed.opened.includes(join(root, p))));
    assert('registration-is-not-original-read', report.outcome === 'read-complete' && report.coverage.originals.read === 0 && report.coverage.originals.verified === 0 && !report.coverage.originals.complete);
    assert('encryption-is-not-authentication-or-access', item.encryption === 'encrypted' && item.unparsed.reason === 'encrypted-not-opened' && item.access === 'not-checked' && item.existence === 'not-checked' && item.verification === 'not-verified' && item.digest === null);
    assert('policy-pointer-not-key-pointer', item.accessRef === policy && !JSON.stringify(report).includes(key));
    assert('no-key-plaintext-policy-or-payload-projection', [keyBody, plaintext, 'POLICY_MUST_NOT_BE_READ', 'CIPHERTEXT_SENTINEL'].every(value => !JSON.stringify(report).includes(value)));
    assert('original-coverage-remains-evidence-gap', report.checks.some(c => c.id === 'curia-read/originals' && c.state === 'evidence-gap'));
    const control = observe(() => read(), [register]);
    assert('blocked-open-positive-control-is-not-empty-coverage', control.blocked.includes(join(root, register)) && control.result.outcome !== 'read-complete');
    const sets = observe(() => verifyRegisterSet(root, { paths: [register], nonSensitive: true }));
    assert('set-comparison-does-not-open-native-inputs', !sets.blocked.length && sets.result.state === 'pass' && sets.result.coverage.originalsRead === 0 && sets.result.coverage.originalsVerified === 0);
    assert('set-comparison-does-not-export-native-policy', !JSON.stringify(sets.result).includes(policy) && !JSON.stringify(sets.result).includes(key));
    const bytes = observe(() => verifyRegisteredOriginal(root, { register, id: 'sealed', source: original, nonSensitive: true }), [policy, key, adapter]);
    assert('separate-authorized-ciphertext-identity-only', bytes.result.assertion.state === 'confirmed' && bytes.result.observation.openedFiles === 2 && !bytes.blocked.length && bytes.opened.includes(join(root, original)));
    assert('ciphertext-check-never-decrypts-or-opens-key', [keyBody, plaintext, 'POLICY_MUST_NOT_BE_READ', 'CIPHERTEXT_SENTINEL'].every(value => !JSON.stringify(bytes.result).includes(value)));
    for (const field of ['password', 'key', 'keyRef', 'decryptionAdapter', 'plaintextPath']) {
      const data = structuredClone(declaration); data.originals[0][field] = 'REJECTED_INLINE_VALUE';
      const parsed = inspect(data); assert(`inline-${field}-is-not-register-schema`, parsed.state === 'unparsed' && parsed.originals.length === 0);
      save(data); const denied = observe(() => read());
      assert(`inline-${field}-does-not-leak-or-activate`, denied.result.documents[0].text === null && !denied.blocked.length && !JSON.stringify(denied.result).includes('REJECTED_INLINE_VALUE'));
    }
    save(declaration);
    for (const field of ['decrypt', 'keyRef', 'plaintextPath']) {
      let error; try { buildReadWorkflow('/missing', { selection: { paths: [register] }, [field]: 'REJECTED_OPTION_VALUE' }); } catch (e) { error = e; }
      assert(`workflow-${field}-rejected-before-input-access`, error?.message.includes('[curia2/workflow-options-invalid]') && !error.message.includes('REJECTED_OPTION_VALUE'));
    }
    const cli = fileURLToPath(new URL('./curia-workflow.mjs', import.meta.url));
    const output = spawnSync(process.execPath, [cli, '--root', root, '--path', register, '--strict', '--json'], { cwd: root, env, encoding: 'utf8' });
    assert('actual-cli-preserves-encrypted-unread', output.status === 0 && JSON.parse(output.stdout).coverage.originals.read === 0, output.stderr);
    const unknown = spawnSync(process.execPath, [cli, '--root', root, '--path', register, '--decrypt', 'REJECTED_OPTION_VALUE', '--json'], { cwd: root, env, encoding: 'utf8' });
    assert('actual-cli-no-decryption-shortcut-or-secret-echo', unknown.status === 2 && !`${unknown.stdout}${unknown.stderr}`.includes('REJECTED_OPTION_VALUE'));
    assert('no-plaintext-output-key-copy-or-new-store', JSON.stringify(names()) === JSON.stringify(beforeNames) && !existsSync(join(root, 'DECRYPTION_EXECUTED')) && !existsSync(join(root, 'docs/records')));
    assert('source-policy-key-and-index-unchanged', readFileSync(join(root, original)).equals(body) && readFileSync(join(root, key), 'utf8') === keyBody && git('ls-files', '-s', '-z').toString() === index);
  } finally { if (gitFailed) console.error(`encrypted-original Git fixture retained: ${root}`); else rmSync(root, { recursive: true, force: true }); }
}

if (isMainModule(import.meta.url)) { let passed = 0; const failed = []; registerSetFixtures({ registry: JSON.parse(readFileSync(join(ROOT, '.agents/doc-types.json'), 'utf8')), expectTrue: (name, ok, detail) => ok ? passed++ : failed.push({ name, detail }) }); console.log(JSON.stringify({ passed, failed }, null, 2)); if (failed.length) process.exitCode = 1; }
