/**
 * 可选 instance 合同：原位映射与只读原生字段投影。无文件写入、无插件执行、无第二份 Registry。
 * schema 的唯一实现；默认实例仍为 .agents + docs。路径校验在 query 的 I/O 边界执行。
 */
import { JSON_NATIVE_PARSER, JSON_NATIVE_CONTRACT, JSON_CONTENT_PARSER, JSON_CONTENT_CONTRACT, validJsonPointer, inspectNativeJson, inspectJsonContent, parseDataJson, lookupJsonPointer, JSON_NATIVE_LIMITS } from './curia-json.mjs';
import { ORIGINALS_PARSER, ORIGINALS_CONTRACT, inspectOriginalRegister, parseOriginalDigestRevision } from './curia-originals.mjs';
import { normalizeGuards } from './curia-guard-contract.mjs';
import { normalizeRelations, validateRelationBinding } from './curia-relations.mjs';
import { parseHeader } from './doc-lib.mjs';
import { normalizeApplicability, mergeApplicability, validateApplicabilityFields, applyApplicability, parseTimeBoundary } from './curia-applicability.mjs';

export const CONTENT_PARSERS = Object.freeze([JSON_CONTENT_PARSER, ORIGINALS_PARSER]);
export const INSTANCE_SCHEMA = 'curia.instance/1';
export const REPRESENTATIONS = Object.freeze(['original', 'generated', 'context', 'navigation', 'outbound']);
export const NATIVE_PARSER = 'markdown-native-header/1';
export const STATUS_VIEWS = ['current', 'forming', 'historical', 'unmapped', 'not-applicable'];
export const INSTANCE_GAPS = ['native-unparsed', 'native-field-missing', 'native-field-invalid', 'native-field-conflict', 'native-lifecycle-unmapped', 'native-facet-unmapped', 'metadata-source-conflict', 'representation-conflict'];
const FACETS = ['effect', 'blocker', 'dependency', 'purpose'];
const NATIVE_FIELDS = ['id', 'version', 'lifecycle', 'owner', 'pointer'];
const REGISTRY = '.agents/doc-types.json';
const sourceAt = (pointer) => `${REGISTRY}#/instance/${pointer}`;
const fail = (message) => { throw new Error(`${message} [curia2/instance-invalid]`); };
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

function text(value, label) {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || /[\u0000-\u001f\u007f]/u.test(value)) fail(`${label} 必须是无首尾空白的非空单行文本`);
}
function object(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![null, Object.prototype].includes(Object.getPrototypeOf(value)) || Object.getOwnPropertySymbols(value).length) fail(`${label} 必须是普通对象`);
  if (Object.keys(value).some((key) => !keys.includes(key))) fail(`${label} 含未支持字段`);
}
function list(value, label, { empty = false } = {}) {
  if (!Array.isArray(value) || (!empty && !value.length)) fail(`${label} 必须是${empty ? '' : '非空'}数组`);
}
function token(value, label) {
  text(value, label);
  if (!/^[a-z][a-z0-9-]*$/.test(value)) fail(`${label} 必须为小写 kebab-case`);
}
function path(value, label, { root = false } = {}) {
  text(value, label);
  if (root && value === '.') return;
  if (value.includes('\\') || /[*?\[\]{}:]/.test(value) || value.split('/').some((part) => !part || ['.', '..', '.git'].includes(part.toLowerCase()) || part !== part.trim())) fail(`${label} 必须是规范仓内相对路径，不允许通配、别名或 Git 内部路径`);
}
export function containsPath(boundary, candidate) {
  return boundary.path === '.' || candidate === boundary.path || (boundary.kind === 'directory' && candidate.startsWith(`${boundary.path}/`));
}
const folded = (p) => p.normalize('NFC').toLowerCase();
function overlaps(a, b) {
  return containsPath({ kind: 'directory', path: folded(a.path) }, folded(b.path)) || containsPath({ kind: 'directory', path: folded(b.path) }, folded(a.path));
}
function boundary(raw, label, extra = []) {
  object(raw, ['path', 'kind', ...extra], label);
  path(raw.path, `${label}.path`);
  if (!['directory', 'file'].includes(raw.kind)) fail(`${label}.kind 必须为 directory 或 file`);
}

/** Exact historical locators, not rename guesses, aliases, supersession or approval. */
export const MOVES_SCHEMA = 'curia.moves/1';
function normalizeMoves(raw, members) {
  if (raw === undefined) return null;
  object(raw, ['schema', 'artifacts'], 'moves');
  if (raw.schema !== MOVES_SCHEMA) fail('moves.schema 未支持');
  list(raw.artifacts, 'moves.artifacts');
  if (raw.artifacts.length > 256) fail('moves.artifacts 超限');
  const ids = new Set(), currents = new Set(), locators = new Set(), spellings = new Map();
  let count = 0;
  const exactPath = (value, label, managed = false) => {
    path(value, label);
    if (Buffer.byteLength(value) > 4096 || value.split('/').length > 64) fail('Move 路径超限');
    const key = folded(value);
    if (spellings.has(key) && spellings.get(key) !== value) fail('Move 路径存在大小写或 Unicode 等价别名');
    spellings.set(key, value);
    if (managed && !members.some(member => containsPath(member, value) && (member.kind === 'file' || member.path !== value))) fail('Move 当前定位与依据必须位于已登记成员内');
  };
  const artifacts = raw.artifacts.map((item, i) => {
    object(item, ['id', 'current', 'previous'], 'moves artifact');
    token(item.id, 'moves artifact id');
    if (item.id.length > 128 || ids.has(item.id)) fail('Move ID 超限或重复');
    ids.add(item.id);
    exactPath(item.current, 'moves current', true);
    if (currents.has(item.current)) fail('Move 当前定位不能属于多个对象');
    currents.add(item.current);
    list(item.previous, 'moves previous');
    if (item.previous.length > 64 || (count += item.previous.length) > 1024) fail('Move 历史定位超限');
    const previous = item.previous.map((prior, j) => {
      object(prior, ['path', 'revision', 'basis'], 'moves previous entry');
      exactPath(prior.path, 'moves previous path');
      if (typeof prior.revision !== 'string' || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(prior.revision)) fail('Move revision 必须是完整 Git commit ID，不接受 ref 或表达式');
      const key = JSON.stringify([prior.path, prior.revision]);
      if (locators.has(key)) fail('Move 历史精确定位重复或跨对象冲突');
      locators.add(key);
      list(prior.basis, 'moves basis');
      if (prior.basis.length > 8 || new Set(prior.basis).size !== prior.basis.length) fail('Move 依据超限或重复');
      for (const ref of prior.basis) {
        exactPath(ref, 'moves basis path', true);
        if (ref === REGISTRY || ref === item.current) fail('Move 依据不能由当前对象或 Registry 自我代签');
      }
      return { ...prior, basis: [...prior.basis], source: sourceAt(`moves/artifacts/${i}/previous/${j}`) };
    });
    return { id: item.id, current: item.current, previous, source: sourceAt(`moves/artifacts/${i}`) };
  });
  return { schema: MOVES_SCHEMA, artifacts, source: sourceAt('moves') };
}

/** 不填 instance 是兼容模式；填入则为完整声明，不与默认布局隐式合并。 */
export function normalizeInstance(raw, types) {
  if (raw === undefined) return {
    schema: INSTANCE_SCHEMA, explicit: false, owner: null, mappings: [], nativeProfiles: Object.create(null),
    surfaces: [
      { id: '.agents', kind: 'root', members: [{ path: '.agents', kind: 'directory', role: 'control', required: true }] },
      { id: 'docs', kind: 'root', members: [{ path: 'docs', kind: 'directory', role: 'knowledge', required: false }] },
    ],
  };
  object(raw, ['schema', 'owner', 'surfaces', 'mappings', 'nativeProfiles', 'recordStore', 'guards', 'moves'], 'instance');
  if (raw.schema !== INSTANCE_SCHEMA) fail(`instance.schema 必须为 ${INSTANCE_SCHEMA}`);
  if (raw.owner !== undefined) text(raw.owner, 'instance.owner');
  list(raw.surfaces, 'instance.surfaces');
  if (raw.surfaces.length > 5) fail('受管面不得超过五个；root set 的固定成员合计为一个面');
  const ids = new Set();
  const members = [];
  const surfaces = raw.surfaces.map((surface, i) => {
    const at = `surfaces/${i}`;
    object(surface, ['id', 'kind', 'members', 'owner', 'entry', 'authorityLinks', 'discovery', 'noExpand'], at);
    token(surface.id, `${at}.id`);
    if (ids.has(surface.id)) fail('surface id 重复');
    ids.add(surface.id);
    if (!['root', 'legacy-root-set'].includes(surface.kind)) fail(`${at}.kind 非法`);
    if (surface.owner !== undefined) text(surface.owner, `${at}.owner`);
    else if (raw.owner === undefined) fail(`${at} 必须直接声明 owner 或从 instance.owner 继承`);
    path(surface.entry, `${at}.entry`);
    list(surface.authorityLinks, `${at}.authorityLinks`);
    for (const ref of surface.authorityLinks) path(ref, `${at}.authorityLinks`);
    if (new Set(surface.authorityLinks).size !== surface.authorityLinks.length) fail('authorityLinks 重复');
    list(surface.members, `${at}.members`);
    if (surface.kind === 'root' && surface.members.length !== 1) fail('普通 root 只允许一个成员');
    const mapped = surface.members.map((member, j) => {
      boundary(member, `${at}.members[${j}]`, ['role']);
      if (!['control', 'knowledge', 'record'].includes(member.role)) fail('member.role 非法');
      if (member.path === '.agents' && (member.role !== 'control' || member.kind !== 'directory')) fail('.agents 必须保留为 control directory');
      const normalized = { ...member, required: true, surfaceId: surface.id, source: sourceAt(`${at}/members/${j}`) };
      if (members.some((prior) => overlaps(prior, normalized))) fail('成员边界重叠或存在大小写 / Unicode 等价别名');
      members.push(normalized);
      return normalized;
    });
    if (!mapped.some((member) => containsPath(member, surface.entry))) fail('entry 必须落在同一受管面的成员内');
    let discovery = null;
    if (surface.kind === 'legacy-root-set') {
      if (surface.noExpand !== true) fail('legacy root set 必须声明 noExpand: true');
      object(surface.discovery, ['path', 'exclusions'], `${at}.discovery`);
      path(surface.discovery.path, `${at}.discovery.path`, { root: true });
      discovery = { path: surface.discovery.path, kind: 'directory', exclusions: surface.discovery.exclusions ?? [] };
      list(discovery.exclusions, 'discovery.exclusions', { empty: true });
      if (mapped.some((member) => !containsPath(discovery, member.path) || member.path === discovery.path)) fail('root set 成员必须严格处于 discovery 内，不能吞并 discovery 根');
      for (const [j, exclusion] of discovery.exclusions.entries()) {
        boundary(exclusion, 'discovery exclusion');
        if (exclusion.path === discovery.path || !containsPath(discovery, exclusion.path)) fail('exclusion 必须严格处于 discovery 内');
        if (mapped.some((member) => overlaps(member, exclusion)) || discovery.exclusions.slice(0, j).some((prior) => overlaps(prior, exclusion))) fail('exclusion 不得与成员或其他 exclusion 重叠');
      }
    } else if (surface.discovery !== undefined || surface.noExpand !== undefined) fail('普通 root 不接受 discovery 或 noExpand');
    return { ...surface, members: mapped, discovery, source: sourceAt(at) };
  });
  if (!members.some((member) => member.path === '.agents')) fail('instance 必须保留 .agents 控制根与唯一 Registry');
  for (const surface of surfaces) {
    if (surface.discovery && members.some((member) => member.surfaceId !== surface.id && overlaps(surface.discovery, member) && !surface.discovery.exclusions.some((exclude) => containsPath(exclude, member.path)))) fail('discovery 与其他受管面相交时必须显式排除其边界');
  }
  const nativeProfiles = Object.create(null);
  if (raw.nativeProfiles !== undefined) {
    object(raw.nativeProfiles, Object.keys(raw.nativeProfiles ?? {}), 'nativeProfiles');
    for (const [id, profile] of Object.entries(raw.nativeProfiles)) {
      token(id, 'native profile id');
      object(profile, ['parser', 'fields', 'lifecycles', 'authorityLinks'], `nativeProfiles.${id}`);
      if (![NATIVE_PARSER, JSON_NATIVE_PARSER].includes(profile.parser)) fail('未支持的原生 parser 或版本');
      object(profile.fields, NATIVE_FIELDS, 'native fields');
      for (const key of NATIVE_FIELDS) {
        if (profile.parser === JSON_NATIVE_PARSER ? !validJsonPointer(profile.fields[key]) : typeof profile.fields[key] !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(profile.fields[key]) || profile.fields[key] === 'Type') fail(`native fields.${key} 与所选 parser 的定位符合同不符`);
      }
      if (new Set(Object.values(profile.fields)).size !== NATIVE_FIELDS.length) fail('native 字段不得复用同一头块 key');
      list(profile.authorityLinks, 'native authorityLinks');
      for (const ref of profile.authorityLinks) path(ref, 'native authority link');
      if (new Set(profile.authorityLinks).size !== profile.authorityLinks.length) fail('native authorityLinks 重复');
      object(profile.lifecycles, Object.keys(profile.lifecycles ?? {}), 'lifecycles');
      const lifecycles = Object.create(null);
      for (const [rawLifecycle, mapped] of Object.entries(profile.lifecycles)) {
        text(rawLifecycle, 'raw lifecycle');
        object(mapped, ['view', 'facets'], 'lifecycle mapping');
        if (!STATUS_VIEWS.slice(0, 4).includes(mapped.view)) fail('lifecycle view 非法');
        object(mapped.facets, FACETS, 'lifecycle facets');
        for (const value of Object.values(mapped.facets)) text(value, 'facet value');
        lifecycles[rawLifecycle] = { view: mapped.view, facets: { ...mapped.facets } };
      }
      nativeProfiles[id] = { ...profile, fields: { ...profile.fields }, lifecycles, source: sourceAt(`nativeProfiles/${id}`) };
    }
  }
  const rawMappings = raw.mappings ?? [];
  list(rawMappings, 'mappings', { empty: true });
  const seen = new Set();
  const mappings = rawMappings.map((mapping, i) => {
    boundary(mapping, `mappings[${i}]`, ['defaults', 'nativeProfile', 'contentParser', 'variant', 'validity', 'relations', 'generation', 'task']);
    if (seen.has(folded(mapping.path))) fail('mapping 路径重复或存在等价别名');
    seen.add(folded(mapping.path));
    if (!members.some((member) => containsPath(member, mapping.path) && (member.path !== mapping.path || member.kind === mapping.kind))) fail('mapping 必须处于某个成员内，且边界形态一致');
    if (['defaults', 'nativeProfile', 'contentParser', 'variant', 'validity', 'relations', 'generation', 'task'].every((key) => mapping[key] === undefined)) fail('mapping 没有默认字段或启用的绑定');
    if (mapping.defaults !== undefined) {
      object(mapping.defaults, ['owner', 'type', 'representation'], 'mapping.defaults');
      for (const value of Object.values(mapping.defaults)) text(value, 'mapping default');
      if (mapping.defaults.type && !own(types, mapping.defaults.type)) fail('mapping type 未登记');
      if (mapping.defaults.representation !== undefined && !REPRESENTATIONS.includes(mapping.defaults.representation)) fail('mapping representation 未支持');
    }
    if (mapping.nativeProfile !== undefined) {
      if (!own(nativeProfiles, mapping.nativeProfile)) fail('mapping nativeProfile 未登记');
      if (containsPath({ path: '.agents', kind: 'directory' }, mapping.path)) fail('native profile 不能覆盖现行 .agents 类型 authority');
    }
    if (mapping.contentParser !== undefined) {
      if (!CONTENT_PARSERS.includes(mapping.contentParser)) fail('未支持的正文 parser 或版本');
      if (containsPath({ path: '.agents', kind: 'directory' }, mapping.path)) fail('正文 parser 不能覆盖现行 .agents 类型 authority');
    }
    const source = sourceAt(`mappings/${i}`);
    const bindings = Object.fromEntries(['variant', 'validity'].filter((kind) => mapping[kind] !== undefined).map((kind) => [kind, normalizeApplicability(mapping[kind], kind, `${source}/${kind}`)]));
    const task = mapping.task === undefined ? undefined : normalizeTask(mapping.task, mapping, `${source}/task`);
    const generation = mapping.generation === undefined ? undefined : normalizeGeneration(mapping.generation, `${source}/generation`);
    const relations = mapping.relations ? normalizeRelations(mapping.relations, `${source}/relations`) : undefined;
    if (mapping.relations !== undefined && !relations) fail('relations 不能为空');
    return { ...mapping, ...bindings, ...(task ? { task } : {}), ...(generation ? { generation } : {}), ...(relations ? { relations } : {}), defaults: { ...mapping.defaults }, source };
  });
  const tasks = mappings.filter(mapping => mapping.task);
  if (tasks.length > 64 || tasks.some((a, i) => tasks.some((b, j) => i !== j && (containsPath(a, b.path) || containsPath(b, a.path))))) fail('task 数量超限或目录边界重叠');
  let recordStore = null;
  if (raw.recordStore !== undefined) {
    const store = raw.recordStore;
    object(store, ['schema', 'path', 'owner', 'authorityLinks', 'preservation'], 'recordStore');
    if (store.schema !== 'curia.record-store/1') fail('recordStore.schema 未支持');
    path(store.path, 'recordStore.path');
    text(store.owner, 'recordStore.owner');
    list(store.authorityLinks, 'recordStore.authorityLinks');
    for (const ref of store.authorityLinks) path(ref, 'recordStore.authorityLinks');
    if (new Set(store.authorityLinks).size !== store.authorityLinks.length) fail('recordStore.authorityLinks 重复');
    if (!members.some((member) => member.kind === 'directory' && containsPath(member, store.path) && member.path !== store.path)) fail('recordStore 必须是已登记目录成员下的子目录，不能另起一级面');
    if (store.authorityLinks.some((ref) => containsPath({ path: store.path, kind: 'directory' }, ref))) fail('recordStore authority 不能住在事件专属目录内');
    let preservation;
    if (store.preservation !== undefined) {
      const rawPolicy = store.preservation;
      object(rawPolicy, ['schema', 'backup', 'recovery'], 'recordStore.preservation');
      if (rawPolicy.schema !== 'curia.record-preservation/1') fail('recordStore.preservation.schema 未支持');
      preservation = { schema: rawPolicy.schema };
      for (const [kind, procedure] of [['backup', 'policyRef'], ['recovery', 'procedureRef']]) {
        if (rawPolicy[kind] === undefined) continue;
        const item = rawPolicy[kind]; object(item, ['authorityLinks', procedure, 'evidenceRef'], `preservation.${kind}`);
        list(item.authorityLinks, 'preservation authorityLinks');
        if (!item.authorityLinks.length || item.authorityLinks.length > 8 || new Set(item.authorityLinks).size !== item.authorityLinks.length) fail('preservation authority 必须非空、唯一且不超过八项');
        const refs = [...item.authorityLinks, item[procedure], ...(item.evidenceRef === undefined ? [] : [item.evidenceRef])];
        for (const ref of refs) { path(ref, 'preservation reference'); if (ref === REGISTRY || containsPath({ path: store.path, kind: 'directory' }, ref)) fail('preservation 声明不能住在 Registry 或事件专属目录内'); }
        preservation[kind] = { authorityLinks: [...item.authorityLinks], [procedure]: item[procedure], ...(item.evidenceRef === undefined ? {} : { evidenceRef: item.evidenceRef }) };
      }
    }
    recordStore = { ...store, ...(preservation ? { preservation } : {}), authorityLinks: [...store.authorityLinks], source: sourceAt('recordStore') };
  }
  const guards = normalizeGuards(raw.guards);
  const moves = normalizeMoves(raw.moves, members);
  const instance = { schema: INSTANCE_SCHEMA, explicit: true, owner: raw.owner ?? null, surfaces, nativeProfiles, mappings, recordStore, guards, ...(moves ? { moves } : {}) };
  // Check effective inherited bindings, not only each fragment in isolation.
  for (const mapping of mappings) {
    const surface = surfaces.find((candidate) => candidate.members.some((member) => containsPath(member, mapping.path)));
    const mapped = mappingFor(instance, surface, mapping.path);
    validateApplicabilityFields(mapped);
    validateRelationBinding(mapped);
    validateGenerationBinding(mapped);
    if (mapped.contentParser && mapped.nativeProfile && mapped.nativeProfile.parser !== JSON_NATIVE_PARSER) fail('正文 parser 与继承的原生 parser 格式冲突');
  }
  return instance;
}

/** 默认值逐字段按最具体路径继承；没有每篇伴随配置，也不执行原项目 guard。 */
export function mappingFor(instance, surface, rel) {
  const defaults = Object.create(null);
  if (instance.owner) defaults.owner = { value: instance.owner, source: sourceAt('owner') };
  if (surface.owner) defaults.owner = { value: surface.owner, source: `${surface.source}/owner` };
  let nativeProfile = null;
  let nativeSource = null;
  let contentParser = null;
  let contentSource = null;
  const bindings = { variant: null, validity: null, relations: null, generation: null };
  const matches = instance.mappings.filter((mapping) => containsPath(mapping, rel)).sort((a, b) => a.path.length - b.path.length);
  for (const mapping of matches) {
    for (const [key, value] of Object.entries(mapping.defaults)) defaults[key] = { value, source: `${mapping.source}/defaults/${key}` };
    for (const kind of ['variant', 'validity']) if (mapping[kind]) bindings[kind] = mergeApplicability(bindings[kind], mapping[kind], kind);
    if (mapping.relations) bindings.relations = mapping.relations;
    if (mapping.generation) bindings.generation = mapping.generation;
    if (mapping.contentParser) { contentParser = mapping.contentParser; contentSource = `${mapping.source}/contentParser`; }
    if (mapping.nativeProfile) {
      nativeProfile = instance.nativeProfiles[mapping.nativeProfile];
      nativeSource = `${mapping.source}/nativeProfile`;
    }
  }
  return { defaults, nativeProfile, nativeSource, contentParser, contentSource, ...bindings };
}

/** A declared form is neither authority nor proof that generation, navigation or delivery was checked. */
export function applyRepresentation(env, mapped, reg) {
  const declaration = mapped?.defaults?.representation;
  const declarations = declaration ? [{ kind: declaration.value, source: declaration.source }] : [];
  if (env.identity.path === reg.projection) declarations.push({ kind: 'generated', source: `${REGISTRY}#/projection` });
  if (['header', 'registry-location', 'registry-inherited'].includes(env.typeSource) && reg.types[env.type]?.generated === true) declarations.push({ kind: 'generated', source: `${REGISTRY}#/types/${env.type.replaceAll('~', '~0').replaceAll('/', '~1')}/generated` });
  if (!declarations.length) return;
  const generated = declarations.some(item => item.kind === 'generated');
  // A purpose-specific form may also be generated. Only an independently maintained original conflicts.
  const conflict = declaration?.value === 'original' && generated;
  env.representation = { kind: conflict ? null : declaration?.value ?? 'generated', state: conflict ? 'conflict' : 'declared', declarations, verification: 'not-performed' };
  if (conflict) env.gaps.push('representation-conflict');
}

export const hasBoundHeader = (mapped) => Boolean(mapped?.nativeProfile?.parser === NATIVE_PARSER || mapped?.variant || mapped?.validity || mapped?.relations?.parser === 'markdown-header-relations/1' || mapped?.generation?.parser === 'markdown-header-generation/1');

export function parseNativeHeader(lines) {
  const header = parseHeader(lines);
  let i = header.fieldStart;
  const fields = [];
  while (i < lines.length) {
    const match = /^([A-Za-z][A-Za-z0-9_-]*):[ \t]*(.*)$/.exec(lines[i]);
    if (!match) break;
    fields.push({ key: match[1], value: match[2].trim(), idx: i });
    i++;
  }
  return { ...header, fields, headerEnd: i };
}
const incompleteHeader = (input, header) => input?.truncated && header?.headerEnd >= input.lines.length - 1;

function valuesFor(header, key, rel) {
  return header.fields.filter((field) => field.key === key).map((field) => ({ value: field.value, line: field.idx + 1, source: `${rel}#L${field.idx + 1}` }));
}
function nativeProjection(env, profile, source, input, reg) {
  const binding = {
    parser: profile.parser, state: 'unparsed', id: null, version: null, lifecycleRaw: null,
    lifecycleFacets: Object.fromEntries(FACETS.map((key) => [key, 'unmapped'])), owner: null, pointer: null,
    fields: Object.create(null), mappingSource: { profile: profile.source, path: source },
  };
  env.native = binding;
  env.status = 'unknown';
  env.statusSource = 'native-unparsed';
  env.statusView = 'unmapped';
  env.maintenance = 'unknown';
  env.authorityView = { links: [...profile.authorityLinks], verification: 'not-run', source: profile.source };
  const add = (gap) => { if (!env.gaps.includes(gap)) env.gaps.push(gap); };
  const isJson = profile.parser === JSON_NATIVE_PARSER;
  const json = isJson ? inspectNativeJson(env.format === 'json' ? input : null, profile.fields, env.identity.path) : null;
  if (isJson) { binding.contract = structuredClone(JSON_NATIVE_CONTRACT); binding.reason = env.format === 'json' ? json.reason : 'json/format-mismatch'; }
  const header = !isJson && input ? parseNativeHeader(input.lines) : null;
  const truncated = incompleteHeader(input, header);
  if (isJson ? json.state !== 'parsed' : env.format !== 'md' || !header?.titleOk || input.encodingState !== 'valid' || input.lines[0]?.trim() === '---' || truncated) {
    add('native-unparsed');
    add('status-unknown');
    if (truncated) add('header-truncated');
    // Preserve observed prefix values without using them to settle fields or lifecycle.
    if (header?.titleOk && input.encodingState === 'valid') {
      for (const key of NATIVE_FIELDS) binding.fields[key] = valuesFor(header, profile.fields[key], env.identity.path);
      binding.lifecycleRaw = binding.fields.lifecycle.length === 1 ? binding.fields.lifecycle[0].value : null;
    }
    return;
  }
  binding.state = 'parsed';
  env.metadataRead = isJson ? 'native-json-object' : 'native-header';
  if (isJson) env.gaps = env.gaps.filter((gap) => !['content-unparsed', 'status-unknown'].includes(gap));
  // The native parser owns Status only when its declared lifecycle key is Status.
  if (profile.fields.lifecycle === 'Status') env.gaps = env.gaps.filter((gap) => !['status-invalid', 'status-unexpected', 'status-conflict', 'status-unknown'].includes(gap));
  for (const key of NATIVE_FIELDS) {
    const values = isJson ? json.fields[key] : valuesFor(header, profile.fields[key], env.identity.path);
    binding.fields[key] = values;
    if (!values.length) add('native-field-missing');
    else if (values.length > 1) add('native-field-conflict');
    else if (!values[0].value) add('native-field-invalid');
    else if (key === 'lifecycle') binding.lifecycleRaw = values[0].value;
    else binding[key] = values[0].value;
  }
  const lifecycle = binding.lifecycleRaw;
  const mapped = lifecycle && own(profile.lifecycles, lifecycle) ? profile.lifecycles[lifecycle] : null;
  if (mapped) {
    binding.lifecycleFacets = Object.fromEntries(FACETS.map((key) => [key, mapped.facets[key] ?? 'unmapped']));
    env.statusView = mapped.view;
    if (FACETS.some((key) => binding.lifecycleFacets[key] === 'unmapped')) add('native-facet-unmapped');
    if (mapped.view === 'unmapped') add('native-lifecycle-unmapped');
  } else add('native-lifecycle-unmapped');
  env.status = lifecycle ?? 'unknown';
  env.statusSource = lifecycle ? isJson ? 'native-json' : 'native-header' : 'native-invalid';
  if (!lifecycle) add('status-unknown');
  const explicitStatus = isJson ? [] : valuesFor(header, 'Status', env.identity.path);
  if (profile.fields.lifecycle !== 'Status' && explicitStatus.length) add('metadata-source-conflict');
  const declaredType = isJson ? [] : valuesFor(header, 'Type', env.identity.path);
  if (declaredType.length) {
    if (declaredType.length === 1 && own(reg.types, declaredType[0].value)) {
      env.type = declaredType[0].value; env.typeSource = 'header';
    } else {
      env.type = 'unknown'; env.typeSource = declaredType.length > 1 ? 'header-conflict' : 'declared-unregistered';
      add('type-unknown');
      if (declaredType.length > 1) add('type-conflict');
    }
  }
  const curiaStatuses = declaredType.length === 1 ? reg.types[declaredType[0].value]?.statuses : null;
  if (profile.fields.lifecycle === 'Status' && curiaStatuses?.length && lifecycle && !curiaStatuses.includes(lifecycle)) {
    add('metadata-source-conflict');
    add('status-invalid');
  }
  if (env.gaps.includes('metadata-source-conflict') || env.gaps.includes('type-conflict') || env.gaps.includes('type-unknown')) env.statusView = 'unmapped';
  env.maintenance = env.statusView === 'historical' ? 'historical-preserved' : env.statusView === 'forming' ? 'process-evolving' : env.statusView === 'current' ? 'current-revisable' : 'unknown';
  const nativeOwners = binding.fields.owner;
  const owners = isJson ? [] : valuesFor(header, 'Owner', env.identity.path);
  if (owners.length) {
    env.owner = owners.length === 1 ? owners[0].value || null : null;
    env.ownerSource = env.owner ? 'header' : owners.length > 1 ? 'header-conflict' : 'header-invalid';
    if (owners.length > 1) add('owner-conflict');
  }
  if (nativeOwners.length) {
    if (profile.fields.owner !== 'Owner' && owners.length && (owners.length !== 1 || owners[0].value !== binding.owner)) {
      env.owner = null;
      env.ownerSource = 'source-conflict';
      add('metadata-source-conflict');
      add('owner-conflict');
    } else {
      env.owner = binding.owner;
      env.ownerSource = binding.owner ? isJson ? 'native-json' : 'native-header' : 'native-invalid';
      if (nativeOwners.length > 1) add('owner-conflict');
    }
  }
}

export function applyInstanceMetadata(env, mapped, surface, input, reg, at) {
  env.statusView = 'not-applicable';
  env.native = null;
  env.content = null;
  if (mapped.contentParser) {
    const registered = mapped.contentParser === ORIGINALS_PARSER;
    const inspection = registered ? inspectOriginalRegister(env.format === 'json' ? input : null, env.identity.path) : inspectJsonContent(env.format === 'json' ? input : null);
    env.content = { ...inspection, parser: mapped.contentParser, source: mapped.contentSource, contract: structuredClone(registered ? ORIGINALS_CONTRACT : JSON_CONTENT_CONTRACT) };
    if (env.format !== 'json') env.content.reason = 'json/format-mismatch';
    if (env.content.state === 'parsed') env.gaps = env.gaps.filter((gap) => gap !== 'content-unparsed');
    else if (!env.gaps.includes('content-unparsed')) env.gaps.push('content-unparsed');
  }
  // A content parser grants no native semantics. Only explicit Registry defaults can supply metadata.
  const contentOnly = env.content?.state === 'parsed' && !mapped.nativeProfile;
  if (contentOnly) env.metadataRead = 'registry-only';
  env.metadataSources = Object.create(null);
  env.authorityView = { links: [...(surface.authorityLinks ?? [])], verification: 'not-run', source: surface.source ?? 'default-layout' };
  const header = input && env.format === 'md' ? (hasBoundHeader(mapped) ? parseNativeHeader(input.lines) : parseHeader(input.lines)) : null;
  const reliable = header?.titleOk && input.encodingState === 'valid' && !incompleteHeader(input, header);
  if (mapped.nativeProfile) {
    nativeProjection(env, mapped.nativeProfile, mapped.nativeSource, input, reg);
    env.authorityView.links = [...new Set([...(surface.authorityLinks ?? []), ...env.authorityView.links])];
    env.authorityView.surfaceSource = surface.source;
  }
  if (header) for (const [field, key] of [['owner', 'Owner'], ['type', 'Type'], ['status', 'Status']]) {
    const values = valuesFor(header, key, env.identity.path);
    if (values.length) env.metadataSources[field] = { kind: 'header', values };
  }
  if (env.native?.state === 'parsed') {
    for (const [field, nativeKey] of [['owner', 'owner'], ['status', 'lifecycle']]) {
      if (env.native.fields[nativeKey]?.length) env.metadataSources[field] = { kind: env.native.parser === JSON_NATIVE_PARSER ? 'native-json' : 'native-header', values: env.native.fields[nativeKey], mapping: mapped.nativeSource, alsoDeclared: env.metadataSources[field]?.values ?? [] };
    }
  }
  applyApplicability(env, mapped, header, reliable, NATIVE_PARSER, at);
  const has = (key) => header?.fields.some((field) => field.key === key);
  if (env.owner === '') { env.owner = null; env.ownerSource = 'header-invalid'; }
  // Missing is not unknown: do not inherit through unsupported parsers, partial headers or explicit empty values.
  if (!env.owner && env.ownerSource === 'unknown' && (reliable || contentOnly) && !has('Owner') && !(env.native && env.native.state !== 'parsed') && !(env.native?.fields.owner?.length) && mapped.defaults.owner) {
    env.owner = mapped.defaults.owner.value;
    env.ownerSource = 'registry-inherited';
    env.metadataSources.owner = { kind: 'registry-inherited', ...mapped.defaults.owner };
  }
  if (env.owner) env.gaps = env.gaps.filter((gap) => gap !== 'owner-unknown');
  else if (!env.gaps.includes('owner-unknown')) env.gaps.push('owner-unknown');
  if (mapped.defaults.type && (reliable || contentOnly || env.native?.parser === JSON_NATIVE_PARSER && env.native.state === 'parsed') && !has('Type') && ['surface-default', 'format-default', 'unknown'].includes(env.typeSource) && !env.gaps.includes('type-conflict')) {
    env.type = mapped.defaults.type.value;
    env.typeSource = 'registry-inherited';
    env.metadataSources.type = { kind: 'registry-inherited', ...mapped.defaults.type };
    env.gaps = env.gaps.filter((gap) => gap !== 'type-unknown');
    // Inheriting a process profile does not synthesize its initial/current lifecycle.
    if (!env.native && reg.types[env.type]?.header === 'none' && has('Status') && !env.gaps.includes('status-unexpected')) env.gaps.push('status-unexpected');
    if (!env.native && !reg.types[env.type]?.statuses?.length && !has('Status')) { env.status = 'not-applicable'; env.statusSource = 'registry-profile'; env.gaps = env.gaps.filter((gap) => gap !== 'status-unknown'); }
    if (!env.native && reg.types[env.type]?.statuses?.length) {
      const statuses = header ? valuesFor(header, 'Status', env.identity.path) : [];
      const statusBase = statuses.length === 1 ? statuses[0].value.split(/\s+[—-]\s+/)[0] : null;
      if (statuses.length === 1 && reg.types[env.type].statuses.includes(statusBase)) {
        env.status = statuses[0].value; env.statusSource = 'header';
        env.gaps = env.gaps.filter((gap) => !['status-unknown', 'status-invalid'].includes(gap));
        env.maintenance = ['done', 'historical', 'superseded'].includes(statusBase) ? 'historical-preserved' : env.identity.path.startsWith('.agents/') ? 'process-evolving' : 'current-revisable';
      } else {
        env.status = 'unknown'; env.statusSource = statuses.length > 1 ? 'header-conflict' : statuses.length ? 'header-invalid' : 'unknown'; env.maintenance = 'unknown';
        if (!env.gaps.includes('status-unknown')) env.gaps.push('status-unknown');
        if (has('Status') && !env.gaps.includes('status-invalid')) env.gaps.push('status-invalid');
      }
    }
  }
}

/** Only explicitly bound headers can extend the prose paragraph boundary; body rules stay intact. */
export function nativeHeaderBoundary(instance, rel, lines) {
  const surface = instance.surfaces.find((candidate) => candidate.members.some((member) => containsPath(member, rel)));
  if (!surface || !hasBoundHeader(mappingFor(instance, surface, rel))) return null;
  const header = parseNativeHeader(lines);
  if (!header.titleOk || !header.fields.length) return null;
  const prefix = lines.slice(0, header.headerEnd).join('\n');
  if (Buffer.byteLength(prefix, 'utf8') >= 64 * 1024 || /[\u0000\ufffd]/u.test(prefix)) return null;
  return header.headerEnd;
}

/** Pure optional generation binding; shares Native Binding parsers and the existing code identity. */
export const { GENERATION_SCHEMA, GENERATION_PARSERS, normalizeGeneration, validateGenerationBinding, inspectGeneration, generationReferences } = (() => {
const GENERATION_SCHEMA = 'curia.generation/1';
const GENERATION_PARSERS = Object.freeze(['markdown-header-generation/1', 'json-pointer-generation/1']);
const FIELDS = ['sources', 'conventions', 'output', 'generators', 'mode', 'generatedAt', 'run', 'replay'];
const DEFAULT_FIELDS = Object.freeze({ sources: 'Generated-from', conventions: 'Generation-conventions', output: 'Generated-output', generators: 'Generators', mode: 'Generation-mode', generatedAt: 'Generated-at', run: 'Generation-run', replay: 'Generation-replay' });
const RESERVED = ['Type', 'Status', 'Owner', 'Updated', 'Verified'];
const plain = x => x && typeof x === 'object' && !Array.isArray(x) && [null, Object.prototype].includes(Object.getPrototypeOf(x)) && !Object.getOwnPropertySymbols(x).length;
const fail = () => { throw new Error('生成来源绑定不符合支持的合同 [curia2/generation-invalid]'); };
const text = (v, max = 1024) => typeof v === 'string' && v.length > 0 && v.length <= max && v.trim() === v && !/[\u0000-\u001f\u007f]/u.test(v) && (() => { try { encodeURIComponent(v); return true; } catch { return false; } })();
const keys = (v, allowed) => plain(v) && Object.keys(v).every(k => allowed.includes(k));
const prefix = (a, b) => a === b || b.startsWith(a + '/');

function normalizeGeneration(raw, source) {
  if (!keys(raw, ['schema', 'parser', 'fields']) || raw.schema !== GENERATION_SCHEMA || !GENERATION_PARSERS.includes(raw.parser)) fail();
  const json = raw.parser === GENERATION_PARSERS[1];
  const fields = raw.fields ?? (json ? null : DEFAULT_FIELDS);
  if (!keys(fields, FIELDS) || !Object.keys(fields).length) fail();
  const locators = Object.values(fields);
  for (const field of locators) if (json ? !validJsonPointer(field) : !text(field, 128) || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(field) || RESERVED.includes(field)) fail();
  if (locators.some((a, i) => locators.some((b, j) => i !== j && (json ? prefix(a, b) : a === b)))) fail();
  return { schema: GENERATION_SCHEMA, parser: raw.parser, fields: { ...fields }, source };
}

function validateGenerationBinding(mapped) {
  const binding = mapped.generation;
  if (!binding) return;
  const json = binding.parser === GENERATION_PARSERS[1], native = mapped.nativeProfile;
  if (native && json !== (native.parser === 'json-native-object/1')) fail();
  if ((mapped.contentParser && !json) || (json && (mapped.variant || mapped.validity))) fail();
  if (mapped.relations && json !== (mapped.relations.parser === 'json-pointer-relations/1')) fail();
  const occupied = [...Object.values(native?.fields ?? {}), ...Object.values(mapped.relations?.fields ?? {})];
  for (const kind of ['variant', 'validity']) for (const field of Object.values(mapped[kind]?.fields ?? {})) occupied.push(field.name);
  if (Object.values(binding.fields).some(a => occupied.some(b => json ? prefix(a, b) || prefix(b, a) : a === b))) fail();
}

function headerValues(input) {
  const lines = input.replace(/\r\n/g, '\n').split('\n'), fields = new Map();
  if (!/^#\s+\S/.test(lines[0]) || (lines.length > 1 && lines[1].trim())) fail();
  let i = 1; while (i < lines.length && !lines[i].trim()) i++;
  for (; i < lines.length; i++) {
    const m = /^([A-Za-z][A-Za-z0-9_-]*):[ \t]*(.*)$/.exec(lines[i]); if (!m) break;
    const values = fields.get(m[1]) ?? []; values.push({ value: m[2], locator: { kind: 'line/1', line: i + 1 } }); fields.set(m[1], values);
  }
  return fields;
}
function sourceRef(value) {
  if (!keys(value, ['uri', 'revision', 'locator', 'observedAt']) || !text(value.uri, 4096)) fail();
  for (const key of ['revision', 'locator']) if (value[key] !== undefined && value[key] !== null && !text(value[key])) fail();
  if (value.observedAt !== undefined && value.observedAt !== null && !['date', 'instant'].includes(parseTimeBoundary(value.observedAt).kind)) fail();
  return { uri: value.uri, revision: value.revision ?? null, locator: value.locator ?? null, observedAt: value.observedAt ?? null };
}

/** Bound fields only; unknown native business fields remain native. No input paths are followed. */
function inspectGeneration(bytes, path, binding) {
  const result = { state: 'unparsed', declaration: null, locations: {}, gaps: [] };
  if (!binding) return { ...result, state: 'not-enabled', gaps: ['generation/binding-missing'] };
  try {
    if (!Buffer.isBuffer(bytes) || bytes.length > JSON_NATIVE_LIMITS.maxBytes || bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) fail();
    const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(source)) fail();
    const json = binding.parser === GENERATION_PARSERS[1];
    if (json ? !path.endsWith('.json') : !path.endsWith('.md')) fail();
    const data = json ? parseDataJson(source) : headerValues(source), values = {};
    for (const key of FIELDS) {
      const field = binding.fields[key];
      const found = field ? (json ? lookupJsonPointer(data, field) : { present: data.has(field), value: data.get(field) }) : { present: false };
      if (!found.present) { values[key] = null; result.gaps.push(`generation/${key}-missing`); continue; }
      if (!json && found.value.length !== 1) fail();
      result.locations[key] = json ? { kind: 'json-pointer/1', pointer: field } : found.value[0].locator;
      values[key] = json ? found.value : ['mode', 'generatedAt', 'replay'].includes(key) ? found.value[0].value : parseDataJson(found.value[0].value);
    }
    for (const key of FIELDS) if (values[key] === null) result.gaps.push(`generation/${key}-missing`);
    for (const key of ['sources', 'conventions']) {
      if (values[key] === null) continue;
      if (!Array.isArray(values[key]) || values[key].length > 24) fail();
      if (!values[key].length) result.gaps.push(`generation/${key}-missing`);
      values[key] = values[key].map(sourceRef);
      if (new Set(values[key].map(x => x.uri)).size !== values[key].length) fail();
    }
    for (const key of ['output', 'run']) {
      if (values[key] === null) { result.gaps.push(`generation/${key}-missing`); continue; }
      values[key] = sourceRef(values[key]);
    }
    if (values.generators !== null) {
      if (!Array.isArray(values.generators) || !values.generators.length || values.generators.length > 8) fail();
      for (const generator of values.generators) {
        if (!keys(generator, ['kind', 'id', 'version']) || !['model', 'tool'].includes(generator.kind) || !text(generator.id, 256) || (generator.version != null && !text(generator.version, 256))) fail();
        if (!generator.version) result.gaps.push('generation/generator-version-unknown');
      }
    }
    if (values.mode !== null && !['extraction', 'inference', 'mixed'].includes(values.mode)) fail();
    if (values.replay !== null && !['unknown', 'rerunnable', 'deterministic'].includes(values.replay)) fail();
    if (values.generatedAt !== null && !['date', 'instant'].includes(parseTimeBoundary(values.generatedAt).kind)) fail();
    // Even a deterministic declaration and a matching receipt are not a reproducibility test.
    result.declaration = values; result.state = 'parsed'; result.gaps = [...new Set(result.gaps)];
  } catch { result.gaps = ['generation/declaration-invalid']; result.locations = {}; }
  return result;
}

function generationReferences(declaration) {
  return [
    ...(declaration.sources ?? []).map((ref, i) => ({ role: 'source', index: i, ref })),
    ...(declaration.conventions ?? []).map((ref, i) => ({ role: 'convention', index: i, ref })),
    ...(declaration.output ? [{ role: 'output', index: 0, ref: declaration.output }] : []),
    ...(declaration.run ? [{ role: 'run', index: 0, ref: declaration.run }] : []),
  ].map(item => ({ ...item, expected: parseOriginalDigestRevision(item.ref.revision) }));
}

return { GENERATION_SCHEMA, GENERATION_PARSERS, normalizeGeneration, validateGenerationBinding, inspectGeneration, generationReferences };
})();

/** A directory profile, not an execution engine or a second document registry. */
export const { TASK_SCHEMA, TASK_ROLES, normalizeTask, taskProfileFor, taskMemberFor, taskPrivatePath } = (() => {
  const TASK_SCHEMA = 'curia.task-profile/1';
  const TASK_ROLES = Object.freeze(['knowledge', 'skill', 'source', 'config', 'checkpoint', 'ledger', 'output', 'archive']);
  const SENSITIVITIES = ['non-sensitive', 'sensitive', 'unknown'];
  const OUTCOMES = ['completed', 'empty', 'failed', 'running', 'not-executed'];
  const OUTCOME_FIELDS = ['invocation', 'taskId', 'schedulerStatus', 'exitCode', 'outcome', 'evidenceComplete', 'observedAt'];
  const overlapPointer = (a, b) => a === b || a.startsWith(b + '/') || b.startsWith(a + '/');
  function normalizeTask(raw, mapping, source) {
    object(raw, ['schema', 'id', 'owner', 'invocationRef', 'sensitivity', 'members', 'outcomeAuthority', 'retention'], 'task');
    if (raw.schema !== TASK_SCHEMA || mapping.kind !== 'directory' || containsPath(mapping, REGISTRY)) fail('task 只能绑定不包含 Registry 的目录');
    for (const key of ['id', 'owner']) if (raw[key] !== undefined) { text(raw[key], `task.${key}`); if (raw[key].length > 256) fail('task 身份或 owner 超限'); }
    path(raw.invocationRef, 'task.invocationRef');
    const sensitivity = raw.sensitivity ?? 'unknown'; if (!SENSITIVITIES.includes(sensitivity)) fail('task.sensitivity 未支持');
    if (raw.retention !== undefined) path(raw.retention, 'task.retention policy reference');
    list(raw.members, 'task.members'); if (raw.members.length > 128) fail('task 成员规则超过上限');
    const seen = new Set();
    const members = raw.members.map((member, i) => {
      boundary(member, 'task member', ['role', 'sensitivity', 'schemaRef']);
      if (!containsPath(mapping, member.path) || member.path === mapping.path || seen.has(folded(member.path)) || !TASK_ROLES.includes(member.role)) fail('task 成员角色、范围或唯一性不符');
      seen.add(folded(member.path));
      if (member.schemaRef !== undefined) path(member.schemaRef, 'task member schemaRef');
      const privacy = member.sensitivity ?? (member.role === 'config' ? 'sensitive' : sensitivity);
      if (!SENSITIVITIES.includes(privacy)) fail('task member sensitivity 未支持');
      return { ...member, sensitivity: privacy, source: `${source}/members/${i}` };
    });
    for (const a of members) for (const b of members) if (a !== b && b.path.startsWith(a.path + '/') && a.kind === 'file') fail('task 文件成员不能包含另一成员');
    const outcome = raw.outcomeAuthority;
    boundary(outcome, 'task.outcomeAuthority', ['parser', 'fields', 'outcomes', 'recordsPointer']);
    if (outcome.parser !== 'json-task-outcome/1') fail('task outcome parser 未支持');
    object(outcome.fields, OUTCOME_FIELDS, 'task outcome fields');
    if (!['invocation', 'outcome', 'evidenceComplete'].every(k => Object.hasOwn(outcome.fields, k))) fail('task outcome 必需字段映射缺失');
    const fields = Object.values(outcome.fields);
    if (fields.some(p => !validJsonPointer(p)) || fields.some((a, i) => fields.some((b, j) => i !== j && overlapPointer(a, b)))) fail('task outcome 字段定位非法或重叠');
    if (outcome.recordsPointer !== undefined && outcome.recordsPointer !== '' && !validJsonPointer(outcome.recordsPointer)) fail('task ledger recordsPointer 非法');
    object(outcome.outcomes, Object.keys(outcome.outcomes ?? {}), 'task native outcomes');
    if (!Object.keys(outcome.outcomes).length || Object.keys(outcome.outcomes).length > 32) fail('task outcome 映射数量非法');
    for (const [native, mapped] of Object.entries(outcome.outcomes)) { text(native, 'native task outcome'); if (native.length > 128 || !OUTCOMES.includes(mapped)) fail('task outcome 映射非法'); }
    if (!containsPath(mapping, outcome.path) && !outcome.fields.taskId) fail('共享包外结果 authority 必须同时绑定 taskId');
    const candidate = { ...raw, schema: TASK_SCHEMA, id: raw.id ?? mapping.path, boundary: mapping.path, owner: raw.owner ?? null, sensitivity, members, outcomeAuthority: { ...outcome, fields: { ...outcome.fields }, outcomes: { ...outcome.outcomes }, source: `${source}/outcomeAuthority` }, retention: raw.retention ?? null, source };
    if (containsPath(mapping, outcome.path)) {
      const member = classify(candidate, outcome.path);
      if (!['ledger', 'output', 'archive'].includes(member.role)) fail('包内 outcome authority 必须映射为 ledger、output 或 archive');
    }
    return candidate;
  }
  function classify(profile, rel) {
    const matches = profile.members.filter(member => containsPath(member, rel)).sort((a, b) => a.path.length - b.path.length), selected = matches.at(-1);
    return { taskId: profile.id, boundary: profile.boundary, role: selected?.role ?? null, sensitivity: matches.some(member => member.sensitivity === 'sensitive') ? 'sensitive' : selected?.sensitivity ?? 'unknown', source: selected?.source ?? profile.source, schemaRef: selected?.schemaRef ?? null };
  }
  function taskProfileFor(instance, boundary) {
    const mapping = instance?.mappings?.find(m => m.path === boundary && m.task);
    if (!mapping) return null;
    const surface = instance.surfaces.find(s => s.members.some(member => containsPath(member, boundary)));
    const mapped = mappingFor(instance, surface, boundary);
    return { ...mapping.task, owner: mapping.task.owner ?? mapped.defaults.owner?.value ?? null };
  }
  function taskMemberFor(instance, rel) {
    const mapping = instance?.mappings?.find(m => m.task && containsPath(m, rel));
    return mapping ? classify(mapping.task, rel) : null;
  }
  const taskPrivatePath = (instance, rel) => { const member = taskMemberFor(instance, rel); return !!member && member.sensitivity !== 'non-sensitive'; };
  return { TASK_SCHEMA, TASK_ROLES, normalizeTask, taskProfileFor, taskMemberFor, taskPrivatePath };
})();
