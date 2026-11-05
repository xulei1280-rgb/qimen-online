import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { memoryD1 } from './d1.js';
import { reserve, refund, applyOrder, dayKey, resetAt } from '../src/index.js';

const START = Date.UTC(2026, 10, 5, 2), MONTH = 30 * 86400000;
test('真实v1升级保留凭证/订单/反馈，回填免费池、付费扣次并清除混合日桶；新旧schema行为一致', async t => {
  const db = memoryD1(readFileSync(new URL('./fixtures/schema-v1.sql', import.meta.url), 'utf8'));
  t.after(() => db.raw.close());
  const free = 'a'.repeat(64), paid = 'b'.repeat(64), ref = 'c'.repeat(64);
  db.raw.prepare('INSERT INTO credentials VALUES (?,?,?)').run(free, START, 0);
  db.raw.prepare('INSERT INTO credentials VALUES (?,?,?)').run(paid, START, 0);
  db.raw.prepare('INSERT INTO order_refs VALUES (?,?,?)').run(ref, paid, START);
  db.raw.prepare("INSERT INTO orders VALUES (?,?,?,?,?,'paid',?)").run('old-order', ref, paid, 1800, START, START);
  function oldAttempt(id, credential, time, paid = 0) {
    db.raw.prepare('INSERT INTO attempts(id,credential,day,ip,paid,created_at,reset_at) VALUES (?,?,?,?,?,?,?)').run(id, credential, dayKey(time), credential, paid, time, resetAt(time));
    return { id };
  }
  const a = oldAttempt('free-1', free, START);
  oldAttempt('free-2', free, START + 11000); await refund(db, a.id, START);
  const b = oldAttempt('paid-1', paid, START, 1);
  db.raw.prepare('INSERT INTO feedback VALUES (?,?,?,?,?,?)').run('f', '其他', '保留', '', 'index.html', START);
  db.raw.exec(readFileSync(new URL('../migrations/0002-tip-pack.sql', import.meta.url), 'utf8'));
  assert.equal(db.raw.prepare('SELECT free_used FROM credentials WHERE hash=?').get(free).free_used, 1);
  assert.equal(db.raw.prepare('SELECT free_used FROM credentials WHERE hash=?').get(paid).free_used, 0);
  const pack = db.raw.prepare('SELECT * FROM orders').get();
  assert.equal(pack.granted, 600); assert.equal(pack.used, 1); assert.equal(pack.expires_at, START + MONTH);
  assert.equal(db.raw.prepare("SELECT used FROM buckets WHERE scope='site'").get().used, 1);
  assert.equal(db.raw.prepare("SELECT used FROM buckets WHERE scope='credential' AND subject=?").get(paid).used, 0);
  assert.equal(db.raw.prepare('SELECT content FROM feedback').get().content, '保留');
  await refund(db, b.id, START); assert.equal(db.raw.prepare('SELECT used FROM orders').get().used, 0);
  await reserve(db, paid, 'ip2', START + 11000);
  assert.equal(db.raw.prepare('SELECT used FROM orders').get().used, 1);
  const settings = { AFDIAN_PAID_AT_FIELD: 'pay_time', AFDIAN_REFUND_STATUS: '3' };
  await applyOrder(db, { out_trade_no: 'new-order', custom_order_id: ref, total_amount: '6.00', status: 2, pay_time: START / 1000 }, settings, START);
  assert.equal(db.raw.prepare('SELECT SUM(granted-used) n FROM orders').get().n, 749);
  await applyOrder(db, { out_trade_no: 'old-order', custom_order_id: ref, total_amount: '0.00', status: 3, pay_time: START / 1000 }, settings, START);
  assert.equal(db.raw.prepare('SELECT expires_at FROM credentials WHERE hash=?').get(paid).expires_at, START + MONTH);
  assert.deepEqual(db.raw.prepare('PRAGMA foreign_key_check').all(), []);
  const fresh = memoryD1(); t.after(() => fresh.raw.close());
  for (const type of ['trigger', 'view']) {
    const definitions = d => d.raw.prepare('SELECT name,sql FROM sqlite_master WHERE type=? ORDER BY name').all(type);
    assert.deepEqual(definitions(db), definitions(fresh));
  }
});
