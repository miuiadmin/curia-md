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
//     运行位置以[服务器统一开发修订]为准：本义是在调试云本机执行（工具链落地后，
//     DSN 指本机 5433）。过渡期隧道配方保留但非新配方（被该修订否决）：
//       sh deploy/debugcloud/tunnel-pg.sh start
//       DSN=postgres://<DB_USER>:<口令>@127.0.0.1:15433/Curia_test_mac?sslmode=disable
//   CURIA_TEST_DOCKER=1          沙箱真容器测试——需 docker 守护进程在调试云：
//     现况用户不在调试云 docker 组（socket 拒绝），DOCKER_HOST=ssh://debugcloud
//     暂不可用；解前本档只在具备 daemon 权限处跑（待办见本地无运行时笔记）。
//   CURIA_TEST_CLI=1             apps/cli npm test（无容器依赖，本地可跑）
//   CURIA_TEST_PI_PROTOCOL_BIN   真实 Pi 旅程
// 退出码：全档绿 0；任何档红 1；一档未配且未加 --default-missing-ok 也红
// （「没跑」不等于「过了」——深门的目的就是消灭这句话）。

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

// go 从 PATH 取（云上统一开发：脚本须在调试云原生可跑）；CURIA_GO_BIN 可覆盖。
// 各档 env 必须 ...process.env 再覆盖——显式对象会抹掉 PATH（Mac 绝对路径曾掩盖此坑）。
const childEnv = (extra) => ({ ...process.env, ...extra });
const GO = process.env.CURIA_GO_BIN || 'go';
const BACKEND = 'apps/backend';
const tiers = [
  {
    name: 'PG 显式矩阵',
    active: () => !!process.env.CURIA_TEST_PG_DSN,
    // -p 1 与 -timeout 30m 是隧道过渡期实测所加（并行压垮单隧道致 262 个 cleanup
    // 超时假红；flow 包累计超 go test 默认 10m 被杀）——在调试云本机执行时可评估
    // 放开，两值在任何环境都无害，先保守保留。
    // -timeout 30m：每测试都建库+全迁移，flow 包累计超默认 10m。
    run: () => run(`${GO} test ./... -count=1 -p 1 -timeout 30m`, { cwd: BACKEND, env: childEnv({ CURIA_TEST_PG_DSN: process.env.CURIA_TEST_PG_DSN }) }),
  },
  {
    name: 'Docker 沙箱',
    active: () => process.env.CURIA_TEST_DOCKER === '1',
    run: () => run(`${GO} test ./internal/sandbox/... ./internal/flow/... -count=1`, { cwd: BACKEND, env: childEnv({ CURIA_TEST_DOCKER: '1', CURIA_TEST_PG_DSN: process.env.CURIA_TEST_PG_DSN ?? '' }) }),
  },
  {
    name: 'CLI npm test',
    active: () => process.env.CURIA_TEST_CLI === '1' && existsSync('apps/cli/package.json'),
    run: () => run('npm test --silent', { cwd: 'apps/cli' }),
  },
  {
    name: '真实 Pi 旅程',
    active: () => !!process.env.CURIA_TEST_PI_PROTOCOL_BIN,
    // 模式与 gate 变量对齐：ActualPi/SandboxModel 是 CURIA_TEST_PI_PROTOCOL_BIN
    // 真正 gated 的测试名（2026-10-08 修正：原模式漏掉它们＝空转假绿）。
    run: () => run(`${GO} test ./cmd/curiad/ -count=1 -timeout 30m -run 'ActualPi|SandboxModel|Journey|Hosted'`, { cwd: BACKEND, env: childEnv({ CURIA_TEST_PI_PROTOCOL_BIN: process.env.CURIA_TEST_PI_PROTOCOL_BIN, CURIA_TEST_PG_DSN: process.env.CURIA_TEST_PG_DSN ?? '' }) }),
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
