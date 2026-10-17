#!/usr/bin/env node
/** Explicit HTTPS reading and registered-entity comparison; no redirect, credential, proxy, model, cache or storage adapter. */
import https from 'node:https';
import tls from 'node:tls';
import { Resolver } from 'node:dns/promises';
import { isIP } from 'node:net';
import { createHash, X509Certificate } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { ROOT, isMainModule } from './doc-lib.mjs';
import { prepareSourceSelection, readSourceSelection, readSourceSubset, revalidateSourceSelection, readStableFile, normalizeReadSelection } from './curia-query.mjs';
import { inspectJsonContent, JSON_NATIVE_LIMITS } from './curia-json.mjs';
import { inspectOriginalRegister, parseRegisteredOriginalDigestRevision, isOriginalDigest } from './curia-originals.mjs';
import { VERIFIER_FILES } from './curia-verify.mjs';
import { normalizeExternalOptions, selectExternalAddress, samePeerAddress, inspectExternalHeaders, EXTERNAL_LIMITS, EXTERNAL_PARSERS, ADDRESS_POLICY } from './curia-network.mjs';
export { normalizeExternalOptions, EXTERNAL_LIMITS, EXTERNAL_PARSERS } from './curia-network.mjs';
export const EXTERNAL_FILES = Object.freeze(['curia-external.mjs', 'curia-network.mjs', ...VERIFIER_FILES]);
const digest = bytes => ({ algorithm: 'sha256', canonicalization: 'raw-bytes/1', value: createHash('sha256').update(bytes).digest('hex') });
const fault = code => Object.assign(new Error('外部来源不可用'), { code });
const safeReason = error => typeof error?.code === 'string' && /^external\/[a-z-]+$/.test(error.code) ? error.code : 'external/transport-unavailable';
export function externalCodeIdentity() {
  const dir = dirname(fileURLToPath(import.meta.url));
  return EXTERNAL_FILES.map(file => {
    const path = join(dir, file), stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || realpathSync(path) !== path || stat.size >= 1024 * 1024) throw fault('external/code-unavailable');
    const bytes = readStableFile(path, stat, 1024 * 1024 - 1), after = lstatSync(path);
    if (bytes.length !== stat.size || ['dev', 'ino', 'mode', 'nlink', 'size', 'mtimeMs', 'ctimeMs'].some(k => stat[k] !== after[k])) throw fault('external/code-changed');
    return { file, digest: digest(bytes) };
  });
}
export function unsafeTlsEnvironment(env = process.env, args = process.execArgv) {
  return env.NODE_TLS_REJECT_UNAUTHORIZED === '0' || !!env.SSLKEYLOGFILE || String(env.NODE_OPTIONS ?? '').includes('--tls-keylog') || args.some(a => a.includes('--tls-keylog'));
}
async function resolveTarget(host, signal) {
  if (signal.aborted) throw fault('external/cancelled');
  if (isIP(host)) return { addresses: [host], mode: 'explicit-ip-no-dns', queries: 0 };
  const resolver = new Resolver({ tries: 1, timeout: 5000 }), cancel = () => resolver.cancel();
  signal.addEventListener('abort', cancel, { once: true });
  try {
    const replies = await Promise.allSettled([resolver.resolve4(host), resolver.resolve6(host)]), addresses = [];
    if (signal.aborted) throw fault('external/cancelled');
    for (const reply of replies) {
      if (reply.status === 'fulfilled') addresses.push(...reply.value);
      else if (!['ENODATA', 'ENOTFOUND'].includes(reply.reason?.code)) throw fault('external/dns-unavailable');
    }
    return { addresses, mode: 'explicit-host-a-and-aaaa-once', queries: 2 };
  } finally { signal.removeEventListener('abort', cancel); resolver.cancel(); }
}
function requestOnce(options, selected, ca, signal, observation, algorithm) {
  return new Promise((resolve, reject) => {
    let req, response, settled = false, requestClosed = false, bytes = 0, chunks = [], headers, fingerprint;
    const hash = createHash(algorithm);
    const finish = (error, value) => {
      if (settled) return; settled = true;
      signal.removeEventListener('abort', abort);
      chunks = [];
      const complete = () => error ? reject(error) : resolve(value);
      if (!req || requestClosed || req.closed) { response?.destroy(); complete(); return; }
      req.once('close', complete); response?.destroy(); req.destroy();
    };
    const abort = () => finish(fault('external/cancelled'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    try {
      req = https.request({
        protocol: 'https:', hostname: selected.selected, family: selected.family, port: options.port, path: options.path, method: 'GET',
        servername: isIP(options.host) ? '' : options.host, rejectUnauthorized: true, minVersion: 'TLSv1.2', ca,
        checkServerIdentity: (_host, cert) => tls.checkServerIdentity(options.host, cert),
        agent: false, maxHeaderSize: EXTERNAL_LIMITS.maxHeaderBytes, insecureHTTPParser: false, ALPNProtocols: ['http/1.1'],
        lookup: (_host, _options, callback) => callback(fault('external/unexpected-dns')),
        headers: { Host: new URL(options.url).host, Accept: options.mediaType ?? (options.parser === 'json-data/1' ? 'application/json' : 'text/plain, text/markdown, text/html'), 'Accept-Encoding': 'identity', 'Cache-Control': 'no-store', Connection: 'close', 'User-Agent': 'curia-external/1' },
      });
      observation.attempts = 1;
      req.on('socket', socket => {
        socket.once('secureConnect', () => {
          try {
            if (!socket.authorized || !samePeerAddress(socket.remoteAddress, selected.selected) || !['TLSv1.2', 'TLSv1.3'].includes(socket.getProtocol())) throw fault('external/tls-or-peer-mismatch');
            const raw = socket.getPeerCertificate().raw;
            if (!Buffer.isBuffer(raw) || !raw.length || raw.length > EXTERNAL_LIMITS.maxCaBytes) throw fault('external/tls-peer-unavailable');
            fingerprint = digest(raw);
            observation.tls = { protocol: socket.getProtocol(), certificateAndHostname: 'validated', peerAddressPinned: true, certificateDigest: fingerprint };
          } catch (error) { finish(error); }
        });
      });
      req.once('error', error => finish(error?.code === 'HPE_HEADER_OVERFLOW' ? fault('external/header-limit') : error));
      req.once('close', () => { requestClosed = true; if (!settled) finish(fault('external/connection-closed')); });
      req.once('response', res => {
        response = res; observation.status = res.statusCode;
        if (!fingerprint) { finish(fault('external/tls-not-observed')); return; }
        headers = inspectExternalHeaders(res.statusCode, res.rawHeaders, options);
        if (!headers.ok) { finish(fault(headers.reason)); return; }
        observation.response = headers;
        res.on('data', chunk => {
          if (settled) return;
          bytes += chunk.length; observation.receivedBytes = bytes;
          if (bytes > options.maxBytes) { finish(fault('external/body-limit')); return; }
          hash.update(chunk); if (options.parser !== 'digest-only/1') chunks.push(chunk);
        });
        res.once('error', () => finish(fault('external/response-interrupted')));
        res.once('aborted', () => finish(fault('external/response-interrupted')));
        res.once('end', () => {
          if (settled) return;
          if (!res.complete || (headers.contentLength !== null && bytes !== headers.contentLength) || res.rawTrailers.length) { finish(fault('external/incomplete-entity')); return; }
          const body = options.parser === 'digest-only/1' ? null : Buffer.concat(chunks, bytes);
          const value = { body, digest: { algorithm, canonicalization: 'raw-bytes/1', value: hash.digest('hex') }, bytes, observedAt: new Date().toISOString() };
          observation.entityComplete = true; finish(null, value);
        });
      });
      req.end();
    } catch (error) { finish(error); }
  });
}
export async function readExternalSource(root = ROOT, input = {}, signal = null) {
  return readExternalWithDigest(root, input, signal, 'sha256');
}

async function readExternalWithDigest(root, input, signal, algorithm) {
  const options = normalizeExternalOptions(input);
  if (signal !== null && !(signal instanceof AbortSignal)) throw fault('external/abort-signal-invalid');
  const report = {
    schema: 'curia.external-read/1', evaluatedAt: new Date().toISOString(), completedAt: null, state: 'incomplete', exitCode: 2,
    output: 'ephemeral-stdout', persisted: false, parser: options.parser,
    authorization: { origin: options.nonSensitive ? options.origin : null, internalOrigin: options.nonSensitive && options.allowInternal ? options.origin : null, basis: 'explicit-local-caller-not-source-content', nonSensitive: options.nonSensitive, requestedAssurance: options.protected ? 'protected' : 'local-unprotected' },
    policy: { scheme: 'https', method: 'GET', redirects: 'never-followed', credentials: 'unsupported-none-sent', cookies: 'none-sent-or-retained', proxy: 'not-used-ambient-proxy-ignored', tls: 'certificate-and-hostname-required-tls12-or-newer', addressPolicy: ADDRESS_POLICY, dns: 'resolve-once-pin-one-address-no-fallback', requestEffects: 'read-intent-server-side-effects-not-verified', rate: 'one-request-per-invocation-no-cross-process-limiter', retries: 0, cache: 'no-client-cache-upstream-cache-not-verified', persistence: 'none', limits: { maxBodyBytes: options.maxBytes, maxHeaderBytes: EXTERNAL_LIMITS.maxHeaderBytes, maxAddresses: EXTERNAL_LIMITS.maxAddresses, networkTimeoutMs: options.timeoutMs } },
    request: null, observation: { attempts: 0, dns: null, tls: null, status: null, response: null, receivedBytes: 0, entityComplete: false },
    tool: null, trust: null, trustSource: null, sourceRef: null, evidenceRefs: [], projection: null, unresolved: [],
    coverage: { entityReceivedComplete: false, textProjected: false, factVerified: false, layoutRead: false },
    limitations: ['non-sensitive-response-url-connection-metadata-and-ca-declared-by-caller', 'not-secret-detection-or-multi-reader-authorization', 'source-content-and-headers-not-instructions', 'tls-server-identity-not-verifier-owner-or-approval-identity', 'host-clock-not-certified', 'network-timeout-not-os-cpu-memory-or-process-isolation', 'public-candidate-not-proof-of-public-routability', 'same-dns-answer-not-authenticated-dns-or-global-snapshot', 'direct-client-response-not-proof-of-origin-freshness', 'response-digest-is-identity-entity-after-http-transfer-framing-not-tls-wire', 'no-historical-url-reconstruction-or-future-replay-guarantee', 'code-files-observed-not-attested-loaded-bytes', 'recipient-truncation-not-observable'],
  };
  const done = () => { report.completedAt = new Date().toISOString(); return report; }, gap = code => { if (!report.unresolved.includes(code)) report.unresolved.push(code); };
  if (!options.nonSensitive || options.protected || signal?.aborted || unsafeTlsEnvironment()) { gap(!options.nonSensitive ? 'external/privacy-not-declared' : options.protected ? 'external/authenticated-verifier-required' : signal?.aborted ? 'external/cancelled' : 'external/unsafe-tls-runtime'); return done(); }
  let codes, caCapability = null, ca;
  try {
    codes = externalCodeIdentity();
    report.tool = { kind: 'tool', id: 'curia-external/1', authentication: 'local-self-reported-not-authenticated', implementation: codes, runtime: { name: 'node', version: process.version, platform: process.platform, arch: process.arch } };
    if (options.caSelection) {
      caCapability = prepareSourceSelection(root, { paths: options.caSelection.paths, exclusions: options.caSelection.exclusions, includeUntracked: options.includeUntracked, nonSensitive: true });
      const read = readSourceSelection(caCapability, { maxFiles: 1, maxFileBytes: EXTERNAL_LIMITS.maxCaBytes, maxTotalBytes: EXTERNAL_LIMITS.maxCaBytes }), doc = read.documents[0];
      if (!read.stable || doc?.state !== 'read') throw fault('external/trust-source-unavailable');
      const pem = new TextDecoder('utf-8', { fatal: true }).decode(doc.bytes);
      if (!/^-----BEGIN CERTIFICATE-----\r?\n[A-Za-z0-9+/=\r\n]+-----END CERTIFICATE-----\s*$/.test(pem) || !new X509Certificate(pem).ca) throw fault('external/trust-certificate-invalid');
      ca = pem;
      report.trustSource = { uri: `repo:${doc.path}`, revision: doc.digest, observedAt: doc.observedAt, locator: { kind: 'whole-file/1' } };
      report.trust = { basis: 'explicit-single-public-ca-certificate', authority: 'caller-selected-not-approved-by-curia', revision: doc.digest, ambientExtraCa: 'not-used', clientCertificate: 'none' };
    } else {
      ca = [...tls.rootCertificates];
      report.trust = { basis: 'node-bundled-ca-list', revision: { ...digest(Buffer.from(JSON.stringify(ca))), canonicalization: 'ordered-json-pem-list/1' }, ambientExtraCa: 'not-used', clientCertificate: 'none' };
    }
  } catch (error) { report.trust = report.trustSource = null; gap(safeReason(error)); return done(); }
  const controller = new AbortController(), forward = () => controller.abort(), started = performance.now();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, options.timeoutMs);
  signal?.addEventListener('abort', forward, { once: true });
  if (signal?.aborted) controller.abort();
  let received;
  try {
    const resolution = await resolveTarget(options.host, controller.signal), choice = selectExternalAddress(resolution.addresses, options.allowInternal);
    report.observation.dns = { mode: resolution.mode, queries: resolution.queries, returnedAddresses: choice.count, state: choice.state, selectedAddress: choice.selected, policy: ADDRESS_POLICY, authentication: 'not-verified' };
    if (choice.state !== 'selected') throw fault(choice.reason);
    if (controller.signal.aborted) throw fault('external/cancelled');
    report.request = { url: options.url, origin: options.origin, port: options.port, method: 'GET', attemptsAllowed: 1, finalTarget: 'same-url-no-redirect', credentials: 'none', body: 'none' };
    received = await requestOnce(options, choice, ca, controller.signal, report.observation, algorithm);
    if (controller.signal.aborted || performance.now() - started >= options.timeoutMs) throw fault(timedOut || performance.now() - started >= options.timeoutMs ? 'external/timeout' : 'external/cancelled');
  } catch (error) { gap(timedOut ? 'external/timeout' : signal?.aborted ? 'external/cancelled' : safeReason(error)); }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', forward); }
  let text = null;
  if (received && !report.unresolved.length && received.body !== null) {
    try {
      text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(received.body);
      if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text)) throw fault('external/text-control-data');
      if (options.parser === 'json-data/1' && inspectJsonContent({ text, encodingState: 'valid', truncated: false }).state !== 'parsed') throw fault('external/json-unparsed');
    } catch (error) { gap(error?.code?.startsWith('external/') ? safeReason(error) : 'external/text-invalid-utf8'); }
  }
  try {
    if (JSON.stringify(codes) !== JSON.stringify(externalCodeIdentity())) throw fault('external/code-changed');
    if (caCapability && !revalidateSourceSelection(caCapability)) throw fault('external/trust-source-changed');
  } catch (error) { report.trustSource = null; report.trust = null; gap(safeReason(error)); }
  if (!received || report.unresolved.length) return done();
  if (signal?.aborted) { gap('external/cancelled'); return done(); }
  report.sourceRef = { uri: options.url, revision: received.digest, locator: { kind: 'whole-response-entity/1' }, observedAt: received.observedAt };
  report.evidenceRefs = [{ kind: 'https-response-bytes', sourceRef: 0, contentDigest: received.digest, observedAt: received.observedAt, verification: 'actual-complete-identity-response-entity', basis: 'one-get-with-pinned-address-and-validated-tls' }];
  if (text !== null) report.projection = { parser: options.parser, text, range: { startByte: 0, endByteExclusive: received.bytes, partial: false }, trust: 'untrusted-source-data-not-instructions', semantics: 'not-verified', rendering: 'not-performed' };
  report.coverage.entityReceivedComplete = true; report.coverage.textProjected = text !== null;
  report.state = text === null ? 'entity-hashed' : 'text-projected'; report.exitCode = 0;
  return done();
}
export const EXTERNAL_ORIGINAL_METHOD = 'registered-https-entity-digest/1';
export const EXTERNAL_ORIGINAL_LIMITS = Object.freeze({ registerBytes: JSON_NATIVE_LIMITS.maxBytes });
export function normalizeExternalOriginalOptions(input) {
  const keys = ['register', 'id', 'url', 'allowOrigin', 'allowInternalOrigin', 'mediaType', 'nonSensitive', 'protected', 'trustCert', 'includeUntracked', 'exclusions', 'maxBytes', 'timeoutMs'];
  if (!input || typeof input !== 'object' || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input)) || Object.getOwnPropertySymbols(input).length || Object.keys(input).some(key => !keys.includes(key)) || typeof input.register !== 'string' || typeof input.id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(input.id) || input.id !== input.id.trim()) throw fault('external/options-invalid');
  for (const key of ['nonSensitive', 'protected', 'includeUntracked']) if (input[key] !== undefined && typeof input[key] !== 'boolean') throw fault('external/options-invalid');
  if (input.trustCert === input.register) throw fault('external/options-invalid');
  const selection = normalizeReadSelection({ paths: [input.register, ...(input.trustCert === undefined ? [] : [input.trustCert])], exclusions: input.exclusions ?? [] });
  if (selection.exclusions.length > 128 || [...selection.paths, ...selection.exclusions].some(path => /[#%]/u.test(path) || Buffer.byteLength(path) > 4096)) throw fault('external/options-invalid');
  const networkInput = { url: input.url, allowOrigin: input.allowOrigin, allowInternalOrigin: input.allowInternalOrigin, parser: 'digest-only/1', mediaType: input.mediaType, nonSensitive: input.nonSensitive ?? false, protected: input.protected ?? false, maxBytes: input.maxBytes, timeoutMs: input.timeoutMs };
  if (input.trustCert !== undefined) Object.assign(networkInput, { trustCert: input.trustCert, includeUntracked: input.includeUntracked ?? false, exclusions: selection.exclusions });
  const network = normalizeExternalOptions(networkInput);
  return { register: input.register, id: input.id, ...selection, includeUntracked: input.includeUntracked ?? false, networkInput, network };
}

/** Bind a selected declaration to a newly received HTTPS entity, never to an imported reader report. */
export async function verifyRegisteredExternal(root = ROOT, input = {}, signal = null) {
  const options = normalizeExternalOriginalOptions(input), networkOptions = options.network;
  if (signal !== null && !(signal instanceof AbortSignal)) throw fault('external/abort-signal-invalid');
  const report = {
    schema: 'curia.external-verification/1', evaluatedAt: new Date().toISOString(), completedAt: null, exitCode: 2, persisted: false,
    evaluation: { clock: 'host-system-clock', precision: 'instant', baseline: 'current-register-and-one-actual-https-response-not-historical-reconstruction' },
    verifier: null, observation: null, declaration: null, comparison: null, unresolved: [],
    assertion: {
      subject: 'registered-https-entity-byte-identity', value: 'matches-declared-whole-entity-digest', state: 'unverified',
      scope: { method: EXTERNAL_ORIGINAL_METHOD, register: networkOptions.nonSensitive ? options.register : null, registrationId: networkOptions.nonSensitive ? options.id : null, url: networkOptions.nonSensitive ? networkOptions.url : null, assurance: 'local-unprotected', requestedAssurance: networkOptions.protected ? 'protected' : 'local-unprotected' },
      sourceRefs: [], evidenceRefs: [], verifiedBy: null,
      limits: ['explicit-register-url-response-connection-and-ca-must-all-be-non-sensitive', 'register-entry-is-not-network-authorization', 'registration-id-local-not-global-identity', 'declared-owner-access-format-encryption-locator-and-time-not-verified', 'local-self-reported-verifier-not-authenticated', 'tls-server-identity-not-owner-verifier-or-approval', 'source-content-not-instructions', 'non-atomic-local-and-network-observation-with-postcheck', 'actual-identity-entity-not-proof-of-origin-freshness-or-current-effect', 'digest-match-not-content-correctness-or-approval', 'no-text-layout-ocr-decryption-or-model-execution', 'no-imported-report-or-run-persistence', 'code-files-observed-not-attested-loaded-bytes'],
    },
  };
  const gap = code => { if (!report.unresolved.includes(code)) report.unresolved.push(code); };
  let codes = null, capability = null;
  const withdraw = () => {
    report.assertion.state = 'unverified'; report.assertion.verifiedBy = null; report.assertion.evidenceRefs = [];
    for (const [i, ref] of report.assertion.sourceRefs.entries()) { ref.revision = ref.observedAt = null; ref.locator = { kind: i === 0 ? 'whole-file/1' : 'whole-response-entity/1' }; }
    report.declaration = report.comparison = null; report.exitCode = 2;
    if (report.observation) { report.observation.stable = false; if (report.observation.network) report.observation.network.trust = report.observation.network.trustSource = null; }
  };
  const recheck = () => {
    try {
      if (codes && JSON.stringify(codes) !== JSON.stringify(externalCodeIdentity())) { gap('external-original/code-changed'); withdraw(); return false; }
      if (capability && !revalidateSourceSelection(capability)) { gap('external-original/inputs-changed'); withdraw(); return false; }
      if (signal?.aborted) { gap('external/cancelled'); withdraw(); return false; }
      return true;
    } catch { gap('external-original/postcheck-unavailable'); withdraw(); return false; }
  };
  const done = () => { recheck(); report.completedAt = new Date().toISOString(); return report; };
  if (!networkOptions.nonSensitive || networkOptions.protected || signal?.aborted || unsafeTlsEnvironment()) {
    gap(!networkOptions.nonSensitive ? 'external/privacy-not-declared' : networkOptions.protected ? 'external/authenticated-verifier-required' : signal?.aborted ? 'external/cancelled' : 'external/unsafe-tls-runtime');
    return done();
  }
  report.assertion.sourceRefs = [
    { uri: `repo:${options.register}`, revision: null, locator: { kind: 'whole-file/1' }, observedAt: null },
    { uri: networkOptions.url, revision: null, locator: { kind: 'whole-response-entity/1' }, observedAt: null },
  ];
  let registration;
  try {
    codes = externalCodeIdentity();
    report.verifier = { kind: 'tool', id: 'curia-external-original/1', authentication: 'local-self-reported-not-authenticated', implementation: codes, runtime: { name: 'node', version: process.version, platform: process.platform, arch: process.arch } };
    capability = prepareSourceSelection(root, { paths: options.paths, exclusions: options.exclusions, includeUntracked: options.includeUntracked, nonSensitive: true });
    registration = readSourceSubset(capability, [options.register], { maxFiles: 1, maxFileBytes: EXTERNAL_ORIGINAL_LIMITS.registerBytes, maxTotalBytes: EXTERNAL_ORIGINAL_LIMITS.registerBytes });
  } catch { gap('external-original/register-or-scope-unavailable'); return done(); }
  report.observation = { stable: registration.stable, registration: { schema: registration.schema, source: registration.source, privacy: registration.privacy, limits: registration.limits, chargedBytes: registration.chargedBytes, openedFiles: registration.openedFiles, documents: registration.documents.map(({ path, state, reason, git, size }) => ({ path, state, reason, git, size })) }, network: null };
  const doc = registration.documents[0];
  if (!registration.stable || doc?.state !== 'read') { gap('external-original/register-unavailable'); return done(); }
  Object.assign(report.assertion.sourceRefs[0], { revision: doc.digest, observedAt: doc.observedAt });
  const registrationEvidence = { kind: 'local-source-bytes', sourceRef: 0, path: doc.path, contentDigest: doc.digest, observedAt: doc.observedAt, locator: report.assertion.sourceRefs[0].locator, verification: 'actual-complete-source-bytes' };
  report.assertion.evidenceRefs.push(registrationEvidence);
  let parsed;
  try { parsed = inspectOriginalRegister({ text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(doc.bytes), encodingState: 'valid', truncated: false }, options.register); }
  catch { parsed = { state: 'unparsed', reason: 'external-original/register-encoding-invalid' }; }
  if (parsed.state !== 'parsed') { gap(parsed.reason); return done(); }
  const index = parsed.originals.findIndex(entry => entry.id === options.id), entry = parsed.originals[index];
  if (!entry) { gap('external-original/entry-not-found'); return done(); }
  report.assertion.sourceRefs[0].locator = registrationEvidence.locator = { kind: 'json-pointer/1', pointer: `/originals/${index}` };
  if (entry.sourceRef.uri !== networkOptions.url) { gap('external-original/source-selection-mismatch'); return done(); }
  const expected = parseRegisteredOriginalDigestRevision(entry.sourceRef.revision);
  if (!expected) { gap('external-original/revision-uninterpreted'); return done(); }
  report.declaration = { registrationId: options.id, revision: expected, declaredFormat: entry.format, declaredEncryption: entry.encryption, formatVerification: 'not-performed', encryptionVerification: 'not-performed', accessVerification: 'not-performed', locatorVerification: 'not-performed', declaredObservationVerification: 'not-performed', extraction: 'not-invoked', decryption: 'not-invoked' };
  // Known local drift cannot authorize even a request; the same live group is checked again after the response.
  if (!recheck()) return done();
  let response;
  try { response = await readExternalWithDigest(root, options.networkInput, signal, expected.algorithm); }
  catch { gap('external-original/response-unavailable'); return done(); }
  const { schema, evaluatedAt, completedAt, state, authorization, policy, request, observation, trust, trustSource, coverage, unresolved } = response;
  report.observation.network = { schema, evaluatedAt, completedAt, state, authorization, policy, request, observation, trust, trustSource, coverage, unresolved };
  for (const code of unresolved) gap(code);
  if (response.exitCode !== 0 || state !== 'entity-hashed' || !coverage.entityReceivedComplete) { if (!unresolved.length) gap('external-original/response-incomplete'); return done(); }
  const observed = response.sourceRef?.revision;
  if (response.sourceRef?.uri !== networkOptions.url || !isOriginalDigest(observed) || observed.algorithm !== expected.algorithm || observed.canonicalization !== expected.canonicalization || JSON.stringify(response.tool?.implementation) !== JSON.stringify(codes)) { gap('external-original/response-identity-unavailable'); return done(); }
  report.assertion.sourceRefs[1] = structuredClone(response.sourceRef);
  report.assertion.evidenceRefs.push(...response.evidenceRefs.map(ref => ({ ...structuredClone(ref), sourceRef: 1 })));
  report.comparison = { state: expected.value === observed.value ? 'equal' : 'different', expected, observed, basis: 'declared-whole-entity-digest-compared-with-one-actual-complete-identity-response' };
  report.assertion.state = report.comparison.state === 'equal' ? 'confirmed' : 'contradicted';
  report.assertion.verifiedBy = { identityRef: '#/verifier', action: EXTERNAL_ORIGINAL_METHOD, observedAt: new Date().toISOString() };
  report.exitCode = report.assertion.state === 'confirmed' ? 0 : 1;
  return done();
}

export function parseExternalOriginalArgs(argv) { return parseExternalTokens(argv, true); }
export function parseExternalArgs(argv) { return parseExternalTokens(argv, false); }
function parseExternalTokens(argv, verification) {
  const flags = { root: ROOT, json: false, help: false }, options = {}, seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]; if (seen.has(arg) && arg !== '--exclude') throw fault('external/options-invalid'); seen.add(arg);
    const value = () => { const v = argv[++i]; if (!v || v.startsWith('--')) throw fault('external/options-invalid'); return v; };
    const names = { '--url': 'url', '--allow-origin': 'allowOrigin', '--allow-internal-origin': 'allowInternalOrigin', '--parser': 'parser', '--media-type': 'mediaType', '--trust-cert': 'trustCert' };
    if (verification) { delete names['--parser']; names['--register'] = 'register'; names['--id'] = 'id'; }
    if (names[arg]) options[names[arg]] = value();
    else if (arg === '--root') flags.root = value();
    else if (arg === '--json') flags.json = true;
    else if (arg === '--help' || arg === '-h') flags.help = true;
    else if (arg === '--non-sensitive') options.nonSensitive = true;
    else if (arg === '--protected') options.protected = true;
    else if (arg === '--all') options.includeUntracked = true;
    else if (arg === '--exclude') (options.exclusions ??= []).push(value());
    else if (arg === '--max-bytes' || arg === '--timeout-ms') { const raw = value(); if (!/^[1-9][0-9]*$/.test(raw)) throw fault('external/options-invalid'); options[arg === '--max-bytes' ? 'maxBytes' : 'timeoutMs'] = Number(raw); }
    else throw fault('external/options-invalid');
  }
  if (!flags.help) { if (verification) normalizeExternalOriginalOptions(options); else normalizeExternalOptions(options); }
  return { flags, options };
}
export async function externalMain(argv = process.argv.slice(2)) {
  const controller = new AbortController(); let signalCode = 0;
  const interrupt = () => { signalCode = 130; controller.abort(); }, terminate = () => { signalCode = 143; controller.abort(); };
  try {
    const verification = argv[0] === 'verify-original';
    const { flags, options } = verification ? parseExternalOriginalArgs(argv.slice(1)) : parseExternalArgs(argv);
    if (flags.help && verification) { console.log(`node scripts/curia-workflow.mjs external verify-original --register docs/source-register.json --id external-guide --url https://invalid.example/guide.docx --allow-origin https://invalid.example --media-type application/vnd.openxmlformats-officedocument.wordprocessingml.document --non-sensitive --json\n仅核对显式登记的 sha256:raw-bytes/1:<64 位小写 hex>、sha512:raw-bytes/1:<128 位小写 hex> 或单条规范 sha256-/sha512- SRI 摘要与本次完整 HTTPS 实体；未知修订或 URL 不符时不外访。\n网络授权、TLS、CA、限额和取消沿用 external；parser 固定 digest-only/1，不接受已有 reader JSON，不解释业务事实，不持久化。\n--all / --exclude 同时约束登记与可选 CA；登记上限 ${EXTERNAL_ORIGINAL_LIMITS.registerBytes} 字节，--max-bytes 只约束响应实体。\n相符 confirmed=0，矛盾 contradicted=1，未核实或参数非法=2；SIGINT=130，SIGTERM=143；--protected 不降级。`); return; }
    if (flags.help) { console.log(`node scripts/curia-workflow.mjs external --url https://example.com/manual.md --allow-origin https://example.com --parser utf8-text/1 --non-sensitive --json\n单次 HTTPS GET；不跳转、不重试、不发送凭据、不使用代理、不缓存、不落盘。\nverify-original 子命令核对显式登记的修订与真实响应；详见 external verify-original --help。\nparser: ${EXTERNAL_PARSERS.join(', ')}；digest-only/1 必须另给 --media-type。\n内网仅在 --allow-internal-origin 精确匹配时启用；特殊地址仍拒绝。公共 CA 证书可用 --trust-cert <仓内 .crt>，不读取私钥或环境 CA。\n--max-bytes 与 --timeout-ms 有硬上限；--protected 不降级。默认限制：${JSON.stringify(EXTERNAL_LIMITS)}。\n成功＝0，未完成或参数错误＝2，取消＝130／143；成功不表示事实、可见版式或新鲜度已核实。`); return; }
    process.once('SIGINT', interrupt); process.once('SIGTERM', terminate);
    const report = verification ? await verifyRegisteredExternal(flags.root, options, controller.signal) : await readExternalSource(flags.root, options, controller.signal);
    console.log(flags.json ? JSON.stringify(report, null, 2) : `${verification ? report.assertion.state : report.state}${report.unresolved.length ? ': ' + report.unresolved.join(', ') : ''}`);
    process.exitCode = signalCode || report.exitCode;
  } catch { console.error(JSON.stringify({ schema: 'curia.external-error/1', code: 'external/options-or-boundary-invalid' })); process.exitCode = signalCode || 2; }
  finally { process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', terminate); }
}
if (isMainModule(import.meta.url)) await externalMain();
