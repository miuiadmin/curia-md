#!/usr/bin/env node
/** Optional Run contract and HEAD append-only guard; never executes recorded content or commands. */
import { ROOT, countMissingRuleIds, isMainModule, logRuleHits } from './doc-lib.mjs';
import { loadRecordStore } from './curia-records.mjs';

export const RECORD_RULE = Object.freeze({ id: 'records/integrity', version: 1, owner: 'Curia workspace maintainer', scope: 'instance.recordStore-and-head-baseline', activation: 'explicit-recordStore-or-existing-head-records', onEmpty: 'not-applicable', verification: 'static-schema-chain-and-git-baseline-not-authentication', positive: 'records-terminal', negative: 'records-frozen-index' });
export function runCheck(root = ROOT, options = {}) {
  const errors = []; const warnings = [];
  const stats = { runs: 0, events: 0, open: 0, terminal: 0 };
  try {
    const view = loadRecordStore(root, { staged: options.staged === true });
    stats.runs = view.runs.size; stats.events = view.files.size;
    for (const events of view.runs.values()) events.at(-1).data.kind === 'terminal' ? stats.terminal++ : stats.open++;
    return { ok: true, errors, warnings, stats, state: !view.store || !stats.runs ? 'not-applicable' : 'pass', skipped: !view.store, baseline: view.baselineState, rule: RECORD_RULE, limitations: ['uncommitted-events-not-historically-sealed', 'no-signature-or-authentication', 'no-automatic-interruption-detection'] };
  } catch (e) {
    errors.push(`${e.message} [records/integrity]`);
    return { ok: false, errors, warnings, stats, state: 'fail', rule: RECORD_RULE };
  }
}
if (isMainModule(import.meta.url)) {
  const r = runCheck(ROOT, { staged: process.env.CURIA_STAGED === '1' });
  if (countMissingRuleIds([...r.errors, ...r.warnings])) r.errors.push('记录守卫输出缺少规则 ID [meta/missing-rule-id]');
  for (const e of r.errors) console.error(`records: ${e}`);
  logRuleHits(ROOT, r.errors, r.warnings);
  if (r.errors.length) { console.error('✗ check-records 未通过'); process.exitCode = 1; }
  else console.log(`✓ check-records ${r.state}：${r.stats.runs} 个 Run / ${r.stats.events} 个事件 / ${r.stats.open} 个未终态；${r.skipped ? '未启用持久化记录' : r.baseline}`);
}
