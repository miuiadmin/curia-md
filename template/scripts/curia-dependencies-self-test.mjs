/** Disposable static document fixtures for opt-in authorized dependency reads. */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { ROOT, isMainModule } from './doc-lib.mjs';
import { buildReadWorkflow, parseWorkflowArgs, READ_RULES, READ_RULE_SETS, DEPENDENCY_READ_RULES } from './curia-workflow.mjs';
import { buildInventory, normalizeDependencySelection, readInventoryDependencies } from './curia-query.mjs';
import { DEPENDENCY_LIMITS, traverseDependencies } from './curia-dependencies.mjs';

export function dependencyFixtures({ expectTrue, registry }) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'curia-dependencies-')));
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_') || ['CURIA_ROOT', 'CURIA_STAGED', 'CURIA_ROOT', 'CURIA_STAGED'].includes(key)) delete env[key];
  const git = (...args) => execFileSync('git', args, { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] });
  const put = (path, value) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), value); };
  const md = (body, refs = '') => `# Fixture\n\nStatus: current\nOwner: fixture\n${refs}\n\n${body}\n`;
  const relations = { schema: 'curia.relations/1', parser: 'markdown-header-relations/1' };
  const base = structuredClone(registry); delete base.instance;
  const instance = { schema: 'curia.instance/1', owner: 'fixture', surfaces: [
    { id: 'control', kind: 'root', members: [{ path: '.agents', kind: 'directory', role: 'control' }], entry: '.agents/README.md', authorityLinks: ['AGENTS.md'] },
    { id: 'knowledge', kind: 'root', members: [{ path: 'docs', kind: 'directory', role: 'knowledge' }], entry: 'docs/README.md', authorityLinks: ['AGENTS.md'] },
  ], mappings: [{ path: 'docs', kind: 'directory', relations }] };
  const configure = (value = instance) => put('.agents/doc-types.json', JSON.stringify({ ...base, instance: value }));
  const selection = { paths: ['docs/a.md'] }, dependencies = { within: ['docs'], nonSensitive: true };
  const restore = () => { configure(); put('docs/a.md', md('A_MARK', 'Normative-refs: [b](b.md)')); put('docs/b.md', md('B_MARK', 'Normative-refs: [c](c.md)')); put('docs/c.md', md('C_MARK')); };
  const read = (options = {}) => buildReadWorkflow(root, { selection, dependencies, ...options });
  const inventory = () => buildInventory(root, null, { readMetadata: false, selection: normalizeDependencySelection(selection, dependencies).selection });
  const has = (report, code) => report.dependencies?.findings.some(f => f.code === `dependency/${code}`);
  const assert = (name, ok, detail = '') => expectTrue(`Curia dependencies [${name}]`, ok, detail);
  const reject = (name, fn) => { let error; try { fn(); } catch (e) { error = e; } assert(name, !!error, error?.message ?? '未拒绝'); };
  try {
    put('AGENTS.md', '# Rules\n'); put('.agents/README.md', '# Control\n'); put('docs/README.md', '# Knowledge\n');
    restore(); put('docs/unrelated.md', md('UNRELATED_BODY_MUST_NOT_READ'));
    git('init', '-q'); git('add', '--', 'AGENTS.md', '.agents', 'docs');
    git('-c', 'user.name=fixture', '-c', 'user.email=fixture@local', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'dependency fixture', '--', 'AGENTS.md', '.agents', 'docs');
    const plain = buildReadWorkflow(root, { selection });
    assert('default-no-expansion', plain.documents.length === 1 && !plain.dependencies && plain.checks.length === READ_RULES.length);
    const first = read();
    assert('dependency-chain', first.outcome === 'read-complete' && first.documents.map(d => d.path).join(',') === 'docs/a.md,docs/b.md,docs/c.md', JSON.stringify(first.unresolved));
    assert('scope-not-whole-directory-read', !JSON.stringify(first).includes('UNRELATED_BODY_MUST_NOT_READ') && !first.documents.some(d => d.path === 'docs/unrelated.md'));
    assert('same-byte-evidence-and-budget', first.coverage.chargedBytes === first.documents.reduce((n, d) => n + Buffer.byteLength(d.text), 0) && first.documents.every(d => d.digest && d.envelope));
    assert('bounded-not-fact-or-global-closure', first.coverage.factVerified === 0 && first.dependencies.global === false && first.dependencies.complete && first.input.authorization.nonSensitive && !existsSync(join(root, 'docs/records')));
    assert('opt-in-contracts-versioned', first.checks.find(c => c.id === 'curia-read/content').version > READ_RULES.find(c => c.id === 'curia-read/content').version && first.checks.find(c => c.id === 'curia-read/dependencies').required && READ_RULE_SETS.at(-1) === READ_RULES);
    const missing = read({ selection: { paths: ['docs/missing.md'] } });
    assert('seed-missing', missing.outcome === 'blocked' && !missing.documents.length && !missing.dependencies.complete);
    const overlap = read({ selection: { paths: ['docs/a.md', 'docs/b.md'] } });
    assert('overlapping-seeds-read-once', overlap.documents.length === 3 && overlap.coverage.chargedBytes === first.coverage.chargedBytes);
    put('docs/b.md', md('B_MARK', 'Normative-refs: [a](a.md)'));
    const cycle = read(); assert('reference-cycle-terminates-once', cycle.dependencies.complete && cycle.documents.length === 2); restore();
    const onlySeed = read({ dependencies: { within: ['docs/a.md'], nonSensitive: true } });
    assert('dependency-outside-scope', has(onlySeed, 'target-outside-selection') && onlySeed.outcome === 'partial' && onlySeed.documents.length === 1);
    const excluded = read({ selection: { ...selection, exclusions: ['docs/b.md'] } });
    assert('caller-exclusion-cannot-be-readded', has(excluded, 'target-outside-selection') && excluded.documents.length === 1);
    put('docs/private/secret.md', md('NEVER_OPEN_PRIVATE')); put('docs/a.md', md('A_MARK', 'Normative-refs: [private](private/secret.md)'));
    assert('privacy-floor-cannot-be-expanded', !JSON.stringify(read({ includeUntracked: true })).includes('NEVER_OPEN_PRIVATE') && has(read({ includeUntracked: true }), 'target-outside-selection')); restore();
    put('docs/a.md', md('A_MARK', 'Normative-refs: [remote](https://u:NEVER_ECHO@invalid.example/key)'));
    const external = read(); assert('external-not-probed-or-repeated-in-graph', has(external, 'target-syntax-unsupported') && !JSON.stringify(external.dependencies).includes('NEVER_ECHO') && external.documents.length === 1); restore();
    put('docs/new.md', md('NEW_MARK')); put('docs/a.md', md('A_MARK', 'Normative-refs: [new](new.md)'));
    assert('untracked-not-implicit', has(read(), 'target-outside-selection'));
    assert('explicit-untracked-can-be-followed', read({ includeUntracked: true }).dependencies.complete); restore();
    put('.gitignore', 'docs/ignored.md\n'); put('docs/ignored.md', md('NEVER_OPEN_IGNORED')); put('docs/a.md', md('A_MARK', 'Normative-refs: [ignored](ignored.md)'));
    assert('all-does-not-bypass-git-ignore', has(read({ includeUntracked: true }), 'target-outside-selection') && !JSON.stringify(read({ includeUntracked: true })).includes('NEVER_OPEN_IGNORED')); restore();
    symlinkSync(join(root, 'docs/c.md'), join(root, 'docs/alias.md'));
    const alias = read({ includeUntracked: true }); assert('authorized-symlink-still-blocked', alias.outcome === 'blocked' && alias.documents.every(d => d.text === null)); rmSync(join(root, 'docs/alias.md'));
    const files = read({ limits: { maxFiles: 1 } }); assert('file-budget-is-global', !files.dependencies.complete && files.documents.filter(d => d.state === 'read').length === 1 && files.outcome !== 'read-complete');
    const prefix = read({ limits: { maxFileBytes: 20 } }); assert('prefix-not-used-for-dependency-discovery', prefix.documents.length === 1 && prefix.documents[0].state === 'partial' && prefix.documents[0].digest === null && has(prefix, 'source-incomplete'));
    const bytes = read({ limits: { maxTotalBytes: 130 } }); assert('aggregate-byte-budget-is-global', bytes.coverage.chargedBytes <= 130 && !bytes.dependencies.complete);
    configure({ ...instance, mappings: [] }); assert('unmapped-is-not-leaf', has(read(), 'binding-missing')); restore();
    put('docs/a.md', md('A_MARK', 'Normative-refs: [b](b.md)\nNormative-refs: [c](c.md)'));
    assert('duplicate-field-no-partial-discovery', has(read(), 'field-conflict') && read().documents.length === 1); restore();
    put('docs/a.md', md('A_MARK') + '\n```text\nNormative-refs: [other](unrelated.md)\n```\n');
    assert('body-instructions-do-not-become-dependencies', read().dependencies.complete && read().documents.length === 1); restore();
    put('docs/a.md', md('A_MARK', 'Status: historical\nNormative-refs: [b](b.md)'));
    const conflicting = read();
    assert('status-conflict-projected', conflicting.outcome === 'blocked' && conflicting.checks.find(c => c.id === 'curia-read/metadata').state === 'fail' && conflicting.unresolved.some(f => f.code === 'status-conflict')); restore();
    const jsonInstance = structuredClone(instance);
    jsonInstance.mappings.push({ path: 'docs/data.json', kind: 'file', relations: { schema: 'curia.relations/1', parser: 'json-pointer-relations/1', fields: { normative: '/uses' } } });
    configure(jsonInstance); put('docs/data.json', '{"uses":["c.md"],"value":9007199254740993,"Status":"current"}');
    const jsonSelection = { paths: ['docs/data.json'] };
    const json = read({ selection: jsonSelection, includeUntracked: true });
    assert('relation-json-opt-in-keeps-raw-values', json.dependencies.complete && json.documents.some(d => d.path === 'docs/data.json' && d.parser === 'json-dependency-verbatim/1' && d.text.includes('9007199254740993')));
    assert('relation-json-not-general-read-authorization', buildReadWorkflow(root, { selection: jsonSelection, includeUntracked: true }).documents[0].state === 'not-read'); restore();
    const snap = inventory(); put('docs/a.md', md('changed'));
    const drift = readInventoryDependencies(snap, selection, dependencies);
    assert('pre-read-drift-revokes-closure', !drift.stable && !drift.closure.complete && !drift.closure.edges.length && drift.documents.every(d => d.text === null)); restore();
    const Decoder = globalThis.TextDecoder; let changed = false;
    try {
      globalThis.TextDecoder = class extends Decoder { decode(...args) { const text = super.decode(...args); if (!changed && text.includes('B_MARK')) { changed = true; put('docs/a.md', md('changed after first hop')); } return text; } };
      const middleDrift = read();
      assert('later-hop-rechecks-previous-inputs', changed && middleDrift.documents.every(d => d.text === null && d.digest === null) && !middleDrift.dependencies.edges.length && !middleDrift.dependencies.complete);
    } finally { globalThis.TextDecoder = Decoder; restore(); }
    const real = inventory();
    reject('serialized-capability-not-authority', () => readInventoryDependencies(JSON.parse(JSON.stringify(real)), selection, dependencies));
    reject('cannot-widen-a-capability', () => readInventoryDependencies(real, selection, { within: ['.agents', 'docs'], nonSensitive: true }));
    real.envelopes.push({ identity: { path: 'outside/hidden.md' } });
    assert('public-inventory-cannot-forge-read-targets', readInventoryDependencies(real, selection, dependencies).documents.every(d => !d.path.startsWith('outside/')));
    let clockCalled = false;
    reject('privacy-declaration-before-clock-and-io', () => read({ dependencies: { within: ['docs'], nonSensitive: false }, now: () => { clockCalled = true; return '2026-10-15T00:00:00Z'; } }));
    assert('privacy-gate-before-observation', !clockCalled);
    for (const request of [null, {}, { within: ['docs'], nonSensitive: 'true' }, { within: ['../outside'], nonSensitive: true }, { within: ['docs'], nonSensitive: true, execute: true }]) reject('invalid-request', () => read({ dependencies: request }));
    reject('corpus-not-incremental', () => read({ selection: { corpus: true } }));
    for (const args of [ ['--path','docs/a.md','--dependencies'], ['--path','docs/a.md','--within','docs','--non-sensitive'], ['--path','docs/a.md','--dependencies','--within','docs','--non-sensitive','--dependencies'] ]) reject('invalid-cli-expansion', () => parseWorkflowArgs(args));
    const listed = parseWorkflowArgs(['--list-checks', '--dependencies', '--json']); assert('rule-discovery-needs-no-read-scope', listed.flags.dependencyRules && DEPENDENCY_READ_RULES.some(r => r.id === 'curia-read/dependencies'));
    const inventoryOnly = read({ inventoryOnly: true }); assert('inventory-only-does-not-discover-content', inventoryOnly.dependencies.state === 'not-read' && !inventoryOnly.dependencies.complete && inventoryOnly.coverage.contentRead === 0);
    const cli = fileURLToPath(new URL('./curia-workflow.mjs', import.meta.url));
    const args = ['--root', root, '--path', 'docs/a.md', '--dependencies', '--within', 'docs', '--non-sensitive', '--strict', '--json'];
    const call = () => spawnSync(process.execPath, [cli, ...args], { cwd: root, env, encoding: 'utf8' });
    assert('actual-cli-complete', call().status === 0); put('docs/a.md', md('A_MARK', 'Normative-refs: [missing](missing.md)'));
    assert('actual-cli-incomplete-is-nonzero', call().status === 1); restore();
    for (let i = 0; i < 35; i++) put(`docs/deep-${i}.md`, md(`DEPTH_${i}`, i < 34 ? `Normative-refs: [next](deep-${i + 1}.md)` : ''));
    const deep = read({ selection: { paths: ['docs/deep-0.md'] }, includeUntracked: true, limits: { maxFiles: 100 } });
    assert('depth-hard-limit', deep.dependencies.truncated && has(deep, 'depth-limit') && deep.outcome !== 'read-complete');
    const graphPaths = Array.from({ length: 32 }, (_, i) => `docs/graph-${i}.md`);
    for (const path of graphPaths) { const links = graphPaths.filter(other => other !== path).map(other => `[peer](${other.slice(5)})`).join(' '); put(path, md('GRAPH', `Normative-refs: ${links}\nHistorical-refs: ${links}`)); }
    const graph = read({ selection: { paths: [graphPaths[0]] }, includeUntracked: true });
    assert('graph-hard-limit-not-complete', graph.dependencies.truncated && has(graph, 'edge-limit') && graph.dependencies.edges.length <= DEPENDENCY_LIMITS.maxEdges && graph.outcome !== 'read-complete');
    let opened = 0;
    const tooMany = Array.from({ length: DEPENDENCY_LIMITS.maxNodes + 1 }, (_, i) => `docs/${i}.md`);
    const oversized = traverseDependencies({ allowedPaths: tooMany, seeds: tooMany, readDocument() { opened++; } });
    assert('oversized-seed-set-before-read', !oversized.complete && oversized.truncated && opened === 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

if (isMainModule(import.meta.url)) {
  let passed = 0; const failures = [];
  dependencyFixtures({ registry: JSON.parse(readFileSync(join(ROOT, '.agents/doc-types.json'), 'utf8')), expectTrue: (name, condition, detail = '') => condition ? passed++ : failures.push(`${name}: ${detail}`) });
  console.log(JSON.stringify({ passed, failed: failures.length, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
}
