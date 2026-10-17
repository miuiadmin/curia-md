/** Disposable documentation fixtures: revalidation constrains reads before following changed declarations. */
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { ROOT, isMainModule } from './doc-lib.mjs';
import { GUARD_RUN_SCHEMA } from './curia-guard-contract.mjs';
import { buildGuardPlan, reobserveGuardPlan, runGuard } from './curia-guards.mjs';
import { buildCheckPlan, runChecks } from './curia-checks.mjs';
import { beginGuardRecord, loadRecordStore, recordReadBoundary, recordCodeIdentity } from './curia-records.mjs';

export async function guardBoundaryFixtures({ expectTrue, registry }) {
  const base = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'curia-guard-boundary-'))), roots = [];
  const env = { ...process.env }; for (const k of Object.keys(env)) if (k.startsWith('GIT_') || ['CURIA_ROOT', 'CURIA_STAGED', 'CURIA_ROOT', 'CURIA_STAGED', 'NODE_OPTIONS'].includes(k)) delete env[k];
  const assert = (name, ok, detail = '') => expectTrue(`Curia guard boundary [${name}]`, !!ok, detail);
  const reject = async (name, action) => { let error; try { await action(); } catch (e) { error = e; } assert(name, !!error && /guards\/|records\/|checks\//.test(error.message), error?.message ?? 'not rejected'); return error; };
  const foreignEvent = 'docs/foreign-records/r-11111111-1111-4111-8111-111111111111.00000000.json';
  const make = name => {
    const root = join(base, name); roots.push(root); fs.mkdirSync(root);
    const put = (p, bytes) => { fs.mkdirSync(dirname(join(root, p)), { recursive: true }); fs.writeFileSync(join(root, p), bytes); };
    const git = (...args) => execFileSync('git', args, { cwd: root, env, stdio: 'pipe', encoding: 'utf8' });
    const commit = (...paths) => { git('add', '--', ...paths); git('-c', 'user.name=fixture', '-c', 'user.email=fixture@local', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'pinned read fixture', '--', ...paths); };
    const cfg = structuredClone(registry), guard = { schema: 'curia.guard/1', owner: 'fixture', authorityLinks: ['docs/README.md'], activation: 'explicit', onEmpty: 'fail', command: { program: 'node', script: 'checks/doc.mjs', args: [], cwd: '.', identityPaths: ['checks/doc.mjs'] }, inputScope: { mode: 'git', paths: ['docs/input'], exclusions: [], includeUntracked: false, includeIgnored: false }, effects: { write: true, network: false, externalSystems: false, sensitiveRead: false }, privacy: { sensitivePaths: [], output: 'discard', args: 'non-sensitive-static' }, environment: [], expectedExitCodes: [0], parser: { id: 'aggregate-exit/1', ruleIds: [] }, limits: { timeoutMs: 3000, killGraceMs: 100, maxOutputBytes: 65536, maxFiles: 128, maxFileBytes: 1024 * 1024, maxTotalBytes: 4 * 1024 * 1024, cpuMs: null, memoryBytes: null, maxProcesses: null } };
    cfg.instance = { schema: 'curia.instance/1', owner: 'fixture', surfaces: [{ id: 'control', kind: 'root', entry: '.agents/README.md', authorityLinks: ['AGENTS.md'], members: [{ path: '.agents', kind: 'directory', role: 'control' }] }, { id: 'knowledge', kind: 'root', entry: 'docs/README.md', authorityLinks: ['docs/README.md'], members: [{ path: 'docs', kind: 'directory', role: 'knowledge' }] }], recordStore: { schema: 'curia.record-store/1', path: 'docs/records/runs', owner: 'fixture', authorityLinks: ['docs/README.md'] }, guards: { docs: guard } };
    const save = () => put('.agents/doc-types.json', JSON.stringify(cfg) + '\n');
    save(); put('AGENTS.md', '# Rules\n'); put('.agents/README.md', '# Control\n'); put('docs/README.md', '# Authority\n'); put('docs/input/a.txt', 'ALLOWED\n'); put('docs/foreign-input/a.txt', 'UNCONFIRMED_INPUT\n'); put(foreignEvent, '{}\n'); put('checks/doc.mjs', 'process.exitCode = 0;\n');
    git('init', '-q'); commit('.agents', 'AGENTS.md', 'docs', 'checks');
    const command = code => put('checks/doc.mjs', code);
    const mutationCommand = mutation => command(`import fs from 'node:fs';const p='.agents/doc-types.json',r=JSON.parse(fs.readFileSync(p));${mutation};fs.writeFileSync(p,JSON.stringify(r)+'\\n');fs.writeFileSync('command-ran.txt','ran');\n`);
    return { root, cfg, guard, put, git, commit, save, command, mutationCommand };
  };
  const observe = async (f, paths, action, hooks = {}) => {
    const original = { open: fs.openSync, read: fs.readSync, link: fs.linkSync, readdir: fs.readdirSync, stat: fs.lstatSync }, counts = Object.fromEntries(paths.map(p => [p, 0]));
    const inode = hooks.readPath ? fs.statSync(join(f.root, hooks.readPath)).ino : null; let fired = false, directories = 0;
    if (hooks.observeStat) for (const p of paths) counts['stat:' + p] = 0;
    fs.lstatSync = (path, ...args) => { if (hooks.observeStat) for (const p of paths) if (String(path) === join(f.root, p)) counts['stat:' + p]++; return original.stat(path, ...args); };
    fs.openSync = (path, ...args) => { for (const p of paths) if (String(path) === join(f.root, p)) counts[p]++; return original.open(path, ...args); };
    fs.readSync = (fd, ...args) => { const n = original.read(fd, ...args); if (n && !fired && inode !== null && fs.fstatSync(fd).ino === inode) { fired = true; hooks.afterRead(); } return n; };
    fs.linkSync = (source, target) => { const value = original.link(source, target); if (!fired && hooks.afterBegin && String(target).endsWith('.00000000.json')) { fired = true; hooks.afterBegin(); } return value; };
    fs.readdirSync = (path, ...args) => { const value = original.readdir(path, ...args); if (hooks.afterSecondStoreListing && String(path) === join(f.root, 'docs/records/runs') && ++directories === 2) { fired = true; hooks.afterSecondStoreListing(); } return value; };
    syncBuiltinESMExports();
    try { return { value: await action(), counts, fired }; }
    finally { fs.openSync = original.open; fs.readSync = original.read; fs.linkSync = original.link; fs.readdirSync = original.readdir; fs.lstatSync = original.stat; syncBuiltinESMExports(); }
  };
  const changeScope = f => { f.guard.inputScope.paths = ['docs/foreign-input']; f.save(); };
  const changeStore = f => { f.cfg.instance.recordStore.path = 'docs/foreign-records'; f.save(); };
  const input = { changed: ['.agents/doc-types.json'], within: ['docs/input'], configuration: 'only', nonSensitive: true };
  const payload = plan => ({ schema: GUARD_RUN_SCHEMA, executionMode: 'guard-command', adapterId: 'docs', adapter: plan.adapter, inputSnapshot: plan.inputSnapshot, planDigest: plan.digest, risks: plan.risks, unresolved: [], codeIdentity: plan.codeIdentity, references: { corrects: null, retriedFrom: null } });
  try {
    const normal = make('normal'), original = buildGuardPlan(normal.root, 'docs'), before = normal.git('ls-files', '-s', '-z');
    const positive = await observe(normal, ['docs/input/a.txt'], () => reobserveGuardPlan(original));
    assert('live-positive-control', positive.value.digest.value === original.digest.value && positive.counts['docs/input/a.txt'] > 0);
    assert('reobserve-does-not-write', normal.git('ls-files', '-s', '-z') === before && !fs.existsSync(join(normal.root, 'docs/records')));
    const boundary = recordReadBoundary(loadRecordStore(normal.root));
    assert('exact-loader-positive', loadRecordStore(normal.root, { expectedBoundary: boundary }).root === normal.root);
    await reject('serialized-plan-no-capability', () => reobserveGuardPlan(JSON.parse(JSON.stringify(original))));
    const mutated = buildGuardPlan(normal.root, 'docs'); mutated.adapter.owner = 'forged'; await reject('modified-plan-no-capability', () => reobserveGuardPlan(mutated));
    normal.put('docs/input/a.txt', 'AUTHORIZED_NEW_BYTES\n'); assert('same-scope-byte-change-is-observed', reobserveGuardPlan(original).digest.value !== original.digest.value);
    const fresh = buildGuardPlan(normal.root, 'docs'); changeScope(normal);
    const changed = await observe(normal, ['docs/foreign-input/a.txt'], () => reject('configuration-pinned-before-input', () => reobserveGuardPlan(fresh)));
    assert('changed-scope-never-opened', changed.counts['docs/foreign-input/a.txt'] === 0);
    assert('store-only-can-record-context-drift', loadRecordStore(normal.root, { expectedBoundary: boundary, boundaryMode: 'store-only' }).registryDigest.value !== boundary.registry.value);
    await reject('store-only-needs-boundary', () => loadRecordStore(normal.root, { boundaryMode: 'store-only' }));
    await reject('staged-does-not-reuse-worktree-pin', () => loadRecordStore(normal.root, { expectedBoundary: boundary, staged: true }));
    await reject('unknown-boundary-fields', () => loadRecordStore(normal.root, { expectedBoundary: { ...boundary, allow: true } }));

    for (const field of ['owner', 'authorityLinks']) {
      const f = make('store-' + field), expectedBoundary = recordReadBoundary(loadRecordStore(f.root));
      f.cfg.instance.recordStore[field] = field === 'owner' ? 'different-owner' : ['docs/foreign-input/a.txt']; f.save();
      const probe = await observe(f, ['docs/foreign-input/a.txt'], () => reject('store-declaration-pinned-' + field, () => loadRecordStore(f.root, { expectedBoundary, boundaryMode: 'store-only' })), { observeStat: true });
      assert('new-store-authority-not-probed-' + field, Object.values(probe.counts).every(n => n === 0));
    }
    const rebound = make('rebound'), pinned = buildGuardPlan(rebound.root, 'docs'), recordBoundary = recordReadBoundary(loadRecordStore(rebound.root)); changeStore(rebound);
    const reboundRead = await observe(rebound, [foreignEvent], async () => { await reject('live-store-binding-change', () => reobserveGuardPlan(pinned)); await reject('store-only-cannot-switch-storage', () => loadRecordStore(rebound.root, { expectedBoundary: recordBoundary, boundaryMode: 'store-only' })); });
    assert('new-record-directory-never-opened', reboundRead.counts[foreignEvent] === 0);

    for (const kind of ['head', 'index', 'root-inode']) {
      const f = make(kind), plan = buildGuardPlan(f.root, 'docs');
      if (kind === 'head') f.git('-c', 'user.name=fixture', '-c', 'user.email=fixture@local', '-c', 'core.hooksPath=/dev/null', 'commit', '--allow-empty', '-qm', 'changed head');
      if (kind === 'index') { f.put('docs/input/a.txt', 'STAGED\n'); f.git('add', '--', 'docs/input/a.txt'); }
      if (kind === 'root-inode') { const old = f.root + '-old'; fs.renameSync(f.root, old); fs.mkdirSync(f.root); for (const name of fs.readdirSync(old)) fs.renameSync(join(old, name), join(f.root, name)); }
      const probe = await observe(f, ['.agents/doc-types.json', 'docs/input/a.txt'], () => reject(kind + '-drift-before-source', () => reobserveGuardPlan(plan)));
      assert(kind + '-does-not-read-registry-or-input', Object.values(probe.counts).every(n => n === 0));
    }
    const aliasSource = make('alias-source'), aliasTarget = make('alias-target'), alias = join(base, 'alias'); fs.symlinkSync(aliasSource.root, alias);
    const aliased = buildGuardPlan(alias, 'docs'); fs.unlinkSync(alias); fs.symlinkSync(aliasTarget.root, alias);
    const aliasProbe = await observe(aliasTarget, ['.agents/doc-types.json', 'docs/input/a.txt'], () => reject('root-alias-retargeted', () => reobserveGuardPlan(aliased)));
    assert('alias-target-not-probed', Object.values(aliasProbe.counts).every(n => n === 0));
    const wrongCode = recordCodeIdentity('guard-command'); wrongCode[0].digest.value = '0'.repeat(64);
    const codeProbe = await observe(aliasSource, ['.agents/doc-types.json', 'docs/input/a.txt'], () => reject('code-mismatch-before-sources', () => buildGuardPlan(aliasSource.root, 'docs', { expectedCodeIdentity: wrongCode })));
    assert('code-mismatch-no-source-open', Object.values(codeProbe.counts).every(n => n === 0));
    const mismatchedMount = { ...recordReadBoundary(loadRecordStore(aliasSource.root)), mounts: [join(aliasSource.root, 'unconfirmed-mount')] };
    const mountProbe = await observe(aliasSource, ['.agents/doc-types.json'], () => reject('mount-set-pinned', () => loadRecordStore(aliasSource.root, { expectedBoundary: mismatchedMount })));
    assert('mount-mismatch-before-registry', mountProbe.counts['.agents/doc-types.json'] === 0);

    for (const batch of [false, true]) {
      const f = make(batch ? 'plan-batch' : 'plan-single');
      const probe = await observe(f, [foreignEvent], () => reject('plan-mid-capture-rebinding-' + batch, () => batch ? buildCheckPlan(f.root, input, ['docs']) : buildGuardPlan(f.root, 'docs')), { readPath: 'docs/input/a.txt', afterRead: () => changeStore(f) });
      assert('initial-plan-recheck-does-not-follow-new-store-' + batch, probe.fired && probe.counts[foreignEvent] === 0);
    }
    const publication = make('publication'), publishPlan = buildGuardPlan(publication.root, 'docs'); fs.mkdirSync(join(publication.root, 'docs/records/runs'), { recursive: true });
    const publicationProbe = await observe(publication, [foreignEvent], () => reject('publication-recheck-pins-original-context', () => beginGuardRecord(publication.root, payload(publishPlan))), { afterSecondStoreListing: () => changeStore(publication) });
    assert('publication-does-not-read-rebound-storage', publicationProbe.fired && publicationProbe.counts[foreignEvent] === 0);
    assert('publication-refuses-before-event-write', fs.readdirSync(join(publication.root, 'docs/records/runs')).length === 0);

    for (const batch of [false, true]) {
      const f = make(batch ? 'preflight-batch' : 'preflight-single'); f.command("import fs from 'node:fs';fs.writeFileSync('command-ran.txt','ran');\n");
      const plan = batch ? buildCheckPlan(f.root, input, ['docs']) : buildGuardPlan(f.root, 'docs');
      const probe = await observe(f, ['docs/foreign-input/a.txt'], () => batch ? runChecks(f.root, input, ['docs'], plan.digest.value) : runGuard(f.root, 'docs', plan.digest.value), { afterBegin: () => changeScope(f) });
      const receipt = batch ? probe.value.commands[0].receipt : probe.value.command;
      assert('preflight-changed-without-execution-' + batch, probe.fired && receipt.status === 'preflight-changed' && receipt.pid === null && !fs.existsSync(join(f.root, 'command-ran.txt')));
      assert('preflight-changed-without-widening-' + batch, probe.counts['docs/foreign-input/a.txt'] === 0 && probe.value.terminal && probe.value.status !== 'passed');
    }
    for (const batch of [false, true]) {
      const f = make(batch ? 'post-batch' : 'post-single'); f.mutationCommand("r.instance.guards.docs.inputScope.paths=['docs/foreign-input']");
      const plan = batch ? buildCheckPlan(f.root, input, ['docs']) : buildGuardPlan(f.root, 'docs');
      const probe = await observe(f, ['docs/foreign-input/a.txt'], () => batch ? runChecks(f.root, input, ['docs'], plan.digest.value) : runGuard(f.root, 'docs', plan.digest.value));
      const receipt = batch ? probe.value.commands[0].receipt : probe.value.command;
      assert('post-command-context-drift-is-not-success-' + batch, fs.existsSync(join(f.root, 'command-ran.txt')) && receipt.exitCode === 0 && receipt.inputDrift.includes('$context/registry') && probe.value.terminal && probe.value.status === 'incomplete');
      assert('post-command-does-not-read-new-input-' + batch, probe.counts['docs/foreign-input/a.txt'] === 0 && receipt.inputDrift.includes('$post-snapshot/unavailable'));
    }
    for (const batch of [false, true]) {
      const f = make(batch ? 'store-batch' : 'store-single'); f.mutationCommand("r.instance.recordStore.path='docs/foreign-records'");
      const plan = batch ? buildCheckPlan(f.root, input, ['docs']) : buildGuardPlan(f.root, 'docs');
      const probe = await observe(f, [foreignEvent], () => reject('post-command-storage-rebinding-' + batch, () => batch ? runChecks(f.root, input, ['docs'], plan.digest.value) : runGuard(f.root, 'docs', plan.digest.value)));
      assert('rebound-storage-is-not-read-after-command-' + batch, probe.counts[foreignEvent] === 0 && fs.existsSync(join(f.root, 'command-ran.txt')) && /^r-[0-9a-f-]{36}$/.test(probe.value.runId ?? ''));
      f.save(); const ctx = loadRecordStore(f.root), events = ctx.runs.get(probe.value.runId);
      assert('unknown-recording-stays-open-no-automatic-retry-' + batch, events?.length === 1 && events[0].data.kind === 'begin');
    }
    const migrated = make('empty-baseline-binding'); migrated.cfg.instance.recordStore.path = 'docs/new-authorized-store'; migrated.save();
    const authorized = buildGuardPlan(migrated.root, 'docs'); assert('initially-authorized-empty-baseline-remap-preserved', reobserveGuardPlan(authorized).digest.value === authorized.digest.value);
  } catch (error) { assert('unexpected-exception', false, error.stack); }
  finally { fs.rmSync(base, { recursive: true, force: true }); }
}
if (isMainModule(import.meta.url)) {
  let passed = 0; const failed = [];
  await guardBoundaryFixtures({ registry: JSON.parse(fs.readFileSync(join(ROOT, '.agents/doc-types.json'))), expectTrue: (name, ok, detail) => ok ? passed++ : failed.push({ name, detail }) });
  console.log(JSON.stringify({ passed, failed }, null, 2)); if (failed.length) process.exitCode = 1;
}
