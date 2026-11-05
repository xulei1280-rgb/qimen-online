import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// 最小 DOM 假对象测试事件逻辑；真实布局/原生表单校验仍需浏览器验收。
function page({ mobile = false, width = 1440, anchorBottom = 200, stored, request } = {}) {
  const nodes = new Map(), storage = stored || new Map(), timers = new Map(), events = new Map(), popup = { location: {}, close() { this.closed = true; } };
  let time = 1000000, timerId = 0, opens = 0;
  function node(tag = 'div') {
    const classes = new Set();
    return { classList: { toggle(name, on) { if (on) classes.add(name); else classes.delete(name); }, contains(name) { return classes.has(name); } },
      style: { setProperty(name, value) { this[name] = value; } },
      setAttribute(name, value) { this[name] = value; },
      addEventListener(name, fn) { this[name] = fn; },
      get innerHTML() { return this.html || ''; },
      tagName: tag, value: '', textContent: '', disabled: false, children: [], open: false,
      showModal() { this.open = true; }, close() { this.open = false; }, focus() { this.focused = true; },
      replaceChildren(...children) { this.children = children; },
      set innerHTML(html) {
        this.html = html;
        for (const [, id] of html.matchAll(/id="([^"]+)"/g)) nodes.set(id, node());
        if (html.includes('id="support-amount"')) { nodes.get('support-amount').value = '6'; nodes.get('support-custom-field').hidden = true; }
        if (html.includes('id="feedback-form"')) {
          const form = nodes.get('feedback-form'); form.elements = { type: { value: '功能建议' }, content: { value: '', focus() {} }, contact: { value: '' } };
          form.reset = () => { form.elements.content.value = ''; form.elements.contact.value = ''; };
        }
      },
      appendChild(child) { this.children.push(child); }
    };
  }
  const document = { readyState: 'complete', hidden: false, head: node(), body: node(),
    querySelectorAll() { return anchorBottom === null ? [] : [{ getClientRects: () => [1], getBoundingClientRect: () => ({ bottom: anchorBottom - context.scrollY }) }]; },
    createElement: node, createTextNode: text => ({ textContent: text }), getElementById: id => nodes.get(id),
    addEventListener(name, fn) { events.set(name, fn); }
  };
  const analytics = [];
  const context = { SiteAnalytics: { track(event) { analytics.push(event); } }, document, innerWidth: width, innerHeight: 800, scrollY: 0, navigator: { userAgent: mobile ? 'iPhone' : 'Desktop' }, location: { pathname: '/qimen-online/bazi.html', assign(url) { this.assigned = url; } },
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
  return { context, nodes, timers, events, storage, popup, document, qrUrls, analytics, opens: () => opens, advance: ms => time += ms };
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
test('桌面选择金额后生成同订单二维码和后备链接，5秒轮询成功关闭弹窗', async () => {
  let polls = 0; const calls = [];
  const p = page({ request: async path => { calls.push(path); if (path === '/api/order') return { ref: 'a'.repeat(64), url: 'https://afdian.com/order/create?custom_order_id=test' }; return ++polls <= 2 ? { status: 'pending' } : { status: 'paid', remaining: 150, expires_at: Date.UTC(2026, 11, 5) }; } });
  await p.nodes.get('support-open').onclick(); await flush(); assert.equal(p.nodes.get('support-dialog').open, true);
  assert.equal(calls.length, 0, '先选择金额再下单');
  await p.nodes.get('support-pay').onclick(); await flush();
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
  assert.equal(p.nodes.get('service-status').textContent, '感谢支持，心意已收到。'); assert.equal(p.timers.size, 0);
  assert.equal(p.storage.has('qimen_pending_order'), false); assert.equal(calls.length, 4);
  assert.equal(p.nodes.get('support-dialog').open, false);
  assert.equal(p.nodes.get('support-success-dialog').open, true);
  assert.equal(p.nodes.get('support-success-detail').textContent, 'AI 次数包剩余 150 次，有效至 2026-12-05');
  p.nodes.get('support-success-close').onclick();
  assert.equal(p.nodes.get('support-success-dialog').open, false);
  assert.deepEqual(p.analytics, ['点击打赏', '打赏建单成功', '点击打赏', '打赏到账']);
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
  assert.deepEqual(p.analytics, ['打赏建单失败'], '只记录建单失败，不记录反馈成功或到账');
});

test('非移动UA窄屏保持原链接流程，不自动创建订单或显示二维码', async () => {
  let calls = 0;
  const p = page({ width: 600, request: async path => { calls++; return path === '/api/order' ? { ref: 'a'.repeat(64), url: 'https://afdian.com/order/create?custom_order_id=test' } : { status: 'pending' }; } });
  p.context.scrollY = 1000; p.events.get('scroll')();
  p.nodes.get('support-open').onclick(); p.nodes.get('support-open').onclick(); assert.equal(calls, 0);
  assert.equal(p.nodes.get('support-pay').textContent, '打开付款页');
  await p.nodes.get('support-pay').onclick(); await flush();
  assert.equal(p.qrUrls.length, 0); assert.equal(p.nodes.get('support-qr').hidden, true);
});


test('默认6元可改；金额只传下单，不展示价目表；保留墨金动效和减少动态适配', async () => {
  const calls = [], p = page({ request: async (path, options) => {
    calls.push({ path, options });
    return path === '/api/order' ? { ref: 'b'.repeat(64), url: 'https://afdian.com/order/create?custom_price=18' } : { status: 'pending' };
  } });
  assert.equal(p.nodes.get('support-amount').value, '6');
  p.nodes.get('support-open').onclick();
  p.nodes.get('support-custom').onclick(); p.nodes.get('support-amount').value = '18';
  await p.nodes.get('support-pay').onclick(); await flush();
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), { path: '/api/order', options: { method: 'POST', body: { amount: '18' } } });
  assert.equal(JSON.parse(p.storage.get('qimen_pending_order')).amount, '18');
  assert.equal(p.qrUrls[0], 'https://afdian.com/order/create?custom_price=18');
  const html = p.document.body.children[0].html, css = p.document.head.children[0].textContent;
  assert.match(html, /min="6" max="999999999" step="1" value="6" inputmode="numeric"/);
  for (const text of ['请作者喝杯奶茶', '随缘量力，多一点支持，能有更多的 AI 次数。', '不设每日上限']) assert.ok(html.includes(text));
  assert.doesNotMatch(html, /600次|2500次|plan_id|本设备凭证共|次数包每笔有效|不发次数包|纯打赏|少于 6 元|不增加 AI 次数/);
  for (const text of ['#support-open:hover', 'translateY(-1px)', 'prefers-reduced-motion:reduce', 'border-radius:999px', 'linear-gradient(180deg,#f1dcab,#d2b277)', 'text-decoration:underline', 'text-align:right']) assert.ok(css.includes(text));
  assert.ok(html.includes('class="support-open-icon" aria-hidden="true"><svg'));
  assert.match(css, /\.site-service\{[^}]*padding:0;border:none;background:transparent;box-shadow:none/);
  assert.match(css, /#feedback-open\{[^}]*border:none;border-radius:0;background:transparent;color:#8a6a2f/);
  assert.doesNotMatch(css, /\.site-service button|filter:brightness|translateY\(-2px\)|scale\(/);
});
test('非法金额不建单或打开付款窗口；不足6元拒绝建单', async () => {
  let creates = 0;
  const p = page({ mobile: true, request: async path => { if (path === '/api/order') creates++; return { ref: 'a'.repeat(64), url: 'https://afdian.com/order/create', status: 'pending' }; } });
  for (const value of ['', '0', '5', '5.99', '-1', '6.001', '1.5', '6.00', '1e2', 'NaN', '1000000000']) {
    p.nodes.get('support-custom').onclick(); p.nodes.get('support-amount').value = value;
    await p.nodes.get('support-pay').onclick();
  }
  assert.equal(creates, 0); assert.equal(p.opens(), 0);
  p.nodes.get('support-custom').onclick(); p.nodes.get('support-amount').value = '6'; await p.nodes.get('support-pay').onclick();
  assert.equal(creates, 1); assert.equal(p.opens(), 1);
});

test('不足6元实付和退款会结束轮询，给出对应软提示', async () => {
  for (const [result, expected] of [
    [{ status: 'paid', granted: 125, remaining: 125, expires_at: 0 }, '感谢支持，心意已收到。'],
    [{ status: 'refunded' }, '该订单已退款，对应权益已撤回。']
  ]) {
    const stored = new Map([['qimen_pending_order', JSON.stringify({ ref: 'a'.repeat(64), amount: '5', started: 1000000 })]]);
    const p = page({ stored, request: async () => result });
    await flush();
    assert.equal(p.nodes.get('service-status').textContent, expected);
    assert.equal(p.nodes.get('support-success-dialog').open, result.status === 'paid');
    assert.equal(p.storage.has('qimen_pending_order'), false); assert.equal(p.timers.size, 0);
  }
});

test('手机与重载后确认付款均显示成功弹窗，缺少有效期不显示日期', async () => {
  for (const mobile of [true, false]) {
    const stored = new Map([['qimen_pending_order', JSON.stringify({ ref: 'a'.repeat(64), started: 1000000 })]]);
    const p = page({ mobile, stored, request: async () => ({ status: 'paid', granted: 0, remaining: 0 }) });
    await flush();
    assert.equal(p.nodes.get('support-success-dialog').open, true);
    assert.equal(p.nodes.get('support-success-detail').textContent, 'AI 次数包剩余 0 次');
    assert.equal(p.nodes.get('service-status').textContent, '感谢支持，心意已收到。');
    assert.equal(stored.has('qimen_pending_order'), false);
    await p.events.get('focus')();
    assert.equal(p.timers.size, 0);
  }
});

test('原胶囊线性露茶杯；首次点击只展开，第二次才记漏斗并开弹窗；右滑收回', () => {
  const p = page({ mobile: true }), drawer = p.nodes.get('service-drawer'), button = p.nodes.get('support-open');
  const scroll = y => { p.context.scrollY = y; p.events.get('scroll')(); };
  assert.equal(p.nodes.has('service-peek'), false);
  assert.equal(drawer.classList.contains('service-hidden'), true);
  scroll(200); assert.equal(drawer.classList.contains('service-hidden'), true);
  scroll(400); assert.equal(drawer.style['--service-reveal'], '18.5px');
  scroll(600); assert.equal(drawer.style['--service-reveal'], '37px');
  scroll(1000); assert.equal(drawer.style['--service-reveal'], '37px');
  button.onclick(); assert.equal(drawer.classList.contains('service-collapsed'), false);
  assert.equal(p.nodes.get('support-dialog').open, false); assert.deepEqual(p.analytics, []);
  button.onclick(); assert.equal(p.nodes.get('support-dialog').open, true);
  assert.deepEqual(p.analytics, ['点击打赏']);
  drawer.touchstart({ touches: [{ clientX: 10, clientY: 10 }] });
  drawer.touchend({ changedTouches: [{ clientX: 20, clientY: 100 }] });
  assert.equal(drawer.classList.contains('service-collapsed'), false);
  drawer.touchstart({ touches: [{ clientX: 10, clientY: 10 }] });
  drawer.touchend({ changedTouches: [{ clientX: 80, clientY: 15 }] });
  assert.equal(drawer.classList.contains('service-collapsed'), true);
  scroll(0); assert.equal(drawer.classList.contains('service-hidden'), true);
});
test('桌面完整显示；手机无锚点从一屏后露头', () => {
  const p = page(), drawer = p.nodes.get('service-drawer');
  assert.equal(drawer.classList.contains('service-mobile'), false);
  assert.equal(drawer.classList.contains('service-hidden'), false);
  p.context.innerWidth = 390; p.events.get('resize')();
  assert.equal(drawer.classList.contains('service-hidden'), true);
  p.context.innerWidth = 1440; p.events.get('resize')();
  assert.equal(drawer.classList.contains('service-hidden'), false);
  const fallback = page({ mobile: true, anchorBottom: null });
  fallback.context.scrollY = 1000; fallback.events.get('scroll')();
  assert.equal(fallback.nodes.get('service-drawer').style['--service-reveal'], '18.5px');
});
test('每次打开默认静态6元，不聚焦输入；自定义才显示，默认付款忽略隐藏值', async () => {
  const calls = [], p = page({ request: async (path, options) => {
    if (path === '/api/order') calls.push(options.body.amount);
    return { ref: 'a'.repeat(64), url: 'https://afdian.com/order/create', status: 'pending' };
  } });
  p.nodes.get('support-open').onclick();
  assert.equal(p.nodes.get('support-custom-field').hidden, true);
  assert.equal(p.nodes.get('support-amount').focused, undefined);
  p.nodes.get('support-amount').value = '18';
  await p.nodes.get('support-pay').onclick();
  assert.deepEqual(calls, ['6']);
  p.nodes.get('support-custom').onclick();
  assert.equal(p.nodes.get('support-custom-field').hidden, false);
  assert.equal(p.nodes.get('support-amount').focused, true);
  p.nodes.get('support-open').onclick();
  assert.equal(p.nodes.get('support-custom-field').hidden, true);
  assert.match(p.document.head.children[0].textContent, /#support-amount\{font-size:16px\}/);
});

test('漏斗：未开放只计失败，重试成功；复用订单不重计，paid仅确认一次', async () => {
  let unavailable = true, paid = false;
  const p = page({ request: async path => {
    if (path === '/api/order') {
      if (unavailable) throw new Error('支持功能即将开放');
      return { ref: 'a'.repeat(64), url: 'https://afdian.com/order/create?custom_order_id=test' };
    }
    return { status: paid ? 'paid' : 'pending' };
  } });
  p.nodes.get('support-open').onclick();
  p.nodes.get('support-custom').onclick(); p.nodes.get('support-amount').value = '0';
  await p.nodes.get('support-pay').onclick();
  assert.deepEqual(p.analytics, ['点击打赏']);
  p.nodes.get('support-custom').onclick(); p.nodes.get('support-amount').value = '6';
  await p.nodes.get('support-pay').onclick();
  assert.equal(p.nodes.get('service-status').textContent, '支持功能即将开放');
  unavailable = false;
  await p.nodes.get('support-pay').onclick(); await flush();
  await p.nodes.get('support-pay').onclick(); await flush();
  assert.deepEqual(p.analytics, ['点击打赏', '打赏建单失败', '打赏建单成功']);
  paid = true;
  p.events.get('focus')(); await flush();
  p.events.get('focus')(); await flush();
  assert.deepEqual(p.analytics, ['点击打赏', '打赏建单失败', '打赏建单成功', '打赏到账']);
});

test('自定义金额失焦或change更新居中展示，按钮文案不变且无确认按钮', async () => {
  for (const mobile of [false, true]) {
    const amounts = [], p = page({ mobile, request: async (path, options) => {
      if (path === '/api/order') amounts.push(options.body.amount);
      return { ref: 'a'.repeat(64), url: 'https://afdian.com/order/create', status: 'pending' };
    } });
    if (mobile) { p.context.scrollY = 1000; p.events.get('scroll')(); p.nodes.get('support-open').onclick(); }
    p.nodes.get('support-open').onclick();
    const html = p.document.body.children[0].html;
    assert.match(html, /id="support-title" tabindex="-1" autofocus/);
    assert.equal((html.match(/autofocus/g) || []).length, 1);
    assert.doesNotMatch(html.match(/<input id="support-amount"[^>]*>/)[0], /required|autofocus/);
    assert.match(html, /class="support-amount-unit">元/);
    assert.match(p.document.head.children[0].textContent, /#support-dialog #support-default\{text-align:center/);
    const input = p.nodes.get('support-amount'), custom = p.nodes.get('support-custom');
    custom.onclick();
    assert.equal(custom.textContent, '自定义');
    assert.doesNotMatch(html, /确认金额/);
    for (const event of ['onblur', 'onchange']) {
      for (const value of ['', '0', '5', '-1', '6.5', '1e2', '1000000000']) {
        input.value = value;
        input.focused = false;
        const previous = p.nodes.get('support-amount-display').textContent;
        input[event]();
        assert.equal(p.nodes.get('support-amount-display').textContent, previous);
        assert.equal(p.nodes.get('service-status').textContent, '支持金额最低 6 元，请填写正整数');
        assert.equal(input.focused, false, '软提示不抢焦点或重新打开键盘');
      }
      input.value = event === 'onblur' ? '012' : '018';
      input[event]();
      assert.equal(p.nodes.get('support-amount-display').textContent, event === 'onblur' ? '12' : '18');
      assert.equal(p.nodes.get('support-default').hidden, false);
      assert.equal(custom.textContent, '自定义');
      assert.equal(p.nodes.get('support-custom-field').hidden, false);
    }
    await p.nodes.get('support-pay').onclick();
    assert.deepEqual(amounts, ['18']);
    p.nodes.get('support-close').onclick(); p.nodes.get('support-open').onclick();
    assert.equal(p.nodes.get('support-amount-display').textContent, '6');
  }
});
