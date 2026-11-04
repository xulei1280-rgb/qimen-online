import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

// 执行真实 schema 和业务 SQL；只适配 D1 的 prepare/bind/batch 接口。
export function memoryD1() {
  const raw = new DatabaseSync(':memory:');
  raw.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  function prepare(sql, args = []) {
    function execute() {
      const results = raw.prepare(sql).all(...args);
      return { success: true, results, meta: { changes: raw.prepare('SELECT changes() n').get().n } };
    }
    return {
      bind(...values) { return prepare(sql, values); },
      async first() { return execute().results[0] || null; },
      async all() { return execute(); },
      async run() { return execute(); },
      execute
    };
  }
  return { raw, prepare, async batch(statements) {
    raw.exec('BEGIN IMMEDIATE');
    try { const results = statements.map(s => s.execute()); raw.exec('COMMIT'); return results; }
    catch (error) { raw.exec('ROLLBACK'); throw error; }
  } };
}
