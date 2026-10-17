#!/usr/bin/env node
/**
 * new-doc.mjs —— Curia 2.1 建档脚本：按类型生成骨架、算目标路径、创建一个新文件（纯 node 标准库、零依赖、不联网）。
 * 用法：node .agents/tools/new-doc.mjs --type <9 类之一> --topic <topic> ｜ --list
 * 路径 = 家 + 命名规则：日期型 → .agents/<家>/<yyyy-mm-dd>-<topic>.md（主题段限中英文、数字与 . _ -）；固定名 →
 * .agents/skills/<topic>/SKILL.md 或 RUNBOOK.md（<topic> 成为目录名，必须 kebab-case）。
 * 自包含：类型与骨架内嵌，不读配置文件、不 import 共享库；骨架在规范「规范格式」一节可手抄。
 * 只创建一个新文件；目标已存在即拒绝覆盖（退出码非 0）。
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 工作区根：脚本住 <root>/.agents/tools/，从脚本位置反推，与当前工作目录无关。 */
const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const KEBAB_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/; // 固定名类型的 topic 即目录名，须与检查器组 5c 同一口径
const CJK_CLASS = '\\u3400-\\u4fff\\u4e00-\\u9fff\\uf900-\\ufaff'; // 与检查器组 7 同一字符集（标题中英边界补空格用）

/** 类型表（逐字对规范「9 类文档」与「状态与退役」表）：home = 家，naming = 命名规则，status = 初始 Status，summary = 骨架一句话说明，sections = 建议节。 */
const TYPES = {
  proposal: { home: 'plans', naming: 'dated', status: 'draft', summary: '为什么值得做，做成什么样算成功。', sections: ['背景', '目标', '成功判据', '方案选项'] },
  spec: { home: 'plans', naming: 'dated', status: 'draft', summary: '这份规格约束的对象是什么。', sections: ['背景', '范围', '契约', '验收标准', '适用边界'] },
  plan: { home: 'plans', naming: 'dated', status: 'draft', summary: '这份计划要交付什么。', sections: ['背景', '步骤', '未完成事项'] },
  survey: { home: 'research', naming: 'dated', status: 'current', summary: '查了什么，最关键的结论是什么。', sections: ['问题', '方法与来源', '结论', '证据与出处', '适用边界'] },
  evidence: { home: 'research', naming: 'dated', status: 'current', summary: '采集了什么、什么时候采的。', sections: ['采集内容', '采集方式', '适用边界'] },
  postmortem: { home: 'research', naming: 'dated', status: 'current', summary: '什么时候、什么坏了、根因是什么。', sections: ['事故概述', '时间线', '影响', '因果链', '预防', '行动项'] },
  reference: { home: 'research', naming: 'dated', status: 'current', summary: '这份参考映射的是哪个外部系统的哪些事实。', sections: ['事实映射', '方法与来源', '维护方式', '适用边界'] },
  runbook: { home: 'skills', naming: 'fixed', status: 'current', summary: '这份手册完成什么操作、面向谁。', sections: ['前置条件', '步骤', '验证', '失败与恢复'], fileName: 'RUNBOOK.md' },
  skill: { home: 'skills', naming: 'fixed', status: null, sections: ['步骤', '边界'], fileName: 'SKILL.md' },
};

function usage(msg) {
  if (msg) console.error(`new-doc: ${msg}`);
  console.error('用法：node .agents/tools/new-doc.mjs --type <9 类之一> --topic <topic> ｜ --list');
  process.exit(msg ? 1 : 0);
}

/** 骨架文本（纯函数）：标题 + 头块（skill 用 frontmatter，其余 3 行头块）+ 一句话说明 + 建议节标题。 */
function renderScaffold(type, topic, date) {
  const t = TYPES[type], title = topic.split('-').filter(Boolean).join(' ').replace(new RegExp(`([${CJK_CLASS}])([A-Za-z0-9])`, 'g'), '$1 $2').replace(new RegExp(`([A-Za-z0-9])([${CJK_CLASS}])`, 'g'), '$1 $2'); // 连字符转空格；中英边界补空格（与检查器组 7 同字符集，产物即恒合规）
  const head = type === 'skill'
    ? ['---', `name: ${topic}`, 'description: <什么时候用这个技能：触发场景 + 用户会说的关键词，一句话写完>', '---', '', `# ${title}`, '', '权威来源：<相对链接到规则归属>。本技能是流程，不是契约的归属；两者冲突时以归属文档为准。', '']
    : [`# ${title}`, '', `Type: ${type}`, `Status: ${t.status}`, `Updated: ${date}`, '', `一句话说明：${t.summary}`, ''];
  const lines = [...head];
  for (const section of t.sections) lines.push(`## ${section}`, '');
  return lines.join('\n');
}

/** 打印类型表与用法。 */
function listTypes() {
  console.log('Curia 2.1 类型表（9 类）：\n');
  for (const [type, t] of Object.entries(TYPES)) {
    console.log(`  ${type.padEnd(11)}${t.home.padEnd(10)}${t.naming === 'dated' ? '日期型' : '固定名'}  ${t.status ? `Status: ${t.status}` : '无 Status（frontmatter 即身份）'}  建议节：${t.sections.join('、')}`);
  }
  console.log('\n命名：日期型 → .agents/<家>/<yyyy-mm-dd>-<topic>.md；固定名 → .agents/skills/<topic>/SKILL.md 或 RUNBOOK.md');
  console.log('用法：node .agents/tools/new-doc.mjs --type <类型> --topic <topic>');
}

function main() {
  const args = process.argv.slice(2);
  const argOf = (name) => { const i = args.indexOf(`--${name}`); return i === -1 ? null : (args[i + 1] ?? null); };
  if (args.includes('--list')) return listTypes();
  if (args.includes('-h') || args.includes('--help')) usage();
  if (!args.length) usage('缺少 --type 与 --topic');
  const type = argOf('type'), topic = argOf('topic');
  if (!type || !TYPES[type]) usage(`--type 必须是 9 类之一${type ? `，实为 \`${type}\`` : ''}；用 --list 看类型表`);
  if (!topic) usage('--topic 不能为空；用 --list 看类型表');
  if (!/^[\p{Script=Han}A-Za-z0-9][\p{Script=Han}A-Za-z0-9._-]*$/u.test(topic)) usage(`--topic 只允许中英文、数字与 . _ -（须以中英文或数字开头），实为 \`${topic}\`；多词用连字符`);
  const t = TYPES[type];
  if (t.naming === 'fixed' && !KEBAB_RE.test(topic)) usage(`固定名类型的 --topic 会成为目录名，必须 kebab-case（小写字母、数字、连字符），实为 \`${topic}\``);
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  const rel = t.naming === 'dated' ? `.agents/${t.home}/${date}-${topic}.md` : `.agents/${t.home}/${topic}/${t.fileName}`;
  const abs = join(ROOT, rel);
  try {
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, renderScaffold(type, topic, date), { flag: 'wx' }); // wx：已存在即失败，「拒绝覆盖」不靠检查-后-写两步（防并发窗口）
  } catch (e) {
    usage(e.code === 'EEXIST' ? `目标已存在，拒绝覆盖：${rel}` : `建档失败（${e.code ?? e.message}）：${rel}`);
  }
  console.log(`✓ 已建档 ${rel}（类型 ${type}${t.status ? `，Status: ${t.status}` : '，无 Status（frontmatter）'}）`);
  console.log('  下一步：按建议节填内容；改完可跑 node .agents/tools/check-docs.mjs 自检（可选）。');
}

main();
