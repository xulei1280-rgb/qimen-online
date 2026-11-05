import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// 最小 DOM 假对象测试事件逻辑；真实布局/原生表单校验仍需浏览器验收。
function page({ mobile = false, width = 1440, stored, request } = {}) {
  const nodes = new Map(), storage = stored || new Map(), timers = new Map(), events = new Map(), popup = { location: {}, close() { this.closed = true; } };
  let time = 1000000, timerId = 0, opens = 0;
  function node(tag = 'div') {
    return { tagName: tag, value: '', textContent: '', disabled: false, children: [], open: false,
      showModal() { this.open = true; }, close() { this.open = false; }, focus() { this.focused = true; },
      replaceChildren(...children) { this.children = children; },
      set innerHTML(html) {
        this.html = html;
        for (const [, id] of html.matchAll(/id="([^"]+)"/g)) nodes.set(id, node());
        if (html.includes('id="feedback-form"')) {
          const form = nodes.get('feedback-form'); form.elements = { type: { value: '功能建议' }, content: { value: '', focus() {} }, contact: { value: '' } };
          form.reset = () => { form.elements.content.value = ''; form.elements.contact.value = ''; };
        }
      },
      appendChild(child) { this.children.push(child); }
    };
  }
  const document = { readyState: 'complete', hidden: false, head: node(), body: node(),
    createElement: node, createTextNode: text => ({ textContent: text }), getElementById: id => nodes.get(id),
    addEventListener(name, fn) { events.set(name, fn); }
  };
  const analytics = [];
  const context = { SiteAnalytics: { track(event) { analytics.push(event); } }, document, innerWidth: width, navigator: { userAgent: mobile ? 'iPhone' : 'Desktop' }, location: { pathname: '/qimen-online/bazi.html', assign(url) { this.assigned = url; } },
    localStorage: { getItem: k => storage.get(k) || null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) },
    Date: class extends Date { static now() { return time; } },
    DeepSeekClient: { request }, setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms }); return id; }, clearTimeout(id) { timers.delete(id); },
    addEventListener(name, fn) { events.set(name, fn); }, open() { opens++; return popup; }
  };
  context.window = context;
  vm.runInNewContext(readFileSync(new URL('../../vendor/qrcode-generator.js', import.meta.url), 'utf8'), context);
  const generate = context.qrcode, qrUrls = [];
  context.qrcode = function (version, ecl) {
    assert.equal(version, 0); assert.equal(ecl, 'M');
    const code = generate(version, ecl), addData = code.addData;
    code.addData = function (url) { qrUrls.push(url); addData(url); };
    return code;
  };
  vm.runInNewContext(readFileSync(new URL('../../site-service.js', import.meta.url), 'utf8'), context);
  return { nodes, timers, events, storage, popup, document, qrUrls, analytics, opens: () => opens, advance: ms => time += ms };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('共享反馈表单：空内容不发送；只传类型、内容、选填联系和页面，不带凭证或资料', async () => {
  const calls = [], p = page({ request: async (...args) => { calls.push(args); return { ok: true }; } });
  p.nodes.get('feedback-open').onclick(); assert.equal(p.nodes.get('feedback-dialog').open, true);
  const form = p.nodes.get('feedback-form'), event = { preventDefault() {}, currentTarget: form };
  await form.onsubmit(event); assert.equal(calls.length, 0);
  form.elements.content.value = '  测试建议  '; await form.onsubmit(event);
  assert.equal(calls.length, 1); assert.equal(calls[0][0], '/api/feedback');
  assert.equal(calls[0][1].auth, false);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0][1].body)), { type: '功能建议', content: '测试建议', contact: '', page: 'bazi.html' });
  assert.equal(p.nodes.get('feedback-status').textContent, '反馈已提交。'); assert.equal(p.nodes.get('feedback-submit').disabled, false);
  assert.deepEqual(p.analytics, ['反馈提交']);
});
test('桌面点击解锁生成同订单二维码和后备链接，5秒轮询成功关闭弹窗', async () => {
  let polls = 0; const calls = [];
  const p = page({ request: async path => { calls.push(path); if (path === '/api/order') return { ref: 'a'.repeat(64), url: 'https://afdian.com/order/create?custom_order_id=test' }; return ++polls <= 2 ? { status: 'pending' } : { status: 'paid', expires_at: Date.UTC(2026, 11, 5) }; } });
  await p.nodes.get('support-open').onclick(); await flush(); assert.equal(p.nodes.get('support-dialog').open, true);
  assert.equal(p.nodes.get('support-pay').hidden, true);
  assert.equal(p.nodes.get('support-qr').hidden, false);
  assert.match(p.nodes.get('support-qr').html, /<svg\b/);
  assert.deepEqual(p.qrUrls, [p.nodes.get('support-link').children[0].href]);
  assert.equal(p.nodes.get('support-link').children[0].textContent, '在新窗口打开');
  p.nodes.get('support-close').onclick(); assert.equal(p.nodes.get('support-dialog').open, false);
  await p.nodes.get('support-open').onclick(); await flush();
  assert.equal(calls.filter(path => path === '/api/order').length, 1, '重新打开沿用订单');
  assert.equal(p.opens(), 0); assert.equal(p.nodes.get('support-link').children[0].rel, 'noopener noreferrer');
  assert.equal(p.timers.size, 1); const timer = [...p.timers.values()][0]; assert.equal(timer.ms, 5000);
  await timer.fn(); await flush();
  assert.equal(p.nodes.get('service-status').textContent, '已支持，AI 次数包有效至 2026-12-05'); assert.equal(p.timers.size, 0);
  assert.equal(p.storage.has('qimen_pending_order'), false); assert.equal(calls.length, 4);
  assert.equal(p.nodes.get('support-dialog').open, false);
  assert.deepEqual(p.analytics, ['点击打赏', '点击打赏']);
});
test('手机付款窗口/返回焦点触发；保存的关联号可在重载后继续查询', async () => {
  const stored = new Map();
  const p = page({ mobile: true, stored, request: async path => path === '/api/order' ? { ref: 'a'.repeat(64), url: 'https://afdian.com/order/create?custom_order_id=test' } : { status: 'pending' } });
  await p.nodes.get('support-pay').onclick(); await flush(); assert.equal(p.opens(), 1); assert.equal(p.popup.opener, null); assert.match(p.popup.location.href, /^https:\/\/afdian.com\/order\/create/);
  assert.ok(stored.has('qimen_pending_order'));
  assert.equal(p.qrUrls.length, 0, '移动端不生成二维码');
  let polls = 0;
  const reloaded = page({ stored, request: async () => { polls++; return { status: 'pending' }; } });
  await flush(); assert.equal(polls, 1);
  await reloaded.events.get('focus')(); await flush(); assert.equal(polls, 2);
  reloaded.advance(600001); await reloaded.events.get('visibilitychange')(); await flush();
  assert.equal(polls, 2); assert.equal(reloaded.timers.size, 0);
});
test('反馈失败可再提交；支付创建失败关闭预开的手机窗口，不误报成功', async () => {
  const p = page({ mobile: true, request: async () => { throw new Error('服务暂时不可用'); } });
  const form = p.nodes.get('feedback-form'); form.elements.content.value = '建议';
  await form.onsubmit({ preventDefault() {}, currentTarget: form });
  assert.equal(p.nodes.get('feedback-submit').disabled, false); assert.equal(form.elements.content.value, '建议');
  await p.nodes.get('support-pay').onclick(); assert.equal(p.popup.closed, true); assert.equal(p.nodes.get('support-pay').disabled, false);
  assert.equal(p.nodes.get('service-status').textContent, '服务暂时不可用');
  assert.deepEqual(p.analytics, [], '提交失败不记录反馈成功事件');
});

test('非移动UA窄屏保持原链接流程，不自动创建订单或显示二维码', async () => {
  let calls = 0;
  const p = page({ width: 600, request: async path => { calls++; return path === '/api/order' ? { ref: 'a'.repeat(64), url: 'https://afdian.com/order/create?custom_order_id=test' } : { status: 'pending' }; } });
  p.nodes.get('support-open').onclick(); assert.equal(calls, 0);
  assert.equal(p.nodes.get('support-pay').hidden, false);
  await p.nodes.get('support-pay').onclick(); await flush();
  assert.equal(p.qrUrls.length, 0); assert.equal(p.nodes.get('support-qr').hidden, true);
});
