import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const DIR = import.meta.dirname;
const CLI = join(import.meta.dirname, '..', 'qq.mjs');
const LOG = join(DIR, 'calls.log');
// 用测试自己的审计文件，绝不能碰生产用的 ~/.zcode/skills/qq-group/audit.log
const AUDIT = join(DIR, 'audit.test.log');
const PORT = 3999;

for (const f of [LOG, AUDIT]) if (existsSync(f)) rmSync(f);

const env = {
  ...process.env,
  NAPCAT_HTTP: `http://127.0.0.1:${PORT}`,
  MOCK_LOG: LOG,
  QQ_GROUP_AUDIT: AUDIT,
  // 默认放开全部写操作，好让下面的用例能分别验证只读闸门和确认闸门；
  // 白名单本身在"命令白名单"一节单独测。
  QQ_GROUP_ALLOWED_WRITES: 'kick,mute,admin,card,rename,wholeban,dismiss',
};
const mock = spawn(process.execPath, [join(DIR, 'mock.mjs')], { env, stdio: 'ignore' });
await sleep(700);

let pass = 0;
let fail = 0;

function run(args) {
  return runWith({}, args);
}

function runWith(extraEnv, args) {
  const e = { ...env, ...extraEnv };
  try {
    const out = execFileSync(process.execPath, [CLI, ...args], { env: e, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, out, err: '' };
  } catch (err) {
    return { code: err.status ?? 1, out: err.stdout ?? '', err: err.stderr ?? '' };
  }
}

function check(name, cond, detail) {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}\n        ${detail}`);
  }
}

const lines = (s) => s.trim().split('\n').filter(Boolean);
const calls = () =>
  existsSync(LOG) ? readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
const lastOf = (a) => calls().filter((c) => c.action === a).pop();

console.log('\n--- 基础 ---');
let r = run(['doctor']);
check('doctor 连上并报账号', r.code === 0 && /10001/.test(r.out), `code=${r.code} out=${r.out} err=${r.err}`);

r = run(['groups']);
check('groups 每群一行', lines(r.out).length === 2 && r.out.includes('987654'), r.out);

r = run(['groups', '测试']);
check('groups 关键词过滤出两个', r.out.includes('987654') && r.out.includes('111111'), r.out);

console.log('\n--- 匹配分级 ---');
// 「测试群」精确同名，应直接命中，不被「另一个测试群」拖成歧义
r = run(['kick', '测试群', '李四', '--dry-run']);
check('精确同名优先于子串', r.code === 0 && r.out.includes('987654'), `code=${r.code} out=${r.out} err=${r.err}`);

// 「群」两个字都只是子串，同档 → 真歧义
r = run(['kick', '群', '李四', '--dry-run']);
check('同档多命中判定歧义', r.code === 2 && r.err.includes('987654') && r.err.includes('111111'), `code=${r.code} err=${r.err}`);

console.log('\n--- 成员查找 ---');
r = run(['find', '测试群', '张三']);
check('find 重名返回两条', lines(r.out).length === 2 && r.out.includes('10002') && r.out.includes('10003'), r.out);

r = run(['find', '987654', '李四']);
check('find 支持群号+昵称', r.out.includes('10004'), r.out);

r = run(['find', '测试群', '张三他弟']);
check('find 精确度够时只回一条', lines(r.out).length === 1 && r.out.includes('10003'), r.out);

r = run(['find', '测试群', '不存在的人']);
check('find 查不到时不报错', r.code === 0 && /没有匹配/.test(r.out), `code=${r.code} ${r.out}`);

console.log('\n--- 歧义与保护 ---');
const kicksBefore = calls().filter((c) => c.action === 'set_group_kick').length;

r = run(['kick', '测试群', '张三', '--dry-run']);
check('重名 kick 拒绝并列候选', r.code === 2 && r.err.includes('10002') && r.err.includes('10003'), `code=${r.code} err=${r.err}`);
check('重名时未发出 set_group_kick', calls().filter((c) => c.action === 'set_group_kick').length === kicksBefore, '');

r = run(['kick', '测试群', '群主老王', '--dry-run']);
check('群主被拒（dry-run 也拦）', r.code === 1 && /群主/.test(r.err), `code=${r.code} err=${r.err}`);

r = run(['kick', '测试群', '机器人', '--dry-run']);
check('拒绝踢机器人自己', r.code === 1 && /机器人自己/.test(r.err), `code=${r.code} err=${r.err}`);

r = run(['dismiss', '测试群', '--dry-run']);
check('非群主时拒绝解散', r.code === 1 && /群主/.test(r.err), `code=${r.code} err=${r.err}`);

console.log('\n--- 写操作必须带 --confirm ---');
const writesBefore = calls().filter((c) => c.action.startsWith('set_group')).length;
for (const args of [
  ['kick', '测试群', '李四'],
  ['mute', '测试群', '李四', '10m'],
  ['admin', '测试群', '李四', 'on'],
  ['card', '测试群', '李四', 'x'],
  ['rename', '测试群', 'y'],
  ['wholeban', '测试群', 'on'],
  ['dismiss', '测试群'],
]) {
  r = run(args);
  check(`未确认时拒绝 ${args[0]}`, r.code === 1 && /需要用户明确同意/.test(r.err), `code=${r.code} err=${r.err}`);
}
check('未确认期间未发出任何写请求', calls().filter((c) => c.action.startsWith('set_group')).length === writesBefore, '');

r = run(['kick', '测试群', '李四', '--confirm', '--dry-run']);
check('--confirm 与 --dry-run 同时给时不写', r.code === 0 && /dry-run/.test(r.out) && calls().filter((c) => c.action.startsWith('set_group')).length === writesBefore, r.out);

console.log('\n--- 正常执行（已确认）---');
r = run(['kick', '测试群', '李四', '--dry-run']);
check('dry-run 无副作用', r.code === 0 && /dry-run/.test(r.out) && calls().filter((c) => c.action === 'set_group_kick').length === kicksBefore, r.out);

r = run(['kick', '测试群', '李四', '--reject', '--confirm']);
let k = lastOf('set_group_kick');
check('昵称解析出正确 QQ 号与群号', k && k.params.user_id === 10004 && k.params.group_id === 987654, JSON.stringify(k));
check('--reject 透传为 true', k && k.params.reject_add_request === true, JSON.stringify(k));
check('输出单行且含被踢人 QQ 号', lines(r.out).length === 1 && r.out.includes('10004'), r.out);

r = run(['mute', '测试群', '李四', '10m', '--confirm']);
check('10m → 600 秒', lastOf('set_group_ban')?.params.duration === 600, JSON.stringify(lastOf('set_group_ban')));

r = run(['mute', '测试群', '李四', '--confirm']);
check('默认 600 秒', lastOf('set_group_ban')?.params.duration === 600, JSON.stringify(lastOf('set_group_ban')));

r = run(['mute', '测试群', '李四', '0', '--confirm']);
check('0 → 解禁', lastOf('set_group_ban')?.params.duration === 0 && /解除禁言/.test(r.out), JSON.stringify(lastOf('set_group_ban')) + r.out);

console.log('\n--- info 自查 ---');
r = run(['info', '测试群', '李四']);
check('info 显示未禁言', r.code === 0 && /未禁言/.test(r.out) && r.out.includes('10004'), r.out);

r = run(['mute', '测试群', '李四', '90', '--confirm']);
r = run(['info', '测试群', '李四']);
check('info 能读出真实禁言剩余', r.code === 0 && /禁言剩余 \d+s/.test(r.out), r.out);

r = run(['mute', '测试群', '李四', '0', '--confirm']);
r = run(['info', '测试群', '李四']);
check('解禁后 info 回到未禁言', r.code === 0 && /未禁言/.test(r.out), r.out);

r = run(['info', '测试群', '群主老王']);
check('info 显示角色', r.code === 0 && /owner/.test(r.out), r.out);

r = runWith({ QQ_GROUP_READONLY: '1' }, ['info', '测试群', '李四']);
check('只读模式下 info 仍可用', r.code === 0 && r.out.includes('10004'), `code=${r.code} ${r.err}`);

r = run(['mute', '测试群', '李四', 'abc', '--confirm']);
check('非法时长被拒', r.code === 1 && /时长格式/.test(r.err), `code=${r.code} ${r.err}`);

r = run(['admin', '测试群', '李四', 'maybe', '--confirm']);
check('admin 非法参数被拒', r.code === 1 && /on 或 off/.test(r.err), `code=${r.code} ${r.err}`);

r = run(['admin', '测试群', '李四', 'on', '--confirm']);
check('admin on 生效', lastOf('set_group_admin')?.params.enable === true, JSON.stringify(lastOf('set_group_admin')));

r = run(['wholeban', '测试群', 'on', '--confirm']);
check('wholeban 传 enable=true', lastOf('set_group_whole_ban')?.params.enable === true, JSON.stringify(lastOf('set_group_whole_ban')));

r = run(['card', '测试群', '李四', '新名片', '--confirm']);
check('改群名片', lastOf('set_group_card')?.params.card === '新名片', JSON.stringify(lastOf('set_group_card')));

r = run(['rename', '测试群', '新群名', '--confirm']);
check('改群名', lastOf('set_group_name')?.params.group_name === '新群名', JSON.stringify(lastOf('set_group_name')));

console.log('\n--- 只读模式 ---');
r = runWith({ QQ_GROUP_READONLY: '1' }, ['doctor']);
check('doctor 显示只读', r.code === 0 && /只读/.test(r.out), r.out);

const writeCallsBefore = calls().filter((c) => c.action.startsWith('set_group')).length;

for (const args of [
  ['kick', '测试群', '李四'],
  ['mute', '测试群', '李四', '10m'],
  ['admin', '测试群', '李四', 'on'],
  ['card', '测试群', '李四', 'x'],
  ['rename', '测试群', 'y'],
  ['wholeban', '测试群', 'on'],
  ['dismiss', '测试群'],
]) {
  r = runWith({ QQ_GROUP_READONLY: '1' }, args);
  check(`只读拦截 ${args[0]}`, r.code === 1 && /只读模式/.test(r.err), `code=${r.code} err=${r.err}`);
}
check('只读期间未发出任何写请求', calls().filter((c) => c.action.startsWith('set_group')).length === writeCallsBefore, '');

r = runWith({ QQ_GROUP_READONLY: '1' }, ['kick', '测试群', '李四', '--dry-run']);
check('只读下 dry-run 仍可用', r.code === 0 && /dry-run/.test(r.out), `code=${r.code} out=${r.out} err=${r.err}`);

r = runWith({ QQ_GROUP_READONLY: '1' }, ['groups']);
check('只读下查询正常', r.code === 0 && r.out.includes('987654'), r.out);

r = runWith({ QQ_GROUP_READONLY: '0' }, ['kick', '测试群', '李四', '--dry-run']);
check('QQ_GROUP_READONLY=0 可写', r.code === 0 && /dry-run/.test(r.out), `code=${r.code} ${r.err}`);

console.log('\n--- 命令白名单（默认只放 kick）---');
const kicksN = () => calls().filter((c) => c.action === 'set_group_kick').length;
const writesN = () => calls().filter((c) => c.action.startsWith('set_group')).length;

const beforeW = writesN();
for (const args of [
  ['mute', '测试群', '李四', '10m', '--confirm'],
  ['admin', '测试群', '李四', 'on', '--confirm'],
  ['card', '测试群', '李四', 'x', '--confirm'],
  ['rename', '测试群', 'y', '--confirm'],
  ['wholeban', '测试群', 'on', '--confirm'],
  ['dismiss', '测试群', '--confirm'],
]) {
  r = runWith({ QQ_GROUP_ALLOWED_WRITES: 'kick' }, args);
  check(`白名单外拒绝 ${args[0]}`, r.code === 1 && /已禁用/.test(r.err), `code=${r.code} err=${r.err}`);
}
check('白名单外的操作未发出任何请求', writesN() === beforeW, '');

r = runWith({ QQ_GROUP_ALLOWED_WRITES: 'kick' }, ['mute', '测试群', '李四', '--dry-run']);
check('白名单不影响 dry-run', r.code === 0 && /dry-run/.test(r.out), `code=${r.code} ${r.err}`);

r = runWith({ QQ_GROUP_ALLOWED_WRITES: 'kick' }, ['groups']);
check('白名单不影响读操作', r.code === 0 && r.out.includes('987654'), r.out);

r = runWith({ QQ_GROUP_ALLOWED_WRITES: 'kick' }, ['kick', '测试群', '李四']);
check('白名单内仍必须 --confirm', r.code === 1 && /需要用户明确同意/.test(r.err), `code=${r.code} ${r.err}`);

const kb = kicksN();
r = runWith({ QQ_GROUP_ALLOWED_WRITES: 'kick' }, ['kick', '测试群', '李四', '--confirm']);
check('白名单内 kick 正常执行', r.code === 0 && kicksN() === kb + 1 && r.out.includes('10004'), r.out);

r = runWith({ QQ_GROUP_ALLOWED_WRITES: '' }, ['kick', '测试群', '李四', '--confirm']);
check('白名单为空时连 kick 也禁用', r.code === 1 && /已禁用/.test(r.err), `code=${r.code} ${r.err}`);

r = runWith({ QQ_GROUP_ALLOWED_WRITES: 'dismiss' }, ['dismiss', '测试群', '--confirm']);
check(
  '放开 dismiss 后通过白名单，改由群主保护拦下',
  r.code === 1 && /群主/.test(r.err) && !/已禁用/.test(r.err),
  `code=${r.code} err=${r.err}`,
);

r = runWith({ QQ_GROUP_ALLOWED_WRITES: 'card' }, ['card', '测试群', '李四', '新名片2', '--confirm']);
check(
  '按需放开 card 后可正常执行',
  r.code === 0 && lastOf('set_group_card')?.params.card === '新名片2',
  `code=${r.code} ${r.err} ${JSON.stringify(lastOf('set_group_card'))}`,
);

console.log('\n--- 未知命令与审计 ---');
r = run(['nonsense']);
check('未知命令报错而非误操作', r.code === 1 && /未知命令/.test(r.err), `code=${r.code} ${r.err}`);

const audit = existsSync(AUDIT) ? readFileSync(AUDIT, 'utf8') : '';
check('kick 写入审计', /kick\t987654\t10004/.test(audit), audit.slice(-160));
check('mute 写入审计', /mute\t987654\t10004\t0/.test(audit), audit.slice(-160));

mock.kill();
console.log(`\n结果: ${pass} 通过, ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
