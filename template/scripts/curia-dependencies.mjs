/** Bounded traversal of explicitly bound relations. This module grants no I/O authority. */
import { inspectRelations } from './curia-relations.mjs';

export const DEPENDENCY_SCHEMA = 'curia.dependency-closure/1';
export const DEPENDENCY_LIMITS = Object.freeze({ maxNodes: 256, maxEdges: 1024, maxDepth: 32, maxInventoryPaths: 10000 });

/** The caller supplies a snapshot-bound reader; source text never supplies code or a scope. */
export function traverseDependencies({ allowedPaths, seeds, readDocument }) {
  const allowed = new Set(allowedPaths), scheduled = new Set(seeds), queue = seeds.map(path => ({ path, depth: 0, origin: 'seed' }));
  const nodes = [], edges = [], findings = [];
  const gap = (code, path, reason) => { if (!findings.some(f => f.code === code && f.path === path && f.reason === reason)) findings.push({ code, path, reason }); };
  let truncated = false;
  if (!seeds.length) gap('dependency/seeds-empty', null, '种子选集为空或不可读，不扩大范围补齐');
  if (allowedPaths.length > DEPENDENCY_LIMITS.maxInventoryPaths || seeds.length > DEPENDENCY_LIMITS.maxNodes) {
    gap('dependency/inventory-limit', null, '授权盘点或种子数量超过闭包硬限制；正文未读');
    return { schema: DEPENDENCY_SCHEMA, state: 'incomplete', complete: false, global: false, truncated: true, limits: DEPENDENCY_LIMITS, seeds, nodes, edges, findings };
  }
  for (let i = 0; i < queue.length; i++) {
    const step = queue[i];
    if (!allowed.has(step.path)) throw new Error('依赖遍历输入超出已授权快照 [curia2/dependency-scope-invalid]');
    const document = readDocument(step.path);
    const node = { ...step, parser: document.binding?.parser ?? null, bindingSource: document.binding?.source ?? null, state: 'not-parsed' };
    nodes.push(node);
    if (document.state !== 'read' || !document.envelope || !document.text) { gap('dependency/source-incomplete', step.path, '原件未完整读入，不能从前缀声明依赖完整'); continue; }
    if (!document.binding) { node.state = 'not-bound'; gap('dependency/binding-missing', step.path, '未登记关系字段，不能把未知依赖当作叶子'); continue; }
    const inspected = inspectRelations(document, allowed);
    node.state = inspected.state;
    for (const issue of inspected.issues) gap(`dependency/${issue.code.slice('relation/'.length)}`, step.path, '关系字段未完整解释，不猜测遗漏关系');
    if (inspected.state !== 'parsed') continue;
    for (const ref of inspected.references) {
      if (edges.length >= DEPENDENCY_LIMITS.maxEdges) { truncated = true; gap('dependency/edge-limit', step.path, '关系数量超过闭包硬限制'); break; }
      edges.push({ source: step.path, kind: ref.kind, field: ref.field, locator: ref.locator, target: ref.target });
      if (!ref.target) { gap(`dependency/${ref.reason}`, step.path, '目标不在授权且可读的盘点中或定位语法未支持；不探测、不回显原始目标'); continue; }
      // Ordinary reference cycles are legal reading dependencies. Each object is read at most once.
      if (scheduled.has(ref.target)) continue;
      if (step.depth >= DEPENDENCY_LIMITS.maxDepth) { truncated = true; gap('dependency/depth-limit', step.path, '依赖深度超过闭包硬限制'); continue; }
      if (scheduled.size >= DEPENDENCY_LIMITS.maxNodes) { truncated = true; gap('dependency/node-limit', step.path, '依赖数量超过闭包硬限制'); continue; }
      scheduled.add(ref.target); queue.push({ path: ref.target, depth: step.depth + 1, origin: 'dependency' });
    }
  }
  const complete = seeds.length > 0 && !findings.length && !truncated;
  return { schema: DEPENDENCY_SCHEMA, state: complete ? 'complete' : 'incomplete', complete, global: false, truncated, limits: DEPENDENCY_LIMITS, seeds, nodes, edges, findings };
}
