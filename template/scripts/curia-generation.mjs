#!/usr/bin/env node
/** Explicit local generation-binding comparison. Never generate, replay, authorize or attest a model. */
import { ROOT, isMainModule } from './doc-lib.mjs';
import { prepareSourceSelection, readSourceSubset, digestSourceSubset, revalidateSourceSelection, generationBindingFor, normalizeReadSelection, normalizeDigestLimits } from './curia-query.mjs';
import { inspectGeneration, generationReferences } from './curia-instance.mjs';

const plain = x => x && typeof x === 'object' && !Array.isArray(x) && [null, Object.prototype].includes(Object.getPrototypeOf(x)) && !Object.getOwnPropertySymbols(x).length;
const invalid = () => { throw new Error('生成核对需要精确路径、显式非敏感范围及受支持选项 [generation/options-invalid]'); };
export function normalizeGenerationOptions(input) {
  if (!plain(input) || Object.keys(input).some(k => !['declaration', 'output', 'sources', 'exclusions', 'includeUntracked', 'nonSensitive', 'protected', 'inventoryOnly', 'limits'].includes(k)) || input.nonSensitive !== true || !Array.isArray(input.sources) || !input.sources.length) invalid();
  for (const key of ['includeUntracked', 'protected', 'inventoryOnly']) if (input[key] !== undefined && typeof input[key] !== 'boolean') invalid();
  const requested = [input.declaration, input.output, ...input.sources];
  if (requested.some(p => typeof p !== 'string' || /[#%]/u.test(p) || Buffer.byteLength(p) > 4096) || new Set(requested).size !== requested.length) invalid();
  const selection = normalizeReadSelection({ paths: requested, exclusions: input.exclusions ?? [] });
  const limits = normalizeDigestLimits(input.limits);
  if (selection.paths.length > limits.maxFiles || selection.exclusions.length > 128) invalid();
  return { ...input, sources: [...input.sources], exclusions: selection.exclusions, paths: selection.paths, limits, includeUntracked: input.includeUntracked ?? false, inventoryOnly: input.inventoryOnly ?? false, protected: input.protected ?? false };
}

export function verifyGeneration(root = ROOT, input) {
  const options = normalizeGenerationOptions(input);
  const report = {
    schema: 'curia.generation-observation/1', state: 'incomplete', exitCode: 2,
    scope: { declaration: options.declaration, output: options.output, claim: 'declared-local-byte-bindings-only', actualInvocationCoverage: 'not-observed' },
    execution: { persisted: false, effects: ['bounded-local-read'], modelCalls: 'not-invoked', projectGuards: 'not-invoked' },
    proof: { businessFacts: 'not-verified', executionReceipt: 'not-verified', generatorIdentity: 'not-authenticated', determinism: 'not-verified', historicalInputs: 'not-reconstructed', authority: 'not-established' },
    binding: null, declaration: null, comparisons: [], sourceRefs: [], gaps: [],
    observation: { stable: false, chargedBytes: 0, openedFiles: 0, source: null },
  };
  const gap = code => { if (!report.gaps.includes(code)) report.gaps.push(code); };
  if (options.protected) { gap('generation/protected-verification-unavailable'); report.execution.effects = []; return report; }
  const selection = prepareSourceSelection(root, { paths: options.paths, exclusions: options.exclusions, includeUntracked: options.includeUntracked, nonSensitive: true });
  if (options.inventoryOnly) return { ...report, mode: 'inventory-only', selection, gaps: ['generation/content-not-read'] };
  const declarationRead = readSourceSubset(selection, [options.declaration], { maxFiles: 1, maxFileBytes: Math.min(65536, options.limits.maxFileBytes), maxTotalBytes: Math.min(65536, options.limits.maxTotalBytes) });
  report.observation.chargedBytes += declarationRead.chargedBytes; report.observation.openedFiles += declarationRead.openedFiles;
  if (!declarationRead.stable || declarationRead.documents[0]?.state !== 'read') { gap('generation/declaration-unavailable'); return report; }
  const observedDeclaration = declarationRead.documents[0];
  const binding = generationBindingFor(selection, options.declaration);
  const parsed = inspectGeneration(observedDeclaration.bytes, options.declaration, binding);
  const withdraw = () => { report.binding = report.declaration = null; report.comparisons = []; report.sourceRefs = []; report.observation.source = null; report.observation.stable = false; report.state = 'incomplete'; report.exitCode = 2; report.gaps = ['generation/snapshot-changed']; return report; };
  if (!revalidateSourceSelection(selection)) return withdraw();
  if (parsed.state !== 'parsed') { report.gaps = parsed.gaps; return report; }
  report.binding = { parser: binding.parser, source: binding.source, fields: parsed.locations };
  const declaration = parsed.declaration;
  // Metadata is declared, never promoted to observation of a past invocation.
  report.declaration = { generators: declaration.generators, mode: declaration.mode, generatedAt: declaration.generatedAt, replay: declaration.replay, verification: 'declared-not-verified' };
  parsed.gaps.forEach(gap);
  const references = generationReferences(declaration), authorized = new Set(options.sources);
  const expectedByPath = new Map();
  for (const item of references) {
    const path = item.ref.uri.startsWith('repo:') ? item.ref.uri.slice(5) : null;
    if (!path || (item.role === 'output' ? path !== options.output : !authorized.has(path))) { gap('generation/reference-outside-authorization'); continue; }
    item.path = path;
    if (!item.expected) gap('generation/revision-unsupported');
    if (item.ref.locator !== null) gap('generation/locator-not-verified');
    const prior = expectedByPath.get(path);
    if (prior && prior !== item.ref.revision) gap('generation/conflicting-revisions');
    expectedByPath.set(path, item.ref.revision);
  }
  // No declared reference can enlarge the selection or cause unrelated authorized files to be hashed.
  if (report.gaps.some(code => ['generation/reference-outside-authorization', 'generation/revision-unsupported', 'generation/conflicting-revisions'].includes(code))) return report;
  const paths = [...new Set(references.map(item => item.path))];
  if (!paths.length || report.observation.chargedBytes >= options.limits.maxTotalBytes) { gap('generation/byte-or-file-limit'); return report; }
  const hashed = digestSourceSubset(selection, paths, { ...options.limits, maxTotalBytes: options.limits.maxTotalBytes - report.observation.chargedBytes });
  report.observation.chargedBytes += hashed.chargedBytes; report.observation.openedFiles += hashed.openedFiles;
  if (!hashed.stable || !revalidateSourceSelection(selection)) return withdraw();
  const byPath = new Map(hashed.documents.map(doc => [doc.path, doc]));
  if (hashed.documents.some(doc => doc.state !== 'hashed')) { gap('generation/source-unavailable'); return report; }
  for (const item of references) {
    const doc = byPath.get(item.path);
    report.comparisons.push({ role: item.role, index: item.index, path: item.path, expected: item.expected, observed: doc.digest, state: item.expected.value === doc.digest.value ? 'match' : 'drifted', locatorVerification: 'not-performed' });
  }
  report.sourceRefs = [observedDeclaration, ...hashed.documents].map(doc => ({ uri: `repo:${doc.path}`, revision: doc.digest, observedAt: doc.observedAt, locator: { kind: 'whole-file/1' } }));
  report.observation.source = declarationRead.source; report.observation.stable = true;
  report.state = report.comparisons.some(item => item.state === 'drifted') ? 'drifted' : report.gaps.length ? 'incomplete' : 'unchanged';
  report.exitCode = report.state === 'unchanged' ? 0 : report.state === 'drifted' ? 1 : 2;
  return report;
}

export function parseGenerationArgs(argv) {
  const options = { sources: [], exclusions: [] }, flags = {}, seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i], multiple = ['--allow-source', '--exclude'].includes(arg);
    if (seen.has(arg) && !multiple) invalid(); seen.add(arg);
    if (['--json', '--help'].includes(arg)) { flags[arg.slice(2)] = true; continue; }
    if (['--all', '--non-sensitive', '--protected', '--inventory'].includes(arg)) { options[{ '--all': 'includeUntracked', '--non-sensitive': 'nonSensitive', '--protected': 'protected', '--inventory': 'inventoryOnly' }[arg]] = true; continue; }
    if (!['--root', '--declaration', '--output', '--allow-source', '--exclude', '--max-file-bytes', '--max-total-bytes'].includes(arg)) invalid();
    const value = argv[++i]; if (!value || value.startsWith('--')) invalid();
    if (arg === '--root') flags.root = value;
    else if (arg === '--allow-source') options.sources.push(value);
    else if (arg === '--exclude') options.exclusions.push(value);
    else if (arg.startsWith('--max-')) { if (!/^[1-9][0-9]*$/.test(value)) invalid(); options.limits ??= {}; options.limits[arg === '--max-file-bytes' ? 'maxFileBytes' : 'maxTotalBytes'] = Number(value); }
    else options[arg.slice(2)] = value;
  }
  return { options, flags };
}
export function generationMain(argv = process.argv.slice(2)) {
  try {
    const { options, flags } = parseGenerationArgs(argv);
    if (flags.help) { console.log('node scripts/curia-verify.mjs generation --declaration docs/build.json --output docs/result.md --allow-source docs/source.json --allow-source prompts/template.md --allow-source docs/receipt.json --non-sensitive --json\nRegistry mapping.generation 绑定原生 Markdown 头块或 JSON 字段；--allow-source 精确授权输入、生成约定与回执，不从声明推导访问权限。\n--inventory 只盘点；--all 包含未忽略的未入库文件；--exclude 优先。只核对完整原件摘要，不生成、不重放、不核实模型或运行终态。unchanged=0，drifted=1，incomplete/invalid=2。'); return; }
    const result = verifyGeneration(flags.root ?? ROOT, options);
    console.log(flags.json ? JSON.stringify(result, null, 2) : `${result.state}: ${result.gaps.join(', ') || result.scope.claim}`); process.exitCode = result.exitCode;
  } catch { console.error(JSON.stringify({ schema: 'curia.generation-error/1', code: 'generation/options-or-boundary-invalid' })); process.exitCode = 2; }
}
if (isMainModule(import.meta.url)) generationMain();
