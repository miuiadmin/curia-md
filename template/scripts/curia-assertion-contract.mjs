/** Versioned local assertion recording codec. Pure validation; no verification, I/O or authority grants. */
import { createHash } from 'node:crypto';
import { isOriginalDigest } from './curia-originals.mjs';
import { validJsonLocator } from './curia-json.mjs';

export const ASSERTION_RUN_SCHEMA = 'curia.assertion-run/1';
export const ASSERTION_MODE = 'local-verification';
export const ASSERTION_EVENT_SCHEMA = 'curia.run-event/4';
export const ORIGINAL_ASSERTION_RUN_SCHEMA = 'curia.assertion-run/2';
export const ORIGINAL_ASSERTION_EVENT_SCHEMA = 'curia.run-event/5';
export const ORIGINAL_ASSERTION_METHOD = 'registered-original-digest/1';
export const ASSERTION_HISTORY_LIMIT = 256;
export const ASSERTION_RECORD_LIMITATIONS = Object.freeze([
  'recorded-local-equality-not-business-truth-or-authenticated-approval',
  'historical-observation-not-current-source-revalidation', 'hash-chain-not-signature-or-worm',
  'source-bytes-not-archived-or-guaranteed-replayable', 'no-network-or-project-command-execution',
  'host-clock-not-certified', 'on-disk-code-not-loaded-module-attestation', 'receiver-completeness-not-observed',
  'reference-component-not-all-matching-subjects', 'no-automatic-gc-backup-or-external-authority',
]);
const METHODS = ['json-value-equal/1', 'raw-bytes-equal/1'];
// Frozen implementation closure for this observation schema, not a claim of authenticated loaded bytes.
const VERIFIER_MODULES = ['curia-verify.mjs', 'curia-query.mjs', 'curia-dependencies.mjs', 'curia-impact.mjs', 'curia-relations.mjs', 'curia-json.mjs', 'curia-instance.mjs', 'curia-originals.mjs', 'curia-applicability.mjs', 'curia-guard-contract.mjs', 'doc-lib.mjs'];
const UUID = 'r-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const runId = new RegExp(`^${UUID}$`);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const plain = (v) => v && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v)) && !Object.getOwnPropertySymbols(v).length;
const fail = (message) => { throw new Error(`${message} [assertions/contract]`); };
function object(v, keys) { if (!plain(v) || Object.keys(v).length !== keys.length || keys.some(k => !Object.hasOwn(v, k))) fail('字段缺失或包含未知字段'); }
function text(v, max = 4096, empty = false) { if (typeof v !== 'string' || (!empty && !v.trim()) || v !== v.trim() || Buffer.byteLength(v) > max || /[\u0000-\u001f\u007f]/u.test(v)) fail('文本必须有界且无控制字符'); }
function array(v, max) { if (!Array.isArray(v) || v.length > max) fail('数组超限或形态非法'); }
function instant(v) { if (typeof v !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString() !== v) fail('观察时点非法'); }
function path(v) { text(v); if (/[\\:#%*?\[\]{}]/u.test(v) || v.split('/').some(p => !p || p !== p.trim() || ['.', '..', '.git'].includes(p.toLowerCase()))) fail('路径必须是精确仓内路径'); }
function digest(v, canonicalization = 'raw-bytes/1') { object(v, ['algorithm', 'canonicalization', 'value']); if (v.algorithm !== 'sha256' || v.canonicalization !== canonicalization || typeof v.value !== 'string' || !/^[0-9a-f]{64}$/.test(v.value)) fail('摘要合同不匹配'); }
function originalDigest(v) { if (!isOriginalDigest(v)) fail('原件摘要身份非法'); }
function code(v) { array(v, 32); if (!v.length || new Set(v.map(x => x.file)).size !== v.length) fail('实现身份缺失或重复'); for (const c of v) { object(c, ['file', 'digest']); path(c.file); digest(c.digest); } }
function timeBetween(v, begin, end) { instant(v); if (v < begin || v > end) fail('证据时点不属于本次核验'); }

export function validateAssertionRequest(v) {
  object(v, ['method', 'left', 'right', 'exclusions', 'includeUntracked', 'nonSensitive']);
  if (!METHODS.includes(v.method) || v.nonSensitive !== true || typeof v.includeUntracked !== 'boolean') fail('只支持显式非敏感本地等值核验');
  const json = v.method === METHODS[0];
  for (const operand of [v.left, v.right]) {
    object(operand, ['path', ...(json ? ['pointer'] : [])]); path(operand.path);
    if (json) { if (!validJsonLocator(operand.pointer)) fail('JSON 定位符非法'); if (Buffer.byteLength(operand.pointer) > 4096) fail('JSON 定位符超限'); }
  }
  array(v.exclusions, 128); v.exclusions.forEach(path);
  if (new Set(v.exclusions).size !== v.exclusions.length || [v.left.path, v.right.path].some(p => v.exclusions.some(e => p === e || p.startsWith(`${e}/`)))) fail('输入重复排除或选集被排除');
}
export function assertionSubjectKey(request) {
  if (request?.method === ORIGINAL_ASSERTION_METHOD) return originalAssertionSubjectKey(request);
  validateAssertionRequest(request);
  const operand = x => ({ path: x.path, ...(request.method === METHODS[0] ? { pointer: x.pointer } : {}) });
  const identity = { schema: 'curia.assertion-subject/1', subject: 'selected-source-equality', value: 'equal', method: request.method, left: operand(request.left), right: operand(request.right), assurance: 'local-unprotected' };
  return { algorithm: 'sha256', canonicalization: 'curia.assertion-subject/1', value: createHash('sha256').update(JSON.stringify(identity)).digest('hex') };
}
export function validateAssertionReferences(p, runs) {
  object(p.references, ['corrects', 'retriedFrom']);
  const refs = Object.values(p.references).filter(v => v !== null);
  if (refs.length > 1 || refs.some(v => typeof v !== 'string' || !runId.test(v))) fail('只接受一个显式更正或重试目标');
  if (p.references.corrects) text(p.correctionReason); else if (p.correctionReason !== null) fail('更正原因只能与 corrects 同用');
  for (const ref of refs) {
    const target = runs.get(ref), previous = target?.[0]?.data.payload;
    if (!target || target.at(-1).data.kind !== 'terminal' || previous?.executionMode !== ASSERTION_MODE || !same(previous.subjectKey, p.subjectKey)) fail('引用必须是同一精确断言的既有终态记录');
  }
}
export function assertionObservation(report) {
  if (report?.assertion?.scope?.method === ORIGINAL_ASSERTION_METHOD) return originalAssertionObservation(report);
  const assertion = structuredClone(report.assertion);
  assertion.limits = assertion.limits.filter(x => x !== 'no-persistence-supersession-or-protected-delivery');
  assertion.limits.push('recording-does-not-upgrade-verification-or-protected-delivery');
  return {
    schema: 'curia.assertion-observation/1', evaluatedAt: report.evaluatedAt, completedAt: report.completedAt,
    assertion, verifier: structuredClone(report.verifier), comparison: structuredClone(report.comparison),
    unresolved: [...report.unresolved], exitCode: report.exitCode,
    capture: { available: report.observation !== null, stable: report.observation?.stable ?? false, openedFiles: report.observation?.openedFiles ?? 0, chargedBytes: report.observation?.chargedBytes ?? 0 },
  };
}
export function validateAssertionBegin(p) {
  if (p?.schema === ORIGINAL_ASSERTION_RUN_SCHEMA) return validateOriginalAssertionBegin(p);
  object(p, ['schema', 'executionMode', 'request', 'subjectKey', 'recordContext', 'verification', 'references', 'correctionReason', 'codeIdentity']);
  if (p.schema !== ASSERTION_RUN_SCHEMA || p.executionMode !== ASSERTION_MODE) fail('断言记录版本或模式不受支持');
  validateAssertionRequest(p.request); digest(p.subjectKey, 'curia.assertion-subject/1');
  if (!same(p.subjectKey, assertionSubjectKey(p.request))) fail('断言身份与请求不一致');
  object(p.references, ['corrects', 'retriedFrom']);
  if (Object.values(p.references).filter(v => v !== null).length > 1 || Object.values(p.references).some(v => v !== null && (typeof v !== 'string' || !runId.test(v)))) fail('引用非法');
  if (p.references.corrects) text(p.correctionReason); else if (p.correctionReason !== null) fail('无更正却声明原因');
  const ctx = p.recordContext;
  object(ctx, ['root', 'head', 'registryDigest', 'gitIndexDigest', 'recordStore']); text(ctx.root); path(ctx.recordStore);
  if (ctx.head !== null && (typeof ctx.head !== 'string' || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(ctx.head))) fail('Git HEAD 身份非法');
  digest(ctx.registryDigest); digest(ctx.gitIndexDigest); code(p.codeIdentity);
  const v = p.verification;
  object(v, ['schema', 'evaluatedAt', 'completedAt', 'assertion', 'verifier', 'comparison', 'unresolved', 'exitCode', 'capture']);
  if (v.schema !== 'curia.assertion-observation/1') fail('核验观察版本不支持');
  instant(v.evaluatedAt); instant(v.completedAt); if (v.evaluatedAt > v.completedAt) fail('核验时点倒退');
  object(v.capture, ['available', 'stable', 'openedFiles', 'chargedBytes']);
  if (typeof v.capture.available !== 'boolean' || typeof v.capture.stable !== 'boolean' || !Number.isSafeInteger(v.capture.openedFiles) || v.capture.openedFiles < 0 || v.capture.openedFiles > 2 || !Number.isSafeInteger(v.capture.chargedBytes) || v.capture.chargedBytes < 0 || v.capture.chargedBytes > 2 * 64 * 1024 || (!v.capture.available && (v.capture.stable || v.capture.openedFiles || v.capture.chargedBytes))) fail('读取覆盖非法');
  array(v.unresolved, 128); v.unresolved.forEach(x => text(x, 256)); if (new Set(v.unresolved).size !== v.unresolved.length) fail('缺口重复');
  const a = v.assertion;
  object(a, ['subject', 'value', 'state', 'scope', 'sourceRefs', 'evidenceRefs', 'verifiedBy', 'limits']);
  if (a.subject !== 'selected-source-equality' || a.value !== 'equal' || !['confirmed', 'contradicted', 'unverified'].includes(a.state)) fail('断言主题或状态非法');
  if (!same(a.scope, { method: p.request.method, assurance: 'local-unprotected', requestedAssurance: 'local-unprotected' })) fail('持久化不提升核验保证');
  array(a.limits, 32); a.limits.forEach(x => text(x, 256)); if (!a.limits.includes('self-reported-tool-not-authenticated-identity-or-approval') || !a.limits.includes('only-selected-equality-not-business-truth-or-schema-validation')) fail('不能删除核验限制');
  array(a.sourceRefs, 2); array(a.evidenceRefs, 2); if (a.sourceRefs.length !== 2) fail('必须有两个明确来源');
  const expectedLocator = operand => p.request.method === METHODS[0] ? { kind: 'json-pointer/1', pointer: operand.pointer } : { kind: 'whole-file/1' };
  for (const [i, ref] of a.sourceRefs.entries()) {
    object(ref, ['uri', 'revision', 'locator', 'observedAt']); const operand = i ? p.request.right : p.request.left;
    if (ref.uri !== `repo:${operand.path}` || !same(ref.locator, expectedLocator(operand))) fail('SourceRef 与精确请求不一致');
    if (ref.revision === null) { if (ref.observedAt !== null) fail('缺少完整修订却声明已观察'); }
    else { digest(ref.revision); timeBetween(ref.observedAt, v.evaluatedAt, v.completedAt); }
  }
  const seen = new Set();
  for (const e of a.evidenceRefs) {
    object(e, ['kind', 'path', 'contentDigest', 'observedAt', 'sourceRef', 'locator', 'verification']);
    if (![0, 1].includes(e.sourceRef) || seen.has(e.sourceRef)) fail('证据来源编号无效或重复'); seen.add(e.sourceRef);
    const ref = a.sourceRefs[e.sourceRef];
    if (e.kind !== 'local-source-bytes' || `repo:${e.path}` !== ref.uri || !ref.revision || !same(e.contentDigest, ref.revision) || e.observedAt !== ref.observedAt || !same(e.locator, ref.locator) || e.verification !== 'actual-complete-source-bytes') fail('EvidenceRef 与实际来源不一致');
  }
  if (new Set(a.evidenceRefs.map(e => e.path)).size > v.capture.openedFiles) fail('证据来源多于实际打开的文件');
  if (a.sourceRefs.filter(ref => ref.revision !== null).length !== a.evidenceRefs.length || a.evidenceRefs.length && (!v.capture.available || !v.capture.openedFiles)) fail('完整字节与证据覆盖不一致');
  if (v.verifier !== null) {
    object(v.verifier, ['kind', 'id', 'authentication', 'implementation', 'runtime']);
    if (v.verifier.kind !== 'tool' || v.verifier.id !== 'curia-verify/1' || v.verifier.authentication !== 'local-self-reported-not-authenticated') fail('工具身份不可升级为认证身份');
    code(v.verifier.implementation); object(v.verifier.runtime, ['name', 'version', 'platform', 'arch']);
    if (v.verifier.runtime.name !== 'node') fail('运行时身份非法'); Object.values(v.verifier.runtime).forEach(x => text(x, 128));
    if (v.verifier.implementation.length !== VERIFIER_MODULES.length || VERIFIER_MODULES.some(file => !v.verifier.implementation.some(c => c.file === file))) fail('核验实现模块集合不完整或不属于当前合同');
    if (v.verifier.implementation.some(c => !p.codeIdentity.some(item => item.file === c.file && same(item.digest, c.digest)))) fail('核验器实现身份未绑定本次记录实现');
  }
  if (v.comparison !== null) {
    const json = p.request.method === METHODS[0]; object(v.comparison, ['state', ...(json ? ['left', 'right'] : [])]);
    if (!(json ? ['equal', 'different', 'missing'] : ['equal', 'different']).includes(v.comparison.state)) fail('比较结果非法');
    if (json) for (const side of ['left', 'right']) {
      const shape = v.comparison[side]; object(shape, ['present', 'kind']);
      if (typeof shape.present !== 'boolean' || (shape.present ? !['null', 'boolean', 'number', 'string', 'array', 'object'].includes(shape.kind) : shape.kind !== null)) fail('比较类型不可包含字段值');
    }
    if (json && (v.comparison.state === 'missing') !== (!v.comparison.left.present || !v.comparison.right.present)) fail('字段缺失不等于比较相符');
  }
  if (a.state === 'unverified') { if (v.exitCode !== 2 || a.verifiedBy !== null || !v.unresolved.length || v.comparison && v.comparison.state !== 'missing') fail('未核验必须保留缺口且不得声明比较成功'); }
  else {
    if (v.exitCode !== (a.state === 'confirmed' ? 0 : 1) || v.unresolved.length || !v.capture.stable || !v.verifier || a.evidenceRefs.length !== 2 || v.comparison?.state !== (a.state === 'confirmed' ? 'equal' : 'different')) fail('断言状态不能由空证据或缺口升级');
    object(a.verifiedBy, ['identityRef', 'action', 'observedAt']);
    if (a.verifiedBy.identityRef !== '#/verifier' || a.verifiedBy.action !== p.request.method) fail('核验动作不匹配');
    timeBetween(a.verifiedBy.observedAt, v.evaluatedAt, v.completedAt);
    if (a.sourceRefs.some(ref => ref.observedAt > a.verifiedBy.observedAt)) fail('动作早于证据');
  }
}
export function deriveAssertionTerminal(events, endedAt, drift = []) {
  const begin = events[0].data.payload; validateAssertionBegin(begin); instant(endedAt);
  array(drift, 4); if (drift.some(x => !['registry', 'code', 'head', 'index'].includes(x)) || new Set(drift).size !== drift.length) fail('记录上下文漂移非法');
  if (endedAt < begin.verification.completedAt) fail('封存早于实际核验');
  const assertionState = begin.verification.assertion.state;
  const status = drift.length || assertionState === 'unverified' ? 'incomplete' : assertionState === 'contradicted' ? 'failed' : 'passed';
  return { status, terminal: true, endedAt, exitCode: { passed: 0, failed: 1, incomplete: 2 }[status], assertionState, drift, businessOutcome: 'not-evaluated', factVerification: begin.schema === ORIGINAL_ASSERTION_RUN_SCHEMA ? 'registered-whole-original-digest-only' : 'selected-local-equality-only', sourceCurrency: 'not-revalidated-at-seal', limits: [...ASSERTION_RECORD_LIMITATIONS] };
}


/** Event version follows the begin contract, never a caller-selected downgrade. */
export function assertionEventSchema(begin) {
  if (begin?.schema === ASSERTION_RUN_SCHEMA) return ASSERTION_EVENT_SCHEMA;
  if (begin?.schema === ORIGINAL_ASSERTION_RUN_SCHEMA) return ORIGINAL_ASSERTION_EVENT_SCHEMA;
  fail('断言开始合同版本不受支持');
}
function validateOriginalAssertionRequest(v) {
  object(v, ['method', 'register', 'id', 'source', 'exclusions', 'includeUntracked', 'nonSensitive', 'maxSourceBytes']);
  if (v.method !== ORIGINAL_ASSERTION_METHOD || v.nonSensitive !== true || typeof v.includeUntracked !== 'boolean' || !Number.isSafeInteger(v.maxSourceBytes) || v.maxSourceBytes < 1 || v.maxSourceBytes > 512 * 1024 * 1024) fail('原件记录请求或摘要预算非法');
  path(v.register); path(v.source); text(v.id, 64);
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(v.id)) fail('登记 ID 非法');
  array(v.exclusions, 128); v.exclusions.forEach(path);
  if (new Set(v.exclusions).size !== v.exclusions.length || [v.register, v.source].some(p => v.exclusions.some(e => p === e || p.startsWith(`${e}/`)))) fail('原件输入被排除或排除重复');
}
function originalAssertionSubjectKey(request) {
  validateOriginalAssertionRequest(request);
  const identity = { schema: 'curia.assertion-subject/2', subject: 'registered-original-byte-identity', value: 'matches-declared-whole-file-digest', method: request.method, register: request.register, registrationId: request.id, source: request.source, assurance: 'local-unprotected' };
  return { algorithm: 'sha256', canonicalization: identity.schema, value: createHash('sha256').update(JSON.stringify(identity)).digest('hex') };
}
function originalAssertionObservation(report) {
  const assertion = structuredClone(report.assertion);
  assertion.limits = assertion.limits.filter(x => x !== 'no-persistence-supersession-or-protected-delivery');
  assertion.limits.push('recording-does-not-upgrade-verification-or-protected-delivery');
  const phase = value => ({ available: value !== null && value !== undefined, stable: value?.stable ?? false, openedFiles: value?.openedFiles ?? 0, chargedBytes: value?.chargedBytes ?? 0 });
  return { schema: 'curia.assertion-observation/2', evaluatedAt: report.evaluatedAt, completedAt: report.completedAt,
    assertion, verifier: structuredClone(report.verifier), declaration: structuredClone(report.declaration), comparison: structuredClone(report.comparison), unresolved: [...report.unresolved], exitCode: report.exitCode,
    capture: { ...phase(report.observation), register: phase(report.observation?.register), original: phase(report.observation?.original) } };
}
/** Frozen original-digest observation contract. Does not reinterpret equality observation /1. */
function validateOriginalAssertionBegin(p) {
  object(p, ['schema', 'executionMode', 'request', 'subjectKey', 'recordContext', 'verification', 'references', 'correctionReason', 'codeIdentity']);
  if (p.schema !== ORIGINAL_ASSERTION_RUN_SCHEMA || p.executionMode !== ASSERTION_MODE) fail('原件记录版本或模式不受支持');
  const request = p.request; validateOriginalAssertionRequest(request); digest(p.subjectKey, 'curia.assertion-subject/2');
  if (!same(p.subjectKey, assertionSubjectKey(request))) fail('原件断言身份与请求不一致');
  object(p.references, ['corrects', 'retriedFrom']);
  if (Object.values(p.references).filter(v => v !== null).length > 1 || Object.values(p.references).some(v => v !== null && (typeof v !== 'string' || !runId.test(v)))) fail('原件引用非法');
  if (p.references.corrects) text(p.correctionReason); else if (p.correctionReason !== null) fail('无更正却声明原因');
  const ctx = p.recordContext; object(ctx, ['root', 'head', 'registryDigest', 'gitIndexDigest', 'recordStore']); text(ctx.root); path(ctx.recordStore);
  if (ctx.head !== null && (typeof ctx.head !== 'string' || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(ctx.head))) fail('Git HEAD 身份非法');
  digest(ctx.registryDigest); digest(ctx.gitIndexDigest); code(p.codeIdentity);
  const recorderModules = [...VERIFIER_MODULES, 'curia-records.mjs', 'curia-workflow.mjs', 'curia-guard-runtime.mjs', 'curia-check-contract.mjs', 'curia-assertion-contract.mjs'];
  if (p.codeIdentity.length !== recorderModules.length || recorderModules.some(file => !p.codeIdentity.some(item => item.file === file))) fail('原件记录器实现闭包不完整或版本不符');
  const v = p.verification; object(v, ['schema', 'evaluatedAt', 'completedAt', 'assertion', 'verifier', 'declaration', 'comparison', 'unresolved', 'exitCode', 'capture']);
  if (v.schema !== 'curia.assertion-observation/2') fail('原件观察版本不支持');
  instant(v.evaluatedAt); instant(v.completedAt); if (v.evaluatedAt > v.completedAt) fail('核验时点倒退');
  const capture = v.capture; object(capture, ['available', 'stable', 'openedFiles', 'chargedBytes', 'register', 'original']);
  const phase = (x, max, files, keys = ['available', 'stable', 'openedFiles', 'chargedBytes']) => {
    object(x, keys);
    if (typeof x.available !== 'boolean' || typeof x.stable !== 'boolean' || !Number.isSafeInteger(x.openedFiles) || x.openedFiles < 0 || x.openedFiles > files || !Number.isSafeInteger(x.chargedBytes) || x.chargedBytes < 0 || x.chargedBytes > max || (!x.available && (x.stable || x.openedFiles || x.chargedBytes))) fail('原件读取阶段形态非法');
  };
  phase(capture, 64 * 1024 + request.maxSourceBytes, 2, ['available', 'stable', 'openedFiles', 'chargedBytes', 'register', 'original']); phase(capture.register, 64 * 1024, 1); phase(capture.original, request.maxSourceBytes, 1);
  if (capture.available !== capture.register.available || capture.openedFiles !== capture.register.openedFiles + capture.original.openedFiles || capture.chargedBytes !== capture.register.chargedBytes + capture.original.chargedBytes || capture.stable && !(capture.register.stable && (!capture.original.available || capture.original.stable)) || capture.original.available && (!capture.register.stable || capture.register.openedFiles !== 1)) fail('原件阶段与总观察不一致');
  array(v.unresolved, 128); v.unresolved.forEach(x => text(x, 256)); if (new Set(v.unresolved).size !== v.unresolved.length) fail('缺口重复');
  const a = v.assertion; object(a, ['subject', 'value', 'state', 'scope', 'sourceRefs', 'evidenceRefs', 'verifiedBy', 'limits']);
  if (a.subject !== 'registered-original-byte-identity' || a.value !== 'matches-declared-whole-file-digest' || !['confirmed', 'contradicted', 'unverified'].includes(a.state)) fail('原件断言主题或状态非法');
  if (!same(a.scope, { method: request.method, register: request.register, registrationId: request.id, source: request.source, assurance: 'local-unprotected', requestedAssurance: 'local-unprotected' })) fail('原件断言范围与请求不符');
  array(a.limits, 32); a.limits.forEach(x => text(x, 256));
  for (const limit of ['self-reported-tool-not-authenticated-identity-or-approval', 'declared-format-owner-access-locator-and-observation-not-verified', 'no-original-text-layout-image-ocr-or-decryption', 'digest-match-not-approval-or-content-correctness', 'recording-does-not-upgrade-verification-or-protected-delivery']) if (!a.limits.includes(limit)) fail('原件核验限制不可删除');
  array(a.sourceRefs, 2); array(a.evidenceRefs, 2); if (a.sourceRefs.length !== 2) fail('必须有登记与原件两个来源');
  for (const [i, ref] of a.sourceRefs.entries()) {
    object(ref, ['uri', 'revision', 'locator', 'observedAt']);
    if (ref.uri !== `repo:${i ? request.source : request.register}`) fail('原件 SourceRef 与请求不一致');
    const whole = same(ref.locator, { kind: 'whole-file/1' });
    if (!whole) { object(ref.locator, ['kind', 'pointer']); if (i !== 0 || ref.locator.kind !== 'json-pointer/1' || !/^\/originals\/(?:0|[1-9][0-9]{0,2})$/.test(ref.locator.pointer) || Number(ref.locator.pointer.slice(11)) > 127) fail('登记定位非法'); }
    if (ref.revision === null) { if (ref.observedAt !== null) fail('无修订不能声明观察'); }
    else { (i ? originalDigest : digest)(ref.revision); timeBetween(ref.observedAt, v.evaluatedAt, v.completedAt); }
  }
  const seen = new Set();
  for (const e of a.evidenceRefs) {
    object(e, ['kind', 'path', 'contentDigest', 'observedAt', 'sourceRef', 'locator', 'verification']);
    if (![0, 1].includes(e.sourceRef) || seen.has(e.sourceRef)) fail('原件证据重复或编号非法'); seen.add(e.sourceRef);
    const ref = a.sourceRefs[e.sourceRef], observed = e.sourceRef ? capture.original : capture.register;
    if (e.kind !== 'local-source-bytes' || `repo:${e.path}` !== ref.uri || !ref.revision || !same(e.contentDigest, ref.revision) || e.observedAt !== ref.observedAt || !same(e.locator, ref.locator) || e.verification !== (e.sourceRef ? 'actual-complete-source-digest' : 'actual-complete-source-bytes') || !observed.available || !observed.stable || observed.openedFiles !== 1) fail('原件证据与实际读取阶段不一致');
  }
  if (a.sourceRefs.filter(r => r.revision !== null).length !== a.evidenceRefs.length || seen.has(1) && !seen.has(0)) fail('登记与原件证据覆盖不一致');
  if (v.verifier !== null) {
    object(v.verifier, ['kind', 'id', 'authentication', 'implementation', 'runtime']);
    if (v.verifier.kind !== 'tool' || v.verifier.id !== 'curia-verify/1' || v.verifier.authentication !== 'local-self-reported-not-authenticated') fail('工具身份不可升级');
    code(v.verifier.implementation); object(v.verifier.runtime, ['name', 'version', 'platform', 'arch']);
    if (v.verifier.runtime.name !== 'node') fail('运行时身份非法'); Object.values(v.verifier.runtime).forEach(x => text(x, 128));
    if (v.verifier.implementation.length !== VERIFIER_MODULES.length || VERIFIER_MODULES.some(file => !v.verifier.implementation.some(c => c.file === file)) || v.verifier.implementation.some(c => !p.codeIdentity.some(item => item.file === c.file && same(item.digest, c.digest)))) fail('原件核验器闭包身份不完整或与记录不符');
  }
  if (v.declaration !== null) {
    const d = v.declaration; object(d, ['registrationId', 'revision', 'declaredFormat', 'declaredEncryption', 'formatVerification', 'encryptionVerification', 'accessVerification', 'locatorVerification', 'declaredObservationVerification', 'extraction', 'decryption']);
    if (d.registrationId !== request.id || typeof d.declaredFormat !== 'string' || !/^[a-z][a-z0-9.+-]{0,31}$/.test(d.declaredFormat) || !['unknown', 'encrypted', 'not-encrypted'].includes(d.declaredEncryption) || ['formatVerification', 'encryptionVerification', 'accessVerification', 'locatorVerification', 'declaredObservationVerification'].some(k => d[k] !== 'not-performed') || d.extraction !== 'not-invoked' || d.decryption !== 'not-invoked' || a.sourceRefs[0].locator.kind !== 'json-pointer/1') fail('登记声明不能升级为已验证事实');
    originalDigest(d.revision);
  }
  if (v.comparison !== null) {
    object(v.comparison, ['state', 'expected', 'observed', 'basis']); originalDigest(v.comparison.expected); originalDigest(v.comparison.observed);
    if (!v.declaration || v.comparison.expected.algorithm !== v.comparison.observed.algorithm || v.comparison.expected.canonicalization !== v.comparison.observed.canonicalization || !same(v.comparison.expected, v.declaration.revision) || !same(v.comparison.observed, a.sourceRefs[1].revision) || v.comparison.basis !== 'whole-original-raw-bytes' || v.comparison.state !== (v.comparison.expected.value === v.comparison.observed.value ? 'equal' : 'different')) fail('登记期望与实际原件摘要比较不一致');
  }
  if (a.state === 'unverified') {
    if (v.exitCode !== 2 || a.verifiedBy !== null || !v.unresolved.length || v.comparison !== null || v.declaration !== null || seen.has(1)) fail('未核验不能伪造原件观察或比较');
  } else {
    if (v.exitCode !== (a.state === 'confirmed' ? 0 : 1) || v.unresolved.length || !capture.stable || !capture.original.stable || !v.verifier || a.evidenceRefs.length !== 2 || !v.declaration || v.comparison?.state !== (a.state === 'confirmed' ? 'equal' : 'different')) fail('原件结论不能从缺口或空证据升级');
    object(a.verifiedBy, ['identityRef', 'action', 'observedAt']);
    if (a.verifiedBy.identityRef !== '#/verifier' || a.verifiedBy.action !== request.method) fail('原件核验动作不匹配');
    timeBetween(a.verifiedBy.observedAt, v.evaluatedAt, v.completedAt);
    if (a.sourceRefs.some(ref => ref.observedAt > a.verifiedBy.observedAt) || a.sourceRefs[0].observedAt > a.sourceRefs[1].observedAt) fail('原件动作与阶段时序非法');
  }
}
