'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, file), 'utf8');
const source = read('site-analytics.js');
const events = ['排盘完成', 'AI 解读调用', '反馈提交', '点击打赏'];
const pages = ['index.html', 'bazi.html', 'liuyao.html', 'ziwei.html', 'daily.html'];
function load(enabled, page = 'index.html') {
  const scripts = [], sent = [];
  const context = { location: { pathname: '/qimen-online/' + page, hostname: 'qimenbazi.cn', search: '?question=private', hash: '#credential=private' },
    document: { title: 'private title', referrer: 'https://private.test/?diary=private',
      createElement: () => ({ attributes: {}, setAttribute(k, v) { this.attributes[k] = v; } }),
      head: { appendChild(script) { scripts.push(script); } } },
    umami: { track(payload) { sent.push(payload); } } };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(source.replace(/const UMAMI_WEBSITE_ID = ['"][^'"]*['"];/, "const UMAMI_WEBSITE_ID = '" + (enabled ? 'test-website' : '') + "';"), context);
  return { context, scripts, sent };
}
async function main() {
  assert.equal((source.match(/const UMAMI_WEBSITE_ID = ['"][^'"]*['"];/g) || []).length, 1);
  const disabled = load(false);
  for (const event of events) disabled.context.SiteAnalytics.track(event, { question: 'private' });
  assert.equal(disabled.scripts.length, 0); assert.equal(disabled.sent.length, 0);
  for (const page of pages) {
    const p = load(true, page);
    assert.equal(p.scripts.length, 1); assert.equal(p.scripts[0].src, 'https://cloud.umami.is/script.js');
    assert.equal(p.scripts[0].attributes['data-website-id'], 'test-website');
    assert.equal(p.scripts[0].attributes['data-auto-track'], 'false');
    for (const event of events) p.context.SiteAnalytics.track(event, { question: 'private', chart: 'private', diary: 'private', credential: 'private' });
    p.context.SiteAnalytics.track('其它事件');
    assert.equal(p.sent.length, 4);
    assert.deepEqual(JSON.parse(JSON.stringify(p.sent)), events.map(event => ({ website: 'test-website', hostname: 'qimenbazi.cn', url: '/' + (page === 'index.html' ? '' : page), name: event, data: { page } })));
    assert.ok(!JSON.stringify(p.sent).includes('private'));
    p.context.umami = undefined; assert.doesNotThrow(() => p.context.SiteAnalytics.track(events[0]));
    p.context.umami = { track() { throw new Error('blocked'); } }; assert.doesNotThrow(() => p.context.SiteAnalytics.track(events[0]));
    p.context.umami = { track() { return Promise.reject(new Error('offline')); } }; p.context.SiteAnalytics.track(events[0]);
    p.scripts[0].onerror();
    const html = read(page), canonical = 'https://qimenbazi.cn/' + (page === 'index.html' ? '' : page);
    assert.equal((html.match(/rel="canonical"/g) || []).length, 1);
    assert.ok(html.includes('<link rel="canonical" href="' + canonical + '">'));
    assert.equal((html.match(/src="site-analytics\.js\?v=/g) || []).length, 1);
    assert.ok(html.indexOf('src="site-analytics.js?') < html.indexOf('src="deepseek-client.js?'));
    const description = html.match(/<meta name="description" content="([^"]+)"/);
    assert.ok(description && [...description[1]].length <= 80);
    const handler = read(page === 'ziwei.html' ? 'ziwei-page.js' : page);
    assert.equal((handler.match(/SiteAnalytics\.track\(['"]排盘完成['"]\)/g) || []).length, 1, page + ' 排盘成功事件');
  }
  const unknown = load(true, 'other.html'); unknown.context.SiteAnalytics.track(events[0]); assert.equal(unknown.sent.length, 0);
  assert.ok(read('deepseek-client.js').includes("path === '/api/chat' && root.SiteAnalytics"));
  assert.ok(read('deepseek-client.js').includes("root.SiteAnalytics.track('AI 解读调用')"));
  assert.ok(read('site-service.js').includes("window.SiteAnalytics.track('反馈提交')"));
  assert.ok(read('site-service.js').includes("window.SiteAnalytics.track('点击打赏')"));
  const urls = [...read('sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  assert.deepEqual(urls, pages.map(page => 'https://qimenbazi.cn/' + (page === 'index.html' ? '' : page)));
  assert.match(read('sitemap.xml'), /xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9"/);
  assert.match(read('robots.txt'), /^Sitemap: https:\/\/qimenbazi\.cn\/sitemap\.xml$/m);
  await new Promise(resolve => setImmediate(resolve));
  console.log('PASS P2: optional Umami, four private-data-free events, failure isolation, five canonicals, descriptions, sitemap and robots');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
