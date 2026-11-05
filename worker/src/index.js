import { createHash } from 'node:crypto';

const DAY = 86400000;
const POLICY = '这是传统文化学习工具，解读仅供参考。不提供投资、收益或买卖建议；不判断病情、疗效、生育结果、诉讼胜负或投资与交易收益。高风险问题只解释传统象意，不判断成败，建议咨询医生、律师或专业人士。不得承诺现实结果。';
const TYPES = ['功能建议', '排盘有误', 'AI 解读问题', '其他'];
const PAGES = ['index.html', 'bazi.html', 'liuyao.html', 'ziwei.html', 'daily.html'];
const random = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
export const hash = value => createHash('sha256').update(value).digest('hex');
export const dayKey = now => new Date(now + 8 * 3600000).toISOString().slice(0, 10);
export const resetAt = now => (Math.floor((now + 8 * 3600000) / DAY) + 1) * DAY - 8 * 3600000;
const stmt = (db, sql, ...args) => db.prepare(sql).bind(...args);
class ApiError extends Error {
  constructor(status, code, message, retryAt) { super(message); Object.assign(this, { status, code, retryAt }); }
}
const fail = (status, code, message, retryAt) => { throw new ApiError(status, code, message, retryAt); };
function databaseError(error, now) {
  const message = String(error.message) + String(error.cause?.message || '');
  for (const [key, text] of [['site', '今日全站额度已用完'], ['credential', '今日凭证额度已用完'], ['ip', '今日 IP 免费额度已用完']]) {
    if (message.includes('quota_' + key)) return new ApiError(429, 'quota_' + key, text, resetAt(now));
  }
  if (message.includes('rate_')) return new ApiError(429, 'rate_limit', '操作太频繁，请稍后再试', Math.ceil((now + 1) / 60000) * 60000);
  return new ApiError(503, 'database_unavailable', '服务暂时不可用，请稍后再试');
}
async function batch(db, statements, now) {
  try {
    const result = await db.batch(statements);
    if (result.some(row => row.success === false)) throw new Error('database failure');
    return result;
  } catch (error) { throw databaseError(error, now); }
}
function rateStatement(db, scope, subject, now, limit, duration = 60000, offset = 0) {
  return stmt(db, `INSERT INTO buckets VALUES (?,?,?,?,?,?)
    ON CONFLICT(scope,bucket,subject) DO UPDATE SET used=used+1`,
  scope, String(Math.floor((now + offset) / duration)), subject, 1, limit, (Math.floor((now + offset) / duration) + 1) * duration - offset);
}
async function rate(db, scope, ip, now, limit = 30) {
  await batch(db, [rateStatement(db, scope, ip, now, limit)], now);
}
export async function reserve(db, credential, ip, now) {
  const id = random();
  const result = await batch(db, [
    stmt(db, `INSERT INTO attempts(id,credential,day,ip,paid,created_at,reset_at)
      SELECT ?,hash,?,?,CASE WHEN expires_at>? THEN 1 ELSE 0 END,?,? FROM credentials WHERE hash=?`,
    id, dayKey(now), ip, now, now, resetAt(now), credential),
    stmt(db, 'SELECT * FROM attempts WHERE id=?', id)
  ], now);
  if (!result[1].results[0]) fail(401, 'invalid_credential', '访问凭证无效，请刷新页面');
  return result[1].results[0];
}
export async function refund(db, id, now) {
  try { await db.batch([stmt(db, 'UPDATE attempts SET refunded=1 WHERE id=? AND refunded=0', id)]); }
  catch (error) {
    if (!String(error.message).includes('refund_limit')) throw databaseError(error, now);
  }
}
async function jsonBody(request, max = 32768, allowEmpty = false) {
  if (Number(request.headers.get('content-length')) > max) fail(413, 'body_too_large', '请求内容过长');
  const reader = request.body?.getReader();
  if (!reader && allowEmpty) return null;
  if (!reader) fail(400, 'invalid_json', '请求内容不能为空');
  let size = 0;
  const chunks = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) { await reader.cancel(); fail(413, 'body_too_large', '请求内容过长'); }
      chunks.push(value);
    }
    if (!size && allowEmpty) return null;
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (error) {
    if (error instanceof ApiError || error.name === 'AbortError' || error.name === 'TimeoutError') throw error;
    fail(400, 'invalid_json', '请求格式错误');
  } finally { reader.releaseLock(); }
}
export function validateChat(body) {
  if (!body || typeof body !== 'object' || Object.keys(body).some(k => !['messages', 'max_tokens'].includes(k))) fail(400, 'invalid_chat', 'AI 请求参数无效');
  const messages = body.messages;
  if (!Array.isArray(messages) || !messages.length || messages.length > 40 || messages.some(m =>
    !m || !['system', 'user', 'assistant'].includes(m.role) || typeof m.content !== 'string' || !m.content.trim() || Object.keys(m).some(k => !['role', 'content'].includes(k)))) fail(400, 'invalid_messages', '消息格式或条数无效');
  if (messages.at(-1).role !== 'user' || messages.reduce((n, m) => n + m.content.length, 0) > 24000) fail(400, 'input_too_long', '输入过长，请缩短问题或新建解读');
  const tokens = body.max_tokens ?? 4096;
  if (!Number.isInteger(tokens) || tokens < 1 || tokens > 4096) fail(400, 'invalid_tokens', '输出长度须在 1 至 4096 之间');
  return { model: 'deepseek-v4-flash', thinking: { type: 'disabled' }, max_tokens: tokens,
    messages: [{ role: 'system', content: messages.filter(m => m.role === 'system').map(m => m.content).join('\n') + '\n' + POLICY }, ...messages.filter(m => m.role !== 'system')] };
}
function paymentConfig(env) {
  if (env.AFDIAN_VERIFIED !== 'true' || !env.AFDIAN_PLAN_ID || !env.AFDIAN_TOKEN || !env.AFDIAN_PAID_AT_FIELD || !env.AFDIAN_REFUND_STATUS || env.AFDIAN_REFUND_STATUS === '2') fail(503, 'payment_unavailable', '打赏解锁尚未开放');
}
export function signQuery(env, params, ts) {
  return createHash('md5').update(env.AFDIAN_TOKEN + 'params' + params + 'ts' + ts + 'user_id' + env.AFDIAN_USER_ID).digest('hex');
}
export async function queryOrders(env, paramsObject, fetchImpl, now) {
  paymentConfig(env);
  const params = JSON.stringify(paramsObject), ts = Math.floor(now / 1000);
  let response, body;
  try {
    response = await fetchImpl('https://afdian.com/api/open/query-order', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15000),
      body: JSON.stringify({ user_id: env.AFDIAN_USER_ID, params, ts, sign: signQuery(env, params, ts) })
    });
    body = await jsonBody(response, 1048576);
  } catch { fail(502, 'order_query_failed', '付款核验暂时失败，请稍后再试'); }
  if (!response.ok || body.ec !== 200 || !Array.isArray(body.data?.list) || !Number.isInteger(body.data.total_page) || body.data.total_page < 0) fail(502, 'order_query_failed', '付款核验暂时失败，请稍后再试');
  return body.data;
}
export function normalizeOrder(raw, env, now) {
  const id = raw?.out_trade_no, ref = raw?.custom_order_id;
  if (typeof id !== 'string' || !/^[\w-]{1,100}$/.test(id)) fail(502, 'order_shape', '订单字段待核实');
  // 查单缺少可信关联号或退款字段时关闭发放，绝不使用回调内的对应值。
  if (typeof ref !== 'string') fail(502, 'order_shape', '查单未返回关联号，打赏解锁需要实测核实');
  const centsText = String(raw.total_amount ?? '');
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(centsText)) fail(502, 'order_shape', '订单金额无效');
  const [yuan, fraction = ''] = centsText.split('.');
  const cents = Number(yuan) * 100 + Number(fraction.padEnd(2, '0'));
  if (raw.plan_id !== env.AFDIAN_PLAN_ID || !/^[a-f0-9]{64}$/.test(ref)) return null;
  const status = String(raw.status);
  if (!['2', env.AFDIAN_REFUND_STATUS].includes(status)) fail(502, 'order_status_unknown', '订单状态待核实，尚未变更权益');
  if (status === '2' && !cents) return null;
  const seconds = Number(raw[env.AFDIAN_PAID_AT_FIELD]);
  const paidAt = seconds * 1000;
  if (!Number.isSafeInteger(paidAt) || paidAt < Date.UTC(2020, 0, 1) || paidAt > now + 300000) fail(502, 'order_shape', '订单付款时间待核实');
  return { id, ref, cents, paidAt, status: status === '2' ? 'paid' : 'refunded' };
}
export async function applyOrder(db, raw, env, now) {
  const order = normalizeOrder(raw, env, now);
  if (!order) return;
  // 订单与触发器中的权益变更同一事务；退款不可被迟到的成功通知复活。
  await batch(db, [stmt(db, `INSERT INTO orders(out_trade_no,ref,credential,amount_cents,paid_at,status,updated_at)
    SELECT ?,ref,credential,?,?,?,? FROM order_refs WHERE ref=?
    ON CONFLICT(out_trade_no) DO UPDATE SET status='refunded',updated_at=excluded.updated_at
    WHERE orders.ref=excluded.ref AND orders.credential=excluded.credential AND orders.status='paid' AND excluded.status='refunded'`,
  order.id, order.cents, order.paidAt, order.status, now, order.ref)], now);
}
async function scanRecent(env, db, fetchImpl, now, pause) {
  const cutoff = now - 7 * DAY;
  for (let page = 1; ; page++) {
    const data = await queryOrders(env, { page }, fetchImpl, now);
    // 按付款时间排序，确保同一批续期从旧到新发放。
    const list = data.list.slice().sort((a, b) => Number(a[env.AFDIAN_PAID_AT_FIELD]) - Number(b[env.AFDIAN_PAID_AT_FIELD]));
    for (const raw of list) {
      // 非本站方案无需读取关联号；本站方案缺少关联号则必须阻止上线。
      if (raw.plan_id === env.AFDIAN_PLAN_ID) await applyOrder(db, raw, env, now);
    }
    const oldest = Math.min(...data.list.map(o => Number(o[env.AFDIAN_PAID_AT_FIELD]) * 1000));
    if (page >= data.total_page || !data.list.length || (Number.isFinite(oldest) && oldest < cutoff)) break;
    await pause(1100);
  }
}
export function createService({ db, fetchImpl = fetch, now = Date.now, pause = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  async function auth(request) {
    const token = request.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
    if (!token) fail(401, 'invalid_credential', '访问凭证无效，请刷新页面');
    const record = await stmt(db, 'SELECT * FROM credentials WHERE hash=?', hash(token)).first();
    if (!record) fail(401, 'invalid_credential', '访问凭证无效，请刷新页面');
    return record;
  }
  async function handle(request, env) {
    const time = now(), url = new URL(request.url), origin = request.headers.get('Origin');
    const webhook = !!env.WEBHOOK_PATH_SECRET && url.pathname === '/webhook/' + env.WEBHOOK_PATH_SECRET;
    const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Vary: 'Origin' };
    if (origin === env.ALLOWED_ORIGIN) Object.assign(headers, {
      'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Expose-Headers': 'Retry-After'
    });
    try {
      if (!webhook && (!origin || origin === 'null' || origin !== env.ALLOWED_ORIGIN)) fail(403, 'origin_denied', '请求来源不允许');
      if (request.method === 'OPTIONS' && !webhook) return new Response(null, { status: 204, headers });
      const ipSource = request.headers.get('CF-Connecting-IP');
      if (!ipSource) fail(400, 'missing_ip', '无法识别访问来源');
      const ip = hash(ipSource);
      let result;
      if (webhook && request.method === 'POST') {
        await rate(db, 'webhook', ip, time, 60);
        const body = await jsonBody(request, 32768, true);
        const id = body?.data?.order?.out_trade_no;
        if (typeof id !== 'string' || !/^[\w-]{1,100}$/.test(id)) return new Response(JSON.stringify({ ec: 200 }), { headers });
        paymentConfig(env);
        const data = await queryOrders(env, { out_trade_no: id }, fetchImpl, time);
        const raw = data.list.find(order => order.out_trade_no === id);
        if (!raw) fail(502, 'order_not_found', '尚未查到对应订单');
        await applyOrder(db, raw, env, time);
        result = { ec: 200 };
      } else if (url.pathname === '/api/credential' && request.method === 'POST') {
        await rate(db, 'credential_issue', ip, time, 10);
        const token = random();
        await batch(db, [stmt(db, 'INSERT INTO credentials(hash,created_at) VALUES (?,?)', hash(token), time)], time);
        result = { credential: token };
      } else if (url.pathname === '/api/chat' && request.method === 'POST') {
        const credential = await auth(request);
        const payload = validateChat(await jsonBody(request, 65536));
        if (!env.DEEPSEEK_API_KEY) fail(503, 'chat_unavailable', 'AI 服务尚未配置');
        const attempt = await reserve(db, credential.hash, ip, time);
        let response, data;
        try {
          response = await fetchImpl('https://api.deepseek.com/v1/chat/completions', {
            method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + env.DEEPSEEK_API_KEY },
            body: JSON.stringify(payload), signal: AbortSignal.timeout(60000)
          });
          if (response.status >= 500) { await refund(db, attempt.id, time); fail(502, 'upstream_failure', 'AI 服务暂时不可用；退还额度每天最多 3 次。重试会消耗额度'); }
          if (!response.ok) fail(502, 'upstream_rejected', 'AI 服务暂时无法完成请求。重试会消耗额度');
          try { data = await jsonBody(response, 1048576); }
          catch (error) {
            if (error.name === 'AbortError' || error.name === 'TimeoutError') throw error;
            fail(502, 'upstream_invalid', 'AI 返回格式无效。重试会消耗额度');
          }
        } catch (error) {
          if (error instanceof ApiError) throw error;
          await refund(db, attempt.id, time);
          fail(504, 'upstream_timeout', 'AI 请求超时或网络中断；退还额度每天最多 3 次。重试会消耗额度');
        }
        // 不透传上游错误、请求信息或其它任意字段。
        const choice = data?.choices?.[0];
        result = { choices: [{ finish_reason: typeof choice?.finish_reason === 'string' ? choice.finish_reason : 'stop',
          message: { content: typeof choice?.message?.content === 'string' ? choice.message.content : '' } }] };
      } else if (url.pathname === '/api/feedback' && request.method === 'POST') {
        const body = await jsonBody(request, 8192);
        if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'invalid_feedback', '反馈格式错误');
        if (body && body.contact === undefined) body.contact = '';
        if (!body || Object.keys(body).some(k => !['type', 'content', 'contact', 'page'].includes(k)) || !TYPES.includes(body.type) || typeof body.content !== 'string' || !body.content.trim() || [...body.content].length > 1000 || typeof body.contact !== 'string' || [...body.contact].length > 200 || !PAGES.includes(body.page)) fail(400, 'invalid_feedback', '请检查反馈类型、内容（1 至 1000 字）、联系方式（最多 200 字）和页面');
        await batch(db, [rateStatement(db, 'feedback_short', ip, time, 3), rateStatement(db, 'feedback_day', ip, time, 10, DAY, 8 * 3600000),
          stmt(db, 'INSERT INTO feedback VALUES (?,?,?,?,?,?)', random(), body.type, body.content.trim(), body.contact.trim(), body.page, time)], time);
        result = { ok: true };
      } else if (url.pathname === '/api/order' && request.method === 'POST') {
        paymentConfig(env);
        const credential = await auth(request);
        await rate(db, 'order_create', ip, time, 5);
        const ref = random();
        await batch(db, [stmt(db, 'INSERT INTO order_refs VALUES (?,?,?)', ref, credential.hash, time)], time);
        const link = new URL('https://afdian.com/order/create');
        link.search = new URLSearchParams({ user_id: env.AFDIAN_USER_ID, plan_id: env.AFDIAN_PLAN_ID, custom_order_id: ref }).toString();
        result = { ref, url: link.href };
      } else if (url.pathname === '/api/order-status' && request.method === 'GET') {
        paymentConfig(env);
        const credential = await auth(request), ref = url.searchParams.get('ref');
        await batch(db, [rateStatement(db, 'order_query_ip', ip, time, 60), rateStatement(db, 'order_query_credential', credential.hash, time, 15)], time);
        if (!/^[a-f0-9]{64}$/.test(ref || '')) fail(400, 'invalid_order', '订单关联号无效');
        const owner = await stmt(db, 'SELECT * FROM order_refs WHERE ref=? AND credential=?', ref, credential.hash).first();
        if (!owner) fail(404, 'order_not_found', '未找到该凭证的订单');
        let orders = await stmt(db, 'SELECT status FROM orders WHERE ref=?', ref).all();
        if (!orders.results.length) {
          await scanRecent(env, db, fetchImpl, time, pause);
          orders = await stmt(db, 'SELECT status FROM orders WHERE ref=?', ref).all();
        }
        const current = await stmt(db, 'SELECT expires_at FROM credentials WHERE hash=?', credential.hash).first();
        result = { status: orders.results.some(o => o.status === 'paid') ? 'paid' : orders.results.length ? 'refunded' : 'pending', expires_at: current.expires_at };
      } else fail(404, 'not_found', '接口不存在');
      return new Response(JSON.stringify(result), { headers });
    } catch (error) {
      const safe = error instanceof ApiError ? error : databaseError(error, time);
      if (safe.retryAt) headers['Retry-After'] = String(Math.max(1, Math.ceil((safe.retryAt - time) / 1000)));
      return new Response(JSON.stringify({ error: { code: safe.code, message: safe.message, ...(safe.retryAt ? { retry_at: safe.retryAt } : {}) } }), { status: safe.status, headers });
    }
  }
  async function reconcile(env) {
    const time = now();
    let failure;
    try {
      if (env.AFDIAN_VERIFIED === 'true') {
        await scanRecent(env, db, fetchImpl, time, pause);
        const rows = await stmt(db, "SELECT out_trade_no FROM orders WHERE status='paid' AND paid_at>=?", time - 60 * DAY).all();
        for (let i = 0; i < rows.results.length; i += 50) {
          await pause(1100);
          const ids = rows.results.slice(i, i + 50).map(o => o.out_trade_no);
          const data = await queryOrders(env, { out_trade_no: ids.join(',') }, fetchImpl, time);
          if (ids.some(id => !data.list.some(o => o.out_trade_no === id))) fail(502, 'order_query_incomplete', '退款对账结果不完整');
          for (const raw of data.list) if (ids.includes(raw.out_trade_no)) await applyOrder(db, raw, env, time);
        }
      }
    } catch (error) { failure = error; }
    await batch(db, [stmt(db, 'DELETE FROM attempts WHERE created_at<?', time - 7 * DAY),
      stmt(db, 'DELETE FROM buckets WHERE expires_at<?', time - 7 * DAY),
      stmt(db, 'DELETE FROM order_refs WHERE created_at<? AND NOT EXISTS(SELECT 1 FROM orders WHERE orders.ref=order_refs.ref)', time - 7 * DAY)], time);
    if (failure) throw failure;
  }
  return { handle, reconcile };
}
export default {
  fetch(request, env) { return createService({ db: env.DB }).handle(request, env); },
  scheduled(controller, env, ctx) { ctx.waitUntil(createService({ db: env.DB }).reconcile(env)); }
};
