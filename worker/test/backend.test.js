import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { memoryD1 } from './d1.js';
import { createService, reserve, refund, hash, dayKey, resetAt, signQuery, validateChat, packCredits, amountCents, applyOrder } from '../src/index.js';

const DAY = 86400000, MONTH = 30 * DAY, START = Date.UTC(2026, 10, 5, 2);
const env = { ALLOWED_ORIGIN: 'https://xulei1280-rgb.github.io', DEEPSEEK_API_KEY: 'test-upstream-secret',
  AFDIAN_USER_ID: 'test-creator', AFDIAN_TOKEN: 'test-signing-secret',
  WEBHOOK_PATH_SECRET: 'test-secret-path', AFDIAN_VERIFIED: 'true', AFDIAN_REFUND_STATUS: '3', AFDIAN_PAID_AT_FIELD: 'pay_time' };
function fixture(t, fetchImpl) {
  const db = memoryD1(); t.after(() => db.raw.close());
  let time = START;
  const service = createService({ db, now: () => time, fetchImpl: fetchImpl || (async () => Response.json({ choices: [{ message: { content: 'test answer' } }] })), pause: async () => {} });
  let sequence = 0;
  function identity(paid = false) {
    const token = (++sequence).toString(16).padStart(64, '0'), credential = hash(token);
    db.raw.prepare('INSERT INTO credentials(hash,created_at,expires_at) VALUES (?,?,?)').run(credential, START, paid ? START + MONTH : 0);
    if (paid) {
      const ref = (++sequence + 10000).toString(16).padStart(64, '0');
      db.raw.prepare('INSERT INTO order_refs VALUES (?,?,?)').run(ref, credential, START);
      db.raw.prepare("INSERT INTO orders(out_trade_no,ref,credential,amount_cents,paid_at,status,updated_at,granted) VALUES (?,?,?,?,?,'paid',?,?)").run('seed-' + sequence, ref, credential, 600, START, START, 150);
    }
    return { token, credential };
  }
  async function request(path, { token, body, method = 'POST', origin = env.ALLOWED_ORIGIN, ip = '1.2.3.4', settings = env } = {}) {
    const response = await service.handle(new Request('https://api.test' + path, { method,
      headers: { ...(origin ? { Origin: origin } : {}), 'CF-Connecting-IP': ip, ...(token ? { Authorization: 'Bearer ' + token } : {}), 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), settings);
    return { response, body: await response.json().catch(() => null) };
  }
  return { db, service, request, identity, now: () => time, advance: (ms = 11000) => time += ms };
}
const chat = { messages: [{ role: 'user', content: '请解释传统盘面' }], max_tokens: 4096 };
function count(db, scope, subject, now = START) { return db.raw.prepare('SELECT used FROM buckets WHERE scope=? AND subject=? AND bucket=?').get(scope, subject, dayKey(now))?.used || 0; }
function seed(db, scope, subject, used, ceiling) { db.raw.prepare('INSERT INTO buckets VALUES (?,?,?,?,?,?)').run(scope, dayKey(START), subject, used, ceiling, resetAt(START)); }
function linked(f, identity, index = 1) {
  const ref = (index + 1000).toString(16).padStart(64, '0');
  f.db.raw.prepare('INSERT INTO order_refs VALUES (?,?,?)').run(ref, identity.credential, START);
  return ref;
}
function order(ref, changes = {}) { return { out_trade_no: 'trade-1', custom_order_id: ref, total_amount: '6.00', plan_id: '', status: 2, pay_time: START / 1000, ...changes }; }
function queryResponse(list, ec = 200, total_page = 1) { return Response.json({ ec, data: { list, total_page } }); }
function callback(f, raw, options = {}) { return f.request('/webhook/' + env.WEBHOOK_PATH_SECRET, { body: { data: { order: raw } }, origin: null, ...options }); }

test('免费第6次拒绝；事务失败不占全站/IP额度', async t => {
  const f = fixture(t), id = f.identity();
  for (let i = 0; i < 5; i++) { assert.equal((await f.request('/api/chat', { token: id.token, body: chat })).response.status, 200); f.advance(); }
  const result = await f.request('/api/chat', { token: id.token, body: chat });
  assert.equal(result.response.status, 429); assert.equal(result.body.error.code, 'quota_credential');
  assert.equal(result.body.error.retry_at, resetAt(START)); assert.equal(count(f.db, 'site', '*'), 5);
  assert.equal(count(f.db, 'ip', hash('1.2.3.4')), 5);
});
test('同IP第21次拒绝；其它预占回滚', async t => {
  const f = fixture(t);
  for (let i = 0; i < 20; i++) { await reserve(f.db, f.identity().credential, 'same-ip', f.now()); f.advance(); }
  const id = f.identity();
  await assert.rejects(reserve(f.db, id.credential, 'same-ip', f.now()), e => e.code === 'quota_ip');
  assert.equal(count(f.db, 'site', '*'), 20); assert.equal(count(f.db, 'credential', id.credential), 0);
});
test('全站第301次拒绝免费用户，打赏用户不检查也不占全站额度', async t => {
  const f = fixture(t);
  for (let i = 0; i < 300; i++) { await reserve(f.db, f.identity().credential, 'ip-' + i, f.now()); f.advance(); }
  await assert.rejects(reserve(f.db, f.identity().credential, 'new-ip', f.now()), e => e.code === 'quota_site' && e.message === '今日全站额度已用完');
  await reserve(f.db, f.identity(true).credential, 'new-ip', f.now());
  assert.equal(count(f.db, 'site', '*'), 300);
});
test('打赏无每日上限，不检查也不占免费池、全站与IP日额及IP短限频', async t => {
  const f = fixture(t), id = f.identity(true);
  seed(f.db, 'ip', 'blocked-ip', 20, 20);
  f.db.raw.prepare('INSERT INTO buckets VALUES (?,?,?,?,?,?)').run('chat_ip', String(Math.floor(START / 10000)), 'blocked-ip', 10, 10, START + 10000);
  for (let i = 0; i < 21; i++) { await reserve(f.db, id.credential, 'blocked-ip', f.now()); f.advance(); }
  assert.equal(f.db.raw.prepare('SELECT free_used FROM credentials WHERE hash=?').get(id.credential).free_used, 0);
  assert.equal(f.db.raw.prepare('SELECT used FROM orders WHERE credential=?').get(id.credential).used, 21);
  assert.equal(count(f.db, 'ip', 'blocked-ip'), 20); assert.equal(count(f.db, 'site', '*'), 0);
});
test('余额1次，并发只放行1次', async t => {
  const f = fixture(t), id = f.identity(); seed(f.db, 'credential', id.credential, 4, 1000000);
  const result = await Promise.allSettled(Array.from({ length: 12 }, () => reserve(f.db, id.credential, 'ip', START)));
  assert.equal(result.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(count(f.db, 'credential', id.credential), 5); assert.equal(count(f.db, 'site', '*'), 1);
});
test('D1失败拒绝调用上游，返回中文且不泄露错误内容', async () => {
  let calls = 0;
  const service = createService({ db: { prepare() { throw new Error(env.DEEPSEEK_API_KEY); } }, fetchImpl: async () => { calls++; } });
  const response = await service.handle(new Request('https://api.test/api/chat', { method: 'POST', headers: { Origin: env.ALLOWED_ORIGIN, 'CF-Connecting-IP': 'ip', Authorization: 'Bearer ' + 'a'.repeat(64) }, body: JSON.stringify(chat) }), env);
  assert.equal(response.status, 503); assert.equal(calls, 0); assert.ok(!(await response.text()).includes(env.DEEPSEEK_API_KEY));
});
test('5xx与超时最多退还3次；重复退还幂等、打赏退款不改IP', async t => {
  const f = fixture(t, async () => Response.json({}, { status: 503 })), id = f.identity(true);
  for (let i = 0; i < 4; i++) {
    assert.equal((await f.request('/api/chat', { token: id.token, body: chat })).response.status, 502); f.advance();
  }
  assert.equal(f.db.raw.prepare('SELECT used FROM orders WHERE credential=?').get(id.credential).used, 1); assert.equal(count(f.db, 'refund', id.credential), 3);
  assert.equal(count(f.db, 'ip', hash('1.2.3.4')), 0);
  const g = fixture(t, async () => { throw new DOMException('timeout', 'TimeoutError'); }), free = g.identity();
  assert.equal((await g.request('/api/chat', { token: free.token, body: chat })).response.status, 504);
  const attempt = g.db.raw.prepare('SELECT id FROM attempts').get(); await refund(g.db, attempt.id, START);
  assert.equal(count(g.db, 'refund', free.credential), 1); assert.equal(count(g.db, 'site', '*'), 0); assert.equal(count(g.db, 'ip', hash('1.2.3.4')), 0);
});
test('凭证>=128位随机，D1仅存哈希；UTC+8日期边界', async t => {
  const f = fixture(t);
  const a = await f.request('/api/credential'), b = await f.request('/api/credential');
  assert.match(a.body.credential, /^[a-f0-9]{64}$/); assert.notEqual(a.body.credential, b.body.credential);
  const stored = f.db.raw.prepare('SELECT hash FROM credentials').all().map(r => r.hash);
  assert.ok(stored.includes(hash(a.body.credential))); assert.ok(!stored.includes(a.body.credential));
  assert.equal(dayKey(Date.UTC(2026, 10, 5, 15, 59)), '2026-11-05'); assert.equal(dayKey(Date.UTC(2026, 10, 5, 16)), '2026-11-06');
});
test('CORS精确匹配，预检/错误有允许来源头', async t => {
  const f = fixture(t);
  for (const origin of ['null', 'https://evil.test', env.ALLOWED_ORIGIN + '.evil.test', null]) {
    const r = await f.request('/api/credential', { origin }); assert.equal(r.response.status, 403); assert.equal(r.response.headers.get('access-control-allow-origin'), null);
  }
  const r = await f.request('/api/chat', { body: chat }); assert.equal(r.response.status, 401); assert.equal(r.response.headers.get('access-control-allow-origin'), env.ALLOWED_ORIGIN);
  assert.equal((await f.request('/api/chat', { method: 'OPTIONS' })).response.status, 204);
});
test('消息/体积/参数校验，固定模型/地址、服务端追加风险约束且仅用站长认证', async t => {
  for (const body of [{ ...chat, model: 'evil' }, { ...chat, url: 'https://evil' }, { ...chat, max_tokens: 4097 }, { messages: [{ role: 'tool', content: 'x' }] }, { messages: Array(41).fill({ role: 'user', content: 'x' }) }, { messages: [{ role: 'user', content: 'a'.repeat(24001) }] }]) assert.throws(() => validateChat(body));
  let upstream;
  const f = fixture(t, async (url, init) => { upstream = { url, init }; return Response.json({ choices: [{ message: { content: 'answer' } }] }); }), id = f.identity();
  await f.request('/api/chat', { token: id.token, body: chat });
  assert.equal(upstream.url, 'https://api.deepseek.com/v1/chat/completions'); assert.equal(upstream.init.headers.Authorization, 'Bearer ' + env.DEEPSEEK_API_KEY);
  const body = JSON.parse(upstream.init.body); assert.equal(body.model, 'deepseek-v4-flash'); assert.match(body.messages[0].content, /不判断成败/);
  const large = await f.request('/api/chat', { token: id.token, body: { messages: [{ role: 'user', content: '字'.repeat(24000) }] } }); assert.equal(large.response.status, 413);
});
test('反馈白名单、空内容、长度和每IP每天10条；保存失败不占日额', async t => {
  const f = fixture(t), body = { type: '其他', content: '建议', contact: '', page: 'index.html' };
  for (const invalid of [{ ...body, content: ' ' }, { ...body, content: '字'.repeat(1001) }, { ...body, page: '/bazi.html?birth=secret' }, { ...body, type: '错误' }, { ...body, credential: 'secret' }]) assert.equal((await f.request('/api/feedback', { body: invalid })).response.status, 400);
  for (let i = 0; i < 10; i++) { assert.equal((await f.request('/api/feedback', { body: { ...body, page: ['index.html', 'bazi.html', 'liuyao.html', 'ziwei.html', 'daily.html'][i % 5] } })).response.status, 200); f.advance(61000); }
  assert.equal((await f.request('/api/feedback', { body })).response.status, 429);
  assert.equal(f.db.raw.prepare('SELECT count(*) n FROM feedback').get().n, 10);
});
test('查单签名按协议拼接MD5，必须ec=200', async t => {
  const params = '{"page":1}', ts = START / 1000;
  assert.equal(signQuery(env, params, ts), createHash('md5').update(env.AFDIAN_TOKEN + 'params' + params + 'ts' + ts + 'user_id' + env.AFDIAN_USER_ID).digest('hex'));
  const f = fixture(t, async () => queryResponse([], 400));
  const response = await callback(f, { out_trade_no: 'trade-1' }); assert.equal(response.response.status, 502); assert.notEqual(response.body.ec, 200);
});
test('webhook空body/缺失或非法订单号直接确认，未verified也不查单或改权益', async t => {
  let calls = 0;
  const f = fixture(t, async () => { calls++; throw new Error('不应查单'); }), id = f.identity();
  for (const settings of [env, { ...env, AFDIAN_VERIFIED: 'false' }]) {
    for (const body of [undefined, null, {}, { data: {} }, { data: { order: {} } },
      ...[null, 123, {}, [], '', 'bad/id', 'a'.repeat(101)].map(out_trade_no => ({ data: { order: { out_trade_no } } }))]) {
      const r = await f.request('/webhook/' + env.WEBHOOK_PATH_SECRET, { body, origin: null, settings });
      assert.equal(r.response.status, 200); assert.deepEqual(r.body, { ec: 200 });
    }
    const empty = await f.service.handle(new Request('https://api.test/webhook/' + env.WEBHOOK_PATH_SECRET, {
      method: 'POST', headers: { 'CF-Connecting-IP': '1.2.3.4' }, body: ''
    }), settings);
    assert.equal(empty.status, 200); assert.deepEqual(await empty.json(), { ec: 200 });
  }
  const r = await callback(f, { out_trade_no: 'trade-1' }, { settings: { ...env, AFDIAN_VERIFIED: 'false' } });
  assert.equal(r.response.status, 503); assert.equal(r.body.error.code, 'payment_unavailable');
  assert.equal(calls, 0);
  assert.equal(f.db.raw.prepare('SELECT count(*) n FROM orders').get().n, 0);
  assert.equal(f.db.raw.prepare('SELECT expires_at FROM credentials WHERE hash=?').get(id.credential).expires_at, 0);
});
test('webhook测试请求仍受现有限频约束', async t => {
  const f = fixture(t), settings = { ...env, AFDIAN_VERIFIED: 'false' };
  for (let i = 0; i < 60; i++) {
    assert.equal((await f.request('/webhook/' + env.WEBHOOK_PATH_SECRET, { origin: null, settings })).response.status, 200);
  }
  const r = await f.request('/webhook/' + env.WEBHOOK_PATH_SECRET, { origin: null, settings });
  assert.equal(r.response.status, 429); assert.equal(r.body.error.code, 'rate_limit');
});
test('webhook假关联号/零元/不足6元不生效，回调字段无法代替查单', async t => {
  let raw;
  const f = fixture(t, async () => queryResponse([raw])), id = f.identity(), ref = linked(f, id);
  for (const change of [{ custom_order_id: 'f'.repeat(64) }, { total_amount: '0.00' }, { total_amount: '5.99' }]) {
    raw = order(ref, { ...change, out_trade_no: 'no-grant-' + String(Object.values(change)[0]).replaceAll('.', '-') }); const r = await callback(f, raw); assert.equal(r.response.status, 200);
    assert.equal(f.db.raw.prepare('SELECT expires_at FROM credentials').get().expires_at, 0);
  }
  raw = order(ref); await callback(f, order('f'.repeat(64), { total_amount: '0.00', status: 3 }));
  assert.equal(f.db.raw.prepare('SELECT expires_at FROM credentials').get().expires_at, START + MONTH);
});
test('同订单并发重复回调仅发一次，不重绑凭证', async t => {
  let raw;
  const f = fixture(t, async () => queryResponse([raw])), id = f.identity(), ref = linked(f, id);
  raw = order(ref);
  const results = await Promise.all(Array.from({ length: 8 }, () => callback(f, raw)));
  assert.ok(results.every(r => r.body.ec === 200));
  assert.equal(f.db.raw.prepare('SELECT count(*) n FROM orders').get().n, 1);
  assert.equal(f.db.raw.prepare('SELECT expires_at FROM credentials WHERE hash=?').get(id.credential).expires_at, START + MONTH);
  const second = f.identity(); raw = order(linked(f, second, 2)); await callback(f, raw);
  assert.equal(f.db.raw.prepare('SELECT expires_at FROM credentials WHERE hash=?').get(second.credential).expires_at, 0);
});
test('查单超时/返回错误订单/缺关联号/未知状态/D1失败不返回ec200', async t => {
  let mode = 'timeout', raw;
  const f = fixture(t, async () => { if (mode === 'timeout') throw new Error('timeout'); return queryResponse([raw]); }), id = f.identity(), ref = linked(f, id);
  assert.equal((await callback(f, { out_trade_no: 'trade-1' })).response.status, 502);
  for (const change of [{ out_trade_no: 'wrong' }, { custom_order_id: undefined }, { status: 999 }]) {
    mode = 'normal'; raw = order(ref, change);
    const r = await callback(f, { out_trade_no: 'trade-1' }); assert.equal(r.response.status, 502); assert.notEqual(r.body.ec, 200);
  }
  raw = order(ref);
  f.db.raw.exec("CREATE TRIGGER fail_grant BEFORE UPDATE ON credentials BEGIN SELECT RAISE(ABORT,'test_failure'); END;");
  const r = await callback(f, raw); assert.equal(r.response.status, 503); assert.notEqual(r.body.ec, 200); assert.equal(f.db.raw.prepare('SELECT count(*) n FROM orders').get().n, 0);
});
test('续期max(当前到期,付款时间)+30天；退款只撤对应订单且重复幂等', async t => {
  let raw;
  const f = fixture(t, async () => queryResponse([raw])), id = f.identity(), ref = linked(f, id);
  raw = order(ref); await callback(f, raw);
  raw = order(ref, { out_trade_no: 'trade-2' }); await callback(f, raw);
  assert.equal(f.db.raw.prepare('SELECT expires_at FROM credentials').get().expires_at, START + 2 * MONTH);
  raw = order(ref, { status: 3 }); await callback(f, raw); await callback(f, raw);
  assert.equal(f.db.raw.prepare('SELECT expires_at FROM credentials').get().expires_at, START + MONTH);
  raw = order(ref); await callback(f, raw); // 迟到的成功不复活退款订单
  assert.equal(f.db.raw.prepare('SELECT expires_at FROM credentials').get().expires_at, START + MONTH);
  f.advance(3 * MONTH); raw = order(ref, { out_trade_no: 'trade-3', pay_time: f.now() / 1000 }); await callback(f, raw);
  assert.equal(f.db.raw.prepare('SELECT expires_at FROM credentials').get().expires_at, f.now() + MONTH);
});
test('订单链接与凭证绑定；关闭回调后轮询主动查单解锁，不能查询他人订单', async t => {
  let raw;
  const f = fixture(t, async () => queryResponse(raw ? [raw] : [])), id = f.identity();
  const created = await f.request('/api/order', { token: id.token, body: { amount: '18.00' } });
  const url = new URL(created.body.url); assert.equal(url.origin, 'https://afdian.com'); assert.equal(url.searchParams.get('custom_price'), '18.00'); assert.equal(url.searchParams.has('plan_id'), false); assert.equal(url.searchParams.get('custom_order_id'), created.body.ref);
  raw = order(created.body.ref);
  const r = await f.request('/api/order-status?ref=' + created.body.ref, { token: id.token, method: 'GET' });
  assert.equal(r.body.status, 'paid'); assert.equal(r.body.expires_at, START + MONTH);
  assert.equal((await f.request('/api/order-status?ref=' + created.body.ref, { token: f.identity().token, method: 'GET' })).response.status, 404);
  assert.equal((await f.request('/api/order', { token: id.token, settings: { ...env, AFDIAN_VERIFIED: 'false' } })).response.status, 503);
});
test('每日cron补7天漏单、分页、对账退款并清理分桶', async t => {
  const requests = []; let list;
  const f = fixture(t, async (url, init) => {
    const params = JSON.parse(JSON.parse(init.body).params); requests.push(params);
    if (params.out_trade_no) return queryResponse([order(ref, { status: 3 })]);
    return queryResponse(params.page === 1 ? [list] : [], 200, 2);
  }), id = f.identity(), ref = linked(f, id);
  list = order(ref);
  seed(f.db, 'ip', 'old', 1, 20);
  f.db.raw.prepare("UPDATE buckets SET expires_at=? WHERE subject='old'").run(START - 8 * DAY);
  await f.service.reconcile(env);
  assert.ok(requests.some(p => p.page === 2)); assert.ok(requests.some(p => p.out_trade_no === 'trade-1'));
  assert.equal(f.db.raw.prepare('SELECT status FROM orders').get().status, 'refunded');
  assert.equal(f.db.raw.prepare('SELECT expires_at FROM credentials').get().expires_at, 0);
  assert.equal(f.db.raw.prepare("SELECT count(*) n FROM buckets WHERE subject='old'").get().n, 0);
});

test('旧权益已过期后的退款保留后来独立购买的30天；退款金额为0仍回收对应订单', async t => {
  let raw;
  const f = fixture(t, async () => queryResponse([raw])), id = f.identity(), ref = linked(f, id);
  raw = order(ref); await callback(f, raw);
  f.advance(40 * DAY);
  raw = order(ref, { out_trade_no: 'trade-new', pay_time: f.now() / 1000 }); await callback(f, raw);
  raw = order(ref, { status: 3, total_amount: '0.00' }); await callback(f, raw);
  assert.equal(f.db.raw.prepare('SELECT expires_at FROM credentials').get().expires_at, f.now() + MONTH);
  const other = f.identity(true), before = f.db.raw.prepare('SELECT expires_at FROM credentials WHERE hash=?').get(other.credential).expires_at;
  raw = order(ref, { out_trade_no: 'trade-new', pay_time: f.now() / 1000, status: 3, total_amount: '0.00' }); await callback(f, raw); await callback(f, raw);
  assert.equal(f.db.raw.prepare('SELECT expires_at FROM credentials WHERE hash=?').get(id.credential).expires_at, 0);
  assert.equal(f.db.raw.prepare('SELECT expires_at FROM credentials WHERE hash=?').get(other.credential).expires_at, before);
});
test('免费短限频整体回滚，午夜后免费日额与反馈日额恢复', async t => {
  const f = fixture(t), id = f.identity();
  await reserve(f.db, id.credential, 'ip', START);
  await assert.rejects(reserve(f.db, id.credential, 'ip', START), e => e.code === 'rate_limit');
  assert.equal(count(f.db, 'site', '*'), 1);
  f.advance(resetAt(START) - START);
  await reserve(f.db, id.credential, 'ip', f.now()); assert.equal(count(f.db, 'credential', id.credential, f.now()), 1);
});
test('上游响应读取超时也退还；4xx不退还', async t => {
  const f = fixture(t, async () => new Response(new ReadableStream({ start(controller) { controller.error(new DOMException('timeout', 'TimeoutError')); } }))), id = f.identity();
  assert.equal((await f.request('/api/chat', { token: id.token, body: chat })).response.status, 504);
  assert.equal(count(f.db, 'site', '*'), 0);
  const g = fixture(t, async () => Response.json({ error: { message: env.DEEPSEEK_API_KEY } }, { status: 401 })), free = g.identity();
  const r = await g.request('/api/chat', { token: free.token, body: chat });
  assert.equal(r.response.status, 502); assert.equal(count(g.db, 'site', '*'), 1); assert.ok(!JSON.stringify(r.body).includes(env.DEEPSEEK_API_KEY));
});
test('余额并发拒绝原因是凭证额度，退款回滚不影响其它计数', async t => {
  const f = fixture(t), id = f.identity(); seed(f.db, 'credential', id.credential, 4, 1000000);
  const results = await Promise.allSettled([reserve(f.db, id.credential, 'ip', START), reserve(f.db, id.credential, 'ip', START)]);
  assert.equal(results.filter(r => r.status === 'rejected' && r.reason.code === 'quota_credential').length, 1);
});

test('金额按分解析并折算：小数向下取整、6/18/68档底及线性金额越档', () => {
  for (const [yuan, credits] of [['0', 0], ['5.99', 0], ['6', 150], ['6.03', 150], ['6.04', 151],
    ['17.99', 449], ['18', 600], ['24', 600], ['24.04', 601], ['67.99', 1699], ['68', 2500], ['100', 2500], ['100.04', 2501], ['999999999.99', 24999999999]]) {
    assert.equal(packCredits(amountCents(yuan)), credits, yuan);
  }
  for (const invalid of [null, undefined, {}, [], true, -6, '6.001', '1e2', 'NaN', 'Infinity', '', ' 6', '1000000000']) assert.equal(amountCents(invalid), null);
});
test('下单金额校验；不依赖plan_id，实付决定次数、零元不赠送、不足6元确认但不发包', async t => {
  let raw;
  const f = fixture(t, async () => queryResponse(raw ? [raw] : [])), id = f.identity();
  for (const body of [null, {}, { amount: 0 }, { amount: '-6' }, { amount: '6.001' }, { amount: '1e2' }, { amount: [] }, { amount: 6, plan_id: 'x' }]) {
    const r = await f.request('/api/order', { token: id.token, body });
    assert.equal(r.response.status, 400); f.advance(61000);
  }
  assert.equal(f.db.raw.prepare('SELECT COUNT(*) n FROM order_refs').get().n, 0);
  const created = await f.request('/api/order', { token: id.token, body: { amount: 68 } });
  const url = new URL(created.body.url);
  assert.equal(url.searchParams.get('custom_price'), '68.00'); assert.equal(url.searchParams.has('plan_id'), false);
  raw = order(created.body.ref, { total_amount: '18.00', show_amount: '68.00', plan_id: 'any-plan' });
  let r = await f.request('/api/order-status?ref=' + created.body.ref, { token: id.token, method: 'GET' });
  assert.equal(r.body.remaining, 600); assert.equal(r.body.granted, 600);
  const small = linked(f, id, 2);
  raw = order(small, { out_trade_no: 'small', total_amount: '5.99' });
  await callback(f, raw);
  r = await f.request('/api/order-status?ref=' + small, { token: id.token, method: 'GET' });
  assert.equal(r.body.status, 'paid'); assert.equal(r.body.granted, 0); assert.equal(r.body.remaining, 600);
  assert.equal(r.body.expires_at, START + MONTH);
});
test('免费池终身100次、每天5次；午夜和cron清理不重置；耗尽不带次日重试承诺', async t => {
  const f = fixture(t), id = f.identity();
  for (let day = 0; day < 20; day++) {
    for (let i = 0; i < 5; i++) { await reserve(f.db, id.credential, 'ip', f.now()); f.advance(); }
    if (day !== 19) await assert.rejects(reserve(f.db, id.credential, 'ip', f.now()), e => e.code === 'quota_credential');
    f.advance(DAY);
  }
  await f.service.reconcile({ ...env, AFDIAN_VERIFIED: 'false' });
  assert.equal(f.db.raw.prepare('SELECT free_used FROM credentials WHERE hash=?').get(id.credential).free_used, 100);
  const r = await f.request('/api/chat', { token: id.token, body: chat });
  assert.equal(r.body.error.code, 'quota_lifetime'); assert.equal(r.body.error.retry_at, undefined);
  assert.match(r.body.error.message, /100 次免费 AI 已用完/);
  assert.equal(count(f.db, 'site', '*', f.now()), 0);
  const fresh = f.identity(); await reserve(f.db, fresh.credential, 'ip', f.now());
  const ref = linked(f, id);
  await applyOrder(f.db, order(ref, { pay_time: f.now() / 1000 }), env, f.now());
  assert.equal((await reserve(f.db, id.credential, 'ip', f.now())).paid, 1, '免费池用尽仍可用次数包');
});
test('免费失败退回终身池且幂等；短限频失败不扣免费池或次数包', async t => {
  const f = fixture(t), id = f.identity();
  const a = await reserve(f.db, id.credential, 'ip', f.now());
  await assert.rejects(reserve(f.db, id.credential, 'ip', f.now()), e => e.code === 'rate_limit');
  assert.equal(f.db.raw.prepare('SELECT free_used FROM credentials WHERE hash=?').get(id.credential).free_used, 1);
  await refund(f.db, a.id, f.now()); await refund(f.db, a.id, f.now());
  assert.equal(f.db.raw.prepare('SELECT free_used FROM credentials WHERE hash=?').get(id.credential).free_used, 0);
  const paid = f.identity(true);
  await reserve(f.db, paid.credential, 'ip', f.now());
  await assert.rejects(reserve(f.db, paid.credential, 'ip', f.now()), e => e.code === 'rate_limit');
  assert.equal(f.db.raw.prepare('SELECT used FROM orders WHERE credential=?').get(paid.credential).used, 1);
});
test('二次打赏累加剩余次数并顺延，按旧订单先扣；退款撤该笔剩余和30天，不扣其它包', async t => {
  const f = fixture(t), id = f.identity(), ref = linked(f, id);
  await applyOrder(f.db, order(ref), env, f.now());
  for (let i = 0; i < 3; i++) { await reserve(f.db, id.credential, 'ip', f.now()); f.advance(); }
  f.advance(10 * DAY);
  const second = order(ref, { out_trade_no: 'trade-2', total_amount: '18.00', pay_time: Math.floor(f.now() / 1000) });
  await applyOrder(f.db, second, env, f.now());
  assert.equal(f.db.raw.prepare('SELECT SUM(granted-used) n FROM orders').get().n, 747);
  assert.equal(f.db.raw.prepare('SELECT expires_at FROM credentials').get().expires_at, START + 2 * MONTH);
  await applyOrder(f.db, order(ref, { status: 3, total_amount: '0.00' }), env, f.now());
  const rows = f.db.raw.prepare('SELECT * FROM orders ORDER BY out_trade_no').all();
  assert.equal(rows[0].status, 'refunded'); assert.equal(rows[0].used, 3);
  assert.equal(rows[1].granted - rows[1].used, 600);
  assert.equal(rows[1].expires_at, second.pay_time * 1000 + MONTH);
  await applyOrder(f.db, order(ref), env, f.now());
  assert.equal(f.db.raw.prepare("SELECT COUNT(*) n FROM orders WHERE status='paid'").get().n, 1);
});
test('用完次数包当次自动回免费池；免费日额已用完则拒绝，次日恢复且不复活包', async t => {
  const f = fixture(t), id = f.identity(true);
  f.db.raw.prepare('UPDATE orders SET used=149 WHERE credential=?').run(id.credential);
  const paid = await reserve(f.db, id.credential, 'ip', f.now()); assert.equal(paid.paid, 1); f.advance();
  for (let i = 0; i < 5; i++) { assert.equal((await reserve(f.db, id.credential, 'ip', f.now())).paid, 0); f.advance(); }
  await assert.rejects(reserve(f.db, id.credential, 'ip', f.now()), e => e.code === 'quota_credential');
  f.advance(DAY); assert.equal((await reserve(f.db, id.credential, 'ip', f.now())).paid, 0);
  assert.equal(f.db.raw.prepare('SELECT used FROM orders').get().used, 150);
});
test('次数包最后1次并发只扣一次，其它请求回免费时仍受原子限频', async t => {
  const f = fixture(t), id = f.identity(true);
  f.db.raw.prepare('UPDATE orders SET used=149').run();
  const results = await Promise.allSettled(Array.from({ length: 8 }, () => reserve(f.db, id.credential, 'ip', f.now())));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(f.db.raw.prepare('SELECT used FROM orders').get().used, 150);
  assert.equal(f.db.raw.prepare('SELECT free_used FROM credentials').get().free_used, 0);
});
test('到期边界立即回免费；过期再打赏不复活旧余额；较晚通知按真实付款时间算有效期', async t => {
  const f = fixture(t), id = f.identity(), ref = linked(f, id);
  await applyOrder(f.db, order(ref), env, f.now());
  f.advance(MONTH);
  assert.equal((await reserve(f.db, id.credential, 'ip', f.now())).paid, 0); f.advance();
  await applyOrder(f.db, order(ref, { out_trade_no: 'new', total_amount: '18.00', pay_time: f.now() / 1000 }), env, f.now());
  const r = await f.request('/api/order-status?ref=' + ref, { token: id.token, method: 'GET' });
  assert.equal(r.body.remaining, 600); assert.equal(r.body.expires_at, f.now() + MONTH);
  f.advance(2 * MONTH);
  const late = f.identity(), lateRef = linked(f, late, 3);
  await applyOrder(f.db, order(lateRef, { out_trade_no: 'late' }), env, f.now());
  assert.equal((await reserve(f.db, late.credential, 'ip2', f.now())).paid, 0);
});
test('乱序回调重算付款链；退款后上游退次不会复活权益；超过60天老订单仍对账退款', async t => {
  let queried = [];
  const f = fixture(t, async (url, init) => {
    const params = JSON.parse(JSON.parse(init.body).params);
    if (params.out_trade_no) { queried.push(...params.out_trade_no.split(',')); return queryResponse(params.out_trade_no.split(',').map(id => order(ref, { out_trade_no: id, status: 3 }))); }
    return queryResponse([]);
  }), id = f.identity(), ref = linked(f, id);
  f.advance(40 * DAY);
  await applyOrder(f.db, order(ref, { out_trade_no: 'trade-2', pay_time: (START + 20 * DAY) / 1000 }), env, f.now());
  await applyOrder(f.db, order(ref), env, f.now());
  assert.equal(f.db.raw.prepare('SELECT expires_at FROM credentials').get().expires_at, START + 2 * MONTH);
  const attempt = await reserve(f.db, id.credential, 'ip', f.now());
  await applyOrder(f.db, order(ref, { status: 3 }), env, f.now());
  await refund(f.db, attempt.id, f.now());
  assert.equal(f.db.raw.prepare("SELECT status FROM orders WHERE out_trade_no='trade-1'").get().status, 'refunded');
  // 另一条老订单仍待对账，确认60天之外也不会遗漏退款。
  f.advance(30 * DAY); await f.service.reconcile(env);
  assert.ok(queried.includes('trade-2'));
  assert.equal(f.db.raw.prepare('SELECT expires_at FROM credentials').get().expires_at, 0);
  assert.equal(f.db.raw.prepare("SELECT status FROM orders WHERE out_trade_no='trade-2'").get().status, 'refunded');
});
