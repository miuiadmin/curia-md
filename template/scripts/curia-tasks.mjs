#!/usr/bin/env node
/** Task-package observation only. No scheduler, project command, mutation, Run or external access. */
import { ROOT, isMainModule } from './doc-lib.mjs';
import { buildTaskInventory, prepareSourceSelection, taskBindingFor, readSourceSubset, revalidateSourceSelection, normalizeReadSelection } from './curia-query.mjs';
import { containsPath } from './curia-instance.mjs';
import { parseDataJson, lookupJsonPointer, compareJsonPointers, JSON_NATIVE_LIMITS } from './curia-json.mjs';
import { parseTimeBoundary } from './curia-applicability.mjs';
import { parseOriginalDigestRevision } from './curia-originals.mjs';

const plain = x => x && typeof x === 'object' && !Array.isArray(x) && [null, Object.prototype].includes(Object.getPrototypeOf(x)) && !Object.getOwnPropertySymbols(x).length;
const text = x => typeof x === 'string' && x.length > 0 && x.length <= 256 && x.trim() === x && !/[\u0000-\u001f\u007f]/u.test(x);
const invalid = () => { throw new Error('任务结果观察需要精确目录、回执、轮次与非敏感声明 [task/options-invalid]'); };
export function normalizeTaskOutcomeOptions(input) {
  if (!plain(input) || Object.keys(input).some(k => !['package', 'receipt', 'invocation', 'exclusions', 'includeUntracked', 'nonSensitive', 'protected', 'maxBytes', 'expectedRevision'].includes(k)) || input.nonSensitive !== true || !text(input.invocation)) invalid();
  for (const key of ['includeUntracked', 'protected']) if (input[key] !== undefined && typeof input[key] !== 'boolean') invalid();
  const paths = [input.package, input.receipt];
  if (paths.some(p => typeof p !== 'string' || /[#%]/u.test(p) || Buffer.byteLength(p) > 4096)) invalid();
  const selection = normalizeReadSelection({ paths, exclusions: input.exclusions ?? [] });
  const maxBytes = input.maxBytes ?? JSON_NATIVE_LIMITS.maxBytes;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > JSON_NATIVE_LIMITS.maxBytes || selection.exclusions.length > 128) invalid();
  const expected = input.expectedRevision === undefined ? null : parseOriginalDigestRevision(input.expectedRevision); if (input.expectedRevision !== undefined && !expected) invalid();
  return { ...input, exclusions: selection.exclusions, maxBytes, expected, includeUntracked: input.includeUntracked ?? false };
}

/** Pure interpretation of one configured receipt or one uniquely identified row in a native ledger. */
export function inspectTaskOutcome(bytes, binding, taskId, invocation) {
  const result = { state: 'incomplete', businessOutcome: 'unknown', evidenceCompleteness: 'unknown', schedulerStatus: null, exitCode: null, recordedAt: null, pointer: null, gaps: [] };
  const gap = code => { if (!result.gaps.includes(code)) result.gaps.push(code); };
  try {
    if (!Buffer.isBuffer(bytes) || bytes.length > JSON_NATIVE_LIMITS.maxBytes || bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) throw Error();
    const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const data = parseDataJson(source);
    const ledger = binding.recordsPointer !== undefined, base = ledger ? binding.recordsPointer : '';
    const found = ledger ? lookupJsonPointer(data, base) : { present: true, value: data };
    if (!found.present || (ledger ? !Array.isArray(found.value) : !plain(found.value))) throw Error();
    const rows = ledger ? found.value : [found.value]; if (rows.length > 1024) throw Error();
    const matches = [];
    for (let i = 0; i < rows.length; i++) {
      if (!plain(rows[i])) throw Error();
      const key = lookupJsonPointer(rows[i], binding.fields.invocation), task = binding.fields.taskId ? lookupJsonPointer(rows[i], binding.fields.taskId) : null;
      if (!key.present || !text(key.value) || (task && (!task.present || !text(task.value)))) throw Error();
      if (key.value === invocation && (!task || task.value === taskId)) matches.push({ row: rows[i], pointer: ledger ? `${base}/${i}` : '' });
    }
    if (matches.length !== 1) { gap(matches.length ? 'task/invocation-ambiguous' : 'task/invocation-not-observed'); return result; }
    const { row, pointer } = matches[0]; result.pointer = pointer;
    const read = key => binding.fields[key] ? lookupJsonPointer(row, binding.fields[key]) : { present: false };
    const outcome = read('outcome'), evidence = read('evidenceComplete'), scheduler = read('schedulerStatus'), exit = read('exitCode'), time = read('observedAt');
    if (!outcome.present || !text(outcome.value) || !Object.hasOwn(binding.outcomes, outcome.value)) gap('task/outcome-unmapped');
    else result.businessOutcome = binding.outcomes[outcome.value];
    if (evidence.present && typeof evidence.value === 'boolean') result.evidenceCompleteness = evidence.value ? 'complete' : 'incomplete';
    if (result.evidenceCompleteness !== 'complete') gap('task/evidence-not-complete');
    if (scheduler.present && scheduler.value !== null) { if (!text(scheduler.value)) gap('task/scheduler-status-invalid'); else result.schedulerStatus = scheduler.value; }
    if (exit.present && exit.value !== null) { if (!Number.isSafeInteger(exit.value) || exit.value < 0 || exit.value > 0xffffffff || compareJsonPointers(source, pointer + binding.fields.exitCode, JSON.stringify(exit.value), '').state !== 'equal') gap('task/exit-code-invalid'); else result.exitCode = exit.value; }
    if (time.present && time.value !== null) { if (!['date', 'instant'].includes(parseTimeBoundary(time.value).kind)) gap('task/recorded-time-invalid'); else result.recordedAt = time.value; }
    if (['completed', 'empty'].includes(result.businessOutcome) && result.exitCode !== null && result.exitCode !== 0) gap('task/completion-exit-conflict');
    if (!result.gaps.length) result.state = result.businessOutcome;
  } catch { result.state = 'incomplete'; result.businessOutcome = 'unknown'; result.evidenceCompleteness = 'unknown'; result.schedulerStatus = result.exitCode = result.recordedAt = result.pointer = null; result.gaps = ['task/receipt-unparsed']; }
  return result;
}

export function observeTaskOutcome(root = ROOT, input) {
  const options = normalizeTaskOutcomeOptions(input);
  const report = { schema: 'curia.task-outcome-observation/1', state: 'incomplete', exitCode: 2, task: null, invocation: options.invocation, result: null, sourceRef: null, gaps: [], observation: { stable: false, openedFiles: 0, chargedBytes: 0, source: null }, execution: { persisted: false, effects: ['bounded-local-read'], scheduler: 'not-invoked', projectCommands: 'not-invoked' }, assurance: { basis: 'configured-native-receipt-not-independent-effect-verification', authentication: 'not-performed', history: 'not-reconstructed', schedulerSuccessIsBusinessCompletion: false, missingInvocationIsEmpty: false, phaseMessageIsReceipt: false } };
  if (options.protected) { report.gaps = ['task/protected-verification-unavailable']; report.execution.effects = []; return report; }
  const selection = prepareSourceSelection(root, { paths: [options.receipt], exclusions: options.exclusions, includeUntracked: options.includeUntracked, nonSensitive: true });
  if (selection.objects.some(item => item.reason)) { report.gaps = ['task/receipt-withheld-or-unavailable']; return report; }
  const profile = taskBindingFor(selection, options.package);
  if (!profile || !containsPath(profile.outcomeAuthority, options.receipt)) { report.gaps = ['task/receipt-not-authorized-by-profile']; return report; }
  const read = readSourceSubset(selection, [options.receipt], { maxFiles: 1, maxFileBytes: options.maxBytes, maxTotalBytes: options.maxBytes });
  report.observation.openedFiles = read.openedFiles; report.observation.chargedBytes = read.chargedBytes;
  if (!read.stable || read.documents[0]?.state !== 'read') { report.gaps = ['task/receipt-unavailable']; return report; }
  const doc = read.documents[0];
  const parsed = inspectTaskOutcome(doc.bytes, profile.outcomeAuthority, profile.id, options.invocation);
  if (!revalidateSourceSelection(selection)) { report.gaps = ['task/snapshot-changed']; return report; }
  report.observation.source = read.source; report.observation.stable = true;
  report.task = { id: profile.id, boundary: profile.boundary, owner: profile.owner, invocationRef: profile.invocationRef, outcomeAuthority: profile.outcomeAuthority.source, classification: 'registry-declared' };
  report.sourceRef = { uri: `repo:${options.receipt}`, revision: doc.digest, observedAt: doc.observedAt, locator: parsed.pointer === null ? { kind: 'whole-file/1' } : { kind: 'json-pointer/1', pointer: parsed.pointer } };
  if (options.expected && options.expected.value !== doc.digest.value) { report.gaps = ['task/receipt-revision-changed']; return report; }
  report.result = parsed; report.gaps = [...parsed.gaps];
  if (!profile.owner) report.gaps.push('task/owner-unknown');
  report.state = report.gaps.length ? 'incomplete' : parsed.state;
  report.exitCode = ['completed', 'empty'].includes(report.state) ? 0 : report.state === 'incomplete' ? 2 : 1;
  return report;
}

export function parseTaskArgs(argv) {
  const args = [...argv], command = args[0]?.startsWith('--') ? 'inventory' : args.shift() ?? 'inventory';
  if (!['inventory', 'outcome'].includes(command)) invalid();
  const options = { exclusions: [] }, flags = {}, seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const key = args[i]; if (seen.has(key) && key !== '--exclude') invalid(); seen.add(key);
    if (['--json', '--help'].includes(key)) { flags[key.slice(2)] = true; continue; }
    if (['--all', '--non-sensitive', '--protected'].includes(key)) { options[{ '--all': 'includeUntracked', '--non-sensitive': 'nonSensitive', '--protected': 'protected' }[key]] = true; continue; }
    if (!['--root', '--package', '--receipt', '--invocation', '--exclude', '--max-bytes', '--expected-revision'].includes(key)) invalid();
    const value = args[++i]; if (!value || value.startsWith('--')) invalid();
    if (key === '--root') flags.root = value;
    else if (key === '--exclude') options.exclusions.push(value);
    else if (key === '--max-bytes') { if (!/^[1-9][0-9]*$/.test(value)) invalid(); options.maxBytes = Number(value); }
    else options[key === '--expected-revision' ? 'expectedRevision' : key.slice(2)] = value;
  }
  return { command, options, flags };
}
export function tasksMain(argv = process.argv.slice(2)) {
  try {
    const { command, options, flags } = parseTaskArgs(argv);
    if (flags.help) { console.log('curia-workflow tasks — 显式目录 profile 与原生结果观察，不调度、不执行任务。\n  tasks inventory --package docs/jobs/report --all --json\n  tasks outcome --package docs/jobs/report --receipt docs/jobs/report/ledger.json --invocation round-1 --non-sensitive --json\n目录 mapping.task 登记角色、敏感性、触发说明与原生结果 authority。inventory 只读 Registry 和路径元数据，不读或摘要成员正文。\noutcome 只读明确选中的非敏感回执；JSON 账本按精确 task／invocation 唯一匹配，不选最新或猜空轮次。可用 --exclude、--all、--max-bytes 与 --expected-revision；受保护核验不降级。\n退出：completed/empty/classified=0，已报告的其他业务状态=1，缺口或无效范围=2。'); return; }
    const result = command === 'inventory' ? buildTaskInventory(flags.root ?? ROOT, options) : observeTaskOutcome(flags.root ?? ROOT, options);
    console.log(flags.json ? JSON.stringify(result, null, 2) : `${result.state}: ${result.gaps.map(g => typeof g === 'string' ? g : g.code).join(', ')}`);
    process.exitCode = command === 'inventory' ? result.state === 'classified' ? 0 : 2 : result.exitCode;
  } catch { console.error(JSON.stringify({ schema: 'curia.task-observation-error/1', code: 'task/options-or-boundary-invalid' })); process.exitCode = 2; }
}
if (isMainModule(import.meta.url)) tasksMain();
