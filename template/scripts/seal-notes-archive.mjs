#!/usr/bin/env node
/**
 * seal-notes-archive.mjs —— 重新生成归档区 manifest.json 的 sha256 封印。
 *
 * 两个归档区共用同一套机制（append-only 哈希封印），由 --target 选择：
 *   notes   （默认）.agents/notes/archived/manifest.json，键前缀 archived/
 *   archive         .agents/archive/manifest.json，键前缀 archive/
 *   both            两处都封印
 *
 * 语义（append-only）：
 *   - 已封印条目保持原封印不变；若文件哈希已不符则报错（说明封印后被改动）；
 *   - 只为新迁入的归档文件追加封印；
 *   - 已封印文件消失则报错（归档区不允许删除）。
 * 封印由 scripts/check-agent-notes.mjs（notes）与 scripts/check-doc-types.mjs（archive）强制核对。
 *
 * 运行：node scripts/seal-notes-archive.mjs [--target notes|archive|both] [--root <dir>]
 *   --root 只为自证套件与排障服务（默认仓库根）；日常使用不需要。
 */

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const rootArg = args.indexOf('--root');
const ROOT = rootArg !== -1 && args[rootArg + 1] ? resolve(args[rootArg + 1]) : resolve(fileURLToPath(new URL('../', import.meta.url)));
const TARGETS = {
  notes: { dir: join(ROOT, '.agents', 'notes', 'archived'), prefix: 'archived', skip: new Set() },
  archive: { dir: join(ROOT, '.agents', 'archive'), prefix: 'archive', skip: new Set(['README.md']) },
};

function collect(dir, base, skip, out) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) collect(full, base, skip, out);
    else if (e.isFile() && e.name.endsWith('.md') && !e.name.endsWith('.zh.md') && !skip.has(e.name)) {
      out.push(relative(base, full).split('\\').join('/'));
    }
  }
}

/** 封印一个归档区；返回问题清单（不抛错，让两个目标都跑完再统一失败）。 */
function seal(name, target) {
  const problems = [];
  const manifestPath = join(target.dir, 'manifest.json');
  const files = [];
  if (existsSync(target.dir)) collect(target.dir, target.dir, target.skip, files);
  files.sort();

  let prev = { version: 1, files: {} };
  if (existsSync(manifestPath)) prev = JSON.parse(readFileSync(manifestPath, 'utf8'));

  if (files.length === 0 && Object.keys(prev.files ?? {}).length === 0) {
    console.log(`✓ ${name}: 归档区为空，无需封印`);
    return problems;
  }

  const next = { version: 1, files: {} };
  for (const rel of files) {
    const key = `${target.prefix}/${rel}`;
    const actual = `sha256:${createHash('sha256').update(readFileSync(join(target.dir, rel))).digest('hex')}`;
    const old = prev.files?.[key];
    if (typeof old === 'string') {
      if (old !== actual) problems.push(`${name}: 封印后被改动：${key}（归档区永久冻结，不能修改；请恢复原文件）`);
      next.files[key] = old; // append-only：保持原封印
    } else {
      next.files[key] = actual;
      console.log(`新增封印：${key}`);
    }
  }
  for (const key of Object.keys(prev.files ?? {})) {
    if (!(key in next.files)) problems.push(`${name}: 已封印文件消失：${key}（归档区不允许删除）`);
  }

  if (!problems.length) {
    writeFileSync(manifestPath, `${JSON.stringify(next, null, 2)}\n`);
    console.log(`✓ ${name}: manifest 已更新（${Object.keys(next.files).length} 个归档文件）`);
  }
  return problems;
}

const ti = args.indexOf('--target');
const target = ti !== -1 ? args[ti + 1] : 'notes';
const names = target === 'both' ? ['notes', 'archive'] : [target];
if (names.some((n) => !TARGETS[n])) {
  console.error(`seal: 未知 --target \`${target}\`（允许：notes / archive / both）`);
  process.exit(1);
}

const problems = names.flatMap((n) => seal(n, TARGETS[n]));
if (problems.length) {
  for (const p of problems) console.error(`seal: ${p}`);
  process.exit(1);
}
