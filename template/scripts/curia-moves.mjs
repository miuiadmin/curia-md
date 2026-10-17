#!/usr/bin/env node
/** Explicit local Move Binding resolution. Does not move files, rewrite links or endorse authority. */
import { ROOT, isMainModule } from './doc-lib.mjs';
import { normalizeMoveOptions, prepareMoveSelection, observeMoveSelection } from './curia-query.mjs';

export function buildMoveWorkflow(root = ROOT, options = {}) {
  return observeMoveSelection(prepareMoveSelection(root, options));
}
export function parseMoveArgs(argv) {
  const options = { within: [], exclusions: [], limits: {} }, flags = { root: ROOT }, seen = new Set();
  const values = { '--from': 'from', '--revision': 'revision', '--within': 'within', '--exclude': 'exclusions', '--max-files': 'maxFiles', '--max-file-bytes': 'maxFileBytes', '--max-total-bytes': 'maxTotalBytes' };
  const repeat = new Set(['--within', '--exclude']);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!repeat.has(arg) && seen.has(arg)) throw new Error('duplicate option');
    seen.add(arg);
    if (['--help', '--json', '--strict'].includes(arg)) { flags[arg.slice(2)] = true; continue; }
    if (arg === '--non-sensitive') { options.nonSensitive = true; continue; }
    if (arg === '--all') { options.includeUntracked = true; continue; }
    if (arg !== '--root' && !Object.hasOwn(values, arg)) throw new Error('unknown option');
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw new Error('missing value');
    if (arg === '--root') flags.root = value;
    else if (repeat.has(arg)) options[values[arg]].push(value);
    else if (arg.startsWith('--max-')) {
      if (!/^[1-9][0-9]*$/.test(value)) throw new Error('invalid budget');
      options.limits[values[arg]] = Number(value);
    } else options[values[arg]] = value;
  }
  if (!flags.help) normalizeMoveOptions(options);
  return { options, flags };
}
export function movesMain(argv = process.argv.slice(2)) {
  try {
    const { options, flags } = parseMoveArgs(argv);
    if (flags.help) {
      console.log('node scripts/curia-workflow.mjs moves --from docs/old.md --revision <full-commit-id> --within docs --non-sensitive --strict --json\n唯一 Registry 可选 instance.moves；精确旧路径与 commit 联合查找，不按裸路径或 Git rename 猜身份。\n--within 可重复，必须覆盖旧路径、当前定位和依据；--exclude 优先。非敏感声明覆盖所选历史／当前原件、依据及当前／历史 Registry。\n默认只读已入 index 的当前原件；--all 才允许未忽略 untracked。范围只读，不搬文件、不改链接、不落 Run。\n共享正文预算：--max-files / --max-file-bytes / --max-total-bytes，默认 32 / 65536 / 524288；每次观察的当前与历史 Registry 各独立限 1 MiB。\n输出原始字节摘要与声明，不输出正文，不证明身份、审批或当前效力；同字节不证明同对象，异字节不否定已声明连续性。\n历史仅支持本仓本地可用的完整 Git commit，禁网络补取、驱动与来源命令；不重构历史业务语义，不跟随声明链。\n缺口撤回整个证据组。--strict：未解决退出 1；参数、配置或边界错误退出 2。');
      return;
    }
    const result = buildMoveWorkflow(flags.root, options);
    console.log(flags.json ? JSON.stringify(result, null, 2) : `${result.outcome}\n${result.complete ? JSON.stringify(result.binding) : result.gaps.join('\n')}`);
    if (flags.strict && !result.complete) process.exitCode = 1;
  } catch { console.error('Move 参数、配置或边界不可用 [curia2/move-unavailable]'); process.exitCode = 2; }
}
if (isMainModule(import.meta.url)) movesMain();
