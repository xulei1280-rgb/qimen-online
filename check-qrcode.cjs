'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const qrcode = require('./vendor/qrcode-generator.js');
const url = 'https://afdian.com/order/create?user_id=x&custom_price=6.00&custom_order_id=' + '0123456789abcdef'.repeat(4);
const code = qrcode(0, 'M');
code.addData(url);
code.make();
assert.ok(code.getModuleCount() >= 21, '二维码至少为 21×21 模块');
let dark = false;
for (let row = 0; row < code.getModuleCount(); row++) {
  for (let col = 0; col < code.getModuleCount(); col++) dark ||= code.isDark(row, col);
}
assert.ok(dark, '二维码必须含暗模块');
assert.match(code.createSvgTag({ scalable: true }), /<svg\b/);
for (const page of ['index.html', 'bazi.html', 'liuyao.html', 'ziwei.html', 'daily.html']) {
  const html = fs.readFileSync(path.join(__dirname, page), 'utf8');
  const vendor = html.indexOf('src="vendor/qrcode-generator.js"');
  assert.ok(vendor >= 0 && vendor < html.indexOf('src="site-service.js?'), page + ' 应先加载本地二维码库');
}
console.log('PASS QR code: sample payment URL, module count, dark modules, SVG and five-page script order');
