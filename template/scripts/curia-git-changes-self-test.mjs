/** Disposable, zero-dependency Git fixtures. No application runtime, network or shared-index writes. */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { ROOT, isMainModule } from './doc-lib.mjs';
import { buildImpactWorkflow, buildChangeReadWorkflow, parseImpactArgs, GIT_IMPACT_RULES, CHANGE_READ_RULES } from './curia-workflow.mjs';
import { prepareGitChangeSelection, observeGitChanges, revalidateGitChanges, normalizeGitChangeLimits, buildImpactInventory, revalidateReadInventory } from './curia-query.mjs';

export function gitChangeFixtures({ expectTrue, registry }) {
  changeReadFixtures({ expectTrue, registry });
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'curia-git-changes-'))), cli = fileURLToPath(new URL('./curia-workflow.mjs', import.meta.url));
  const env = { ...process.env }; for (const key of Object.keys(env)) if (key.startsWith('GIT_') || ['CURIA_ROOT', 'CURIA_STAGED', 'CURIA_ROOT', 'CURIA_STAGED'].includes(key)) delete env[key];
  const git = (...args) => execFileSync('git', args, { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
  const put = (path, value) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), value); };
  const remove = path => rmSync(join(root, path), { recursive: true, force: true });
  const assert = (name, ok, detail = '') => expectTrue(`Curia Git changes [${name}]`, ok, detail);
  const reject = (name, fn) => { let error; try { fn(); } catch (e) { error = e; } assert(name, !!error, error?.message ?? '未拒绝'); };
  const code = 'packages/contracts/api.txt', doc = 'docs/manuals/api.md', raw = 'ORIGINAL_CODE_PAYLOAD touch NEVER_EXECUTED\n';
  const reg = structuredClone(registry); delete reg.instance;
  reg.instance = { schema: 'curia.instance/1', owner: 'fixture', surfaces: [
    { id: 'control', kind: 'root', members: [{ path: '.agents', kind: 'directory', role: 'control' }], entry: '.agents/README.md', authorityLinks: ['AGENTS.md'] },
    { id: 'knowledge', kind: 'root', members: [{ path: 'docs', kind: 'directory', role: 'knowledge' }], entry: 'docs/README.md', authorityLinks: ['AGENTS.md'] },
  ], mappings: [{ path: 'docs/manuals', kind: 'directory', relations: { schema: 'curia.relations/1', parser: 'markdown-header-relations/1' } }] };
  const options = { gitBase: 'HEAD', changesWithin: ['packages/contracts'], within: ['docs/manuals'], nonSensitive: true };
  const select = extra => prepareGitChangeSelection(root, { base: 'HEAD', within: ['packages/contracts'], nonSensitive: true, ...extra });
  const observe = extra => observeGitChanges(select(extra));
  const plan = extra => buildImpactWorkflow(root, { ...options, ...extra });
  const reset = () => { git('reset', '--hard', 'HEAD'); git('clean', '-fdx'); };
  const one = result => result.objects.find(item => item.path === code);
  const gap = (result, name) => result.findings.some(f => f.code === `git-change/${name}`);
  const runCli = args => spawnSync(process.execPath, [cli, 'impact', '--root', root, ...args], { cwd: root, env, encoding: 'utf8' });
  const gitArgs = ['--git-base', 'HEAD', '--changes-within', 'packages/contracts', '--within', 'docs/manuals', '--non-sensitive', '--strict', '--json'];
  try {
    git('init', '-q'); git('config', 'user.name', 'fixture'); git('config', 'user.email', 'fixture@example.invalid'); git('config', 'core.autocrlf', 'false');
    put('AGENTS.md', '# Fixture\n'); put('.agents/README.md', '# Control\n'); put('docs/README.md', '# Knowledge\n'); put('.agents/doc-types.json', JSON.stringify(reg));
    put(code, raw); put(doc, '# API\n\nStatus: current\nOwner: fixture\nNormative-refs: [contract](../../packages/contracts/api.txt)\n\nDOC_PAYLOAD\n');
    git('add', '--', 'AGENTS.md', '.agents/README.md', '.agents/doc-types.json', 'docs/README.md', doc, code); git('commit', '-qm', 'fixture');
    const indexBefore = readFileSync(join(root, '.git/index'));
    let result = observe();
    assert('raw-clean', result.complete && !result.changed.length && one(result).staged === 'unchanged' && one(result).worktreeChange === 'unchanged');
    assert('raw-digest-identity', one(result).digest.value.length === 64 && one(result).rawWorktree.oid === git('rev-parse', `HEAD:${code}`));
    assert('index-never-written', indexBefore.equals(readFileSync(join(root, '.git/index'))));
    let report = plan(); assert('no-changes-scoped-not-full-graph', report.complete && report.outcome === 'no-changes-within-scope' && report.impact === null && report.coverage.inspected === 0);
    put(code, 'WORKTREE_CHANGED\n'); result = observe();
    assert('unstaged-change', result.complete && one(result).staged === 'unchanged' && one(result).worktreeChange === 'content' && result.changed[0] === code);
    report = plan(); assert('git-impact-chain', report.complete && report.impact.reviewPaths.includes(doc) && report.impact.affected.find(item => item.path === code).basis === 'observed-local-git-and-raw-worktree', JSON.stringify(report.unresolved));
    assert('no-raw-bodies-emitted', !JSON.stringify(report).includes('WORKTREE_CHANGED') && !JSON.stringify(report).includes('DOC_PAYLOAD') && report.changeObservation.openedFiles === 1);
    git('add', '--', code); result = observe(); assert('staged-change', one(result).staged === 'content' && one(result).worktreeChange === 'unchanged');
    put(code, raw); result = observe(); assert('staged-worktree-cancellation', result.changed[0] === code && one(result).staged === 'content' && one(result).worktreeChange === 'content');
    reset(); remove(code); result = observe(); assert('unstaged-deletion', result.complete && one(result).staged === 'unchanged' && one(result).worktreeChange === 'deleted' && one(result).digest === null && result.openedFiles === 0);
    report = plan(); assert('deleted-code-still-impacts-docs', report.complete && report.impact.reviewPaths.includes(doc));
    remove('packages'); result = observe(); assert('removed-directory-safe-ancestor', result.complete && one(result).worktreeChange === 'deleted');
    git('add', '--', code); result = observe(); assert('staged-deletion', result.complete && one(result).staged === 'deleted' && one(result).worktreeChange === 'unchanged');
    put(code, 'UNTRACKED_RECREATION\n'); result = observe(); assert('staged-deletion-untracked-not-read', result.complete && result.changed.includes(code) && one(result).worktreeChange === 'not-observed-untracked' && !one(result).digest && result.openedFiles === 0);
    result = observe({ includeUntracked: true }); assert('staged-deletion-untracked-opt-in', result.complete && one(result).worktreeChange === 'added' && result.openedFiles === 1);
    reset(); put('packages/contracts/new.txt', 'NEW\n'); result = observe(); assert('untracked-default-excluded', result.complete && !result.changed.length && result.objects.length === 1);
    result = observe({ includeUntracked: true }); assert('untracked-opt-in', result.complete && result.changed.includes('packages/contracts/new.txt') && result.objects.some(item => item.discoveredUntracked));
    git('add', '--', 'packages/contracts/new.txt'); result = observe(); assert('staged-addition', result.complete && result.objects.some(item => item.path.endsWith('new.txt') && item.staged === 'added'));
    reset(); renameSync(join(root, code), join(root, 'packages/contracts/new.txt')); git('add', '--', code, 'packages/contracts/new.txt'); result = observe();
    assert('rename-is-two-names', result.complete && result.changed.length === 2 && result.changed.includes(code) && result.renameDetection === 'none-old-and-new-names');
    reset(); chmodSync(join(root, code), 0o755); result = observe(); assert('worktree-mode-change', result.complete && one(result).worktreeChange === 'mode');
    git('update-index', '--chmod=+x', code); result = observe(); assert('staged-mode-change', one(result).staged === 'mode' && one(result).worktreeChange === 'unchanged');
    reset(); git('update-index', '--assume-unchanged', code); put(code, 'ASSUME_CHANGED\n'); result = observe(); assert('assume-unchanged-does-not-hide-raw', result.changed.includes(code)); git('update-index', '--no-assume-unchanged', code);
    reset(); git('update-index', '--skip-worktree', code); put(code, 'SKIP_CHANGED\n'); result = observe(); assert('skip-worktree-does-not-hide-raw', result.changed.includes(code)); git('update-index', '--no-skip-worktree', code);
    reset(); put('packages/contracts/private/key.txt', 'PRIVATE_BODY'); put('packages/contracts/secret.txt', 'EXCLUDED_BODY'); put('packages/contracts/ignored.txt', 'IGNORED_BODY'); put('.gitignore', 'packages/contracts/ignored.txt\n');
    git('add', '-f', '--', 'packages/contracts/private/key.txt', 'packages/contracts/ignored.txt', 'packages/contracts/secret.txt');
    result = observe({ exclusions: ['packages/contracts/secret.txt'] });
    assert('private-ignored-excluded-before-body', result.complete && !result.changed.length && result.openedFiles === 1 && result.omitted.privacy === 2 && result.omitted.ignored === 1 && !JSON.stringify(result).includes('private/key.txt'));
    const ignoredCap = select({ exclusions: ['packages/contracts/secret.txt'] }); put('.gitignore', ''); result = observeGitChanges(ignoredCap); assert('ignored-set-drift', !result.complete && !result.openedFiles);
    reset(); put('packages/contracts/archive/file.txt', 'RAW_BODY'); put(`packages/contracts/archive/${reg.rawMarker}`, 'raw\n'); git('add', '--', 'packages/contracts/archive/file.txt');
    result = observe(); assert('raw-zone-excluded', result.complete && result.omitted.raw === 1 && result.openedFiles === 1);
    const rawCap = select(); remove(`packages/contracts/archive/${reg.rawMarker}`); result = observeGitChanges(rawCap); assert('raw-exclusion-drift', !result.complete && !result.openedFiles);
    reset(); put(code, 'x'.repeat(300)); result = observeGitChanges(select(), { maxFileBytes: 32 }); assert('byte-limit-preflight', !result.complete && gap(result, 'byte-or-file-limit') && !result.openedFiles && !result.changed.length);
    result = observeGitChanges(select(), { maxTotalBytes: 32 }); assert('total-byte-limit-preflight', !result.complete && !result.openedFiles);
    put('packages/contracts/extra.txt', 'extra'); git('add', '--', 'packages/contracts/extra.txt'); result = observeGitChanges(select(), { maxFiles: 1 }); assert('file-limit-preflight', !result.complete && !result.openedFiles);
    reset(); result = observe({ within: ['missing'] }); assert('typo-not-clean', !result.complete && gap(result, 'scope-unmatched'));
    reject('privacy-before-io', () => prepareGitChangeSelection('/not-a-real-root', { base: 'HEAD', within: ['docs/private'], nonSensitive: true }));
    reject('non-sensitive-required-before-io', () => prepareGitChangeSelection('/not-a-real-root', { base: 'HEAD', within: ['docs'] }));
    for (const base of ['HEAD~1', '--help', 'HEAD:foo', 'HEAD@{1}', 'HEAD^{tree}', '../head', '', 'HEAD\n']) reject(`invalid-base-${JSON.stringify(base)}`, () => select({ base }));
    reject('unknown-local-base', () => select({ base: 'no-such-branch' }));
    reject('abbreviated-oid-rejected', () => select({ base: git('rev-parse', '--short', 'HEAD') }));
    assert('full-oid-baseline', observe({ base: git('rev-parse', 'HEAD') }).complete);
    git('tag', '-a', 'release-base', '-m', 'fixture'); assert('annotated-tag-baseline', observe({ base: 'release-base' }).complete);
    reject('tag-object-id-not-commit-id', () => select({ base: git('rev-parse', 'release-base') }));
    for (const limits of [{ maxFiles: 0 }, { maxFiles: 2049 }, { maxFileBytes: 536870913 }, { maxTotalBytes: 1073741825 }, { command: 'x' }]) reject(`bad-budget-${JSON.stringify(limits)}`, () => normalizeGitChangeLimits(limits));
    reject('serialized-selection-not-capability', () => observeGitChanges(JSON.parse(JSON.stringify(select()))));
    const mutable = select(); mutable.objects = []; mutable.selection.paths.push('secrets'); result = observeGitChanges(mutable); assert('public-selection-does-not-widen', result.complete && result.objects.length === 1 && result.selection.paths.length === 1);
    reject('serialized-observation-not-capability', () => revalidateGitChanges(JSON.parse(JSON.stringify(result))));
    result.changed.push('fake'); assert('mutated-observation-rejected', !revalidateGitChanges(result));
    const cap = select(); put(code, 'DRIFT\n'); result = observeGitChanges(cap); assert('before-read-drift', !result.complete && !result.openedFiles && !result.objects.length);
    reset(); result = observe(); put(code, 'AFTER_DRIFT'); assert('after-read-drift', !revalidateGitChanges(result));
    reset(); const regCap = select(); put('.agents/doc-types.json', JSON.stringify(reg) + '\n'); result = observeGitChanges(regCap); assert('registry-drift', !result.complete && !result.openedFiles);
    reset(); const idxCap = select(); put(code, 'INDEX_DRIFT'); git('add', '--', code); result = observeGitChanges(idxCap); assert('index-drift', !result.complete && !result.openedFiles);
    reset(); const untrackedCap = select({ includeUntracked: true }); put('packages/contracts/late.txt', 'late'); result = observeGitChanges(untrackedCap); assert('untracked-set-drift', !result.complete && !result.openedFiles);
    reset(); remove(code); const missingCap = select(); put(code, raw); result = observeGitChanges(missingCap); assert('missing-file-reappears', !result.complete && !result.openedFiles);
    reset(); put(code, 'FOR_PLAN'); report = plan({ now: () => { put(code, 'CROSS_PHASE_DRIFT'); return new Date().toISOString(); } });
    assert('cross-phase-drift', !report.complete && report.impact === null && !report.sourceRefs.length && !report.changeObservation.complete && !report.changeObservation.objects.length && !report.scope.changed.length);
    reset(); const paired = observe(); const inv = buildImpactInventory(root, { paths: ['docs/manuals'] }, { changed: [code], nonSensitive: true }); assert('joint-snapshot-valid', revalidateGitChanges(paired, inv)); put(doc, 'DOC_CHANGED'); assert('joint-relation-drift', !revalidateGitChanges(paired, inv));
    reset(); remove(code); symlinkSync('../elsewhere', join(root, code)); result = observe(); assert('symlink-not-opened', !result.complete && !result.openedFiles);
    reset(); put('other.txt', raw); remove(code); linkSync(join(root, 'other.txt'), join(root, code)); result = observe(); assert('hardlink-not-opened', !result.complete && !result.openedFiles);
    reset(); put('packages/contracts/.git', 'gitdir: nowhere\n'); result = observe(); assert('nested-repository-not-opened', !result.complete && !result.openedFiles); remove('packages/contracts/.git');
    reset(); const oid = git('rev-parse', `HEAD:${code}`); execFileSync('git', ['update-index', '--index-info'], { cwd: root, env, input: `0 ${'0'.repeat(40)}\t${code}\n100644 ${oid} 2\t${code}\n`, stdio: ['pipe', 'pipe', 'pipe'] });
    result = observe(); assert('conflict-index-not-opened', !result.complete && !result.openedFiles); reset();
    // Real malicious local config: an ordinary worktree diff can invoke these, this path must not.
    put('driver.sh', '#!/bin/sh\nprintf executed >> "$PWD/DRIVER_EXECUTED"\ncat\n'); chmodSync(join(root, 'driver.sh'), 0o755);
    git('config', 'filter.hostile.clean', './driver.sh'); git('config', 'filter.hostile.smudge', './driver.sh'); git('config', 'diff.hostile.command', './driver.sh'); git('config', 'diff.hostile.textconv', './driver.sh'); git('config', 'core.fsmonitor', './driver.sh');
    put('.gitattributes', 'packages/contracts/* filter=hostile diff=hostile\n'); put(code, 'HOSTILE_ATTRIBUTES_CHANGED'); report = plan();
    assert('malicious-drivers-not-executed', report.complete && !existsSync(join(root, 'DRIVER_EXECUTED')) && !existsSync(join(root, 'NEVER_EXECUTED')), JSON.stringify({ complete: report.complete, unresolved: report.unresolved, executed: existsSync(join(root, 'DRIVER_EXECUTED')) }));
    const hostileCli = runCli(gitArgs); assert('cli-malicious-drivers-not-executed', hostileCli.status === 0 && !existsSync(join(root, 'DRIVER_EXECUTED')), `${hostileCli.status}: ${hostileCli.stderr}`);
    git('-c', 'core.fsmonitor=false', 'diff', '--no-ext-diff', '--no-textconv', '--name-only', '--', code);
    assert('filter-trap-positive-control', existsSync(join(root, 'DRIVER_EXECUTED'))); remove('DRIVER_EXECUTED');
    put(code, raw); utimesSync(join(root, code), new Date('2020-01-02T00:00:00.000Z'), new Date('2020-01-02T00:00:00.000Z'));
    git('-c', 'core.fsmonitor=false', 'add', '--', code);
    put(code, raw.replace('ORIGINAL', 'MODIFIED')); utimesSync(join(root, code), new Date('2020-01-02T00:00:00.000Z'), new Date('2020-01-02T00:00:00.000Z'));
    utimesSync(join(root, '.git/index'), new Date('2020-01-01T00:00:00.000Z'), new Date('2020-01-01T00:00:00.000Z')); git('config', 'core.trustctime', 'false'); remove('DRIVER_EXECUTED');
    report = plan(); assert('racy-index-safe-observer', report.complete && !existsSync(join(root, 'DRIVER_EXECUTED')));
    git('-c', 'core.fsmonitor=false', 'diff-files', '--no-ext-diff', '--name-only', '--', code);
    assert('racy-diff-files-trap-positive-control', existsSync(join(root, 'DRIVER_EXECUTED'))); remove('DRIVER_EXECUTED');
    for (const key of ['filter.hostile.clean', 'filter.hostile.smudge', 'diff.hostile.command', 'diff.hostile.textconv', 'core.fsmonitor', 'core.trustctime']) git('config', '--unset', key);
    remove('.gitattributes'); reset(); put(code, raw.replaceAll('\n', '\r\n')); git('config', 'core.autocrlf', 'true'); result = observe(); assert('raw-not-eol-normalized', result.changed.includes(code) && result.normalization === 'none-not-git-status-equivalence'); git('config', 'core.autocrlf', 'false'); reset();
    let c = runCli(gitArgs); assert('cli-no-changes', c.status === 0 && JSON.parse(c.stdout).outcome === 'no-changes-within-scope');
    put(code, 'CLI_CHANGED'); c = runCli(gitArgs); assert('cli-impact', c.status === 0 && JSON.parse(c.stdout).impact.reviewPaths.includes(doc));
    c = runCli([...gitArgs, '--inventory']); report = JSON.parse(c.stdout); assert('cli-inventory-no-body', c.status === 1 && report.changeInventory && !report.changeObservation && report.coverage.chargedBytes === 0);
    c = runCli([...gitArgs, '--max-change-file-bytes', '1']); assert('cli-incomplete-exit-one', c.status === 1 && !JSON.parse(c.stdout).complete);
    for (const args of [[...gitArgs, '--changed', code], ['--git-base', 'HEAD', '--within', 'docs', '--non-sensitive'], ['--changed', code, '--within', 'docs', '--non-sensitive', '--changes-within', 'packages'], [...gitArgs, '--git-base', 'HEAD'], [...gitArgs, '--max-change-files', '0'], [...gitArgs, '--at', 'nonsense']]) assert(`cli-invalid-${args.join('/')}`, runCli(args).status === 2);
    c = spawnSync(process.execPath, [cli, 'impact', '--list-checks', '--git-base', 'HEAD', '--json'], { cwd: root, env, encoding: 'utf8' }); assert('git-rules-separate', c.status === 0 && JSON.parse(c.stdout).length === GIT_IMPACT_RULES.length, `${c.status}: ${c.stderr}`);
    assert('cli-separate-budgets', parseImpactArgs([...gitArgs, '--max-change-files', '50', '--max-files', '3']).options.changeLimits.maxFiles === 50);
    reset(); git('branch', 'baseline'); git('commit', '--allow-empty', '-qm', 'second'); const refCap = select({ base: 'baseline' }); git('update-ref', 'refs/heads/baseline', 'HEAD'); result = observeGitChanges(refCap); assert('non-head-base-ref-drift', !result.complete && !result.openedFiles);
    reset(); for (let i = 0; i < 2049; i++) put(`packages/contracts/overflow-${i}.txt`, 'x'); result = observe({ includeUntracked: true }); assert('metadata-source-hard-limit', !result.complete && gap(result, 'source-limit') && !result.openedFiles); reset();
    for (let i = 0; i < 129; i++) put(`packages/contracts/many-${i}.txt`, 'x'); result = observe({ includeUntracked: true }); assert('change-hard-limit', !result.complete && gap(result, 'change-limit') && !result.changed.length && !result.objects.length); reset();
    // An undecodable Git name cannot become a replacement-character deletion proof.
    const invalidRecord = Buffer.concat([Buffer.from(`100644 ${git('rev-parse', `HEAD:${code}`)}\tpackages/contracts/`), Buffer.from([0xff]), Buffer.from('.txt\n')]);
    execFileSync('git', ['update-index', '--index-info'], { cwd: root, env, input: invalidRecord, stdio: ['pipe', 'pipe', 'pipe'] });
    reject('invalid-utf8-git-name', () => select()); git('reset', '--mixed', 'HEAD');
    const shaRoot = join(root, 'sha256'); mkdirSync(shaRoot); execFileSync('git', ['init', '-q', '--object-format=sha256'], { cwd: shaRoot, env });
    const shaGit = (...args) => execFileSync('git', args, { cwd: shaRoot, env, stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
    shaGit('config', 'user.name', 'fixture'); shaGit('config', 'user.email', 'fixture@example.invalid'); put('sha256/.agents/doc-types.json', JSON.stringify(reg)); put('sha256/packages/contracts/api.txt', raw);
    shaGit('add', '--', '.agents/doc-types.json', code); shaGit('commit', '-qm', 'sha256 fixture');
    result = observeGitChanges(prepareGitChangeSelection(shaRoot, { base: 'HEAD', within: ['packages/contracts'], nonSensitive: true })); assert('sha256-raw-oid', result.complete && !result.changed.length && result.base.algorithm === 'sha256' && one(result).rawWorktree.oid === shaGit('rev-parse', `HEAD:${code}`));
  } finally { rmSync(root, { recursive: true, force: true }); }
}

function changeReadFixtures({ expectTrue, registry }) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'curia-change-read-'))), cli = fileURLToPath(new URL('./curia-workflow.mjs', import.meta.url));
  const env = { ...process.env }; for (const key of Object.keys(env)) if (key.startsWith('GIT_') || ['CURIA_ROOT', 'CURIA_STAGED', 'CURIA_ROOT', 'CURIA_STAGED', 'NODE_OPTIONS'].includes(key)) delete env[key];
  let gitFailed = false;
  const git = (...args) => { try { return execFileSync('git', args, { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim(); } catch (e) { gitFailed = true; throw e; } };
  const put = (p, value) => { mkdirSync(dirname(join(root, p)), { recursive: true }); writeFileSync(join(root, p), value); };
  const code = 'packages/api.txt', a = 'docs/items/a.md', b = 'docs/items/b.md', c = 'docs/items/c.md', regPath = '.agents/doc-types.json';
  const reg = structuredClone(registry); delete reg.instance;
  reg.instance = { schema: 'curia.instance/1', owner: 'fixture', surfaces: [
    { id: 'control', kind: 'root', members: [{ path: '.agents', kind: 'directory', role: 'control' }], entry: '.agents/README.md', authorityLinks: ['AGENTS.md'] },
    { id: 'knowledge', kind: 'root', members: [{ path: 'docs', kind: 'directory', role: 'knowledge' }], entry: 'docs/README.md', authorityLinks: ['AGENTS.md'] },
  ], mappings: [{ path: 'docs/items', kind: 'directory', relations: { schema: 'curia.relations/1', parser: 'markdown-header-relations/1' } }] };
  const text = (body, ref) => `# Fixture\n\nStatus: current\nOwner: fixture\n${ref ? `Normative-refs: [source](${ref})\n` : ''}\n${body}\n`;
  const options = { gitBase: 'HEAD', changesWithin: ['packages'], within: ['docs/items'], nonSensitive: true };
  const read = (extra = {}) => buildChangeReadWorkflow(root, { ...options, ...extra });
  const assert = (name, ok, detail = '') => expectTrue(`Curia change reading [${name}]`, !!ok, detail);
  const observe = (fn, mutate = null) => {
    const opened = [], old = fs.openSync; fs.openSync = (...args) => { const path = String(args[0]); opened.push(path); mutate?.(path, opened); return old(...args); }; syncBuiltinESMExports();
    try { let result, error; try { result = fn(); } catch (e) { error = e; } return { result, error, opened }; }
    finally { fs.openSync = old; syncBuiltinESMExports(); }
  };
  let baseline;
  const reset = () => { git('reset', '--hard', baseline); git('clean', '-fdx'); };
  const changed = () => put(code, 'CHANGED_CODE_NOT_CONTEXT\n');
  try {
    put('AGENTS.md', '# Fixture\n'); put('.agents/README.md', '# Control\n'); put('docs/README.md', '# Docs\n'); put(regPath, JSON.stringify(reg)); put(code, 'ORIGINAL\n');
    put(a, text('BODY_A', '../../packages/api.txt')); put(b, text('BODY_B', './a.md')); put(c, text('UNRELATED_BODY_C'));
    git('init', '-q'); git('config', 'user.name', 'fixture'); git('config', 'user.email', 'fixture@local'); git('add', '--', 'AGENTS.md', '.agents', 'docs', 'packages'); git('-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'change read fixture'); baseline = git('rev-parse', 'HEAD');
    const beforeIndex = readFileSync(join(root, '.git/index')), clean = observe(() => read());
    assert('no-changes-is-not-full-corpus-read', !clean.error && clean.result.complete && clean.result.outcome === 'no-changes-within-scope' && clean.result.documents.length === 0 && !clean.opened.includes(join(root, a)), clean.error?.message);
    assert('shared-index-not-written', beforeIndex.equals(readFileSync(join(root, '.git/index'))));
    changed(); let seen = observe(() => read()), report = seen.result;
    assert('change-read-selected', !seen.error && report.complete && report.outcome === 'read-complete' && JSON.stringify(report.documents.map(d => d.path)) === JSON.stringify([a, b]), seen.error?.message ?? JSON.stringify(report?.unresolved));
    assert('only-affected-bodies-emitted', report.documents[0]?.text.includes('BODY_A') && report.documents[1]?.text.includes('BODY_B') && !JSON.stringify(report).includes('UNRELATED_BODY_C') && !JSON.stringify(report).includes('CHANGED_CODE_NOT_CONTEXT'));
    assert('unrelated-source-scanned-not-reread-for-context', seen.opened.filter(p => p === join(root, c)).length === 1 && seen.opened.filter(p => p === join(root, a)).length === 2 && report.coverage.openedFiles === 5);
    assert('joint-budget-and-no-duplicate-body', report.coverage.chargedBytes === report.coverage.relationBytes + report.coverage.contentBytes && !Object.hasOwn(report.reading, 'documents') && report.coverage.factVerified === 0 && report.execution.persisted === false);
    assert('rules-and-no-global-claim', report.checks.every(check => check.state === 'pass') && report.scope.globalCoverage === false && CHANGE_READ_RULES.every(rule => rule.version === 1 && rule.fixtures.file.endsWith('curia-git-changes-self-test.mjs')));
    const cliArgs = ['read-changes', '--root', root, '--git-base', 'HEAD', '--changes-within', 'packages', '--within', 'docs/items', '--non-sensitive', '--strict', '--json'];
    const run = args => spawnSync(process.execPath, [cli, ...args], { cwd: root, env, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
    let result = run(cliArgs); assert('real-cli-change-read', result.status === 0 && JSON.parse(result.stdout).documents.length === 2, result.stderr);
    result = run(['read-changes', '--help']); assert('real-cli-help', result.status === 0 && result.stdout.includes('--max-change-'));
    result = run(['read-changes', '--list-checks', '--json']); assert('real-cli-rule-catalog', result.status === 0 && JSON.parse(result.stdout).length === CHANGE_READ_RULES.length);
    const inventory = observe(() => read({ inventoryOnly: true })); assert('inventory-opens-no-change-or-relation-bodies', inventory.result.outcome === 'inventoried-not-read' && ![code,a,b,c].some(p => inventory.opened.includes(join(root,p))));
    const emptyInventory = read({ inventoryOnly:true, changesWithin:['missing-source'] }); assert('invalid-inventory-not-success',emptyInventory.outcome==='blocked'&&emptyInventory.checks.some(c=>c.state==='fail'));
    result=run(cliArgs.map(x=>x==='packages'?'missing-source':x).concat('--inventory')); assert('strict-invalid-inventory-nonzero',result.status===1&&JSON.parse(result.stdout).outcome==='blocked');
    report = read({ limits: { maxFiles: 4 } }); assert('change-read-budget', !report.complete && report.outcome === 'partial' && report.coverage.openedFiles <= 4 && report.coverage.contentRead === 1);
    report = read({ limits: { maxFiles: 3 } }); assert('exhausted-relation-budget-does-not-reset-for-content', !report.complete && report.documents.length === 0 && report.unresolved.some(f => f.code === 'change-read/content-budget-exhausted'));
    const relationBytes = [a,b,c].reduce((sum,p) => sum+readFileSync(join(root,p)).length,0);
    report = read({ limits: { maxTotalBytes: relationBytes + 10 } }); assert('shared-byte-budget', !report.complete && report.coverage.chargedBytes <= relationBytes+10 && report.coverage.contentBytes <= 10);
    result = run([...cliArgs, '--max-files', '3']); assert('strict-partial-nonzero', result.status === 1 && JSON.parse(result.stdout).outcome === 'partial');
    for (const extra of [{ nonSensitive:false }, { gitBase:undefined }, { configuration:'only' }, { changed:[code] }, { protected:true }, { command:'touch MUST_NOT_RUN' }, { exclusions:['packages'] }]) {
      const bad = observe(() => read(extra)); assert('invalid-options-no-body-'+JSON.stringify(extra), !!bad.error && ![code,a,b,c].some(p => bad.opened.includes(join(root,p))));
    }
    const forged = observe(() => revalidateReadInventory(JSON.parse(JSON.stringify({})))); assert('revalidation-requires-live-inventory', forged.error?.message.includes('read-snapshot-required'));
    reset(); changed(); git('add','--',code); put(code,'ORIGINAL\n'); report=read(); assert('staged-cancellation-still-reads-impact',report.complete&&report.documents.length===2);
    reset(); rmSync(join(root,code)); report=read(); assert('deleted-source-still-reads-current-references',report.complete&&report.documents.length===2&&!report.documents.some(d=>d.path===code));
    reset(); put(a,text('DIRECT_CHANGE','../../packages/api.txt')); report=read({changesWithin:[a]}); assert('unchanged-outside-reference-remains-gap',!report.complete&&report.documents.length===2&&report.unresolved.length>0);
    put(a,text('DIRECT_CHANGE')); report=read({changesWithin:[a]}); assert('direct-document-and-incoming-reference',report.complete&&report.documents.length===2);
    reset(); put(c,text('ONLY_UNRELATED_CHANGED')); report=read({changesWithin:[c],within:[c]}); assert('only-direct-leaf-read',report.complete&&report.documents.length===1&&report.documents[0].path===c);
    reset(); changed(); const unmapped=structuredClone(reg);unmapped.instance.mappings=[];put(regPath,JSON.stringify(unmapped)); report=read({changesWithin:['packages',a]}); assert('change-read-unmapped',!report.complete&&report.outcome==='partial'&&report.planning.unresolved.length>0);
    put(a,text('CHANGED_UNMAPPED')); report=read({changesWithin:[a]}); assert('unmapped-direct-body-with-incomplete-impact',!report.complete&&report.documents.some(d=>d.path===a&&d.text?.includes('CHANGED_UNMAPPED')));
    reset(); changed(); report=read({exclusions:[b]}); assert('excluded-reference-not-emitted',!report.documents.some(d=>d.path===b));
    reset(); changed(); symlinkSync(join(root,a),join(root,'docs/items/alias.md')); git('add','--','docs/items/alias.md'); seen=observe(()=>read()); assert('symlink-blocks-without-following',!seen.result?.complete&&!seen.opened.includes(join(root,'docs/items/alias.md')));
    for (const [name, mutate] of [
      ['source',()=>put(code,'DRIFTED_CODE\n')],['unrelated-relation',()=>put(c,text('DRIFTED_C'))],['registry',()=>put(regPath,JSON.stringify({...reg,comment:'drift'}))],['index',()=>git('add','--',code)],['selected-document',()=>put(b,text('DRIFTED_B'))],
    ]) {
      reset();changed();let fired=false;
      const result=observe(()=>read(),(path,opened)=>{if(!fired&&path===join(root,a)&&opened.filter(p=>p===path).length===2){fired=true;mutate();}});
      assert('change-read-cross-phase-drift-'+name,fired&&!result.error&&result.result.outcome==='blocked'&&result.result.documents.length===0&&result.result.planning===null&&result.result.reading===null,result.error?.message??JSON.stringify(result.result?.unresolved));
    }
    reset(); changed(); const guarded=structuredClone(reg); guarded.instance.guards={never:{schema:'curia.guard/1',owner:'fixture',authorityLinks:['AGENTS.md'],activation:'explicit',onEmpty:'fail',command:{program:'node',script:'checks/never.mjs',args:[],cwd:'.',identityPaths:['checks/never.mjs']},inputScope:{mode:'git',paths:['docs/items'],exclusions:[],includeUntracked:false,includeIgnored:false},effects:{write:false,network:false,externalSystems:false,sensitiveRead:false},privacy:{sensitivePaths:[a],output:'discard',args:'non-sensitive-static'},environment:[],expectedExitCodes:[0],parser:{id:'aggregate-exit/1',ruleIds:[]},limits:{timeoutMs:2000,killGraceMs:50,maxOutputBytes:16384,maxFiles:32,maxFileBytes:1048576,maxTotalBytes:2097152,cpuMs:null,memoryBytes:null,maxProcesses:null}}};
    put(regPath,JSON.stringify(guarded));put('checks/never.mjs','throw Error("MUST_NOT_EXECUTE");\n');seen=observe(()=>read({configuration:'include'}));
    assert('change-read-private',!seen.error&&!seen.result.complete&&!seen.opened.includes(join(root,a))&&!JSON.stringify(seen.result).includes('BODY_A'),seen.error?.message);
    assert('guard-never-opened-or-executed',!seen.opened.includes(join(root,'checks/never.mjs'))&&!JSON.stringify(seen.result ?? null).includes('MUST_NOT_EXECUTE'));
    reset(); assert('fixture-reset',git('rev-parse','HEAD')===baseline&&git('status','--porcelain')==='');
  } finally { if(gitFailed) console.error(`change-read Git fixture retained: ${root}`); else rmSync(root,{recursive:true,force:true}); }
}

if (isMainModule(import.meta.url)) {
  let passed = 0; const failures = [];
  gitChangeFixtures({ registry: JSON.parse(readFileSync(join(ROOT, '.agents/doc-types.json'), 'utf8')), expectTrue: (name, ok, detail = '') => ok ? passed++ : failures.push(`${name}: ${detail}`) });
  console.log(JSON.stringify({ passed, failed: failures.length, failures }, null, 2)); if (failures.length) process.exitCode = 1;
}
