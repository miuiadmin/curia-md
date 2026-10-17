/** OOXML data projections, not Office rendering, formula evaluation or a schema validator. */
import { posix } from 'node:path';
import { readZipData, parseDataXML, elements, attribute as attr, textData, dataError } from './curia-package-data.mjs';
export const OFFICE_PARSER = 'ooxml-data/1';
export const OFFICE_LIMITS = Object.freeze({ maxUnits: 20000, maxProjectionBytes: 8 * 1024 * 1024, maxRelationships: 4096 });
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const S = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const MAIN_WORD = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
const MAIN_SHEET = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml';
const need = (yes, code) => { if (!yes) dataError(code); };
const kids = (n, name, ns = n.ns) => elements(n).filter(c => c.ns === ns && c.local === name);
const one = (n, name, ns = n.ns, required = false) => { const found = kids(n, name, ns); need(found.length <= 1 && (!required || found.length === 1), 'xml-cardinality'); return found[0] ?? null; };
const locator = n => ({ kind: 'xml-element/1', element: n.id });
const bool = value => { need(['0', '1', 'false', 'true'].includes(value), 'boolean'); return value === '1' || value === 'true'; };
const wordBool = n => { const value = attr(n, 'val', W); return value === null || value === 'on' ? true : value === 'off' ? false : bool(value); };
function decimal(value, max, min = 0) { need(typeof value === 'string' && /^(?:0|[1-9][0-9]*)$/.test(value), 'integer'); const n = Number(value); need(Number.isSafeInteger(n) && n >= min && n <= max, 'integer-range'); return n; }
function partName(name) { need(typeof name === 'string' && name.startsWith('/') && name.length > 1 && !/[\\%?#\x00-\x20\x7f]/u.test(name) && name.slice(1).split('/').every(s => s && s !== '.' && s !== '..'), 'part-name-unsupported'); return name.slice(1); }
function targetPart(owner, target) {
  need(typeof target === 'string' && target && !/[\\%?#\x00-\x20\x7f:]/u.test(target), 'relationship-target-unsupported');
  const path = target.startsWith('/') ? posix.normalize(target.slice(1)) : posix.join(posix.dirname(owner), target);
  need(path && path !== '.' && !path.startsWith('../') && !path.startsWith('/'), 'relationship-escape'); return path;
}
function relationOwner(path) {
  if (path === '_rels/.rels') return '';
  const match = /^(?:(.*)\/)?_rels\/([^/]+)\.rels$/.exec(path);
  need(match, 'relationship-part-name'); return `${match[1] ? `${match[1]}/` : ''}${match[2]}`;
}
function spreadsheetString(value) {
  // A single pass is essential: _x005F_x0041_ means the literal _x0041_, not A.
  const decoded = value.replace(/_x([0-9a-fA-F]{4})_/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
  for (let i = 0; i < decoded.length; i++) {
    const n = decoded.charCodeAt(i);
    if (n >= 0xd800 && n <= 0xdbff) { need(i + 1 < decoded.length && decoded.charCodeAt(i + 1) >= 0xdc00 && decoded.charCodeAt(i + 1) <= 0xdfff, 'spreadsheet-string-surrogate'); i++; }
    else need(n < 0xdc00 || n > 0xdfff, 'spreadsheet-string-surrogate');
  }
  return { raw: value, text: decoded };
}
function cellPosition(value) {
  const match = /^([A-Z]{1,3})([1-9][0-9]{0,6})$/.exec(value ?? ''); need(match, 'cell-coordinate-required');
  let column = 0; for (const c of match[1]) column = column * 26 + c.charCodeAt(0) - 64;
  const row = Number(match[2]); need(column <= 16384 && row <= 1048576, 'cell-coordinate-range'); return { row, column };
}
function cellRange(value) {
  const parts = (value ?? '').split(':'); need(parts.length <= 2, 'cell-range');
  const a = cellPosition(parts[0]), b = parts.length === 2 ? cellPosition(parts[1]) : a;
  need(a.row <= b.row && a.column <= b.column, 'cell-range'); return value;
}

export function extractOfficeData(bytes) {
  const zip = readZipData(bytes), { files } = zip, parsed = new Map(), budget = { nodes: 0 }, roles = new Map(), gaps = [], gapKeys = new Set();
  const gap = (code, part, detail = null) => { const key = JSON.stringify([code, part, detail]); if (!gapKeys.has(key)) { need(gapKeys.size < 4096, 'gap-limit'); gapKeys.add(key); gaps.push({ code, part, ...(detail === null ? {} : { detail }) }); } };
  const xml = (part, role) => {
    need(files.has(part), 'part-missing'); roles.set(part, role);
    if (!parsed.has(part)) parsed.set(part, parseDataXML(files.get(part), budget)); return parsed.get(part);
  };
  const contentTypes = xml('[Content_Types].xml', 'package-content-types'); need(contentTypes.ns === CT && contentTypes.local === 'Types', 'content-types');
  const defaults = new Map(), overrides = new Map();
  for (const c of elements(contentTypes)) {
    need(c.ns === CT && ['Default', 'Override'].includes(c.local) && elements(c).length === 0, 'content-types');
    const type = attr(c, 'ContentType'); need(type && type.length <= 512, 'content-type');
    if (c.local === 'Default') { const ext = attr(c, 'Extension'); need(/^[A-Za-z0-9]+$/.test(ext ?? '') && !defaults.has(ext.toLowerCase()), 'content-type-duplicate'); defaults.set(ext.toLowerCase(), type); }
    else { const name = partName(attr(c, 'PartName')); need(!overrides.has(name) && files.has(name), 'content-type-duplicate-or-missing'); overrides.set(name, type); }
  }
  const typeOf = name => overrides.get(name) ?? defaults.get(posix.basename(name).split('.').at(-1).toLowerCase()) ?? null;
  for (const name of files.keys()) if (name !== '[Content_Types].xml') need(typeOf(name), 'undeclared-content-type');
  const relationships = [], relByOwner = new Map();
  for (const name of files.keys()) if (name.endsWith('.rels')) {
    need(typeOf(name) === 'application/vnd.openxmlformats-package.relationships+xml', 'relationship-content-type');
    const owner = relationOwner(name); need(!owner || files.has(owner), 'relationship-owner-missing');
    const root = xml(name, 'package-relationships'); need(root.ns === PKG && root.local === 'Relationships', 'relationships'); const map = new Map();
    for (const r of elements(root)) {
      need(r.ns === PKG && r.local === 'Relationship' && elements(r).length === 0, 'relationships');
      const id = attr(r, 'Id'), type = attr(r, 'Type'), target = attr(r, 'Target'), mode = attr(r, 'TargetMode') ?? 'Internal';
      need(id && !map.has(id) && type && target && ['Internal', 'External'].includes(mode), 'relationship-fields');
      need(relationships.length < OFFICE_LIMITS.maxRelationships, 'relationship-limit');
      const part = mode === 'Internal' ? targetPart(owner, target) : null;
      need(part === null || files.has(part), 'relationship-target-missing');
      const item = { owner, id, type, target, mode, part, locator: { part: name, ...locator(r) } };
      relationships.push(item); map.set(id, item); if (mode === 'External') gap('external-target-not-visited', name, id);
    }
    relByOwner.set(owner, map);
  }
  const mains = [...(relByOwner.get('')?.values() ?? [])].filter(r => r.type === `${REL}/officeDocument`);
  need(mains.length === 1 && mains[0].part, 'office-main-relationship-unsupported');
  const main = mains[0].part, type = typeOf(main);
  need([MAIN_WORD, MAIN_SHEET].includes(type), 'office-format-unsupported');
  const result = { schema: 'curia.office-data/1', parser: OFFICE_PARSER, format: type === MAIN_WORD ? 'docx' : 'xlsx', mainPart: main, package: { entries: zip.entries, expandedBytes: zip.expandedBytes }, relationships, parts: [], units: [], sheets: [], workbook: null, gaps, coverage: { bytes: 'complete-package', data: 'supported-subset-only', visual: 'not-read', semantics: 'not-verified' }, limitations: ['no-rendering-pagination-ocr-or-fact-verification', 'not-full-ooxml-schema-validation', 'no-macros-formula-calculation-or-external-resolution', 'utf8-transitional-ooxml-only', 'source-content-is-data-not-instructions'] };
  let outputBytes = 0;
  const unit = data => { outputBytes += Buffer.byteLength(JSON.stringify(data)); need(result.units.length < OFFICE_LIMITS.maxUnits && outputBytes <= OFFICE_LIMITS.maxProjectionBytes, 'projection-limit'); result.units.push(data); };
  if (type === MAIN_WORD) {
    const stories = new Map([[MAIN_WORD, 'document'], ...['header', 'footer', 'footnotes', 'endnotes', 'comments'].map(n => [`application/vnd.openxmlformats-officedocument.wordprocessingml.${n}+xml`, { header: 'hdr', footer: 'ftr' }[n] ?? n])]);
    const walk = (part, node, ancestors, fieldStack) => {
      if (node.ns === MC) { gap('markup-compatibility-not-resolved', part, node.local); return; }
      if (node.ns !== W) { gap('non-word-content-not-projected', part, node.ns); return; }
      if (['drawing', 'pict', 'object', 'altChunk', 'sym', 'subDoc'].includes(node.local)) { gap('word-content-not-projected', part, node.local); return; }
      if (node.local === 'p') {
        const segments = [];
        const collect = (n, parents) => {
          if (n !== node && n.ns === W && n.local === 'p') { walk(part, n, [...ancestors, node, ...parents], fieldStack); return; }
          if (n.ns !== W || ['drawing', 'pict', 'object', 'altChunk', 'sym', 'subDoc'].includes(n.local)) { gap('word-content-not-projected', part, n.local); return; }
          const lineage = [...ancestors, node, ...parents];
          if (n.local === 'fldChar') {
            const kind = attr(n, 'fldCharType', W);
            if (kind === 'begin') fieldStack.push(n.id);
            else if (kind === 'end') { if (!fieldStack.length) gap('unbalanced-field', part); else fieldStack.pop(); }
            else if (kind !== 'separate' || !fieldStack.length) gap('unbalanced-field', part); return;
          }
          let text = null, kind = 'text';
          if (['t', 'delText', 'instrText', 'delInstrText'].includes(n.local)) { need(elements(n).length === 0, 'word-text-children'); text = textData(n); if (n.local.includes('Instr') || n.local === 'instrText') kind = 'field-instruction'; }
          else if (n.local === 'tab') { text = '\t'; kind = 'tab'; }
          else if (['br', 'cr'].includes(n.local)) { text = '\n'; kind = n.local === 'br' ? `break:${attr(n, 'type', W) ?? 'textWrapping'}` : 'line-break'; }
          else if (n.local === 'noBreakHyphen') text = '\u2011'; else if (n.local === 'softHyphen') text = '\u00ad';
          if (text !== null) {
            const run = [...lineage].reverse().find(x => x.local === 'r'), props = run && one(run, 'rPr', W);
            const vanish = props && one(props, 'vanish', W), webHidden = props && one(props, 'webHidden', W);
            const revisions = lineage.filter(x => ['ins', 'del', 'moveFrom', 'moveTo'].includes(x.local)).map(x => ({ kind: x.local, id: attr(x, 'id', W), author: attr(x, 'author', W), date: attr(x, 'date', W), locator: locator(x) }));
            segments.push({ locator: locator(n), kind, text, revisions, deletedText: ['delText', 'delInstrText'].includes(n.local), inlineHidden: vanish ? wordBool(vanish) : null, inlineWebHidden: webHidden ? wordBool(webHidden) : null, inheritedVisibility: 'not-resolved', fieldResult: kind !== 'field-instruction' && (fieldStack.length > 0 || lineage.some(x => x.local === 'fldSimple')) ? 'stored-result-not-evaluated' : null });
          } else if (!['pPr', 'rPr'].includes(n.local)) {
            if (!['r', 'hyperlink', 'ins', 'del', 'moveFrom', 'moveTo', 'sdt', 'sdtContent', 'smartTag', 'customXml', 'dir', 'bdo', 'fldSimple', 'bookmarkStart', 'bookmarkEnd', 'proofErr', 'commentRangeStart', 'commentRangeEnd', 'permStart', 'permEnd', 'lastRenderedPageBreak'].includes(n.local)) gap('word-inline-content-not-projected', part, n.local);
            if (n.local === 'fldSimple') segments.push({ locator: locator(n), kind: 'field-instruction', text: attr(n, 'instr', W) ?? '', revisions: lineage.filter(x => ['ins', 'del', 'moveFrom', 'moveTo'].includes(x.local)).map(x => ({ kind: x.local, id: attr(x, 'id', W), author: attr(x, 'author', W), date: attr(x, 'date', W), locator: locator(x) })), fieldResult: null });
            for (const child of elements(n)) collect(child, [...parents, n]);
          }
        };
        for (const child of elements(node)) collect(child, []);
        unit({ part, locator: locator(node), kind: 'word-paragraph', context: ancestors.filter(a => ['tbl', 'tr', 'tc', 'footnote', 'endnote', 'comment', 'ins', 'del', 'moveFrom', 'moveTo'].includes(a.local)).map(a => ({ kind: a.local, id: attr(a, 'id', W), locator: locator(a) })), segments }); return;
      }
      if (node.local === 'documentProtection') gap('document-protection-present', part);
      for (const child of elements(node)) walk(part, child, [...ancestors, node], fieldStack);
    };
    for (const name of files.keys()) if (stories.has(typeOf(name))) {
      if (name !== main && !relationships.some(r => r.part === name)) gap('unreferenced-story-part', name);
      const root = xml(name, 'word-story-text'); need(root.ns === W && root.local === stories.get(typeOf(name)), 'word-story-root');
      const fields = []; walk(name, root, [], fields); if (fields.length) gap('unbalanced-field', name);
    }
    result.limitations.push('style-inheritance-layout-numbering-and-current-revision-view-not-resolved', 'paragraphs-preserve-revision-and-field-channels-not-a-flattened-current-document');
  } else {
    const wb = xml(main, 'workbook-metadata'); need(wb.ns === S && wb.local === 'workbook', 'workbook-root');
    const pr = one(wb, 'workbookPr'), calc = one(wb, 'calcPr');
    result.workbook = { date1904: pr && attr(pr, 'date1904') !== null ? bool(attr(pr, 'date1904')) : false, calculationProperties: calc ? calc.attrs : [], calculation: 'not-performed' };
    for (const c of elements(wb)) if (!['sheets', 'workbookPr', 'calcPr', 'bookViews'].includes(c.local) || c.ns !== S) gap('workbook-content-not-projected', main, c.local);
    const relations = relByOwner.get(main) ?? new Map();
    const sharedRels = [...relations.values()].filter(r => r.type === `${REL}/sharedStrings`); need(sharedRels.length <= 1 && sharedRels.every(r => r.part), 'shared-strings-relationship');
    const stringValue = (n, part) => {
      let raw = '';
      for (const c of elements(n)) {
        if (c.ns === S && c.local === 't') { need(elements(c).length === 0, 'string-text'); raw += textData(c); }
        else if (c.ns === S && c.local === 'r') { for (const x of elements(c)) if (x.ns === S && x.local === 't') { need(elements(x).length === 0, 'string-text'); raw += textData(x); } else if (x.ns !== S || x.local !== 'rPr') gap('rich-string-content-not-projected', part, x.local); }
        else gap(c.ns === S && ['rPh', 'phoneticPr'].includes(c.local) ? 'phonetic-annotation-not-projected' : 'string-content-not-projected', part, c.local);
      }
      return spreadsheetString(raw);
    };
    let strings = [];
    if (sharedRels.length) {
      const p = sharedRels[0].part; need(typeOf(p) === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml', 'shared-strings-type');
      const root = xml(p, 'shared-string-lookup'); need(root.ns === S && root.local === 'sst', 'shared-strings-root');
      for (const c of elements(root)) { if (c.ns === S && c.local === 'si') strings.push({ ...stringValue(c, p), part: p, locator: locator(c) }); else gap('shared-strings-content-not-projected', p, c.local); }
      gap('shared-string-table-not-emitted-in-full', p);
    }
    const sheets = one(wb, 'sheets', S, true), ids = new Set(), names = new Set(), sheetParts = new Set();
    for (const sheet of elements(sheets)) {
      need(sheet.ns === S && sheet.local === 'sheet', 'sheet-declaration');
      const id = attr(sheet, 'sheetId'), name = attr(sheet, 'name'), r = relations.get(attr(sheet, 'id', REL)), state = attr(sheet, 'state') ?? 'visible';
      decimal(id, 0xffffffff, 1); need(name && !names.has(name.toLowerCase()) && !ids.has(id) && ['visible', 'hidden', 'veryHidden'].includes(state) && r && r.part, 'sheet-identity'); ids.add(id); names.add(name.toLowerCase());
      need(!sheetParts.has(r.part), 'duplicate-sheet-part'); sheetParts.add(r.part);
      if (r.type !== `${REL}/worksheet` || typeOf(r.part) !== 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml') { gap('sheet-kind-not-projected', r.part); result.sheets.push({ id, name, state, part: r.part, data: 'not-read' }); continue; }
      const root = xml(r.part, 'worksheet-cell-data'); need(root.ns === S && root.local === 'worksheet', 'worksheet-root');
      const cols = one(root, 'cols'), merges = one(root, 'mergeCells'), data = one(root, 'sheetData', S, true);
      const info = { id, name, state, part: r.part, data: 'explicit-cell-coordinates', columns: [], merges: [], rows: [] }; result.sheets.push(info);
      if (cols) for (const c of elements(cols)) { need(c.ns === S && c.local === 'col', 'column'); const min = decimal(attr(c, 'min'), 16384, 1), max = decimal(attr(c, 'max'), 16384, 1); need(min <= max, 'column-range'); if (info.columns.some(x => x.min <= max && x.max >= min)) gap('overlapping-column-declarations', r.part); info.columns.push({ min, max, hidden: attr(c, 'hidden') === null ? false : bool(attr(c, 'hidden')), style: attr(c, 'style'), locator: locator(c) }); }
      if (merges) for (const c of elements(merges)) { need(c.ns === S && c.local === 'mergeCell', 'merge-cell'); info.merges.push(cellRange(attr(c, 'ref'))); }
      const cells = new Set(), rows = new Set(), sharedFormulas = new Map(), references = [];
      for (const row of elements(data)) {
        need(row.ns === S && row.local === 'row', 'sheet-row'); const number = decimal(attr(row, 'r'), 1048576, 1); need(!rows.has(number), 'duplicate-row'); rows.add(number);
        const hidden = attr(row, 'hidden') === null ? false : bool(attr(row, 'hidden')); info.rows.push({ row: number, hidden, style: attr(row, 's'), locator: locator(row) });
        for (const cell of elements(row)) {
          need(cell.ns === S && cell.local === 'c', 'sheet-cell'); const coordinate = attr(cell, 'r'), position = cellPosition(coordinate); need(position.row === number && !cells.has(coordinate), 'duplicate-or-misplaced-cell'); cells.add(coordinate);
          const f = one(cell, 'f'), v = one(cell, 'v'), inline = one(cell, 'is'), t = attr(cell, 't') ?? 'n';
          need(['n', 's', 'str', 'inlineStr', 'b', 'e', 'd'].includes(t) && (!v || elements(v).length === 0) && (!f || elements(f).length === 0), 'cell-type-unsupported');
          need(!(inline && (t !== 'inlineStr' || v || f)) && !(t === 'inlineStr' && !inline), 'inline-string-shape');
          const raw = v ? textData(v) : null; let value = raw;
          if (raw === '' && !['str', 'inlineStr'].includes(t)) value = null;
          if (t === 's' && raw !== null && raw !== '') value = strings[decimal(raw, strings.length - 1)];
          else if (t === 'inlineStr') value = stringValue(inline, r.part);
          else if (t === 'str' && raw !== null) value = spreadsheetString(raw);
          else if (t === 'b' && raw !== null && raw !== '') value = bool(raw);
          else if (t === 'n' && raw !== null && raw !== '') need(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw), 'numeric-token');
          const formula = f ? { text: textData(f), type: attr(f, 't') ?? 'normal', sharedIndex: attr(f, 'si'), range: attr(f, 'ref'), attributes: f.attrs, evaluation: 'not-performed', cache: 'stored-historical-value-not-recalculated' } : null;
          if (formula) {
            need(['normal', 'shared', 'array', 'dataTable'].includes(formula.type), 'formula-kind'); if (formula.range !== null) cellRange(formula.range);
            if (formula.type === 'shared') { const si = decimal(formula.sharedIndex, 0xffffffff); references.push({ si, coordinate, formula }); if (formula.text) { need(!sharedFormulas.has(si), 'shared-formula-duplicate'); sharedFormulas.set(si, coordinate); } }
            if (formula.type !== 'normal') gap('formula-not-expanded-or-evaluated', r.part, formula.type);
          }
          for (const c of elements(cell)) if (c.ns !== S || !['f', 'v', 'is'].includes(c.local)) gap('cell-content-not-projected', r.part, c.local);
          unit({ kind: 'sheet-cell', part: r.part, locator: locator(cell), sheet: name, coordinate, sheetState: state, rowHidden: hidden, columnDeclarations: info.columns.filter(c => c.min <= position.column && c.max >= position.column).map(c => c.locator.element), type: t, style: attr(cell, 's'), rawValue: raw, value, valuePresence: raw === null ? (inline ? 'inline' : 'absent') : raw === '' ? 'empty' : 'present', formula, valueMeaning: formula ? 'historical-formula-cache' : 'stored-cell-data', display: 'not-formatted' });
        }
      }
      for (const ref of references) { ref.formula.sharedBase = sharedFormulas.get(ref.si) ?? null; if (!ref.formula.sharedBase) gap('shared-formula-base-missing', r.part, ref.coordinate); }
      for (const c of elements(root)) if (c.ns !== S || !['sheetData', 'cols', 'mergeCells', 'dimension', 'sheetFormatPr', 'sheetViews'].includes(c.local)) gap('worksheet-content-not-projected', r.part, c.local);
    }
    result.limitations.push('explicit-row-and-cell-addresses-required', 'numbers-preserve-raw-tokens-dates-and-styles-not-interpreted', 'no-filter-visibility-or-formula-recalculation', 'overlapping-merged-ranges-not-validated');
  }
  for (const [part, content] of files) {
    const role = roles.get(part) ?? 'not-projected'; result.parts.push({ part, bytes: content.length, contentType: part === '[Content_Types].xml' ? null : typeOf(part), role });
    if (role === 'not-projected') gap('part-not-projected', part);
  }
  result.package.xmlNodes = budget.nodes;
  need(Buffer.byteLength(JSON.stringify(result)) <= OFFICE_LIMITS.maxProjectionBytes, 'projection-limit'); return result;
}
