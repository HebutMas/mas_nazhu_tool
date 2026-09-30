import http from 'node:http';
import { appendFileSync } from 'node:fs';

const LOG = process.env.MOCK_LOG || 'calls.log';
const SELF = 10001;

const groups = [
  { group_id: 987654, group_name: '测试群', member_count: 6 },
  { group_id: 111111, group_name: '另一个测试群', member_count: 3 },
];

const members = [
  { user_id: 10000, nickname: '老王', card: '群主老王', role: 'owner' },
  { user_id: 10001, nickname: '机器人', card: '', role: 'admin' },
  { user_id: 10002, nickname: '张三', card: '张三', role: 'member' },
  { user_id: 10003, nickname: '张三他弟', card: '张三', role: 'member' },
  { user_id: 10004, nickname: '李四', card: '', role: 'member' },
  { user_id: 10005, nickname: '赵六', card: '', role: 'admin' },
];

const bans = new Map();

const handlers = {
  get_login_info: () => ({ user_id: SELF, nickname: '机器人' }),
  get_status: () => ({ online: true, good: true }),
  get_group_list: () => groups,
  get_group_member_list: (p) => (Number(p.group_id) === 987654 ? members : members.slice(0, 3)),
  get_group_member_info: (p) => {
    const m = members.find((x) => String(x.user_id) === String(p.user_id));
    if (!m) return null;
    return { ...m, shut_up_timestamp: bans.get(String(p.user_id)) || 0 };
  },
  set_group_ban: (p) => {
    const until = Number(p.duration) > 0 ? Math.floor(Date.now() / 1000) + Number(p.duration) : 0;
    bans.set(String(p.user_id), until);
    return null;
  },
  set_group_kick: () => null,
  set_group_admin: () => null,
  set_group_card: () => null,
  set_group_name: () => null,
  set_group_whole_ban: () => null,
  set_group_leave: () => null,
};

http
  .createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const action = req.url.replace(/^\//, '');
      let params = {};
      try {
        params = body ? JSON.parse(body) : {};
      } catch {}
      appendFileSync(LOG, JSON.stringify({ action, params }) + '\n');
      const fn = handlers[action];
      const payload = fn
        ? { status: 'ok', retcode: 0, data: fn(params) }
        : { status: 'failed', retcode: 1404, data: null, message: 'unknown action' };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    });
  })
  .listen(Number(process.env.MOCK_PORT || 3999), '127.0.0.1', () =>
    console.log('mock ready on ' + (process.env.MOCK_PORT || 3999)),
  );
