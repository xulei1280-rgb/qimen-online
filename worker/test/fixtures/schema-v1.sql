PRAGMA foreign_keys = ON;
CREATE TABLE credentials (
  hash TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL DEFAULT 0
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
  created_at INTEGER NOT NULL,
  reset_at INTEGER NOT NULL,
  refunded INTEGER NOT NULL DEFAULT 0 CHECK (refunded IN (0,1))
);
CREATE INDEX attempts_day ON attempts(day);
-- UPDATE 的条件与 RAISE 在同一 SQL 事务内执行，不足时撤销全部预占。
CREATE TRIGGER reserve_attempt AFTER INSERT ON attempts BEGIN
  INSERT INTO buckets VALUES ('site',NEW.day,'*',1,300,NEW.reset_at)
    ON CONFLICT DO UPDATE SET used=used+1 WHERE used<300;
  SELECT CASE WHEN changes()=0 THEN RAISE(ABORT,'quota_site') END;
  INSERT INTO buckets VALUES ('credential',NEW.day,NEW.credential,1,1000000,NEW.reset_at)
    ON CONFLICT DO UPDATE SET used=used+1 WHERE used<CASE WHEN NEW.paid=1 THEN 20 ELSE 5 END;
  SELECT CASE WHEN changes()=0 THEN RAISE(ABORT,'quota_credential') END;
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
  UPDATE buckets SET used=MAX(0,used-1) WHERE bucket=NEW.day AND (
    (scope='site' AND subject='*') OR (scope='credential' AND subject=NEW.credential) OR
    (NEW.paid=0 AND scope='ip' AND subject=NEW.ip));
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
  updated_at INTEGER NOT NULL
);
CREATE INDEX orders_reconcile ON orders(status,paid_at);
CREATE INDEX orders_credential ON orders(credential,paid_at,out_trade_no);
CREATE TRIGGER grant_order AFTER INSERT ON orders WHEN NEW.status='paid' BEGIN
  UPDATE credentials SET expires_at=MAX(expires_at,NEW.paid_at)+2592000000 WHERE hash=NEW.credential;
END;
CREATE TRIGGER revoke_order AFTER UPDATE OF status ON orders
WHEN OLD.status='paid' AND NEW.status='refunded' BEGIN
  -- 重算未退款订单，避免旧权益已过期后退款误扣后来独立购买的权益。
  UPDATE credentials SET expires_at=(
    WITH RECURSIVE paid AS (
      SELECT paid_at,ROW_NUMBER() OVER (ORDER BY paid_at,out_trade_no) n
      FROM orders WHERE credential=NEW.credential AND status='paid'
    ), chain(n,expiry) AS (
      VALUES(0,0) UNION ALL
      SELECT paid.n,MAX(chain.expiry,paid.paid_at)+2592000000 FROM chain JOIN paid ON paid.n=chain.n+1
    ) SELECT expiry FROM chain ORDER BY n DESC LIMIT 1
  ) WHERE hash=NEW.credential;
END;
CREATE TABLE feedback (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('功能建议','排盘有误','AI 解读问题','其他')),
  content TEXT NOT NULL CHECK (length(trim(content)) BETWEEN 1 AND 1000),
  contact TEXT NOT NULL CHECK (length(contact)<=200),
  page TEXT NOT NULL CHECK (page IN ('index.html','bazi.html','liuyao.html','ziwei.html','daily.html')),
  created_at INTEGER NOT NULL
);
