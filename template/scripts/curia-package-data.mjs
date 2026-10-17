/** Bounded ZIP/XML data reader. No filesystem extraction, entity resolver or executable payloads. */
import { inflateRawSync } from 'node:zlib';

export const PACKAGE_LIMITS = Object.freeze({ maxInputBytes: 4 * 1024 * 1024 - 1, maxEntries: 512, maxEntryBytes: 4 * 1024 * 1024, maxExpandedBytes: 16 * 1024 * 1024, maxNodes: 100000, maxDepth: 96, maxAttributes: 128 });
export function dataError(code) { throw Object.assign(new Error(`Office 数据不可用 [office/${code}]`), { code: `office/${code}` }); }
const requireData = (yes, code) => { if (!yes) dataError(code); };
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const b of bytes) { crc ^= b; for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function utf8(bytes) { try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { dataError('invalid-utf8'); } }
function extras(bytes) {
  let p = 0;
  const seen = new Set();
  while (p < bytes.length) {
    requireData(p + 4 <= bytes.length, 'zip-extra');
    const id = bytes.readUInt16LE(p), size = bytes.readUInt16LE(p + 2); p += 4;
    requireData(p + size <= bytes.length && !seen.has(id), 'zip-extra'); seen.add(id);
    // No ZIP64, alternate Unicode path interpretation, encryption or strong encryption.
    requireData(![1, 0x7075, 0x6375, 0x9901, 0x0017].includes(id), 'zip-extra-unsupported'); p += size;
  }
}
export function readZipData(input) {
  requireData(Buffer.isBuffer(input) && input.length <= PACKAGE_LIMITS.maxInputBytes && input.length >= 22, 'zip-input-limit');
  let end = -1;
  for (let p = input.length - 22; p >= Math.max(0, input.length - 65557); p--) {
    if (input.readUInt32LE(p) === 0x06054b50 && p + 22 + input.readUInt16LE(p + 20) === input.length) { end = p; break; }
  }
  requireData(end >= 0, 'zip-end');
  const n = input.readUInt16LE(end + 10), cdSize = input.readUInt32LE(end + 12), cdOffset = input.readUInt32LE(end + 16);
  requireData(input.readUInt16LE(end + 4) === 0 && input.readUInt16LE(end + 6) === 0 && input.readUInt16LE(end + 8) === n, 'zip-multivolume');
  requireData(n > 0 && n <= PACKAGE_LIMITS.maxEntries && cdOffset !== 0xffffffff && cdSize !== 0xffffffff && cdOffset + cdSize === end, 'zip-directory-limit');
  const entries = [], aliases = new Set(); let p = cdOffset, expanded = 0;
  for (let i = 0; i < n; i++) {
    requireData(p + 46 <= end && input.readUInt32LE(p) === 0x02014b50, 'zip-central');
    const version = input.readUInt16LE(p + 6), flags = input.readUInt16LE(p + 8), method = input.readUInt16LE(p + 10), crc = input.readUInt32LE(p + 16), packed = input.readUInt32LE(p + 20), size = input.readUInt32LE(p + 24);
    const nl = input.readUInt16LE(p + 28), xl = input.readUInt16LE(p + 30), cl = input.readUInt16LE(p + 32), offset = input.readUInt32LE(p + 42), attr = input.readUInt32LE(p + 38), mode = (attr >>> 16) & 0xf000;
    requireData(nl > 0 && p + 46 + nl + xl + cl <= end && input.readUInt16LE(p + 34) === 0, 'zip-central');
    requireData(version <= 20 && [0, 8].includes(method) && (flags & ~(0x800 | 8 | (method === 8 ? 6 : 0))) === 0, 'zip-feature-unsupported');
    requireData(size <= PACKAGE_LIMITS.maxEntryBytes && packed <= input.length && offset < cdOffset, 'zip-entry-limit');
    expanded += size; requireData(expanded <= PACKAGE_LIMITS.maxExpandedBytes, 'zip-expansion-limit');
    const rawName = input.subarray(p + 46, p + 46 + nl);
    requireData((flags & 0x800) || rawName.every(b => b < 128), 'zip-name-encoding');
    const name = utf8(rawName), directory = name.endsWith('/'), segments = (directory ? name.slice(0, -1) : name).split('/');
    requireData(!/[\\:%?#\x00-\x20\x7f]/u.test(name) && segments.every(s => s && s !== '.' && s !== '..' && !s.endsWith('.') && s.normalize('NFC') === s), 'zip-path');
    const alias = name.toLowerCase().replace(/\/$/, '');
    requireData(!aliases.has(alias), 'zip-alias'); aliases.add(alias);
    requireData([0, 0x8000, 0x4000].includes(mode) && (mode !== 0x4000 || directory) && (mode !== 0x8000 || !directory) && (!(attr & 16) || directory), 'zip-special-file');
    requireData(!directory || (size === 0 && packed === 0 && method === 0), 'zip-directory-data');
    extras(input.subarray(p + 46 + nl, p + 46 + nl + xl));
    entries.push({ name, rawName, offset, size, packed, flags, method, crc, directory, version }); p += 46 + nl + xl + cl;
  }
  requireData(p === end, 'zip-central-size');
  for (const entry of entries) {
    const { offset: o, rawName, version, flags, method, crc, packed, size } = entry;
    requireData(o + 30 <= cdOffset && input.readUInt32LE(o) === 0x04034b50, 'zip-local');
    const nl = input.readUInt16LE(o + 26), xl = input.readUInt16LE(o + 28), start = o + 30 + nl + xl, stop = start + packed;
    requireData(start <= cdOffset && stop <= cdOffset && input.readUInt16LE(o + 4) === version && input.readUInt16LE(o + 6) === flags && input.readUInt16LE(o + 8) === method && rawName.equals(input.subarray(o + 30, o + 30 + nl)), 'zip-header-mismatch');
    extras(input.subarray(o + 30 + nl, start));
    const local = [input.readUInt32LE(o + 14), input.readUInt32LE(o + 18), input.readUInt32LE(o + 22)], expected = [crc, packed, size];
    requireData(local.every((v, i) => v === expected[i] || ((flags & 8) && v === 0)), 'zip-header-mismatch');
    let finish = stop;
    if (flags & 8) {
      const matches = at => at + 12 <= cdOffset && expected.every((v, i) => input.readUInt32LE(at + i * 4) === v);
      if (stop + 16 <= cdOffset && input.readUInt32LE(stop) === 0x08074b50 && matches(stop + 4)) finish += 16;
      else if (matches(stop)) finish += 12;
      else dataError('zip-descriptor');
    }
    entry.start = start; entry.finish = finish;
  }
  let cursor = 0;
  for (const entry of [...entries].sort((a, b) => a.offset - b.offset)) { requireData(entry.offset === cursor, 'zip-overlap-or-gap'); cursor = entry.finish; }
  requireData(cursor === cdOffset, 'zip-overlap-or-gap');
  const files = new Map();
  for (const e of entries) {
    let bytes = input.subarray(e.start, e.start + e.packed);
    if (e.method === 8) {
      try {
        const out = inflateRawSync(bytes, { maxOutputLength: Math.max(1, e.size + 1), info: true });
        requireData(out.engine.bytesWritten === e.packed, 'zip-deflate-trailing'); bytes = out.buffer;
      } catch (error) { if (error.code?.startsWith('office/')) throw error; dataError('zip-deflate'); }
    }
    requireData(bytes.length === e.size && crc32(bytes) === e.crc, 'zip-integrity');
    if (!e.directory) files.set(e.name, bytes);
  }
  return { files, expandedBytes: expanded, entries: n };
}
const XML = 'http://www.w3.org/XML/1998/namespace', XMLNS = 'http://www.w3.org/2000/xmlns/';
const nameRE = /^[A-Za-z_][A-Za-z0-9_.-]*(?::[A-Za-z_][A-Za-z0-9_.-]*)?$/;
function validCharacters(s) { for (const c of s) { const n = c.codePointAt(0); if (!(n === 9 || n === 10 || n === 13 || (n >= 32 && n <= 0xd7ff) || (n >= 0xe000 && n <= 0xfffd) || (n >= 0x10000 && n <= 0x10ffff))) dataError('xml-character'); } }
function unescapeXML(s) {
  return s.replace(/&([^;]*);|&/g, (whole, entity) => {
    const predefined = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
    if (Object.hasOwn(predefined, entity)) return predefined[entity];
    requireData(/^#(?:[0-9]+|x[0-9a-fA-F]+)$/.test(entity ?? ''), 'xml-entity');
    const n = entity[1] === 'x' ? Number.parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    requireData(Number.isSafeInteger(n) && n <= 0x10ffff, 'xml-character'); const value = String.fromCodePoint(n); validCharacters(value); return value;
  });
}
/** Element id is pre-order within this original XML part, not a page or source line. */
export function parseDataXML(bytes, budget = { nodes: 0 }) {
  requireData(Buffer.isBuffer(bytes) && bytes.length <= PACKAGE_LIMITS.maxEntryBytes, 'xml-byte-limit');
  let s = utf8(bytes); if (s[0] === '\ufeff') s = s.slice(1);
  validCharacters(s); s = s.replace(/\r\n?/g, '\n');
  let pos = 0, root = null, id = 0; const stack = [];
  const charge = () => { budget.nodes++; requireData(budget.nodes <= PACKAGE_LIMITS.maxNodes, 'xml-node-limit'); };
  if (s.startsWith('<?xml ')) {
    const end = s.indexOf('?>'); requireData(end >= 0, 'xml-declaration'); const d = s.slice(0, end + 2);
    requireData(/^<\?xml[ \t\n]+version=(?:"1\.0"|'1\.0')(?:[ \t\n]+encoding=(?:"[Uu][Tt][Ff]-8"|'[Uu][Tt][Ff]-8'))?(?:[ \t\n]+standalone=(?:"(?:yes|no)"|'(?:yes|no)'))?[ \t\n]*\?>$/.test(d), 'xml-declaration-unsupported'); pos = end + 2;
  }
  const appendText = (text, cdata = false) => {
    requireData(cdata || !text.includes(']]>'), 'xml-text');
    if (!stack.length) requireData(/^[ \t\n]*$/.test(text), 'xml-root-text');
    else if (text) { charge(); stack.at(-1).node.children.push(cdata ? text : unescapeXML(text)); }
  };
  while (pos < s.length) {
    if (s[pos] !== '<') { const end = s.indexOf('<', pos); const stop = end < 0 ? s.length : end; appendText(s.slice(pos, stop)); pos = stop; continue; }
    if (s.startsWith('<!--', pos)) { const end = s.indexOf('-->', pos + 4); requireData(end >= 0 && !s.slice(pos + 4, end).includes('--') && !s.slice(pos + 4, end).endsWith('-'), 'xml-comment'); charge(); pos = end + 3; continue; }
    if (s.startsWith('<![CDATA[', pos)) { const end = s.indexOf(']]>', pos + 9); requireData(end >= 0 && stack.length > 0, 'xml-cdata'); appendText(s.slice(pos + 9, end), true); pos = end + 3; continue; }
    requireData(!s.startsWith('<!', pos) && !s.startsWith('<?', pos), 'xml-declaration-or-instruction');
    if (s.startsWith('</', pos)) {
      const end = s.indexOf('>', pos + 2); requireData(end >= 0, 'xml-end'); const name = s.slice(pos + 2, end).replace(/[ \t\n]+$/, '');
      requireData(nameRE.test(name) && stack.length && stack.at(-1).node.qname === name, 'xml-end'); stack.pop(); pos = end + 1; continue;
    }
    const token = /^<([^\s/>]+)/.exec(s.slice(pos)); requireData(token && nameRE.test(token[1]), 'xml-name-unsupported');
    const qname = token[1]; pos += token[0].length; const raw = []; let empty = false;
    while (true) {
      const ws = /^[ \t\n]+/.exec(s.slice(pos)); if (ws) pos += ws[0].length;
      if (s.startsWith('/>', pos)) { empty = true; pos += 2; break; }
      if (s[pos] === '>') { pos++; break; }
      requireData(ws && raw.length < PACKAGE_LIMITS.maxAttributes, 'xml-attributes');
      const match = /^([^\s=/>]+)[ \t\n]*=[ \t\n]*(["'])/.exec(s.slice(pos)); requireData(match && nameRE.test(match[1]), 'xml-attribute');
      pos += match[0].length; const end = s.indexOf(match[2], pos); requireData(end >= 0, 'xml-attribute'); const value = s.slice(pos, end);
      requireData(!value.includes('<') && !raw.some(a => a.name === match[1]), 'xml-attribute');
      raw.push({ name: match[1], value: unescapeXML(value.replace(/[\t\n]/g, ' ')) }); pos = end + 1;
    }
    const ns = new Map(stack.length ? stack.at(-1).ns : [['xml', XML]]);
    for (const a of raw) if (a.name === 'xmlns' || a.name.startsWith('xmlns:')) {
      const prefix = a.name === 'xmlns' ? '' : a.name.slice(6);
      requireData(prefix !== 'xmlns' && a.value !== XMLNS && (prefix === 'xml' ? a.value === XML : a.value !== XML) && (!prefix || a.value), 'xml-namespace'); ns.set(prefix, a.value);
    }
    const expand = (name, attr = false) => {
      const parts = name.split(':'); if (parts.length === 1) return { local: name, ns: attr ? '' : ns.get('') ?? '' };
      requireData(parts[0] !== 'xmlns' && ns.has(parts[0]) && ns.get(parts[0]), 'xml-namespace'); return { local: parts[1], ns: ns.get(parts[0]) };
    };
    const node = { id: ++id, qname, ...expand(qname), attrs: [], children: [] }; const keys = new Set();
    for (const a of raw.filter(a => a.name !== 'xmlns' && !a.name.startsWith('xmlns:'))) {
      const ex = expand(a.name, true), key = `${ex.ns}\0${ex.local}`; requireData(!keys.has(key), 'xml-duplicate-expanded-attribute'); keys.add(key); node.attrs.push({ ...ex, value: a.value });
    }
    charge(); requireData(stack.length < PACKAGE_LIMITS.maxDepth, 'xml-depth-limit');
    if (stack.length) stack.at(-1).node.children.push(node); else { requireData(!root, 'xml-multiple-roots'); root = node; }
    if (!empty) stack.push({ node, ns });
  }
  requireData(root && stack.length === 0, 'xml-unclosed'); return root;
}
export const elements = node => node.children.filter(c => typeof c !== 'string');
export const attribute = (node, name, ns = '') => node.attrs.find(a => a.local === name && a.ns === ns)?.value ?? null;
export const textData = node => node.children.map(c => typeof c === 'string' ? c : textData(c)).join('');
