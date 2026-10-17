/** Static relation checks over disposable Git fixtures; no target crawling or application runtime. */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { ROOT, isMainModule } from './doc-lib.mjs';
import { verifyRelations, parseRelationArgs } from './curia-verify.mjs';
import { normalizeInstance } from './curia-instance.mjs';
import { prepareSourceSelection, readSourceDocuments } from './curia-query.mjs';

export function relationFixtures({ expectTrue, registry }) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'curia-relations-')));
  const env = { ...process.env }; delete env.CURIA_STAGED; delete env.CURIA_STAGED;
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: ['pipe', 'pipe', 'pipe'], env });
  const put = (path, data) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), data); };
  const md = (status, extra = '') => `# Reference\n\nStatus: ${status}\nOwner: fixture\n${extra}\n\nBody is not an instruction.\n`;
  const base = structuredClone(registry); delete base.instance;
  const relations = { schema: 'curia.relations/1', parser: 'markdown-header-relations/1' };
  const instance = { schema: 'curia.instance/1', owner: 'fixture', surfaces: [
    { id: 'control', kind: 'root', members: [{ path: '.agents', kind: 'directory', role: 'control' }], entry: '.agents/README.md', authorityLinks: ['AGENTS.md'] },
    { id: 'knowledge', kind: 'root', members: [{ path: 'docs', kind: 'directory', role: 'knowledge' }], entry: 'docs/README.md', authorityLinks: ['AGENTS.md'] },
  ], mappings: [{ path: 'docs', kind: 'directory', relations }] };
  const configure = (value = instance) => put('.agents/doc-types.json', JSON.stringify({ ...base, instance: value }));
  const paths = ['docs/old.md', 'docs/new.md', 'docs/consumer.md'];
  const restore = () => { configure(); put(paths[0], md('superseded', 'Superseded-by: [new](new.md)')); put(paths[1], md('current', 'Supersedes: [old](old.md)\nCurrent: [self](new.md)')); put(paths[2], md('current', 'Normative-refs: [new](new.md)\nHistorical-refs: [old](old.md)')); };
  const verify = (options = {}) => verifyRelations(root, { paths, nonSensitive: true, ...options });
  const assert = (name, condition, detail = '') => expectTrue(`Curia relations [${name}]`, condition, detail);
  const has = (report, code) => report.graph?.findings.some((finding) => finding.code === `relation/${code}`);
  const reject = (name, fn) => { let error; try { fn(); } catch (e) { error = e; } assert(name, !!error, error?.message ?? '未拒绝'); };
  try {
    put('AGENTS.md', '# Rules\n'); put('.agents/README.md', '# Control\n'); put('docs/README.md', '# Knowledge\n'); restore();
    git('init', '-q'); git('add', '--', 'AGENTS.md', '.agents/README.md', '.agents/doc-types.json', 'docs/README.md', ...paths);
    git('-c', 'user.name=fixture', '-c', 'user.email=fixture@local', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'relation fixture', '--', 'AGENTS.md', '.agents', 'docs');
    const initial = verify();
    assert('reciprocal-declarations-not-cycle', initial.state === 'pass' && !has(initial, 'cycle'), JSON.stringify(initial.graph?.findings));
    assert('current-self-terminal', initial.graph.references.some((ref) => ref.source === paths[1] && ref.kind === 'current' && ref.resolvedCurrent === paths[1]));
    assert('history-not-normalized-away', initial.graph.references.some((ref) => ref.kind === 'historical' && ref.target === paths[0] && ref.state === 'historical-reference'));
    assert('normative-resolves-selected-current', initial.graph.references.some((ref) => ref.kind === 'normative' && ref.state === 'selected-current-reference' && ref.resolvedCurrent === paths[1]));
    assert('bounded-not-global-authority', initial.scope.globalCoverage === false && initial.graph.coverage.global === false && initial.sourceRefs.every((ref) => ref.revision.canonicalization === 'raw-bytes/1') && initial.evidenceRefs.length === 3);
    assert('not-authenticated-or-persisted', initial.verifier.authentication.includes('not-authenticated') && !existsSync(join(root, 'docs/records')));
    put(paths[2], md('current', 'Normative-refs: [old](old.md)'));
    const stale = verify(); assert('reachable-old-not-current', stale.state === 'fail' && has(stale, 'stale-normative-reference')); restore();
    put(paths[1], md('current', 'Superseded-by: [old](old.md)'));
    assert('supersession-cycle', has(verify(), 'cycle')); restore();
    put(paths[0], md('historical', 'Current: [new](new.md)')); put(paths[1], md('forming', 'Current: [old](old.md)'));
    assert('current-pointer-cycle', has(verify(), 'cycle')); restore();
    put(paths[0], md('superseded — archived copy'));
    put(paths[1], md('current'));
    assert('annotated-superseded-needs-successor', has(verify(), 'superseded-without-successor')); restore();
    put(paths[0], md('superseded', 'Superseded-by: [self](old.md)'));
    assert('replacement-self-is-cycle', has(verify(), 'cycle')); restore();
    put(paths[0], md('historical', 'Current: [self](old.md)')); put(paths[1], md('current'));
    assert('historical-self-not-current', has(verify(), 'target-not-current')); restore();
    put(paths[0], md('current', 'Current: [new](new.md)')); put(paths[1], md('current', 'Current: [self](new.md)'));
    assert('duplicate-current-authority', has(verify(), 'multiple-current-authority')); restore();
    put(paths[1], md('current', 'Supersedes: [old](old.md)')); put(paths[2], md('current', 'Supersedes: [old](old.md)'));
    assert('replacement-fork', has(verify(), 'current-fork')); restore();
    put(paths[0], md('current')); assert('current-cannot-already-be-replaced', has(verify(), 'current-already-superseded')); restore();
    put(paths[0], md('superseded')); put(paths[1], md('current'));
    assert('superseded-with-no-successor', has(verify(), 'superseded-without-successor')); restore();
    for (const target of ['outside.md', '../private/DO_NOT_REVEAL.md', 'https://token:SECRET_URL@invalid.example/x', 'new.md#section', 'new%2emd', 'alias/../new.md', '../../../../outside.md']) {
      put(paths[2], md('current', `Normative-refs: [target](${target})`)); const report = verify();
      assert(`unresolved-target-${target}`, report.state === 'incomplete' && report.observation.openedFiles === 3 && !JSON.stringify(report).includes('SECRET_URL') && !JSON.stringify(report).includes('DO_NOT_REVEAL'), JSON.stringify(report.graph?.findings));
    } restore();
    put('docs/child/ref.md', md('current', 'Normative-refs: [new](../new.md)'));
    assert('safe-parent-prefix', verify({ paths: [...paths, 'docs/child/ref.md'], includeUntracked: true }).state === 'pass');
    put(paths[2], md('current', 'Normative-refs: [new](new.md)\nNormative-refs: [new](new.md)'));
    assert('duplicate-fields-not-last-wins', has(verify(), 'field-conflict')); restore();
    put(paths[2], md('current', 'Normative-refs: [new](new.md) trailing ignored stuff'));
    assert('unparsed-tail-not-silent-partial', has(verify(), 'field-invalid')); restore();
    put(paths[2], md('current', 'Current: [old](old.md), [new](new.md)'));
    assert('multiple-current-field', has(verify(), 'field-invalid')); restore();
    put(paths[2], md('current') + '\n```text\nSuperseded-by: [self](consumer.md)\n```\n');
    assert('body-code-is-data', verify().state === 'pass'); restore();
    put(paths[2], Buffer.from([35, 32, 0xff]));
    assert('invalid-utf8-no-metadata', has(verify(), 'source-unavailable')); restore();
    put(paths[2], '\ufeff' + md('current'));
    assert('bom-not-normalized', has(verify(), 'source-unavailable')); restore();
    put(paths[2], md('current') + 'x'.repeat(64 * 1024));
    const over = verify(); assert('full-input-budget', over.state === 'incomplete' && over.observation.openedFiles === 0 && !over.evidenceRefs.length); restore();
    const protectedResult = verify({ protected: true });
    assert('protected-before-read', protectedResult.state === 'incomplete' && protectedResult.observation === null);
    assert('privacy-before-read', verify({ nonSensitive: false }).observation === null);
    const excluded = verify({ exclusions: ['docs/new.md'] }); assert('excluded-peer-revokes-group', excluded.state === 'incomplete' && excluded.observation.openedFiles === 0);
    const context = prepareSourceSelection(root, { paths, nonSensitive: true }); put(paths[1], md('current') + '\n');
    assert('metadata-same-observed-snapshot', !readSourceDocuments(context).stable); restore();
    reject('serialized-metadata-capability', () => readSourceDocuments(JSON.parse(JSON.stringify(prepareSourceSelection(root, { paths, nonSensitive: true })))));
    symlinkSync(join(root, paths[1]), join(root, 'docs/alias.md'));
    assert('selected-alias-no-follow', verify({ paths: [...paths, 'docs/alias.md'], includeUntracked: true }).state === 'incomplete');
    configure({ ...instance, mappings: [] }); const absent = verify();
    assert('optional-disabled-not-pass', absent.state === 'not-applicable' && !absent.graph.coverage.complete); restore();
    configure({ ...instance, mappings: [{ path: paths[2], kind: 'file', relations }] });
    assert('partial-binding-cannot-prove-target', has(verify(), 'binding-missing')); restore();
    for (const [name, edit] of [
      ['schema', r => r.schema = 'future'], ['unknown', r => r.command = 'execute'], ['parser', r => r.parser = 'guess/1'],
      ['reserved-field', r => r.fields = { current: 'Status' }], ['reinterpret-current', r => r.fields = { historical: 'Current' }], ['duplicate-field-binding', r => r.fields = { current: 'Target', normative: 'Target' }],
      ['native-without-profile', r => { r.fields = {}; r.nativePointer = true; }], ['empty-binding', r => r.fields = {}],
    ]) {
      const value = structuredClone(instance); edit(value.mappings[0].relations);
      reject(`invalid-binding-${name}`, () => normalizeInstance(value, base.types));
    }
    const spec = '.agents/plans/2026-10-15-fixture-spec.md';
    put(spec, '# Spec\n\nType: spec\nStatus: done\nOwner: fixture\nUpdated: 2026-10-15\n\n## Contract\n\nCompleted specifications remain authority.\n');
    configure({ ...instance, mappings: [...instance.mappings, { path: spec, kind: 'file', relations }] });
    put(paths[2], md('current', 'Normative-refs: [spec](../.agents/plans/2026-10-15-fixture-spec.md)'));
    assert('completed-spec-stays-current', verify({ paths: [...paths, spec], includeUntracked: true }).state === 'pass'); restore();
    const pointerConfig = structuredClone(instance);
    pointerConfig.mappings.push({ path: 'docs/head.md', kind: 'file', relations: { ...relations, kind: 'current-pointer' } });
    put('docs/head.md', '# Current entry\n\nCurrent: [new](new.md)\n\nNavigation only.\n');
    put(paths[2], md('current', 'Normative-refs: [entry](head.md)'));
    configure(pointerConfig);
    const viaPointer = verify({ paths: [...paths, 'docs/head.md'], includeUntracked: true });
    assert('single-family-pointer-not-second-authority', viaPointer.state === 'pass' && viaPointer.graph.references.some(ref => ref.kind === 'normative' && ref.target === 'docs/head.md' && ref.resolvedCurrent === paths[1]), JSON.stringify(viaPointer.graph?.findings));
    put('docs/head.md', '# Invalid entry\n\nStatus: invented\nCurrent: [new](new.md)\n');
    const invalidPointer = verify({ paths: [...paths, 'docs/head.md'], includeUntracked: true });
    assert('pointer-kind-does-not-launder-invalid-status', invalidPointer.state === 'incomplete' && !invalidPointer.graph.references.some(ref => ref.resolvedCurrent && (ref.source === 'docs/head.md' || ref.target === 'docs/head.md')));
    put('docs/head.md', '# Draft entry\n\nType: spec\nStatus: draft\nCurrent: [new](new.md)\n');
    const draftPointer = verify({ paths: [...paths, 'docs/head.md'], includeUntracked: true });
    assert('pointer-kind-does-not-activate-draft', draftPointer.state !== 'pass' && !draftPointer.graph.references.some(ref => ref.kind === 'normative' && ref.resolvedCurrent));
    put('docs/head.md', '# Current entry\n\nCurrent: [new](new.md)\n');
    put('docs/head-2.md', '# Another entry\n\nCurrent: [new](new.md)\n');
    pointerConfig.mappings.push({ path: 'docs/head-2.md', kind: 'file', relations: { ...relations, kind: 'current-pointer' } }); configure(pointerConfig);
    const duplicateHead = verify({ paths: [...paths, 'docs/head.md', 'docs/head-2.md'], includeUntracked: true });
    assert('duplicate-family-current-pointers', has(duplicateHead, 'multiple-current-pointer') && !duplicateHead.graph.references.some(ref => ref.kind === 'normative' && ref.state === 'selected-current-reference'));
    put('docs/head.md', '# Entry with no target\n');
    assert('current-pointer-empty-not-pass', has(verify({ paths: [...paths, 'docs/head.md'], includeUntracked: true }), 'pointer-target-missing')); restore();
    put(paths[1], md('current', 'Status: historical'));
    assert('metadata-conflict-not-unknown-only', has(verify(), 'metadata-conflict')); restore();
    const cellConfig = structuredClone(instance);
    cellConfig.mappings[0].variant = { defaults: { family: 'api', language: 'en', productVersion: '1', platform: 'all', audience: 'all', canonical: true } };
    configure(cellConfig); assert('current-cell-conflict-before-filter', has(verify(), 'multiple-current-cell')); restore();
    const chainConfig = structuredClone(instance);
    chainConfig.mappings.push({ path: 'docs/entry.md', kind: 'file', relations: { ...relations, kind: 'current-pointer' } });
    configure(chainConfig);
    put('docs/entry.md', '# Entry\n\nCurrent: [middle](middle.md)\n');
    put('docs/middle.md', md('historical', 'Current: [new](new.md)'));
    put(paths[2], md('current', 'Normative-refs: [entry](entry.md)'));
    const chainVerify = () => verify({ paths: [...paths, 'docs/entry.md', 'docs/middle.md'], includeUntracked: true });
    const staleChain = chainVerify();
    assert('normative-chain-does-not-launder-historical-middle', has(staleChain, 'stale-normative-reference') && !staleChain.graph.references.some(ref => ref.kind === 'normative' && ref.resolvedCurrent));
    put('docs/middle.md', md('historical', 'Owner: conflicting\nCurrent: [new](new.md)'));
    const chain = chainVerify();
    assert('intermediate-conflict-withdraws-reference', chain.state === 'fail' && !chain.graph.references.some(ref => ref.kind === 'normative' && ref.resolvedCurrent)); restore();
    put(paths[0], md('historical', 'Current: [middle](consumer.md)'));
    put(paths[2], md('historical', 'Owner: conflicting\nCurrent: [new](new.md)'));
    put(paths[1], md('current', 'Current: [self](new.md)'));
    const indirectCurrent = verify();
    assert('current-chain-retains-intermediate-error', has(indirectCurrent, 'metadata-conflict') && !indirectCurrent.graph.references.some(ref => ref.source === paths[0] && ref.resolvedCurrent)); restore();
    const jsonPointerConfig = structuredClone(instance);
    jsonPointerConfig.mappings.push({ path: 'docs/head.json', kind: 'file', relations: { schema: 'curia.relations/1', parser: 'json-pointer-relations/1', kind: 'current-pointer', fields: { current: '/current' } } });
    configure(jsonPointerConfig); put('docs/head.json', JSON.stringify({ current: 'new.md' }));
    put(paths[2], md('current', 'Normative-refs: [head](head.json)'));
    const simpleJsonPointer = verify({ paths: [...paths, 'docs/head.json'], includeUntracked: true });
    assert('json-navigation-needs-no-native-lifecycle', simpleJsonPointer.state === 'pass' && simpleJsonPointer.graph.references.some(ref => ref.kind === 'normative' && ref.resolvedCurrent === paths[1])); restore();
    const timed = structuredClone(instance); timed.mappings.push({ path: paths[1], kind: 'file', validity: { defaults: { mode: 'interval', from: '2000-01-01T00:00:00Z', until: '2001-01-01T00:00:00Z' } } });
    configure(timed); assert('expired-current-not-washed', has(verify(), 'current-validity-unresolved'));
    put(paths[1], md('current'));
    assert('standalone-expired-current-not-pass', has(verify({ paths: [paths[1]] }), 'current-validity-unresolved')); restore();
    const jsonInstance = structuredClone(instance);
    jsonInstance.nativeProfiles = { manifest: { parser: 'json-native-object/1', authorityLinks: ['AGENTS.md'], fields: { id: '/id', version: '/version', lifecycle: '/state', owner: '/owner', pointer: '/head' }, lifecycles: {
      Current: { view: 'current', facets: { effect: 'confirmed', blocker: 'none', dependency: 'none', purpose: 'manual' } },
      Historical: { view: 'historical', facets: { effect: 'historical', blocker: 'none', dependency: 'none', purpose: 'manual' } },
    } } };
    const jsonRelations = { schema: 'curia.relations/1', parser: 'json-pointer-relations/1', nativePointer: true, fields: { supersedes: '/previous', supersededBy: '/next', normative: '/uses', historical: '/history' } };
    jsonInstance.mappings = [{ path: 'docs', kind: 'directory', defaults: { type: 'reference' }, nativeProfile: 'manifest', relations: jsonRelations }];
    const jsonPaths = ['docs/a.json', 'docs/b.json'];
    const original = (state, head, more = {}) => JSON.stringify({ id: 'fixture', version: '1', state, owner: 'fixture', head, ...more });
    const jsonRestore = () => { configure(jsonInstance); put(jsonPaths[0], original('Historical', './b.json', { next: './b.json' })); put(jsonPaths[1], original('Current', './b.json', { previous: ['./a.json'], history: ['./a.json'] })); };
    const jsonVerify = () => verify({ paths: jsonPaths, includeUntracked: true });
    jsonRestore(); const jsonResult = jsonVerify();
    assert('json-native-pointer-real-bytes', jsonResult.state === 'pass' && jsonResult.graph.references.some(ref => ref.field === 'native.pointer' && ref.locator.pointer === '/head'), JSON.stringify(jsonResult.graph?.findings));
    put(jsonPaths[0], original('Current', './a.json')); put(jsonPaths[1], original('Current', './b.json'));
    assert('native-id-shared-authority', has(jsonVerify(), 'multiple-current-native-id')); jsonRestore();
    put(jsonPaths[1], original('Current', './b.json', { uses: ['./a.json'] })); assert('json-normative-not-history', has(jsonVerify(), 'stale-normative-reference')); jsonRestore();
    put(jsonPaths[1], original('Current', './a.json')); assert('native-pointer-cycle', has(jsonVerify(), 'cycle')); jsonRestore();
    put(jsonPaths[1], original('Current', './b.json').slice(0, -1) + ',"unused":1,"unused":2}'); assert('json-duplicate-key-anywhere', has(jsonVerify(), 'content-invalid')); jsonRestore();
    put(jsonPaths[1], original('Current', './b.json', { uses: [12] })); assert('json-relation-type-no-coercion', has(jsonVerify(), 'field-invalid')); jsonRestore();
    const conflict = structuredClone(jsonInstance); conflict.mappings[0].relations.fields.current = '/head';
    reject('native-pointer-not-double-bound', () => normalizeInstance(conflict, base.types));
    const blocked = structuredClone(jsonInstance); blocked.nativeProfiles.manifest.lifecycles.Current.facets.blocker = 'approval-required'; configure(blocked);
    assert('current-view-not-business-approval', has(jsonVerify(), 'native-eligibility-unverified')); jsonRestore();
    const nativePointerConfig = structuredClone(jsonInstance);
    nativePointerConfig.nativeProfiles.manifest.lifecycles.Blocked = { view: 'current', facets: { effect: 'confirmed', blocker: 'approval-required', dependency: 'none', purpose: 'manual' } };
    nativePointerConfig.mappings.push({ path: 'docs/entry.json', kind: 'file', relations: { schema: 'curia.relations/1', parser: 'json-pointer-relations/1', kind: 'current-pointer', nativePointer: true, fields: {} } });
    configure(nativePointerConfig); put('docs/entry.json', original('Blocked', './b.json'));
    const nativePointer = verify({ paths: [...jsonPaths, 'docs/entry.json'], includeUntracked: true });
    assert('native-pointer-retains-blocker', has(nativePointer, 'native-eligibility-unverified') && !nativePointer.graph.references.some(ref => ref.source === 'docs/entry.json' && ref.resolvedCurrent)); jsonRestore();
    put(jsonPaths[1], original('Current', './b.json', { history: Array.from({ length: 65 }, (_, i) => `missing-${i}.json`) }));
    assert('reference-budget-no-partial-graph', has(jsonVerify(), 'reference-limit') && jsonVerify().graph.nodes.find(node => node.path === jsonPaths[1]).state === 'unparsed'); jsonRestore();
    const inherited = structuredClone(jsonInstance); inherited.mappings.push({ path: jsonPaths[1], kind: 'file', relations });
    reject('inherited-format-conflict', () => normalizeInstance(inherited, base.types));
    const masked = original('Current', './b.json', { history: ['https://user:NEVER_EMIT@invalid.example'] }); put(jsonPaths[1], masked);
    assert('native-uris-not-echoed', !JSON.stringify(jsonVerify()).includes('NEVER_EMIT')); restore();
    const budgetPaths = Array.from({ length: 32 }, (_, i) => `docs/budget-${i}.md`);
    for (const path of budgetPaths) {
      const links = budgetPaths.filter(other => other !== path).map(other => `[peer](${other.slice(5)})`).join(' ');
      put(path, md('current', `Normative-refs: ${links}\nHistorical-refs: ${links}`));
    }
    const graphLimit = verify({ paths: budgetPaths, includeUntracked: true });
    assert('whole-graph-budget-withdraws-partial-result', graphLimit.state === 'incomplete' && has(graphLimit, 'graph-limit') && !graphLimit.graph.nodes.length && !graphLimit.graph.references.length);
    for (const path of budgetPaths.slice(0, 9)) put(path, md('current') + 'x'.repeat(60 * 1024));
    const totalLimit = verify({ paths: budgetPaths.slice(0, 9), includeUntracked: true });
    assert('aggregate-source-budget-before-read', totalLimit.state === 'incomplete' && totalLimit.observation.openedFiles === 0 && !totalLimit.evidenceRefs.length);
    reject('unknown-cli-option', () => parseRelationArgs(['--path', paths[0], '--execute']));
    reject('no-selection', () => parseRelationArgs(['--json']));
    reject('duplicate-selection', () => parseRelationArgs(['--path', paths[0], '--path', paths[0]]));
    const cli = fileURLToPath(new URL('./curia-verify.mjs', import.meta.url));
    const call = () => spawnSync(process.execPath, [cli, 'relations', '--root', root, ...paths.flatMap(path => ['--path', path]), '--non-sensitive', '--json'], { encoding: 'utf8', cwd: root, env });
    assert('actual-cli', call().status === 0); put(paths[2], md('current', 'Normative-refs: [old](old.md)')); assert('actual-cli-failed', call().status === 1); restore();
    put(paths[2], md('current', 'Normative-refs: [missing](not-selected.md)')); assert('actual-cli-incomplete', call().status === 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

if (isMainModule(import.meta.url)) {
  let passed = 0; const failures = [];
  relationFixtures({ registry: JSON.parse(readFileSync(join(ROOT, '.agents/doc-types.json'), 'utf8')), expectTrue: (name, condition, details = '') => condition ? passed++ : failures.push(`${name}: ${details}`) });
  console.log(JSON.stringify({ passed, failed: failures.length, failures }, null, 2)); process.exitCode = failures.length ? 1 : 0;
}
