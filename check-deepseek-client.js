'use strict';
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync('deepseek-client.js', 'utf8');
const token = 'a'.repeat(64);
function load(storage = new Map()) {
  const context = { localStorage: { getItem: k => storage.get(k) || null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) } };
  vm.createContext(context); vm.runInContext(source, context); return context;
}
const response = (body, ok = true) => ({ ok, async json() { return body; } });
async function run() {
  const storage = new Map([['qimen_deepseek_api_key', 'old-secret-never-send'], ['qimen_api_base', 'http://localhost:8787/']]);
  const root = load(storage), client = root.DeepSeekClient, calls = [], analytics = [];
  root.SiteAnalytics = { track(event) { analytics.push(event); } };
  assert.equal(storage.has('qimen_deepseek_api_key'), false);
  assert.equal(root.QIMEN_API_BASE, 'http://localhost:8787');
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return response(url.endsWith('/credential') ? { credential: token } : { choices: [{ message: { content: ' answer ' } }] });
  };
  const results = await Promise.all([1, 2].map(() => client.requestFinal({ messages: [{ role: 'user', content: 'test' }], maxTokens: 16384, fetchImpl })));
  assert.ok(results.every(r => r.answer === 'answer' && r.retried === false));
  assert.equal(calls.filter(c => c.url.endsWith('/credential')).length, 1, 'parallel first requests share credential issuance');
  const chats = calls.filter(c => c.url.endsWith('/chat'));
  assert.equal(chats.length, 2); assert.equal(chats[0].init.headers.Authorization, 'Bearer ' + token);
  assert.deepEqual(JSON.parse(chats[0].init.body), { messages: [{ role: 'user', content: 'test' }], max_tokens: 4096 });
  assert.ok(!JSON.stringify(calls).includes('old-secret-never-send')); assert.ok(!JSON.stringify(calls).includes('model'));
  assert.equal(storage.get('qimen_credential'), token);
  assert.deepEqual(analytics, ['AI 解读调用', 'AI 解读调用']);
  let attempts = 0;
  await assert.rejects(client.requestFinal({ fetchImpl: async () => { attempts++; return response({ choices: [{ finish_reason: 'length', message: { content: '' } }] }); } }), /重试会消耗额度/);
  assert.equal(attempts, 1, 'no automatic retry');
  for (const code of ['quota_credential', 'quota_ip', 'quota_site']) {
    attempts = 0;
    await assert.rejects(client.requestFinal({ fetchImpl: async () => { attempts++; return response({ error: { code, message: '今日全站额度已用完', retry_at: 123 } }, false); } }), e => e.code === code && e.retryAt === 123 && e.message === '今天的免费 AI 次数用完了，排盘还能继续用。AI 解读有一点成本；若喜欢本站，可以点「请作者喝杯奶茶」。不支持也完全没问题。');
    assert.equal(attempts, 1);
  }
  await assert.rejects(client.requestFinal({ fetchImpl: async () => response({ choices: [{ finish_reason: 'content_filter', message: { content: '' } }] }) }), /内容过滤/);
  assert.equal(load().QIMEN_API_BASE, 'https://api.qimenbazi.cn');
  for (const page of ['index.html', 'bazi.html', 'liuyao.html', 'ziwei.html', 'daily.html']) {
    const html = fs.readFileSync(page, 'utf8');
    assert.ok(html.includes('site-service.js?v=20261105.6'), page + ' shared feedback/support');
    assert.doesNotMatch(html, /API_KEY_STORAGE|apiKey|API Key|api\.deepseek\.com/);
  }
  for (const path of ['deepseek-client.js', 'site-service.js', 'ziwei-page.js', 'README.md']) assert.doesNotMatch(fs.readFileSync(path, 'utf8'), /API_KEY_STORAGE|apiKey|API Key|api\.deepseek\.com/);
  console.log('deepseek client checks ok: Worker-only requests, legacy secret removal, shared credential, limits, no automatic retries');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
