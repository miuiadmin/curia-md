/** Safe metadata and explicit raw revision queries in disposable workspaces. */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ROOT, isMainModule, loadRegistry, registryProjectionPath } from './doc-lib.mjs';
import { loadRegistry as projectionRegistryLoader } from './gen-doc-types.mjs';
import { parseRegistryJson } from './curia-json.mjs';
import { parseRegistryJson as queryRegistryParser, buildInventory, readInventorySelection, filterEnvelopes, buildGitChangeQuery, normalizeMetadataLimits, parseArgs, parseGitChangeArgs } from './curia-query.mjs';
import { buildReadWorkflow, READ_RULE_SETS } from './curia-workflow.mjs';
import { normalizeInstance } from './curia-instance.mjs';

export function querySafetyFixtures({ expectTrue, registry }) {
  registryAuthorityFixtures({ expectTrue, registry });
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'curia-query-safe-'))), cli = fileURLToPath(new URL('./curia-query.mjs', import.meta.url));
  const env = { ...process.env }; for (const key of Object.keys(env)) if (key.startsWith('GIT_') || ['CURIA_ROOT', 'CURIA_STAGED', 'CURIA_ROOT', 'CURIA_STAGED', 'NODE_OPTIONS'].includes(key)) delete env[key];
  const git = (...args) => execFileSync('git', args, { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
  const put = (path, value) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), value); };
  const remove = path => rmSync(join(root, path), { recursive: true, force: true });
  const assert = (name, ok, detail = '') => expectTrue(`Curia safe query [${name}]`, ok, detail);
  const reject = (name, fn) => { let error; try { fn(); } catch (e) { error = e; } assert(name, !!error, error?.message ?? '未拒绝'); };
  const a = 'docs/a.md', z = 'docs/z.md', bin = 'docs/file.pdf';
  const md = (body = 'ORIGINAL', owner = 'VISIBLE_OWNER_A') => `# Fixture\n\nStatus: current\nOwner: ${owner}\n\n${body}\n`;
  const raw = md(), base = structuredClone(registry); delete base.instance;
  const jsonReg = { ...base, instance: { schema: 'curia.instance/1', owner: 'fixture', surfaces: [
    { id: 'control', kind: 'root', members: [{ path: '.agents', kind: 'directory', role: 'control' }], entry: '.agents/README.md', authorityLinks: ['AGENTS.md'] },
    { id: 'knowledge', kind: 'root', members: [{ path: 'docs', kind: 'directory', role: 'knowledge' }], entry: 'docs/README.md', authorityLinks: ['AGENTS.md'] },
  ], mappings: [{ path: 'docs', kind: 'directory', defaults: { owner: 'fixture' } }, { path: 'docs/data', kind: 'directory', contentParser: 'json-data/1' }] } };
  const reset = () => { git('reset', '--hard', 'HEAD'); git('clean', '-fdx'); };
  const named = (report, path = a) => report.envelopes.find(item => item.identity.path === path);
  const query = extra => buildInventory(root, null, extra);
  const changes = (extra = {}) => buildGitChangeQuery(root, { base: 'HEAD', within: ['docs'], nonSensitive: true, ...extra });
  const run = args => spawnSync(process.execPath, [cli, ...args, '--root', root], { cwd: root, env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const checksum = bytes => createHash('sha256').update(bytes).digest('hex');
  try {
    git('init', '-q'); git('config', 'user.name', 'fixture'); git('config', 'user.email', 'fixture@example.invalid'); git('config', 'core.autocrlf', 'false');
    put('AGENTS.md', '# Fixture\n'); put('.agents/README.md', '# Control\n'); put('.agents/doc-types.json', JSON.stringify(base)); put('docs/README.md', '# Docs\n'); put(a, raw); put(z, md('LATER', 'VISIBLE_OWNER_Z'));
    git('add', '--', 'AGENTS.md', '.agents/doc-types.json', '.agents/README.md', 'docs/README.md', a, z); git('commit', '-qm', 'fixture');
    let result = query(), item = named(result);
    assert('inventory-version-not-silent-reinterpretation', result.schema === 'curia.inventory/3' && result.input.worktreeComparison === 'curia.raw-worktree-revision/1' && !Object.hasOwn(result.coverage.byWorktreeState, 'tracked-clean'));
    assert('same-complete-bytes', item.worktreeModified === false && item.git.worktree.completeBytes && item.git.worktree.blob.oid === git('rev-parse', `HEAD:${a}`) && item.git.worktree.digest.value === checksum(Buffer.from(raw)) && item.owner === 'VISIBLE_OWNER_A');
    assert('registry-reuses-loaded-bytes', result.instance.registry.worktree.matchesIndex === true && named(result, '.agents/doc-types.json').git.worktree.digest.value === checksum(readFileSync(join(root, '.agents/doc-types.json'))));
    assert('single-read-per-document', result.coverage.metadataObservation.openedFiles === 4 && result.coverage.metadataObservation.chargedBytes === ['.agents/README.md', 'docs/README.md', a, z].reduce((n, p) => n + readFileSync(join(root, p)).length, 0));
    assert('payload-not-emitted', !JSON.stringify(result).includes('ORIGINAL') && result.coverage.metadataObservation.bodiesEmitted === 0);
    const index = readFileSync(join(root, '.git/index')); query({ linkCoverage: true }); assert('index-not-written', index.equals(readFileSync(join(root, '.git/index'))));
    // Path selection limits payload I/O, not just the rows emitted after a full inventory.
    const scope = (paths, exclusions = []) => ({ metadataSelection: { paths, exclusions, corpus: !paths.length } });
    result = query({ ...scope([a]), metadataLimits: { maxFiles: 1, maxTotalBytes: Buffer.byteLength(raw) } });
    assert('scope-single-file-budget', result.coverage.files === 1 && named(result).owner === 'VISIBLE_OWNER_A' && result.coverage.metadataObservation.openedFiles === 1 && result.coverage.metadataObservation.chargedBytes === Buffer.byteLength(raw) && result.coverage.metadataObservation.budgetLimited === 0);
    assert('scope-explicit-coverage', result.input.selection.selected === 1 && result.input.selection.discovered > 1 && result.input.selection.unmatched.length === 0 && result.coverage.scope === 'explicit-path-selection' && !JSON.stringify(result).includes('VISIBLE_OWNER_Z'));
    reject('scope-does-not-mint-read-capability', () => readInventorySelection(result));
    result = query(scope(['docs'])); assert('scope-directory', result.coverage.files === 3 && result.envelopes.every(item => item.identity.path.startsWith('docs/')) && result.coverage.metadataObservation.openedFiles === 3);
    result = query(scope(['docs', a])); assert('scope-overlap-no-double-read', result.coverage.files === 3 && result.coverage.metadataObservation.openedFiles === 3 && result.input.selection.unmatched.length === 0);
    result = query(scope([a, z], [z])); assert('scope-exclusion-wins', result.coverage.files === 1 && result.input.selection.excluded === 1 && result.input.selection.unmatched.length === 0 && named(result).identity.path === a);
    result = query(scope([], ['.agents', z])); assert('scope-exclude-from-default', result.coverage.files === 2 && result.input.selection.corpus && result.coverage.metadataObservation.openedFiles === 2);
    result = query(scope([a, 'docs/missing.md'])); assert('scope-partially-unmatched-blocks', result.coverage.files === 1 && result.input.selection.unmatched.includes('docs/missing.md') && result.findings.some(f => f.code === 'metadata-selection-unmatched' && f.severity === 'error'));
    for (const [label, selection] of [['missing', scope(['docs/missing.md'])], ['excluded', scope([a], [a])], ['corpus-excluded', scope([], ['docs', '.agents'])]]) {
      result = query(selection); assert(`scope-empty-${label}`, result.coverage.files === 0 && result.coverage.metadataObservation.openedFiles === 0 && result.findings.some(f => f.code === 'metadata-selection-empty' && f.severity === 'error'));
    }
    for (const [label, path, extra] of [['private', 'docs/private/secret.md', null], ['raw', 'docs/raw/secret.md', `docs/raw/${base.rawMarker}`], ['ignored', 'docs/ignored.md', '.gitignore']]) {
      put(path, md('SECRET_BODY', 'SECRET_OWNER')); if (extra) put(extra, label === 'ignored' ? path + '\n' : 'raw'); git('add', '-f', '--', path, ...(label === 'raw' ? [extra] : []));
      result = query(scope([path])); assert(`scope-default-exclusion-${label}`, result.input.selection.excluded === 1 && result.coverage.metadataObservation.openedFiles === 0 && result.coverage.files === 0 && result.coverage.errors > 0 && !JSON.stringify(result).includes('SECRET_OWNER')); reset();
    }
    put('docs/new.md', md()); result = query(scope(['docs/new.md'])); assert('scope-untracked-not-implicit', result.coverage.files === 0 && result.coverage.errors > 0);
    result = query({ ...scope(['docs/new.md']), includeUntracked: true }); assert('scope-untracked-opt-in', result.coverage.files === 1 && result.envelopes[0].tracked === false); reset();
    put(a, md('[target](z.md)')); put(z, md('[broken](absent.md)', 'UNSELECTED_OWNER'));
    result = query({ ...scope([a]), linkCoverage: true }); assert('scope-links-source-only', result.coverage.files === 1 && result.coverage.metadataObservation.openedFiles === 1 && named(result).linkCoverage.relativeLinks === 1 && !result.findings.some(f => f.code === 'link-target-missing'));
    result = query({ ...scope([z]), linkCoverage: true }); assert('scope-selected-broken-link-reported', named(result, z).gaps.includes('link-target-missing'));
    const brokenLinkCli = run(['--path', z, '--links', '--strict', '--json']); assert('scope-selected-broken-link-strict', brokenLinkCli.status === 1 && JSON.parse(brokenLinkCli.stdout).findings.some(f => f.code === 'link-target-missing' && f.severity === 'error'));
    // Rejecting fs opens proves that unread documents and link targets are not secretly parsed.
    const probe = (action = '', forbidden = [z], extra = {}, trigger = a) => {
      const child = spawnSync(process.execPath, ['--input-type=module', '-e', `import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';const open=fs.openSync,readFile=fs.readFileSync,read=fs.readSync;let forbiddenOpens=0,mutations=0,fired=false;const mutate=(path,data,flags='w')=>{const fd=open.call(fs,path,flags);try{fs.writeFileSync(fd,data);mutations++;}finally{fs.closeSync(fd);}};const forbidden=new Set(${JSON.stringify(forbidden.map(path => join(root, path)))});const check=path=>{if(forbidden.has(String(path))){forbiddenOpens++;throw Error('UNSELECTED_PAYLOAD_OPEN');}};fs.openSync=function(path,...args){check(path);return open.call(fs,path,...args);};fs.readFileSync=function(path,...args){check(path);return readFile.call(fs,path,...args);};fs.readSync=function(fd,...args){const n=read.call(fs,fd,...args);if(!fired&&n&&fs.fstatSync(fd).ino===${lstatSync(join(root, trigger)).ino}){fired=true;${action}}return n;};syncBuiltinESMExports();const {buildInventory}=await import(${JSON.stringify(pathToFileURL(cli).href)});const report=buildInventory(${JSON.stringify(root)},null,${JSON.stringify({ ...scope([a]), linkCoverage: true, ...extra })});console.log(JSON.stringify({report,forbiddenOpens,mutations,fired}));`], { cwd: root, env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
      if (child.status !== 0) throw Error(child.stderr); return JSON.parse(child.stdout);
    };
    // Inject writes via a captured descriptor: Node 18 writeFileSync re-enters fs.openSync.
    // Query-visible opens remain trapped; do not disable the interceptor around the mutation.
    const trapped = probe(`fs.readFileSync(${JSON.stringify(join(root, z))});`);
    assert('scope-open-trap-negative-control', trapped.forbiddenOpens === 1 && trapped.report.findings.some(f => f.code === 'content-read-failed' && f.detail.includes('UNSELECTED_PAYLOAD_OPEN')));
    let observation = probe(); assert('scope-no-unselected-or-target-open', observation.forbiddenOpens === 0 && observation.report.coverage.metadataObservation.openedFiles === 1 && observation.report.coverage.metadataObservation.stable && !JSON.stringify(observation.report).includes('UNSELECTED_OWNER'));
    observation = probe(`mutate(${JSON.stringify(join(root, z))},'UNSELECTED_CHANGED');`); assert('scope-unselected-body-not-input', observation.fired && observation.forbiddenOpens === 0 && observation.mutations === 1 && readFileSync(join(root, z), 'utf8') === 'UNSELECTED_CHANGED' && observation.report.coverage.metadataObservation.stable && named(observation.report)?.owner === 'VISIBLE_OWNER_A', JSON.stringify({ fired: observation.fired, forbiddenOpens: observation.forbiddenOpens, mutations: observation.mutations, owner: named(observation.report)?.owner, metadata: observation.report.coverage.metadataObservation, findings: observation.report.findings })); reset();
    observation = probe(`mutate(${JSON.stringify(join(root, a))},'SELECTED_CHANGED');`); assert('scope-selected-drift-withdraws', observation.fired && !observation.report.coverage.metadataObservation.stable && observation.report.coverage.errors > 0 && observation.report.envelopes.length === 0 && !JSON.stringify(observation.report).includes('VISIBLE_OWNER_A')); reset();
    observation = probe(`mutate(${JSON.stringify(join(root, a))},'CHANGED_AFTER_SELECTION_READ');`, [], scope([a, z]), z); assert('scope-postread-group-drift-withdraws', observation.fired && !observation.report.coverage.metadataObservation.stable && observation.report.envelopes.length === 2 && observation.report.envelopes.every(item => item.owner === null && item.git.worktree.digest === null) && !JSON.stringify(observation.report).includes('VISIBLE_OWNER_A')); reset();
    observation = probe(`mutate(${JSON.stringify(join(root, '.agents/doc-types.json'))},'\\n','a');`); assert('scope-registry-still-instance-input', observation.fired && !observation.report.coverage.metadataObservation.stable); reset();
    const scopedReg = structuredClone(jsonReg), variant = { family: 'manual', language: 'en', productVersion: 'v1', platform: 'not-applicable', audience: 'developer', canonical: true };
    scopedReg.instance.mappings = scopedReg.instance.mappings.filter(mapping => mapping.path !== 'docs/data');
    scopedReg.instance.mappings.push(...[a, z].map(path => ({ path, kind: 'file', variant: { defaults: variant }, validity: { defaults: { mode: 'timeless' } } })));
    put('.agents/doc-types.json', JSON.stringify(scopedReg));
    const allVariants = query(), allValidity = named(allVariants).validity.view;
    result = query(scope([a])); assert('scope-never-proves-global-canonical', !result.coverage.variants.complete && named(result).variant.cellState === 'unresolved' && named(result).variant.canonicalPath === null);
    assert('scope-keeps-document-time-evaluation', result.coverage.validity.complete && named(result).validity.view === allValidity && !named(result).gaps.includes('validity-unresolved'));
    result = query(scope([a, z])); assert('scope-observed-canonical-conflict-still-blocks', result.coverage.variants.conflicts === 1 && result.coverage.errors > 0 && named(result).variant.cellState === 'conflict');
    assert('scope-default-global-conflict-unchanged', allVariants.coverage.variants.conflicts === 1 && allVariants.coverage.errors > 0);
    let scopedCli = run(['--path', a, '--path', z, '--strict', '--json']); assert('scope-cli-conflict-strict', scopedCli.status === 1); reset();
    const options = parseArgs(['--path', z, '--path', a, '--exclude', z, '--exclude', 'docs/other']); assert('scope-cli-repeatable-flags', JSON.stringify(options.metadataSelection.paths) === JSON.stringify([a, z]) && options.metadataSelection.exclusions.length === 2 && !options.metadataSelection.corpus);
    assert('scope-cli-exclusion-only', parseArgs(['--exclude', z]).metadataSelection.corpus);
    assert('scope-cli-default-unchanged', !Object.hasOwn(parseArgs([]), 'metadataSelection'));
    for (const extra of [{ ...scope([a]), readMetadata: false }, { ...scope([a]), allowNoGit: true }, { ...scope([a]), selection: { paths: [a] } }, { selection: { paths: [a] } }, { metadataSelection: {} }, { metadataSelection: { paths: [a, a] } }, { metadataSelection: { paths: [a], command: 'execute' } }]) {
      let clockRead = false, error; try { buildInventory('/path/never-exists', null, { ...extra, now: () => { clockRead = true; return '2026-10-17T00:00:00Z'; } }); } catch (caught) { error = caught; }
      assert(`scope-options-before-io-${JSON.stringify(extra)}`, !clockRead && /\[curia2\/(options-invalid|read-selection-invalid)\]/.test(error?.message ?? ''));
    }
    for (const args of [['--path', a, '--path', a], ['--exclude', z, '--exclude', z], ['--path', 'docs/../a.md'], ['--path', 'docs/*.md'], ['--path', 'Docs', '--path', 'docs'], ['--path', a, '--allow-no-git'], ['--path']]) assert(`scope-cli-invalid-${args.join('/')}`, run(args).status === 2);
    for (const args of [['--path', 'docs/missing.md'], ['--path', a, '--exclude', a], ['--path', a, '--path', 'docs/missing.md'], ['--exclude', 'docs', '--exclude', '.agents']]) {
      scopedCli = run([...args, '--strict', '--json']); assert(`scope-cli-empty-or-unmatched-${args.join('/')}`, scopedCli.status === 1 && JSON.parse(scopedCli.stdout).coverage.errors > 0);
    }
    scopedCli = run(['--path', a, '--max-files', '1', '--strict', '--json']); result = JSON.parse(scopedCli.stdout);
    assert('scope-cli-success-honest-coverage', scopedCli.status === 0 && result.coverage.files === 1 && result.selection.coverageAppliesTo === 'explicit path selection before output filters' && result.input.selection.paths[0] === a);
    scopedCli = run(['--path', a, '--owner', 'nobody', '--strict', '--json']); result = JSON.parse(scopedCli.stdout); assert('scope-empty-output-filter-not-empty-input', scopedCli.status === 0 && result.envelopes.length === 0 && result.coverage.files === 1);
    scopedCli = run(['--path', a, '--coverage']); assert('scope-human-coverage-disclosed', scopedCli.status === 0 && scopedCli.stdout.includes('scope: explicit-path-selection'));
    result = query(); assert('scope-default-full-read-unchanged', result.coverage.metadataObservation.openedFiles === 4 && !Object.hasOwn(result.input, 'selection') && !Object.hasOwn(result.coverage, 'scope'));
    put(a, md('MODIFIED')); result = query(); assert('raw-content-change', named(result).worktreeModified === true && named(result).git.indexMatchesHead === true);
    git('add', '--', a); result = query(); assert('staged-versus-raw-separated', named(result).worktreeModified === false && named(result).git.indexMatchesHead === false);
    put(a, raw); result = query(); assert('cancelling-edits-not-lost', named(result).worktreeModified === true && named(result).git.indexMatchesHead === false); reset();
    chmodSync(join(root, a), 0o755); result = query(); assert('execute-bit-is-observed', named(result).worktreeModified === true); reset();
    put(a, md('x'.repeat(70000))); result = query(); assert('header-prefix-not-revision-proof', named(result).owner === 'VISIBLE_OWNER_A' && named(result).worktreeModified === null && named(result).git.worktree.reason === 'metadata-prefix-only' && named(result).git.worktree.digest === null && named(result).gaps.includes('worktree-revision-unobserved'));
    result = query({ linkCoverage: true }); assert('links-and-header-share-bytes', named(result).git.worktree.completeBytes && named(result).worktreeModified === true && result.coverage.metadataObservation.openedFiles === 4 && result.coverage.metadataObservation.chargedBytes === ['.agents/README.md', 'docs/README.md', a, z].reduce((n, p) => n + readFileSync(join(root, p)).length, 0));
    result = changes({ within: [a] }); assert('explicit-large-revision-without-links', result.complete && result.objects[0].digest && result.schema === 'curia.git-change-observation/2' && result.contentInterpretation === 'not-performed'); reset();
    put(bin, Buffer.from([0, 255, 32, 1])); git('add', '--', bin); result = query(); assert('unknown-format-not-secretly-hashed', named(result, bin).worktreeModified === null && !named(result, bin).git.worktree.digest);
    chmodSync(join(root, bin), 0o755); result = query(); assert('mode-only-does-not-claim-full-bytes', named(result, bin).worktreeModified === true && named(result, bin).git.worktree.state === 'mode-different' && !named(result, bin).git.worktree.completeBytes);
    result = changes({ within: [bin] }); assert('explicit-binary-revision', result.complete && result.objects[0].bytes === 4 && result.objects[0].digest.value === checksum(readFileSync(join(root, bin)))); reset();
    put(a, '\ufeff' + raw); result = query(); assert('bom-is-in-raw-digest', named(result).owner === 'VISIBLE_OWNER_A' && named(result).git.worktree.digest.value === checksum(readFileSync(join(root, a))) && named(result).worktreeModified); reset();
    put(a, Buffer.from([255, 1])); result = query(); assert('invalid-encoding-separate-from-byte-proof', named(result).gaps.includes('header-invalid') && named(result).worktreeModified === true && named(result).git.worktree.completeBytes); reset();
    put(a, ''); result = query(); assert('empty-bytes-have-real-digest', named(result).git.worktree.digest.value === checksum(Buffer.alloc(0))); reset();
    put('.agents/doc-types.json', JSON.stringify(jsonReg)); put('docs/data/value.json', '{"answer":9007199254740993}'); git('add', '--', 'docs/data/value.json');
    result = query(); assert('mapped-json-same-bytes', named(result, 'docs/data/value.json').git.worktree.matchesIndex === true && named(result, 'docs/data/value.json').content.state === 'parsed' && result.coverage.metadataObservation.openedFiles === 5);
    put('docs/data/value.json', '{"answer":9007199254740994}'); result = query(); assert('mapped-json-raw-change', named(result, 'docs/data/value.json').worktreeModified === true && result.instance.registry.worktreeMatchesIndex === false);
    put('docs/data/value.json', '{invalid'); result = query(); assert('json-parse-failure-does-not-erase-byte-identity', named(result, 'docs/data/value.json').content.state !== 'parsed' && named(result, 'docs/data/value.json').git.worktree.digest.value === checksum(Buffer.from('{invalid')) && named(result, 'docs/data/value.json').worktreeModified === true);
    put('docs/data/value.json', '{"answer":"' + 'x'.repeat(70000) + '"}'); result = query(); assert('json-parser-limit-no-body-expansion', !named(result, 'docs/data/value.json').git.worktree.digest && result.coverage.metadataObservation.openedFiles === 4); reset();
    put('docs/private/a.md', md('PRIVATE_BODY', 'PRIVATE_OWNER')); put('docs/raw/a.md', md('RAW_BODY', 'RAW_OWNER')); put(`docs/raw/${base.rawMarker}`, 'raw'); put('docs/ignored.md', md('IGNORED_BODY', 'IGNORED_OWNER')); put('.gitignore', 'docs/ignored.md\n');
    git('add', '-f', '--', 'docs/private/a.md', 'docs/raw/a.md', `docs/raw/${base.rawMarker}`, 'docs/ignored.md');
    result = query({ linkCoverage: true }); assert('privacy-before-payload', !JSON.stringify(result).includes('PRIVATE_OWNER') && !JSON.stringify(result).includes('RAW_OWNER') && !JSON.stringify(result).includes('IGNORED_OWNER') && result.coverage.metadataObservation.openedFiles === 4 && result.coverage.metadataObservation.privacyExcluded >= 3);
    const excludedPaths = ['docs/private/a.md', 'docs/raw/a.md', 'docs/ignored.md'];
    const excludedOids = excludedPaths.map(path => git('rev-parse', `:${path}`));
    for (const path of excludedPaths) assert(`no-excluded-digest-${path}`, named(result, path).git.worktree.digest === null && named(result, path).worktreeModified === null && named(result, path).linkCoverage.state === 'exempt');
    assert('privacy-no-git-content-identities', excludedPaths.every(path => named(result, path).git.indexOid === null && named(result, path).git.headOid === null && named(result, path).git.contentIdsWithheld === true) && excludedOids.every(oid => !JSON.stringify(result).includes(oid)));
    const privacyPathsOnly = query({ readMetadata: false });
    assert('privacy-paths-only-no-content-identities', !privacyPathsOnly.coverage.metadataObservation && excludedOids.every(oid => !JSON.stringify(privacyPathsOnly).includes(oid)));
    const priorHead = git('rev-parse', 'HEAD');
    try {
      git('commit', '-qm', 'private Git metadata fixture');
      const fromHead = query();
      assert('privacy-no-head-content-identities', excludedPaths.every(path => named(fromHead, path).git.indexMatchesHead === true && named(fromHead, path).tracked === true && named(fromHead, path).git.indexMode === '100644') && excludedOids.every(oid => !JSON.stringify(fromHead).includes(oid)));
      const cliPrivate = run(['--json']);
      assert('privacy-cli-no-content-identities', cliPrivate.status === 0 && excludedOids.every(oid => !cliPrivate.stdout.includes(oid)));
    } finally { git('reset', '--hard', priorHead); }
    reset();
    const mdReg = structuredClone(jsonReg); mdReg.instance.mappings.pop();
    put('.agents/doc-types.json', JSON.stringify(mdReg)); put('docs/private/a.md', md('PRIVATE_BODY', 'PRIVATE_OWNER')); git('add', '--', 'docs/private/a.md');
    result = query({ linkCoverage: true }); assert('mapped-private-markdown-no-parse-or-owner', named(result, 'docs/private/a.md').owner === null && named(result, 'docs/private/a.md').git.worktree.digest === null && !JSON.stringify(result).includes('PRIVATE_OWNER') && !result.findings.some(f => f.code === 'content-read-failed')); reset();
    result = query({ linkCoverage: true, metadataLimits: { maxFileBytes: 8 } }); assert('link-budget-reason-not-parser-limit', named(result).linkCoverage.reason === 'read-budget-limit' && named(result).gaps.includes('metadata-read-budget'));
    put(a, raw + 'x'.repeat(16 * 1024 * 1024)); result = query({ linkCoverage: true }); assert('link-parser-limit-preserved', named(result).linkCoverage.reason === 'size-limit' && !named(result).git.worktree.completeBytes); reset();
    const applicabilityReg = structuredClone(mdReg); applicabilityReg.instance.mappings[0].variant = { defaults: { family: 'manual', language: 'zh-CN', productVersion: 'v2', platform: 'not-applicable', audience: 'developer', canonical: true } }; applicabilityReg.instance.mappings[0].validity = { defaults: { mode: 'timeless' } };
    put('.agents/doc-types.json', JSON.stringify(applicabilityReg)); result = query({ metadataLimits: { maxFileBytes: 8 } }); assert('budget-cannot-prove-applicability', !result.coverage.variants.complete && !result.coverage.validity.complete && result.coverage.errors > 0); reset();
    result = query({ metadataLimits: { maxFiles: 1 } }); assert('aggregate-file-budget', result.coverage.metadataObservation.openedFiles === 1 && result.coverage.metadataObservation.budgetLimited > 0 && result.coverage.errors > 0);
    result = query({ metadataLimits: { maxTotalBytes: 1 } }); assert('aggregate-byte-budget', result.coverage.metadataObservation.chargedBytes === 1 && result.coverage.errors > 0);
    result = query({ metadataLimits: { maxFileBytes: 8 } }); assert('per-file-budget', result.coverage.metadataObservation.chargedBytes <= 32 && named(result).git.worktree.digest === null && result.coverage.errors > 0);
    const pathOnly = query({ readMetadata: false, selection: { paths: [a] } }); assert('paths-only-unchanged', named(pathOnly).worktreeModified === null && !named(pathOnly).git.worktree && !pathOnly.coverage.metadataObservation);
    const noRawRegistry = structuredClone(base); delete noRawRegistry.rawMarker; put('.agents/doc-types.json', JSON.stringify(noRawRegistry));
    assert('paths-only-optional-raw-marker', query({ readMetadata: false }).schema === 'curia.inventory/3'); reset();
    reject('paths-only-cannot-hide-budget-contract', () => query({ readMetadata: false, selection: { paths: [a] }, metadataLimits: {} }));
    for (const limits of [{ maxFiles: 0 }, { maxFiles: 10001 }, { maxFileBytes: 16777217 }, { maxTotalBytes: 268435457 }, { maxFiles: '1' }, { bogus: 1 }]) reject(`invalid-metadata-budget-${JSON.stringify(limits)}`, () => normalizeMetadataLimits(limits));
    let clockCalls = 0; reject('budget-before-clock-or-io', () => buildInventory('/missing', null, { metadataLimits: { maxFiles: 0 }, now: () => { clockCalls++; return new Date().toISOString(); } })); assert('invalid-budget-no-clock', !clockCalls);
    assert('metadata-cli-budget-parse', parseArgs(['--max-files', '2']).metadataLimits.maxFiles === 2);
    remove(a); result = query(); assert('missing-not-clean', !named(result) && result.findings.some(f => f.code === 'tracked-missing')); result = changes({ within: [a] }); assert('explicit-deletion-query', result.complete && result.objects[0].worktreeChange === 'deleted' && !result.objects[0].digest); reset();
    remove(a); symlinkSync('z.md', join(root, a)); result = query(); assert('symlink-not-observed', !named(result) && result.coverage.errors > 0); reset();
    remove(a); linkSync(join(root, z), join(root, a)); result = query(); assert('hardlink-not-observed', !named(result) && result.coverage.errors > 0); remove(a); reset();
    put('docs/.git', 'gitdir: nowhere\n'); result = query(); assert('nested-repository-not-observed', !named(result) && result.coverage.errors > 0); remove('docs/.git'); reset();
    // A deliberately racy index forces the unsafe Git control to read through clean conversion.
    put('driver.sh', '#!/bin/sh\nprintf invoked >> "$PWD/DRIVER_INVOKED"\ncat\n'); chmodSync(join(root, 'driver.sh'), 0o755);
    for (const key of ['filter.hostile.clean', 'filter.hostile.smudge', 'diff.hostile.command', 'diff.hostile.textconv', 'core.fsmonitor']) git('config', key, './driver.sh');
    put('.gitattributes', 'docs/* filter=hostile diff=hostile\n.agents/* filter=hostile diff=hostile\n');
    put(a, raw); utimesSync(join(root, a), new Date('2020-01-02T00:00:00Z'), new Date('2020-01-02T00:00:00Z')); git('-c', 'core.fsmonitor=false', 'add', '--', a);
    put(a, raw.replace('ORIGINAL', 'MODIFIED')); utimesSync(join(root, a), new Date('2020-01-02T00:00:00Z'), new Date('2020-01-02T00:00:00Z')); utimesSync(join(root, '.git/index'), new Date('2020-01-01T00:00:00Z'), new Date('2020-01-01T00:00:00Z')); git('config', 'core.trustctime', 'false'); remove('DRIVER_INVOKED');
    const beforeIndex = readFileSync(join(root, '.git/index'));
    for (const options of [{}, { linkCoverage: true }, { includeUntracked: true }]) { result = query(options); assert(`racy-query-no-drivers-${JSON.stringify(options)}`, named(result).worktreeModified === true && !existsSync(join(root, 'DRIVER_INVOKED'))); }
    for (const args of [['--json'], ['--links', '--json'], ['--coverage', '--json'], ['changes', '--git-base', 'HEAD', '--within', a, '--non-sensitive', '--strict', '--json']]) { const cliResult = run(args); assert(`racy-cli-no-drivers-${args.join('/')}`, cliResult.status === 0 && !existsSync(join(root, 'DRIVER_INVOKED')), cliResult.stderr); }
    assert('racy-query-index-untouched', beforeIndex.equals(readFileSync(join(root, '.git/index'))));
    git('-c', 'core.fsmonitor=false', 'diff-files', '--no-ext-diff', '--name-only', '--', a); assert('unsafe-control-proves-trap', existsSync(join(root, 'DRIVER_INVOKED')));
    for (const key of ['filter.hostile.clean', 'filter.hostile.smudge', 'diff.hostile.command', 'diff.hostile.textconv', 'core.fsmonitor', 'core.trustctime']) git('config', '--unset', key); reset();
    put(a, raw.replaceAll('\n', '\r\n')); git('config', 'core.autocrlf', 'true'); result = query(); assert('raw-not-git-normalization', named(result).worktreeModified === true && named(result).git.worktree.normalization === 'none-not-git-status-equivalence'); git('config', 'core.autocrlf', 'false'); reset();
    // Only this private test process patches fs; payload text is never executed by the query.
    const drift = action => {
      const preload = join(root, 'preload.mjs'), ino = lstatSync(join(root, z)).ino;
      writeFileSync(preload, `import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';import {execFileSync} from 'node:child_process';const original=fs.readSync;let fired=false;fs.readSync=function(fd,...args){const n=original.call(fs,fd,...args);if(!fired&&n&&fs.fstatSync(fd).ino===${ino}){fired=true;${action}}return n;};syncBuiltinESMExports();`);
      const child = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(preload).href)});const {buildInventory}=await import(${JSON.stringify(pathToFileURL(cli).href)});console.log(JSON.stringify(buildInventory(${JSON.stringify(root)})));`], { cwd: root, env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
      if (child.status !== 0) throw Error(child.stderr); return JSON.parse(child.stdout);
    };
    for (const [name, action] of [
      ['source', `fs.writeFileSync(${JSON.stringify(join(root, a))},'CHANGED_AFTER_READ');`],
      ['ignore', `fs.writeFileSync(${JSON.stringify(join(root, '.gitignore'))},'docs/a.md\\n');`],
      ['raw', `fs.writeFileSync(${JSON.stringify(join(root, `docs/${base.rawMarker}`))},'raw');`],
      ['registry', `fs.appendFileSync(${JSON.stringify(join(root, '.agents/doc-types.json'))},'\\n');`],
      ['index', `execFileSync('git',['update-index','--chmod=+x',${JSON.stringify(a)}],{cwd:${JSON.stringify(root)},stdio:'pipe'});`],
    ]) { result = drift(action); assert(`group-drift-${name}`, !result.coverage.metadataObservation.stable && result.instance.registry.worktreeMatchesIndex === null && !JSON.stringify(result).includes('VISIBLE_OWNER_A') && result.envelopes.every(item => item.worktreeModified === null && !item.git.worktree.digest && item.owner === null)); reset(); }
    let c = run(['--max-files', '1', '--strict', '--json']); assert('metadata-budget-strict', c.status === 1 && JSON.parse(c.stdout).coverage.errors > 0);
    c = run(['--gap', 'worktree-revision-unobserved', '--json']); assert('revision-gap-filter', c.status === 0);
    c = run(['changes', '--git-base', 'HEAD', '--within', 'docs', '--non-sensitive', '--strict', '--json']); assert('standalone-changes-clean', c.status === 0 && JSON.parse(c.stdout).complete && JSON.parse(c.stdout).changed.length === 0);
    c = run(['changes', '--git-base', 'HEAD', '--within', 'docs', '--non-sensitive', '--inventory', '--strict', '--json']); assert('standalone-inventory-not-observation', c.status === 1 && JSON.parse(c.stdout).schema === 'curia.git-change-selection/1');
    put('docs/new.md', md('NEW')); result = changes(); assert('standalone-untracked-default', !result.changed.includes('docs/new.md')); result = changes({ includeUntracked: true }); assert('standalone-untracked-opt-in', result.changed.includes('docs/new.md')); reset();
    for (const args of [['changes', '--git-base', 'HEAD', '--within', 'docs'], ['changes', '--git-base', 'HEAD~1', '--within', 'docs', '--non-sensitive'], ['changes', '--git-base', 'HEAD', '--within', 'docs', '--non-sensitive', '--max-files', '0'], ['--max-file-bytes', '0'], ['--max-total-bytes', '268435457'], ['--max-files', '1', '--max-files', '2']]) assert(`cli-invalid-${args.join('/')}`, run(args).status === 2);
    reject('changes-unknown-effects', () => buildGitChangeQuery('/missing', { base: 'HEAD', within: ['docs'], nonSensitive: true, command: 'execute' }));
    assert('changes-budget-independent', parseGitChangeArgs(['--git-base', 'HEAD', '--within', 'docs', '--non-sensitive', '--max-file-bytes', '100000000']).options.limits.maxFileBytes === 100000000);
    for (let i = 0; i < 129; i++) put(`docs/new-${i}.txt`, 'new'); result = changes({ includeUntracked: true }); assert('standalone-not-capped-by-impact-graph', result.complete && result.changed.length === 129 && result.changeLimit === 2048); reset();
    put('.agents/doc-types.json', '{"padding":"' + 'x'.repeat(1024 * 1024) + '"}'); reject('registry-hard-byte-limit', () => query()); reset();
    const originalHead = git('rev-parse', 'HEAD'), registryLimit = 1024 * 1024, baseJson = JSON.stringify(base);
    put('.agents/doc-types.json', baseJson + ' '.repeat(registryLimit - Buffer.byteLength(baseJson))); git('add', '--', '.agents/doc-types.json'); git('commit', '-qm', 'registry-limit');
    result = query(); assert('registry-exact-limit-accepted', !result.findings.some(f => f.code === 'root-set-baseline-invalid') && result.instance.registry.worktree.completeBytes);
    put('.agents/doc-types.json', baseJson + ' '.repeat(registryLimit + 1 - Buffer.byteLength(baseJson))); git('add', '--', '.agents/doc-types.json'); git('commit', '-qm', 'oversize-registry'); put('.agents/doc-types.json', JSON.stringify(base));
    result = query(); assert('head-registry-size-preflight', result.findings.some(f => f.code === 'root-set-baseline-invalid' && f.detail.includes('字节超限')) && result.coverage.errors > 0);
    c = run(['--strict', '--json']); assert('head-registry-over-limit-strict', c.status === 1 && JSON.parse(c.stdout).findings.some(f => f.code === 'root-set-baseline-invalid'));
    git('reset', '--hard', originalHead);
    const childPatch = join(root, 'blob-limit.mjs');
    put('blob-limit.mjs', `import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';const original=cp.execFileSync;cp.execFileSync=function(cmd,args,options){if(cmd==='git'&&args.includes('cat-file')&&args.includes('blob')){globalThis.observedBlobLimit=options.maxBuffer;return Buffer.alloc(${registryLimit + 1},32);}return original.call(cp,cmd,args,options);};syncBuiltinESMExports();`);
    const capped = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(childPatch).href)});const {buildInventory}=await import(${JSON.stringify(pathToFileURL(cli).href)});const report=buildInventory(${JSON.stringify(root)});console.log(JSON.stringify({report,limit:globalThis.observedBlobLimit}));`], { cwd: root, env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    if (capped.status !== 0) throw Error(capped.stderr); const cappedReport = JSON.parse(capped.stdout);
    assert('head-registry-actual-read-hard-limited', cappedReport.limit === registryLimit && cappedReport.report.findings.some(f => f.code === 'root-set-baseline-invalid' && f.detail.includes('Git 输出字节超限'))); reset();
    const shaRoot = join(root, 'sha256'); mkdirSync(shaRoot); execFileSync('git', ['init', '-q', '--object-format=sha256'], { cwd: shaRoot, env });
    const shaGit = (...args) => execFileSync('git', args, { cwd: shaRoot, env, stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim(); shaGit('config', 'user.name', 'fixture'); shaGit('config', 'user.email', 'fixture@example.invalid');
    put('sha256/.agents/doc-types.json', JSON.stringify(base)); put(`sha256/${a}`, raw); shaGit('add', '--', '.agents/doc-types.json', a); shaGit('commit', '-qm', 'fixture');
    result = buildInventory(shaRoot); assert('sha256-metadata-revision', named(result).git.worktree.blob.algorithm === 'sha256' && named(result).git.worktree.blob.oid === shaGit('rev-parse', `HEAD:${a}`) && named(result).worktreeModified === false);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

/** The Registry declaration, not a historical filename or generated-looking header, identifies its projection. */
export function projectionClassificationFixtures({ expectTrue, registry }) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'curia-projection-classification-')));
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_') || ['CURIA_ROOT', 'CURIA_STAGED', 'CURIA_ROOT', 'CURIA_STAGED', 'NODE_OPTIONS'].includes(key)) delete env[key];
  const git = (...args) => execFileSync('git', args, { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
  const put = (path, value) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), value); };
  const assert = (name, ok, detail = '') => expectTrue(`Curia projection classification [${name}]`, ok, detail);
  const base = structuredClone(registry); delete base.instance; delete base.types.projection.location;
  const original = '# Ordinary original\n\nType: runbook\nStatus: current\nOwner: original-owner\n\nOriginal text.\n';
  const oldPath = '.agents/doc-types.md', regPath = '.agents/doc-types.json';
  const query = (path, options = {}) => buildInventory(root, null, { ...options, ...(options.readMetadata === false ? { selection: { paths: [path] } } : {}) });
  const read = (path, options = {}) => buildReadWorkflow(root, { selection: { paths: [path] }, ...options });
  const named = (report, path) => report.envelopes.find(item => item.identity.path === path);
  const configure = (path, explicit = false) => {
    const reg = { ...base }; if (path === null) delete reg.projection; else reg.projection = path;
    if (explicit) reg.instance = { schema: 'curia.instance/1', owner: 'fixture', surfaces: [
      { id: 'control', kind: 'root', members: [{ path: '.agents', kind: 'directory', role: 'control' }], entry: '.agents/README.md', authorityLinks: ['AGENTS.md'] },
      { id: 'knowledge', kind: 'root', members: [{ path: 'docs', kind: 'directory', role: 'knowledge' }], entry: 'docs/README.md', authorityLinks: ['AGENTS.md'] },
    ], mappings: [{ path: 'docs', kind: 'directory', defaults: { owner: 'fixture', type: 'runbook' } }] };
    put(regPath, JSON.stringify(reg)); put(oldPath, original); if (path) put(path, original);
    git('add', '--', 'AGENTS.md', '.agents', 'docs'); git('commit', '-qm', 'projection fixture', '--allow-empty');
  };
  try {
    git('init', '-q'); git('config', 'user.name', 'fixture'); git('config', 'user.email', 'fixture@example.invalid');
    put('AGENTS.md', '# Fixture\n'); put('.agents/README.md', '# Control\n'); put('docs/README.md', '# Docs\n');
    for (const explicit of [false, true]) for (const path of [oldPath, '.agents/generated/catalog.md', 'docs/generated/catalog.md', 'docs/records/catalog.md']) {
      configure(path, explicit);
      const label = `${explicit ? 'mapped' : 'legacy'}-${path}`, item = named(query(path), path), report = read(path), doc = report.documents.find(item => item.path === path);
      const maintenance = path.startsWith('docs/records/') ? 'record-mechanism-unknown' : 'generated';
      assert(`${label}-query`, item?.type === 'projection' && item.maintenance === maintenance && item.status === 'unknown', JSON.stringify(item));
      assert(`${label}-workflow`, doc?.envelope?.type === 'projection' && doc.envelope.maintenance === maintenance && doc.envelope.status === 'unknown', JSON.stringify(doc?.envelope));
      assert(`${label}-not-verified`, item?.gaps.includes('content-unparsed') && item.gaps.includes('status-unknown') && doc?.envelope?.gaps.includes('content-unparsed'));
      const inventory = named(query(path, { readMetadata: false }), path);
      assert(`${label}-paths-only`, inventory?.type === 'unknown' && inventory.maintenance === 'unknown' && inventory.metadataRead === 'not-parsed');
      if (path !== oldPath) assert(`${label}-old-name-is-original`, named(query(oldPath), oldPath)?.type !== 'projection' && read(oldPath).documents[0]?.envelope?.type !== 'projection');
      if (path.startsWith('docs/records/')) assert(`${label}-record-not-upgraded`, item?.role === 'record' && item.gaps.includes('record-mutation-unknown') && doc?.envelope?.gaps.includes('record-mutation-unknown'));
    }
    configure(null);
    assert('undeclared-filename-is-not-projection', named(query(oldPath), oldPath)?.type !== 'projection' && read(oldPath).documents[0]?.envelope?.type !== 'projection');
    const path = 'docs/generated/catalog.md'; configure(path);
    const located = JSON.parse(readFileSync(join(root, regPath), 'utf8')); located.types.projection.location = [oldPath]; put(regPath, JSON.stringify(located));
    assert('explicit-type-location-is-preserved', named(query(oldPath), oldPath)?.typeSource === 'registry-location' && read(oldPath).documents[0]?.envelope?.typeSource === 'registry-location');
    configure(path);
    put(path, '# Projection\n\nOwner: ' + 'x'.repeat(70000));
    const long = read(path, { limits: { maxFileBytes: 128 * 1024, maxTotalBytes: 256 * 1024 } });
    assert('incomplete-header-does-not-erase-path-declaration', long.documents[0]?.envelope?.type === 'projection' && long.documents[0].envelope.maintenance === 'generated' && long.documents[0].envelope.status === 'unknown');
    put(path, '# Projection\n\n[Missing](./missing.md)\n');
    const linked = named(query(path, { linkCoverage: true }), path);
    assert('explicit-links-do-not-verify-projection', linked?.type === 'projection' && linked.maintenance === 'generated' && linked.gaps.includes('link-target-missing') && linked.status === 'unknown');
    const snapshot = query(path, { readMetadata: false }); put(regPath, JSON.stringify({ ...base, projection: oldPath }));
    const changed = readInventorySelection(snapshot);
    assert('registry-drift-withdraws-classification', !changed.stable && changed.documents.every(doc => !doc.envelope));
    configure('docs/.env');
    const excluded = named(query('docs/.env'), 'docs/.env');
    assert('private-projection-remains-unread', excluded?.type === 'unknown' && excluded.gaps.includes('metadata-privacy-excluded'));
  } finally { rmSync(root, { recursive: true, force: true }); }
}

/** Optional forms reuse path defaults; no new types, files, commands or authority are implied. */
export function representationFixtures({ expectTrue, registry }) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'curia-representation-')));
  const env = { ...process.env }; for (const key of Object.keys(env)) if (key.startsWith('GIT_') || ['CURIA_ROOT', 'CURIA_STAGED', 'CURIA_ROOT', 'CURIA_STAGED', 'NODE_OPTIONS'].includes(key)) delete env[key];
  const git = (...args) => execFileSync('git', args, { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
  const put = (path, value) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), value); };
  const assert = (name, ok, detail = '') => expectTrue(`Curia representation [${name}]`, ok, detail);
  const reject = (name, fn, pattern = /curia2\//) => { let error; try { fn(); } catch (e) { error = e; } assert(name, !!error && pattern.test(error.message), error?.message ?? 'not rejected'); };
  const base = structuredClone(registry); delete base.instance;
  const forms = ['original', 'generated', 'context', 'navigation', 'outbound'];
  const instance = { schema: 'curia.instance/1', owner: 'fixture', surfaces: [
    { id: 'control', kind: 'root', members: [{ path: '.agents', kind: 'directory', role: 'control' }], entry: '.agents/README.md', authorityLinks: ['AGENTS.md'] },
    { id: 'knowledge', kind: 'root', members: [{ path: 'docs', kind: 'directory', role: 'knowledge' }], entry: 'docs/README.md', authorityLinks: ['AGENTS.md'] },
  ], mappings: [{ path: 'docs', kind: 'directory', defaults: { owner: 'fixture' } }, ...forms.map(kind => ({ path: `docs/${kind}.md`, kind: 'file', defaults: { representation: kind } }))] };
  const md = (body = 'Original body.', status = 'current') => `# Manual\n\nType: runbook\nStatus: ${status}\nOwner: original-owner\n\n${body}\n`;
  const save = (config = instance, types = base.types) => { put('.agents/doc-types.json', JSON.stringify({ ...base, types, instance: config })); git('add', '--', 'AGENTS.md', '.agents', 'docs'); git('commit', '-qm', 'representation fixture', '--allow-empty'); };
  const query = options => buildInventory(root, null, options);
  const named = (report, path) => report.envelopes.find(item => item.identity.path === path);
  const read = path => buildReadWorkflow(root, { selection: { paths: [path] } });
  try {
    git('init', '-q'); git('config', 'user.name', 'fixture'); git('config', 'user.email', 'fixture@example.invalid');
    put('AGENTS.md', '# Fixture\n'); put('.agents/README.md', '# Control\n'); put('docs/README.md', '# Docs\n'); put(base.projection, '# Generated registry\n');
    for (const kind of forms) put(`docs/${kind}.md`, md()); put('docs/plain.md', md('Representation: outbound\nGenerated: true'));
    save(); const index = readFileSync(join(root, '.git/index')); let result = query();
    for (const kind of forms) {
      const path = `docs/${kind}.md`, item = named(result, path), report = read(path), form = item?.representation;
      assert(`declared-${kind}`, item?.type === 'runbook' && form?.kind === kind && form.state === 'declared' && form.verification === 'not-performed' && form.declarations[0].source.includes('/defaults/representation'), JSON.stringify(item));
      assert(`read-${kind}`, report.documents[0]?.envelope?.representation?.kind === kind && !report.execution.persisted && report.checks.find(check => check.id === 'curia-read/metadata')?.version === 6);
      assert(`filter-${kind}`, filterEnvelopes(result, { representation: kind }).some(item => item.identity.path === path));
      assert(`not-史料-${kind}`, kind === 'original' || report.unresolved.some(gap => gap.code === 'representation-unverified' && gap.path === path));
      assert(`no-original-write-${kind}`, readFileSync(join(root, path), 'utf8') === md());
    }
    assert('no-index-write', index.equals(readFileSync(join(root, '.git/index'))));
    assert('body-and-absence-not-declarations', !named(result, 'docs/plain.md').representation && filterEnvelopes(result, { representation: 'undeclared' }).some(item => item.identity.path === 'docs/plain.md'));
    assert('existing-registry-projection-derived', named(result, base.projection)?.representation?.kind === 'generated');
    assert('coverage-counts-all-objects', Object.values(result.coverage.byRepresentation).reduce((n, count) => n + count, 0) === result.envelopes.length);
    const inventory = query({ readMetadata: false, selection: { paths: ['docs/context.md'] } });
    assert('paths-only-no-form', !inventory.envelopes[0].representation && inventory.coverage.byRepresentation.unavailable === 1);
    reject('paths-only-filter-rejected', () => filterEnvelopes(inventory, { representation: 'context' }), /representation-metadata-required/);
    for (const value of ['', null, true, 'Original', 'context ', {}, []]) { const bad = structuredClone(instance); bad.mappings[1].defaults.representation = value; reject('invalid-default', () => normalizeInstance(bad, base.types)); }
    for (const value of ['other', 'generated ', true]) reject('invalid-filter', () => filterEnvelopes(result, { representation: value }));
    assert('cli-form-flag', parseArgs(['--representation', 'navigation']).filters.representation === 'navigation');
    const inherited = structuredClone(instance); inherited.mappings[0].defaults.representation = 'original';
    put('docs/records/summary.md', md()); put('docs/history.md', md('Preserved.', 'superseded')); put('docs/.env', 'PRIVATE'); put('docs/attachment.pdf', '%PDF-UNREAD');
    inherited.mappings.push(...['docs/records/summary.md', 'docs/history.md', 'docs/.env', 'docs/attachment.pdf'].map(path => ({ path, kind: 'file', defaults: { representation: 'context' } })));
    save(inherited); result = query();
    assert('specific-field-inheritance', named(result, 'docs/plain.md').representation.kind === 'original' && named(result, 'docs/context.md').representation.kind === 'context' && named(result, 'docs/context.md').representation.declarations.length === 1);
    assert('record-mechanism-not-overwritten', named(result, 'docs/records/summary.md').maintenance === 'record-mechanism-unknown' && named(result, 'docs/records/summary.md').representation.kind === 'context');
    assert('history-not-made-revisable', named(result, 'docs/history.md').maintenance === 'historical-preserved' && named(result, 'docs/history.md').representation.kind === 'context');
    assert('private-form-withheld', !named(result, 'docs/.env').representation && filterEnvelopes(result, { representation: 'unavailable' }).some(item => item.identity.path === 'docs/.env'));
    assert('unsupported-format-declaration-not-reading', named(result, 'docs/attachment.pdf').representation.kind === 'context' && named(result, 'docs/attachment.pdf').metadataRead === 'not-parsed');
    const generated = structuredClone(base.types); generated.runbook.generated = true; save(instance, generated); result = query();
    const conflict = named(result, 'docs/original.md');
    assert('original-generated-conflict', conflict.representation.state === 'conflict' && conflict.representation.kind === null && conflict.representation.declarations.length === 2 && conflict.gaps.includes('representation-conflict'));
    assert('conflict-filter', filterEnvelopes(result, { representation: 'conflict' }).some(item => item.identity.path === 'docs/original.md'));
    assert('conflict-workflow-fails', read('docs/original.md').checks.find(check => check.id === 'curia-read/metadata')?.state === 'fail');
    for (const kind of ['context', 'navigation', 'outbound']) assert(`purpose-compatible-with-generation-${kind}`, named(result, `docs/${kind}.md`).representation.kind === kind && named(result, `docs/${kind}.md`).representation.declarations.length === 2 && !named(result, `docs/${kind}.md`).gaps.includes('representation-conflict'));
    assert('profile-generated-without-mapping', named(result, 'docs/plain.md').representation.kind === 'generated');
    generated.runbook.generated = false; save(instance, generated); assert('false-does-not-prove-original', !named(query(), 'docs/plain.md').representation);
    const fallbackProfiles = structuredClone(base.types);
    for (const name of ['unknown', 'knowledge-direct', 'knowledge-original']) fallbackProfiles[name] = { ...structuredClone(base.types.reference), generated: true };
    put('docs/untyped.md', '# Untyped\n\nPlain content.\n'); put('.agents/untyped.md', '# Untyped\n\nPlain content.\n'); save(instance, fallbackProfiles); result = query();
    for (const path of ['docs/untyped.md', '.agents/untyped.md', 'docs/attachment.pdf']) assert(`fallback-name-is-not-a-type-declaration-${path}`, !named(result, path).representation);
    generated.runbook.generated = 'false'; save(instance, generated); reject('generated-requires-boolean', () => query(), /curia2\/registry-invalid/);
    const native = structuredClone(instance); native.nativeProfiles = { original: { parser: 'markdown-native-header/1', fields: { id: 'doc_id', version: 'Version', lifecycle: 'Status', owner: 'Owner', pointer: 'Pointer' }, lifecycles: { Active: { view: 'current', facets: { effect: 'confirmed', blocker: 'none', dependency: 'none', purpose: 'document' } } }, authorityLinks: ['AGENTS.md'] } };
    native.mappings.push({ path: 'docs/native.md', kind: 'file', nativeProfile: 'original', defaults: { representation: 'outbound' } });
    put('docs/native.md', '# Native\n\ndoc_id: SOURCE-1\nVersion: 7\nStatus: Active\nOwner: original-owner\nPointer: CURRENT\n\nOriginal content.\n'); save(native); result = query();
    const original = named(result, 'docs/native.md'); assert('native-lifecycle-not-flattened', original.status === 'Active' && original.statusView === 'current' && original.maintenance === 'current-revisable' && original.representation.kind === 'outbound' && original.authorityView.verification === 'not-run');
    const snapshot = query({ readMetadata: false, selection: { paths: ['docs/context.md'] } });
    const changed = JSON.parse(readFileSync(join(root, '.agents/doc-types.json'), 'utf8')); changed.instance.mappings.find(item => item.path === 'docs/context.md').defaults.representation = 'generated'; put('.agents/doc-types.json', JSON.stringify(changed));
    const drift = readInventorySelection(snapshot); assert('drift-withdraws-declarations', !drift.stable && drift.documents.every(doc => !doc.envelope));
    assert('only-form-change-is-observed', named(query(), 'docs/context.md').representation.kind === 'generated');
    const preload = join(root, 'drift-preload.mjs'), inode = lstatSync(join(root, 'docs/context.md')).ino;
    writeFileSync(preload, `import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';const original=fs.readSync;let fired=false;fs.readSync=function(fd,...args){const n=original.call(fs,fd,...args);if(!fired&&n&&fs.fstatSync(fd).ino===${inode}){fired=true;fs.appendFileSync(${JSON.stringify(join(root, '.agents/doc-types.json'))},'\\n');}return n;};syncBuiltinESMExports();`);
    const drifted = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(preload).href)});const {buildInventory}=await import(${JSON.stringify(new URL('./curia-query.mjs', import.meta.url).href)});console.log(JSON.stringify(buildInventory(${JSON.stringify(root)})));`], { cwd: root, env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    if (drifted.status !== 0) throw Error(drifted.stderr);
    const withdrawn = JSON.parse(drifted.stdout);
    assert('query-drift-withdraws-all-forms', !withdrawn.coverage.metadataObservation.stable && withdrawn.envelopes.every(item => !item.representation) && withdrawn.coverage.byRepresentation.unavailable === withdrawn.envelopes.length);
    assert('historical-rule-set-retained', READ_RULE_SETS.some(rules => rules.find(rule => rule.id === 'curia-read/metadata')?.version === 4) && READ_RULE_SETS.some(rules => rules.find(rule => rule.id === 'curia-read/metadata')?.version === 6));
    assert('historical-dependency-version-not-reused', READ_RULE_SETS.at(-1).find(rule => rule.id === 'curia-read/metadata').version !== 5);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

/** Every Registry consumer rejects ambiguity before normalizing or writing document data. */
export function registryEntryFixtures({ expectTrue, registry }) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'curia-registry-entry-')));
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_') || ['CURIA_ROOT', 'CURIA_STAGED', 'CURIA_ROOT', 'CURIA_STAGED', 'NODE_OPTIONS'].includes(key)) delete env[key];
  const git = (...args) => execFileSync('git', args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const assert = (name, ok, detail = '') => expectTrue(`Curia Registry entry [${name}]`, ok, detail);
  const failure = fn => { try { fn(); return ''; } catch (error) { return error.message; } };
  const path = join(root, '.agents/doc-types.json'), projection = join(root, registry.projection);
  const canonical = JSON.stringify(registry), sentinel = Buffer.from('UNCHANGED_PROJECTION\n');
  const invalid = [
    ['top-duplicate', canonical.replace(/^\{/, '{"version":"REGISTRY_PRIVATE_VALUE",'), 'json/duplicate-key'],
    ['escaped-duplicate', canonical.replace(/^\{/, '{"\\u0076ersion":999,'), 'json/duplicate-key'],
    ['nested-duplicate', canonical.replace('"rootDirs":', '"rootDirs":[],"rootDirs":'), 'json/duplicate-key'],
    ['array-duplicate', canonical.replace(/^\{/, '{"probe":[{"key":1,"\\u006bey":2}],'), 'json/duplicate-key'],
    ['syntax', '{"fixture":"REGISTRY_PRIVATE_VALUE",', 'json/syntax-invalid'],
    ['depth', '{"probe":' + '['.repeat(65) + '0' + ']'.repeat(65) + '}', 'json/depth-exceeded'],
  ];
  try {
    mkdirSync(dirname(path), { recursive: true }); mkdirSync(dirname(projection), { recursive: true });
    git('init', '-q'); writeFileSync(path, canonical); git('add', '--', '.agents/doc-types.json');
    assert('public-exports-share-parser', queryRegistryParser === parseRegistryJson && projectionRegistryLoader === loadRegistry);
    assert('valid-registry-roundtrip', JSON.stringify(loadRegistry(root)) === canonical && JSON.stringify(projectionRegistryLoader(root)) === canonical);
    assert('separate-object-keys-allowed', JSON.stringify(parseRegistryJson('{"a":{"key":1},"b":{"key":2}}')) === '{"a":{"key":1},"b":{"key":2}}');
    for (const [name, raw, rule] of invalid) {
      writeFileSync(path, raw); writeFileSync(projection, sentinel);
      for (const [entry, loader] of [['shared', loadRegistry], ['projection', projectionRegistryLoader]]) {
        const error = failure(() => loader(root));
        assert(`${name}-${entry}`, error.includes(`[${rule}]`) && !error.includes('REGISTRY_PRIVATE_VALUE'), error);
      }
      for (const [script, args] of [
        ['gen-doc-types.mjs', ['--normalize']], ['gen-doc-types.mjs', []],
        ['gen-doc-types.mjs', ['--check']], ['gen-doc-types.mjs', ['--stdout']],
        ['new-doc.mjs', ['--type', 'plan', '--topic', 'registry-must-not-create']],
        ['curia-query.mjs', ['--root', root, '--coverage', '--json']],
      ]) {
        const result = spawnSync(process.execPath, [fileURLToPath(new URL(`./${script}`, import.meta.url)), ...args], { cwd: root, env: { ...env, CURIA_ROOT: root }, encoding: 'utf8', timeout: 15000 });
        const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
        assert(`${name}-${script}-${args[0] ?? 'write'}`, result.status !== null && result.status !== 0 && output.includes(`[${rule}]`) && !output.includes('REGISTRY_PRIVATE_VALUE') && readFileSync(path, 'utf8') === raw && readFileSync(projection).equals(sentinel) && !existsSync(join(root, '.agents/plans')), output.slice(0, 500));
      }
      git('add', '--', '.agents/doc-types.json'); writeFileSync(path, canonical);
      const stagedError = failure(() => loadRegistry(root, { staged: true }));
      assert(`${name}-bad-index-good-worktree`, stagedError.includes(`[${rule}]`) && JSON.stringify(loadRegistry(root)) === canonical, stagedError);
      git('add', '--', '.agents/doc-types.json'); writeFileSync(path, raw);
      assert(`${name}-good-index-bad-worktree`, JSON.stringify(loadRegistry(root, { staged: true })) === canonical);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
}

/** Projection declarations cannot turn derived-output generation into an authority overwrite. */
export function projectionBoundaryFixtures({ expectTrue, registry }) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'curia-projection-boundary-'))), root = join(base, 'workspace');
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_') || ['CURIA_ROOT', 'CURIA_STAGED', 'CURIA_ROOT', 'CURIA_STAGED', 'NODE_OPTIONS'].includes(key)) delete env[key];
  const cli = fileURLToPath(new URL('./gen-doc-types.mjs', import.meta.url));
  const regPath = join(root, '.agents/doc-types.json'), projectionPath = join(root, '.agents/doc-types.md'), outside = join(base, 'outside.md');
  const assert = (name, ok, detail = '') => expectTrue(`Curia projection boundary [${name}]`, ok, detail);
  const putRegistry = extra => writeFileSync(regPath, `${JSON.stringify({ ...registry, ...extra }, null, 4)}\n`);
  const reset = () => {
    for (const entry of readdirSync(base)) rmSync(join(base, entry), { recursive: true, force: true });
    mkdirSync(join(root, '.agents'), { recursive: true });
    putRegistry({}); writeFileSync(projectionPath, 'ORIGINAL_PROJECTION\n'); writeFileSync(outside, 'OUTSIDE_SENTINEL\n');
  };
  const snapshot = () => {
    const entries = [];
    const walk = (dir, rel = '') => {
      for (const name of readdirSync(dir).sort()) {
        const path = join(dir, name), key = `${rel}/${name}`, stat = lstatSync(path);
        if (stat.isSymbolicLink()) entries.push([key, 'link', readlinkSync(path)]);
        else if (stat.isDirectory()) { entries.push([key, 'directory']); walk(path, key); }
        else if (stat.isFile()) entries.push([key, createHash('sha256').update(readFileSync(path)).digest('hex')]);
      }
    };
    walk(base); return JSON.stringify(entries);
  };
  const run = (args, workingRoot = root) => spawnSync(process.execPath, [cli, ...args], { cwd: base, env: { ...env, CURIA_ROOT: workingRoot }, encoding: 'utf8', timeout: 15000 });
  const rejected = (name, args = ['--normalize']) => {
    const before = snapshot(), result = run(args), output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    assert(name, result.status !== null && result.status !== 0 && /\[(?:curia2\/registry-invalid|projection\/path-boundary)\]/.test(output) && snapshot() === before, output.slice(0, 500));
  };
  try {
    for (const [index, path] of [null, '', '../outside.md', outside, 'C:/outside.md', 'docs\\outside.md', './docs/table.md', 'docs//table.md', 'docs/../table.md', 'docs/.Git/config', 'docs/ table.md', 'docs/table.md ', 'docs./table.md', '.agents/doc-types.json', '.AGENTS/DOC-TYPES.JSON', 'docs/\0table.md'].entries()) {
      reset(); putRegistry({ projection: path });
      let error; try { registryProjectionPath(path); } catch (e) { error = e; }
      assert(`declaration-${index}`, !!error && /curia2\/registry-invalid/.test(error.message));
      rejected(`normalize-declaration-${index}`); rejected(`stdout-declaration-${index}`, ['--stdout']);
    }
    const aliases = [
      ['projection-symlink', () => { rmSync(projectionPath); symlinkSync(outside, projectionPath); }],
      ['projection-dangling-link', () => { rmSync(projectionPath); symlinkSync(join(base, 'missing'), projectionPath); }],
      ['projection-parent-link', () => { mkdirSync(join(base, 'external')); writeFileSync(join(base, 'external/table.md'), 'KEEP'); symlinkSync(join(base, 'external'), join(root, 'docs')); putRegistry({ projection: 'docs/table.md' }); }],
      ['projection-directory', () => { rmSync(projectionPath); mkdirSync(projectionPath); }],
      ['projection-hardlink', () => { rmSync(projectionPath); linkSync(outside, projectionPath); }],
      ['projection-registry-hardlink', () => { rmSync(projectionPath); linkSync(regPath, projectionPath); }],
      ['missing-parent', () => putRegistry({ projection: 'missing/table.md' })],
      ['registry-symlink', () => { writeFileSync(outside, readFileSync(regPath)); rmSync(regPath); symlinkSync(outside, regPath); }],
      ['registry-parent-link', () => { const external = join(base, 'external'); mkdirSync(external); writeFileSync(join(external, 'doc-types.json'), readFileSync(regPath)); writeFileSync(join(external, 'doc-types.md'), 'KEEP'); rmSync(join(root, '.agents'), { recursive: true }); symlinkSync(external, join(root, '.agents')); }],
    ];
    for (const [name, prepare] of aliases) { reset(); prepare(); rejected(`${name}-write`, []); rejected(`${name}-normalize`); }
    reset(); writeFileSync(outside, readFileSync(regPath)); rmSync(regPath); linkSync(outside, regPath); rejected('registry-hardlink-normalize');
    reset();
    const normalized = run(['--normalize']), first = snapshot(), second = run(['--normalize']);
    assert('valid-normalize-idempotent', normalized.status === 0 && second.status === 0 && snapshot() === first && readFileSync(regPath, 'utf8') === `${JSON.stringify(registry, null, 2)}\n`, `${normalized.stderr}${second.stderr}`);
    const stdout = run(['--stdout']), check = run(['--check']);
    assert('valid-stdout-and-check', stdout.status === 0 && check.status === 0 && stdout.stdout === readFileSync(projectionPath, 'utf8') && snapshot() === first, `${stdout.stderr}${check.stderr}`);
    reset(); mkdirSync(join(root, 'generated')); putRegistry({ projection: 'generated/table.md' });
    const custom = run(['--normalize']);
    assert('valid-custom-output', custom.status === 0 && existsSync(join(root, 'generated/table.md')) && readFileSync(projectionPath, 'utf8') === 'ORIGINAL_PROJECTION\n' && readFileSync(outside, 'utf8') === 'OUTSIDE_SENTINEL\n', custom.stderr);
    reset(); putRegistry({ projection: 'missing/table.md' }); const beforeStdout = snapshot(), withoutTarget = run(['--stdout']);
    assert('stdout-does-not-inspect-or-create-output', withoutTarget.status === 0 && snapshot() === beforeStdout, withoutTarget.stderr);
    reset(); const alias = join(base, 'root-alias'); symlinkSync(root, alias); const viaAlias = run(['--normalize'], alias);
    assert('explicit-root-realpath-compatible', viaAlias.status === 0, viaAlias.stderr);
    writeFileSync(projectionPath, 'STALE'); const beforeCheck = snapshot(), stale = run(['--check']);
    assert('stale-check-remains-read-only', stale.status === 1 && /投影过期/.test(stale.stderr) && snapshot() === beforeCheck, stale.stderr);
  } finally { rmSync(base, { recursive: true, force: true }); }
}


/** A caller copy is an assertion, never a second effective configuration. */
function registryAuthorityFixtures({ expectTrue, registry }) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'curia-registry-authority-'))), regPath = '.agents/doc-types.json', doc = 'docs/source.md';
  const env = { ...process.env }; for (const key of Object.keys(env)) if (key.startsWith('GIT_') || ['CURIA_ROOT', 'CURIA_STAGED', 'CURIA_ROOT', 'CURIA_STAGED', 'NODE_OPTIONS'].includes(key)) delete env[key];
  let gitFailed = false;
  const git = (...args) => { try { return execFileSync('git', args, { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] }).toString(); } catch (e) { gitFailed = true; throw e; } };
  const put = (p, value) => { mkdirSync(dirname(join(root, p)), { recursive: true }); writeFileSync(join(root, p), value); };
  const base = structuredClone(registry); delete base.instance;
  base.instance = { schema: 'curia.instance/1', owner: 'DISK_OWNER', surfaces: [
    { id: 'control', kind: 'root', members: [{ path: '.agents', kind: 'directory', role: 'control' }], entry: '.agents/README.md', authorityLinks: ['AGENTS.md'] },
    { id: 'knowledge', kind: 'root', members: [{ path: 'docs', kind: 'directory', role: 'knowledge' }], entry: 'docs/README.md', authorityLinks: ['AGENTS.md'] },
  ] };
  base.globalRules = { ...base.globalRules, registryCopyFixture: { zero: 0, nil: null, flag: false, items: [1, 'two', null], object: { value: 'same' } } };
  const save = value => put(regPath, JSON.stringify(value)), reset = () => save(base);
  const assert = (name, ok, detail = '') => expectTrue(`Curia registry authority [${name}]`, !!ok, detail);
  const query = (candidate = null, options = {}) => buildInventory(root, candidate, { metadataSelection: { paths: [doc] }, ...options });
  const observe = fn => {
    const opened = [], old = fs.openSync; fs.openSync = (...args) => { opened.push(String(args[0])); return old(...args); }; syncBuiltinESMExports();
    try { let result, error; try { result = fn(); } catch (e) { error = e; } return { result, error, opened }; }
    finally { fs.openSync = old; syncBuiltinESMExports(); }
  };
  try {
    put('AGENTS.md', '# Authority\n'); put('.agents/README.md', '# Control\n'); put('docs/README.md', '# Knowledge\n'); put(doc, '# Source\n\nPUBLIC_AUTHORITY_FIXTURE\n'); reset();
    git('init', '-q'); git('add', '--', 'AGENTS.md', '.agents', 'docs'); git('-c', 'user.name=fixture', '-c', 'user.email=fixture@local', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'registry authority fixture');
    const index = git('ls-files', '-s', '-z'), mirror = structuredClone(base), beforeMirror = JSON.stringify(mirror);
    const ordinary = observe(() => query()), matching = observe(() => query(mirror));
    assert('real-open-control-register-and-document', [regPath, doc].every(p => ordinary.opened.includes(join(root, p))));
    assert('default-and-matching-copy-use-file-authority', !ordinary.error && !matching.error && [ordinary.result, matching.result].every(r => r.instance.registry.authority === 'worktree-file' && r.envelopes[0].owner === 'DISK_OWNER'));
    assert('matching-copy-not-mutated', JSON.stringify(mirror) === beforeMirror);
    const reordered = Object.fromEntries(Object.entries(mirror).reverse());
    assert('object-key-order-is-not-an-override', query(reordered).instance.registry.authority === 'worktree-file');
    const copyOnly = JSON.parse(JSON.stringify(base)); assert('fresh-file-copy-compatible', query(copyOnly).envelopes[0].owner === 'DISK_OWNER');
    const nullCopy = parseRegistryJson(JSON.stringify(base));
    assert('null-prototype-file-copy-compatible', query(nullCopy).instance.registry.authority === 'worktree-file');
    const reorder = value => Array.isArray(value) ? value.map(reorder) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reorder(item)])) : value;
    assert('nested-object-key-order-compatible', query(reorder(base)).envelopes[0].owner === 'DISK_OWNER');
    const frozen = structuredClone(base); Object.freeze(frozen.globalRules.registryCopyFixture); Object.freeze(frozen);
    assert('frozen-copy-compatible', query(frozen).instance.registry.authority === 'worktree-file');
    for (const [name, edit] of [
      ['number-vs-string', p => { p.zero = '0'; }],
      ['boolean-vs-number', p => { p.flag = 0; }],
      ['null-vs-undefined', p => { p.nil = undefined; }],
      ['null-vs-non-finite', p => { p.nil = Infinity; }],
      ['array-order', p => { p.items.reverse(); }],
      ['array-hole', p => { delete p.items[2]; }],
      ['array-extra-property', p => { p.items.extra = true; }],
      ['array-extra-symbol', p => { p.items[Symbol('extra')] = true; }],
      ['undefined-extra-key', p => { p.extra = undefined; }],
      ['function-extra-key', p => { p.extra = () => true; }],
      ['symbol-extra-key', p => { p[Symbol('extra')] = true; }],
      ['non-enumerable-extra-key', p => { Object.defineProperty(p, 'extra', { value: true }); }],
      ['custom-prototype', p => { Object.setPrototypeOf(p.object, { inherited: true }); }],
      ['cycle', p => { p.object.value = p; }],
    ]) {
      const candidate = structuredClone(base); edit(candidate.globalRules.registryCopyFixture);
      for (const mode of ['metadata', 'paths']) {
        const observed = observe(() => mode === 'metadata' ? query(candidate) : buildInventory(root, candidate, { readMetadata: false, selection: { paths: [doc] } }));
        assert(`data-copy-${name}-${mode}-rejected`, observed.error?.message.includes('[curia2/registry-source-mismatch]') && !observed.opened.includes(join(root, doc)));
      }
    }
    const accessor = structuredClone(base); let accessorRead = false;
    Object.defineProperty(accessor.globalRules.registryCopyFixture, 'nil', { enumerable: true, get() { accessorRead = true; return null; } });
    const accessorResult = observe(() => query(accessor));
    assert('nested-accessor-is-not-data', accessorResult.error?.message.includes('[curia2/registry-source-mismatch]') && !accessorRead && !accessorResult.opened.includes(join(root, doc)));
    const toJson = structuredClone(base); let serialized = false;
    toJson.globalRules.registryCopyFixture.toJSON = () => { serialized = true; return base.globalRules.registryCopyFixture; };
    const serializationResult = observe(() => query(toJson));
    assert('comparison-does-not-serialize-caller', serializationResult.error?.message.includes('[curia2/registry-source-mismatch]') && !serialized && !serializationResult.opened.includes(join(root, doc)));
    const largeCopy = structuredClone(base); largeCopy.comment = 'x'.repeat(70 * 1024); save(largeCopy);
    assert('copy-comparison-preserves-registry-byte-budget', query(largeCopy).instance.registry.authority === 'worktree-file'); reset();
    for (const [name, edit] of [
      ['owner', p => { p.instance.owner = 'CALLER_ONLY_VALUE'; }],
      ['comment', p => { p.comment = 'CALLER_ONLY_VALUE'; }],
      ['parser', p => { p.instance.mappings = [{ path: doc, kind: 'file', contentParser: 'json-data/1' }]; }],
      ['type-table', p => { p.types = {}; p.resolutionOrder = []; }],
    ]) {
      const candidate = structuredClone(base); edit(candidate);
      for (const mode of ['metadata', 'paths']) {
        const observed = observe(() => mode === 'metadata' ? query(candidate) : buildInventory(root, candidate, { readMetadata: false, selection: { paths: [doc] } }));
        assert(`different-${name}-${mode}-rejected-before-document`, observed.error?.message.includes('[curia2/registry-source-mismatch]') && !observed.opened.includes(join(root, doc)) && !observed.error.message.includes('CALLER_ONLY_VALUE'));
      }
    }
    const unknown = { ...base, version: 99 }; save(unknown);
    for (const [name, call] of [
      ['default', () => query()], ['matching-invalid-copy', () => query(unknown)], ['valid-caller-copy', () => query(base)],
      ['paths-valid-caller-copy', () => buildInventory(root, base, { readMetadata: false, selection: { paths: [doc] } })],
    ]) { const r = observe(call); assert(`unknown-file-schema-${name}-cannot-be-masked`, r.error?.message.includes('[curia2/registry-invalid]') && !r.opened.includes(join(root, doc))); }
    save({ ...base, types: [] }); const malformed = observe(() => query(base));
    assert('invalid-file-type-table-cannot-be-masked', malformed.error?.message.includes('[curia2/registry-invalid]') && !malformed.opened.includes(join(root, doc)));
    reset(); const invalidCaller = observe(() => query({ version: 1, types: [] }));
    assert('invalid-caller-copy-still-rejected', invalidCaller.error?.message.includes('[curia2/registry-invalid]') && !invalidCaller.opened.includes(join(root, doc)));
    const cap = buildInventory(root, base, { readMetadata: false, selection: { paths: [doc] } }), read = readInventorySelection(cap);
    assert('matching-copy-can-create-real-read-snapshot', read.stable && read.documents.length === 1 && read.documents[0].text.includes('PUBLIC_AUTHORITY_FIXTURE') && read.source.registry.authority === 'worktree-file');
    assert('read-snapshot-digest-binds-actual-file', read.source.registry.digest.value === createHash('sha256').update(readFileSync(join(root, regPath))).digest('hex'));
    const mutable = structuredClone(base); let touched = false, oldOpen = fs.openSync, result;
    fs.openSync = (...args) => { if (String(args[0]) === join(root, doc)) { mutable.instance.owner = 'LATE_CALLER_VALUE'; touched = true; } return oldOpen(...args); }; syncBuiltinESMExports();
    try { result = query(mutable); } finally { fs.openSync = oldOpen; syncBuiltinESMExports(); }
    assert('caller-object-not-effective-after-comparison', touched && result.envelopes[0].owner === 'DISK_OWNER' && !JSON.stringify(result).includes('LATE_CALLER_VALUE'));
    const noGit = join(root, 'standalone'); mkdirSync(noGit); put('standalone/.agents/doc-types.json', JSON.stringify(base));
    // An unrelated directory inside this fixture's Git repository is still not a new root.
    const nested = observe(() => buildInventory(noGit, base, { allowNoGit: true }));
    assert('caller-copy-does-not-change-instance-boundary', nested.error?.message.includes('[curia2/root-boundary]'));
    rmSync(noGit, { recursive: true });
    assert('configuration-and-index-unchanged', readFileSync(join(root, regPath), 'utf8') === JSON.stringify(base) && git('ls-files', '-s', '-z') === index);
  } finally { if (gitFailed) console.error(`registry-authority Git fixture retained: ${root}`); else rmSync(root, { recursive: true, force: true }); }
}

if (isMainModule(import.meta.url)) {
  let passed = 0; const failures = [];
  const context = { registry: loadRegistry(), expectTrue: (name, ok, detail = '') => ok ? passed++ : failures.push(`${name}: ${detail}`) };
  registryEntryFixtures(context); projectionBoundaryFixtures(context); projectionClassificationFixtures(context); representationFixtures(context); querySafetyFixtures(context);
  console.log(JSON.stringify({ passed, failed: failures.length, failures }, null, 2)); if (failures.length) process.exitCode = 1;
}
