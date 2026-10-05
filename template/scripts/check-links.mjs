#!/usr/bin/env node
/**
 * check-links.mjs —— 全仓 Markdown 相对链接可达性检查（纯 node 标准库、零依赖）。
 *
 * 覆盖范围与 check-doc-types / check-prose 一致：**默认只看已入库（索引里）的文件**，
 * 因此同仓其他会话尚未入库的在写文档不会拦住本次提交；`--all` 并入未入库文件做全量审计。
 *   - 排除项由注册表 exemptPaths 决定（模板目录单独补检，见下）、原始语料目录（`.agents-raw`）、第三方参考克隆
 *   - 排除 .agents/notes/ 的 lifecycle 子树——笔记正文由专属守卫 scripts/check-agent-notes.mjs 覆盖；
 *     notes 根文件（README.md / AGENTS.md）仍受本检查
 *   - 不跟随符号链接（.claude/.codex 等桥不会造成重复扫描或循环）
 * 规则：仅检查相对链接；带 scheme 的链接（http/https/mailto 等）跳过；纯锚点（#…）跳过；
 *   带 `#fragment` 时只校验文件部分，锚点本身不校验。fenced code 与 HTML 注释区域不参与检查。
 * 暂存模式（环境变量 CURIA_STAGED=1，pre-commit 调用）：链接文本与链接目标的存在性都取 git 索引
 *   （校验的是将要提交的树——先 add 坏版本再在盘上改好会被拦下；目标被 rm --cached 后提交树里
 *   就是断链，同样拦下；目标在索引、盘面删了则不算断链）。
 * 输出：逐条错误 + 汇总；有错退出码 1。
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  ROOT, countMissingRuleIds, discoverDocs, indexChildren, isMainModule, linkTargetExists, loadRegistry, logRuleHits,
  maskSource, readDoc, readDocStaged,
} from './doc-lib.mjs';

// notes 的 lifecycle 子树归 check-agent-notes 专属守卫；notes 根文件仍由本脚本检查
const NOTES_LIFECYCLE_RE = /^\.agents\/notes\/(proposed|implemented|rejected|archived)($|\/)/;
const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const LINK_RE = /\[[^\]]*\]\(([^)\s]+)\)/g;

/** 模板目录被注册表整体豁免，但模板里的链接会被每一篇脚手架产物继承，所以单独补检。 */
function templateFiles(root, reg, staged) {
  if (staged) {
    // 暂存模式：模板清单也取索引——盘面上未入库的模板不参与，索引里删掉的模板不因盘面还在而混过
    return [...indexChildren(root, reg.templateDir).keys()]
      .filter((f) => f.endsWith('.md'))
      .map((f) => `${reg.templateDir}/${f}`);
  }
  const dir = join(root, reg.templateDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => `${reg.templateDir}/${f}`);
}

export function runCheck(root = ROOT, opts = {}) {
  const errors = [];
  const warnings = [];
  const stats = { files: 0, links: 0 };
  const staged = opts.staged === true; // 暂存模式：链接文本与目标存在性都从 git 索引取（pre-commit 校验将要提交的版本）

  let reg;
  try {
    reg = loadRegistry(root, { staged });
  } catch (e) {
    return { ok: false, errors: [`注册表: ${e.message} [types/registry-load]`], warnings, stats };
  }

  const docs = discoverDocs(root, reg, { includeUntracked: opts.includeUntracked === true, staged });
  const files = [...docs.map((d) => d.rel).filter((rel) => !NOTES_LIFECYCLE_RE.test(rel)), ...templateFiles(root, reg, staged)].sort();
  stats.files = files.length;

  for (const rel of files) {
    const abs = join(root, rel);
    // 暂存模式：链接文本取自索引；目标存在性同样按索引判（提交树里没有的目标就是断链）——见 linkTargetExists
    const lines = staged ? readDocStaged(root, rel) : (existsSync(abs) ? readDoc(abs) : null);
    if (lines === null) continue;
    const mask = maskSource(lines);
    for (let i = 0; i < lines.length; i++) {
      if (mask.fenced[i] || mask.commented[i]) continue; // fenced 与 HTML 注释区整段跳过（含跨行），掩码与 doc-lib 共用一份
      if (/^\s*>/.test(lines[i])) continue;

      for (const m of lines[i].matchAll(LINK_RE)) {
        const target = (m[1] ?? '').trim();
        if (!target || target.startsWith('#') || SCHEME_RE.test(target)) continue;
        const pathPart = target.split('#')[0];
        if (!pathPart) continue;
        stats.links++;
        if (linkTargetExists(abs, target, { root, staged })) continue;
        errors.push(staged
          ? `链接: ${rel} — 相对链接目标不存在：${target}（目标未入库：把它一起 add；提交树里没有的目标按断链处理） [links/target-missing]`
          : `链接: ${rel} — 相对链接目标不存在：${target} [links/target-missing]`);
      }
    }
  }

  errors.sort();
  return { ok: errors.length === 0, errors, warnings, stats };
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  const all = args.includes('--all');
  const result = runCheck(ROOT, { includeUntracked: all, staged: process.env.CURIA_STAGED === '1' });
  const missing = countMissingRuleIds([...result.errors, ...result.warnings]);
  if (missing > 0) result.errors.push(`门禁: check-links 有 ${missing} 条输出未挂规则 ID [meta/missing-rule-id]`);
  if (result.errors.length) {
    for (const e of result.errors) console.error(`check-links: ${e}`);
    console.error(`✗ check-links 未通过：共 ${result.errors.length} 处错误（扫描 ${result.stats.files} 个 Markdown 文件 / ${result.stats.links} 条相对链接）`);
  }
  logRuleHits(ROOT, result.errors, result.warnings);
  if (result.errors.length) process.exit(1);
  console.log(`✓ check-links 通过：${result.stats.files} 个 Markdown 文件 / ${result.stats.links} 条相对链接全部可达${all ? '' : '（已入库范围；--all 含未入库）'}`);
}
