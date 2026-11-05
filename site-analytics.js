(function () {
  'use strict';
  const UMAMI_WEBSITE_ID = '';
  var events = ['排盘完成', 'AI 解读调用', '反馈提交', '点击打赏', '打赏建单成功', '打赏建单失败', '打赏到账'];
  var pages = ['index.html', 'bazi.html', 'liuyao.html', 'ziwei.html', 'daily.html'];

  window.SiteAnalytics = { track: function (event) {
    if (!UMAMI_WEBSITE_ID || events.indexOf(event) < 0 || !window.umami || typeof window.umami.track !== 'function') return;
    var page = window.location.pathname.split('/').pop() || 'index.html';
    if (pages.indexOf(page) < 0) return;
    try {
      // 自定义白名单载荷，不继承 URL 参数、hash、referrer、标题或业务数据。
      var sent = window.umami.track({ website: UMAMI_WEBSITE_ID, hostname: window.location.hostname,
        url: '/' + (page === 'index.html' ? '' : page), name: event, data: { page: page } });
      if (sent && typeof sent.catch === 'function') sent.catch(function () {});
    } catch (error) { /* 统计失败不影响排盘、AI 和付款。 */ }
  } };
  if (!UMAMI_WEBSITE_ID) return;
  var script = document.createElement('script');
  script.src = 'https://cloud.umami.is/script.js';
  script.async = true;
  script.setAttribute('data-website-id', UMAMI_WEBSITE_ID);
  script.setAttribute('data-auto-track', 'false');
  script.onerror = function () {};
  document.head.appendChild(script);
})();
