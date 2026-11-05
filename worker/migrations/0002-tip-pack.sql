-- 现有 v1 数据库仅执行一次；先备份。历史已清理的免费请求无法回溯。
DROP TRIGGER reserve_attempt;
DROP TRIGGER refund_attempt;
DROP TRIGGER grant_order;
DROP TRIGGER revoke_order;
ALTER TABLE credentials ADD COLUMN free_used INTEGER NOT NULL DEFAULT 0 CHECK (free_used BETWEEN 0 AND 100);
ALTER TABLE attempts ADD COLUMN order_id TEXT REFERENCES orders(out_trade_no);
ALTER TABLE orders ADD COLUMN granted INTEGER NOT NULL DEFAULT 0 CHECK (granted>=0);
ALTER TABLE orders ADD COLUMN used INTEGER NOT NULL DEFAULT 0 CHECK (used BETWEEN 0 AND granted);
ALTER TABLE orders ADD COLUMN expires_at INTEGER NOT NULL DEFAULT 0;
UPDATE credentials SET free_used=MIN(100,(SELECT COUNT(*) FROM attempts
  WHERE credential=credentials.hash AND paid=0 AND refunded=0));
UPDATE orders SET granted=CASE WHEN amount_cents<600 THEN 0 ELSE
  MAX(amount_cents/4,CASE WHEN amount_cents>=6800 THEN 2500 WHEN amount_cents>=1800 THEN 600 ELSE 150 END) END;
-- 旧模型没有逐订单扣次，保留的付费请求按付款先后归属到未退款次数包。
CREATE VIEW migration_paid_usage AS
WITH requests AS (
  SELECT id,credential,ROW_NUMBER() OVER (PARTITION BY credential ORDER BY created_at,id) n
  FROM attempts WHERE paid=1 AND refunded=0
), packs AS (
  SELECT out_trade_no,credential,granted,COALESCE(SUM(granted) OVER (
    PARTITION BY credential ORDER BY paid_at,out_trade_no ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) prior
  FROM orders WHERE status='paid' AND granted>0
)
SELECT r.id,p.out_trade_no FROM requests r JOIN packs p ON p.credential=r.credential
  AND r.n>p.prior AND r.n<=p.prior+p.granted;
UPDATE attempts SET order_id=(SELECT out_trade_no FROM migration_paid_usage m WHERE m.id=attempts.id) WHERE paid=1;
DROP VIEW migration_paid_usage;
UPDATE orders SET used=(SELECT COUNT(*) FROM attempts WHERE order_id=orders.out_trade_no AND refunded=0);
-- 旧日桶混合了付费请求，迁移时剔除，确保付费不会占用免费日额与全站日额。
UPDATE buckets SET used=MAX(0,used-(SELECT COUNT(*) FROM attempts a WHERE a.paid=1 AND a.refunded=0
  AND a.day=buckets.bucket AND (buckets.scope='site' OR a.credential=buckets.subject)))
  WHERE scope IN ('site','credential');
CREATE TRIGGER reserve_attempt AFTER INSERT ON attempts BEGIN
  UPDATE orders SET used=used+1 WHERE out_trade_no=NEW.order_id AND status='paid'
    AND expires_at>NEW.created_at AND used<granted;
  SELECT CASE WHEN NEW.paid=1 AND changes()=0 THEN RAISE(ABORT,'quota_pack') END;
  UPDATE credentials SET free_used=free_used+1 WHERE hash=NEW.credential AND NEW.paid=0 AND free_used<100;
  SELECT CASE WHEN NEW.paid=0 AND changes()=0 THEN RAISE(ABORT,'quota_lifetime') END;
  INSERT INTO buckets SELECT 'site',NEW.day,'*',1,300,NEW.reset_at WHERE NEW.paid=0
    ON CONFLICT DO UPDATE SET used=used+1 WHERE used<300;
  SELECT CASE WHEN NEW.paid=0 AND changes()=0 THEN RAISE(ABORT,'quota_site') END;
  INSERT INTO buckets SELECT 'credential',NEW.day,NEW.credential,1,5,NEW.reset_at WHERE NEW.paid=0
    ON CONFLICT DO UPDATE SET used=used+1 WHERE used<5;
  SELECT CASE WHEN NEW.paid=0 AND changes()=0 THEN RAISE(ABORT,'quota_credential') END;
  INSERT INTO buckets SELECT 'ip',NEW.day,NEW.ip,1,20,NEW.reset_at WHERE NEW.paid=0
    ON CONFLICT DO UPDATE SET used=used+1 WHERE used<20;
  SELECT CASE WHEN NEW.paid=0 AND changes()=0 THEN RAISE(ABORT,'quota_ip') END;
  INSERT INTO buckets VALUES ('chat_credential',CAST(NEW.created_at/10000 AS TEXT),NEW.credential,1,1,(NEW.created_at/10000+1)*10000)
    ON CONFLICT DO UPDATE SET used=used+1 WHERE used<1;
  SELECT CASE WHEN changes()=0 THEN RAISE(ABORT,'rate_chat') END;
  INSERT INTO buckets SELECT 'chat_ip',CAST(NEW.created_at/10000 AS TEXT),NEW.ip,1,10,(NEW.created_at/10000+1)*10000 WHERE NEW.paid=0
    ON CONFLICT DO UPDATE SET used=used+1 WHERE used<10;
  SELECT CASE WHEN NEW.paid=0 AND changes()=0 THEN RAISE(ABORT,'rate_chat') END;
END;
CREATE TRIGGER refund_attempt AFTER UPDATE OF refunded ON attempts
WHEN OLD.refunded=0 AND NEW.refunded=1 BEGIN
  INSERT INTO buckets VALUES ('refund',NEW.day,NEW.credential,1,3,NEW.reset_at)
    ON CONFLICT DO UPDATE SET used=used+1 WHERE used<3;
  SELECT CASE WHEN changes()=0 THEN RAISE(ABORT,'refund_limit') END;
  UPDATE orders SET used=MAX(0,used-1) WHERE out_trade_no=NEW.order_id AND NEW.paid=1;
  UPDATE credentials SET free_used=MAX(0,free_used-1) WHERE hash=NEW.credential AND NEW.paid=0;
  UPDATE buckets SET used=MAX(0,used-1) WHERE NEW.paid=0 AND bucket=NEW.day AND (
    (scope='site' AND subject='*') OR (scope='credential' AND subject=NEW.credential) OR
    (scope='ip' AND subject=NEW.ip));
END;
CREATE VIEW paid_order_expiries AS
WITH RECURSIVE paid AS (
  SELECT out_trade_no,credential,paid_at,
    ROW_NUMBER() OVER (PARTITION BY credential ORDER BY paid_at,out_trade_no) n
  FROM orders WHERE status='paid' AND granted>0
), chain(out_trade_no,credential,n,period,expiry) AS (
  SELECT out_trade_no,credential,n,n,paid_at+2592000000 FROM paid WHERE n=1
  UNION ALL
  SELECT p.out_trade_no,p.credential,p.n,CASE WHEN p.paid_at>=c.expiry THEN p.n ELSE c.period END,
    MAX(c.expiry,p.paid_at)+2592000000 FROM chain c JOIN paid p ON p.credential=c.credential AND p.n=c.n+1
)
SELECT out_trade_no,credential,MAX(expiry) OVER (PARTITION BY credential,period) expires_at FROM chain;
UPDATE orders SET expires_at=COALESCE((SELECT e.expires_at FROM paid_order_expiries e
  WHERE e.out_trade_no=orders.out_trade_no),0);
UPDATE credentials SET expires_at=COALESCE((SELECT MAX(expires_at) FROM orders WHERE credential=credentials.hash AND status='paid'),0);
CREATE TRIGGER grant_order AFTER INSERT ON orders BEGIN
  UPDATE orders SET expires_at=COALESCE((SELECT e.expires_at FROM paid_order_expiries e
    WHERE e.out_trade_no=orders.out_trade_no),0) WHERE credential=NEW.credential;
  UPDATE credentials SET expires_at=COALESCE((SELECT MAX(expires_at) FROM orders
    WHERE credential=NEW.credential AND status='paid'),0) WHERE hash=NEW.credential;
END;
CREATE TRIGGER revoke_order AFTER UPDATE OF status ON orders
WHEN OLD.status='paid' AND NEW.status='refunded' BEGIN
  UPDATE orders SET expires_at=COALESCE((SELECT e.expires_at FROM paid_order_expiries e
    WHERE e.out_trade_no=orders.out_trade_no),0) WHERE credential=NEW.credential;
  UPDATE credentials SET expires_at=COALESCE((SELECT MAX(expires_at) FROM orders
    WHERE credential=NEW.credential AND status='paid'),0) WHERE hash=NEW.credential;
END;
