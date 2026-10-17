/** Reverse-impact plans in disposable Git workspaces; no project runtime or command execution. */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { ROOT, isMainModule } from './doc-lib.mjs';
import { buildImpactWorkflow, buildReadWorkflow, normalizeImpactOptions, parseImpactArgs, IMPACT_RULES, READ_RULE_SETS, READ_RULES } from './curia-workflow.mjs';
import { buildInventory, buildImpactInventory, readInventoryRelations, readInventorySelection, readInventoryDependencies } from './curia-query.mjs';
import { IMPACT_LIMITS, planImpact } from './curia-impact.mjs';
import { normalizeRelations } from './curia-relations.mjs';

export function impactFixtures({ expectTrue, registry }) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'curia-impact-'))), cli = fileURLToPath(new URL('./curia-workflow.mjs', import.meta.url));
  const env = { ...process.env }; for (const key of Object.keys(env)) if (key.startsWith('GIT_') || ['CURIA_ROOT', 'CURIA_STAGED', 'CURIA_ROOT', 'CURIA_STAGED'].includes(key)) delete env[key];
  const git = (...args) => execFileSync('git', args, { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] });
  const put = (path, value) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), value); };
  const assert = (name, ok, detail = '') => expectTrue(`Curia impact [${name}]`, ok, detail);
  const reject = (name, fn) => { let error; try { fn(); } catch (e) { error = e; } assert(name, !!error, error?.message ?? '未拒绝'); };
  const md = (body, fields = '') => `# Fixture\n\nStatus: current\nOwner: fixture\n${fields}\n\n${body}\n`;
  const base = structuredClone(registry); delete base.instance;
  const relations = { schema: 'curia.relations/1', parser: 'markdown-header-relations/1' };
  const instance = { schema: 'curia.instance/1', owner: 'fixture', surfaces: [
    { id: 'control', kind: 'root', members: [{ path: '.agents', kind: 'directory', role: 'control' }], entry: '.agents/README.md', authorityLinks: ['AGENTS.md'] },
    { id: 'knowledge', kind: 'root', members: [{ path: 'docs', kind: 'directory', role: 'knowledge' }], entry: 'docs/README.md', authorityLinks: ['AGENTS.md'] },
  ], mappings: [{ path: 'docs/manuals', kind: 'directory', relations }] };
  const configure = (value = instance) => put('.agents/doc-types.json', JSON.stringify({ ...base, instance: value }));
  const a = 'docs/manuals/a.md', b = 'docs/manuals/b.md', c = 'docs/manuals/c.md', unrelated = 'docs/manuals/unrelated.md';
  const restore = () => { configure(); put(a, md('A_PAYLOAD', 'Normative-refs: [b](b.md)')); put(b, md('B_PAYLOAD', 'Normative-refs: [c](c.md)')); put(c, md('C_PAYLOAD')); put(unrelated, md('UNRELATED_PAYLOAD touch NEVER_EXECUTED')); };
  const options = { changed: [c], within: ['docs/manuals'], nonSensitive: true };
  const plan = extra => buildImpactWorkflow(root, { ...options, ...extra });
  const has = (r, code) => r.unresolved.some(f => f.code === `impact/${code}`);
  const inventory = () => buildImpactInventory(root, { paths: ['docs/manuals'] }, { changed: [c], nonSensitive: true });
  const mutation = fn => {
    const Native = globalThis.TextDecoder; let mutated = false;
    globalThis.TextDecoder = class extends Native { decode(...args) { const text = super.decode(...args); if (!mutated && text.includes('UNRELATED_PAYLOAD')) { mutated = true; fn(); } return text; } };
    try { const report = plan(); assert('mutation-hook', mutated); return report; } finally { globalThis.TextDecoder = Native; }
  };
  try {
    put('AGENTS.md', '# Rules\n'); put('.agents/README.md', '# Control\n'); put('docs/README.md', '# Knowledge\n'); put('.gitignore', 'ignored.md\n'); restore();
    git('init', '-q'); git('add', '--', 'AGENTS.md', '.agents', 'docs', '.gitignore');
    git('-c', 'user.name=fixture', '-c', 'user.email=fixture@local', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'impact fixture', '--', 'AGENTS.md', '.agents', 'docs', '.gitignore');
    const indexBefore = git('ls-files', '-s', '-z').toString(), r = plan();
    assert('impact-chain', r.complete && r.outcome === 'impact-planned' && r.impact.reviewPaths.join(',') === [a, b, c].join(','), JSON.stringify(r.unresolved));
    assert('every-source-inspected-but-no-bodies-emitted', r.coverage.inspected === 4 && r.coverage.bodiesEmitted === 0 && r.documents.length === 4 && !['A_PAYLOAD', 'B_PAYLOAD', 'C_PAYLOAD', 'UNRELATED_PAYLOAD'].some(v => JSON.stringify(r).includes(v)));
    assert('reasons-and-shortest-depth', r.impact.affected.find(x => x.path === a).depth === 2 && r.impact.affected.find(x => x.path === a).reasons[0].via === b && r.impact.affected.find(x => x.path === b).reasons[0].kind === 'normative');
    assert('actual-source-digests-not-seed-assertions', r.sourceRefs.length === 4 && r.evidenceRefs.length === 4 && r.sourceRefs.every(s => s.revision.algorithm === 'sha256' && /Z$/.test(s.observedAt)) && !r.scope.globalCoverage && r.coverage.factVerified === 0);
    assert('no-index-run-or-command-write', indexBefore === git('ls-files', '-s', '-z').toString() && !existsSync(join(root, 'docs/records')) && !existsSync(join(root, 'NEVER_EXECUTED')));
    const backward = plan({ changed: [a] }); assert('reverse-not-forward-context', backward.complete && backward.impact.reviewPaths.join(',') === a);
    assert('multiple-seeds-deduplicated', plan({ changed: [a, c] }).impact.affected.length === 3);
    reject('single-case-alias-not-a-no-impact-result', () => plan({ changed: ['docs/manuals/C.md'] }));
    reject('changed-directory-not-expanded', () => plan({ changed: ['docs/manuals'] }));
    const normal = buildReadWorkflow(root, { selection: { paths: [c] } }); assert('ordinary-workflow-contract-unchanged', normal.documents.length === 1 && !normal.impact && READ_RULE_SETS.at(-1) === READ_RULES && IMPACT_RULES.every(x => !READ_RULES.some(y => x.id === y.id)));
    const inv = plan({ inventoryOnly: true }); assert('inventory-no-source-bytes', inv.outcome === 'not-evaluated' && inv.coverage.inspected === 0 && !inv.complete && inv.impact === null && !JSON.stringify(inv).includes('PAYLOAD'));
    put(c, md('C_PAYLOAD', 'Normative-refs: [a](a.md)')); const cycle = plan(); assert('reference-cycle-is-finite-review-set', cycle.complete && cycle.impact.affected.length === 3); restore();
    put(c, md('C_PAYLOAD', 'Current: [self](c.md)')); assert('self-current-does-not-add-candidate', plan().complete && plan().impact.affected.length === 3); restore();
    put(a, md('A_PAYLOAD', 'Historical-refs: [b](b.md)')); assert('historical-consumer-still-needs-review', plan().impact.reviewPaths.includes(a)); restore();
    put(b, md('B_PAYLOAD')); put(c, md('C_PAYLOAD', 'Supersedes: [b](b.md)')); const supersedes = plan();
    assert('supersession-couples-both-endpoints', supersedes.complete && supersedes.impact.reviewPaths.includes(a) && supersedes.impact.affected.find(x => x.path === b).reasons.some(x => x.direction === 'supersession-peer')); restore();
    put(b, md('B_PAYLOAD', 'Superseded-by: [c](c.md)')); assert('superseded-by-normal-review', plan().complete && plan().impact.reviewPaths.length === 3); restore();
    // A removed source is an explicit changed path, not a claim that it was read or that Git proves deletion.
    const deletionIndex = git('ls-files', '-s', '-z').toString(); rmSync(join(root, c));
    const unstagedDeletion = plan(); assert('unstaged-deletion-needs-no-index-write', unstagedDeletion.complete && unstagedDeletion.impact.reviewPaths.join(',') === [a, b].join(',') && git('ls-files', '-s', '-z').toString() === deletionIndex, JSON.stringify(unstagedDeletion.unresolved));
    const missingCap = inventory(); put(c, md('REAPPEARED'));
    const reappeared = readInventoryRelations(missingCap); assert('missing-source-reappears-before-read-withdraws', !reappeared.stable && reappeared.openedFiles === 0 && reappeared.documents.every(d => d.digest === null)); rmSync(join(root, c));
    git('rm', '--cached', '-q', '--', c);
    const removed = plan(); assert('deleted-path-still-finds-incoming-references', removed.complete && removed.impact.reviewPaths.join(',') === [a, b].join(',') && removed.impact.affected.find(x => x.path === c).inInventory === false && !removed.sourceRefs.some(s => s.uri === `repo:${c}`), JSON.stringify(removed.unresolved));
    put(c, md('C_PAYLOAD')); git('add', '--', c); restore();
    rmSync(join(root, a)); const missingUnchanged = plan(); assert('undeclared-missing-source-still-blocks', !missingUnchanged.complete && missingUnchanged.coverage.inspected === 0); restore();
    put(b, md('B_PAYLOAD', 'Normative-refs: [old](old-name.md)')); const moved = plan({ changed: ['docs/manuals/old-name.md', c] });
    assert('move-old-and-new-names-explicit', moved.complete && moved.impact.reviewPaths.join(',') === [a, b, c].join(',') && moved.impact.changes.length === 2); restore();
    put('packages/contracts/schema.json', '{"PRIVATE_SOURCE_SENTINEL":"never read this"}'); git('add', '--', 'packages/contracts/schema.json');
    put(b, md('B_PAYLOAD', 'Normative-refs: [schema](../../packages/contracts/schema.json)'));
    const codeChange = plan({ changed: ['packages/contracts/schema.json'] });
    assert('code-change-name-outside-scan-no-body-authority', codeChange.complete && codeChange.impact.reviewPaths.join(',') === [a, b].join(',') && !codeChange.sourceRefs.some(s => s.uri.startsWith('repo:packages/')) && !JSON.stringify(codeChange).includes('PRIVATE_SOURCE_SENTINEL'), JSON.stringify(codeChange.unresolved));
    reject('outside-scan-case-alias-is-not-new-name', () => plan({ changed: ['packages/contracts/SCHEMA.json'] }));
    assert('missing-outside-name-is-only-a-name', plan({ changed: ['packages/contracts/no-file.json'] }).scope.changeBasis.includes('caller-declared'));
    restore();
    put('docs/outside.md', md('OUTSIDE_SENTINEL')); git('add', '--', 'docs/outside.md'); put(b, md('B_PAYLOAD', 'Normative-refs: [outside](../outside.md)'));
    const outside = plan(); assert('outside-reference-incomplete', !outside.complete && has(outside, 'target-outside-selection') && !JSON.stringify(outside).includes('OUTSIDE_SENTINEL') && !outside.documents.some(d => d.path === 'docs/outside.md')); restore();
    put(b, md('B_PAYLOAD', 'Normative-refs: [external](https://invalid.example/PRIVATE_URI_SENTINEL)'));
    assert('external-uri-not-followed-or-disclosed', !plan().complete && !JSON.stringify(plan()).includes('PRIVATE_URI_SENTINEL')); restore();
    put(unrelated, md('UNRELATED_PAYLOAD', 'Normative-refs: [missing](NOT_AUTHORIZED_SENTINEL.md)'));
    assert('unknown-unrelated-edges-prevent-false-completeness', !plan().complete && !JSON.stringify(plan()).includes('NOT_AUTHORIZED_SENTINEL')); restore();
    const conf = structuredClone(instance); conf.mappings[0].path = 'docs/manuals/a.md'; conf.mappings[0].kind = 'file'; configure(conf);
    const unmapped = plan(); assert('unmapped-source-not-a-leaf', !unmapped.complete && unmapped.coverage.inspected === 1 && has(unmapped, 'binding-missing') && unmapped.documents.filter(d => !d.parser).every(d => d.state === 'not-read')); restore();
    const allUnboundConfig = structuredClone(instance); allUnboundConfig.mappings = []; configure(allUnboundConfig);
    const allUnbound = plan(); assert('entirely-unbound-is-unknown-not-drift', !allUnbound.complete && allUnbound.input.stable && allUnbound.coverage.inspected === 0 && allUnbound.impact.nodes.length === 4 && has(allUnbound, 'binding-missing')); restore();
    const limited = plan({ limits: { maxFiles: 1 } }); assert('shared-file-budget-keeps-gap', !limited.complete && limited.coverage.openedFiles === 1 && limited.sourceRefs.length === 1);
    const prefix = plan({ limits: { maxFileBytes: 8 } }); assert('prefix-never-proves-absence-or-full-source', !prefix.complete && prefix.sourceRefs.length === 0 && prefix.impact.reviewPaths.length === 1);
    const bytes = [a, b, c, unrelated].reduce((n, p) => n + readFileSync(join(root, p)).length, 0);
    assert('exact-total-budget', plan({ limits: { maxTotalBytes: bytes } }).complete);
    const badFields = md('A_PAYLOAD', 'Normative-refs: [b](b.md)\nNormative-refs: [c](c.md)'); put(a, badFields);
    assert('duplicate-field-not-silently-accepted', !plan().complete && has(plan(), 'field-conflict')); restore();
    for (const [name, content] of [['bom', '\ufeff' + md('A_PAYLOAD')], ['binary', Buffer.from([0, 0xff, 1])], ['invalid-utf8', Buffer.from([0xff])]]) {
      put(a, content); assert(`${name}-incomplete`, !plan().complete); restore();
    }
    // Only the explicit relations binding admits JSON here; no native status or schema is invented.
    const jsonPath = 'docs/manuals/consumer.json', jsonConfig = structuredClone(instance);
    jsonConfig.mappings.push({ path: jsonPath, kind: 'file', relations: { schema: 'curia.relations/1', parser: 'json-pointer-relations/1', fields: { normative: '/refs' } } });
    configure(jsonConfig); put(jsonPath, '{"refs":["c.md"],"value":9007199254740993,"command":"touch NEVER_EXECUTED"}'); git('add', '--', jsonPath);
    const json = plan(); assert('json-relation-source-no-native-requirement', json.complete && json.impact.reviewPaths.includes(jsonPath) && !JSON.stringify(json).includes('9007199254740993'), JSON.stringify(json.unresolved));
    put(jsonPath, '{"refs":["c.md"],"refs":[]}'); assert('json-duplicate-keys-incomplete', !plan().complete);
    git('reset', '-q', 'HEAD', '--', jsonPath); rmSync(join(root, jsonPath)); restore();
    put('docs/manuals/loose.md', md('UNTRACKED_SENTINEL', 'Normative-refs: [c](c.md)'));
    assert('untracked-opt-in-only', !plan().impact.reviewPaths.includes('docs/manuals/loose.md') && plan({ includeUntracked: true }).impact.reviewPaths.includes('docs/manuals/loose.md')); rmSync(join(root, 'docs/manuals/loose.md'));
    put('docs/manuals/private/secret.md', md('PRIVATE_PAYLOAD')); put('docs/manuals/ignored.md', md('IGNORED_PAYLOAD')); put('docs/manuals/raw/one.md', md('RAW_PAYLOAD')); put('docs/manuals/raw/.agents-raw', '');
    git('add', '--', 'docs/manuals/private', 'docs/manuals/raw'); git('add', '-f', '--', 'docs/manuals/ignored.md');
    const privateResult = plan({ includeUntracked: true }); assert('private-raw-and-ignored-not-read', !['PRIVATE_PAYLOAD', 'IGNORED_PAYLOAD', 'RAW_PAYLOAD'].some(v => JSON.stringify(privateResult).includes(v)) && !privateResult.documents.some(d => /private|ignored|raw/.test(d.path)));
    for (const path of ['docs/manuals/private/secret.md', 'docs/manuals/a.key']) reject('private-change-before-io-' + path, () => buildImpactWorkflow(join(root, 'missing'), { ...options, changed: [path] }));
    git('reset', '-q', 'HEAD', '--', 'docs/manuals/private', 'docs/manuals/raw', 'docs/manuals/ignored.md'); rmSync(join(root, 'docs/manuals/private'), { recursive: true }); rmSync(join(root, 'docs/manuals/raw'), { recursive: true }); rmSync(join(root, 'docs/manuals/ignored.md'));
    symlinkSync('c.md', join(root, 'docs/manuals/link.md')); git('add', '--', 'docs/manuals/link.md');
    const unsafe = plan(); assert('symlink-blocks-scan-and-evidence', !unsafe.complete && unsafe.coverage.inspected === 0 && unsafe.sourceRefs.length === 0 && unsafe.impact.affected.length === 0);
    git('reset', '-q', 'HEAD', '--', 'docs/manuals/link.md'); rmSync(join(root, 'docs/manuals/link.md'));
    const originalCap = inventory(); originalCap.envelopes = []; originalCap.input.selection.paths = ['docs/outside.md'];
    assert('public-inventory-not-authority', readInventoryRelations(originalCap).documents.length === 4);
    reject('impact-capability-not-ordinary-read-authority', () => readInventorySelection(inventory()));
    reject('impact-capability-not-dependency-authority', () => readInventoryDependencies(inventory(), { paths: ['docs/manuals'] }, { within: ['docs/manuals'], nonSensitive: true }));
    reject('ordinary-read-inventory-not-impact-authority', () => readInventoryRelations(buildInventory(root, null, { readMetadata: false, selection: { paths: ['docs/manuals'] } })));
    reject('impact-inventory-requires-privacy-before-root', () => buildImpactInventory(join(root, 'absent'), { paths: ['docs/manuals'] }));
    const beforeIgnore = inventory(); put('.gitignore', 'ignored.md\n'+a+'\n');
    const changedIgnore = readInventoryRelations(beforeIgnore);
    assert('ignore-change-after-inventory-before-io', !changedIgnore.stable && changedIgnore.openedFiles === 0 && changedIgnore.documents.every(d => d.digest === null));
    put('.gitignore', 'ignored.md\n');
    reject('serialized-inventory-not-authority', () => readInventoryRelations(JSON.parse(JSON.stringify(originalCap))));
    for (const [name, fn, reset] of [
      ['earlier-source', () => put(a, md('changed earlier')), restore],
      ['ignore', () => put('.gitignore', 'ignored.md\n'+a+'\n'), () => { put('.gitignore', 'ignored.md\n'); restore(); }],
      ['registry', () => put('.agents/doc-types.json', JSON.stringify({ ...base, instance }) + ' '), restore],
      ['index', () => { put('docs/new.md', '# New\n'); git('add', '--', 'docs/new.md'); }, () => { git('reset', '-q', 'HEAD', '--', 'docs/new.md'); rmSync(join(root, 'docs/new.md')); restore(); }],
    ]) {
      const changed = mutation(fn); assert(`scope-drift-withdrawal-${name}`, !changed.complete && !changed.input.stable && changed.sourceRefs.length === 0 && changed.evidenceRefs.length === 0 && changed.impact.affected.length === 0 && changed.documents.every(d => d.state === 'not-read')); reset();
    }
    // Pure graph limits use the same parser contract without creating thousands of files.
    const binding = normalizeRelations(relations, '#/fixture'), envelope = { format: 'md', status: 'current', gaps: [] };
    const doc = (path, fields = '') => ({ path, text: md('DATA', fields), state: 'read', envelope, binding });
    const deep = Array.from({ length: IMPACT_LIMITS.maxDepth + 2 }, (_, i) => doc(`docs/${i}.md`, i ? `Normative-refs: [prior](${i - 1}.md)` : ''));
    const depth = planImpact(deep, ['docs/0.md'], { stable: true }); assert('depth-limit-preserves-gap', !depth.complete && depth.truncated && depth.findings.some(f => f.code === 'impact/depth-limit'));
    const tooMany = Array.from({ length: IMPACT_LIMITS.maxSources + 1 }, (_, i) => doc(`docs/${i}.md`));
    assert('source-limit-not-complete', planImpact(tooMany, ['docs/0.md'], { stable: true }).truncated);
    const dense = Array.from({ length: 270 }, (_, i) => doc(`docs/${i}.md`, 'Normative-refs: ' + Array.from({ length: 64 }, (_, n) => `[t](${n}.md)`).join(' ')));
    const edges = planImpact(dense, ['docs/0.md'], { stable: true }); assert('edge-limit-not-complete', edges.truncated && !edges.complete && edges.references.length === IMPACT_LIMITS.maxEdges);
    for (let i = 0; i <= IMPACT_LIMITS.maxSources; i++) put(`docs/manuals/wide/${i}.md`, md('WIDE_BODY_NOT_READ'));
    const wide = plan({ changed: ['docs/manuals/wide/0.md'], within: ['docs/manuals/wide'], includeUntracked: true });
    assert('source-limit-before-body-io', !wide.complete && wide.coverage.openedFiles === 0 && wide.sourceRefs.length === 0 && wide.impact.truncated && !JSON.stringify(wide).includes('WIDE_BODY_NOT_READ'));
    rmSync(join(root, 'docs/manuals/wide'), { recursive: true });
    assert('unstable-graph-never-emits-candidates', planImpact([doc(a)], [a]).affected.length === 0);
    for (const extra of [{ nonSensitive: false }, { nonSensitive: 'true' }, { within: [] }, { changed: [] }, { changed: ['../x'] }, { changed: [c, c] }, { changed: ['docs/manuals/C.md', c] }, { exclusions: ['docs/manuals'] }, { limits: { maxFiles: 0 } }, { includeUntracked: 'yes' }, { unexpected: true }]) reject('invalid-input-' + JSON.stringify(extra), () => normalizeImpactOptions({ ...options, ...extra }));
    const args = ['--root', root, '--changed', c, '--within', 'docs/manuals', '--non-sensitive', '--strict', '--json'];
    const call = extra => spawnSync(process.execPath, [cli, 'impact', ...args, ...(extra ?? [])], { cwd: root, env, encoding: 'utf8' });
    const ok = call(); assert('actual-cli-complete-zero', ok.status === 0 && JSON.parse(ok.stdout).complete, ok.stderr);
    const no = call(['--max-files', '1']); assert('actual-cli-incomplete-one', no.status === 1 && !JSON.parse(no.stdout).complete);
    assert('actual-cli-invalid-two', call(['--non-sensitive']).status === 2);
    for (const extra of [['--changed', c], ['--within', 'docs/manuals'], ['--foo'], ['--max-files', '0'], ['--max-files', '1\n'], ['--corpus'], ['--dependencies'], ['--protected'], ['--help']]) reject('invalid-cli-' + extra.join('-'), () => parseImpactArgs([...args, ...extra]));
    const discovered = spawnSync(process.execPath, [cli, 'impact', '--list-checks', '--json'], { cwd: root, env, encoding: 'utf8' });
    assert('cli-rules-discovery', discovered.status === 0 && JSON.parse(discovered.stdout).every(rule => rule.id.startsWith('curia-impact/') && rule.required));
  } finally { rmSync(root, { recursive: true, force: true }); }
}

if (isMainModule(import.meta.url)) {
  let passed = 0; const failures = [];
  impactFixtures({ registry: JSON.parse(readFileSync(join(ROOT, '.agents/doc-types.json'), 'utf8')), expectTrue: (name, ok, detail = '') => ok ? passed++ : failures.push(`${name}: ${detail}`) });
  console.log(JSON.stringify({ passed, failed: failures.length, failures }, null, 2)); if (failures.length) process.exitCode = 1;
}
