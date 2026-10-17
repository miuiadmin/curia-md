/** Synthetic packages and disposable repositories only; no Office runtime, network or source writes. */
import { deflateRawSync } from 'node:zlib';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, isMainModule } from './doc-lib.mjs';
import { crc32, readZipData, parseDataXML, textData } from './curia-package-data.mjs';
import { extractOfficeData } from './curia-office.mjs';
import { extractSources, parseExtractionArgs, extractorCodeIdentity } from './curia-extract.mjs';
export function officeZip(parts, options = {}) {
  const local = [], central = []; let offset = 0;
  for (const [name, data] of parts) {
    const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data), n = Buffer.from(name), method = options.stored || name.endsWith('/') ? 0 : 8;
    const compressed = method === 8 ? deflateRawSync(bytes) : bytes, crc = crc32(bytes), flags = 0x800 | (options.descriptor ? 8 : 0);
    const l = Buffer.alloc(30); l.writeUInt32LE(0x04034b50); l.writeUInt16LE(20, 4); l.writeUInt16LE(flags, 6); l.writeUInt16LE(method, 8); l.writeUInt16LE(n.length, 26);
    if (!options.descriptor) { l.writeUInt32LE(crc, 14); l.writeUInt32LE(compressed.length, 18); l.writeUInt32LE(bytes.length, 22); }
    const descriptor = options.descriptor ? Buffer.alloc(options.descriptor === 'unsigned' ? 12 : 16) : Buffer.alloc(0);
    if (descriptor.length) { const start = descriptor.length - 12; if (start) descriptor.writeUInt32LE(0x08074b50); descriptor.writeUInt32LE(crc, start); descriptor.writeUInt32LE(compressed.length, start + 4); descriptor.writeUInt32LE(bytes.length, start + 8); }
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(flags, 8); c.writeUInt16LE(method, 10); c.writeUInt32LE(crc, 16); c.writeUInt32LE(compressed.length, 20); c.writeUInt32LE(bytes.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(offset, 42);
    local.push(l, n, compressed, descriptor); central.push(c, n); offset += l.length + n.length + compressed.length + descriptor.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(parts.length, 8); end.writeUInt16LE(parts.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cd, end]);
}
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main', S = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main', REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const rels = entries => `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${entries.map(([id, type, target, external]) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"${external ? ' TargetMode="External"' : ''}/>`).join('')}</Relationships>`;
const types = entries => `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${entries.map(([part, type]) => `<Override PartName="/${part}" ContentType="application/vnd.openxmlformats-officedocument.${type}+xml"/>`).join('')}</Types>`;
export function officeWordParts() {
  return [
    ['[Content_Types].xml', types([['stories/main.xml', 'wordprocessingml.document.main'], ['stories/head.xml', 'wordprocessingml.header'], ['stories/comments.xml', 'wordprocessingml.comments']])],
    ['_rels/.rels', rels([['r0', 'officeDocument', 'stories/main.xml']])],
    ['stories/_rels/main.xml.rels', rels([['r1', 'header', 'head.xml'], ['r2', 'comments', 'comments.xml'], ['r3', 'hyperlink', 'https://invalid.example/NEVER', true]])],
    ['stories/main.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><z:document xmlns:z="${W}"><z:body><z:p><z:r><z:t xml:space="preserve"> A &amp; B </z:t></z:r><z:del z:id="2"><z:r><z:delText>deleted</z:delText></z:r></z:del><z:ins z:id="3"><z:r><z:t>inserted</z:t></z:r></z:ins><z:r><z:rPr><z:vanish/></z:rPr><z:t>hidden</z:t></z:r><z:r><z:fldChar z:fldCharType="begin"/><z:instrText>DATE</z:instrText><z:fldChar z:fldCharType="separate"/><z:t>old date</z:t><z:fldChar z:fldCharType="end"/></z:r></z:p><z:tbl><z:tr><z:tc><z:p><z:r><z:t>table</z:t></z:r></z:p></z:tc></z:tr></z:tbl></z:body></z:document>`],
    ['stories/head.xml', `<w:hdr xmlns:w="${W}"><w:p><w:r><w:t>HEADER</w:t></w:r></w:p></w:hdr>`],
    ['stories/comments.xml', `<w:comments xmlns:w="${W}"><w:comment w:id="7"><w:p><w:r><w:t>COMMENT</w:t></w:r></w:p></w:comment></w:comments>`],
  ];
}
export function officeSheetParts() {
  return [
    ['[Content_Types].xml', types([['books/main.xml', 'spreadsheetml.sheet.main'], ['books/data.xml', 'spreadsheetml.worksheet'], ['books/strings.xml', 'spreadsheetml.sharedStrings']])],
    ['_rels/.rels', rels([['r0', 'officeDocument', 'books/main.xml']])],
    ['books/_rels/main.xml.rels', rels([['r1', 'worksheet', 'data.xml'], ['r2', 'sharedStrings', 'strings.xml']])],
    ['books/main.xml', `<workbook xmlns="${S}" xmlns:r="${REL}"><workbookPr date1904="1"/><sheets><sheet name="Sheet 1" sheetId="1" r:id="r1" state="veryHidden"/></sheets><calcPr calcMode="manual"/></workbook>`],
    ['books/strings.xml', `<sst xmlns="${S}"><si><r><t>rich</t></r><r><t> text</t></r><rPh sb="0" eb="1"><t>NOT_DUPLICATED</t></rPh></si><si><t>_x005F_x0041_</t></si></sst>`],
    ['books/data.xml', `<worksheet xmlns="${S}"><cols><col min="2" max="2" hidden="1"/></cols><sheetData><row r="1" hidden="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>9007199254740993</v></c><c r="C1"><f>1+1</f><v>99</v></c><c r="D1" t="inlineStr"><is><t>_x005F_x0041_</t></is></c><c r="E1" t="b"><v>1</v></c><c r="F1" s="3"><v>45000</v></c><c r="G1"><f t="shared" si="0" ref="G1:H1">A1</f><v>1</v></c><c r="H1"><f t="shared" si="0"/><v>2</v></c></row></sheetData><mergeCells><mergeCell ref="A2:B2"/></mergeCells></worksheet>`],
  ];
}
export function officeFixtures({ expectTrue, registry }) {
  const assert = (name, ok, detail = '') => expectTrue(`Curia Office [${name}]`, !!ok, detail);
  const rejects = (name, fn, code = 'office/') => { let caught; try { fn(); } catch (e) { caught = e; } assert(name, caught && (caught.code ?? caught.message).includes(code), caught?.message ?? 'not rejected'); };
  const xml = s => parseDataXML(Buffer.from(s));
  const doc = officeZip(officeWordParts()), sheet = officeZip(officeSheetParts());
  assert('crc-known-vector', crc32(Buffer.from('123456789')) === 0xcbf43926);
  for (const opts of [{}, { stored: true }, { descriptor: true }, { descriptor: 'unsigned' }]) {
    const zip = readZipData(officeZip([['a.xml', 'sample 中文']], opts)); assert(`zip-method-${JSON.stringify(opts)}`, zip.files.get('a.xml').toString() === 'sample 中文');
    assert(`word-package-${JSON.stringify(opts)}`, extractOfficeData(officeZip(officeWordParts(), opts)).format === 'docx');
  }
  assert('directory-entry', readZipData(officeZip([['a/', ''], ['a/b.xml', '<a/>']])).files.size === 1);
  for (const name of ['../escape', '/root', 'a\\b', 'a//b', 'a/./b', 'a/%2e', 'a:stream', 'a?x', 'a#x', 'a\u0000b', 'e\u0301.xml']) rejects(`zip-path-${JSON.stringify(name)}`, () => readZipData(officeZip([[name, 'x']])));
  for (const pair of [['a', 'a'], ['A.xml', 'a.xml'], ['dir/', 'DIR']]) rejects(`zip-alias-${pair}`, () => readZipData(officeZip(pair.map(p => [p, '']))));
  const mutateZip = (name, mutate) => { const b = officeZip([['a.xml', '<a/>']], { stored: true }); const cd = b.readUInt32LE(b.length - 6); mutate(b, cd); rejects(name, () => readZipData(b)); };
  mutateZip('encrypted', (b, c) => { b.writeUInt16LE(0x801, 6); b.writeUInt16LE(0x801, c + 8); });
  mutateZip('zip64-version', (b, c) => { b.writeUInt16LE(45, 4); b.writeUInt16LE(45, c + 6); });
  mutateZip('symlink', (b, c) => b.writeUInt32LE(0xa0000000, c + 38));
  mutateZip('header-name-disagreement', b => b[30] = 98);
  mutateZip('header-crc-disagreement', b => b.writeUInt32LE(0, 14));
  mutateZip('payload-crc', b => b[35] = 89);
  mutateZip('expansion-budget', (b, c) => b.writeUInt32LE(5 * 1024 * 1024, c + 24));
  mutateZip('unknown-compression', (b, c) => { b.writeUInt16LE(99, 8); b.writeUInt16LE(99, c + 10); });
  mutateZip('multivolume', b => b.writeUInt16LE(1, b.length - 18));
  mutateZip('central-size', b => b.writeUInt32LE(1, b.length - 10));
  mutateZip('overlap-prefix', (b, c) => b.writeUInt32LE(1, c + 42));
  rejects('bounded-deflate-bomb', () => readZipData(officeZip([['bomb.xml', 'a'.repeat(5 * 1024 * 1024)]])));
  rejects('zip-truncated', () => readZipData(doc.subarray(0, doc.length - 1)));
  rejects('zip-trailing', () => readZipData(Buffer.concat([doc, Buffer.from('x')])));
  const brokenDescriptor = officeZip([['x', 'DATA']], { descriptor: true }); brokenDescriptor[brokenDescriptor.indexOf(Buffer.from([0x50, 0x4b, 7, 8])) + 4] ^= 1;
  rejects('descriptor-invalid', () => readZipData(brokenDescriptor));
  assert('xml-entities-preserved-whitespace', textData(xml('<a> A &lt;&amp;&gt; &#x1f600;\r\n<![CDATA[<literal>]]></a>')) === ' A <&> 😀\n<literal>');
  assert('xml-namespace-prefix-independent', xml('<a xmlns="urn:a" xmlns:x="urn:x" x:id="2"/>').attrs[0].ns === 'urn:x');
  assert('xml-attribute-whitespace', xml('<a x="A\r\nB&#10;C"/>').attrs[0].value === 'A B\nC');
  for (const [name, value] of Object.entries({ dtd: '<!DOCTYPE a><a/>', xxe: '<!DOCTYPE a [<!ENTITY xx SYSTEM "file:///etc/passwd">]><a>&xx;</a>', custom: '<a>&bad;</a>', bareEntity: '<a>&abc</a>', zero: '<a>&#0;</a>', surrogate: '<a>&#xD800;</a>', unclosed: '<a>', mismatch: '<a></b>', duplicate: '<a x="1" x="2"/>', unbound: '<x:a/>', duplicateExpanded: '<a xmlns:x="urn:a" xmlns:y="urn:a" x:b="1" y:b="2"/>', reservedNamespace: '<a xmlns:xml="urn:other"/>', pi: '<a><?read file?></a>', roots: '<a/><b/>', badComment: '<a><!--a--b--></a>', declaration: '<?xml version="1.0" encoding="UTF-16"?><a/>', depth: `${'<a>'.repeat(100)}${'</a>'.repeat(100)}`, cdataOutside: '<![CDATA[a]]><a/>', attrLessThan: '<a v="<"/>', control: '<a>\u0001</a>', bracket: '<a>]]></a>', nonXmlSpace: '<a/>\u00a0', nonXmlEndSpace: '<a></a\u00a0>', doubleXmlns: '<a xmlns:x="urn:a" xmlns:x="urn:b"/>' })) rejects(`xml-${name}`, () => xml(value));
  rejects('xml-invalid-utf8', () => parseDataXML(Buffer.from([60, 97, 62, 255])));
  const word = extractOfficeData(doc), texts = word.units.flatMap(u => u.segments);
  assert('word-story-header-comment', texts.some(s => s.text === 'HEADER') && texts.some(s => s.text === 'COMMENT'));
  assert('word-preserves-space', texts.some(s => s.text === ' A & B '));
  assert('word-revisions-not-current-flattened', texts.find(s => s.text === 'deleted').revisions[0].kind === 'del' && texts.find(s => s.text === 'inserted').revisions[0].kind === 'ins');
  assert('word-hidden', texts.find(s => s.text === 'hidden').inlineHidden === true);
  const hiddenOff = extractOfficeData(officeZip(officeWordParts().map(([p, v]) => [p, v.replace('<z:vanish/>', '<z:vanish z:val="off"/>')])));
  assert('word-off-lexical', hiddenOff.units.flatMap(u => u.segments).find(s => s.text === 'hidden').inlineHidden === false);
  const deletedSimple = extractOfficeData(officeZip(officeWordParts().map(([p,v])=>[p,v.replace('<z:delText>deleted</z:delText>', '<z:fldSimple z:instr="DO_NOT_EXECUTE"><z:r><z:t>stored</z:t></z:r></z:fldSimple>')])));
  assert('simple-field-instruction-keeps-deletion', deletedSimple.units.flatMap(u=>u.segments).find(s=>s.text==='DO_NOT_EXECUTE').revisions[0].kind==='del');
  assert('word-field-instruction-versus-cache', texts.find(s => s.text === 'DATE').kind === 'field-instruction' && texts.find(s => s.text === 'old date').fieldResult === 'stored-result-not-evaluated');
  assert('word-table-locator', word.units.find(u => u.segments.some(s => s.text === 'table')).context.map(c => c.kind).join(',') === 'tbl,tr,tc');
  assert('external-not-visited', word.gaps.some(g => g.code === 'external-target-not-visited'));
  assert('not-visual-or-verified', word.coverage.visual === 'not-read' && word.coverage.semantics === 'not-verified');
  const workbook = extractOfficeData(sheet), cell = address => workbook.units.find(c => c.coordinate === address);
  assert('rich-string-no-phonetic-duplication', cell('A1').value.text === 'rich text');
  assert('numeric-token-lossless', cell('B1').value === '9007199254740993');
  assert('formula-not-recalculated', cell('C1').value === '99' && cell('C1').formula.text === '1+1' && cell('C1').valueMeaning === 'historical-formula-cache');
  assert('escape-single-pass', cell('D1').value.text === '_x0041_');
  assert('visibility-and-epoch', cell('A1').sheetState === 'veryHidden' && cell('A1').rowHidden && workbook.workbook.date1904 && cell('B1').columnDeclarations.length === 1);
  assert('no-date-guess', cell('F1').value === '45000' && cell('F1').style === '3');
  assert('shared-formula-binding-not-expansion', cell('H1').formula.text === '' && cell('H1').formula.sharedBase === 'G1');
  assert('merged-declaration', workbook.sheets[0].merges[0] === 'A2:B2');
  const noCache = extractOfficeData(officeZip(officeSheetParts().map(([p, v]) => [p, v.replace('<v>99</v>', '<v/>')])));
  assert('empty-formula-cache-is-not-zero', noCache.units.find(c => c.coordinate === 'C1').value === null && noCache.units.find(c => c.coordinate === 'C1').valuePresence === 'empty');
  const changed = (parts, part, fn) => parts.map(([p, v]) => [p, p === part ? fn(v) : v]);
  for (const [name, from, to] of [['duplicate-cell', 'r="B1"', 'r="A1"'], ['out-of-range', 'r="B1"', 'r="XFE1"'], ['wrong-row', 'r="B1"', 'r="B2"'], ['implicit-address', ' r="B1"', ''], ['shared-string-range', '<v>0</v>', '<v>99</v>'], ['number-invalid', '9007199254740993', 'NaN'], ['boolean-invalid', '<v>1</v>', '<v>bad</v>']]) rejects(`sheet-${name}`, () => extractOfficeData(officeZip(changed(officeSheetParts(), 'books/data.xml', s => s.replace(from, to)))));
  rejects('unknown-main-type', () => extractOfficeData(officeZip(changed(officeWordParts(), '[Content_Types].xml', s => s.replace('document.main+xml', 'template.main+xml')))));
  rejects('missing-part', () => extractOfficeData(officeZip(officeWordParts().filter(([p]) => p !== 'stories/head.xml'))));
  rejects('relationship-escape', () => extractOfficeData(officeZip(changed(officeWordParts(), '_rels/.rels', s => s.replace('stories/main.xml', '../outside.xml')))));
  const alternate = extractOfficeData(officeZip(changed(officeWordParts(), 'stories/main.xml', s => s.replace('<z:body>', '<z:body><mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice Requires="z"><z:p><z:r><z:t>NO_DOUBLE_READ</z:t></z:r></z:p></mc:Choice></mc:AlternateContent>'))));
  assert('alternate-content-not-double-flattened', !JSON.stringify(alternate.units).includes('NO_DOUBLE_READ') && alternate.gaps.some(g => g.code.includes('compatibility')));
  for (const args of [[], ['--path', 'x'], ['--parser', 'ooxml-data/1', '--path', 'x', '--json', '--json'], ['--list-parsers', '--path', 'x'], ['--list-parsers', '--execute'], ['--parser', 'ooxml-data/1', '--path', 'x', '--max-files', '99']]) rejects(`options-${args}`, () => parseExtractionArgs(args), 'extract/options-invalid');
  assert('tool-closure-observed', extractorCodeIdentity().length === 13);
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'curia-office-'))), env = { ...process.env }; delete env.CURIA_STAGED; delete env.CURIA_STAGED;
  const git = (...args) => execFileSync('git', args, { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] });
  const put = (path, value) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), value); };
  const cli = fileURLToPath(new URL('./curia-workflow.mjs', import.meta.url));
  const options = { parser: 'ooxml-data/1', paths: ['docs/manual.docx', 'docs/sheet.xlsx'], nonSensitive: true };
  try {
    git('init', '-q'); const config = structuredClone(registry); delete config.instance;
    put('.agents/doc-types.json', JSON.stringify(config)); put('docs/manual.docx', doc); put('docs/sheet.xlsx', sheet);
    git('add', '--', '.agents/doc-types.json', 'docs/manual.docx', 'docs/sheet.xlsx'); git('-c', 'user.name=fixture', '-c', 'user.email=fixture@local', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'Office fixture');
    const initialIndex = git('ls-files', '--stage').toString(), read = extra => extractSources(root, { ...options, ...extra });
    let result = read(); assert('authorized-two-file-projection', result.exitCode === 0 && result.documents.every(d => d.state === 'data-projected'), JSON.stringify(result).slice(0, 800));
    assert('different-original-and-projection-digest', result.documents[0].sourceRef.revision.endsWith(result.documents[0].projectionDigest.value) === false);
    assert('actual-two-read-budget', result.observation.first.chargedBytes === doc.length + sheet.length && result.observation.postcheck.chargedBytes === doc.length + sheet.length);
    assert('no-default-persistence', !existsSync(join(root, '.agents/records')));
    assert('adapter-explicit-effects-privacy-and-limits', result.adapter.effects.network==='not-invoked' && result.adapter.privacy.protectedDelivery==='unsupported' && result.adapter.limits.package.maxEntries===512);
    result = read({ nonSensitive: false }); assert('privacy-before-reading', result.documents.every(d => !d.projection && !d.sourceRef) && result.observation.first === null);
    result = extractSources('/missing/DO_NOT_PROBE', { ...options, protected: true }); assert('protected-no-probe', result.unresolved.includes('protected-delivery-not-supported') && result.observation.first === null);
    result = read({ exclusions: ['docs/sheet.xlsx'] }); assert('excluded-peer-blocks-all', result.documents.every(d => !d.projection) && result.observation.first === null);
    put('docs/new.docx', doc); assert('untracked-opt-in', read({ paths: ['docs/new.docx'], includeUntracked: true }).exitCode === 0 && read({ paths: ['docs/new.docx'] }).exitCode === 2);
    put('.gitignore', 'docs/new.docx\n'); assert('ignored-no-bypass', read({ paths: ['docs/new.docx'], includeUntracked: true }).exitCode === 2); rmSync(join(root, '.gitignore'));
    symlinkSync('manual.docx', join(root, 'docs/linked.docx')); assert('symlink-refused', read({ paths: ['docs/linked.docx'], includeUntracked: true }).exitCode === 2);
    put('docs/bad.pdf', '%PDF-UNKNOWN'); result = read({ paths: ['docs/bad.pdf'], includeUntracked: true }); assert('unsupported-no-text-fallback', result.exitCode === 2 && !result.documents[0].projection);
    const Native = globalThis.TextDecoder; let mutated = false;
    globalThis.TextDecoder = class extends Native { decode(input, ...rest) { const s = super.decode(input, ...rest); if (!mutated && s.includes('inserted')) { mutated = true; put('docs/manual.docx', officeZip(officeWordParts(), { stored: true })); } return s; } };
    try { result = read(); } finally { globalThis.TextDecoder = Native; put('docs/manual.docx', doc); }
    assert('postcheck-withdraws-whole-group', mutated && result.exitCode === 2 && result.documents.every(d => d.projection === null && d.sourceRef === null) && result.tool === null);
    const args = ['extract', '--root', root, '--parser', 'ooxml-data/1', '--path', 'docs/manual.docx', '--non-sensitive', '--json'];
    const invoke = tail => spawnSync(process.execPath, [cli, ...args, ...tail], { env, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
    const normal = invoke([]), strict = invoke(['--strict']); assert('workflow-dynamic-route', normal.status === 0 && JSON.parse(normal.stdout).documents[0].projection.format === 'docx'); assert('strict-not-full-reading', strict.status === 1);
    assert('fixture-index-not-changed', git('ls-files', '--stage').toString() === initialIndex);
  } finally { rmSync(root, { recursive: true, force: true }); }
}
if (isMainModule(import.meta.url)) {
  let passed = 0; const failed = []; officeFixtures({ registry: JSON.parse(readFileSync(join(ROOT, '.agents/doc-types.json'), 'utf8')), expectTrue: (name, ok, detail) => ok ? passed++ : failed.push({ name, detail }) });
  console.log(JSON.stringify({ passed, failed }, null, 2)); if (failed.length) process.exitCode = 1;
}
