/** Frozen external assertion event codec. Validation never opens sources or makes a request. */
import { createHash } from 'node:crypto';
import { isOriginalDigest } from './curia-originals.mjs';
import { isIP } from 'node:net';
import { normalizeExternalOptions, selectExternalAddress, samePeerAddress } from './curia-network.mjs';

export const EXTERNAL_ASSERTION_MODE = 'external-verification';
export const EXTERNAL_ASSERTION_RUN_SCHEMA = 'curia.external-assertion-run/1';
export const EXTERNAL_ASSERTION_EVENT_SCHEMA = 'curia.run-event/6';
export const EXTERNAL_ASSERTION_METHOD = 'registered-https-entity-digest/1';
export const EXTERNAL_ASSERTION_LIMITATIONS = Object.freeze([
  'recorded-https-entity-identity-not-business-truth-or-authenticated-approval',
  'historical-observation-no-network-on-show-history-finish-or-validation', 'hash-chain-not-signature-or-worm',
  'source-and-response-bytes-not-archived-or-guaranteed-replayable', 'no-credentials-proxy-redirect-or-project-command',
  'recording-begins-after-observation-not-a-network-supervisor', 'host-clock-not-certified',
  'on-disk-code-not-loaded-module-attestation', 'reference-component-not-all-matching-subjects',
  'no-automatic-gc-backup-or-external-authority',
]);
const VERIFIER_MODULES = ['curia-external.mjs', 'curia-network.mjs', 'curia-verify.mjs', 'curia-query.mjs', 'curia-dependencies.mjs', 'curia-impact.mjs', 'curia-relations.mjs', 'curia-json.mjs', 'curia-instance.mjs', 'curia-originals.mjs', 'curia-applicability.mjs', 'curia-guard-contract.mjs', 'doc-lib.mjs'];
const RECORDER_MODULES = [...VERIFIER_MODULES, 'curia-records.mjs', 'curia-workflow.mjs', 'curia-guard-runtime.mjs', 'curia-check-contract.mjs', 'curia-assertion-contract.mjs', 'curia-external-assertion-contract.mjs'];
const REQUIRED_LIMITS = ['register-entry-is-not-network-authorization', 'local-self-reported-verifier-not-authenticated', 'tls-server-identity-not-owner-verifier-or-approval', 'actual-identity-entity-not-proof-of-origin-freshness-or-current-effect', 'digest-match-not-content-correctness-or-approval', 'no-text-layout-ocr-decryption-or-model-execution', 'no-imported-reports-recording-does-not-upgrade-assurance'];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fail = message => { throw new Error(`${message} [external-assertions/contract]`); };
function object(v, keys) { if (!v || typeof v !== 'object' || Array.isArray(v) || ![Object.prototype, null].includes(Object.getPrototypeOf(v)) || Object.getOwnPropertySymbols(v).length || Object.keys(v).length !== keys.length || keys.some(k => !Object.hasOwn(v, k))) fail('字段缺失或未知'); }
function text(v, max = 4096) { if (typeof v !== 'string' || !v.trim() || v !== v.trim() || Buffer.byteLength(v) > max || /[\u0000-\u001f\u007f]/u.test(v)) fail('文本非法或超限'); }
function path(v) { text(v); if (/[\\:#%*?\[\]{}]/u.test(v) || v.split('/').some(p => !p || p !== p.trim() || ['.', '..', '.git'].includes(p.toLowerCase()))) fail('仓内路径不规范'); }
function array(v, max) { if (!Array.isArray(v) || v.length > max) fail('数组非法或超限'); }
function instant(v) { if (typeof v !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString() !== v) fail('时点非法'); }
function between(v, begin, end) { instant(v); if (v < begin || v > end) fail('观察时点越界'); }
function count(v, max = Number.MAX_SAFE_INTEGER) { if (!Number.isSafeInteger(v) || v < 0 || v > max) fail('计数非法'); }
function digest(v, canonicalization = 'raw-bytes/1') { object(v, ['algorithm', 'canonicalization', 'value']); if (v.algorithm !== 'sha256' || v.canonicalization !== canonicalization || typeof v.value !== 'string' || !/^[0-9a-f]{64}$/.test(v.value)) fail('摘要身份非法'); }
function originalDigest(v) { if (!isOriginalDigest(v)) fail('原件摘要身份非法'); }
function code(v, modules) { array(v, modules.length); if (v.length !== modules.length || new Set(v.map(x => x.file)).size !== v.length || modules.some(file => !v.some(x => x.file === file))) fail('实现闭包不完整'); for (const c of v) { object(c, ['file', 'digest']); digest(c.digest); } }
function referenceShape(p) { object(p.references, ['corrects', 'retriedFrom']); const refs = Object.values(p.references).filter(v => v !== null); if (refs.length > 1 || refs.some(v => typeof v !== 'string' || !/^r-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v))) fail('引用非法'); if (p.references.corrects) text(p.correctionReason); else if (p.correctionReason !== null) fail('更正原因无归属'); return refs; }
export function validateExternalAssertionRequest(v) {
  object(v, ['method', 'register', 'id', 'url', 'allowOrigin', 'allowInternalOrigin', 'mediaType', 'trustCert', 'exclusions', 'includeUntracked', 'nonSensitive', 'maxBytes', 'timeoutMs']);
  if (v.method !== EXTERNAL_ASSERTION_METHOD || v.nonSensitive !== true || typeof v.includeUntracked !== 'boolean') fail('必须显式声明非敏感外部核验');
  path(v.register); if (typeof v.id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(v.id)) fail('登记 ID 非法');
  if (v.trustCert !== null) { path(v.trustCert); if (v.trustCert === v.register) fail('CA 与登记不可混用'); }
  array(v.exclusions, 128); v.exclusions.forEach(path);
  if (new Set(v.exclusions).size !== v.exclusions.length || [v.register, v.trustCert].filter(Boolean).some(p => v.exclusions.some(e => p === e || p.startsWith(`${e}/`)))) fail('排除不一致');
  const input = { url: v.url, allowOrigin: v.allowOrigin, ...(v.allowInternalOrigin === null ? {} : { allowInternalOrigin: v.allowInternalOrigin }), parser: 'digest-only/1', mediaType: v.mediaType, nonSensitive: true, maxBytes: v.maxBytes, timeoutMs: v.timeoutMs, ...(v.trustCert === null ? {} : { trustCert: v.trustCert, includeUntracked: v.includeUntracked, exclusions: v.exclusions }) };
  const n = normalizeExternalOptions(input);
  if (v.maxBytes !== n.maxBytes || v.timeoutMs !== n.timeoutMs || v.allowOrigin !== n.origin || ![null, n.origin].includes(v.allowInternalOrigin)) fail('网络请求未规范化');
}
export function externalAssertionSubjectKey(request) {
  validateExternalAssertionRequest(request);
  const identity = { schema: 'curia.external-assertion-subject/1', method: request.method, register: request.register, registrationId: request.id, url: request.url, subject: 'registered-https-entity-byte-identity', value: 'matches-declared-whole-entity-digest', assurance: 'local-unprotected' };
  return { algorithm: 'sha256', canonicalization: identity.schema, value: createHash('sha256').update(JSON.stringify(identity)).digest('hex') };
}
export function validateExternalAssertionReferences(p, runs) {
  for (const ref of referenceShape(p)) { const events = runs.get(ref), previous = events?.[0]?.data.payload; if (!events || events.at(-1).data.kind !== 'terminal' || previous.executionMode !== EXTERNAL_ASSERTION_MODE || !same(previous.subjectKey, p.subjectKey)) fail('引用必须是同一外部断言的终态 Run'); }
}
export function externalAssertionObservation(report) {
  const assertion = structuredClone(report.assertion);
  assertion.limits = assertion.limits.filter(x => x !== 'no-imported-report-or-run-persistence'); assertion.limits.push('no-imported-reports-recording-does-not-upgrade-assurance');
  const o = report.observation, n = o?.network;
  return { schema: 'curia.external-assertion-observation/1', evaluatedAt: report.evaluatedAt, completedAt: report.completedAt,
    assertion, verifier: structuredClone(report.verifier), declaration: structuredClone(report.declaration), comparison: structuredClone(report.comparison), unresolved: [...report.unresolved], exitCode: report.exitCode,
    capture: { available: o !== null, stable: o?.stable ?? false, registerOpenedFiles: o?.registration?.openedFiles ?? 0, registerChargedBytes: o?.registration?.chargedBytes ?? 0,
      network: n ? { state: n.state, evaluatedAt: n.evaluatedAt, completedAt: n.completedAt, attempts: n.observation.attempts, selectedAddress: n.observation.dns?.selectedAddress ?? null, status: n.observation.status, mediaType: n.observation.response?.mediaType ?? null, receivedBytes: n.observation.receivedBytes, entityComplete: n.coverage.entityReceivedComplete, tls: structuredClone(n.observation.tls), trust: structuredClone(n.trust), trustSource: structuredClone(n.trustSource) } : null } };
}
function validateNetwork(n, p, v) {
  if (n === null) return;
  object(n, ['state', 'evaluatedAt', 'completedAt', 'attempts', 'selectedAddress', 'status', 'mediaType', 'receivedBytes', 'entityComplete', 'tls', 'trust', 'trustSource']);
  if (!['entity-hashed', 'incomplete'].includes(n.state) || ![0, 1].includes(n.attempts) || typeof n.entityComplete !== 'boolean') fail('网络观察状态非法');
  between(n.evaluatedAt, v.evaluatedAt, v.completedAt); between(n.completedAt, n.evaluatedAt, v.completedAt); count(n.receivedBytes);
  if (n.selectedAddress !== null) { if (typeof n.selectedAddress !== 'string' || !isIP(n.selectedAddress)) fail('观察地址非法'); const selected = selectExternalAddress([n.selectedAddress], p.request.allowInternalOrigin !== null); if (selected.state !== 'selected') fail('地址不属于已授予网络范围'); const host = new URL(p.request.url).hostname.replace(/^\[|\]$/g, ''); if (isIP(host) && !samePeerAddress(host, n.selectedAddress)) fail('字面 IP 与实际选定地址不符'); }
  if (n.attempts && n.selectedAddress === null) fail('请求缺少选定目标');
  if (n.status !== null) { count(n.status, 599); if (n.status < 100 || n.attempts !== 1) fail('HTTP 状态无请求'); }
  if (n.mediaType !== null) { text(n.mediaType, 128); if (n.mediaType !== p.request.mediaType) fail('已接纳 MIME 与请求不符'); }
  if (n.tls !== null) { object(n.tls, ['protocol', 'certificateAndHostname', 'peerAddressPinned', 'certificateDigest']); if (!['TLSv1.2', 'TLSv1.3'].includes(n.tls.protocol) || n.tls.certificateAndHostname !== 'validated' || n.tls.peerAddressPinned !== true || n.attempts !== 1 || !n.selectedAddress) fail('TLS 证明非法'); digest(n.tls.certificateDigest); }
  if (n.trust !== null) {
    const t = n.trust, explicit = p.request.trustCert !== null;
    object(t, ['basis', ...(explicit ? ['authority'] : []), 'revision', 'ambientExtraCa', 'clientCertificate']);
    if (t.basis !== (explicit ? 'explicit-single-public-ca-certificate' : 'node-bundled-ca-list') || t.ambientExtraCa !== 'not-used' || t.clientCertificate !== 'none' || explicit && t.authority !== 'caller-selected-not-approved-by-curia') fail('信任不能升级为认证权限');
    digest(t.revision, explicit ? 'raw-bytes/1' : 'ordered-json-pem-list/1');
    if (explicit) { const ref = n.trustSource; object(ref, ['uri', 'revision', 'observedAt', 'locator']); if (ref.uri !== `repo:${p.request.trustCert}` || !same(ref.revision, t.revision) || !same(ref.locator, { kind: 'whole-file/1' })) fail('CA 来源不匹配'); between(ref.observedAt, n.evaluatedAt, n.completedAt); }
    else if (n.trustSource !== null) fail('内置信任不能假称文件来源');
  } else if (n.trustSource !== null) fail('已撤回信任不能保留 CA 证明');
  if (n.entityComplete && (n.state !== 'entity-hashed' || n.attempts !== 1 || n.status !== 200 || n.mediaType !== p.request.mediaType || !n.tls || n.receivedBytes > p.request.maxBytes)) fail('完整实体缺实际连接或超限');
  if (n.state === 'entity-hashed' && !n.entityComplete) fail('实体摘要不能来自前缀');
}
export function validateExternalAssertionBegin(p) {
  object(p, ['schema', 'executionMode', 'request', 'subjectKey', 'recordContext', 'verification', 'references', 'correctionReason', 'codeIdentity']);
  if (p.schema !== EXTERNAL_ASSERTION_RUN_SCHEMA || p.executionMode !== EXTERNAL_ASSERTION_MODE) fail('外部断言版本或模式不匹配');
  validateExternalAssertionRequest(p.request); digest(p.subjectKey, 'curia.external-assertion-subject/1'); if (!same(p.subjectKey, externalAssertionSubjectKey(p.request))) fail('主题身份不符'); referenceShape(p);
  const ctx = p.recordContext; object(ctx, ['root', 'head', 'registryDigest', 'gitIndexDigest', 'recordStore']); text(ctx.root); path(ctx.recordStore); if (ctx.head !== null && (typeof ctx.head !== 'string' || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(ctx.head))) fail('HEAD 身份非法'); digest(ctx.registryDigest); digest(ctx.gitIndexDigest); code(p.codeIdentity, RECORDER_MODULES);
  const v = p.verification; object(v, ['schema', 'evaluatedAt', 'completedAt', 'assertion', 'verifier', 'declaration', 'comparison', 'unresolved', 'exitCode', 'capture']); if (v.schema !== 'curia.external-assertion-observation/1') fail('观察版本不符'); instant(v.evaluatedAt); between(v.completedAt, v.evaluatedAt, v.completedAt);
  array(v.unresolved, 128); v.unresolved.forEach(x => text(x, 256)); if (new Set(v.unresolved).size !== v.unresolved.length) fail('缺口重复');
  const c = v.capture; object(c, ['available', 'stable', 'registerOpenedFiles', 'registerChargedBytes', 'network']); if (typeof c.available !== 'boolean' || typeof c.stable !== 'boolean') fail('采集状态非法'); count(c.registerOpenedFiles, 1); count(c.registerChargedBytes, 64 * 1024); if (!c.available && (c.stable || c.registerOpenedFiles || c.registerChargedBytes || c.network !== null)) fail('未读取不能声明采集'); validateNetwork(c.network, p, v); if (c.network && (!c.available || c.registerOpenedFiles !== 1 || c.registerChargedBytes === 0)) fail('外访前必须完整读取登记');
  const a = v.assertion; object(a, ['subject', 'value', 'state', 'scope', 'sourceRefs', 'evidenceRefs', 'verifiedBy', 'limits']);
  if (a.subject !== 'registered-https-entity-byte-identity' || a.value !== 'matches-declared-whole-entity-digest' || !['confirmed', 'contradicted', 'unverified'].includes(a.state) || !same(a.scope, { method: p.request.method, register: p.request.register, registrationId: p.request.id, url: p.request.url, assurance: 'local-unprotected', requestedAssurance: 'local-unprotected' })) fail('外部断言范围不符');
  array(a.limits, 32); a.limits.forEach(x => text(x, 256)); if (REQUIRED_LIMITS.some(x => !a.limits.includes(x)) || a.limits.includes('no-imported-report-or-run-persistence')) fail('保证限制缺失或矛盾');
  array(a.sourceRefs, 2); array(a.evidenceRefs, 2); if (![0, 2].includes(a.sourceRefs.length)) fail('来源必须成对或未开始');
  for (const [i, ref] of a.sourceRefs.entries()) {
    object(ref, ['uri', 'revision', 'locator', 'observedAt']); if (ref.uri !== (i ? p.request.url : `repo:${p.request.register}`)) fail('来源 URI 与授权不符');
    if (i) { if (!same(ref.locator, { kind: 'whole-response-entity/1' })) fail('响应必须是整个实体'); }
    else if (!same(ref.locator, { kind: 'whole-file/1' })) { object(ref.locator, ['kind', 'pointer']); if (ref.locator.kind !== 'json-pointer/1' || !/^\/originals\/(?:0|[1-9][0-9]{0,2})$/.test(ref.locator.pointer) || Number(ref.locator.pointer.slice(11)) > 127) fail('登记定位非法'); }
    if (ref.revision === null) { if (ref.observedAt !== null) fail('无修订却有观察'); } else { (i ? originalDigest : digest)(ref.revision); between(ref.observedAt, v.evaluatedAt, v.completedAt); }
  }
  const seen = new Set();
  for (const e of a.evidenceRefs) {
    if (![0, 1].includes(e.sourceRef) || seen.has(e.sourceRef)) fail('证据编号非法'); seen.add(e.sourceRef);
    object(e, ['kind', 'sourceRef', 'contentDigest', 'observedAt', 'verification', ...(e.sourceRef ? ['basis'] : ['path', 'locator'])]);
    const ref = a.sourceRefs[e.sourceRef]; if (!ref?.revision || !same(ref.revision, e.contentDigest) || ref.observedAt !== e.observedAt || !c.stable) fail('证据与来源不符或已漂移');
    if (!e.sourceRef) { if (e.kind !== 'local-source-bytes' || e.path !== p.request.register || !same(ref.locator, e.locator) || e.verification !== 'actual-complete-source-bytes' || c.registerOpenedFiles !== 1) fail('登记证据未实际读取'); }
    else if (e.kind !== 'https-response-bytes' || e.verification !== 'actual-complete-identity-response-entity' || e.basis !== 'one-get-with-pinned-address-and-validated-tls' || !c.network?.entityComplete || !c.network.trust) fail('响应证据缺实际完整实体或信任');
  }
  if (seen.has(1)) { between(a.sourceRefs[1].observedAt, c.network.evaluatedAt, c.network.completedAt); if (a.sourceRefs[0].observedAt > c.network.evaluatedAt) fail('外访早于登记观察'); }
  if (a.sourceRefs.filter(r => r.revision !== null).length !== seen.size || seen.has(1) && !seen.has(0)) fail('证据覆盖不一致');
  if (v.verifier !== null) { const t = v.verifier; object(t, ['kind', 'id', 'authentication', 'implementation', 'runtime']); if (t.kind !== 'tool' || t.id !== 'curia-external-original/1' || t.authentication !== 'local-self-reported-not-authenticated') fail('工具身份不得升级'); code(t.implementation, VERIFIER_MODULES); object(t.runtime, ['name', 'version', 'platform', 'arch']); Object.values(t.runtime).forEach(x => text(x, 128)); if (t.runtime.name !== 'node' || t.implementation.some(item => !p.codeIdentity.some(c => c.file === item.file && same(c.digest, item.digest)))) fail('工具与记录闭包不一致'); }
  if (v.declaration !== null) { const d = v.declaration; object(d, ['registrationId', 'revision', 'declaredFormat', 'declaredEncryption', 'formatVerification', 'encryptionVerification', 'accessVerification', 'locatorVerification', 'declaredObservationVerification', 'extraction', 'decryption']); originalDigest(d.revision); if (!seen.has(0) || a.sourceRefs[0].locator.kind !== 'json-pointer/1' || d.registrationId !== p.request.id || typeof d.declaredFormat !== 'string' || !/^[a-z][a-z0-9.+-]{0,31}$/.test(d.declaredFormat) || !['unknown', 'encrypted', 'not-encrypted'].includes(d.declaredEncryption) || ['formatVerification', 'encryptionVerification', 'accessVerification', 'locatorVerification', 'declaredObservationVerification'].some(k => d[k] !== 'not-performed') || d.extraction !== 'not-invoked' || d.decryption !== 'not-invoked') fail('声明不得升级为内容或身份验证'); }
  if (v.comparison !== null) { const x = v.comparison; object(x, ['state', 'expected', 'observed', 'basis']); originalDigest(x.expected); originalDigest(x.observed); if (!v.declaration || !seen.has(1) || x.expected.algorithm !== x.observed.algorithm || x.expected.canonicalization !== x.observed.canonicalization || !same(x.expected, v.declaration.revision) || !same(x.observed, a.sourceRefs[1].revision) || x.state !== (x.expected.value === x.observed.value ? 'equal' : 'different') || x.basis !== 'declared-whole-entity-digest-compared-with-one-actual-complete-identity-response') fail('比较必须绑定期望与实际响应'); }
  if (a.state === 'unverified') { if (v.exitCode !== 2 || a.verifiedBy !== null || !v.unresolved.length || v.comparison !== null || seen.has(1)) fail('缺口不能被签成响应结论'); }
  else { if (v.exitCode !== (a.state === 'confirmed' ? 0 : 1) || v.unresolved.length || !v.verifier || !c.stable || seen.size !== 2 || v.comparison?.state !== (a.state === 'confirmed' ? 'equal' : 'different')) fail('结论缺实际证据'); object(a.verifiedBy, ['identityRef', 'action', 'observedAt']); if (a.verifiedBy.identityRef !== '#/verifier' || a.verifiedBy.action !== p.request.method) fail('核验动作非法'); between(a.verifiedBy.observedAt, v.evaluatedAt, v.completedAt); if (a.sourceRefs.some(ref => ref.observedAt > a.verifiedBy.observedAt) || a.sourceRefs[0].observedAt > a.sourceRefs[1].observedAt || c.network.completedAt > a.verifiedBy.observedAt) fail('证据时序不符'); }
}
export function deriveExternalAssertionTerminal(events, endedAt, drift = []) {
  const p = events[0].data.payload; validateExternalAssertionBegin(p); instant(endedAt); array(drift, 4); if (drift.some(x => !['registry', 'code', 'head', 'index'].includes(x)) || new Set(drift).size !== drift.length || endedAt < p.verification.completedAt) fail('封存上下文非法');
  const assertionState = p.verification.assertion.state, status = drift.length || assertionState === 'unverified' ? 'incomplete' : assertionState === 'contradicted' ? 'failed' : 'passed';
  return { status, terminal: true, endedAt, exitCode: { passed: 0, failed: 1, incomplete: 2 }[status], assertionState, drift, businessOutcome: 'not-evaluated', factVerification: 'registered-whole-https-entity-digest-only', sourceCurrency: 'not-revalidated-at-seal', limits: [...EXTERNAL_ASSERTION_LIMITATIONS] };
}
