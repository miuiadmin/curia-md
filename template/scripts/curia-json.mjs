/** Data-only JSON: reject ambiguous objects and bound nesting without logging source values. */
export const JSON_NATIVE_PARSER = 'json-native-object/1';
export const JSON_CONTENT_PARSER = 'json-data/1';
export const JSON_NATIVE_LIMITS = Object.freeze({ maxBytes: 64 * 1024, maxDepth: 64 });
export const JSON_NATIVE_CONTRACT = Object.freeze({
  parser: JSON_NATIVE_PARSER, effects: Object.freeze(['bounded-local-read']), privacy: 'explicit-local-mapping-with-path-exclusions',
  limits: JSON_NATIVE_LIMITS, activeContent: 'never-executed', externalReferences: 'never-followed',
  coverage: 'syntax-and-declared-fields-only', verification: 'not-performed',
});
export const JSON_CONTENT_CONTRACT = Object.freeze({
  ...JSON_NATIVE_CONTRACT, parser: JSON_CONTENT_PARSER, coverage: 'syntax-only-not-schema',
});
const failure = (code, message) => Object.assign(new Error(`${message} [${code}]`), { code });

function parseJson(text, maxDepth, exactNumbers = false) {
  if (typeof text !== 'string' || !Number.isSafeInteger(maxDepth) || maxDepth < 1) throw failure('json/input-invalid', 'JSON 输入或深度限制非法');
  let pos = 0;
  const syntax = () => failure('json/syntax-invalid', 'JSON 语法非法');
  const space = () => { while (/[\t\n\r ]/.test(text[pos] ?? '\0')) pos++; };
  const atom = (raw) => { try { return JSON.parse(raw); } catch { throw syntax(); } };
  const string = () => {
    if (text[pos] !== '"') throw syntax();
    const start = pos++;
    while (pos < text.length) {
      if (text[pos] === '\\') { pos += 2; continue; }
      if (text[pos++] === '"') return atom(text.slice(start, pos));
    }
    throw syntax();
  };
  const value = (depth) => {
    space();
    if (pos >= text.length) throw syntax();
    const ch = text[pos];
    if (ch === '"') return string();
    if (ch !== '{' && ch !== '[') {
      const start = pos;
      while (pos < text.length && !/[\s\[\]{}:,]/.test(text[pos])) pos++;
      const parsed = atom(text.slice(start, pos));
      if (parsed !== null && typeof parsed === 'object') throw syntax();
      return exactNumbers && typeof parsed === 'number' ? new ExactNumber(text.slice(start, pos)) : parsed;
    }
    if (depth >= maxDepth) throw failure('json/depth-exceeded', 'JSON 嵌套超出限制');
    const object = ch === '{', end = object ? '}' : ']', out = object ? Object.create(null) : [], seen = new Set();
    pos++; space();
    if (text[pos] === end) { pos++; return out; }
    while (true) {
      if (object) {
        space(); const key = string();
        if (seen.has(key)) throw failure('json/duplicate-key', 'JSON 含重复键');
        seen.add(key); space(); if (text[pos++] !== ':') throw syntax();
        out[key] = value(depth + 1);
      } else out.push(value(depth + 1));
      space();
      if (text[pos] === end) { pos++; return out; }
      if (text[pos++] !== ',') throw syntax();
    }
  };
  const parsed = value(0);
  space(); if (pos !== text.length) throw syntax();
  return parsed;
}

export function parseDataJson(text, maxDepth = JSON_NATIVE_LIMITS.maxDepth) {
  return parseJson(text, maxDepth);
}

/** Registry JSON must not silently choose the last occurrence of an authority field. */
export function parseRegistryJson(text) {
  try { return parseDataJson(text); }
  catch (error) { throw new Error(`Curia Registry JSON 非法：${error.message}`); }
}

// Numbers remain decimal tokens, never binary64. Exponents are not expanded into zero strings.
class ExactNumber {
  constructor(raw) {
    const match = /^(-?)([0-9]+)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$/.exec(raw);
    let digits = `${match[2]}${match[3] ?? ''}`.replace(/^0+/, '');
    if (!digits) { this.key = '0'; return; }
    const tail = /0*$/.exec(digits)[0].length;
    digits = digits.slice(0, digits.length - tail);
    const exponent = BigInt(match[4] ?? '0') - BigInt((match[3] ?? '').length) + BigInt(tail);
    this.key = `${match[1]}${digits}e${exponent}`;
  }
}

/** Explicit JSON value locator; native metadata fields still require non-root pointers. */
export const validJsonLocator = (value) => value === '' || validJsonPointer(value);
const jsonKind = (value) => value instanceof ExactNumber ? 'number' : value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
function equalJsonValue(left, right) {
  const kind = jsonKind(left);
  if (kind !== jsonKind(right)) return false;
  if (kind === 'number') return left.key === right.key;
  if (kind === 'array') return left.length === right.length && left.every((item, i) => equalJsonValue(item, right[i]));
  if (kind === 'object') {
    const keys = Object.keys(left);
    return keys.length === Object.keys(right).length && keys.every((key) => Object.hasOwn(right, key) && equalJsonValue(left[key], right[key]));
  }
  return left === right;
}

/** No decoded values escape the comparison; duplicate decoded keys fail before pointer lookup. */
export function compareJsonPointers(leftText, leftPointer, rightText, rightPointer) {
  if (![leftPointer, rightPointer].every(validJsonLocator)) throw failure('json/pointer-invalid', 'JSON 定位符非法');
  for (const text of [leftText, rightText]) {
    if (typeof text !== 'string') throw failure('json/input-invalid', 'JSON 输入非法');
    if (Buffer.byteLength(text, 'utf8') > JSON_NATIVE_LIMITS.maxBytes) throw failure('json/byte-limit', 'JSON 输入超出字节限制');
  }
  const values = [leftText, rightText].map((text) => parseJson(text, JSON_NATIVE_LIMITS.maxDepth, true));
  const [left, right] = [leftPointer, rightPointer].map((pointer, i) => pointer === '' ? { present: true, value: values[i] } : lookup(values[i], pointer));
  const shape = (item) => ({ present: item.present, kind: item.present ? jsonKind(item.value) : null });
  return { state: !left.present || !right.present ? 'missing' : equalJsonValue(left.value, right.value) ? 'equal' : 'different', left: shape(left), right: shape(right) };
}

export function validJsonPointer(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || /[\u0000-\u001f\u007f]/u.test(value) || /~(?![01])/u.test(value)) return false;
  try { encodeURIComponent(value); return true; } catch { return false; }
}
export function lookupJsonPointer(data, pointer) {
  if (!validJsonLocator(pointer)) throw failure('json/pointer-invalid', 'JSON 定位符非法');
  return pointer === '' ? { present: true, value: data } : lookup(data, pointer);
}
function lookup(data, pointer) {
  let value = data;
  for (const encoded of pointer.slice(1).split('/')) {
    const key = encoded.replace(/~1/g, '/').replace(/~0/g, '~');
    if (value === null || value instanceof ExactNumber || typeof value !== 'object' || (Array.isArray(value) && !/^(0|[1-9][0-9]*)$/.test(key)) || !Object.prototype.hasOwnProperty.call(value, key)) return { present: false };
    value = value[key];
  }
  return { present: true, value };
}

function inspectJsonData(input) {
  const result = { state: 'unparsed', reason: null };
  if (input?.privacyExcluded) { result.reason = 'json/privacy-excluded'; return result; }
  if (input?.truncated) { result.reason = 'json/byte-limit'; return result; }
  if (!input || input.encodingState !== 'valid' || typeof input.text !== 'string') { result.reason = 'json/input-unavailable'; return result; }
  if (Buffer.byteLength(input.text, 'utf8') > JSON_NATIVE_LIMITS.maxBytes) { result.reason = 'json/byte-limit'; return result; }
  try { return { state: 'parsed', reason: null, data: parseDataJson(input.text) }; }
  catch (error) { result.reason = error.code ?? 'json/syntax-invalid'; return result; }
}

/** Content inspection never exports decoded values or treats business keys as metadata. */
export function inspectJsonContent(input) {
  const { state, reason } = inspectJsonData(input);
  return { state, reason };
}

export function inspectNativeJson(input, fields, rel) {
  const { state, reason, data } = inspectJsonData(input);
  const result = { state: 'unparsed', reason, fields: Object.create(null) };
  if (state !== 'parsed') return result;
  if (!data || typeof data !== 'object' || Array.isArray(data)) { result.reason = 'json/root-not-object'; return result; }
  result.state = 'parsed';
  for (const [key, pointer] of Object.entries(fields)) {
    if (!validJsonPointer(pointer)) throw failure('json/pointer-invalid', '字段定位符非法');
    const observed = lookup(data, pointer);
    const valid = typeof observed.value === 'string' && observed.value.trim() === observed.value && observed.value.length > 0 && !/[\u0000-\u001f\u007f]/u.test(observed.value);
    result.fields[key] = observed.present ? [{ value: valid ? observed.value : null, valueKind: observed.value === null ? 'null' : Array.isArray(observed.value) ? 'array' : typeof observed.value, pointer, source: `${rel}#${encodeURIComponent(pointer)}` }] : [];
  }
  return result;
}
