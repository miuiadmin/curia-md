/** Disposable native 史料 fixtures; no model, network, service or production write. */
import fs, { mkdirSync, mkdtempSync, realpathSync, readFileSync, writeFileSync, rmSync, symlinkSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, isMainModule } from './doc-lib.mjs';
import { normalizeInstance, normalizeGeneration, inspectGeneration } from './curia-instance.mjs';
import { generationBindingFor, prepareSourceSelection } from './curia-query.mjs';
import { buildReadWorkflow } from './curia-workflow.mjs';
import { verifyGeneration, parseGenerationArgs } from './curia-generation.mjs';

export function generationFixtures({ expectTrue, registry }) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'curia-generation-'))), cli = fileURLToPath(new URL('./curia-verify.mjs', import.meta.url));
  const env = { ...process.env }; delete env.CURIA_STAGED; delete env.CURIA_STAGED;
  const put = (path, value) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), value); };
  const git = (...args) => execFileSync('git', args, { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] });
  const assert = (name, condition, detail = '') => expectTrue(`Curia generation [${name}]`, condition, detail);
  const reject = (name, fn) => { let caught = false; try { fn(); } catch { caught = true; } assert(name, caught); };
  const manifest = 'docs/build.json', output = 'docs/result.md', input = 'docs/input.json', config = 'docs/prompt.txt', run = 'docs/receipt.json';
  const fields = Object.fromEntries(['sources', 'conventions', 'output', 'generators', 'mode', 'generatedAt', 'run', 'replay'].map(key => [key, `/native/${key}`]));
  const binding = { schema: 'curia.generation/1', parser: 'json-pointer-generation/1', fields };
  const instance = { schema: 'curia.instance/1', owner: 'fixture', surfaces: [
    { id: 'control', kind: 'root', members: [{ path: '.agents', kind: 'directory', role: 'control' }], entry: '.agents/README.md', authorityLinks: ['AGENTS.md'] },
    { id: 'knowledge', kind: 'root', members: [{ path: 'docs', kind: 'directory', role: 'knowledge' }], entry: 'docs/README.md', authorityLinks: ['AGENTS.md'] },
  ], mappings: [{ path: manifest, kind: 'file', generation: binding }] };
  const base = structuredClone(registry); delete base.instance;
  const configure = (value = instance) => put('.agents/doc-types.json', JSON.stringify({ ...base, instance: value }));
  const revision = path => 'sha256:raw-bytes/1:' + createHash('sha256').update(readFileSync(join(root, path))).digest('hex');
  const ref = path => ({ uri: `repo:${path}`, revision: revision(path) });
  const declaration = () => ({ sources: [ref(input)], conventions: [ref(config)], output: ref(output), generators: [{ kind: 'model', id: 'model-label', version: 'declared-version' }], mode: 'inference', generatedAt: '2026-10-17', run: ref(run), replay: 'unknown' });
  const putManifest = edit => { const value = declaration(); edit?.(value); put(manifest, JSON.stringify({ native: value, unrelated: 'DECLARATION_SENTINEL' })); };
  const restore = () => { configure(); put(input, '{"answer":42}\n'); put(config, 'PROMPT_SENTINEL never run this\n'); put(output, '# RESULT_SENTINEL\n'); put(run, '{"status":"claimed-only"}\n'); putManifest(); };
  const options = { declaration: manifest, output, sources: [input, config, run], nonSensitive: true };
  const verify = (extra = {}) => verifyGeneration(root, { ...options, ...extra });
  const observeOpens = fn => {
    const original = fs.openSync, paths = [];
    fs.openSync = (...args) => { paths.push(String(args[0])); return original(...args); }; syncBuiltinESMExports();
    try { return { result: fn(), paths }; } finally { fs.openSync = original; syncBuiltinESMExports(); }
  };
  const duringDecode = fn => {
    const Native = globalThis.TextDecoder; let changed = false;
    globalThis.TextDecoder = class extends Native { decode(...args) { const value = super.decode(...args); if (!changed && value.includes('DECLARATION_SENTINEL')) { changed = true; fn(); } return value; } };
    try { const result = verify(); assert('decode-hook-exercised', changed); return result; } finally { globalThis.TextDecoder = Native; }
  };
  try {
    put('AGENTS.md', '# Rules\n'); put('.agents/README.md', '# Control\n'); put('docs/README.md', '# Knowledge\n'); restore();
    git('init', '-q'); git('add', '--', 'AGENTS.md', '.agents', 'docs'); git('-c', 'user.name=fixture', '-c', 'user.email=fixture@local', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'generation fixture', '--', 'AGENTS.md', '.agents', 'docs');
    const index = git('ls-files', '-s', '-z').toString(), r = verify();
    assert('all-roles-compared', r.state === 'unchanged' && r.exitCode === 0 && r.comparisons.length === 4, JSON.stringify(r));
    assert('same-selection-and-real-observations', r.sourceRefs.length === 5 && r.sourceRefs.every(s => s.revision?.algorithm === 'sha256' && /Z$/.test(s.observedAt)) && r.observation.openedFiles === 5);
    assert('whole-budget-no-prefix-digest', r.observation.chargedBytes === [manifest, output, input, config, run].reduce((n, p) => n + readFileSync(join(root, p)).length, 0));
    assert('declared-not-authenticated', r.declaration.verification === 'declared-not-verified' && Object.values(r.proof).every(v => v !== 'verified') && r.proof.determinism === 'not-verified');
    assert('no-input-or-prompt-or-result-body', !['PROMPT_SENTINEL', 'RESULT_SENTINEL', 'DECLARATION_SENTINEL', 'claimed-only'].some(s => JSON.stringify(r).includes(s)));
    assert('native-field-locator', r.binding.fields.sources.pointer === '/native/sources' && r.binding.source.endsWith('/generation'));
    assert('no-write-or-run-created', git('ls-files', '-s', '-z').toString() === index && !existsSync(join(root, 'docs/records')));
    for (const [path, role] of [[input, 'source'], [config, 'convention'], [output, 'output'], [run, 'run']]) {
      restore(); put(path, readFileSync(join(root, path)).toString() + 'changed'); const changed = verify();
      assert(`drift-${role}`, changed.state === 'drifted' && changed.exitCode === 1 && changed.comparisons.find(x => x.role === role).state === 'drifted');
    }
    restore(); put(input, Buffer.alloc(90_000, 0xff)); putManifest(); assert('binary-streamed-not-parsed', verify().state === 'unchanged');
    restore(); put(input, Buffer.alloc(0)); putManifest(); assert('empty-source-exact', verify().state === 'unchanged');
    for (const key of Object.keys(fields)) {
      restore(); putManifest(d => { delete d[key]; }); const incomplete = verify();
      assert(`missing-${key}-not-invented`, incomplete.state === 'incomplete' && incomplete.gaps.includes(`generation/${key}-missing`));
    }
    restore(); putManifest(d => { d.replay = 'deterministic'; }); assert('declaration-not-determinism-proof', verify().proof.determinism === 'not-verified');
    for (const edit of [d => { d.mode = 'magic'; }, d => { d.generatedAt = '2026-02-30'; }, d => { d.sources.push(d.sources[0]); }, d => { d.generators[0].secret = 'bad'; }, d => { d.output.unrecognized = true; }]) {
      restore(); putManifest(edit); const bad = verify(); assert('invalid-declaration-fail-closed', bad.state === 'incomplete' && bad.gaps.includes('generation/declaration-invalid') && !bad.declaration);
    }
    restore(); putManifest(d => { d.sources[0] = { uri: 'https://not-authorized.invalid/PRIVATE_SENTINEL', revision: 'unknown' }; });
    const outside = observeOpens(() => verify());
    assert('declaration-does-not-grant-access', outside.result.state === 'incomplete' && outside.result.observation.openedFiles === 1 && !outside.paths.includes(join(root, input)) && !JSON.stringify(outside.result).includes('PRIVATE_SENTINEL'));
    restore(); putManifest(d => { d.sources[0].revision = 'sha1:raw-bytes/1:unknown'; }); assert('unknown-revision-not-current', verify().gaps.includes('generation/revision-unsupported'));
    restore(); putManifest(d => { d.sources[0].locator = '/partial'; }); assert('locator-not-silently-verified', verify().state === 'incomplete');
    restore(); putManifest(d => { d.output = ref(input); }); assert('output-must-be-explicit', verify().gaps.includes('generation/reference-outside-authorization'));
    restore(); const excluded = observeOpens(() => verify({ exclusions: [config] })); assert('excluded-peer-blocks-before-declaration', excluded.result.observation.openedFiles === 0 && !excluded.paths.includes(join(root, manifest)));
    const protectedRead = observeOpens(() => verify({ protected: true })); assert('protected-not-downgraded', protectedRead.paths.length === 0 && protectedRead.result.gaps.includes('generation/protected-verification-unavailable'));
    const inventory = observeOpens(() => verify({ inventoryOnly: true })); assert('inventory-not-content', inventory.result.mode === 'inventory-only' && !inventory.paths.includes(join(root, manifest)));
    reject('non-sensitive-required', () => verify({ nonSensitive: false })); reject('unknown-options', () => verify({ execute: true })); reject('self-bound-output', () => verify({ output: manifest }));
    assert('file-budget-includes-declaration', verify({ limits: { maxFileBytes: 8 } }).observation.openedFiles === 0);
    assert('total-budget-bounded', verify({ limits: { maxTotalBytes: 8 } }).observation.openedFiles === 0);
    restore(); const changedWhileParsing = duringDecode(() => put(output, '# moved\n')); assert('joint-revalidation-after-parsing', changedWhileParsing.gaps.includes('generation/snapshot-changed') && !changedWhileParsing.sourceRefs.length && !changedWhileParsing.declaration);
    restore(); const configChanged = duringDecode(() => put('.agents/doc-types.json', JSON.stringify({ ...base, instance: { ...instance, owner: 'changed' } }))); assert('registry-revalidated', configChanged.gaps.includes('generation/snapshot-changed'));
    restore(); rmSync(join(root, input)); symlinkSync(join(root, output), join(root, input)); assert('symlink-peer-before-read', verify().observation.openedFiles === 0); rmSync(join(root, input)); restore();
    const cap = prepareSourceSelection(root, { paths: [manifest], nonSensitive: true }); reject('serialized-capability-rejected', () => generationBindingFor(JSON.parse(JSON.stringify(cap)), manifest));
    const noBinding = structuredClone(instance); noBinding.mappings = []; configure(noBinding); assert('binding-must-be-explicit', verify().gaps.includes('generation/binding-missing'));
    restore(); const b = normalizeGeneration(binding, 'fixture');
    for (const mutate of [x => { x.schema = 'curia.generation/9'; }, x => { x.unknown = true; }, x => { x.fields.output = x.fields.sources; }, x => { x.fields.output = '/native/sources/0'; }, x => { x.fields.mode = '/bad~9'; }]) { const x = structuredClone(binding); mutate(x); reject('invalid-binding-rejected', () => normalizeGeneration(x, 'fixture')); }
    const conflict = structuredClone(instance); conflict.mappings[0].relations = { schema: 'curia.relations/1', parser: 'json-pointer-relations/1', fields: { normative: '/native' } }; reject('inherited-field-overlap-rejected', () => normalizeInstance(conflict, base.types));
    const inherited = structuredClone(instance); inherited.mappings = [{ path: 'docs', kind: 'directory', generation: binding }, { path: manifest, kind: 'file', generation: { ...binding, fields: { mode: '/replacement' } } }];
    configure(inherited); assert('narrow-binding-replaces-not-merges', verify().gaps.includes('generation/sources-missing'));
    const markdown = 'docs/build.md', mdBinding = { schema: 'curia.generation/1', parser: 'markdown-header-generation/1' };
    restore(); const mdConfig = structuredClone(instance); mdConfig.mappings = [{ path: markdown, kind: 'file', generation: mdBinding }]; configure(mdConfig);
    const mb = normalizeGeneration(mdBinding, 'fixture'), md = declaration();
    const header = Object.entries(mb.fields).map(([k, f]) => `${f}: ${['mode', 'generatedAt', 'replay'].includes(k) ? md[k] : JSON.stringify(md[k])}`).join('\n');
    put(markdown, '# Native generated metadata\n\n' + header + '\n\nBody.\n');
    assert('markdown-native-fields', verify({ declaration: markdown, includeUntracked: true }).state === 'unchanged');
    put(markdown, '# Native generated metadata\n\n' + header + '\nGeneration-mode: inference\n'); assert('duplicate-header-rejected', verify({ declaration: markdown, includeUntracked: true }).gaps.includes('generation/declaration-invalid'));
    assert('duplicate-json-key-rejected', inspectGeneration(Buffer.from('{"native":{},"native":{}}'), manifest, b).state === 'unparsed');
    assert('utf8-rejected', inspectGeneration(Buffer.from([0xff]), manifest, b).state === 'unparsed');
    restore(); put('docs/manual.md', '# Independent manual\n\nAI assisted, independently maintained.\n'); const ordinary = buildReadWorkflow(root, { selection: { paths: ['docs/manual.md'] }, includeUntracked: true });
    assert('ordinary-results-no-generation-requirement', ordinary.documents.length === 1 && !JSON.stringify(ordinary).includes('generation/binding-missing'));
    const args = ['generation', '--root', root, '--declaration', manifest, '--output', output, ...options.sources.flatMap(p => ['--allow-source', p]), '--non-sensitive', '--json'];
    const command = () => spawnSync(process.execPath, [cli, ...args], { cwd: root, env, encoding: 'utf8' });
    let cmd = command(); assert('public-cli-match', cmd.status === 0 && JSON.parse(cmd.stdout).state === 'unchanged', cmd.stderr);
    put(output, '# manual edit\n'); cmd = command(); assert('public-cli-drift', cmd.status === 1 && JSON.parse(cmd.stdout).state === 'drifted');
    restore(); putManifest(d => { d.run = null; }); cmd = command(); assert('public-cli-gap', cmd.status === 2 && JSON.parse(cmd.stdout).state === 'incomplete');
    reject('duplicate-cli-option', () => parseGenerationArgs(['--declaration', manifest, '--declaration', manifest])); reject('unknown-cli-option', () => parseGenerationArgs(['--execute']));
  } finally { rmSync(root, { recursive: true, force: true }); }
}
if (isMainModule(import.meta.url)) {
  let passed = 0; const failures = [];
  generationFixtures({ registry: JSON.parse(readFileSync(join(ROOT, '.agents/doc-types.json'), 'utf8')), expectTrue: (name, condition, detail = '') => condition ? passed++ : failures.push(`${name}: ${detail}`) });
  console.log(JSON.stringify({ passed, failed: failures.length, failures }, null, 2)); if (failures.length) process.exitCode = 1;
}
