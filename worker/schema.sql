PRAGMA foreign_keys = ON;
CREATE TABLE credentials (
  hash TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL DEFAULT 0,
  free_used INTEGER NOT NULL DEFAULT 0 CHECK (free_used BETWEEN 0 AND 100)
);
CREATE TABLE buckets (
  scope TEXT NOT NULL,
  bucket TEXT NOT NULL,
  subject TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0 CHECK (used >= 0),
  ceiling INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  CONSTRAINT rate_limit CHECK (used <= ceiling),
  PRIMARY KEY (scope, bucket, subject)
);
CREATE INDEX buckets_expiry ON buckets(expires_at);
CREATE TABLE attempts (
  id TEXT PRIMARY KEY,
  credential TEXT NOT NULL REFERENCES credentials(hash),
  day TEXT NOT NULL,
  ip TEXT NOT NULL,
  paid INTEGER NOT NULL CHECK (paid IN (0,1)),
  order_id TEXT REFERENCES orders(out_trade_no),
  created_at INTEGER NOT NULL,
  reset_at INTEGER NOT NULL,
  refunded INTEGER NOT NULL DEFAULT 0 CHECK (refunded IN (0,1))
);
CREATE INDEX attempts_day ON attempts(day);
-- UPDATE 的条件与 RAISE 在同一 SQL 事务内执行，不足时撤销全部预占。
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
CREATE TABLE order_refs (
  ref TEXT PRIMARY KEY,
  credential TEXT NOT NULL REFERENCES credentials(hash),
  created_at INTEGER NOT NULL
);
CREATE INDEX order_refs_created ON order_refs(created_at);
CREATE TABLE orders (
  out_trade_no TEXT PRIMARY KEY,
  ref TEXT NOT NULL REFERENCES order_refs(ref),
  credential TEXT NOT NULL REFERENCES credentials(hash),
  amount_cents INTEGER NOT NULL CHECK (amount_cents>=0 AND (status='refunded' OR amount_cents>0)),
  paid_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('paid','refunded')),
  updated_at INTEGER NOT NULL,
  granted INTEGER NOT NULL DEFAULT 0 CHECK (granted>=0),
  used INTEGER NOT NULL DEFAULT 0 CHECK (used BETWEEN 0 AND granted),
  expires_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX orders_reconcile ON orders(status,paid_at);
CREATE INDEX orders_credential ON orders(credential,paid_at,out_trade_no);
-- 连续打赏共享到期日；跨过期点另开一期，退款与乱序入账均按付款顺序重算。
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
CREATE TABLE feedback (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('功能建议','排盘有误','AI 解读问题','其他')),
  content TEXT NOT NULL CHECK (length(trim(content)) BETWEEN 1 AND 1000),
  contact TEXT NOT NULL CHECK (length(contact)<=200),
  page TEXT NOT NULL CHECK (page IN ('index.html','bazi.html','liuyao.html','ziwei.html','daily.html')),
  created_at INTEGER NOT NULL
);
