/** Pure, scoped reverse-impact planning. References are data; this module never performs I/O. */
import { inspectRelations } from './curia-relations.mjs';
import { validJsonPointer } from './curia-json.mjs';

export const IMPACT_SCHEMA = 'curia.impact-graph/1';
export const IMPACT_LIMITS = Object.freeze({ maxSources: 2048, maxChanges: 128, maxEdges: 16384, maxDepth: 128 });

const configurationFail = () => { throw new Error('配置依赖投影非法 [curia2/impact-configuration-invalid]'); };
const exactObject = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) && [null, Object.prototype].includes(Object.getPrototypeOf(v)) && !Object.getOwnPropertySymbols(v).length && Object.keys(v).length === keys.length && keys.every(key => Object.hasOwn(v, key));
const movePath = v => typeof v === 'string' && v && v === v.trim() && Buffer.byteLength(v) <= 4096 && !/[\\*?\[\]{}:#%\u0000-\u001f\u007f]/u.test(v) && v.split('/').length <= 64 && v.split('/').every(part => part && part === part.trim() && !['.', '..', '.git'].includes(part.toLowerCase()));
const pointer = (v, value) => exactObject(v, ['kind', 'pointer']) && v.kind === 'json-pointer/1' && v.pointer === value;

/** V2 keeps historical locators as metadata. Only their separately declared current basis forms arcs. */
function validateConfigurationMoves(configuration, present) {
  const { moves, references, consideredEdges, consideredMoves } = configuration;
  if (!Array.isArray(moves) || moves.length > 1024 || references.length > IMPACT_LIMITS.maxEdges || !Number.isSafeInteger(consideredEdges) || !Number.isSafeInteger(consideredMoves) || consideredEdges < references.length || consideredMoves < moves.length || consideredMoves > 1024 || consideredEdges + consideredMoves > IMPACT_LIMITS.maxEdges) configurationFail();
  const expected = new Set(), seen = new Set(), locators = new Set(), artifacts = new Map(), ids = new Map(), currents = new Map();
  for (const row of moves) {
    if (!exactObject(row, ['id', 'current', 'previous', 'basis', 'locator', 'declaration']) || typeof row.id !== 'string' || !/^[a-z][a-z0-9-]{0,127}$/.test(row.id) || !present.has(row.current) || !movePath(row.current) || row.declaration !== '.agents/doc-types.json' || !exactObject(row.previous, ['path', 'revision']) || !movePath(row.previous.path) || typeof row.previous.revision !== 'string' || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(row.previous.revision) || !Array.isArray(row.basis) || !row.basis.length || row.basis.length > 8) configurationFail();
    const location = row.locator?.pointer, match = typeof location === 'string' && /^\/instance\/moves\/artifacts\/(0|[1-9]\d*)\/previous\/(0|[1-9]\d*)$/.exec(location);
    if (!match || Number(match[1]) >= 256 || Number(match[2]) >= 64 || !pointer(row.locator, location) || locators.has(location)) configurationFail();
    locators.add(location);
    const identity = JSON.stringify([row.id, row.current]), historic = JSON.stringify([row.previous.path, row.previous.revision]);
    if ((artifacts.has(match[1]) && artifacts.get(match[1]) !== identity) || (ids.has(row.id) && ids.get(row.id) !== match[1]) || (currents.has(row.current) && currents.get(row.current) !== row.id) || seen.has(historic)) configurationFail();
    artifacts.set(match[1], identity); ids.set(row.id, match[1]); currents.set(row.current, row.id); seen.add(historic);
    const paths = new Set();
    row.basis.forEach((basis, i) => {
      if (!exactObject(basis, ['path', 'locator']) || !movePath(basis.path) || [row.current, '.agents/doc-types.json'].includes(basis.path) || paths.has(basis.path) || !pointer(basis.locator, `${location}/basis/${i}`)) configurationFail();
      paths.add(basis.path); expected.add(JSON.stringify([row.current, basis.path, basis.locator.pointer]));
    });
  }
  for (const ref of references) {
    if (ref?.kind !== 'move-basis') { if (ref?.locator?.pointer?.startsWith('/instance/moves/')) configurationFail(); continue; }
    const key = JSON.stringify([ref.source, ref.target, ref.locator?.pointer]);
    if (!expected.delete(key)) configurationFail();
  }
  if (expected.size) configurationFail();
}

/** Plan review candidates, not authority, actual edits, automatic checks or the world's complete dependency graph. */
export function planImpact(documents, changes, { stable = false, configuration = null, configurationOnly = false } = {}) {
  if (!Array.isArray(documents) || !Array.isArray(changes) || !changes.length || changes.length > IMPACT_LIMITS.maxChanges || documents.some(d => !d || typeof d.path !== 'string') || changes.some(p => typeof p !== 'string') || new Set(documents.map(d => d.path)).size !== documents.length || new Set(changes).size !== changes.length) throw new Error('影响分析输入非法 [curia2/impact-input-invalid]');
  if (typeof configurationOnly !== 'boolean' || (configurationOnly && !configuration) || (configuration && (!['curia.configuration-dependencies/1', 'curia.configuration-dependencies/2', 'curia.configuration-dependencies/3'].includes(configuration.schema) || typeof configuration.stable !== 'boolean' || typeof configuration.complete !== 'boolean' || !Array.isArray(configuration.references)))) throw new Error('配置依赖投影非法 [curia2/impact-configuration-invalid]');
  const guardsEnabled = configuration?.schema === 'curia.configuration-dependencies/3';
  if (guardsEnabled ? configuration.guardScope !== 'primary-repository-declarations-only' : configuration && Object.hasOwn(configuration, 'guardScope')) configurationFail();
  const movesEnabled = guardsEnabled || configuration?.schema === 'curia.configuration-dependencies/2';
  if (movesEnabled) validateConfigurationMoves(configuration, new Set(documents.map(d => d.path)));
  else if (configuration && Object.hasOwn(configuration, 'moves')) configurationFail();
  const result = { schema: guardsEnabled ? 'curia.impact-graph/4' : movesEnabled ? 'curia.impact-graph/3' : configuration ? 'curia.impact-graph/2' : IMPACT_SCHEMA, state: 'incomplete', complete: false, global: false, truncated: configuration?.truncated === true, limits: IMPACT_LIMITS, changes: [...changes].sort(), nodes: [], references: [], ...(movesEnabled ? { moves: [] } : {}), affected: [], reviewPaths: [], findings: [] };
  const gap = (code, path = null) => { if (!result.findings.some(f => f.code === code && f.path === path)) result.findings.push({ code, path }); };
  if (!stable || (configuration && !configuration.stable)) { gap('impact/snapshot-incomplete'); return result; }
  if (documents.length > IMPACT_LIMITS.maxSources) { result.truncated = true; gap('impact/source-limit'); return result; }
  if (!documents.length) gap('impact/scope-empty');
  // Reserve all considered V2 declarations, including withheld rows; bodies cannot bypass their cost.
  const bodyEdgeLimit = IMPACT_LIMITS.maxEdges - (movesEnabled ? configuration.consideredEdges + configuration.consideredMoves : 0);
  const present = new Set(documents.map(d => d.path)), allowed = new Set([...present, ...changes]), dependents = new Map();
  const addArc = (from, to, ref, direction) => {
    if (from === to) return;
    const list = dependents.get(from) ?? [];
    list.push({ path: to, source: ref.source, target: ref.target, kind: ref.kind, locator: ref.locator, ...(ref.declaration ? { declaration: ref.declaration } : {}), direction }); dependents.set(from, list);
  };
  for (const doc of [...documents].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) {
    const node = { path: doc.path, state: 'not-parsed', parser: doc.binding?.parser ?? null, bindingSource: doc.binding?.source ?? null };
    result.nodes.push(node);
    if (configurationOnly) { node.state = 'configuration-only'; node.parser = node.bindingSource = null; continue; }
    if (!doc.binding) { node.state = 'not-bound'; gap('impact/binding-missing', doc.path); continue; }
    const inspected = inspectRelations(doc, allowed); node.state = inspected.state;
    for (const issue of inspected.issues) gap(`impact/${issue.code.slice('relation/'.length)}`, doc.path);
    if (inspected.state !== 'parsed') continue;
    for (const ref of inspected.references) {
      if (result.references.length >= bodyEdgeLimit) { result.truncated = true; gap('impact/edge-limit', doc.path); break; }
      const item = { source: doc.path, kind: ref.kind, target: ref.target, field: ref.field, locator: ref.locator };
      result.references.push(item);
      if (!ref.target) { gap(`impact/${ref.reason}`, doc.path); continue; }
      // References consume a target; supersession also couples the two endpoint declarations.
      addArc(ref.target, doc.path, item, 'reverse-reference');
      if (['supersedes', 'supersededBy'].includes(ref.kind)) addArc(doc.path, ref.target, item, 'supersession-peer');
    }
  }
  if (configuration) {
    if (!configuration.complete) gap('impact/configuration-incomplete');
    const kinds = ['configuration', 'surface-authority', 'native-profile-authority', 'record-store-authority', ...(movesEnabled ? ['move-basis'] : []), ...(guardsEnabled ? ['guard-authority', 'guard-code'] : [])];
    if (movesEnabled) result.moves = structuredClone(configuration.moves);
    for (const ref of configuration.references) {
      if (!ref || !present.has(ref.source) || typeof ref.target !== 'string' || !ref.target || !kinds.includes(ref.kind) || ref.declaration !== '.agents/doc-types.json' || ref.field !== 'Registry' || ref.locator?.kind !== 'json-pointer/1' || (ref.locator.pointer !== '' && !validJsonPointer(ref.locator.pointer))) throw new Error('配置依赖边非法 [curia2/impact-configuration-invalid]');
      if (result.references.length + (result.moves?.length ?? 0) >= IMPACT_LIMITS.maxEdges) { result.truncated = true; gap('impact/edge-limit'); break; }
      if (guardsEnabled && (['guard-authority', 'guard-code'].includes(ref.kind) || ref.locator.pointer.startsWith('/instance/guards/'))) {
        const match = /^\/instance\/guards\/[a-z][a-z0-9-]{0,79}\/(authorityLinks|command\/identityPaths)\/(0|[1-9]\d*)$/.exec(ref.locator.pointer);
        if (!match || !movePath(ref.target) || !Number.isSafeInteger(Number(match[2])) || Number(match[2]) >= 4096 || ref.kind !== (match[1] === 'authorityLinks' ? 'guard-authority' : 'guard-code')) configurationFail();
      }
      const item = { source: ref.source, target: ref.target, kind: ref.kind, field: ref.field, locator: { ...ref.locator }, declaration: ref.declaration };
      result.references.push(item); addArc(item.target, item.source, item, 'reverse-configuration');
    }
  }
  const affected = new Map(changes.map(path => [path, { path, depth: 0, basis: 'caller-declared-change', inInventory: present.has(path), reasons: [] }]));
  const queue = [...affected.keys()].sort();
  for (let i = 0; i < queue.length; i++) {
    const from = queue[i], step = affected.get(from);
    for (const edge of dependents.get(from) ?? []) {
      if (!affected.has(edge.path)) {
        if (step.depth >= IMPACT_LIMITS.maxDepth) { result.truncated = true; gap('impact/depth-limit', edge.path); continue; }
        affected.set(edge.path, { path: edge.path, depth: step.depth + 1, basis: 'declared-relation', inInventory: present.has(edge.path), reasons: [] }); queue.push(edge.path);
      }
      const reason = { via: from, source: edge.source, target: edge.target, kind: edge.kind, locator: edge.locator, ...(edge.declaration ? { declaration: edge.declaration } : {}), direction: edge.direction };
      const reasons = affected.get(edge.path).reasons;
      if (!reasons.some(r => JSON.stringify(r) === JSON.stringify(reason))) reasons.push(reason);
    }
  }
  result.affected = [...affected.values()].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  result.reviewPaths = result.affected.filter(a => a.inInventory).map(a => a.path);
  result.complete = result.findings.length === 0 && !result.truncated;
  result.state = result.complete ? 'complete' : 'incomplete';
  return result;
}
