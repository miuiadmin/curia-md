/** Disposable Git-only fixtures; no application runtime, network or shared repository mutations. */
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ROOT, isMainModule } from './doc-lib.mjs';
import { buildInputSnapshots, prepareInputSnapshots, observeInputSnapshots, revalidateInputSnapshots, normalizeSnapshotOptions, parseSnapshotArgs, snapshotCodeIdentity, SNAPSHOT_RULES } from './curia-snapshots.mjs';
export function snapshotFixtures({ expectTrue, registry }) {
  const base = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'curia-snapshots-'))), a = join(base, 'a'), b = join(base, 'b'), cli = fileURLToPath(new URL('./curia-workflow.mjs', import.meta.url));
  const env = { ...process.env }; for (const k of Object.keys(env)) if (k.startsWith('GIT_') || ['CURIA_ROOT', 'CURIA_STAGED', 'CURIA_ROOT', 'CURIA_STAGED', 'NODE_OPTIONS'].includes(k)) delete env[k];
  const git = (root, ...args) => execFileSync('git', args, { cwd: root, env, stdio: 'pipe' }).toString().trim();
  const put = (root, path, text) => { fs.mkdirSync(dirname(join(root, path)), { recursive: true }); fs.writeFileSync(join(root, path), text); };
  const commit = (root, ...paths) => { git(root, 'add', '--', ...paths); git(root, '-c', 'user.name=fixture', '-c', 'user.email=fixture@local', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'snapshot fixture', '--', ...paths); };
  const assert = (name, ok, detail = '') => expectTrue(`Curia input snapshots [${name}]`, !!ok, detail);
  const reject = (name, fn) => { let error; try { fn(); } catch (e) { error = e; } assert(name, !!error, error?.message ?? 'not rejected'); };
  const config = structuredClone(registry); delete config.instance;
  const init = root => { fs.mkdirSync(root, { recursive: true }); git(root, 'init', '-q'); put(root, '.agents/doc-types.json', JSON.stringify(config)); put(root, '.agents/README.md', '# Control\n'); put(root, 'AGENTS.md', '# Rules\n'); put(root, 'README.md', '# Project\n'); put(root, 'docs/a.txt', 'ORIGINAL_DATA_ONLY\n'); put(root, 'docs/deleted.md', '# Existing\n'); commit(root, '.agents/doc-types.json', '.agents/README.md', 'AGENTS.md', 'README.md', 'docs/a.txt', 'docs/deleted.md'); };
  const spec = (id, root, extra = {}) => ({ id, root, within: ['docs'], ...extra });
  const input = extra => ({ repositories: [spec('a', a), spec('b', b)], nonSensitive: true, ...extra });
  const build = extra => buildInputSnapshots(input(extra));
  const row = (r, id = 'a') => r.members.find(m => m.id === id);
  const object = (r, path, id = 'a') => row(r, id).observation?.objects.find(o => o.path === path);
  const reset = root => { git(root, 'reset', '--hard', 'HEAD'); git(root, 'clean', '-fdx'); };
  const duringRead = (path, action, fn) => {
    const native = fs.readSync, ino = fs.statSync(path).ino; let fired = false;
    fs.readSync = (fd, ...args) => { const n = native.call(fs, fd, ...args); if (n && !fired && fs.fstatSync(fd).ino === ino) { fired = true; action(); } return n; }; syncBuiltinESMExports();
    try { const result = fn(); assert('controlled-drift-hook-fired', fired); return result; } finally { fs.readSync = native; syncBuiltinESMExports(); }
  };
  try {
    init(a); init(b); const initialA = git(a, 'ls-files', '-s'), initialB = git(b, 'ls-files', '-s');
    const prepared = prepareInputSnapshots(input());
    assert('inventory-is-not-capture', !prepared.complete && !prepared.stable && prepared.mode === 'inventory-only' && prepared.coverage.chargedBytes === 0 && prepared.members.every(m => !Object.hasOwn(m, 'observation')));
    const capture = observeInputSnapshots(prepared);
    assert('multi-repository', capture.complete && capture.members.length === 2 && row(capture).root === a && row(capture, 'b').root === b && capture.coverage.capturedObjects === 4);
    assert('distinct-source-attribution', capture.members.every(m => m.observation.source.git.head === git(m.root, 'rev-parse', 'HEAD') && m.observation.source.registry.path === '.agents/doc-types.json'));
    assert('no-body-or-semantic-claim', !JSON.stringify(capture).includes('ORIGINAL_DATA_ONLY') && capture.coverage.contentRead === 0 && capture.coverage.factVerified === 0 && capture.limitations.includes('not-an-atomic-cross-repository-snapshot'));
    assert('scope-not-whole-repository-dirty', capture.members.every(m => m.inputState === 'matches-head-in-selected-scope') && capture.limitations.includes('selected-input-state-not-whole-repository-dirty-status'));
    assert('revalidate-live', revalidateInputSnapshots(capture));
    assert('full-observer-and-config-identities', capture.tool.implementation.length === 11 && capture.tool.implementation.every(i => i.digest.algorithm === 'sha256' && i.digest.canonicalization === 'raw-bytes/1') && capture.members.every(m => m.observation.source.registry.digest.value.length === 64));
    assert('json-cannot-restore-observation', !revalidateInputSnapshots(JSON.parse(JSON.stringify(capture))));
    reject('json-cannot-restore-selection', () => observeInputSnapshots(JSON.parse(JSON.stringify(prepared))));
    const changed = prepareInputSnapshots(input()); changed.members[0].root = b; reject('selection-mutation-rejected', () => observeInputSnapshots(changed));
    capture.members[0].observation.source.git.head = '0'.repeat(40); assert('report-mutation-rejected', !revalidateInputSnapshots(capture));
    assert('no-sources-or-index-writes', git(a, 'ls-files', '-s') === initialA && git(b, 'ls-files', '-s') === initialB && !fs.existsSync(join(a, 'docs/records')) && !fs.existsSync(join(b, 'docs/records')));

    put(a, 'docs/a.txt', 'STAGED\n'); git(a, 'add', '--', 'docs/a.txt'); put(a, 'docs/a.txt', 'WORKTREE\n'); fs.unlinkSync(join(a, 'docs/deleted.md')); put(a, 'docs/new.md', '# Untracked\n');
    const mixed = build({ repositories: [spec('a', a, { includeUntracked: true }), spec('b', b)] });
    assert('mixed-inputs', mixed.complete && row(mixed).inputState === 'mixed-tree' && object(mixed, 'docs/a.txt').staged === 'content' && object(mixed, 'docs/a.txt').worktreeChange === 'content' && object(mixed, 'docs/deleted.md').worktreeChange === 'deleted');
    assert('untracked-explicit', object(mixed, 'docs/new.md').discoveredUntracked && object(mixed, 'docs/new.md').digest.value.length === 64 && row(mixed, 'b').inputState === 'matches-head-in-selected-scope');
    const noUntracked = build(); assert('untracked-omitted-without-global-clean-claim', noUntracked.complete && !object(noUntracked, 'docs/new.md') && !row(noUntracked).observation.includeUntracked);
    reset(a); git(a, 'rm', '--cached', 'docs/a.txt');
    const unobserved = build(); assert('untracked-not-observed', !unobserved.complete && unobserved.coverage.capturedObjects === 0 && unobserved.members.every(m => m.observation === null) && row(unobserved).findings.some(f => f.code === 'curia-snapshot/untracked-input-not-observed'));
    reset(a);

    put(a, 'docs/.env', 'PRIVATE_IDENTITY_SENTINEL\n'); put(a, 'docs/private.txt', 'EXPLICIT_PRIVATE_SENTINEL\n'); put(a, 'docs/ignored.txt', 'IGNORED_SENTINEL\n'); put(a, 'docs/raw/.agents-raw', ''); put(a, 'docs/raw/data.txt', 'RAW_SENTINEL\n');
    commit(a, 'docs/.env', 'docs/private.txt', 'docs/ignored.txt', 'docs/raw/.agents-raw', 'docs/raw/data.txt'); put(a, '.gitignore', 'docs/ignored.txt\n'); commit(a, '.gitignore');
    const privateOid = git(a, 'rev-parse', 'HEAD:docs/.env'), explicitOid = git(a, 'rev-parse', 'HEAD:docs/private.txt'), ignoredOid = git(a, 'rev-parse', 'HEAD:docs/ignored.txt');
    const safe = build({ repositories: [spec('a', a, { exclusions: ['docs/private.txt'] }), spec('b', b)] }), text = JSON.stringify(safe);
    assert('privacy-content-identities-withheld', safe.complete && ![privateOid, explicitOid, ignoredOid, 'PRIVATE_IDENTITY_SENTINEL', 'EXPLICIT_PRIVATE_SENTINEL', 'IGNORED_SENTINEL', 'RAW_SENTINEL'].some(v => text.includes(v)) && row(safe).omitted.privacy === 2 && row(safe).omitted.ignored === 1 && row(safe).omitted.raw === 2);
    const scopedInput = () => input({ repositories: [spec('a', a, { exclusions: ['docs/private.txt'] }), spec('b', b)] });
    for (const [name, patch] of [['privacy-before-probe', { nonSensitive: false }], ['unknown-option', { protected: true }], ['empty-repositories', { repositories: [] }], ['duplicate-id', { repositories: [spec('a', a), spec('a', b)] }], ['relative-root', { repositories: [spec('a', '.')] }], ['url-not-root', { repositories: [spec('a', 'https://invalid.example/')] }], ['private-scope', { repositories: [spec('a', a, { within: ['docs/.env'] })] }], ['invalid-budget', { limits: { maxRepositories: 0 } }], ['unknown-repository-field', { repositories: [{ ...spec('a', a), command: 'echo unsafe' }] }]]) reject(name, () => normalizeSnapshotOptions({ ...input(), ...patch }));
    const missing = build({ repositories: [spec('a', a, { exclusions: ['docs/private.txt'] }), spec('missing', join(base, 'absent'))] }); assert('missing-member-withholds-entire-group', !missing.complete && missing.coverage.openedFiles === 0 && missing.members.every(m => m.observation === null && m.source === null));
    const alias = join(base, 'alias'); fs.symlinkSync(a, alias, 'dir'); const duplicate = build({ repositories: [spec('a', a), spec('alias', alias)] }); assert('duplicate-canonical-root', !duplicate.complete && duplicate.coverage.chargedBytes === 0 && row(duplicate, 'alias').findings.some(f => f.code === 'curia-snapshot/duplicate-canonical-root'));
    const aliasOnly = buildInputSnapshots({ repositories: [spec('alias', alias, { within: ['README.md'] })], nonSensitive: true }); assert('explicit-root-alias-identity', aliasOnly.complete && row(aliasOnly, 'alias').requestedRoot === alias && row(aliasOnly, 'alias').root === a); fs.unlinkSync(alias); fs.symlinkSync(b, alias, 'dir'); assert('root-alias-drift', !revalidateInputSnapshots(aliasOnly));

    const baseline = buildInputSnapshots(scopedInput()), total = baseline.coverage.chargedBytes;
    const budget = buildInputSnapshots({ ...scopedInput(), limits: { maxTotalBytes: total } }); assert('shared-byte-budget', budget.complete && budget.coverage.chargedBytes === total && budget.coverage.plannedBytes === total);
    const tooFew = buildInputSnapshots({ ...scopedInput(), limits: { maxFiles: baseline.coverage.selectedObjects - 1 } }); assert('whole-set-file-limit', !tooFew.complete && tooFew.coverage.openedFiles === 0 && tooFew.members.every(m => m.objectsWithheld && m.objects.length === 0) && tooFew.checks.some(c => c.id === 'curia-snapshot/budget' && c.state === 'fail'));
    const tooSmall = buildInputSnapshots({ ...scopedInput(), limits: { maxTotalBytes: total - 1 } }); assert('whole-set-byte-limit-before-any-body', !tooSmall.complete && tooSmall.coverage.openedFiles === 0 && tooSmall.coverage.chargedBytes === 0);
    const fileLimit = buildInputSnapshots({ ...scopedInput(), limits: { maxFileBytes: 1 } }); assert('per-file-limit-before-any-body', !fileLimit.complete && fileLimit.coverage.openedFiles === 0);
    put(b, 'docs/empty.txt', ''); commit(b, 'docs/empty.txt'); const zeroTail = build({ repositories: [spec('a', a, { within: ['README.md'] }), spec('b', b, { within: ['docs/empty.txt'] })], limits: { maxTotalBytes: fs.statSync(join(a, 'README.md')).size } }); assert('exact-budget-with-zero-byte-final-member', zeroTail.complete && object(zeroTail, 'docs/empty.txt', 'b').bytes === 0);
    const drift = duringRead(join(b, 'docs/a.txt'), () => put(a, 'docs/a.txt', 'LATE_DRIFT\n'), () => buildInputSnapshots(scopedInput())); assert('later-member-revokes-earlier-evidence', !drift.complete && !drift.stable && drift.coverage.chargedBytes > 0 && drift.coverage.capturedObjects === 0 && drift.members.every(m => m.observation === null && m.source === null)); reset(a);
    const fresh = buildInputSnapshots(scopedInput()); put(b, 'docs/a.txt', 'AFTER_EMIT\n'); assert('later-file-drift', !revalidateInputSnapshots(fresh)); reset(b);
    const before = prepareInputSnapshots(scopedInput()); put(b, 'docs/a.txt', 'AFTER_PREPARE\n'); const after = observeInputSnapshots(before); assert('prepared-metadata-is-not-reopened-as-new-input', !after.complete && after.members.every(m => !m.observation)); reset(b);
    put(b, '.agents/doc-types.json', 'INVALID_REGISTRY_PRIVATE_SENTINEL [curia-snapshot/not-a-trusted-error]'); const invalidRegistry = buildInputSnapshots(scopedInput()); assert('invalid-registry-no-raw-error-leak', !invalidRegistry.complete && invalidRegistry.coverage.openedFiles === 0 && !JSON.stringify(invalidRegistry).includes('INVALID_REGISTRY_PRIVATE_SENTINEL')); reset(b);
    const newConfig = prepareInputSnapshots(scopedInput()); put(b, '.agents/doc-types.json', JSON.stringify({ ...config, unexpectedField: true })); assert('configuration-drift-withdraws-group', !observeInputSnapshots(newConfig).complete); reset(b);

    const child = join(a, 'vendor/child'); init(child);
    const nested = build({ repositories: [spec('outer', a, { within: ['README.md'] }), spec('inner', child, { within: ['README.md'] })] }); assert('nested-explicit-repositories', nested.complete && row(nested, 'inner').root === child && row(nested, 'outer').root === a && nested.members.every(m => m.observation.objects.length === 1));
    const overflow = build({ repositories: [spec('outer', a, { within: ['vendor'], includeUntracked: true }), spec('inner', child)] }); assert('nested-scan-cannot-borrow-child-permission', !overflow.complete && overflow.coverage.openedFiles === 0);
    const separated = build({ repositories: [spec('outer', a, { within: ['README.md', 'vendor'], exclusions: ['vendor/child'], includeUntracked: true }), spec('inner', child)] }); assert('nested-explicit-parent-exclusion', separated.complete && row(separated, 'outer').observation.objects.length === 1);
    const noRegistry = join(base, 'no-registry'); fs.mkdirSync(noRegistry); git(noRegistry, 'init', '-q'); put(noRegistry, 'README.md', '# Data\n'); commit(noRegistry, 'README.md'); const notInherited = build({ repositories: [spec('unknown', noRegistry, { within: ['README.md'] })] }); assert('no-neighbor-registry-inheritance', !notInherited.complete && notInherited.coverage.openedFiles === 0);

    assert('rule-contracts-have-negative-fixtures', SNAPSHOT_RULES.length === 5 && SNAPSHOT_RULES.every(r => r.version === 1 && r.required && r.fixtures.negative));
    for (const args of [['--json'], ['--repo', '{}', '--non-sensitive'], ['--help', '--non-sensitive'], ['--json', '--json'], ['--repo', '{"id":"x","id":"y"}', '--non-sensitive'], ['--command', 'echo'], ['--max-files', '0'], ['--repo'], ['--list-checks', '--help']]) reject('cli-reject-' + args.join('-'), () => parseSnapshotArgs(args));
    const run = args => spawnSync(process.execPath, [cli, 'snapshot', ...args], { env, encoding: 'utf8' });
    const args = ['--repo', JSON.stringify(spec('outer', a, { within: ['README.md'] })), '--repo', JSON.stringify(spec('inner', child, { within: ['README.md'] })), '--non-sensitive', '--json'];
    const good = run(args); assert('cli-real-snapshot', good.status === 0 && JSON.parse(good.stdout).complete, good.stderr);
    const inventory = run([...args, '--inventory']); assert('cli-inventory-only', inventory.status === 0 && !JSON.parse(inventory.stdout).complete && JSON.parse(inventory.stdout).mode === 'inventory-only');
    const noPrivacy = run(args.filter(a => a !== '--non-sensitive')); assert('cli-privacy-exit', noPrivacy.status === 2 && noPrivacy.stdout === '');
    const incomplete = run([...args, '--max-files', '1']); assert('cli-incomplete-exit', incomplete.status === 2 && JSON.parse(incomplete.stdout).members.every(m => !m.observation));
    const codeRoot = join(base, 'observer-code'); fs.mkdirSync(codeRoot); for (const { file } of snapshotCodeIdentity()) fs.copyFileSync(join(dirname(cli), file), join(codeRoot, file));
    const direct = extra => spawnSync(process.execPath, [...extra, join(codeRoot, 'curia-snapshots.mjs'), ...args], { env, encoding: 'utf8' });
    const loadable = direct([]); assert('copied-observer-positive-control', loadable.status === 0 && JSON.parse(loadable.stdout).complete, loadable.stderr);
    const preload = join(base, 'drift-observer.mjs'), target = join(codeRoot, 'curia-impact.mjs'), ino = fs.statSync(join(child, 'README.md')).ino;
    fs.writeFileSync(preload, `import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';const native=fs.readSync;let fired=false;fs.readSync=function(fd,...args){const n=native.call(fs,fd,...args);if(!fired&&n&&fs.fstatSync(fd).ino===${ino}){fired=true;fs.appendFileSync(${JSON.stringify(target)},'\\n// controlled code drift\\n');}return n;};syncBuiltinESMExports();`);
    const codeDrift = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(preload).href)});const {snapshotsMain}=await import(${JSON.stringify(pathToFileURL(join(codeRoot, 'curia-snapshots.mjs')).href)});snapshotsMain(${JSON.stringify(args)});`], { env, encoding: 'utf8' }); assert('observer-code-drift-withdraws-group', codeDrift.status === 2 && JSON.parse(codeDrift.stdout).members.every(m => !m.observation), codeDrift.stderr);
    fs.copyFileSync(join(dirname(cli), 'curia-impact.mjs'), target); fs.appendFileSync(target, '\n/*'+ 'x'.repeat(1024 * 1024) +'*/');
    const tooLargeCode = direct([]); assert('no-code-prefix-identity', tooLargeCode.status === 2 && tooLargeCode.stderr.includes('[curia-snapshot/code-identity]') && tooLargeCode.stdout === '', tooLargeCode.stderr);
    const help = run(['--help']); assert('cli-help-does-not-capture', help.status === 0 && help.stdout.includes('not atomic'));
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
}
if (isMainModule(import.meta.url)) {
  let passed = 0; const failed = []; snapshotFixtures({ registry: JSON.parse(fs.readFileSync(join(ROOT, '.agents/doc-types.json'))), expectTrue: (name, ok, detail) => { if (ok) passed++; else failed.push({ name, detail }); } }); console.log(JSON.stringify({ passed, failed }, null, 2)); if (failed.length) process.exitCode = 1;
}
