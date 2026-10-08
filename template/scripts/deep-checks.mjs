#!/usr/bin/env node
// deep-checks.mjs —— 深门矩阵一条命令化（最终方案 Phase 0）。
// 缘起（机制冻结规则的第 1 类信号：门禁漏了真问题）：假绿三犯（shimoapi 认领
// 正则、run_events 越界、飞书 rows/data）全部发生在「默认 go test 全绿」的
// 树上——默认矩阵 76% 跳过，真相只在显式矩阵里。本脚本把四档深门固化为
// 一条命令，产出统一证明物；无 CI 前它就是「本地通过」的唯一凭据。
//
// 用法：node scripts/deep-checks.mjs [--default-missing-ok]
// 档位由环境变量决定（未设置的档跳过并黄牌提示，全跳过即红牌退出）：
//   CURIA_TEST_PG_DSN            显式 PG（test-only 标记库）→ go test ./... -count=1
//   CURIA_TEST_DOCKER=1          沙箱真容器测试
//   CURIA_TEST_CLI=1             apps/cli npm test
//   CURIA_TEST_PI_PROTOCOL_BIN   真实 Pi 旅程
// 退出码：全档绿 0；任何档红 1；一档未配且未加 --default-missing-ok 也红
// （「没跑」不等于「过了」——深门的目的就是消灭这句话）。

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const GO = '/opt/homebrew/bin/go';
const BACKEND = 'apps/backend';
const tiers = [
  {
    name: 'PG 显式矩阵',
    active: () => !!process.env.CURIA_TEST_PG_DSN,
    run: () => run(`${GO} test ./... -count=1`, { cwd: BACKEND, env: { CURIA_TEST_PG_DSN: process.env.CURIA_TEST_PG_DSN } }),
  },
  {
    name: 'Docker 沙箱',
    active: () => process.env.CURIA_TEST_DOCKER === '1',
    run: () => run(`${GO} test ./internal/sandbox/... ./internal/flow/... -count=1`, { cwd: BACKEND, env: { CURIA_TEST_DOCKER: '1', CURIA_TEST_PG_DSN: process.env.CURIA_TEST_PG_DSN ?? '' } }),
  },
  {
    name: 'CLI npm test',
    active: () => process.env.CURIA_TEST_CLI === '1' && existsSync('apps/cli/package.json'),
    run: () => run('npm test --silent', { cwd: 'apps/cli' }),
  },
  {
    name: '真实 Pi 旅程',
    active: () => !!process.env.CURIA_TEST_PI_PROTOCOL_BIN,
    run: () => run(`${GO} test ./cmd/curiad/ -count=1 -run 'Integration|Journey|Hosted'`, { cwd: BACKEND, env: { CURIA_TEST_PI_PROTOCOL_BIN: process.env.CURIA_TEST_PI_PROTOCOL_BIN, CURIA_TEST_PG_DSN: process.env.CURIA_TEST_PG_DSN ?? '' } }),
  },
];

function run(cmd, opts) {
  execSync(cmd, { stdio: 'inherit', ...opts });
}

const missingOk = process.argv.includes('--default-missing-ok');
const active = tiers.filter((t) => t.active());
console.log(`深门矩阵：${active.length}/${tiers.length} 档就绪`);
for (const t of tiers) {
  if (!t.active()) {
    console.log(`  [跳过] ${t.name}（环境变量未设）`);
    continue;
  }
  console.log(`  [运行] ${t.name}`);
  try {
    t.run();
  } catch {
    console.error(`✗ ${t.name} 红——深门未过，禁止宣称「测试通过」`);
    process.exit(1);
  }
}
if (active.length === 0 && !missingOk) {
  console.error("✗ 一档未配——「没跑」不等于「过了」；配好环境变量或显式加 --default-missing-ok")
  process.exit(1);
}
console.log('✓ 深门矩阵全绿（就绪档全部通过）');
