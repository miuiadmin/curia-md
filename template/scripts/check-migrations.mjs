/**
 * check-migrations.mjs —— 迁移文件守卫（《迁移台账规格》§1）。
 * 校验：命名正则、seq 连续、头注释与 seq 一致、MANIFEST 校验和与文件字节一致、
 * 台账标记为 exported/applied 及以上的文件未被改动（冻结）。
 * --write 时生成 MANIFEST.json（唯一写入口，人不手抄；盘面工具，暂存模式忽略）。
 * 仓库根取 doc-lib 的 ROOT（认 CURIA_ROOT）；暂存模式（opts.staged / CURIA_STAGED=1）下
 * 目录清单与文件内容全取 git 索引——校验的是将要提交的树：先 add 坏版再在盘面改好骗不过，
 * rm --cached 删掉的迁移也会因 MANIFEST 仍登记而报错。
 * 暂存模式另设两条空转防线：迁移目录整个从索引消失而台账区非空 [migrations/dir-vanished]、
 * 台账已进入执行链（exported 及以上）的文件在索引里读不到 [migrations/frozen-missing]。
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, countMissingRuleIds, gitList, gitShow, isMainModule, logRuleHits } from './doc-lib.mjs';

const MIG_DIR = 'apps/backend/migrations';
const LEDGER_DIR = 'deploy/db-ledger';
const LEDGER_ENV_DIR = 'deploy/db-ledger/envs';
const NAME_RE = /^([0-9]{4})_[a-z0-9_]+\.sql$/;
/** 已进入执行链的状态：这些条目的迁移文件被改动或删除都要拦（《迁移台账规格》§1 冻结规则）。 */
const FROZEN_STATUSES = new Set(['exported', 'submitted', 'applied', 'verified']);

export function runCheck(root, opts = {}) {
  const errors = [], warnings = [];
  const stats = { files: 0, ledgerEnvs: 0 };
  const staged = opts.staged === true;
  const listDir = (relDir) => {
    if (staged) return gitList(root, ['--', relDir]).map((p) => p.slice(relDir.length + 1));
    return existsSync(join(root, relDir)) ? readdirSync(join(root, relDir)) : null;
  };
  const readText = (rel) => (staged ? gitShow(root, rel, '') : (existsSync(join(root, rel)) ? readFileSync(join(root, rel), 'utf8') : null));

  // 台账先读：整目录消失检查与冻结检查都要知道台账里有什么（坏 JSON 与坏条目跳过，形状问题归 check-db-ledger）。
  const ledgerEntries = [];
  const envs = listDir(LEDGER_ENV_DIR);
  if (envs !== null) {
    for (const ef of envs.filter((f) => f.endsWith('.json'))) {
      stats.ledgerEnvs++;
      const raw = readText(`${LEDGER_ENV_DIR}/${ef}`);
      let entries = [];
      try { entries = JSON.parse(raw ?? '')?.entries || []; } catch { continue; }
      for (const e of entries) {
        if (!e || typeof e !== 'object') continue;
        ledgerEntries.push({ envFile: ef, entry: e });
      }
    }
  }

  const dirEntries = listDir(MIG_DIR);
  if (dirEntries === null) return { ok: true, errors, warnings, skipped: true, stats };
  // 暂存模式下整目录从索引消失（git rm -r --cached）时 gitList 给空数组而非 null：目录空且台账区
  // 在索引里仍有内容（README、envs 占位文件也算）时必须拦——否则 MANIFEST 校验与冻结检查全部空转，
  // 整目录退役无声放行（审计实测的阻断）。
  const dirVanished = staged && dirEntries.length === 0 && gitList(root, ['--', LEDGER_DIR]).length > 0;
  if (dirVanished) {
    errors.push(`迁移目录: ${MIG_DIR}/ 在暂存索引里整个消失（git rm -r --cached），但台账区 ${LEDGER_DIR}/ 仍有内容——MANIFEST 校验与冻结检查会全部空转；误删恢复用 git restore --staged ${MIG_DIR}/，确为整目录退役须同步处理台账 [migrations/dir-vanished]`);
  }
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

  // 冻结：台账里已进入执行链的迁移，当前字节必须与台账记录的 checksum 一致；暂存模式下文件在索引里
  // 读不到（rm/rm --cached 删掉）同样要拦——此前只比对 cur 存在的情况，删除会静默跳过整段冻结检查。
  for (const { envFile: ef, entry: e } of ledgerEntries) {
    if (!FROZEN_STATUSES.has(e.status)) continue;
    const file = typeof e.file === 'string' && e.file ? e.file : null;
    if (!file) continue; // file 字段的形状问题归 check-db-ledger，这里不猜
    const cur = sums.get(file);
    if (cur && e.checksum && cur !== e.checksum)
      errors.push(`冻结: ${file} 已在 ${ef} 标记 ${e.status}，但当前字节与台账 checksum 不符 [migrations/frozen]`);
    else if (staged && !cur && !dirVanished)
      errors.push(`冻结: ${file} 在 ${ef} 标记 ${e.status}，但暂存索引里读不到该文件——已进入执行链的迁移不得删除（误删恢复用 git restore --staged ${MIG_DIR}/${file}；整目录退役须同步处理台账） [migrations/frozen-missing]`);
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
