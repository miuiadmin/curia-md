/** Optional Variant Binding and validity views. Pure projections: no reads, writes, timezone guesses or state transitions. */
export const VARIANT_SCHEMA = 'curia.variant/1';
export const VALIDITY_SCHEMA = 'curia.validity/1';
export const VALIDITY_STATES = ['effective', 'future', 'expired', 'perpetual', 'timeless', 'unresolved', 'not-applicable'];
export const CELL_STATES = ['unique', 'missing', 'conflict', 'unresolved', 'not-applicable'];
export const APPLICABILITY_GAPS = ['applicability-unparsed', 'applicability-field-missing', 'applicability-field-invalid', 'applicability-field-conflict', 'validity-unresolved', 'validity-invalid', 'variant-canonical-missing', 'variant-canonical-conflict', 'variant-canonical-unresolved'];
export const APPLICABILITY_DETAILS = {
  'applicability-unparsed': '启用的变体或时间头块未被完整解析；不从路径、Status、Updated 或 Verified 猜测',
  'applicability-field-missing': '适用字段缺少显式值与已登记默认值',
  'applicability-field-invalid': '适用字段为空或不符合所声明的字段格式',
  'applicability-field-conflict': '适用字段重复，即使值相同也不选择第一项',
  'validity-unresolved': '时间模式或边界未知、仅有日期精度或头块未解析；不推定时区或午夜',
  'validity-invalid': '时间模式、端点或区间矛盾；不改写原件状态',
  'variant-canonical-missing': '所选 inventory 的同一适用单元内没有声明 canonical 的原件',
  'variant-canonical-conflict': '所选 inventory 的同一适用单元存在多个 canonical 声明；时间窗口不消除身份冲突',
  'variant-canonical-unresolved': '变体字段、路径覆盖或读取不完整，不能证明适用单元的唯一原件',
};
export const DIMENSIONS = ['language', 'productVersion', 'platform', 'audience'];
const DEFAULT_FIELDS = {
  variant: { family: 'Family', language: 'Language', productVersion: 'Product-Version', platform: 'Platform', audience: 'Audience', canonical: 'Canonical' },
  validity: { mode: 'Validity', from: 'Effective-from', until: 'Effective-until' },
};
const RESERVED = ['Type', 'Status', 'Owner', 'Updated', 'Verified'];
const MODES = ['timeless', 'perpetual', 'interval'];
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const fail = (message) => { throw new Error(`${message} [curia2/applicability-invalid]`); };
function plain(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![null, Object.prototype].includes(Object.getPrototypeOf(value)) || Object.getOwnPropertySymbols(value).length || Object.keys(value).some((key) => !allowed.includes(key))) fail(`${label} 不是支持的普通对象`);
}
function text(value) {
  return typeof value === 'string' && value.length > 0 && value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value);
}
function cellValue(value) {
  // Exact opaque cells, not selectors: no wildcard, range, case folding or implicit axis expansion.
  return text(value) && !/[*?]/.test(value);
}
function calendar(year, month, day) {
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return year >= 1 && year <= 9999 && month >= 1 && month <= 12 && day >= 1 && day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

/** A deliberately narrow timestamp grammar; date-only never gains a fabricated timezone or instant. */
export function parseTimeBoundary(raw) {
  if (raw === 'unbounded') return { raw, kind: 'unbounded', precision: null, instant: null };
  if (!text(raw)) return { raw, kind: 'invalid', precision: null, instant: null };
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (date && calendar(+date[1], +date[2], +date[3])) return { raw, kind: 'date', precision: 'date', instant: null };
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(raw);
  if (!m || !calendar(+m[1], +m[2], +m[3]) || +m[4] > 23 || +m[5] > 59 || +m[6] > 59 || raw.endsWith('-00:00') || (m[8] !== 'Z' && (+m[10] > 14 || +m[11] > 59 || (+m[10] === 14 && +m[11] !== 0)))) return { raw, kind: 'invalid', precision: null, instant: null };
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms) || new Date(ms).getUTCFullYear() < 1 || new Date(ms).getUTCFullYear() > 9999) return { raw, kind: 'invalid', precision: null, instant: null };
  return { raw, kind: 'instant', precision: m[7] ? `fraction-${m[7].length}` : 'second', instant: new Date(ms).toISOString() };
}
export function evaluationInstant(value) {
  const parsed = parseTimeBoundary(value);
  if (parsed.kind !== 'instant') throw new Error('求值时点必须是带明确时区的完整秒或毫秒时间，不能用日期、未知时区或开放端点 [curia2/evaluation-time-invalid]');
  return parsed.instant;
}
function validValue(kind, key, value) {
  if (kind === 'variant') return key === 'canonical' ? typeof value === 'boolean' : cellValue(value);
  return key === 'mode' ? MODES.includes(value) : parseTimeBoundary(value).kind !== 'invalid';
}

/** Each mapping can opt into either binding, with only its relevant default fields. */
export function normalizeApplicability(raw, kind, source) {
  plain(raw, ['fields', 'defaults'], kind);
  const keys = Object.keys(DEFAULT_FIELDS[kind]);
  if (raw.fields !== undefined) {
    plain(raw.fields, keys, `${kind}.fields`);
    for (const field of Object.values(raw.fields)) {
      if (typeof field !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(field) || RESERVED.includes(field)) fail('绑定字段名非法，或占用了 Type / Status / Owner / Updated / Verified');
    }
  }
  if (raw.defaults !== undefined) {
    plain(raw.defaults, keys, `${kind}.defaults`);
    for (const [key, value] of Object.entries(raw.defaults)) if (!validValue(kind, key, value)) fail(`${kind}.defaults.${key} 非法`);
  }
  return { fields: { ...raw.fields }, defaults: { ...raw.defaults }, source };
}
export function mergeApplicability(prior, config, kind) {
  const out = prior ? { fields: { ...prior.fields }, defaults: { ...prior.defaults }, sources: [...prior.sources] } : {
    fields: Object.fromEntries(Object.entries(DEFAULT_FIELDS[kind]).map(([key, name]) => [key, { name, source: `${kind === 'variant' ? VARIANT_SCHEMA : VALIDITY_SCHEMA}#fields/${key}` }])),
    defaults: {}, sources: [],
  };
  for (const [key, name] of Object.entries(config.fields)) out.fields[key] = { name, source: `${config.source}/fields/${key}` };
  for (const [key, value] of Object.entries(config.defaults)) out.defaults[key] = { value, source: `${config.source}/defaults/${key}` };
  out.sources.push(config.source);
  return out;
}
export function validateApplicabilityFields(mapped) {
  const seen = new Set(Object.values(mapped.nativeProfile?.fields ?? {}));
  for (const kind of ['variant', 'validity']) for (const { name } of Object.values(mapped[kind]?.fields ?? {})) {
    if (seen.has(name)) fail(`生效映射重复使用字段 ${name}；产品版本、原生文档版本及各时间轴不得混用`);
    seen.add(name);
  }
}
function addGap(env, gap) { if (!env.gaps.includes(gap)) env.gaps.push(gap); }

function readFields(env, kind, config, header, reliable) {
  const values = {};
  const fields = {};
  for (const [key, field] of Object.entries(config.fields)) {
    const observed = header?.fields.filter((candidate) => candidate.key === field.name).map((candidate) => ({ value: candidate.value, line: candidate.idx + 1, source: `${env.identity.path}#L${candidate.idx + 1}` })) ?? [];
    const detail = { field: field.name, fieldSource: field.source, observed, state: 'unparsed', value: null, source: null };
    if (reliable) {
      if (observed.length > 1) { detail.state = 'conflict'; addGap(env, 'applicability-field-conflict'); }
      else if (observed.length === 1) {
        let value = observed[0].value;
        if (key === 'canonical') value = value === 'true' ? true : value === 'false' ? false : value;
        detail.state = validValue(kind, key, value) ? 'header' : 'invalid';
        detail.value = value;
        detail.source = observed[0].source;
        if (detail.state === 'invalid') addGap(env, 'applicability-field-invalid');
      } else if (own(config.defaults, key)) {
        detail.state = 'registry-inherited'; detail.value = config.defaults[key].value; detail.source = config.defaults[key].source;
      } else detail.state = 'missing';
    }
    if (['header', 'registry-inherited'].includes(detail.state)) values[key] = detail.value;
    fields[key] = detail;
  }
  return { values, fields };
}

export function applyApplicability(env, mapped, header, reliable, parser, at) {
  // This exported projection also guards its own clock; NaN comparisons otherwise look effective.
  const evaluatedAt = mapped.validity ? evaluationInstant(at) : null;
  for (const kind of ['variant', 'validity']) {
    const config = mapped[kind];
    if (!config) continue;
    const { values, fields } = readFields(env, kind, config, header, reliable);
    if (!reliable) addGap(env, 'applicability-unparsed');
    const binding = { schema: kind === 'variant' ? VARIANT_SCHEMA : VALIDITY_SCHEMA, parser, state: reliable ? 'parsed' : 'unparsed', fields, mappingSources: config.sources };
    if (kind === 'variant') {
      const required = Object.keys(DEFAULT_FIELDS.variant);
      const complete = required.every((key) => own(values, key));
      if (reliable && required.some((key) => fields[key].state === 'missing')) addGap(env, 'applicability-field-missing');
      env.variant = { ...binding, family: values.family ?? null, dimensions: Object.fromEntries(DIMENSIONS.map((key) => [key, values[key] ?? null])), canonical: values.canonical ?? null, cell: complete ? [values.family, ...DIMENSIONS.map((key) => values[key])] : null, cellState: 'unresolved', canonicalPath: null, basis: 'selected-inventory' };
      continue;
    }
    const from = own(values, 'from') ? parseTimeBoundary(values.from) : null;
    const until = own(values, 'until') ? parseTimeBoundary(values.until) : null;
    env.validity = { ...binding, mode: values.mode ?? null, from, until, at: evaluatedAt, view: 'unresolved', interval: '[from,until)' };
    if (reliable && fields.mode.state === 'missing') addGap(env, 'applicability-field-missing');
    if (reliable && (values.mode === 'timeless' || values.mode === 'perpetual')) {
      // Bounds from either explicit fields or defaults are a contradiction, never silently discarded.
      if (fields.from.state !== 'missing' || fields.until.state !== 'missing') addGap(env, 'validity-invalid');
      else env.validity.view = values.mode;
    } else if (reliable && values.mode === 'interval') {
      if (!from || !until) {
        if (fields.from.state === 'missing' || fields.until.state === 'missing') addGap(env, 'applicability-field-missing');
      } else if (from.kind === 'invalid' || until.kind === 'invalid') addGap(env, 'validity-invalid');
      else if (from.kind === 'date' || until.kind === 'date') {
        // Retain raw day precision. Even an apparently obvious future date is not an exact activation instant.
      } else if (from.kind === 'unbounded' && until.kind === 'unbounded') addGap(env, 'validity-invalid');
      else {
        const start = from.kind === 'unbounded' ? -Infinity : Date.parse(from.instant);
        const end = until.kind === 'unbounded' ? Infinity : Date.parse(until.instant);
        if (end <= start) addGap(env, 'validity-invalid');
        else { const time = Date.parse(evaluatedAt); env.validity.view = time < start ? 'future' : time >= end ? 'expired' : 'effective'; }
      }
    }
    if (Object.values(fields).some((field) => field.state === 'invalid')) addGap(env, 'validity-invalid');
    if (env.validity.view === 'unresolved') addGap(env, 'validity-unresolved');
  }
}

/** Canonical identity is independent of lifecycle/time. A filtered query cannot hide a duplicate. */
export function finalizeVariants(envelopes, { blocked = false, enabled = true, available = true } = {}) {
  const variants = envelopes.filter((env) => env.variant);
  const incomplete = blocked || variants.some((env) => !env.variant.cell);
  const groups = new Map();
  for (const env of variants) {
    if (!env.variant.cell) { addGap(env, 'variant-canonical-unresolved'); continue; }
    const key = JSON.stringify(env.variant.cell);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(env);
  }
  for (const group of groups.values()) {
    const canonicals = group.filter((env) => env.variant.canonical === true);
    const state = canonicals.length > 1 ? 'conflict' : incomplete ? 'unresolved' : canonicals.length === 0 ? 'missing' : 'unique';
    for (const env of group) {
      env.variant.cellState = state;
      env.variant.canonicalPath = state === 'unique' ? canonicals[0].identity.path : null;
      if (state !== 'unique') addGap(env, `variant-canonical-${state}`);
    }
  }
  const count = (state) => [...groups.values()].filter((group) => group[0].variant.cellState === state).length;
  return {
    enabled, state: !available ? 'not-applicable-no-git' : !enabled ? 'not-enabled' : incomplete ? 'incomplete' : !variants.length ? 'empty' : 'checked',
    objects: variants.length, cells: groups.size, basis: 'selected-inventory',
    complete: Boolean(available && enabled && variants.length && !incomplete),
    conflicts: count('conflict'), missing: count('missing'), unresolved: count('unresolved'), unassigned: variants.filter((env) => !env.variant.cell).length,
  };
}

/** Time coverage is independent of variant identity, including when only validity is enabled. */
export function summarizeValidity(envelopes, { enabled = true, available = true, blocked = false } = {}) {
  const objects = envelopes.filter((env) => env.validity);
  const unresolved = objects.filter((env) => env.validity.view === 'unresolved').length;
  return {
    enabled, state: !available ? 'not-applicable-no-git' : !enabled ? 'not-enabled' : blocked || unresolved ? 'incomplete' : !objects.length ? 'empty' : 'checked',
    objects: objects.length, basis: 'selected-inventory', complete: Boolean(available && enabled && objects.length && !blocked && !unresolved),
    unresolved, unparsed: objects.filter((env) => env.validity.state === 'unparsed').length,
    invalid: objects.filter((env) => env.gaps.includes('validity-invalid')).length,
  };
}
