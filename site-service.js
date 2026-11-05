(function () {
  'use strict';
  function mount() {
    var style = document.createElement('style');
    style.textContent = '.site-service{position:fixed;right:12px;bottom:88px;z-index:100;display:grid;gap:8px;width:max-content;max-width:min(260px,calc(100vw - 24px));padding:10px;border:1px solid rgba(110,84,44,.18);border-radius:18px;background:rgba(255,253,248,.92);box-shadow:0 1px 0 rgba(255,255,255,.75) inset,0 18px 40px -28px rgba(64,44,14,.45),0 2px 6px -3px rgba(64,44,14,.1);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);font:13px/1.5 system-ui,sans-serif}.site-service button,.service-dialog button{cursor:pointer;padding:8px 12px}.service-dialog{box-sizing:border-box;margin:auto;width:min(440px,calc(100vw - 24px));max-height:85vh;overflow:auto;border:1px solid #888;border-radius:10px;padding:20px;background:Canvas;color:CanvasText;font:14px/1.7 system-ui,sans-serif}.service-dialog::backdrop{background:#0008}.service-dialog label{display:block;margin:10px 0}.service-dialog input,.service-dialog textarea,.service-dialog select{box-sizing:border-box;width:100%;font:inherit;padding:6px}.service-dialog textarea{min-height:130px}.service-dialog a{overflow-wrap:anywhere}.service-dialog [role=status]{min-height:1.7em}.service-actions{display:flex;gap:8px;justify-content:flex-end}#support-dialog,#feedback-dialog{border:1px solid rgba(110,84,44,.26);border-radius:16px;padding:22px 22px 18px;background:#fffdf8;color:#2b261f;font:14px/1.7 "PingFang SC","Noto Sans SC","Microsoft YaHei",system-ui,sans-serif;box-shadow:0 1px 0 rgba(255,255,255,.75) inset,0 22px 48px -34px rgba(64,44,14,.38),0 2px 6px -3px rgba(64,44,14,.08)}#support-dialog::backdrop,#feedback-dialog::backdrop{background:rgba(27,24,20,.46)}#support-dialog h2,#feedback-dialog h2{margin:0 0 8px;font-family:"Noto Serif SC","Songti SC","STSong",serif;font-size:22px;font-weight:600;letter-spacing:.12em;color:#1b1814}#support-dialog>p{margin:0 0 12px;color:#7a6f62;font-size:13px;line-height:1.75}#feedback-dialog .feedback-lead{margin:0 0 14px;color:#7a6f62;font-size:13px;line-height:1.7}#feedback-dialog label{margin:12px 0;color:#2b261f;font-size:13px}#feedback-dialog .feedback-hint{display:block;margin:4px 0 6px;color:#a2978a;font-size:12px;line-height:1.6;font-weight:400}#feedback-dialog input,#feedback-dialog textarea,#feedback-dialog select{margin-top:6px;padding:10px 12px;border:1px solid rgba(110,84,44,.26);border-radius:12px;background:#fffcf7;color:#2b261f}#feedback-dialog textarea{min-height:140px;resize:vertical}#feedback-dialog input:focus-visible,#feedback-dialog textarea:focus-visible,#feedback-dialog select:focus-visible{outline:2px solid #b08a46;outline-offset:2px}#support-dialog .service-actions,#feedback-dialog .service-actions{margin-top:16px;gap:10px}#support-dialog .service-actions button,#feedback-dialog .service-actions button{min-height:44px;padding:0 16px;border-radius:12px;font:600 14px/1 "PingFang SC","Noto Sans SC","Microsoft YaHei",system-ui,sans-serif;letter-spacing:.08em;transition:transform .25s cubic-bezier(.22,1,.36,1),box-shadow .25s cubic-bezier(.22,1,.36,1),background .25s cubic-bezier(.22,1,.36,1),border-color .25s cubic-bezier(.22,1,.36,1)}#support-dialog #support-close,#feedback-dialog #feedback-close{border:1px solid rgba(110,84,44,.26);background:#fffdf8;color:#2b261f}#support-dialog #support-close:hover,#feedback-dialog #feedback-close:hover{border-color:#b08a46;background:#fff7e8;transform:translateY(-1px)}#support-dialog #support-pay,#feedback-dialog #feedback-submit{border:1px solid rgba(220,192,138,.45);background:linear-gradient(180deg,#f1dcab,#d2b277);color:#1b1814;box-shadow:0 8px 18px -12px rgba(110,84,44,.45)}#support-dialog #support-pay:hover:not(:disabled),#feedback-dialog #feedback-submit:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 12px 22px -12px rgba(110,84,44,.55)}#support-dialog #support-pay:disabled,#feedback-dialog #feedback-submit:disabled{opacity:.45;cursor:not-allowed;box-shadow:none;transform:none}.site-service button{min-height:44px;min-width:100%;padding:0 16px;border-radius:12px;font:600 13px/1 "PingFang SC","Noto Sans SC","Microsoft YaHei",system-ui,sans-serif;letter-spacing:.08em;cursor:pointer;transition:transform .28s cubic-bezier(.22,1,.36,1),box-shadow .28s cubic-bezier(.22,1,.36,1),background .28s cubic-bezier(.22,1,.36,1),border-color .28s cubic-bezier(.22,1,.36,1),filter .28s cubic-bezier(.22,1,.36,1)}#support-open{border:1px solid rgba(220,192,138,.5);background:linear-gradient(180deg,#f4e0b4,#d2b277 55%,#c6a35f);color:#1b1814;box-shadow:0 1px 0 rgba(255,255,255,.55) inset,0 10px 22px -12px rgba(110,84,44,.55),0 0 0 0 rgba(176,138,70,0)}#support-open:hover{transform:translateY(-2px);filter:brightness(1.03);box-shadow:0 1px 0 rgba(255,255,255,.65) inset,0 16px 28px -14px rgba(110,84,44,.62),0 0 18px rgba(176,138,70,.35)}#support-open:active{transform:translateY(1px) scale(.98);filter:brightness(.98);box-shadow:0 1px 0 rgba(255,255,255,.4) inset,0 6px 14px -10px rgba(110,84,44,.5),0 0 8px rgba(176,138,70,.2)}#feedback-open{border:1px solid rgba(110,84,44,.26);background:linear-gradient(180deg,#fffefb,#f7f0e4);color:#2b261f;box-shadow:0 1px 0 rgba(255,255,255,.8) inset,0 6px 14px -12px rgba(64,44,14,.28)}#feedback-open:hover{border-color:#b08a46;background:linear-gradient(180deg,#fffaf0,#f3e6d0);transform:translateY(-2px);box-shadow:0 1px 0 rgba(255,255,255,.9) inset,0 12px 22px -14px rgba(110,84,44,.4),0 0 14px rgba(176,138,70,.18)}#feedback-open:active{transform:translateY(1px) scale(.98);box-shadow:0 1px 0 rgba(255,255,255,.7) inset,0 4px 10px -8px rgba(64,44,14,.3)}#service-status{color:#7a6f62;font-size:12px;line-height:1.5;max-width:220px}@media (prefers-reduced-motion:reduce){.site-service button{transition:none}#support-open:hover,#support-open:active,#feedback-open:hover,#feedback-open:active{transform:none;filter:none}#support-dialog .service-actions button,#feedback-dialog .service-actions button{transition:none}#support-dialog #support-close:hover,#feedback-dialog #feedback-close:hover,#support-dialog #support-pay:hover:not(:disabled),#feedback-dialog #feedback-submit:hover:not(:disabled){transform:none}}';
    document.head.appendChild(style);
    style.textContent += '.service-dialog [hidden]{display:none}.support-qr{text-align:center}.support-qr svg{display:block;width:256px;max-width:100%;height:auto;margin:12px auto;background:#fff}';
    var root = document.createElement('div');
    root.innerHTML = '<div class="site-service"><button type="button" id="support-open">请作者喝杯奶茶</button><button type="button" id="feedback-open">说说想法</button><span id="service-status" role="status"></span></div>' +
      '<dialog class="service-dialog" id="feedback-dialog" aria-labelledby="feedback-title"><form id="feedback-form"><h2 id="feedback-title">有想法跟我说</h2>' +
      '<p class="feedback-lead">排盘和 AI 都靠大家试用才知道哪里别扭，说一句就很有帮助。</p>' +
      '<label>想说什么<select name="type"><option value="功能建议">想加功能</option><option value="排盘有误">排盘好像不对</option><option value="AI 解读问题">AI 说得不对劲</option><option value="其他">其他</option></select></label>' +
      '<label>内容<textarea name="content" required maxlength="1000" placeholder="哪一步不顺手、希望加什么，随便写两句就行"></textarea></label>' +
      '<label>联系方式（选填）<span class="feedback-hint">如果采纳了你的意见，改好后我会尽量通知你。</span><input name="contact" maxlength="200" placeholder="邮箱或微信号，可不填"></label>' +
      '<p role="status" id="feedback-status"></p><div class="service-actions"><button type="button" id="feedback-close">关闭</button><button type="submit" id="feedback-submit">发给作者</button></div></form></dialog>' +
      '<dialog class="service-dialog" id="support-dialog" aria-labelledby="support-title"><h2 id="support-title">请作者喝杯奶茶</h2>' +
      '<p>排盘可以一直免费用。AI 解读有模型费用，所以每天有少量免费次数；用完仍可看盘，只是暂时不能再问 AI。</p><p>愿意的话可自愿支持——支持后这台设备获得 AI 次数包，不设每日上限。打不打赏都不影响内容。</p>' +
      '<div class="support-qr" id="support-qr" hidden role="img" aria-label="付款二维码"></div><p id="support-scan" hidden>用手机微信或支付宝扫码即可；付款后本页会自动确认。</p>' +
      '<p id="support-link"></p><p role="status" id="support-status"></p><div class="service-actions"><button type="button" id="support-close">关闭</button><button type="button" id="support-pay">打开付款页</button></div></dialog>';
    document.body.appendChild(root);
    var $ = function (id) { return document.getElementById(id); };
    var pending, timer, polling = false;
    function desktop() { return !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) && window.innerWidth >= 768; }
    function showPayment(order) {
      var link = document.createElement('a');
      link.href = order.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
      link.textContent = desktop() ? '在新窗口打开' : '打开付款页';
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
          status('已支持，AI 次数包有效至 ' + new Date(result.expires_at + 8 * 3600000).toISOString().slice(0, 10));
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
        status('正在打开支持页…');
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
