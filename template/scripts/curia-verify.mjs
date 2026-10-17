#!/usr/bin/env node
/** Explicit, stateless local comparison. No source-defined commands, network, Run or approval. */
import { createHash } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, isMainModule } from './doc-lib.mjs';
import { prepareSourceSelection, revalidateSourceSelection, readSourceSelection, readSourceDocuments, readSourceSubset, digestSourceSubset, DIGEST_LIMITS, normalizeDigestLimits, readStableFile, normalizeReadSelection } from './curia-query.mjs';
import { compareJsonPointers, validJsonLocator, JSON_NATIVE_LIMITS } from './curia-json.mjs';
import { analyzeRelations, RELATION_LIMITS } from './curia-relations.mjs';
import { inspectOriginalRegister, parseRegisteredOriginalDigestRevision } from './curia-originals.mjs';

export const VERIFICATION_METHODS = Object.freeze(['json-value-equal/1', 'raw-bytes-equal/1']);
export const VERIFICATION_LIMITS = Object.freeze({ maxFiles: 2, maxFileBytes: JSON_NATIVE_LIMITS.maxBytes, maxTotalBytes: JSON_NATIVE_LIMITS.maxBytes * 2 });
export const VERIFIER_FILES = Object.freeze(['curia-verify.mjs', 'curia-query.mjs', 'curia-dependencies.mjs', 'curia-impact.mjs', 'curia-relations.mjs', 'curia-json.mjs', 'curia-instance.mjs', 'curia-originals.mjs', 'curia-applicability.mjs', 'curia-guard-contract.mjs', 'doc-lib.mjs']);
const LIMITATIONS = Object.freeze([
  'only-selected-equality-not-business-truth-or-schema-validation', 'non-atomic-local-worktree-with-postcheck',
  'source-revision-is-full-raw-content-digest-not-head', 'self-reported-tool-not-authenticated-identity-or-approval',
  'source-paths-and-locators-must-also-be-non-sensitive', 'path-floor-is-not-secret-detection',
  'no-network-command-execution-or-implicit-reference-following', 'no-persistence-supersession-or-protected-delivery',
  'host-clock-not-certified', 'code-files-observed-not-attested-loaded-bytes',
]);
const fail = () => { throw new Error('核验参数非法，不接受隐式路径、未支持方法或未知选项 [verify/options-invalid]'); };
const plain = (value) => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)) && !Object.getOwnPropertySymbols(value).length;
const digest = (bytes) => ({ algorithm: 'sha256', canonicalization: 'raw-bytes/1', value: createHash('sha256').update(bytes).digest('hex') });

export function normalizeVerificationOptions(input) {
  if (!plain(input) || !['method', 'left', 'right'].every((key) => Object.hasOwn(input, key)) || Object.keys(input).some((key) => !['method', 'left', 'right', 'exclusions', 'includeUntracked', 'nonSensitive', 'protected'].includes(key)) || !VERIFICATION_METHODS.includes(input.method)) fail();
  for (const key of ['includeUntracked', 'nonSensitive', 'protected']) if (input[key] !== undefined && typeof input[key] !== 'boolean') fail();
  const json = input.method === 'json-value-equal/1';
  for (const operand of [input.left, input.right]) {
    if (!plain(operand) || !Object.hasOwn(operand, 'path') || (json && !Object.hasOwn(operand, 'pointer')) || Object.keys(operand).some((key) => !['path', ...(json ? ['pointer'] : [])].includes(key)) || typeof operand.path !== 'string' || /[#%]/u.test(operand.path) || (json && (!validJsonLocator(operand.pointer) || Buffer.byteLength(operand.pointer, 'utf8') > 4096))) fail();
  }
  const selection = normalizeReadSelection({ paths: [...new Set([input.left.path, input.right.path])], exclusions: input.exclusions ?? [] });
  if (selection.exclusions.length > 128 || [...selection.paths, ...selection.exclusions].some((path) => Buffer.byteLength(path, 'utf8') > 4096)) fail();
  return { ...structuredClone(input), paths: selection.paths, exclusions: selection.exclusions, includeUntracked: input.includeUntracked ?? false, nonSensitive: input.nonSensitive ?? false, protected: input.protected ?? false };
}

/** Full, bounded identities of the implementation's direct and transitive local modules. */
export function verifierCodeIdentity() {
  const dir = dirname(fileURLToPath(import.meta.url));
  return VERIFIER_FILES.map((file) => {
    const path = join(dir, file), stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || realpathSync(path) !== path || stat.size > 1024 * 1024) throw new Error('核验器代码身份不可确认 [verify/code-identity]');
    const bytes = readStableFile(path, stat, 1024 * 1024 - 1), after = lstatSync(path);
    if (bytes.length !== stat.size || ['dev', 'ino', 'mode', 'nlink', 'size', 'mtimeMs', 'ctimeMs'].some((key) => after[key] !== stat[key])) throw new Error('核验器代码身份变化 [verify/code-identity]');
    return { file, digest: digest(bytes) };
  });
}

function decodeJson(bytes) {
  // TextDecoder otherwise consumes a leading BOM, silently changing the JSON input language.
  if (bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) throw Object.assign(new Error(), { code: 'json/bom' });
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw Object.assign(new Error(), { code: 'json/invalid-utf8' }); }
}

export function verifySources(inputRoot = ROOT, input = {}) {
  const options = normalizeVerificationOptions(input), evaluatedAt = new Date().toISOString();
  const operands = [options.left, options.right];
  const locator = (operand) => options.method === 'json-value-equal/1' ? { kind: 'json-pointer/1', pointer: operand.pointer } : { kind: 'whole-file/1' };
  const report = {
    schema: 'curia.verification/1', evaluatedAt, completedAt: null,
    evaluation: { clock: 'host-system-clock', precision: 'instant', contentBaseline: 'current-worktree-not-historical-reconstruction' },
    verifier: null, observation: null,
    assertion: {
      subject: 'selected-source-equality', value: 'equal', state: 'unverified',
      scope: { method: options.method, assurance: 'local-unprotected', requestedAssurance: options.protected ? 'protected' : 'local-unprotected' },
      sourceRefs: operands.map((operand) => ({ uri: `repo:${operand.path}`, revision: null, locator: locator(operand), observedAt: null })),
      evidenceRefs: [], verifiedBy: null, limits: [...LIMITATIONS],
    },
    comparison: null, unresolved: [], exitCode: 2,
  };
  const gap = (code) => { if (!report.unresolved.includes(code)) report.unresolved.push(code); };
  const finish = () => { report.completedAt = new Date().toISOString(); return report; };
  if (options.protected) { gap('authenticated-verifier-required'); return finish(); }
  if (!options.nonSensitive) { gap('privacy-not-declared'); return finish(); }
  let codes;
  try {
    codes = verifierCodeIdentity();
    report.verifier = { kind: 'tool', id: 'curia-verify/1', authentication: 'local-self-reported-not-authenticated', implementation: codes, runtime: { name: 'node', version: process.version, platform: process.platform, arch: process.arch } };
  } catch { gap('verifier-identity-unavailable'); return finish(); }
  let read;
  try {
    read = readSourceSelection(prepareSourceSelection(inputRoot, { paths: options.paths, exclusions: options.exclusions, includeUntracked: options.includeUntracked, nonSensitive: true }), VERIFICATION_LIMITS);
  } catch { gap('source-scope-unavailable'); return finish(); }
  report.observation = {
    source: read.source, privacy: read.privacy, limits: read.limits, stable: read.stable, chargedBytes: read.chargedBytes, openedFiles: read.openedFiles,
    documents: read.documents.map(({ path, state, reason, git }) => ({ path, state, reason, git })),
  };
  const documents = operands.map((operand) => read.documents.find((doc) => doc.path === operand.path));
  for (const [i, doc] of documents.entries()) {
    if (doc?.state !== 'read') { gap(doc?.reason ?? 'source-not-read'); continue; }
    Object.assign(report.assertion.sourceRefs[i], { revision: doc.digest, observedAt: doc.observedAt });
    report.assertion.evidenceRefs.push({ kind: 'local-source-bytes', path: doc.path, contentDigest: doc.digest, observedAt: doc.observedAt, sourceRef: i, locator: locator(operands[i]), verification: 'actual-complete-source-bytes' });
  }
  if (!read.stable || documents.some((doc) => doc?.state !== 'read')) { if (!report.unresolved.length) gap('source-snapshot-incomplete'); return finish(); }
  try {
    report.comparison = options.method === 'raw-bytes-equal/1'
      ? { state: documents[0].bytes.equals(documents[1].bytes) ? 'equal' : 'different' }
      : compareJsonPointers(decodeJson(documents[0].bytes), options.left.pointer, decodeJson(documents[1].bytes), options.right.pointer);
  } catch (error) {
    gap(['json/input-invalid', 'json/byte-limit', 'json/depth-exceeded', 'json/syntax-invalid', 'json/duplicate-key', 'json/pointer-invalid', 'json/bom', 'json/invalid-utf8'].includes(error.code) ? error.code : 'comparison-unavailable');
    return finish();
  }
  try {
    if (JSON.stringify(codes) !== JSON.stringify(verifierCodeIdentity())) throw new Error();
  } catch { report.comparison = null; gap('verifier-identity-changed'); return finish(); }
  if (report.comparison.state === 'missing') { gap('json/locator-missing'); return finish(); }
  report.assertion.state = report.comparison.state === 'equal' ? 'confirmed' : 'contradicted';
  report.assertion.verifiedBy = { identityRef: '#/verifier', action: options.method, observedAt: new Date().toISOString() };
  report.exitCode = report.assertion.state === 'confirmed' ? 0 : 1;
  return finish();
}

function normalizeRelationOptions(input) {
  if (!plain(input) || Object.keys(input).some((key) => !['paths', 'exclusions', 'includeUntracked', 'nonSensitive', 'protected'].includes(key)) || ['includeUntracked', 'nonSensitive', 'protected'].some((key) => input[key] !== undefined && typeof input[key] !== 'boolean')) fail();
  const selection = normalizeReadSelection({ paths: input.paths, exclusions: input.exclusions ?? [] });
  if (selection.paths.length > RELATION_LIMITS.maxFiles || selection.exclusions.length > 128 || [...selection.paths, ...selection.exclusions].some((path) => /[#%]/u.test(path) || Buffer.byteLength(path, 'utf8') > 4096)) fail();
  return { ...selection, includeUntracked: input.includeUntracked ?? false, nonSensitive: input.nonSensitive ?? false, protected: input.protected ?? false };
}

export function verifyRelations(inputRoot = ROOT, input = {}) {
  const options = normalizeRelationOptions(input), evaluatedAt = new Date().toISOString();
  const result = {
    schema: 'curia.reference-check/1', evaluatedAt, completedAt: null, state: 'incomplete', exitCode: 2,
    scope: { paths: options.paths, exclusions: options.exclusions, basis: 'explicit-selected-files', globalCoverage: false, assurance: options.protected ? 'protected-requested' : 'local-unprotected' },
    verifier: null, observation: null, sourceRefs: [], evidenceRefs: [], graph: null, unresolved: [],
    limitations: [...LIMITATIONS, 'typed-fields-only-not-all-prose-links', 'no-implicit-target-read-or-dependency-closure', 'current-view-is-not-authenticated-authority', 'no-global-current-uniqueness-or-historical-reconstruction'],
  };
  const done = () => { result.completedAt = new Date().toISOString(); return result; };
  if (options.protected || !options.nonSensitive) { result.unresolved.push(options.protected ? 'authenticated-verifier-required' : 'privacy-not-declared'); return done(); }
  let codes, read;
  try {
    codes = verifierCodeIdentity();
    result.verifier = { kind: 'tool', id: 'curia-verify/1', authentication: 'local-self-reported-not-authenticated', implementation: codes, runtime: { name: 'node', version: process.version, platform: process.platform, arch: process.arch } };
    const { paths, exclusions, includeUntracked, nonSensitive } = options;
    const { maxFiles, maxFileBytes, maxTotalBytes } = RELATION_LIMITS;
    read = readSourceDocuments(prepareSourceSelection(inputRoot, { paths, exclusions, includeUntracked, nonSensitive }), { maxFiles, maxFileBytes, maxTotalBytes });
  } catch { result.unresolved.push('source-scope-or-verifier-unavailable'); return done(); }
  result.observation = {
    source: read.source, privacy: read.privacy, evaluatedAt: read.evaluatedAt, stable: read.stable, limits: read.limits, chargedBytes: read.chargedBytes, openedFiles: read.openedFiles,
    documents: read.documents.map(({ path, state, reason, git }) => ({ path, state, reason, git })),
  };
  for (const doc of read.documents) {
    result.sourceRefs.push({ uri: `repo:${doc.path}`, revision: doc.digest, locator: { kind: 'whole-file/1' }, observedAt: doc.observedAt });
    if (doc.digest) result.evidenceRefs.push({ kind: 'local-source-bytes', path: doc.path, contentDigest: doc.digest, observedAt: doc.observedAt, verification: 'actual-complete-source-bytes' });
  }
  result.graph = analyzeRelations(read.documents, { stable: read.stable });
  try { if (JSON.stringify(codes) !== JSON.stringify(verifierCodeIdentity())) throw new Error(); }
  catch { result.graph = null; result.unresolved.push('verifier-identity-changed'); return done(); }
  result.state = result.graph.state;
  result.exitCode = { pass: 0, 'not-applicable': 0, fail: 1, incomplete: 2 }[result.state];
  result.unresolved = result.graph.findings.filter((finding) => finding.severity === 'gap');
  return done();
}

/** Exact declaration identities, never discovery of or access to the registered originals. */
export const REGISTER_SET_LIMITS = Object.freeze({ maxFiles: 16, maxFileBytes: JSON_NATIVE_LIMITS.maxBytes, maxTotalBytes: 512 * 1024 });
export function normalizeRegisterSetOptions(input) {
  if (!plain(input) || Object.keys(input).some(key => !['paths', 'exclusions', 'includeUntracked', 'nonSensitive', 'protected'].includes(key)) || !Array.isArray(input.paths) || new Set(input.paths).size !== input.paths.length) fail();
  for (const key of ['includeUntracked', 'nonSensitive', 'protected']) if (input[key] !== undefined && typeof input[key] !== 'boolean') fail();
  const selection = normalizeReadSelection({ paths: input.paths, exclusions: input.exclusions ?? [] });
  if (selection.paths.length > REGISTER_SET_LIMITS.maxFiles || selection.exclusions.length > 128 || [...selection.paths, ...selection.exclusions].some(path => /[#%]/u.test(path) || Buffer.byteLength(path, 'utf8') > 4096)) fail();
  return { ...selection, includeUntracked: input.includeUntracked ?? false, nonSensitive: input.nonSensitive ?? false, protected: input.protected ?? false };
}

export function verifyRegisterSet(inputRoot = ROOT, input = {}) {
  const options = normalizeRegisterSetOptions(input);
  const result = {
    schema: 'curia.original-register-check/1', evaluatedAt: new Date().toISOString(), completedAt: null, state: 'incomplete', exitCode: 2,
    scope: { paths: options.paths, exclusions: options.exclusions, basis: 'explicit-selected-register-files', globalCoverage: false, assurance: options.protected ? 'protected-requested' : 'local-unprotected' },
    verifier: null, observation: null, sourceRefs: [], evidenceRefs: [], comparison: null, unresolved: [],
    coverage: { selectedRegisters: options.paths.length, readRegisters: 0, parsedRegisters: 0, allSelectedRegistersParsed: false, comparedDeclarations: 0, originalsRead: 0, originalsVerified: 0, aliasesChecked: false },
    limitations: ['exact-uri-and-opaque-revision-declarations-only', 'registration-ids-local-to-each-table', 'different-declared-revisions-not-ordered-or-verified', 'equal-digests-do-not-merge-different-source-uris', 'unknown-revision-may-overlap-known-revisions', 'no-path-alias-case-or-unicode-equivalence', 'no-original-probe-read-hash-network-or-decryption', 'no-authenticated-owner-access-or-business-verification', 'non-atomic-local-worktree-with-postcheck', 'source-paths-and-locators-must-also-be-non-sensitive', 'path-floor-is-not-secret-detection', 'no-persistence-or-automatic-deduplication', 'host-clock-not-certified', 'code-files-observed-not-attested-loaded-bytes'],
  };
  const done = () => { result.completedAt = new Date().toISOString(); return result; };
  const gap = (code, path = null) => result.unresolved.push({ code, path });
  if (options.protected || !options.nonSensitive) { gap(options.protected ? 'authenticated-verifier-required' : 'privacy-not-declared'); return done(); }
  let codes, capability, read;
  try {
    codes = verifierCodeIdentity();
    result.verifier = { kind: 'tool', id: 'curia-verify/1', authentication: 'local-self-reported-not-authenticated', implementation: codes, runtime: { name: 'node', version: process.version, platform: process.platform, arch: process.arch } };
    const { paths, exclusions, includeUntracked, nonSensitive } = options;
    capability = prepareSourceSelection(inputRoot, { paths, exclusions, includeUntracked, nonSensitive });
    read = readSourceSelection(capability, REGISTER_SET_LIMITS);
  } catch { gap('registers/scope-or-verifier-unavailable'); return done(); }
  result.observation = { source: read.source, privacy: read.privacy, stable: read.stable, limits: read.limits, chargedBytes: read.chargedBytes, openedFiles: read.openedFiles, documents: read.documents.map(({ path, state, reason, git }) => ({ path, state, reason, git })) };
  // Never derive declarations from a good subset after a peer is missing, truncated or has drifted.
  const entries = [];
  for (const doc of read.documents) {
    if (!read.stable || doc.state !== 'read') { gap(doc.reason ?? 'registers/source-unavailable', doc.path); continue; }
    result.coverage.readRegisters++;
    const sourceRef = result.sourceRefs.length;
    result.sourceRefs.push({ uri: `repo:${doc.path}`, revision: doc.digest, locator: { kind: 'whole-file/1' }, observedAt: doc.observedAt });
    result.evidenceRefs.push({ kind: 'local-source-bytes', path: doc.path, contentDigest: doc.digest, observedAt: doc.observedAt, sourceRef, verification: 'actual-complete-source-bytes' });
    let parsed;
    try { parsed = inspectOriginalRegister({ text: decodeJson(doc.bytes), encodingState: 'valid', truncated: false }, doc.path); }
    catch (error) { parsed = { state: 'unparsed', reason: error.code ?? 'registers/encoding-invalid' }; }
    if (parsed.state !== 'parsed') { gap(parsed.reason, doc.path); continue; }
    result.coverage.parsedRegisters++;
    parsed.originals.forEach((item, index) => entries.push({ item, entry: { register: doc.path, registrationId: item.id, sourceRef, locator: { kind: 'json-pointer/1', pointer: `/originals/${index}` } } }));
  }
  try { if (JSON.stringify(codes) !== JSON.stringify(verifierCodeIdentity())) throw new Error(); }
  catch {
    result.sourceRefs = []; result.evidenceRefs = []; result.verifier = null;
    result.coverage.readRegisters = result.coverage.parsedRegisters = 0;
    gap('verifier-identity-changed'); return done();
  }
  const postcheck = revalidateSourceSelection(capability);
  result.observation.postcheck = { stable: postcheck, basis: 'authorized-source-metadata-and-boundaries-not-byte-reread' };
  if (!postcheck) {
    result.observation.stable = false;
    result.sourceRefs = []; result.evidenceRefs = [];
    result.coverage.readRegisters = result.coverage.parsedRegisters = 0;
    gap('registers/snapshot-changed'); return done();
  }
  if (result.unresolved.length || !read.stable || result.coverage.parsedRegisters !== options.paths.length) return done();
  result.coverage.allSelectedRegistersParsed = true;
  result.coverage.comparedDeclarations = entries.length;
  const identities = new Map(), sources = new Map();
  for (const entry of entries) {
    const { uri, revision } = entry.item.sourceRef, key = JSON.stringify([uri, revision]);
    if (!identities.has(key)) identities.set(key, []);
    identities.get(key).push(entry);
    if (!sources.has(uri)) sources.set(uri, new Map());
    const revisions = sources.get(uri);
    if (!revisions.has(revision)) revisions.set(revision, []);
    revisions.get(revision).push(entry.entry);
  }
  const duplicateDeclarations = [], revisionSets = [];
  for (const group of identities.values()) {
    if (group.length < 2) continue;
    const fields = ['format', 'owner', 'accessRef', 'location', 'encryption'];
    const differingFields = fields.filter(field => new Set(group.map(({ item }) => item[field])).size > 1);
    if (new Set(group.map(({ item }) => item.sourceRef.locator)).size > 1) differingFields.push('sourceRef.locator');
    // Differences are declarations needing reconciliation, not a claim that either original is false.
    duplicateDeclarations.push({ code: 'originals/duplicate-identity-declaration', identity: { uri: group[0].item.sourceRef.uri, revision: group[0].item.sourceRef.revision }, entries: group.map(({ entry }) => entry), differingFields });
  }
  for (const [uri, revisions] of sources) {
    if (revisions.size < 2) continue;
    const unresolved = revisions.has(null);
    revisionSets.push({ uri, state: unresolved ? 'unresolved-overlap' : 'distinct-declared-revisions', revisions: [...revisions].map(([revision, entries]) => ({ revision, entries })) });
    if (unresolved) gap('originals/revision-overlap-unresolved');
  }
  result.comparison = { basis: 'exact-declaration-values', complete: result.unresolved.length === 0, identities: identities.size, duplicateDeclarations, revisionSets, currentSelection: 'not-performed', aliasResolution: 'not-performed' };
  result.state = duplicateDeclarations.length ? 'fail' : result.unresolved.length ? 'incomplete' : entries.length ? 'pass' : 'not-applicable';
  result.exitCode = { pass: 0, 'not-applicable': 0, fail: 1, incomplete: 2 }[result.state];
  return done();
}

export function parseRegisterSetArgs(argv) {
  const out = { root: ROOT, options: { paths: [], exclusions: [] }, json: false, help: false }, seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (seen.has(arg) && !['--register', '--exclude'].includes(arg)) fail();
    seen.add(arg);
    const value = () => { const v = argv[++i]; if (!v || v.startsWith('--')) fail(); return v; };
    if (arg === '--register') out.options.paths.push(value());
    else if (arg === '--exclude') out.options.exclusions.push(value());
    else if (arg === '--root') out.root = value();
    else if (arg === '--non-sensitive') out.options.nonSensitive = true;
    else if (arg === '--all') out.options.includeUntracked = true;
    else if (arg === '--protected') out.options.protected = true;
    else if (arg === '--json') out.json = true;
    else if (arg === '--help' || arg === '-h') out.help = true;
    else fail();
  }
  if (!out.help) normalizeRegisterSetOptions(out.options);
  return out;
}

export const ORIGINAL_VERIFICATION_METHOD = 'registered-original-digest/1';
export const ORIGINAL_VERIFICATION_LIMITS = Object.freeze({ registerBytes: JSON_NATIVE_LIMITS.maxBytes, sourceBytes: DIGEST_LIMITS.maxFileBytes });
export function normalizeOriginalOptions(input) {
  if (!plain(input) || Object.keys(input).some(key => !['register', 'id', 'source', 'exclusions', 'includeUntracked', 'nonSensitive', 'protected', 'maxSourceBytes'].includes(key)) || typeof input.register !== 'string' || typeof input.source !== 'string' || typeof input.id !== 'string' || (!/^[a-z][a-z0-9-]{0,63}$/.test(input.id) || input.id !== input.id.trim())) fail();
  for (const key of ['includeUntracked', 'nonSensitive', 'protected']) if (input[key] !== undefined && typeof input[key] !== 'boolean') fail();
  const selection = normalizeReadSelection({ paths: [...new Set([input.register, input.source])], exclusions: input.exclusions ?? [] });
  if (selection.exclusions.length > 128 || [...selection.paths, ...selection.exclusions].some(path => /[#%]/u.test(path) || Buffer.byteLength(path, 'utf8') > 4096)) fail();
  const maxSourceBytes = input.maxSourceBytes === undefined ? ORIGINAL_VERIFICATION_LIMITS.sourceBytes : input.maxSourceBytes;
  normalizeDigestLimits({ maxFileBytes: maxSourceBytes, maxTotalBytes: maxSourceBytes });
  return { ...structuredClone(input), ...selection, maxSourceBytes, includeUntracked: input.includeUntracked ?? false, nonSensitive: input.nonSensitive ?? false, protected: input.protected ?? false };
}

/** Confirm only an explicitly selected register entry's whole-file byte identity. Never extract or decrypt. */
export function verifyRegisteredOriginal(inputRoot = ROOT, input = {}) {
  const options = normalizeOriginalOptions(input), evaluatedAt = new Date().toISOString();
  const report = {
    schema: 'curia.verification/1', evaluatedAt, completedAt: null,
    evaluation: { clock: 'host-system-clock', precision: 'instant', contentBaseline: 'current-worktree-not-historical-reconstruction' },
    verifier: null, observation: null, declaration: null, comparison: null, unresolved: [], exitCode: 2,
    assertion: {
      subject: 'registered-original-byte-identity', value: 'matches-declared-whole-file-digest', state: 'unverified',
      scope: { method: ORIGINAL_VERIFICATION_METHOD, register: options.register, registrationId: options.id, source: options.source, assurance: 'local-unprotected', requestedAssurance: options.protected ? 'protected' : 'local-unprotected' },
      sourceRefs: [options.register, options.source].map(path => ({ uri: `repo:${path}`, revision: null, locator: { kind: 'whole-file/1' }, observedAt: null })),
      evidenceRefs: [], verifiedBy: null, limits: [...LIMITATIONS, 'registration-id-local-not-global-identity', 'declared-format-owner-access-locator-and-observation-not-verified', 'no-original-text-layout-image-ocr-or-decryption', 'digest-match-not-approval-or-content-correctness'],
    },
  };
  const gap = code => { if (!report.unresolved.includes(code)) report.unresolved.push(code); };
  const finish = () => { report.completedAt = new Date().toISOString(); return report; };
  const withdraw = () => { report.assertion.evidenceRefs = []; for (const ref of report.assertion.sourceRefs) { ref.revision = ref.observedAt = null; } report.declaration = report.comparison = null; };
  const project = read => ({ schema: read.schema, source: read.source, privacy: read.privacy, limits: read.limits, stable: read.stable, chargedBytes: read.chargedBytes, openedFiles: read.openedFiles, documents: read.documents.map(({ path, state, reason, git, size }) => ({ path, state, reason, git, size })) });
  const evidence = (doc, index) => {
    Object.assign(report.assertion.sourceRefs[index], { revision: doc.digest, observedAt: doc.observedAt });
    report.assertion.evidenceRefs.push({ kind: 'local-source-bytes', path: doc.path, contentDigest: doc.digest, observedAt: doc.observedAt, sourceRef: index, locator: report.assertion.sourceRefs[index].locator, verification: doc.state === 'hashed' ? 'actual-complete-source-digest' : 'actual-complete-source-bytes' });
  };
  if (options.protected || !options.nonSensitive) { gap(options.protected ? 'authenticated-verifier-required' : 'privacy-not-declared'); return finish(); }
  let codes, capability, registration;
  try {
    codes = verifierCodeIdentity();
    report.verifier = { kind: 'tool', id: 'curia-verify/1', authentication: 'local-self-reported-not-authenticated', implementation: codes, runtime: { name: 'node', version: process.version, platform: process.platform, arch: process.arch } };
    capability = prepareSourceSelection(inputRoot, { paths: options.paths, exclusions: options.exclusions, includeUntracked: options.includeUntracked, nonSensitive: true });
    registration = readSourceSubset(capability, [options.register], { maxFiles: 1, maxFileBytes: ORIGINAL_VERIFICATION_LIMITS.registerBytes, maxTotalBytes: ORIGINAL_VERIFICATION_LIMITS.registerBytes });
  } catch { gap('original/register-scope-or-verifier-unavailable'); return finish(); }
  report.observation = { stable: registration.stable, register: project(registration), original: null, chargedBytes: registration.chargedBytes, openedFiles: registration.openedFiles };
  const registered = registration.documents[0];
  if (!registration.stable || registered?.state !== 'read') { gap(registered?.reason ?? 'original/register-unavailable'); return finish(); }
  let parsed;
  try { parsed = inspectOriginalRegister({ text: decodeJson(registered.bytes), encodingState: 'valid', truncated: false }, options.register); }
  catch { parsed = { state: 'unparsed', reason: 'original/register-encoding-invalid' }; }
  if (parsed.state !== 'parsed') { evidence(registered, 0); gap(parsed.reason); return finish(); }
  const index = parsed.originals.findIndex(original => original.id === options.id), entry = parsed.originals[index];
  if (entry) report.assertion.sourceRefs[0].locator = { kind: 'json-pointer/1', pointer: `/originals/${index}` };
  evidence(registered, 0);
  if (!entry) { gap('original/entry-not-found'); return finish(); }
  if (entry.sourceRef.uri !== `repo:${options.source}`) { gap(entry.sourceRef.uri.startsWith('repo:') ? 'original/source-selection-mismatch' : 'original/non-local-source'); return finish(); }
  const expected = parseRegisteredOriginalDigestRevision(entry.sourceRef.revision);
  if (!expected) { gap('original/revision-uninterpreted'); return finish(); }
  report.declaration = { registrationId: options.id, revision: expected, declaredFormat: entry.format, declaredEncryption: entry.encryption, formatVerification: 'not-performed', encryptionVerification: 'not-performed', accessVerification: 'not-performed', locatorVerification: 'not-performed', declaredObservationVerification: 'not-performed', extraction: 'not-invoked', decryption: 'not-invoked' };
  let original;
  try { original = digestSourceSubset(capability, [options.source], { algorithm: expected.algorithm, maxFiles: 1, maxFileBytes: options.maxSourceBytes, maxTotalBytes: options.maxSourceBytes }); }
  catch { withdraw(); report.observation.stable = false; gap('original/source-observation-unavailable'); return finish(); }
  report.observation.original = project(original); report.observation.stable = registration.stable && original.stable;
  report.observation.chargedBytes += original.chargedBytes; report.observation.openedFiles += original.openedFiles;
  const observed = original.documents[0];
  if (!original.stable || observed?.state !== 'hashed') { withdraw(); gap(observed?.reason ?? 'original/source-unavailable'); return finish(); }
  try { if (JSON.stringify(codes) !== JSON.stringify(verifierCodeIdentity())) throw new Error(); }
  catch { withdraw(); gap('verifier-identity-changed'); return finish(); }
  evidence(observed, 1);
  report.comparison = { state: JSON.stringify(expected) === JSON.stringify(observed.digest) ? 'equal' : 'different', expected, observed: observed.digest, basis: 'whole-original-raw-bytes' };
  report.assertion.state = report.comparison.state === 'equal' ? 'confirmed' : 'contradicted';
  report.assertion.verifiedBy = { identityRef: '#/verifier', action: ORIGINAL_VERIFICATION_METHOD, observedAt: new Date().toISOString() };
  report.exitCode = report.assertion.state === 'confirmed' ? 0 : 1;
  return finish();
}

export function parseOriginalArgs(argv) {
  const out = { options: { exclusions: [] }, json: false, help: false, root: ROOT }, seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]; if (seen.has(flag) && flag !== '--exclude') fail(); seen.add(flag);
    if (flag === '--json') out.json = true;
    else if (flag === '--help') out.help = true;
    else if (flag === '--all') out.options.includeUntracked = true;
    else if (flag === '--non-sensitive') out.options.nonSensitive = true;
    else if (flag === '--protected') out.options.protected = true;
    else {
      if (!['--register', '--id', '--source', '--exclude', '--max-source-bytes', '--root'].includes(flag) || i + 1 >= argv.length || !argv[i + 1] || argv[i + 1].startsWith('--')) fail();
      const value = argv[++i];
      if (flag === '--exclude') out.options.exclusions.push(value);
      else if (flag === '--root') out.root = value;
      else if (flag === '--max-source-bytes') { if (!/^[1-9][0-9]*$/.test(value) || value !== value.trim()) fail(); out.options.maxSourceBytes = Number(value); }
      else out.options[flag.slice(2)] = value;
    }
  }
  if (out.help) { if ([...seen].some(flag => !['--help', '--json'].includes(flag))) fail(); }
  else normalizeOriginalOptions(out.options);
  return out;
}

export function parseRelationArgs(argv) {
  const out = { options: { paths: [], exclusions: [] }, json: false, help: false, root: ROOT };
  const seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (seen.has(flag) && !['--path', '--exclude'].includes(flag)) fail();
    seen.add(flag);
    if (flag === '--help') out.help = true;
    else if (flag === '--json') out.json = true;
    else if (flag === '--all') out.options.includeUntracked = true;
    else if (flag === '--non-sensitive') out.options.nonSensitive = true;
    else if (flag === '--protected') out.options.protected = true;
    else {
      if (!['--path', '--exclude', '--root'].includes(flag) || i + 1 >= argv.length || !argv[i + 1] || argv[i + 1].startsWith('--')) fail();
      const value = argv[++i];
      if (flag === '--root') out.root = value;
      else out.options[flag === '--path' ? 'paths' : 'exclusions'].push(value);
    }
  }
  if (out.help) { if ([...seen].some((flag) => !['--help', '--json'].includes(flag))) fail(); }
  else normalizeRelationOptions(out.options);
  return out;
}

export function parseVerifyArgs(argv) {
  const out = { options: { exclusions: [] }, json: false, help: false, listMethods: false };
  const single = new Set();
  const flags = { '--all': ['options', 'includeUntracked'], '--non-sensitive': ['options', 'nonSensitive'], '--protected': ['options', 'protected'], '--json': [null, 'json'], '--help': [null, 'help'], '-h': [null, 'help'], '--list-methods': [null, 'listMethods'] };
  const values = new Set(['--root', '--method', '--left', '--right', '--left-pointer', '--right-pointer', '--exclude']);
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag !== '--exclude' && single.has(flag)) fail();
    single.add(flag);
    if (Object.hasOwn(flags, flag)) { const [parent, key] = flags[flag]; (parent ? out[parent] : out)[key] = true; continue; }
    if (!values.has(flag) || i + 1 >= argv.length || argv[i + 1].startsWith('--')) fail();
    const value = argv[++i];
    if (flag === '--exclude') out.options.exclusions.push(value);
    else if (flag === '--root') { if (!value) fail(); out.root = value; }
    else if (flag === '--method') out.options.method = value;
    else { const side = flag.startsWith('--left') ? 'left' : 'right'; out.options[side] ??= {}; out.options[side][flag.endsWith('-pointer') ? 'pointer' : 'path'] = value; }
  }
  if (out.help || out.listMethods) {
    if ((out.help && out.listMethods) || out.root !== undefined || Object.keys(out.options).some((key) => key !== 'exclusions') || out.options.exclusions.length) fail();
  } else normalizeVerificationOptions(out.options);
  return out;
}

if (isMainModule(import.meta.url) && process.argv[2] === 'generation') {
  const { generationMain } = await import('./curia-generation.mjs'); generationMain(process.argv.slice(3));
} else if (isMainModule(import.meta.url)) {
  try {
    const registers = process.argv[2] === 'registers', relations = process.argv[2] === 'relations', original = process.argv[2] === 'original';
    const args = registers ? parseRegisterSetArgs(process.argv.slice(3)) : original ? parseOriginalArgs(process.argv.slice(3)) : relations ? parseRelationArgs(process.argv.slice(3)) : parseVerifyArgs(process.argv.slice(2));
    if (registers) {
      if (args.help) console.log('node scripts/curia-verify.mjs registers --register docs/source-register.json --register docs/team-register.json --non-sensitive --json\n只比较显式登记表中的 URI 与声明修订，报告重复、声明差异和未知版本重叠；不探测原件、不归一化别名、不自动去重。\n固定预算见 --list-methods；pass/not-applicable=0, fail=1, incomplete=2。');
      else { const report = verifyRegisterSet(args.root, args.options); console.log(args.json ? JSON.stringify(report, null, 2) : report.state); process.exitCode = report.exitCode; }
    } else if (original) {
      if (args.help) console.log('node scripts/curia-verify.mjs original --register docs/source-register.json --id manual --source docs/files/manual.pdf --non-sensitive --json\n只核对显式 repo 原件与登记中的 sha256:raw-bytes/1:<64 位小写 hex>、sha512:raw-bytes/1:<128 位小写 hex> 或单条规范 sha256-/sha512- SRI 摘要；不解密、不抽取正文、不外访。\n--max-source-bytes 调整原件摘要预算；confirmed=0, contradicted=1, unverified=2。');
      else { const report = verifyRegisteredOriginal(args.root, args.options); console.log(args.json ? JSON.stringify(report, null, 2) : report.assertion.state); process.exitCode = report.exitCode; }
    } else if (relations) {
      if (args.help) console.log('node scripts/curia-verify.mjs relations --path docs/old.md --path docs/current.md --non-sensitive --json\n只检查显式选集与 Registry 的 relations 绑定，不自动读取引用目标；退出码 pass/not-applicable=0, fail=1, incomplete=2。');
      else { const report = verifyRelations(args.root, args.options); console.log(args.json ? JSON.stringify(report, null, 2) : report.state); process.exitCode = report.exitCode; }
    } else {
    if (args.help) console.log('Curia 本地显式核验（不持久化、不外访、不执行来源命令）：\n  node scripts/curia-verify.mjs --method json-value-equal/1 --left packages/api.json --left-pointer /info/version --right docs/api.json --right-pointer /info/version --non-sensitive --json\n  generation --help 核对生成声明中的输入、约定与输出摘要\n  original --register <file> --id <id> --source <file> --non-sensitive --json 核对登记修订与实际原件摘要\n  registers --register <file> --register <file> --non-sensitive --json 比较显式登记表的原件身份声明\n  relations --path <file> --non-sensitive --json 检查显式声明的取代与引用关系\n  --method raw-bytes-equal/1 比较完整字节，不接受 pointer\n  --all 只加入明确选中的未忽略 untracked 文件；--exclude <path> 可重复\n  --protected 当前返回 unverified，不降级认证要求\n  exit: confirmed=0, contradicted=1, unverified/invalid=2');
    else if (args.listMethods) console.log(JSON.stringify({ schema: 'curia.verification-methods/1', methods: VERIFICATION_METHODS, limits: VERIFICATION_LIMITS, registers: { command: 'registers', limits: REGISTER_SET_LIMITS, schema: 'curia.original-register-check/1', identity: 'exact-uri-and-opaque-revision', originals: 'not-opened' }, original: { command: 'original', method: ORIGINAL_VERIFICATION_METHOD, limits: ORIGINAL_VERIFICATION_LIMITS, revision: '(sha256|sha512):raw-bytes/1:<lowercase-hex> or (sha256|sha512)-<canonical-base64>' }, states: ['confirmed', 'contradicted', 'unverified'], notApplicable: 'not-emitted-required-comparisons', effects: ['bounded-local-read'], persistence: 'none' }, null, 2));
    else {
      const report = verifySources(args.root ?? ROOT, args.options);
      console.log(args.json ? JSON.stringify(report, null, 2) : `${report.assertion.state}: ${report.assertion.scope.method}${report.unresolved.length ? ` (${report.unresolved.join(', ')})` : ''}`);
      process.exitCode = report.exitCode;
    }
    }
  } catch {
    console.error(JSON.stringify({ schema: 'curia.verification-error/1', code: 'verify/options-or-boundary-invalid' }));
    process.exitCode = 2;
  }
}
