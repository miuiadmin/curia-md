/** One-shot POSIX supervisor. Bounds wall time and output; it is explicitly not a security sandbox. */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { MULTI_GUARD_SCHEMA, REPOSITORY_ENV, validateQualifiedPath, qualifiedPathKey } from './curia-guard-contract.mjs';
import { parseRegistryJson } from './curia-query.mjs';
import { GUARD_RUNTIME_LIMITATIONS, guardArray, guardFail, guardObject, guardPath } from './curia-guard-contract.mjs';

const receipts = new WeakMap();
export function commandReceipt(handle, expected = null) {
  const saved = receipts.get(handle);
  if (!saved) guardFail('命令回执必须来自本进程实际 supervisor，JSON 不能伪造执行凭据');
  if (expected) {
    if (saved.used || saved.runId !== expected.runId || JSON.stringify(saved.adapter) !== JSON.stringify(expected.adapter) || JSON.stringify(saved.invocation) !== JSON.stringify(expected.invocation) || JSON.stringify(saved.repositoryBindings) !== JSON.stringify(expected.repositoryBindings ?? null)) guardFail('命令回执已消费或不属于本次 Run / 实际调用');
    saved.used = true;
  }
  return structuredClone(saved.receipt);
}
function nativeResult(adapter, receipt, stdout, inputPaths, declaredPaths) {
  const multi = adapter.schema === MULTI_GUARD_SCHEMA, key = multi ? qualifiedPathKey : value => value;
  const allowed = new Set(inputPaths.map(key));
  const aggregate = receipt.status === 'not-applicable' ? 'not-applicable' : receipt.pid === null ? 'skipped' : receipt.status === 'exited' && adapter.expectedExitCodes.includes(receipt.exitCode) ? 'pass' : 'fail';
  const result = { aggregate, checks: [], observedScope: { kind: multi ? 'declared-multi-repository-union-not-traced' : 'declared-union-not-traced', paths: structuredClone(declaredPaths) }, scopeOverflow: false };
  if (receipt.status === 'not-applicable') { receipt.output.parserState = 'not-applicable'; result.observedScope = { kind: 'not-applicable', paths: [] }; return result; }
  if (receipt.pid === null) { receipt.output.parserState = 'not-executed'; result.observedScope = { kind: 'not-observed', paths: [] }; return result; }
  if (adapter.parser.id === 'aggregate-exit/1') { receipt.output.parserState = 'aggregate-only'; return result; }
  receipt.output.parserState = 'unparsed';
  if (receipt.status !== 'exited') return result;
  try {
    const report = parseRegistryJson(new TextDecoder('utf-8', { fatal: true }).decode(stdout));
    guardObject(report, ['schema', 'checks', 'observedPaths']);
    if (report.schema !== (multi ? 'curia.guard-status/2' : 'curia.guard-status/1')) guardFail('guard 输出 schema 未支持');
    guardArray(report.checks, 'checks', 256); guardArray(report.observedPaths, 'observedPaths');
    if (report.checks.length !== adapter.parser.ruleIds.length || new Set(report.checks.map((check) => check.id)).size !== report.checks.length) guardFail('guard 输出规则不完整或重复');
    for (const check of report.checks) {
      guardObject(check, ['id', 'state']);
      if (!adapter.parser.ruleIds.includes(check.id) || !['pass', 'fail', 'not-applicable'].includes(check.state)) guardFail('guard 输出规则或状态未登记');
    }
    for (const path of report.observedPaths) { if (multi) validateQualifiedPath(path); else guardPath(path); }
    if (new Set(report.observedPaths.map(key)).size !== report.observedPaths.length) guardFail('observedPaths 重复');
    result.checks = report.checks.map(({ id, state }) => ({ id, state }));
    result.scopeOverflow = report.observedPaths.some(path => !allowed.has(key(path)));
    result.observedScope = { kind: multi ? 'self-reported-multi-repository-not-traced' : 'self-reported-not-traced', paths: report.observedPaths.filter(path => allowed.has(key(path))).sort((a, b) => key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0), outsideDeclaredCount: report.observedPaths.filter(path => !allowed.has(key(path))).length };
    receipt.output.parserState = 'parsed';
  } catch { /* Raw output, exception messages and unknown path names are never persisted. */ }
  return result;
}
export async function superviseGuard(adapter, execution, { signal, notApplicable = false, inputPaths = [], declaredPaths = adapter.inputScope.paths, runId = null, skipReason = null } = {}) {
  if (![null, 'plan-changed'].includes(skipReason)) guardFail('未支持的执行前停止原因');
  adapter = structuredClone(adapter);
  execution = { executable: execution.executable, args: [...execution.args], cwd: execution.cwd, environment: { ...execution.environment } };
  inputPaths = structuredClone(inputPaths); declaredPaths = structuredClone(declaredPaths);
  const multi = adapter.schema === MULTI_GUARD_SCHEMA;
  const binding = execution.environment[REPOSITORY_ENV];
  if (multi && (typeof binding !== 'string' || !binding.length || Buffer.byteLength(binding) > 65536) || !multi && binding !== undefined) guardFail('仓库环境绑定缺失、超限或被注入单仓命令');
  const repositoryBindings = multi ? { algorithm: 'sha256', canonicalization: 'raw-bytes/1', value: createHash('sha256').update(binding).digest('hex') } : null;
  if (!['linux', 'darwin'].includes(process.platform)) guardFail('尚无当前平台的进程组清理适配器');
  const receipt = {
    schema: multi ? 'curia.guard-receipt/2' : 'curia.guard-receipt/1', ...(multi ? { repositoryBindings } : {}), startedAt: new Date().toISOString(), endedAt: null, pid: null,
    status: skipReason ? 'preflight-changed' : signal?.aborted ? 'cancelled' : notApplicable ? 'not-applicable' : 'spawn-failed', exitCode: null, signal: null, spawnError: null,
    output: { stdoutBytes: 0, stderrBytes: 0, retained: 'none', parser: adapter.parser.id, parserState: 'unparsed' },
    cleanup: { boundary: 'posix-process-group-not-sandbox', state: 'not-started', signals: [] },
    native: null, inputDrift: [],
    limitations: [...GUARD_RUNTIME_LIMITATIONS],
  };
  const chunks = []; let retainedBytes = 0;
  if (!notApplicable && !skipReason && !signal?.aborted) await new Promise((resolve) => {
    let child; let finished = false; let directExit = false; let closed = false; let requested = null;
    let timeout; let escalation; let deadline; let polling;
    const alive = () => {
      if (!receipt.pid) return false;
      try { process.kill(-receipt.pid, 0); return true; }
      catch (error) { if (error.code === 'ESRCH') return false; return true; }
    };
    const send = (name) => {
      if (!receipt.pid) return;
      try { process.kill(-receipt.pid, name); receipt.cleanup.signals.push(name); }
      catch (error) { if (error.code !== 'ESRCH') receipt.cleanup.state = 'unconfirmed'; }
    };
    const done = (unconfirmed = false) => {
      if (finished) return; finished = true;
      clearTimeout(timeout); clearTimeout(escalation); clearTimeout(deadline); clearInterval(polling);
      signal?.removeEventListener('abort', abort);
      const remains = receipt.pid ? alive() : false;
      receipt.cleanup.state = !receipt.pid ? 'not-started' : remains || unconfirmed ? 'unconfirmed' : 'group-absent';
      receipt.status = receipt.cleanup.state === 'unconfirmed' ? 'cleanup-unconfirmed' : requested ?? (receipt.spawnError ? 'spawn-failed' : receipt.signal ? 'interrupted' : receipt.exitCode !== null ? 'exited' : 'spawn-failed');
      child?.stdout?.destroy(); child?.stderr?.destroy(); child?.unref(); resolve();
    };
    const stop = (reason) => {
      if (finished) return;
      requested ??= reason;
      if (escalation || deadline) return;
      send('SIGTERM');
      escalation = setTimeout(() => send('SIGKILL'), adapter.limits.killGraceMs);
      deadline = setTimeout(() => done(!closed || alive()), adapter.limits.killGraceMs + 2000);
      polling = setInterval(() => { if (directExit && closed && !alive()) done(); }, 20);
    };
    const abort = () => stop('cancelled');
    const receive = (kind, bytes) => {
      receipt.output[kind === 'stdout' ? 'stdoutBytes' : 'stderrBytes'] += bytes.length;
      if (receipt.output.stdoutBytes + receipt.output.stderrBytes > adapter.limits.maxOutputBytes) { stop('output-limit'); return; }
      if (kind === 'stdout' && ['curia-guard-status/1', 'curia-guard-status/2'].includes(adapter.parser.id) && !requested) { chunks.push(Buffer.from(bytes)); retainedBytes += bytes.length; }
    };
    try {
      child = spawn(execution.executable, execution.args, { cwd: execution.cwd, env: execution.environment, detached: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
      receipt.pid = child.pid ?? null;
      child.stdout.on('data', (bytes) => receive('stdout', bytes)); child.stderr.on('data', (bytes) => receive('stderr', bytes));
      child.on('error', (error) => { receipt.spawnError = /^[A-Z0-9_]+$/.test(error.code ?? '') ? error.code : 'SPAWN_ERROR'; });
      child.on('exit', (code, childSignal) => {
        directExit = true; receipt.exitCode = code; receipt.signal = childSignal;
        // Descendants may outlive the direct child and hold its pipes. Do not mistake exit for cleanup.
        if (alive()) stop(null);
      });
      child.on('close', () => { closed = true; if (!alive()) done(); else stop(null); });
      timeout = setTimeout(() => stop('timed-out'), adapter.limits.timeoutMs);
      signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
    } catch (error) {
      receipt.spawnError = /^[A-Z0-9_]+$/.test(error.code ?? '') ? error.code : 'SPAWN_ERROR'; done();
    }
  });
  receipt.endedAt = new Date().toISOString();
  receipt.native = nativeResult(adapter, receipt, Buffer.concat(chunks, retainedBytes), inputPaths, declaredPaths);
  const handle = Object.freeze({ status: receipt.status, terminal: true, exitCode: receipt.exitCode });
  receipts.set(handle, { receipt, runId, adapter: structuredClone(adapter), invocation: { executable: execution.executable, args: [...execution.args], cwd: execution.cwd }, repositoryBindings, used: false }); return handle;
}
