(function (root, factory) {
  var client = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = client;
  if (root) root.DeepSeekClient = client;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var base = root.QIMEN_API_BASE || 'https://api.qimenbazi.cn';
  var credential = '', pendingCredential;
  try {
    root.localStorage.removeItem('qimen_deepseek_api_key');
    base = root.localStorage.getItem('qimen_api_base') || base;
    credential = root.localStorage.getItem('qimen_credential') || '';
  } catch (error) { /* 存储不可用时在本页会话内保留凭证。 */ }
  root.QIMEN_API_BASE = base.replace(/\/+$/, '');

  function extractAnswer(body) {
    var choice = body && body.choices && body.choices[0];
    var answer = choice && choice.message && typeof choice.message.content === 'string' ? choice.message.content.trim() : '';
    if (answer) return answer;
    var reason = choice && choice.finish_reason;
    if (reason === 'length') throw new Error('AI 输出额度已用尽，请缩短问题后重试。重试会消耗额度。');
    if (reason === 'content_filter') throw new Error('AI 因内容过滤没有返回回答，请调整问题。');
    if (reason === 'insufficient_system_resource') throw new Error('AI 当前资源不足，请稍后重试。重试会消耗额度。');
    if (reason === 'tool_calls') throw new Error('AI 返回了当前页面不支持的工具调用。');
    if (choice && choice.message && choice.message.reasoning_content) throw new Error('AI 只返回了思考过程，没有生成最终回答。重试会消耗额度。');
    throw new Error('AI 未返回最终回答，请重试。重试会消耗额度。');
  }
  async function send(path, options, fetchImpl) {
    var response;
    try { response = await fetchImpl(root.QIMEN_API_BASE + path, options); }
    catch (error) { throw new Error('无法连接本站 AI 服务，请稍后重试。重试会消耗额度。'); }
    var body = await response.json().catch(function () { return {}; });
    if (!response.ok) {
      var error = new Error(body.error && body.error.message || '本站服务暂时不可用，请稍后再试。');
      error.code = body.error && body.error.code;
      error.retryAt = body.error && body.error.retry_at;
      throw error;
    }
    return body;
  }
  async function getCredential(fetchImpl) {
    if (credential) return credential;
    if (!pendingCredential) {
      pendingCredential = send('/api/credential', { method: 'POST' }, fetchImpl).then(function (body) {
        if (!/^[a-f0-9]{64}$/.test(body.credential || '')) throw new Error('访问凭证领取失败，请刷新重试。');
        credential = body.credential;
        try { root.localStorage.setItem('qimen_credential', credential); } catch (error) {}
        return credential;
      }).finally(function () { pendingCredential = null; });
    }
    return pendingCredential;
  }
  async function request(path, options) {
    options = options || {};
    var fetchImpl = options.fetchImpl || root.fetch;
    if (!fetchImpl) throw new Error('当前浏览器不支持网络请求。');
    var headers = { 'Content-Type': 'application/json' };
    if (options.auth !== false) headers.Authorization = 'Bearer ' + await getCredential(fetchImpl);
    return send(path, { method: options.method || 'GET', headers: headers,
      ...(options.body ? { body: JSON.stringify(options.body) } : {}) }, fetchImpl);
  }
  async function requestFinal(options) {
    options = options || {};
    if (typeof window !== 'undefined') {
      if (!window.SiteNotice) throw new Error('使用与数据说明未加载，请刷新后重试。');
      if (!window.SiteNotice.confirmAI(options)) throw new Error('已取消发送至 DeepSeek。');
    }
    var body = await request('/api/chat', { method: 'POST', fetchImpl: options.fetchImpl,
      body: { messages: options.messages || [], max_tokens: Math.min(Number(options.maxTokens) || 4096, 4096) } });
    return { answer: extractAnswer(body), retried: false, response: body };
  }
  return Object.freeze({ MODEL: 'deepseek-v4-flash', extractAnswer: extractAnswer, requestFinal: requestFinal, request: request });
});
