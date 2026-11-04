(function () {
  'use strict';

  var consentKey = 'qimen_ai_transfer_consent_v1';
  var sessionConsent = {};

  function confirmAI(options) {
    var consent;
    try {
      consent = JSON.parse(localStorage.getItem(consentKey) || '{}') || {};
    } catch (error) {
      consent = sessionConsent;
    }
    var diary = !!(options && options.includeDiary);
    if (consent.ai && (!diary || consent.diary)) return true;
    var message = consent.ai ? '' : '盘面和问题将发送至 DeepSeek 处理，是否继续？';
    if (diary && !consent.diary) message += '\n将同时发送所勾选的日记内容，是否继续？';
    if (!window.confirm(message.trim())) return false;
    sessionConsent = { ai: true, diary: !!consent.diary || diary };
    try {
      localStorage.setItem(consentKey, JSON.stringify(sessionConsent));
    } catch (error) {
      // 存储不可用时，本页会话内保留已确认的范围。
    }
    return true;
  }

  window.SiteNotice = { confirmAI: confirmAI };

  var style = document.createElement('style');
  style.textContent = '.site-notice{box-sizing:border-box;max-width:1100px;margin:24px auto;padding:16px 20px 90px;border-top:1px solid currentColor;font:13px/1.8 system-ui,sans-serif;color:inherit;overflow-wrap:anywhere}.site-notice p{margin:0 0 8px}.site-notice summary{cursor:pointer}.site-notice li{margin:6px 0}.site-ai-notice{margin:10px 12px;font:12px/1.7 system-ui,sans-serif;color:inherit;opacity:.85}';
  document.head.appendChild(style);

  function mountFooter() {
    var footer = document.createElement('footer');
    footer.className = 'site-notice';
    footer.innerHTML = '<p>传统文化学习工具，解读仅供参考，不作为医疗、法律或投资决策依据。</p>' +
      '<details><summary>使用与数据说明</summary><ul>' +
      '<li><strong>用途</strong>　按传统规则演示排盘方法，供学习参考，结果不保证准确。</li>' +
      '<li><strong>AI 可能出错</strong>　AI 解读由第三方大模型自动生成，可能有误或前后矛盾。</li>' +
      '<li><strong>决策边界与数据</strong>　不作为医疗、法律、投资等决策依据。排盘和日记默认只存本机浏览器。使用 AI 时，相关盘面和问题会发送给 DeepSeek。</li>' +
      '</ul></details>';
    document.body.appendChild(footer);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountFooter, { once: true });
  else mountFooter();
})();
