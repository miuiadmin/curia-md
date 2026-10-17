/** Local static-document fixtures; no service, network, npm or business runtime. */
import fs from 'node:fs';
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { ROOT, isMainModule } from './doc-lib.mjs';
import { normalizeInstance } from './curia-instance.mjs';
import { prepareMoveSelection, observeMoveSelection, revalidateMoveSelection } from './curia-query.mjs';
import { buildMoveWorkflow, parseMoveArgs } from './curia-moves.mjs';
import { buildImpactWorkflow, buildReadWorkflow } from './curia-workflow.mjs';
import { READ_ONLY_CLIS } from './check-tools.mjs';

export async function moveFixtures({ registry, expectTrue }) {
  const base = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'curia-move-')));
  const env = { ...process.env }; for (const key of Object.keys(env)) if (key.startsWith('GIT_') || ['CURIA_ROOT', 'CURIA_STAGED', 'CURIA_ROOT', 'CURIA_STAGED', 'NODE_OPTIONS'].includes(key)) delete env[key];
  let failures = 0, serial = 0;
  const assert = (name, ok, detail = '') => { if (!ok) failures++; expectTrue(`Curia moves [${name}]`, !!ok, detail); };
  const reject = (name, fn) => { let error; try { fn(); } catch (e) { error = e; } assert(name, !!error, error?.message ?? '未拒绝'); };
  const git = (root, ...args) => cp.execFileSync('git', args, { cwd: root, env, stdio: 'pipe' });
  const put = (root, path, bytes) => { fs.mkdirSync(dirname(join(root, path)), { recursive: true }); fs.writeFileSync(join(root, path), bytes); };
  const commit = root => git(root, '-c', 'user.name=fixture', '-c', 'user.email=fixture@local', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'move fixture');
  const cfg = () => ({ ...structuredClone(registry), rawMarker: '.agents-raw', instance: { schema: 'curia.instance/1', owner: 'fixture', surfaces: [
    { id: 'agents', kind: 'root', entry: '.agents/README.md', authorityLinks: ['AGENTS.md'], members: [{ path: '.agents', kind: 'directory', role: 'control' }] },
    { id: 'docs', kind: 'root', entry: 'docs/README.md', authorityLinks: ['AGENTS.md'], members: [{ path: 'docs', kind: 'directory', role: 'knowledge' }] },
  ] } });
  const make = (changeBefore = () => {}, objectFormat = null) => {
    const root = join(base, String(++serial)); fs.mkdirSync(root); git(root, 'init', '-q', ...(objectFormat ? [`--object-format=${objectFormat}`] : []));
    const config = cfg(), old = Buffer.from([0, 1, 2, 255, 0, 13, 10]), current = Buffer.from('new revision, not an identity proof\n');
    put(root, '.agents/doc-types.json', JSON.stringify(config)); put(root, 'AGENTS.md', '# Rules\n'); put(root, 'docs/README.md', '# Docs\n'); put(root, '.agents/README.md', '# Fixture\n'); put(root, 'docs/old/file.bin', old); changeBefore(root, config);
    git(root, 'add', '--', '.agents', 'docs'); commit(root);
    const revision = git(root, 'rev-parse', 'HEAD').toString().trim(), oid = git(root, 'rev-parse', `${revision}:docs/old/file.bin`).toString().trim();
    fs.rmSync(join(root, 'docs/old'), { recursive: true, force: true }); put(root, 'docs/new.bin', current); put(root, 'docs/decision.md', '# Move basis\n\nExplicit declaration, not authenticated approval.\n');
    config.instance.moves = { schema: 'curia.moves/1', artifacts: [{ id: 'manual', current: 'docs/new.bin', previous: [{ path: 'docs/old/file.bin', revision, basis: ['docs/decision.md'] }] }] };
    const save = () => { put(root, '.agents/doc-types.json', JSON.stringify(config)); git(root, 'add', '--', '.agents', 'docs'); };
    save();
    const options = { from: 'docs/old/file.bin', revision, within: ['docs'], nonSensitive: true };
    return { root, config, old, current, revision, oid, options, save, run: extra => buildMoveWorkflow(root, { ...options, ...extra }), prepare: () => prepareMoveSelection(root, options) };
  };
  const watch = (f, action, hook = null) => {
    const open = fs.openSync, exec = cp.execFileSync; let payloads = 0;
    fs.openSync = function(path, ...args) { if ([join(f.root, 'docs/new.bin'), join(f.root, 'docs/decision.md')].includes(String(path))) { payloads++; hook?.(String(path)); } return open.call(this, path, ...args); };
    cp.execFileSync = function(cmd, args, ...rest) { if (cmd === 'git' && args.includes('cat-file') && args.includes('blob') && args.includes(f.oid)) payloads++; return exec.call(this, cmd, args, ...rest); };
    syncBuiltinESMExports();
    try { return { result: action(), payloads }; } finally { fs.openSync = open; cp.execFileSync = exec; syncBuiltinESMExports(); }
  };
  const unresolved = (name, f, extra = {}) => { const seen = watch(f, () => f.run(extra)); assert(name, !seen.result.complete && seen.result.evidence === null && seen.result.binding === null, JSON.stringify(seen.result)); assert(name + '-no-payload', seen.payloads === 0, String(seen.payloads)); };
  try {
    const f = make(), before = git(f.root, 'status', '--porcelain=v1').toString(), report = f.run();
    assert('exact-locator-resolved', report.complete && report.outcome === 'resolved-declaration', JSON.stringify(report));
    assert('binary-old-bytes-hashed', report.evidence?.from.digest.value === createHash('sha256').update(f.old).digest('hex'));
    assert('current-and-basis-bound', report.evidence?.current.digest.value === createHash('sha256').update(f.current).digest('hex') && report.evidence?.basis.length === 1 && report.source?.current.registry.digest);
    assert('no-authority-upgrade', report.semantics.approval === 'not-verified' && report.semantics.authority === 'unchanged' && report.evidence?.byteEquality === 'different-not-identity-disproof');
    assert('no-bodies-or-writes', !JSON.stringify(report).includes('Explicit declaration, not authenticated') && before === git(f.root, 'status', '--porcelain=v1').toString());
    assert('precise-observation-counts', report.coverage.historicalBlobs === 1 && report.coverage.currentBlobs === 2 && report.coverage.chargedBytes === f.old.length + f.current.length + fs.statSync(join(f.root, 'docs/decision.md')).size);
    const impact = buildImpactWorkflow(f.root, { changed: ['docs/decision.md'], within: ['docs/new.bin'], nonSensitive: true, configuration: 'only' });
    assert('config-impact-does-not-hide-new-binding', impact.complete && impact.schema === 'curia.impact-plan/4' && impact.configuration.moves.length > 0 && impact.impact.reviewPaths.includes('docs/new.bin') && impact.impact.references.some(item => item.kind === 'move-basis'));
    const ordinary = buildReadWorkflow(f.root, { selection: { paths: ['docs/decision.md'] } });
    assert('ordinary-read-does-not-follow-move', ordinary.documents.length === 1 && ordinary.schema === 'curia.read-workflow/1');
    const selected = f.prepare(); reject('json-is-not-read-capability', () => observeMoveSelection(structuredClone(selected))); reject('json-is-not-recheck-capability', () => revalidateMoveSelection(structuredClone(selected)));
    selected.binding.current = 'docs/elsewhere'; assert('mutated-selection-rejected', !observeMoveSelection(selected).complete);
    for (const [name, input] of Object.entries({ missingPrivacy: { nonSensitive: false }, missingScope: { within: [] }, revisionRef: { revision: 'HEAD' }, revisionShort: { revision: f.revision.slice(0, 12) }, revisionExpression: { revision: f.revision + ':docs/old/file.bin' }, traversal: { from: '../outside' }, unknown: { approval: true } })) reject(name, () => f.run(input));
    unresolved('wrong-exact-revision', f, { revision: '0'.repeat(40) });
    unresolved('not-prefix-match', f, { from: 'docs/old' });
    unresolved('source-not-authorized', f, { within: ['docs/new.bin'] });
    unresolved('target-not-authorized', f, { within: ['docs/old', 'docs/decision.md'] });
    unresolved('basis-not-authorized', f, { within: ['docs/old', 'docs/new.bin'] });
    unresolved('exclusions-prevail', f, { exclusions: ['docs/decision.md'] });
    unresolved('file-budget-shared', f, { limits: { maxFiles: 2 } });
    unresolved('total-budget-shared', f, { limits: { maxTotalBytes: f.old.length + f.current.length } });
    unresolved('file-byte-budget', f, { limits: { maxFileBytes: 1 } });
    assert('larger-count-budget-is-not-reader-mismatch', f.run({ limits: { maxFiles: 64 } }).complete);
    const empty = make(root => put(root, 'docs/old/file.bin', Buffer.alloc(0))); assert('empty-historical-file-is-complete', empty.run().complete && empty.run().evidence.from.size === 0);
    const equal = make(); put(equal.root, 'docs/new.bin', equal.old); assert('equal-bytes-not-proof', equal.run().evidence?.byteEquality === 'equal-not-identity-proof');
    const disabled = make(); delete disabled.config.instance.moves; disabled.save(); unresolved('default-disabled', disabled);
    const missing = make(); fs.unlinkSync(join(missing.root, 'docs/decision.md')); unresolved('missing-basis', missing);
    const symlink = make(); fs.unlinkSync(join(symlink.root, 'docs/new.bin')); fs.symlinkSync('decision.md', join(symlink.root, 'docs/new.bin')); unresolved('current-symlink', symlink);
    const ignored = make(); put(ignored.root, '.gitignore', 'docs/new.bin\n'); git(ignored.root, 'rm', '--cached', '-f', '--', 'docs/new.bin'); unresolved('ignored-target', ignored, { includeUntracked: true });
    const untracked = make(); git(untracked.root, 'rm', '--cached', '-f', '--', 'docs/new.bin'); unresolved('untracked-default-blocked', untracked); assert('untracked-explicit', untracked.run({ includeUntracked: true }).complete);
    const raw = make((root) => put(root, 'docs/old/.agents-raw', '')); unresolved('historical-raw-marker', raw);
    const customRaw = make((root, config) => { config.rawMarker = '.old-raw'; put(root, '.agents/doc-types.json', JSON.stringify(config)); put(root, 'docs/old/.old-raw', ''); }); customRaw.config.rawMarker = '.agents-raw'; customRaw.save(); unresolved('historical-policy-retained', customRaw);
    const unknownPolicy = make((root, config) => { const historical = structuredClone(config); historical.version = 99; put(root, '.agents/doc-types.json', JSON.stringify(historical)); }); unresolved('unknown-historical-policy', unknownPolicy);
    const noConfig = make(root => fs.unlinkSync(join(root, '.agents/doc-types.json'))); assert('pre-curia-history-supported', noConfig.run().complete && noConfig.run().source.historicalRegistry.state === 'absent');
    const rawNow = make(); put(rawNow.root, 'docs/.agents-raw', ''); unresolved('current-raw-policy', rawNow);
    const oldLink = make(root => { fs.unlinkSync(join(root, 'docs/old/file.bin')); fs.symlinkSync('../missing', join(root, 'docs/old/file.bin')); }); unresolved('historical-symlink', oldLink);
    const blobRevision = make(); blobRevision.config.instance.moves.artifacts[0].previous[0].revision = blobRevision.oid; blobRevision.options.revision = blobRevision.oid; blobRevision.save(); unresolved('full-oid-must-be-commit', blobRevision);
    const absentHistory = make(); absentHistory.config.instance.moves.artifacts[0].previous[0].revision = '1'.repeat(40); absentHistory.options.revision = '1'.repeat(40); absentHistory.save(); unresolved('missing-commit-no-fetch', absentHistory);
    const reused = make(); put(reused.root, 'docs/old/file.bin', 'a different object now'); reused.save(); assert('old-path-reuse-not-current-read', reused.run().evidence?.from.digest.value === report.evidence?.from.digest.value);
    const returnPath = make(); fs.mkdirSync(join(returnPath.root, 'docs/old'), { recursive: true }); fs.renameSync(join(returnPath.root, 'docs/new.bin'), join(returnPath.root, 'docs/old/file.bin')); returnPath.config.instance.moves.artifacts[0].current = 'docs/old/file.bin'; returnPath.save(); assert('return-to-old-path-no-alias-cycle', returnPath.run().complete);
    for (const [name, change] of Object.entries({
      unknownSchema: m => { m.schema = 'curia.moves/2'; }, unknownField: m => { m.approval = true; }, empty: m => { m.artifacts = []; },
      duplicateId: m => { m.artifacts.push({ ...structuredClone(m.artifacts[0]), current: 'docs/another.bin' }); },
      duplicateCurrent: m => { m.artifacts.push({ ...structuredClone(m.artifacts[0]), id: 'other', previous: [{ ...m.artifacts[0].previous[0], revision: '2'.repeat(40) }] }); },
      duplicateLocator: m => { m.artifacts.push({ ...structuredClone(m.artifacts[0]), id: 'other', current: 'docs/other.bin' }); },
      caseAlias: m => { m.artifacts[0].previous[0].path = 'docs/NEW.bin'; },
      selfBasis: m => { m.artifacts[0].previous[0].basis = ['docs/new.bin']; }, registryBasis: m => { m.artifacts[0].previous[0].basis = ['.agents/doc-types.json']; },
      noBasis: m => { m.artifacts[0].previous[0].basis = []; }, unmanagedCurrent: m => { m.artifacts[0].current = 'src/manual.md'; }, refRevision: m => { m.artifacts[0].previous[0].revision = 'HEAD'; },
    })) { const config = structuredClone(f.config); change(config.instance.moves); reject('schema-' + name, () => normalizeInstance(config.instance, config.types)); }
    const distinct = structuredClone(f.config); distinct.instance.moves.artifacts.push({ id: 'other', current: 'docs/other.bin', previous: [{ path: 'docs/old/file.bin', revision: '2'.repeat(40), basis: ['docs/decision.md'] }] }); assert('path-reuse-at-distinct-revisions', normalizeInstance(distinct.instance, distinct.types).moves.artifacts.length === 2);
    for (const target of ['docs/new.bin', 'docs/decision.md', '.agents/doc-types.json']) {
      const drift = make(), capability = drift.prepare(); fs.appendFileSync(join(drift.root, target), ' ');
      const observed = watch(drift, () => observeMoveSelection(capability)); assert('drift-' + target, !observed.result.complete && !observed.result.evidence && observed.payloads === 0);
    }
    const indexDrift = make(), indexCapability = indexDrift.prepare(); put(indexDrift.root, 'docs/unrelated', 'change'); git(indexDrift.root, 'add', '--', 'docs/unrelated'); assert('index-drift', !observeMoveSelection(indexCapability).complete);
    const headDrift = make(), headCapability = headDrift.prepare(); commit(headDrift.root); assert('head-drift', !observeMoveSelection(headCapability).complete);
    const during = make(); let changed = false;
    const duringRead = watch(during, () => during.run(), path => { if (path.endsWith('docs/new.bin') && !changed) { changed = true; fs.appendFileSync(join(during.root, 'docs/decision.md'), ' drift'); } });
    assert('postcheck-withdraws-whole-group', changed && !duringRead.result.complete && duringRead.result.evidence === null && duringRead.result.binding === null && duringRead.result.coverage.chargedBytes > 0);
    const historicalDrift = make(), historicalCapability = historicalDrift.prepare(); git(historicalDrift.root, 'replace', historicalDrift.oid, git(historicalDrift.root, 'hash-object', '-w', '--stdin').toString().trim()); assert('replace-objects-not-followed', observeMoveSelection(historicalCapability).complete);
    const sha256 = make(() => {}, 'sha256'); assert('full-sha256-commit', sha256.revision.length === 64 && sha256.run().complete);
    const cli = join(ROOT, 'scripts/curia-workflow.mjs');
    const args = ['moves', '--root', f.root, '--from', f.options.from, '--revision', f.revision, '--within', 'docs', '--non-sensitive', '--strict', '--json'];
    const called = cp.spawnSync(process.execPath, [cli, ...args], { env, encoding: 'utf8' }); assert('cli-real-resolution', called.status === 0 && JSON.parse(called.stdout).complete, called.stderr);
    const gapArgs = [...args, '--exclude', 'docs/decision.md'], gapCli = cp.spawnSync(process.execPath, [cli, ...gapArgs], { env, encoding: 'utf8' }); assert('cli-strict-gap', gapCli.status === 1 && !JSON.parse(gapCli.stdout).complete);
    reject('cli-duplicate', () => parseMoveArgs(['--non-sensitive', '--non-sensitive'])); reject('cli-unknown', () => parseMoveArgs(['--help', '--follow']));
    assert('help-smoke-registered', READ_ONLY_CLIS.some(([file, argv]) => file === 'curia-workflow.mjs' && argv.join(' ') === 'moves --help'));
  } catch (error) { assert('unexpected-exception', false, error.stack); }
  finally { if (!failures) fs.rmSync(base, { recursive: true, force: true }); else console.error(`Move fixture retained: ${base}`); }
}
if (isMainModule(import.meta.url)) {
  let passed = 0; const failed = [];
  await moveFixtures({ registry: JSON.parse(fs.readFileSync(join(ROOT, '.agents/doc-types.json'), 'utf8')), expectTrue: (name, ok, detail) => ok ? passed++ : failed.push({ name, detail }) });
  console.log(JSON.stringify({ passed, failed }, null, 2)); if (failed.length) process.exitCode = 1;
}
