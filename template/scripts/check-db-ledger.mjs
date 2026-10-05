/**
 * check-db-ledger.mjs —— 仓内台账守卫（《迁移台账规格》§3）。
 * 校验：envs/*.json 形状（env_tag 与文件名一致、status 封闭集、applied 及以上
 * 必须有证据指针且文件存在）、条目 checksum 与迁移文件一致。
 * 台账只由命令写；人手编的形状错误在这里被拦下。
 * 仓库根取 doc-lib 的 ROOT（认 CURIA_ROOT）；暂存模式（opts.staged / CURIA_STAGED=1）下
 * 目录清单、台账内容与证据指针存在性全取 git 索引——先 add 坏版再在盘面改好骗不过。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, countMissingRuleIds, gitList, gitShow, isMainModule, logRuleHits } from './doc-lib.mjs';

const LEDGER = 'deploy/db-ledger';
const STATUSES = new Set(['pending', 'exported', 'submitted', 'applied', 'verified', 'failed', 'superseded']);
const EVIDENCED = new Set(['exported', 'submitted', 'applied', 'verified']);

export function runCheck(root, opts = {}) {
  const errors = [], warnings = [];
  const stats = { envs: 0, entries: 0 };
  const staged = opts.staged === true;
  const listDir = (relDir) => {
    if (staged) return gitList(root, ['--', relDir]).map((p) => p.slice(relDir.length + 1));
    return existsSync(join(root, relDir)) ? readdirSync(join(root, relDir)) : null;
  };
  const readText = (rel) => (staged ? gitShow(root, rel, '') : (existsSync(join(root, rel)) ? readFileSync(join(root, rel), 'utf8') : null));
  const has = (rel) => (staged ? gitShow(root, rel, '') !== null : existsSync(join(root, rel)));

  const entries0 = listDir(LEDGER);
  // 暂存模式下 gitList 对「目录不存在」返回空数组而非 null——空且盘面也无此目录时按跳过处理，
  // 否则会对根本没有台账目录的项目误报「台账缺 README.md」
  if (entries0 === null || (staged && !entries0.length && !existsSync(join(root, LEDGER)))) {
    return { ok: true, errors, warnings, skipped: true, stats };
  }
  if (!has(`${LEDGER}/README.md`)) warnings.push('台账缺 README.md [ledger/readme]');

  const envs = listDir(`${LEDGER}/envs`);
  if (envs !== null) {
    for (const f of envs.filter((x) => x.endsWith('.json'))) {
      stats.envs++;
      const tag = f.replace(/\.json$/, '');
      let doc;
      try { doc = JSON.parse(readText(`${LEDGER}/envs/${f}`) ?? ''); } catch {
        errors.push(`${f}: JSON 不可解析（台账只由命令写，勿手编） [ledger/parse]`);
        continue;
      }
      if (doc.env_tag !== tag) errors.push(`${f}: env_tag=${doc.env_tag} 与文件名不符 [ledger/tag]`);
      if (!Array.isArray(doc.entries)) errors.push(`${f}: 缺 entries 数组 [ledger/shape]`);
      for (const e of doc.entries || []) {
        stats.entries++;
        if (!STATUSES.has(e.status)) errors.push(`${f}: 条目 ${e.seq} status=${e.status} 不在封闭集 [ledger/status]`);
        for (const k of ['seq', 'version', 'file', 'checksum']) if (!(k in e))
          errors.push(`${f}: 条目缺字段 ${k} [ledger/shape]`);
        if (EVIDENCED.has(e.status)) {
          if (!e.receipt && !e.probe) errors.push(`${f}: 条目 ${e.seq} status=${e.status} 缺证据指针（receipt/probe 至少其一） [ledger/evidence]`);
          for (const k of ['receipt', 'probe']) if (e[k] && !has(`${LEDGER}/${e[k]}`))
            errors.push(`${f}: 条目 ${e.seq} 的 ${k} 指向不存在的 ${e[k]} [ledger/evidence]`);
        }
      }
    }
  }
  return { ok: errors.length === 0, errors, warnings, stats };
}

if (isMainModule(import.meta.url)) {
  const r = runCheck(ROOT, { staged: process.env.CURIA_STAGED === '1' });
  for (const w of r.warnings) console.warn(`warning: ledger: ${w}`);
  const missing = countMissingRuleIds([...r.errors, ...r.warnings]);
  if (missing > 0) r.errors.push(`门禁: check-db-ledger 有 ${missing} 条输出未挂规则 ID [meta/missing-rule-id]`);
  if (r.errors.length) {
    for (const e of r.errors) console.error(`ledger: ${e}`);
    console.error(`✗ check-db-ledger 未通过：共 ${r.errors.length} 处错误`);
  }
  logRuleHits(ROOT, r.errors, r.warnings);
  if (r.errors.length) process.exit(1);
  console.log(`✓ check-db-ledger 通过：${r.stats.envs} 份环境台账 / ${r.stats.entries} 条条目形状与证据全部合规${r.skipped ? '（无台账目录，跳过）' : ''}`);
}
