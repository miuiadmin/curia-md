/** Optional typed references. Pure parsing/graph checks; never follow links or infer authority from existence. */
import { parseDataJson, lookupJsonPointer, validJsonPointer, JSON_NATIVE_LIMITS } from './curia-json.mjs';

export const RELATIONS_SCHEMA = 'curia.relations/1';
export const RELATION_PARSERS = Object.freeze(['markdown-header-relations/1', 'json-pointer-relations/1']);
export const RELATION_LIMITS = Object.freeze({ maxFiles: 32, maxFileBytes: 64 * 1024, maxTotalBytes: 512 * 1024, perDocument: 64, edges: 1024 });
const KINDS = ['supersedes', 'supersededBy', 'current', 'normative', 'historical'];
const DEFAULT_FIELDS = Object.freeze({ supersedes: 'Supersedes', supersededBy: 'Superseded-by', current: 'Current', normative: 'Normative-refs', historical: 'Historical-refs' });
const RESERVED = ['Type', 'Status', 'Owner', 'Updated', 'Verified'];
const plain = (x) => x && typeof x === 'object' && !Array.isArray(x) && [null, Object.prototype].includes(Object.getPrototypeOf(x)) && !Object.getOwnPropertySymbols(x).length;
const fail = () => { throw new Error('关系绑定含未知字段、版本、冲突定位或不支持的 parser [curia2/relations-invalid]'); };

export function normalizeRelations(raw, source) {
  if (!plain(raw) || Object.keys(raw).some((key) => !['schema', 'parser', 'fields', 'nativePointer', 'kind'].includes(key)) || raw.schema !== RELATIONS_SCHEMA || !RELATION_PARSERS.includes(raw.parser)) fail();
  if (raw.nativePointer !== undefined && typeof raw.nativePointer !== 'boolean') fail();
  const kind = raw.kind ?? 'document';
  if (!['document', 'current-pointer'].includes(kind)) fail();
  const fields = raw.fields ?? (raw.parser === RELATION_PARSERS[0] ? kind === 'current-pointer' ? { current: 'Current' } : DEFAULT_FIELDS : null);
  if (!plain(fields) || Object.keys(fields).some((key) => !KINDS.includes(key)) || (!Object.keys(fields).length && !raw.nativePointer)) fail();
  for (const field of Object.values(fields)) {
    if (raw.parser === RELATION_PARSERS[0] ? typeof field !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(field) || RESERVED.includes(field) : !validJsonPointer(field)) fail();
  }
  if (new Set(Object.values(fields)).size !== Object.keys(fields).length || (raw.nativePointer && fields.current)) fail();
  if (raw.parser === RELATION_PARSERS[0] && Object.entries(fields).some(([kind, field]) => Object.entries(DEFAULT_FIELDS).some(([fixedKind, fixedField]) => field === fixedField && kind !== fixedKind))) fail();
  if (kind === 'current-pointer' && (Object.keys(fields).some((key) => key !== 'current') || (!fields.current && !raw.nativePointer))) fail();
  return { schema: RELATIONS_SCHEMA, kind, parser: raw.parser, fields: { ...fields }, nativePointer: raw.nativePointer ?? false, source };
}
export function validateRelationBinding(mapped) {
  const config = mapped.relations;
  if (!config) return;
  const native = mapped.nativeProfile;
  const json = config.parser === RELATION_PARSERS[1];
  if (config.nativePointer && !native) fail();
  if (native && json !== (native.parser === 'json-native-object/1')) fail();
  if (mapped.contentParser && !json) fail();
  const occupied = new Set(Object.values(native?.fields ?? {}));
  for (const kind of ['variant', 'validity']) for (const field of Object.values(mapped[kind]?.fields ?? {})) occupied.add(field.name);
  if (Object.values(config.fields).some((field) => occupied.has(field))) fail();
}

function markdownTargets(raw) {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('relation/field-empty');
  const text = raw.trim();
  if (!text.startsWith('[')) return [text];
  const out = []; let rest = text;
  while (rest) {
    const match = /^\[[^\]\r\n]*\]\(([^()\r\n]+)\)/.exec(rest);
    if (!match) throw new Error('relation/link-syntax-uncovered');
    out.push(match[1]); rest = rest.slice(match[0].length);
    if (!rest) break;
    const separator = /^(?:\s*[,，、]\s*|\s+)/.exec(rest);
    if (!separator || separator[0].length === rest.length) throw new Error('relation/link-syntax-uncovered');
    rest = rest.slice(separator[0].length);
  }
  return out;
}
function headerFields(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (!/^#\s+\S/.test(lines[0]) || (lines.length > 1 && lines[1].trim())) throw new Error('relation/header-invalid');
  let i = 1; while (i < lines.length && !lines[i].trim()) i++;
  const fields = [];
  while (i < lines.length) {
    const match = /^([A-Za-z][A-Za-z0-9_-]*):[ \t]*(.*)$/.exec(lines[i]);
    if (!match) break;
    fields.push({ name: match[1], value: match[2], locator: { kind: 'line/1', line: i + 1 } }); i++;
  }
  return fields;
}

/** Lexical only: relative prefixes may climb parents, but inner x/../ aliases are not normalized. */
function resolveTarget(source, raw, allowed) {
  if (typeof raw !== 'string' || !raw || raw !== raw.trim() || /[\s\\:#%?*\[\]{}<>"'`\u0000-\u001f\u007f]/u.test(raw)) return { target: null, reason: 'target-syntax-unsupported' };
  if (raw.startsWith('/')) return { target: null, reason: 'target-outside-selection' };
  const parts = source.split('/').slice(0, -1); let rest = raw;
  if (rest.startsWith('./')) rest = rest.slice(2);
  else while (rest.startsWith('../')) { if (!parts.length) return { target: null, reason: 'target-outside-selection' }; parts.pop(); rest = rest.slice(3); }
  const tail = rest.split('/');
  if (tail.some((part) => !part || ['.', '..', '.git'].includes(part.toLowerCase()))) return { target: null, reason: 'target-syntax-unsupported' };
  const target = [...parts, ...tail].join('/');
  return allowed.has(target) ? { target, reason: null } : { target: null, reason: 'target-outside-selection' };
}

const EFFECT_GAP = /^(?:status-|type-|metadata-source-conflict|header-|native-(?:unparsed|field-|lifecycle-|facet-))/;
const statusBase = (env) => env?.status?.split(/\s+[—-]\s+/)[0];
function effectOf(env) {
  if (!env || env.gaps.some((gap) => EFFECT_GAP.test(gap))) return 'unresolved';
  if (env.native) return ['current', 'historical', 'forming'].includes(env.statusView) ? env.statusView : 'unresolved';
  const status = statusBase(env);
  if (status === 'current' || (env.type === 'spec' && status === 'done')) return 'current';
  if (['superseded', 'historical', 'done', 'rejected', 'archived'].includes(status)) return 'historical';
  if (['draft', 'active', 'proposed'].includes(status)) return 'forming';
  return 'unresolved';
}

export function inspectRelations(document, allowed) {
  const binding = document.binding;
  const result = { path: document.path, kind: binding?.kind ?? null, state: 'not-enabled', effect: effectOf(document.envelope), parser: binding?.parser ?? null, bindingSource: binding?.source ?? null, fields: [], references: [], issues: [], variant: document.envelope?.variant?.cell ?? null, superseded: statusBase(document.envelope) === 'superseded' };
  if (!binding) return result;
  const env = document.envelope;
  // An explicitly bound navigation object may omit a lifecycle, never override an invalid or forming one.
  const noLifecycle = env && !env.native && ['unknown', 'not-applicable'].includes(env.status) && ['unknown', 'registry-profile'].includes(env.statusSource) && !env.gaps.some((gap) => gap !== 'status-unknown' && EFFECT_GAP.test(gap));
  if (binding.kind === 'current-pointer' && (result.effect === 'current' || noLifecycle)) result.effect = 'pointer';
  result.state = 'unparsed';
  if (document.state !== 'read' || !document.text || !document.envelope) { result.issues.push({ code: 'relation/source-unavailable', field: null }); return result; }
  try {
    if (Buffer.byteLength(document.text, 'utf8') > JSON_NATIVE_LIMITS.maxBytes) throw new Error('relation/byte-limit');
    if (binding.parser === RELATION_PARSERS[0] ? document.envelope.format !== 'md' : document.envelope.format !== 'json') throw new Error('relation/format-mismatch');
    const fields = binding.parser === RELATION_PARSERS[0] ? headerFields(document.text) : null;
    const data = fields ? null : parseDataJson(document.text);
    for (const [kind, field] of Object.entries(binding.fields)) {
      const found = fields ? fields.filter((item) => item.name === field) : (() => { const item = lookupJsonPointer(data, field); return item.present ? [{ value: item.value, locator: { kind: 'json-pointer/1', pointer: field } }] : []; })();
      const observation = { kind, field, state: !found.length ? 'absent' : found.length > 1 ? 'conflict' : 'present', locator: found.length === 1 ? found[0].locator : null };
      result.fields.push(observation);
      if (found.length > 1) { result.issues.push({ code: 'relation/field-conflict', field }); continue; }
      if (!found.length) continue;
      let targets;
      try {
        targets = fields ? markdownTargets(found[0].value) : typeof found[0].value === 'string' ? [found[0].value] : Array.isArray(found[0].value) ? found[0].value : null;
        if (!targets || targets.some((value) => typeof value !== 'string' || !value) || new Set(targets).size !== targets.length || (['current', 'supersededBy'].includes(kind) && targets.length !== 1)) throw new Error();
      } catch { observation.state = 'invalid'; result.issues.push({ code: 'relation/field-invalid', field }); continue; }
      if (result.references.length + targets.length > RELATION_LIMITS.perDocument) throw new Error('relation/reference-limit');
      for (const target of targets) result.references.push({ kind, field, locator: found[0].locator, ...resolveTarget(document.path, target, allowed) });
    }
    if (binding.nativePointer) {
      const native = document.envelope.native, values = native?.fields.pointer;
      if (native?.state !== 'parsed' || values?.length !== 1 || !native.pointer) result.issues.push({ code: 'relation/native-pointer-unresolved', field: 'native.pointer' });
      else {
        const value = values[0];
        let targets;
        try { targets = native.parser === 'json-native-object/1' ? [native.pointer] : markdownTargets(native.pointer); }
        catch { targets = []; }
        if (targets.length !== 1) result.issues.push({ code: 'relation/native-pointer-invalid', field: 'native.pointer' });
        else result.references.push({ kind: 'current', field: 'native.pointer', locator: value.pointer ? { kind: 'json-pointer/1', pointer: value.pointer } : { kind: 'line/1', line: value.line }, ...resolveTarget(document.path, targets[0], allowed) });
      }
    }
    if (binding.kind === 'current-pointer' && !result.references.some((ref) => ref.kind === 'current')) result.issues.push({ code: 'relation/pointer-target-missing', field: null });
    if (result.references.length > RELATION_LIMITS.perDocument) throw new Error('relation/reference-limit');
    result.state = result.issues.length ? 'incomplete' : 'parsed';
  } catch (error) {
    result.references = []; result.fields = []; result.state = 'unparsed';
    result.issues = [{ code: ['relation/byte-limit', 'relation/format-mismatch', 'relation/header-invalid', 'relation/reference-limit'].includes(error.message) ? error.message : 'relation/content-invalid', field: null }];
  }
  return result;
}

/** All graph claims are restricted to the supplied, actually read document set. */
export function analyzeRelations(documents, { stable = false } = {}) {
  const allowed = new Set(documents.map((doc) => doc.path));
  if (documents.length > RELATION_LIMITS.maxFiles || allowed.size !== documents.length) throw new Error('关系输入数量或唯一性不符 [curia2/relations-input]');
  const nodes = documents.map((doc) => inspectRelations(doc, allowed));
  const byPath = new Map(nodes.map((node) => [node.path, node]));
  const findings = [], edges = [], references = [];
  const add = (code, severity, paths, detail = null) => { if (!findings.some((f) => f.code === code && JSON.stringify(f.paths) === JSON.stringify(paths))) findings.push({ code, severity, paths, detail }); };
  const enabled = nodes.filter((node) => node.parser);
  if (!stable || documents.some((doc) => doc.state !== 'read')) add('relation/snapshot-incomplete', 'gap', []);
  for (const node of nodes) {
    if (node.state === 'not-enabled') { if (enabled.length) add('relation/binding-missing', 'gap', [node.path]); continue; }
    for (const issue of node.issues) add(issue.code, issue.code === 'relation/field-conflict' ? 'error' : 'gap', [node.path], issue.field);
    if (node.effect === 'unresolved') add('relation/effect-unresolved', 'gap', [node.path]);
    const envelope = documents.find((doc) => doc.path === node.path).envelope;
    if (envelope?.gaps.some((gap) => gap.includes('conflict'))) add('relation/metadata-conflict', 'error', [node.path]);
    if (envelope?.gaps.some((gap) => /^(?:applicability-|validity-)/.test(gap))) add('relation/applicability-unresolved', 'gap', [node.path]);
    if (node.kind === 'current-pointer' && node.effect === 'forming') add('relation/pointer-not-current', 'gap', [node.path]);
    if (['current', 'pointer'].includes(node.effect)) {
      if (envelope?.native && ['blocker', 'dependency'].some((key) => envelope.native.lifecycleFacets[key] !== 'none')) add('relation/native-eligibility-unverified', 'gap', [node.path]);
      if (envelope?.validity && !['effective', 'perpetual', 'timeless'].includes(envelope.validity.view)) add('relation/current-validity-unresolved', 'gap', [node.path]);
    }
    for (const ref of node.references) {
      const item = { source: node.path, ...ref, state: 'unresolved', resolvedCurrent: null };
      references.push(item);
      if (!ref.target) { add(`relation/${ref.reason}`, 'gap', [node.path], ref.field); continue; }
      if (['normative', 'historical'].includes(ref.kind)) continue;
      const from = ref.kind === 'supersedes' ? ref.target : node.path, to = ref.kind === 'supersedes' ? node.path : ref.target;
      // Current-to-self is a terminal declaration, not a traversal edge. Other self-edges are cycles.
      if (!(ref.kind === 'current' && from === to)) edges.push({ from, to, kind: ref.kind });
    }
  }
  if (edges.length + references.length > RELATION_LIMITS.edges) return { state: 'incomplete', nodes: [], edges: [], references: [], findings: [{ code: 'relation/graph-limit', severity: 'gap', paths: [], detail: null }], coverage: { documents: documents.length, enabled: enabled.length, references: 0, global: false, complete: false } };
  const graph = new Map(nodes.map((node) => [node.path, new Set()]));
  const replacements = new Map(nodes.map((node) => [node.path, new Set()]));
  for (const edge of edges) { graph.get(edge.from).add(edge.to); if (edge.kind !== 'current') replacements.get(edge.from).add(edge.to); }
  const colors = new Map(), stack = [];
  const visit = (path) => {
    colors.set(path, 1); stack.push(path);
    for (const target of graph.get(path)) {
      if (!colors.has(target)) visit(target);
      else if (colors.get(target) === 1) add('relation/cycle', 'error', [...stack.slice(stack.indexOf(target))].sort());
    }
    stack.pop(); colors.set(path, 2);
  };
  for (const node of nodes) if (!colors.has(node.path)) visit(node.path);
  for (const [path, targets] of graph) if (targets.size > 1) add('relation/current-fork', 'error', [path, ...[...targets].sort()]);
  const trace = (start) => {
    let path = start; const seen = new Set();
    while (true) {
      if (seen.has(path) || graph.get(path).size > 1) return null;
      seen.add(path);
      const node = byPath.get(path);
      if (node.state !== 'parsed' || node.references.some((ref) => !ref.target) || node.issues.length) return null;
      const next = [...graph.get(path)];
      if (!next.length) return { target: path, paths: [...seen] };
      path = next[0];
    }
  };
  const sink = (start) => trace(start)?.target ?? null;
  const claims = new Map(), pointerClaims = new Map(), cells = new Map(), nativeClaims = new Map();
  for (const node of nodes) {
    if (node.superseded && !graph.get(node.path).size) add('relation/superseded-without-successor', 'gap', [node.path]);
    if (node.kind === 'current-pointer' && node.effect === 'pointer') {
      const target = sink(node.path);
      if (target) { const group = pointerClaims.get(target) ?? []; group.push(node.path); pointerClaims.set(target, group); }
    }
    if (node.effect !== 'current') continue;
    if (replacements.get(node.path).size) add('relation/current-already-superseded', 'error', [node.path, ...replacements.get(node.path)]);
    const target = sink(node.path);
    if (target) { const group = claims.get(target) ?? []; group.push(node.path); claims.set(target, group); }
    if (node.variant) { const key = JSON.stringify(node.variant), group = cells.get(key) ?? []; group.push(node.path); cells.set(key, group); }
    const native = documents.find((doc) => doc.path === node.path).envelope?.native;
    if (native?.id) { const key = JSON.stringify([native.mappingSource.profile, native.id, node.variant]), group = nativeClaims.get(key) ?? []; group.push(node.path); nativeClaims.set(key, group); }
  }
  for (const [target, paths] of claims) if (paths.length > 1) add('relation/multiple-current-authority', 'error', [...new Set([target, ...paths])].sort());
  for (const [target, paths] of pointerClaims) if (paths.length > 1) add('relation/multiple-current-pointer', 'error', [target, ...paths].sort());
  for (const paths of cells.values()) if (paths.length > 1) add('relation/multiple-current-cell', 'error', [...paths].sort());
  for (const paths of nativeClaims.values()) if (paths.length > 1) add('relation/multiple-current-native-id', 'error', [...paths].sort());
  const support = new Map();
  for (const ref of references) {
    if (!ref.target) continue;
    const target = byPath.get(ref.target), origin = byPath.get(ref.source);
    if (target.state !== 'parsed') { add('relation/target-unparsed', 'gap', [ref.source, ref.target]); continue; }
    if (ref.kind === 'historical') { ref.state = 'historical-reference'; continue; }
    if (['supersedes', 'supersededBy'].includes(ref.kind)) { ref.state = 'supersession-declaration'; continue; }
    if (ref.kind === 'normative' && (target.effect === 'historical' || replacements.get(ref.target).size)) { ref.state = 'stale-normative-reference'; add('relation/stale-normative-reference', 'error', [ref.source, ref.target]); continue; }
    const chain = trace(ref.target), current = chain?.target;
    if (!current) { add('relation/current-unresolved', 'gap', [ref.source, ref.target]); continue; }
    support.set(ref, new Set([ref.source, ...chain.paths]));
    const chainNodes = chain.paths.map((path) => byPath.get(path));
    if (ref.kind === 'normative' && chainNodes.some((node) => node.effect === 'historical' || replacements.get(node.path).size)) { ref.state = 'stale-normative-reference'; add('relation/stale-normative-reference', 'error', [ref.source, ...chain.paths]); continue; }
    const unready = chainNodes.find((node) => ['unresolved', 'forming'].includes(node.effect));
    if (unready) { add(unready.effect === 'unresolved' ? 'relation/current-state-unknown' : 'relation/target-not-current', unready.effect === 'unresolved' ? 'gap' : 'error', [ref.source, unready.path]); continue; }
    const leaf = byPath.get(current);
    if (leaf.effect !== 'current') { add(leaf.effect === 'unresolved' ? 'relation/current-state-unknown' : 'relation/target-not-current', leaf.effect === 'unresolved' ? 'gap' : 'error', [ref.source, current]); continue; }
    if (leaf.variant && [origin, ...chainNodes].some((node) => node.variant && JSON.stringify(node.variant) !== JSON.stringify(leaf.variant))) { add('relation/applicability-mismatch', 'gap', [ref.source, current]); continue; }
    ref.resolvedCurrent = current;
    ref.state = 'selected-current-reference';
  }
  for (const ref of references) if (ref.resolvedCurrent && findings.some((finding) => !finding.paths.length || finding.paths.some((path) => support.get(ref)?.has(path)))) { ref.resolvedCurrent = null; ref.state = 'conflicted-or-unverified-current'; }
  const errors = findings.filter((f) => f.severity === 'error').length, gaps = findings.filter((f) => f.severity === 'gap').length;
  return { state: errors ? 'fail' : gaps ? 'incomplete' : !enabled.length ? 'not-applicable' : 'pass', nodes: nodes.map(({ variant, references: declared, ...node }) => node), edges, references, findings, coverage: { documents: nodes.length, enabled: enabled.length, references: references.length, errors, gaps, global: false, complete: !!enabled.length && !errors && !gaps } };
}
