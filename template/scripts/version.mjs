#!/usr/bin/env node
// 版本唯一计算入口——《版本方案规格》§3（.agents/plans/2026-10-05-version-scheme.md）。
// N = 完整克隆的 main 上的提交计数：对某提交确定、离线可复现，不依赖 CI 计数器。
// 浅克隆与脏树默认拒绝；--allow-dirty 显式放行（只警告，不改 N）。
// 输出：默认纯版本号；--json 输出 {version, commit, dirty}——构建入口与工具取后者。
// 失败命中记进 .agents/.rule-hits.jsonl 台账（与守卫同款收口：countMissingRuleIds 自查 + logRuleHits 记账）。
import { execFileSync } from 'node:child_process';
import { ROOT, countMissingRuleIds, isMainModule, logRuleHits } from './doc-lib.mjs';

function git(...a) {
  return execFileSync('git', a, { encoding: 'utf8' }).trim();
}

export function computeVersion({ allowDirty = false } = {}) {
  const errors = [];
  const warnings = [];
  const result = { ok: true, errors, warnings, version: null, commit: null, dirty: null };

  let shallow = false;
  try {
    shallow = git('rev-parse', '--is-shallow-repository') === 'true';
  } catch {
    errors.push('不在 git 仓库内 [version/no-git]');
    result.ok = false;
    return result;
  }
  if (shallow) {
    errors.push('浅克隆上 rev-list --count 不准，拒绝构建（完整克隆后重试） [version/shallow]');
    result.ok = false;
    return result;
  }

  const commit = git('rev-parse', 'HEAD');
  const count = git('rev-list', '--count', commit);
  const dirty = git('status', '--porcelain') !== '';
  if (dirty && !allowDirty) {
    errors.push('工作区不干净，拒绝构建（--allow-dirty 显式放行） [version/dirty]');
    result.ok = false;
    return result;
  }
  if (dirty) warnings.push('工作区不干净，--allow-dirty 已放行（只警告，不改 N；构建产物可能与提交不符） [version/dirty-allowed]');

  result.version = `0.0.0.${count}`;
  result.commit = commit;
  result.dirty = dirty;
  return result;
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  const result = computeVersion({ allowDirty: args.includes('--allow-dirty') });
  for (const w of result.warnings) console.warn(`warning: version: ${w}`);
  const missing = countMissingRuleIds([...result.errors, ...result.warnings]);
  if (missing > 0) result.errors.push(`门禁: version 有 ${missing} 条输出未挂规则 ID [meta/missing-rule-id]`);
  if (result.errors.length) {
    for (const e of result.errors) console.error(`version: ${e}`);
    console.error(`✗ version 未通过：共 ${result.errors.length} 处错误`);
  }
  logRuleHits(ROOT, result.errors, result.warnings);
  if (result.errors.length) process.exit(1);
  if (args.includes('--json')) console.log(JSON.stringify({ version: result.version, commit: result.commit, dirty: result.dirty }));
  else console.log(result.version);
}
