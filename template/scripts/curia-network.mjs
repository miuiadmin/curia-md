/** Pure, conservative network policy. No DNS, sockets, source reads or ambient credentials. */
import { isIP } from 'node:net';
import { JSON_NATIVE_LIMITS } from './curia-json.mjs';
import { normalizeReadSelection } from './curia-query.mjs';
export const EXTERNAL_PARSERS = Object.freeze(['utf8-text/1', 'json-data/1', 'digest-only/1']);
export const EXTERNAL_LIMITS = Object.freeze({ maxBodyBytes: 512 * 1024, maxBinaryBytes: 16 * 1024 * 1024, maxHeaderBytes: 16 * 1024, maxAddresses: 16, timeoutMs: 15000, maxTimeoutMs: 60000, maxCaBytes: 64 * 1024 });
export const ADDRESS_POLICY = 'curia.conservative-addresses/1';
const plain = v => v && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v)) && !Object.getOwnPropertySymbols(v).length;
const invalid = () => { throw new Error('外访参数或授权不符合支持的合同 [external/options-invalid]'); };
const media = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/;
function urlValue(raw) {
  if (typeof raw !== 'string' || raw.length > 4096 || /[\s\\?#\u0000-\u001f\u007f]/u.test(raw)) invalid();
  let url; try { url = new URL(raw); } catch { invalid(); }
  if (url.protocol !== 'https:' || url.username || url.password || url.href !== raw || !url.hostname || (url.port && Number(url.port) < 1)) invalid();
  const host = url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname;
  if (!isIP(host) && (host.length > 253 || !host.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)))) invalid();
  return { url, host };
}
export function normalizeExternalOptions(input) {
  if (!plain(input) || Object.keys(input).some(key => !['url', 'allowOrigin', 'allowInternalOrigin', 'parser', 'mediaType', 'nonSensitive', 'protected', 'trustCert', 'includeUntracked', 'exclusions', 'maxBytes', 'timeoutMs'].includes(key))) invalid();
  const { url, host } = urlValue(input.url);
  if (typeof input.allowOrigin !== 'string' || input.allowOrigin !== url.origin || (input.allowInternalOrigin !== undefined && input.allowInternalOrigin !== url.origin) || !EXTERNAL_PARSERS.includes(input.parser)) invalid();
  for (const key of ['nonSensitive', 'protected', 'includeUntracked']) if (input[key] !== undefined && typeof input[key] !== 'boolean') invalid();
  if (input.parser === 'digest-only/1' ? typeof input.mediaType !== 'string' || !media.test(input.mediaType) : input.mediaType !== undefined) invalid();
  const cap = input.parser === 'json-data/1' ? JSON_NATIVE_LIMITS.maxBytes : input.parser === 'digest-only/1' ? EXTERNAL_LIMITS.maxBinaryBytes : EXTERNAL_LIMITS.maxBodyBytes;
  const maxBytes = input.maxBytes ?? Math.min(cap, EXTERNAL_LIMITS.maxBodyBytes), timeoutMs = input.timeoutMs ?? EXTERNAL_LIMITS.timeoutMs;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > cap || !Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > EXTERNAL_LIMITS.maxTimeoutMs) invalid();
  let caSelection = null;
  if (input.trustCert !== undefined) {
    if (typeof input.trustCert !== 'string' || !input.trustCert.endsWith('.crt')) invalid();
    caSelection = normalizeReadSelection({ paths: [input.trustCert], exclusions: input.exclusions ?? [] });
    if (caSelection.exclusions.length > 128 || [...caSelection.paths, ...caSelection.exclusions].some(p => /[#%]/u.test(p) || Buffer.byteLength(p) > 4096)) invalid();
  } else if (input.exclusions !== undefined || input.includeUntracked !== undefined) invalid();
  return { url: url.href, origin: url.origin, host, port: Number(url.port || 443), path: url.pathname, allowInternal: input.allowInternalOrigin === url.origin, parser: input.parser, mediaType: input.mediaType ?? null, maxBytes, timeoutMs, nonSensitive: input.nonSensitive ?? false, protected: input.protected ?? false, caSelection, includeUntracked: input.includeUntracked ?? false };
}
function ipNumber(address) {
  const family = isIP(address);
  if (!family || address.includes('%')) return null;
  if (family === 4) return { family, value: address.split('.').reduce((n, b) => (n << 8n) | BigInt(b), 0n) };
  // Mapped/embedded dotted addresses are not candidates for a new connection.
  if (address.includes('.')) return null;
  const parts = address.toLowerCase().split('::');
  const left = parts[0] ? parts[0].split(':') : [], right = parts[1] ? parts[1].split(':') : [];
  const words = parts.length === 2 ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left;
  return { family, value: words.reduce((n, w) => (n << 16n) | BigInt('0x' + w), 0n) };
}
const inRange = (value, bits, prefix, length) => (value >> BigInt(bits - length)) === (ipNumber(prefix).value >> BigInt(bits - length));
// Conservative IANA special-purpose snapshot reviewed 2026-10-16; changes require a policy version.
// Sources: https://www.iana.org/assignments/iana-ipv4-special-registry/
//          https://www.iana.org/assignments/iana-ipv6-special-registry/
// This deliberately also denies some globally reachable special-purpose ranges, not a routing guarantee.
export function classifyAddress(address) {
  const parsed = ipNumber(address); if (!parsed) return 'unsupported';
  const { family, value } = parsed, bits = family === 4 ? 32 : 128;
  const any = ranges => ranges.some(([prefix, length]) => inRange(value, bits, prefix, length));
  if (family === 4) {
    if (any([['10.0.0.0', 8], ['127.0.0.0', 8], ['172.16.0.0', 12], ['192.168.0.0', 16]])) return 'internal';
    if (any([['0.0.0.0', 8], ['100.64.0.0', 10], ['169.254.0.0', 16], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.31.196.0', 24], ['192.52.193.0', 24], ['192.88.99.0', 24], ['192.175.48.0', 24], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3]])) return 'unsupported';
    return 'public-candidate';
  }
  if (any([['::1', 128], ['fc00::', 7]])) return 'internal';
  if (!any([['2000::', 3]]) || any([['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['2620:4f:8000::', 48], ['3fff::', 20]])) return 'unsupported';
  return 'public-candidate';
}
export function selectExternalAddress(addresses, allowInternal) {
  if (!Array.isArray(addresses) || !addresses.length || addresses.length > EXTERNAL_LIMITS.maxAddresses || typeof allowInternal !== 'boolean' || addresses.some(a => typeof a !== 'string')) return { state: 'unavailable', reason: 'external/dns-results-invalid', selected: null, count: Array.isArray(addresses) ? addresses.length : 0 };
  const unique = [...new Set(addresses)].sort((a, b) => isIP(a) - isIP(b) || (a < b ? -1 : a > b ? 1 : 0));
  for (const address of unique) {
    const kind = classifyAddress(address);
    if (kind === 'unsupported' || (kind === 'internal' && !allowInternal)) return { state: 'denied', reason: kind === 'internal' ? 'external/internal-origin-not-authorized' : 'external/address-unsupported', selected: null, count: unique.length };
  }
  return { state: 'selected', reason: null, selected: unique[0], family: isIP(unique[0]), count: unique.length, policy: ADDRESS_POLICY };
}
export function samePeerAddress(a, b) {
  const parse = value => {
    // OS peer metadata may use IPv4-mapped notation even for an explicit IPv4 connection.
    if (typeof value === 'string' && value.toLowerCase().startsWith('::ffff:') && isIP(value.slice(7)) === 4) return ipNumber(value.slice(7));
    return typeof value === 'string' ? ipNumber(value) : null;
  };
  const left = parse(a), right = parse(b);return !!left && !!right && left.family === right.family && left.value === right.value;
}
export function inspectExternalHeaders(status, rawHeaders, options) {
  const values = new Map();
  if (!Array.isArray(rawHeaders) || rawHeaders.length % 2 || rawHeaders.length > 256) return { ok: false, reason: 'external/headers-invalid' };
  for (let i = 0; i < rawHeaders.length; i += 2) {
    const name = String(rawHeaders[i]).toLowerCase(), value = rawHeaders[i + 1];
    if (typeof value !== 'string') return { ok: false, reason: 'external/headers-invalid' };
    if (!values.has(name)) values.set(name, []);values.get(name).push(value);
  }
  if (status !== 200) return { ok: false, reason: status >= 300 && status < 400 ? 'external/redirect-or-cache-not-followed' : 'external/status-not-supported' };
  if (values.has('content-range') || values.has('trailer') || ['content-type', 'content-length', 'content-encoding', 'transfer-encoding'].some(key => (values.get(key)?.length ?? 0) > 1)) return { ok: false, reason: 'external/response-shape-unsupported' };
  const encoding = values.get('content-encoding')?.[0]?.trim().toLowerCase();
  if (encoding && encoding !== 'identity') return { ok: false, reason: 'external/encoding-unsupported' };
  const transfer = values.get('transfer-encoding')?.[0]?.trim().toLowerCase();
  if (transfer && transfer !== 'chunked') return { ok: false, reason: 'external/transfer-unsupported' };
  const length = values.get('content-length')?.[0];
  if (length !== undefined && (!/^(0|[1-9][0-9]*)$/.test(length) || !Number.isSafeInteger(Number(length)) || Number(length) > options.maxBytes || transfer)) return { ok: false, reason: 'external/declared-size-invalid' };
  const type = values.get('content-type')?.[0];
  const match = typeof type === 'string' && type.length <= 256 && /^([a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+)(?:\s*;\s*charset=(?:utf-8|"utf-8"))?\s*$/i.exec(type);
  if (!match) return { ok: false, reason: 'external/media-type-unsupported' };
  const mediaType = match[1].toLowerCase();
  const allowed = options.parser === 'digest-only/1' ? mediaType === options.mediaType : options.parser === 'json-data/1' ? mediaType === 'application/json' || /^application\/[a-z0-9!#$&^_.+-]+\+json$/.test(mediaType) : ['text/plain', 'text/markdown', 'text/html'].includes(mediaType);
  return allowed ? { ok: true, mediaType, contentLength: length === undefined ? null : Number(length), bodyEncoding: 'identity', upstreamCache: 'not-verified', validators: { etag: values.has('etag') ? 'present-not-retained' : 'absent', lastModified: values.has('last-modified') ? 'present-not-retained' : 'absent' } } : { ok: false, reason: 'external/media-type-mismatch' };
}
