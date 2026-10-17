/** Optional data-only register. A registration is not an observation of the referenced original. */
import { parseDataJson, inspectJsonContent, JSON_CONTENT_CONTRACT } from './curia-json.mjs';
import { parseTimeBoundary } from './curia-applicability.mjs';

export const ORIGINALS_PARSER = 'json-original-register/1';
export const ORIGINALS_SCHEMA = 'curia.original-register/1';
export const ORIGINALS_CONTRACT = Object.freeze({
  ...JSON_CONTENT_CONTRACT, parser: ORIGINALS_PARSER, coverage: 'register-schema-only-not-originals',
  limits: Object.freeze({ ...JSON_CONTENT_CONTRACT.limits, maxOriginals: 128 }),
  originals: 'never-opened-or-hashed', declarations: 'not-authenticated',
});
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const fail = (code = 'originals/schema-invalid') => { throw Object.assign(new Error('原件登记不符合支持的合同'), { code }); };
const text = (v, max = 256) => typeof v === 'string' && v.length > 0 && v.length <= max && v.trim() === v && !/[\u0000-\u001f\u007f]/u.test(v) && (() => { try { encodeURIComponent(v); return true; } catch { return false; } })();
function object(v, keys) {
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some((k) => !keys.includes(k))) fail();
}
function localPath(v) {
  return text(v, 1024) && !v.includes('\\') && !/[*?\[\]{}:#%]/u.test(v) && v.split('/').every((p) => p && !['.', '..', '.git'].includes(p.toLowerCase()) && p === p.trim());
}
function uri(v) {
  if (!text(v, 2048)) fail('originals/uri-invalid');
  if (v.startsWith('repo:')) { if (!localPath(v.slice(5))) fail('originals/uri-invalid'); return v; }
  if (/^paper:[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(v)) return v;
  if (!v.startsWith('https://') || /[?#]/.test(v)) fail('originals/uri-invalid');
  let u; try { u = new URL(v); } catch { fail('originals/uri-invalid'); }
  // No credentials, query/fragment payloads, lossy path aliases or inferred URL normalization.
  if (u.username || u.password || !u.hostname || u.href !== v) fail('originals/uri-invalid');
  return v;
}
function normalizeSource(raw) {
  object(raw, ['uri', 'revision', 'locator', 'observedAt']);
  const source = { uri: uri(raw.uri), revision: raw.revision ?? null, locator: raw.locator ?? null, observedAt: raw.observedAt ?? null };
  for (const key of ['revision', 'locator']) if (source[key] !== null && !text(source[key])) fail();
  let observation = { state: 'not-declared', precision: null, instant: null };
  if (source.observedAt !== null) {
    const time = parseTimeBoundary(source.observedAt);
    if (!['date', 'instant'].includes(time.kind)) fail('originals/observation-invalid');
    observation = { state: 'declared-not-verified', precision: time.precision, instant: time.instant };
  }
  return { sourceRef: source, observation };
}

export function inspectOriginalRegister(input, path) {
  const inspected = inspectJsonContent(input);
  const result = { ...inspected, originals: [] };
  if (inspected.state !== 'parsed') return result;
  try {
    if (!localPath(path)) fail('originals/register-path-invalid');
    const data = parseDataJson(input.text);
    object(data, ['schema', 'owner', 'accessRef', 'originals']);
    if (data.schema !== ORIGINALS_SCHEMA || !Array.isArray(data.originals) || data.originals.length > ORIGINALS_CONTRACT.limits.maxOriginals) fail();
    if (own(data, 'owner') && !text(data.owner)) fail();
    if (own(data, 'accessRef') && !localPath(data.accessRef)) fail();
    const ids = new Set(), sources = new Set();
    const originals = data.originals.map((item, i) => {
      object(item, ['id', 'format', 'sourceRef', 'owner', 'accessRef', 'location', 'encryption']);
      if (!text(item.id, 64) || !/^[a-z][a-z0-9-]{0,63}$/.test(item.id) || ids.has(item.id)) fail('originals/id-invalid');
      ids.add(item.id);
      if (!text(item.format, 32) || !/^[a-z][a-z0-9.+-]{0,31}$/.test(item.format)) fail();
      if (own(item, 'owner') && !text(item.owner)) fail();
      if (own(item, 'accessRef') && !localPath(item.accessRef)) fail();
      const owner = item.owner ?? data.owner, accessRef = item.accessRef ?? data.accessRef;
      if (!text(owner) || !localPath(accessRef)) fail('originals/ownership-missing');
      if (own(item, 'location') && !text(item.location)) fail();
      const encryption = item.encryption ?? 'unknown';
      if (!['unknown', 'encrypted', 'not-encrypted'].includes(encryption)) fail();
      const source = normalizeSource(item.sourceRef);
      const sourceKey = JSON.stringify([source.sourceRef.uri, source.sourceRef.revision]);
      if (sources.has(sourceKey)) fail('originals/source-duplicate');
      sources.add(sourceKey);
      const base = `${path}#/originals/${i}`;
      return {
        id: item.id, format: item.format, ...source, owner, accessRef, location: item.location ?? null, encryption,
        metadataSource: { entry: base, owner: own(item, 'owner') ? `${base}/owner` : `${path}#/owner`, accessRef: own(item, 'accessRef') ? `${base}/accessRef` : `${path}#/accessRef` },
        state: 'registered-not-read', existence: 'not-checked', access: 'not-checked', verification: 'not-verified', digest: null,
        unparsed: { scope: source.sourceRef.locator ?? 'whole-original', reason: encryption === 'encrypted' ? 'encrypted-not-opened' : 'source-not-opened' },
      };
    });
    return { state: 'parsed', reason: null, originals };
  } catch (error) {
    return { state: 'unparsed', reason: error.code ?? 'originals/schema-invalid', originals: [] };
  }
}

/** Opt-in verifier notation, not a change to opaque register revisions or implicit source access. */
export function parseOriginalDigestRevision(revision) {
  const match = typeof revision === 'string' && /^sha256:raw-bytes\/1:([0-9a-f]{64})$/.exec(revision);
  return match && match[0] === revision ? { algorithm: 'sha256', canonicalization: 'raw-bytes/1', value: match[1] } : null;
}

const ORIGINAL_DIGEST_LENGTHS = Object.freeze({ sha256: 64, sha512: 128 });
export function isOriginalDigestAlgorithm(algorithm) { return typeof algorithm === 'string' && Object.hasOwn(ORIGINAL_DIGEST_LENGTHS, algorithm); }
export function isOriginalDigest(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)) && !Object.getOwnPropertySymbols(value).length
    && Object.keys(value).length === 3 && ['algorithm', 'canonicalization', 'value'].every(key => Object.hasOwn(value, key))
    && isOriginalDigestAlgorithm(value.algorithm) && value.canonicalization === 'raw-bytes/1' && typeof value.value === 'string'
    && value.value.length === ORIGINAL_DIGEST_LENGTHS[value.algorithm] && /^[0-9a-f]+$/.test(value.value);
}

/** Explicit registered-original verification only. Legacy 史料/task consumers keep the parser above. */
export function parseRegisteredOriginalDigestRevision(revision) {
  if (typeof revision !== 'string' || revision.length > 256) return null;
  const legacy = parseOriginalDigestRevision(revision); if (legacy) return legacy;
  const hex = /^sha512:raw-bytes\/1:([0-9a-f]{128})$/.exec(revision);
  if (hex && hex[0] === revision) return { algorithm: 'sha512', canonicalization: 'raw-bytes/1', value: hex[1] };
  // One canonical, padded standard-base64 digest, not the browser SRI policy, metadata list or URL-safe aliases.
  const sri = /^(sha256|sha512)-([A-Za-z0-9+/]+={0,2})$/.exec(revision);
  if (!sri || sri[0] !== revision || sri[2].length !== Math.ceil(ORIGINAL_DIGEST_LENGTHS[sri[1]] / 6) * 4) return null;
  const bytes = Buffer.from(sri[2], 'base64');
  if (bytes.length * 2 !== ORIGINAL_DIGEST_LENGTHS[sri[1]] || bytes.toString('base64') !== sri[2]) return null;
  return { algorithm: sri[1], canonicalization: 'raw-bytes/1', value: bytes.toString('hex') };
}

/** Scope is the selected register files only; never a claim about external coverage or uniqueness. */
export function summarizeOriginals(envelopes, documents = null) {
  const registers = envelopes.filter((env) => env.content?.parser === ORIGINALS_PARSER);
  const originals = registers.flatMap((env) => env.content.originals ?? []);
  const requested = documents ? documents.filter((doc) => doc.declaredParser === ORIGINALS_PARSER).length : registers.length;
  return {
    enabled: requested > 0, registers: requested, registered: originals.length,
    unresolvedRegisters: requested - registers.filter((env) => env.content.state === 'parsed').length,
    read: 0, verified: 0, basis: 'selected-register-declarations', complete: false,
  };
}
