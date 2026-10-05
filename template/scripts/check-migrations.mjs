/**
 * check-migrations.mjs —— 迁移文件守卫（《迁移台账规格》§1）。
 * 校验：命名正则、seq 连续、头注释与 seq 一致、MANIFEST 校验和与文件字节一致、
 * 台账标记为 exported/applied 及以上的文件未被改动（冻结）。
 * --write 时生成 MANIFEST.json（唯一写入口，人不手抄；盘面工具，暂存模式忽略）。
 * 仓库根取 doc-lib 的 ROOT（认 CURIA_ROOT）；暂存模式（opts.staged / CURIA_STAGED=1）下
 * 目录清单与文件内容全取 git 索引——校验的是将要提交的树：先 add 坏版再在盘面改好骗不过，
 * rm --cached 删掉的迁移也会因 MANIFEST 仍登记而报错。
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, countMissingRuleIds, gitList, gitShow, isMainModule, logRuleHits } from './doc-lib.mjs';

const MIG_DIR = 'apps/backend/migrations';
const LEDGER_ENV_DIR = 'deploy/db-ledger/envs';
const NAME_RE = /^([0-9]{4})_[a-z0-9_]+\.sql$/;

export function runCheck(root, opts = {}) {
  const errors = [], warnings = [];
  const stats = { files: 0, ledgerEnvs: 0 };
  const staged = opts.staged === true;
  const listDir = (relDir) => {
    if (staged) return gitList(root, ['--', relDir]).map((p) => p.slice(relDir.length + 1));
    return existsSync(join(root, relDir)) ? readdirSync(join(root, relDir)) : null;
  };
  const readText = (rel) => (staged ? gitShow(root, rel, '') : (existsSync(join(root, rel)) ? readFileSync(join(root, rel), 'utf8') : null));

  const dirEntries = listDir(MIG_DIR);
  if (dirEntries === null) return { ok: true, errors, warnings, skipped: true, stats };
  const files = dirEntries.filter((f) => f.endsWith('.sql')).sort();
  stats.files = files.length;
  const sums = new Map();
  files.forEach((f, i) => {
    const m = NAME_RE.exec(f);
    if (!m) return errors.push(`命名: ${f} 不匹配 ^[0-9]{4}_[a-z0-9_]+\\.sql$ [migrations/name]`);
    const seq = Number(m[1]);
    if (seq !== i + 1) errors.push(`连续: ${f} 的 seq 是 ${seq}，第 ${i + 1} 个应为 ${String(i + 1).padStart(4, '0')} [migrations/seq]`);
    const body = readText(`${MIG_DIR}/${f}`);
    if (body === null) return errors.push(`读取: ${f} 在${staged ? '暂存索引' : '盘面'}不可读 [migrations/read]`);
    sums.set(f, 'sha256:' + createHash('sha256').update(body, 'utf8').digest('hex'));
    const head = body.split('\n')[0] || '';
    if (head !== `-- migration: ${String(seq).padStart(4, '0')}`)
      errors.push(`头注释: ${f} 首行应为 "-- migration: ${String(seq).padStart(4, '0')}"，实际 ${JSON.stringify(head)} [migrations/header]`);
    if (!/^-- summary: .+$/m.test(body)) warnings.push(`头注释: ${f} 缺 "-- summary:" 行 [migrations/summary]`);
  });

  const manifestRaw = readText(`${MIG_DIR}/MANIFEST.json`);
  if (opts.write && !staged) {
    writeFileSync(join(root, MIG_DIR, 'MANIFEST.json'), JSON.stringify({
      files: files.map((f) => ({ seq: Number(NAME_RE.exec(f)[1]), name: f, sha256: sums.get(f) })),
    }, null, 2) + '\n');
  } else if (manifestRaw !== null) {
    try {
      const man = JSON.parse(manifestRaw);
      for (const e of man.files || []) {
        const cur = sums.get(e.name);
        if (!cur) errors.push(`MANIFEST: 登记了不存在的文件 ${e.name} [migrations/manifest]`);
        else if (cur !== e.sha256) errors.push(`MANIFEST: ${e.name} 校验和不符（文件被改而 MANIFEST 未更新——先确认未冻结，再 node scripts/check-migrations.mjs --write） [migrations/manifest]`);
      }
      for (const f of files) if (!(man.files || []).some((e) => e.name === f))
        errors.push(`MANIFEST: 缺 ${f}（node scripts/check-migrations.mjs --write 生成） [migrations/manifest]`);
    } catch {
      errors.push('MANIFEST: JSON 不可解析 [migrations/manifest]');
    }
  } else if (files.length) {
    errors.push('MANIFEST: 不存在（node scripts/check-migrations.mjs --write 生成） [migrations/manifest]');
  }

  // 冻结：台账里已进入执行链的迁移，当前字节必须与台账记录的 checksum 一致。
  const envs = listDir(LEDGER_ENV_DIR);
  if (envs !== null) {
    for (const ef of envs.filter((f) => f.endsWith('.json'))) {
      stats.ledgerEnvs++;
      const raw = readText(`${LEDGER_ENV_DIR}/${ef}`);
      let entries = [];
      try { entries = JSON.parse(raw ?? '')?.entries || []; } catch { continue; }
      for (const e of entries) {
        if (!['exported', 'submitted', 'applied', 'verified'].includes(e.status)) continue;
        const cur = sums.get(e.file);
        if (cur && e.checksum && cur !== e.checksum)
          errors.push(`冻结: ${e.file} 已在 ${ef} 标记 ${e.status}，但当前字节与台账 checksum 不符 [migrations/frozen]`);
      }
    }
  }
  return { ok: errors.length === 0, errors, warnings, stats };
}

if (isMainModule(import.meta.url)) {
  const r = runCheck(ROOT, { write: process.argv.includes('--write'), staged: process.env.CURIA_STAGED === '1' });
  for (const w of r.warnings) console.warn(`warning: migrations: ${w}`);
  const missing = countMissingRuleIds([...r.errors, ...r.warnings]);
  if (missing > 0) r.errors.push(`门禁: check-migrations 有 ${missing} 条输出未挂规则 ID [meta/missing-rule-id]`);
  if (r.errors.length) {
    for (const e of r.errors) console.error(`migrations: ${e}`);
    console.error(`✗ check-migrations 未通过：共 ${r.errors.length} 处错误`);
  }
  logRuleHits(ROOT, r.errors, r.warnings);
  if (r.errors.length) process.exit(1);
  console.log(`✓ check-migrations 通过：${r.stats.files} 个迁移文件，${r.stats.ledgerEnvs} 份环境台账冻结核对${r.skipped ? '（无迁移目录，跳过）' : ''}`);
}
