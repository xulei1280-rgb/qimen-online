(function () {
  'use strict';
  function mount() {
    var style = document.createElement('style');
    style.textContent = '.site-service{position:fixed;right:12px;bottom:88px;z-index:100;display:grid;gap:6px;max-width:min(260px,80vw);font:13px/1.5 system-ui,sans-serif}.site-service button,.service-dialog button{cursor:pointer;padding:8px 12px}.service-dialog{box-sizing:border-box;width:min(440px,calc(100vw - 24px));max-height:85vh;overflow:auto;border:1px solid #888;border-radius:10px;padding:20px;background:Canvas;color:CanvasText;font:14px/1.7 system-ui,sans-serif}.service-dialog::backdrop{background:#0008}.service-dialog label{display:block;margin:10px 0}.service-dialog input,.service-dialog textarea,.service-dialog select{box-sizing:border-box;width:100%;font:inherit;padding:6px}.service-dialog textarea{min-height:130px}.service-dialog a{overflow-wrap:anywhere}.service-dialog [role=status]{min-height:1.7em}.service-actions{display:flex;gap:8px;justify-content:flex-end}';
    document.head.appendChild(style);
    style.textContent += '.service-dialog [hidden]{display:none}.support-qr{text-align:center}.support-qr svg{display:block;width:256px;max-width:100%;height:auto;margin:12px auto;background:#fff}';
    var root = document.createElement('div');
    root.innerHTML = '<div class="site-service"><button type="button" id="support-open">打赏解锁</button><button type="button" id="feedback-open">意见反馈</button><span id="service-status" role="status"></span></div>' +
      '<dialog class="service-dialog" id="feedback-dialog" aria-labelledby="feedback-title"><form id="feedback-form"><h2 id="feedback-title">意见反馈</h2>' +
      '<label>类型<select name="type"><option>功能建议</option><option>排盘有误</option><option>AI 解读问题</option><option>其他</option></select></label>' +
      '<label>内容<textarea name="content" required maxlength="1000"></textarea></label><label>联系方式（选填）<input name="contact" maxlength="200"></label>' +
      '<p role="status" id="feedback-status"></p><div class="service-actions"><button type="button" id="feedback-close">关闭</button><button type="submit" id="feedback-submit">提交</button></div></form></dialog>' +
      '<dialog class="service-dialog" id="support-dialog" aria-labelledby="support-title"><h2 id="support-title">自愿支持工具开发</h2>' +
      '<p>打赏不影响解读结果。支持后 30 天内每天 20 次 AI 解读（仍受全站每日额度限制）；退款将撤回对应权益。</p><p>免费每凭证每天 5 次、每 IP 每天 20 次，全站每天 300 次。重试会消耗额度。</p>' +
      '<div class="support-qr" id="support-qr" hidden role="img" aria-label="爱发电打赏付款二维码"></div><p id="support-scan" hidden>用手机微信/支付宝扫码打赏，付款后本页自动解锁</p>' +
      '<p id="support-link"></p><p role="status" id="support-status"></p><div class="service-actions"><button type="button" id="support-close">关闭</button><button type="button" id="support-pay">前往爱发电付款</button></div></dialog>';
    document.body.appendChild(root);
    var $ = function (id) { return document.getElementById(id); };
    var pending, timer, polling = false;
    function desktop() { return !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) && window.innerWidth >= 768; }
    function showPayment(order) {
      var link = document.createElement('a');
      link.href = order.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
      link.textContent = desktop() ? '在新窗口打开' : '打开爱发电付款页面';
      $('support-link').replaceChildren(link, document.createTextNode('。完成付款后返回本页，将自动确认。'));
      $('support-qr').hidden = $('support-scan').hidden = !desktop();
      if (desktop()) {
        var code = qrcode(0, 'M');
        code.addData(order.url); code.make();
        $('support-qr').innerHTML = code.createSvgTag({ scalable: true });
      }
    }
    try { pending = JSON.parse(localStorage.getItem('qimen_pending_order') || 'null'); } catch (error) {}
    function savePending(value) {
      pending = value;
      try {
        if (value) localStorage.setItem('qimen_pending_order', JSON.stringify(value));
        else localStorage.removeItem('qimen_pending_order');
      } catch (error) {}
    }
    function status(message) { $('service-status').textContent = message; $('support-status').textContent = message; }
    async function poll() {
      clearTimeout(timer);
      if (!pending || polling) return;
      if (Date.now() - pending.started >= 600000) { status('确认暂未完成，自动查询已停止；若已付款，后端每日对账会补发权益。'); savePending(null); return; }
      var current = pending;
      polling = true;
      try {
        var result = await DeepSeekClient.request('/api/order-status?ref=' + encodeURIComponent(current.ref));
        if (pending !== current) return;
        if (result.status === 'paid') {
          status('已解锁至 ' + new Date(result.expires_at + 8 * 3600000).toISOString().slice(0, 10));
          if (desktop()) $('support-dialog').close();
          savePending(null);
        } else if (result.status === 'refunded') { status('该订单已退款，对应权益已撤回。'); savePending(null); }
        else timer = setTimeout(poll, 5000);
      } catch (error) { if (pending === current) status(error.message); }
      finally { polling = false; if (pending && pending !== current) timer = setTimeout(poll, 0); }
    }
    $('feedback-open').onclick = function () { $('feedback-status').textContent = ''; $('feedback-dialog').showModal(); };
    $('feedback-close').onclick = function () { $('feedback-dialog').close(); };
    $('feedback-form').onsubmit = async function (event) {
      event.preventDefault();
      var form = event.currentTarget, content = form.elements.content.value.trim();
      if (!content) { $('feedback-status').textContent = '请填写反馈内容。'; form.elements.content.focus(); return; }
      $('feedback-submit').disabled = true;
      try {
        var page = location.pathname.split('/').pop() || 'index.html';
        await DeepSeekClient.request('/api/feedback', { method: 'POST', auth: false, body: {
          type: form.elements.type.value, content: content, contact: form.elements.contact.value.trim(), page: page
        } });
        if (window.SiteAnalytics) window.SiteAnalytics.track('反馈提交');
        form.reset(); $('feedback-status').textContent = '反馈已提交。';
      } catch (error) { $('feedback-status').textContent = error.message; }
      finally { $('feedback-submit').disabled = false; }
    };
    $('support-open').onclick = function () {
      if (window.SiteAnalytics) window.SiteAnalytics.track('点击打赏');
      $('support-dialog').showModal();
      $('support-pay').hidden = desktop();
      if (desktop()) {
        if (pending && pending.url) showPayment(pending);
        else if (!$('support-pay').disabled) return $('support-pay').onclick();
      }
      if (pending) poll();
    };
    $('support-close').onclick = function () { $('support-dialog').close(); };
    $('support-pay').onclick = async function () {
      var mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
      var paymentWindow = mobile ? window.open('about:blank', '_blank') : null;
      if (paymentWindow) paymentWindow.opener = null;
      $('support-pay').disabled = true;
      if (desktop()) {
        $('support-qr').replaceChildren(); $('support-link').replaceChildren();
        status('正在创建打赏订单…');
      }
      try {
        var order = await DeepSeekClient.request('/api/order', { method: 'POST' });
        showPayment(order);
        savePending({ ref: order.ref, url: order.url, started: Date.now() }); status('等待付款，正在自动确认…');
        if (mobile) {
          if (paymentWindow) paymentWindow.location.href = order.url;
          else location.assign(order.url);
        }
        poll();
      } catch (error) { if (paymentWindow) paymentWindow.close(); status(error.message); }
      finally { $('support-pay').disabled = false; }
    };
    document.addEventListener('visibilitychange', function () { if (!document.hidden) poll(); });
    window.addEventListener('focus', poll);
    if (pending) poll();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();
