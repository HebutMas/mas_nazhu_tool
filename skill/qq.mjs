#!/usr/bin/env node
/**
 * qq — NapCat / OneBot 11 群管理 CLI（零依赖，Node 18+）
 *
 * 设计约束：昵称→QQ号 的解析必须在本进程内完成。
 * 一旦把 get_group_member_list 的原始结果交给模型，一个 500 人群就是几万 token；
 * 因此所有输出都收敛成单行，成员表默认不落地。
 */
import { readFileSync, appendFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const SKILL_DIR = join(homedir(), '.zcode', 'skills', 'qq-group');

function loadConfig() {
  const cfg = {
    http: 'http://127.0.0.1:3000',
    token: '',
    auditLog: join(SKILL_DIR, 'audit.log'),
    listLimit: 60,
    readonly: false,
    // 只保留实际用得到的写操作。dismiss 不可逆，留在那里是纯风险面。
    allowedWrites: ['kick'],
  };
  const paths = [process.env.QQ_GROUP_CONFIG, join(SKILL_DIR, 'config.json')].filter(Boolean);
  for (const p of paths) {
    if (existsSync(p)) {
      try {
        Object.assign(cfg, JSON.parse(readFileSync(p, 'utf8')));
      } catch (e) {
        fail(`配置文件解析失败 ${p}: ${e.message}`);
      }
      break;
    }
  }
  if (process.env.NAPCAT_HTTP) cfg.http = process.env.NAPCAT_HTTP;
  if (process.env.NAPCAT_TOKEN) cfg.token = process.env.NAPCAT_TOKEN;
  if (process.env.QQ_GROUP_READONLY !== undefined) cfg.readonly = process.env.QQ_GROUP_READONLY !== '0';
  if (process.env.QQ_GROUP_AUDIT) cfg.auditLog = process.env.QQ_GROUP_AUDIT;
  if (process.env.QQ_GROUP_ALLOWED_WRITES !== undefined) {
    cfg.allowedWrites = process.env.QQ_GROUP_ALLOWED_WRITES.split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  cfg.http = cfg.http.replace(/\/+$/, '');
  if (cfg.auditLog) cfg.auditLog = cfg.auditLog.replace(/^~(?=[\\/]|$)/, homedir());
  return cfg;
}

// 用抛异常 + process.exitCode 而不是 process.exit()：在 Windows/Node 24 上，
// fetch 未结束时调 process.exit() 会触发 libuv 断言崩溃，退出码变成 0xC0000409。
class CliError extends Error {
  constructor(message, code = 1) {
    super(message);
    this.code = code;
  }
}

function fail(msg, code = 1) {
  throw new CliError(msg, code);
}

function reject(msg) {
  process.stderr.write(`✘ ${msg}\n`);
  throw new CliError('', 2);
}

function audit(cfg, line) {
  try {
    appendFileSync(cfg.auditLog, `${new Date().toISOString()}\t${line}\n`);
  } catch {
    /* 审计日志失败不该阻断操作 */
  }
}

async function call(cfg, action, params = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (cfg.token) headers.Authorization = `Bearer ${cfg.token}`;
  let res;
  try {
    res = await fetch(`${cfg.http}/${action}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(params),
    });
  } catch (e) {
    fail(
      `连不上 NapCat（${cfg.http}）：${e.message}\n` +
        `  先确认 NapCat 在跑，或用 NAPCAT_HTTP / ${join(SKILL_DIR, 'config.json')} 改地址。`,
    );
  }
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    fail(`${action} 返回的不是 JSON（HTTP ${res.status}）：${text.slice(0, 200)}`);
  }
  if (json.retcode !== 0) {
    fail(`${action} 失败 retcode=${json.retcode} ${json.message || json.wording || ''}`.trim());
  }
  return json.data;
}

// 精确同名 > 前缀 > 子串。只有同一档里出现多个才算歧义，
// 否则「测试群」会被「另一个测试群」这种名字拖成歧义。
function tier(text, q) {
  if (!text) return 0;
  const t = String(text).toLowerCase();
  if (t === q) return 3;
  if (t.startsWith(q)) return 2;
  if (t.includes(q)) return 1;
  return 0;
}

function bestHits(items, q, fields) {
  let best = 0;
  const scored = items.map((it) => {
    const s = Math.max(...fields.map((f) => tier(it[f], q)));
    if (s > best) best = s;
    return { it, s };
  });
  return best > 0 ? scored.filter((x) => x.s === best).map((x) => x.it) : [];
}

async function resolveGroup(cfg, q) {
  if (/^\d+$/.test(q)) return { group_id: Number(q), group_name: '' };
  const groups = await call(cfg, 'get_group_list');
  const hits = bestHits(groups, q.toLowerCase(), ['group_name', 'group_id']);
  if (hits.length === 0) fail(`找不到匹配「${q}」的群，用 \`qq groups\` 看列表。`);
  if (hits.length > 1) {
    const list = hits
      .slice(0, 10)
      .map((g) => `  ${g.group_id}  ${g.group_name}（${g.member_count ?? '?'}人）`)
      .join('\n');
    reject(`「${q}」匹配到多个群，请指定更精确的名字或直接用群号：\n${list}`);
  }
  return hits[0];
}

async function resolveMember(cfg, groupId, q) {
  const members = await call(cfg, 'get_group_member_list', { group_id: groupId });
  if (/^\d+$/.test(q)) {
    const hit = members.find((m) => String(m.user_id) === q);
    if (!hit) fail(`群里没有 QQ 号 ${q} 这个成员。`);
    return hit;
  }
  const hits = bestHits(members, q.toLowerCase(), ['card', 'nickname']);
  if (hits.length === 0) fail(`群里没有昵称/群名片匹配「${q}」的成员。`);
  if (hits.length > 1) {
    const list = hits
      .slice(0, 10)
      .map((m) => `  ${m.user_id}  ${m.card || m.nickname}${m.card ? `（${m.nickname}）` : ''}  ${m.role}`)
      .join('\n');
    reject(`「${q}」匹配到 ${hits.length} 人，请用 QQ 号指定：\n${list}`);
  }
  return hits[0];
}

function label(m) {
  const name = m.card || m.nickname || '(无昵称)';
  return m.card && m.nickname && m.card !== m.nickname ? `${name}（${m.nickname}）` : name;
}

function groupLabel(g) {
  return g.group_name ? `${g.group_name}(${g.group_id})` : String(g.group_id);
}

async function guardTarget(cfg, member) {
  if (member.role === 'owner') {
    fail(`拒绝执行：${label(member)} 是群主，踢不掉也不该踢。`);
  }
  let self = null;
  try {
    self = await call(cfg, 'get_login_info');
  } catch {
    /* 拿不到自身账号就跳过自踢检查 */
  }
  if (self && String(self.user_id) === String(member.user_id)) {
    fail(`拒绝执行：${label(member)} 就是机器人自己。`);
  }
  if (member.role === 'admin') {
    process.stderr.write(`⚠ 注意：${label(member)} 是管理员，操作可能失败。\n`);
  }
}

function parseDuration(s) {
  if (s === undefined) return 600;
  const m = String(s).trim().match(/^(\d+)\s*([smhd]?)$/);
  if (!m) fail(`时长格式不对：${s}（可用 600 / 10m / 1h / 0=解禁）`);
  const n = Number(m[1]);
  const mul = { '': 1, s: 1, m: 60, h: 3600, d: 86400 }[m[2]];
  return n * mul;
}

const HELP = `qq — NapCat 群管理（输出刻意保持单行）

  qq doctor                          连接与账号状态
  qq groups [关键词]                 群列表（仅群号+群名+人数）
  qq find <群> <关键词>              在群里找成员（推荐，只回匹配项）
  qq info <群> <目标>                角色与禁言状态（写操作后用它自查是否真生效）
  qq members <群>                    成员列表（费 token，尽量别用）

  qq kick <群> <目标> [--reject]     踢人；--reject 同时拒绝其再加群
  qq mute <群> <目标> [时长]         禁言，默认 600s，0 = 解禁
  qq admin <群> <目标> <on|off>      设置/取消管理员
  qq card <群> <目标> <新名片>       改群名片
  qq rename <群> <新群名>            改群名
  qq wholeban <群> <on|off>          全员禁言
  qq dismiss <群>                    解散群（危险）

  <群>   = 群号或群名关键词    <目标> = QQ号或昵称/群名片关键词
  --dry-run     只解析并显示将要操作谁，不真正执行（任何情况下都可用）
  --confirm     确认执行写操作。只有在用户明确同意这一次操作后才能加，
                否则命令会被拒绝
  --json        输出原始 JSON（默认关，省 token）`;

const WRITE_CMDS = new Set(['kick', 'mute', 'admin', 'card', 'rename', 'wholeban', 'dismiss']);

async function main() {
  const cfg = loadConfig();
  const argv = process.argv.slice(2);
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const [cmd, ...args] = argv.filter((a) => !a.startsWith('--'));
  const dryRun = flags.has('--dry-run');

  if (!cmd || cmd === 'help' || flags.has('--help')) {
    process.stdout.write(HELP + '\n');
    return;
  }

  const confirm = flags.has('--confirm');

  // 写操作有两道闸门，都必须过：
  //   readonly  全局闸门，用户想整体停掉写操作时用
  //   --confirm 逐次闸门，代表"这一次操作已获得用户明确同意"
  // --dry-run 没有副作用，任何情况下都放行，用来给用户看将要发生什么。
  if (WRITE_CMDS.has(cmd) && !dryRun) {
    if (!cfg.allowedWrites.includes(cmd)) {
      fail(
        `已禁用 ${cmd}。当前只允许这些写操作：${cfg.allowedWrites.join('、') || '无'}。\n` +
          `  确实需要的话，把 config.json 的 allowedWrites 里加上 "${cmd}"。`,
      );
    }
    if (cfg.readonly) {
      fail(
        `只读模式已开启，拒绝执行 ${cmd}。\n` +
          `  改 config.json 的 readonly:false，或设 QQ_GROUP_READONLY=0 后重试；\n` +
          `  只想预览要动谁，加 --dry-run。`,
      );
    }
    if (!confirm) {
      fail(
        `写操作需要用户明确同意，已拒绝执行 ${cmd}。\n` +
          `  步骤 1：先用 --dry-run 跑同一条命令，把结果原样给用户看；\n` +
          `  步骤 2：用户明确同意后，再加 --confirm 重跑。\n` +
          `  用户没同意之前，绝对不要加 --confirm。`,
      );
    }
  }

  const raw = (data) => {
    if (flags.has('--json')) process.stdout.write(JSON.stringify(data) + '\n');
    return flags.has('--json');
  };
  const done = (line) => process.stdout.write(`✔ ${line}\n`);

  switch (cmd) {
    case 'doctor': {
      const info = await call(cfg, 'get_login_info');
      const status = await call(cfg, 'get_status').catch(() => ({}));
      if (raw({ info, status })) return;
      done(
        `NapCat ${cfg.http} 已连接，账号 ${info.nickname || ''}(${info.user_id})，online=${status.online ?? '?'}` +
          `，模式=${cfg.readonly ? '只读' : '可写'}` +
          `，已启用写操作=${cfg.allowedWrites.join('、') || '无'}`,
      );
      return;
    }

    case 'groups': {
      const groups = await call(cfg, 'get_group_list');
      const k = args[0];
      const list = k
        ? groups.filter((g) => String(g.group_name || '').includes(k) || String(g.group_id).includes(k))
        : groups;
      if (raw(list)) return;
      if (list.length === 0) return done(`没有匹配的群（共 ${groups.length} 个）`);
      for (const g of list.slice(0, cfg.listLimit)) {
        process.stdout.write(`${g.group_id}\t${g.group_name}\t${g.member_count ?? '?'}人\n`);
      }
      if (list.length > cfg.listLimit) process.stdout.write(`… 共 ${list.length} 个，只显示前 ${cfg.listLimit}\n`);
      return;
    }

    case 'members': {
      const g = await resolveGroup(cfg, args[0] ?? fail('缺群参数'));
      const members = await call(cfg, 'get_group_member_list', { group_id: g.group_id });
      if (raw(members)) return;
      for (const m of members.slice(0, cfg.listLimit)) {
        process.stdout.write(`${m.user_id}\t${label(m)}\t${m.role}\n`);
      }
      process.stdout.write(
        members.length > cfg.listLimit
          ? `… 共 ${members.length} 人，只显示前 ${cfg.listLimit}（用 find 精确定位更省 token）\n`
          : `共 ${members.length} 人\n`,
      );
      return;
    }

    case 'find': {
      const g = await resolveGroup(cfg, args[0] ?? fail('缺群参数'));
      const k = args[1] ?? fail('缺关键词');
      const members = await call(cfg, 'get_group_member_list', { group_id: g.group_id });
      const ql = k.toLowerCase();
      const hits = members.filter(
        (m) =>
          [m.nickname, m.card].some((v) => v && String(v).toLowerCase().includes(ql)) ||
          String(m.user_id).includes(k),
      );
      if (raw(hits)) return;
      if (hits.length === 0) return done(`「${k}」在 ${groupLabel(g)} 里没有匹配（${members.length} 人）`);
      for (const m of hits.slice(0, 20)) process.stdout.write(`${m.user_id}\t${label(m)}\t${m.role}\n`);
      if (hits.length > 20) process.stdout.write(`… 命中 ${hits.length} 人，只显示前 20\n`);
      return;
    }

    case 'info': {
      const g = await resolveGroup(cfg, args[0] ?? fail('缺群参数'));
      const m = await resolveMember(cfg, g.group_id, args[1] ?? fail('缺目标'));
      const d = await call(cfg, 'get_group_member_info', {
        group_id: g.group_id,
        user_id: m.user_id,
        no_cache: true,
      });
      if (raw(d)) return;
      const left = Math.max(0, (d.shut_up_timestamp || 0) - Math.floor(Date.now() / 1000));
      done(
        `${label(m)}(${m.user_id}) ← ${groupLabel(g)}：${d.role}` +
          (left > 0 ? `，禁言剩余 ${left}s` : '，未禁言'),
      );
      return;
    }

    case 'kick': {
      const g = await resolveGroup(cfg, args[0] ?? fail('缺群参数'));
      const m = await resolveMember(cfg, g.group_id, args[1] ?? fail('缺目标'));
      await guardTarget(cfg, m);
      if (raw({ group: g, member: m })) return;
      if (dryRun) return done(`[dry-run] 将要踢出 ${label(m)}(${m.user_id}) ← ${groupLabel(g)}`);
      await call(cfg, 'set_group_kick', {
        group_id: g.group_id,
        user_id: m.user_id,
        reject_add_request: flags.has('--reject'),
      });
      audit(cfg, `kick\t${g.group_id}\t${m.user_id}\t${label(m)}\treject=${flags.has('--reject')}`);
      done(`已踢出 ${label(m)}(${m.user_id}) ← ${groupLabel(g)}`);
      return;
    }

    case 'mute': {
      const g = await resolveGroup(cfg, args[0] ?? fail('缺群参数'));
      const m = await resolveMember(cfg, g.group_id, args[1] ?? fail('缺目标'));
      const secs = parseDuration(args[2]);
      if (raw({ group: g, member: m, duration: secs })) return;
      const past = secs === 0 ? '已解除禁言' : `已禁言 ${secs}s`;
      const future = secs === 0 ? '解除禁言' : `禁言 ${secs}s`;
      if (dryRun) return done(`[dry-run] 将${future} ${label(m)}(${m.user_id}) ← ${groupLabel(g)}`);
      await call(cfg, 'set_group_ban', { group_id: g.group_id, user_id: m.user_id, duration: secs });
      audit(cfg, `mute\t${g.group_id}\t${m.user_id}\t${secs}`);
      done(`${past} ${label(m)}(${m.user_id}) ← ${groupLabel(g)}`);
      return;
    }

    case 'admin': {
      const g = await resolveGroup(cfg, args[0] ?? fail('缺群参数'));
      const m = await resolveMember(cfg, g.group_id, args[1] ?? fail('缺目标'));
      const on = (args[2] ?? fail('缺 on|off')).toLowerCase();
      if (!['on', 'off'].includes(on)) fail('第三个参数只能是 on 或 off');
      if (raw({ group: g, member: m, enable: on === 'on' })) return;
      if (dryRun) return done(`[dry-run] 将${on === 'on' ? '设置' : '取消'} ${label(m)}(${m.user_id}) 的管理员`);
      await call(cfg, 'set_group_admin', { group_id: g.group_id, user_id: m.user_id, enable: on === 'on' });
      audit(cfg, `admin\t${g.group_id}\t${m.user_id}\t${on}`);
      done(`${on === 'on' ? '已设置' : '已取消'} ${label(m)}(${m.user_id}) 的管理员 ← ${groupLabel(g)}`);
      return;
    }

    case 'card': {
      const g = await resolveGroup(cfg, args[0] ?? fail('缺群参数'));
      const m = await resolveMember(cfg, g.group_id, args[1] ?? fail('缺目标'));
      const card = args[2] ?? '';
      if (raw({ group: g, member: m, card })) return;
      if (dryRun) return done(`[dry-run] 将把 ${label(m)}(${m.user_id}) 的群名片改为「${card}」`);
      await call(cfg, 'set_group_card', { group_id: g.group_id, user_id: m.user_id, card });
      audit(cfg, `card\t${g.group_id}\t${m.user_id}\t${card}`);
      done(`已改群名片 ${label(m)}(${m.user_id}) → 「${card}」`);
      return;
    }

    case 'rename': {
      const g = await resolveGroup(cfg, args[0] ?? fail('缺群参数'));
      const name = args.slice(1).join(' ') || fail('缺新群名');
      if (dryRun) return done(`[dry-run] 将把 ${groupLabel(g)} 改名为「${name}」`);
      await call(cfg, 'set_group_name', { group_id: g.group_id, group_name: name });
      audit(cfg, `rename\t${g.group_id}\t${name}`);
      done(`已把 ${groupLabel(g)} 改名为「${name}」`);
      return;
    }

    case 'wholeban': {
      const g = await resolveGroup(cfg, args[0] ?? fail('缺群参数'));
      const on = (args[1] ?? fail('缺 on|off')).toLowerCase();
      if (!['on', 'off'].includes(on)) fail('第二个参数只能是 on 或 off');
      if (dryRun) return done(`[dry-run] 将${on === 'on' ? '开启' : '关闭'} ${groupLabel(g)} 的全员禁言`);
      await call(cfg, 'set_group_whole_ban', { group_id: g.group_id, enable: on === 'on' });
      audit(cfg, `wholeban\t${g.group_id}\t${on}`);
      done(`已${on === 'on' ? '开启' : '关闭'}全员禁言 ← ${groupLabel(g)}`);
      return;
    }

    case 'dismiss': {
      const g = await resolveGroup(cfg, args[0] ?? fail('缺群参数'));
      const members = await call(cfg, 'get_group_member_list', { group_id: g.group_id }).catch(() => []);
      const self = await call(cfg, 'get_login_info').catch(() => null);
      if (self) {
        const me = members.find((m) => String(m.user_id) === String(self.user_id));
        if (me && me.role !== 'owner') fail(`拒绝执行：机器人不是 ${groupLabel(g)} 的群主，解散不了。`);
      }
      if (dryRun) return done(`[dry-run] 将解散 ${groupLabel(g)}（${members.length} 人）`);
      await call(cfg, 'set_group_leave', { group_id: g.group_id, is_dismiss: true });
      audit(cfg, `dismiss\t${g.group_id}`);
      done(`已解散 ${groupLabel(g)}`);
      return;
    }

    default:
      fail(`未知命令 ${cmd}。用 \`qq help\``);
  }
}

main().catch((e) => {
  if (e instanceof CliError) {
    if (e.message) process.stderr.write(`✘ ${e.message}\n`);
    process.exitCode = e.code;
    return;
  }
  process.stderr.write(`✘ ${e?.message || String(e)}\n`);
  process.exitCode = 1;
});
