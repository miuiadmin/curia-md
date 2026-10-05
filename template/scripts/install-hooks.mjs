#!/usr/bin/env node
/**
 * install-hooks.mjs —— 把 scripts/hooks/ 下的钩子装进本仓库的 git 钩子目录（幂等，纯 node 标准库）。
 *
 * 钩子不入库就没法跟着仓库走，所以源文件放在 scripts/hooks/ 并提交，安装是本地一次性动作。
 * 钩子目录用 `git rev-parse --git-path hooks` 定位（与 check-tools 同源）——linked worktree
 * 与 core.hooksPath 配置下两边看的是同一个位置，装了就不会再报未装。
 * 安全约束：目标位置已存在**不是我们装的**钩子（没有 curia-hook 标记）时拒绝覆盖，
 *   只打印冲突让用户自己合并——其他工具（如 IDE 的提交追踪器）可能也在用同名钩子。
 *
 * 导出 MARKER 供 check-tools 复用（钩子是否装好由它断言），标记只在这一处定义。
 *
 * 运行：node scripts/install-hooks.mjs              # 安装/更新
 *       node scripts/install-hooks.mjs --uninstall  # 卸载我们装的钩子（不动别人的）
 *       node scripts/install-hooks.mjs --status     # 只看状态
 */

import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from './doc-lib.mjs';

export const MARKER = 'curia-hook';

/** 钩子目录定位与 check-tools 同源：git rev-parse --git-path 尊重 linked worktree 与 core.hooksPath。 */
function hooksDir(root) {
  try {
    const out = execFileSync('git', ['rev-parse', '--git-path', 'hooks'], { cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    return out ? resolve(root, out) : null;
  } catch {
    return null;
  }
}

function main() {
  const ROOT = resolve(fileURLToPath(new URL('../', import.meta.url)));
  const SRC = join(ROOT, 'scripts', 'hooks');
  const DEST = hooksDir(ROOT);

  const args = process.argv.slice(2);
  if (!existsSync(SRC)) {
    console.error('install-hooks: 没有 scripts/hooks/ 目录，无可安装的钩子');
    process.exit(1);
  }
  if (!DEST) {
    console.error('install-hooks: 定位不到钩子目录——本目录不是 git 仓库，或 git 目录被挪走了');
    process.exit(1);
  }
  mkdirSync(DEST, { recursive: true }); // core.hooksPath 指向的目录可能还不存在

  const names = readdirSync(SRC).filter((n) => !n.startsWith('.'));
  let changed = 0;
  for (const name of names) {
    const src = join(SRC, name);
    const dest = join(DEST, name);
    const want = readFileSync(src, 'utf8');
    const have = existsSync(dest) ? readFileSync(dest, 'utf8') : null;

    if (args.includes('--status')) {
      const state = have === null ? '未安装' : have === want ? '已安装且最新' : have.includes(MARKER) ? '已安装但过期' : '被其他工具占用';
      console.log(`${name}: ${state}`);
      continue;
    }
    if (args.includes('--uninstall')) {
      if (have !== null && have.includes(MARKER)) {
        rmSync(dest);
        console.log(`✓ 已卸载 ${name}`);
        changed++;
      } else if (have !== null) {
        console.log(`- 跳过 ${name}：不是本仓安装的钩子，不动它`);
      }
      continue;
    }
    if (have === want) {
      console.log(`= ${name} 已是最新`);
      continue;
    }
    if (have !== null && !have.includes(MARKER)) {
      console.error(`✗ 拒绝覆盖 ${name}：该钩子已存在且不含 \`${MARKER}\` 标记（可能是别的工具装的）。请手工合并，或先备份后删除再重装。`);
      process.exitCode = 1;
      continue;
    }
    writeFileSync(dest, want);
    chmodSync(dest, 0o755);
    console.log(`✓ 已安装 ${name}${have === null ? '' : '（更新）'}`);
    changed++;
  }
  if (!args.includes('--status')) {
    console.log(changed ? `完成：${changed} 个钩子有变动` : '完成：无变动');
  }
}

if (isMainModule(import.meta.url)) main();
