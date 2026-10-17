#!/usr/bin/env node
/** Explicit Office extraction: one authorization, bounded complete bytes, whole-set postcheck. */
import { createHash } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, isMainModule } from './doc-lib.mjs';
import { prepareSourceSelection, readSourceSelection, digestSourceSubset, readStableFile, normalizeReadSelection } from './curia-query.mjs';
import { extractOfficeData, OFFICE_PARSER, OFFICE_LIMITS } from './curia-office.mjs';
import { PACKAGE_LIMITS } from './curia-package-data.mjs';
export const EXTRACTION_LIMITS = Object.freeze({ maxFiles: 4, maxFileBytes: 4 * 1024 * 1024, maxTotalBytes: 16 * 1024 * 1024 });
export const EXTRACTION_ADAPTER = Object.freeze({ parser: OFFICE_PARSER, formats: ['docx', 'xlsx'], effects: { source: 'read-only-explicit-local-files', metadata: 'read-only-git-registry-and-os-mount-table', network: 'not-invoked', sourceCommands: 'not-executed', contentWrites: 'none', persistence: 'none' }, privacy: { mode: 'local-single-reader-explicit-non-sensitive-package', authority: 'caller-responsible-not-secret-detection', protectedDelivery: 'unsupported' }, limits: { source: EXTRACTION_LIMITS, package: PACKAGE_LIMITS, projection: OFFICE_LIMITS }, assurance: 'supported-data-subset-not-rendering-or-verification' });
export const EXTRACTOR_FILES = Object.freeze(['curia-extract.mjs', 'curia-office.mjs', 'curia-package-data.mjs', 'curia-query.mjs', 'curia-dependencies.mjs', 'curia-impact.mjs', 'curia-relations.mjs', 'curia-instance.mjs', 'curia-json.mjs', 'curia-originals.mjs', 'curia-applicability.mjs', 'curia-guard-contract.mjs', 'doc-lib.mjs']);
const plain = value => value && typeof value === 'object' && !Array.isArray(value) && [null, Object.prototype].includes(Object.getPrototypeOf(value)) && !Object.getOwnPropertySymbols(value).length;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const invalid = () => { throw new Error('抽取需要显式非敏感原件范围与受支持 parser [extract/options-invalid]'); };
export function normalizeExtractionOptions(input) {
  if (!plain(input) || Object.keys(input).some(k => !['paths', 'exclusions', 'includeUntracked', 'nonSensitive', 'protected', 'parser'].includes(k)) || input.parser !== OFFICE_PARSER) invalid();
  for (const k of ['includeUntracked', 'nonSensitive', 'protected']) if (input[k] !== undefined && typeof input[k] !== 'boolean') invalid();
  const selection = normalizeReadSelection({ paths: input.paths, exclusions: input.exclusions ?? [] });
  if (selection.paths.length > EXTRACTION_LIMITS.maxFiles || selection.paths.some(p => /[%#]/u.test(p))) invalid();
  return { ...structuredClone(input), ...selection };
}
export function extractorCodeIdentity() {
  const dir = dirname(fileURLToPath(import.meta.url));
  return EXTRACTOR_FILES.map(file => {
    const path = join(dir, file), stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || realpathSync(path) !== path || stat.size >= 1024 * 1024) throw new Error('抽取实现身份不可确认 [extract/code-identity]');
    const bytes = readStableFile(path, stat, 1024 * 1024 - 1), after = lstatSync(path);
    if (bytes.length !== stat.size || ['dev', 'ino', 'mode', 'nlink', 'size', 'mtimeMs', 'ctimeMs'].some(k => stat[k] !== after[k])) throw new Error('抽取实现变化 [extract/code-identity]');
    return { file, digest: { algorithm: 'sha256', canonicalization: 'raw-bytes/1', value: hash(bytes) } };
  });
}
export function extractSources(root = ROOT, input = {}) {
  const options = normalizeExtractionOptions(input);
  const report = { schema: 'curia.extraction/1', parser: options.parser, adapter: structuredClone(EXTRACTION_ADAPTER), evaluatedAt: new Date().toISOString(), completedAt: null, output: 'ephemeral-stdout', persisted: false, outcome: 'unavailable', exitCode: 2, source: null, tool: null, observation: { first: null, postcheck: null }, documents: options.paths.map(path => ({ path, state: 'not-read', sourceRef: null, projectionDigest: null, projection: null, gaps: [] })), unresolved: [], limitations: ['non-atomic-local-worktree-with-postcheck', 'caller-declares-entire-package-and-metadata-non-sensitive', 'not-an-os-sandbox-or-cpu-time-limit', 'no-rendering-or-fact-verification', 'no-network-project-commands-or-records', 'observed-code-files-not-attested-loaded-bytes', 'unsupported-formats-do-not-fallback-to-text', 'recipient-truncation-is-not-observable'] };
  const finish = () => { report.completedAt = new Date().toISOString(); return report; };
  const withdraw = reason => { report.source = report.tool = null; for (const d of report.documents) { d.state = 'not-read'; d.sourceRef = d.projectionDigest = d.projection = null; d.gaps = [reason]; } report.unresolved.push(reason); report.outcome = 'unavailable'; report.exitCode = 2; };
  const stats = obs => ({ stable: obs.stable, chargedBytes: obs.chargedBytes, openedFiles: obs.openedFiles, limits: obs.limits });
  if (options.protected) { withdraw('protected-delivery-not-supported'); return finish(); }
  try {
    const selected = prepareSourceSelection(root, { paths: options.paths, exclusions: options.exclusions, nonSensitive: options.nonSensitive ?? false, includeUntracked: options.includeUntracked ?? false });
    if (selected.objects.some(o => o.reason)) { for (const d of report.documents) d.gaps.push(selected.objects.find(o => o.path === d.path)?.reason ?? 'scope-blocked'); report.unresolved.push('scope-blocked'); return finish(); }
    const identity = extractorCodeIdentity(), first = readSourceSelection(selected, EXTRACTION_LIMITS); report.observation.first = stats(first);
    if (!first.stable) { withdraw('source-read-unavailable'); return finish(); }
    let projectedBytes = 0;
    for (const d of report.documents) {
      const observed = first.documents.find(x => x.path === d.path);
      d.sourceRef = { uri: `repo:${d.path}`, revision: `sha256:raw-bytes/1:${observed.digest.value}`, observedAt: observed.observedAt, locator: { kind: 'whole-file/1' }, git: observed.git };
      try {
        const projection = extractOfficeData(observed.bytes), serialized = JSON.stringify(projection);
        projectedBytes += Buffer.byteLength(serialized);
        if (projectedBytes > OFFICE_LIMITS.maxProjectionBytes) { withdraw('group-projection-limit'); break; }
        d.projection = projection; d.state = 'data-projected';
        d.projectionDigest = { algorithm: 'sha256', canonicalization: 'json-stringify-utf8/1', value: hash(Buffer.from(serialized)), role: 'derived-data-not-original-or-authority' };
        d.gaps = ['supported-data-subset-not-complete-document', ...new Set(projection.gaps.map(x => x.code))];
      } catch (error) { d.state = 'unsupported-or-invalid'; d.gaps.push(error.code?.startsWith('office/') ? error.code : 'office/parser-unavailable'); }
    }
    const post = digestSourceSubset(selected, options.paths, EXTRACTION_LIMITS); report.observation.postcheck = stats(post);
    if (!post.stable || JSON.stringify(identity) !== JSON.stringify(extractorCodeIdentity()) || first.documents.some(a => !post.documents.some(b => a.path === b.path && a.digest.value === b.digest?.value && a.size === b.size))) { withdraw('source-or-code-changed'); return finish(); }
    if (report.unresolved.includes('group-projection-limit')) return finish();
    report.source = first.source; report.tool = { parser: OFFICE_PARSER, runtime: process.version, platform: process.platform, codeIdentity: identity, identity: 'local-self-reported-not-authenticated' };
    const projected = report.documents.filter(d => d.state === 'data-projected').length;
    report.outcome = projected ? 'partial-data-projection' : 'unavailable'; report.exitCode = projected === report.documents.length ? 0 : 2;
    report.unresolved = [...new Set(report.documents.flatMap(d => d.gaps))];
  } catch { withdraw('selection-source-or-tool-unavailable'); }
  return finish();
}
export function parseExtractionArgs(argv) {
  const options = { paths: [], exclusions: [] }, flags = { json: false, strict: false, help: false, list: false }; const seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i]; if (!['--path', '--exclude'].includes(key)) { if (seen.has(key)) invalid(); seen.add(key); }
    if (['--path', '--exclude', '--root', '--parser'].includes(key)) {
      const value = argv[++i]; if (!value || value.startsWith('--')) invalid();
      if (key === '--path') options.paths.push(value); else if (key === '--exclude') options.exclusions.push(value); else if (key === '--root') flags.root = value; else options.parser = value;
    } else if (['--non-sensitive', '--all', '--protected'].includes(key)) options[{ '--non-sensitive': 'nonSensitive', '--all': 'includeUntracked', '--protected': 'protected' }[key]] = true;
    else if (['--json', '--strict', '--help', '--list-parsers'].includes(key)) flags[{ '--json': 'json', '--strict': 'strict', '--help': 'help', '--list-parsers': 'list' }[key]] = true;
    else invalid();
  }
  if (flags.help || flags.list) { if (options.paths.length || options.exclusions.length || options.parser || options.nonSensitive || options.includeUntracked || options.protected || flags.root || flags.strict || (flags.help && flags.list)) invalid(); }
  else normalizeExtractionOptions(options);
  return { options, flags };
}
export function extractionMain(argv = process.argv.slice(2)) {
  try {
    const { options, flags } = parseExtractionArgs(argv);
    if (flags.help) { console.log('node scripts/curia-workflow.mjs extract --parser ooxml-data/1 --path docs/manual.docx --non-sensitive --json\n仅显式 DOCX／XLSX 数据投影；不渲染、重算、联网、落 Run 或覆盖原件。整个包与路径须非敏感。\n每批最多 4 个原件、单件小于 4 MiB、投影合计不超过 8 MiB；UTF-8 transitional OOXML，未知／加密格式拒绝，不降级文本。\n--all 包含未忽略 untracked；--exclude 排除；--root 指定 Git 根；默认退出 0 表示所有选件的数据投影已返回，不代表全文已读。\n--strict 因未覆盖视觉、语义和部分数据而退出 1；参数、读取、格式或稳定性失败退出 2。'); return; }
    if (flags.list) { console.log(JSON.stringify(EXTRACTION_ADAPTER)); return; }
    const report = extractSources(flags.root, options);
    console.log(flags.json ? JSON.stringify(report, null, 2) : `${report.outcome}\n${report.documents.map(d => `${d.state}\t${JSON.stringify(d.path)}\t${d.gaps.join(',')}`).join('\n')}\nUse --json for data; no document was fully rendered or fact-verified.`);
    process.exitCode = report.exitCode || (flags.strict ? 1 : 0);
  } catch { console.error('Office 抽取参数或上下文不可用 [extract/unavailable]'); process.exitCode = 2; }
}
if (isMainModule(import.meta.url)) extractionMain();
