# P1 部署交接（本次没有部署、登录或使用真实凭证）

纯 Worker + 单个 D1，无框架和项目依赖。测试需 Node 24（内置 `node:sqlite`）：

```sh
node --test worker/test/*.test.js
```

## 以后由站长执行的步骤

1. 准备 Cloudflare 账号、已接入 Cloudflare DNS 的 `qimenbazi.cn` 和 Wrangler CLI。以下命令在 `worker/` 执行；本次没有安装 CLI。
2. 登录并创建 D1：
   ```sh
   wrangler login
   wrangler d1 create qimen
   ```
   把输出的 `database_id` 填入 `wrangler.toml` 的 D1 绑定，保留绑定名 `DB`。
3. 首次执行建表迁移（只执行一次；现有数据库升级应先备份）：
   ```sh
   wrangler d1 execute qimen --remote --file=schema.sql
   ```
4. 在爱发电创作者后台创建**单档打赏方案**，把真实 `plan_id` 填入 `wrangler.toml` 的 `AFDIAN_PLAN_ID`。创作者 ID 已填 `ce5512ded87411f1a31d52540025c377`。不要把 token 写进配置文件。
5. 逐个设置三个 secrets，交互输入，勿写入源码、截图、日志或命令历史：
   ```sh
   wrangler secret put DEEPSEEK_API_KEY
   wrangler secret put AFDIAN_TOKEN
   wrangler secret put WEBHOOK_PATH_SECRET
   ```
   秘密路径用至少 32 字节随机数，例如在本机运行 `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` 后私下保存。不要把输出提交到仓库。
6. 核对前端与 CORS：共享 `deepseek-client.js` 定义 `window.QIMEN_API_BASE`，默认为 `https://api.qimenbazi.cn`；更换 API 域名时改此默认值。生产前端无 localStorage 覆盖时使用该值。`ALLOWED_ORIGIN` 只填写精确源 `https://xulei1280-rgb.github.io`，不能带项目路径或尾斜杠。更换前端域名时同时修改该值。
7. 保持 `AFDIAN_VERIFIED="false"`，先部署 AI 和反馈：
   ```sh
   wrangler deploy
   ```
8. Cloudflare 控制台 → Workers & Pages → `qimen-api` → Settings → Domains & Routes → Add → Custom Domain，绑定 **`api.qimenbazi.cn`**，检查 DNS 与 HTTPS。配置的 `workers_dev=false` 不公开 workers.dev 入口。
9. 爱发电开发者页填写 webhook URL：`https://api.qimenbazi.cn/webhook/<WEBHOOK_PATH_SECRET>`。secret 路径不能放在前端。正式验收前关闭该 webhook 的公开使用。
10. 完成下述 **P1-0 小额真实打赏 + 退款实测**，才能启用权益。核实后填写 `AFDIAN_PAID_AT_FIELD`（查单中真实的**付款时间字段名，值为 Unix 秒**）、`AFDIAN_REFUND_STATUS`（查单中已核实的退款/撤销状态，不能是 `2`），最后设 `AFDIAN_VERIFIED="true"` 并再次 `wrangler deploy`。这些占位不应凭样例猜测填写。
11. 大陆手机网络实测 GitHub Pages → API → 爱发电付款 → 返回页自动解锁；再退款，确认最迟下次 cron 撤回对应权益。确认 Worker 每日 cron `0 19 * * *`（北京时间次日 03:00）执行成功。反馈可选在 D1 控制台查询 `SELECT type,content,contact,page,created_at FROM feedback ORDER BY created_at DESC;`。

## P1-0 必须记录的结果

爱发电[官方开发文档](https://guide.afdian.com/creator/developer)列出了查单和签名，成功状态为 `2`，但不能据此确认生产的关联号、付款时间和退款行为。本实现**默认关闭打赏创建/查询/回调发放**，没有按未经验证的回调字段发放的备用分支。

- 在创作者开发工具里，以私有 token 调用 `https://afdian.com/api/open/query-order`。签名为 `md5(token + "params" + params + "ts" + ts + "user_id" + user_id)`，其中 `params` 必须与实际发送的 JSON 字符串逐字一致，`ts` 为 Unix 秒；业务码必须为数字 `ec=200`。
- 自测时先在 D1 为测试凭证插入随机关联号（`credentials.hash` 及 `order_refs`），用付款链接 `https://afdian.com/order/create?user_id=ce5512ded87411f1a31d52540025c377&plan_id=<方案>&custom_order_id=<关联号>` 做一笔小额付款。`/api/credential` 可从前端同源请求领取测试凭证，哈希算法 SHA-256；正式用户流程由 `/api/order` 自动创建关联号。
- 保存脱敏查单样例，核实 `custom_order_id` 完整返回；记录实际付款时间字段、金额、方案、回调结构与重复推送情况。只有**创作者签名查单**结果可信，回调中的上述字段都不会用作发放依据。核实后可在仅供本人使用的测试环境打开验证开关，验证自动流程。
- 做一次退款，再次签名查单，记录退款/撤销后的状态以及是否回调。核实金额是否变成 `0.00`、关联号和付款时间是否仍在。代码可撤销已核实的零金额退款，成功的零元订单不会发权益。
- 还应验证零元订单、其它方案、重复通知、关闭回调后的轮询补单及次日 cron。若查单拿不到可信关联号，或查单看不出退款状态，**停止 P1-4 上线并反馈改方案**；不使用人工认领或不回收的降级。
- 目前没有真实实测记录；测试中的状态 `3` 和 `pay_time` 仅是本地假数据，绝非真实协议承诺。若字段结构与本实现不同，保持开关关闭，依据脱敏实测结果调整适配器再测。

## 本地联调与行为限制

- `wrangler d1 execute qimen --local --file=schema.sql`，配置本地 `.dev.vars`（不提交），再运行 `wrangler dev`。前端通过静态 HTTP 服务打开，Worker 的本地 `ALLOWED_ORIGIN` 改为该精确源，例如 `http://127.0.0.1:8000`。
- 在前端控制台执行 `localStorage.setItem('qimen_api_base','http://127.0.0.1:8787')` 后刷新；恢复生产用 `localStorage.removeItem('qimen_api_base')` 后刷新。变更后端数据库后，测试凭证也需清除 `qimen_credential`。生产不会自动清除匿名凭证。
- 免费 5/凭证/天、20/IP/天、全站 300/天；有效打赏 20/凭证/天，不检查或占用 IP 日额/短限频，仍受全站上限。UTC+8 日桶。请求预占与退款在 D1 SQL 事务内完成；D1 失败不调用 AI。[D1 batch 回滚语义](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)用于保证触发器报错时整体回滚。
- AI 固定地址与 `deepseek-v4-flash`，输出最多 4096 tokens，关闭模型思考输出。根据现有八字完整提示词约 30 KB、单次追问约 54 KB，chat 请求体上限定为 **64 KiB**，最多 40 条消息、总输入 24000 字符；超出会在扣额前拒绝，不截断盘面。其它 JSON 默认 32 KiB，反馈 8 KiB。上游超时 60 秒；5xx/网络超时每天每凭证最多退还 3 次，4xx 不退。前端所有自动 AI 重试均已移除。
- 短限频：chat 每凭证每 10 秒 1 次，免费 IP 每 10 秒 10 次；凭证发放每 IP 每分钟 10 次；反馈每 IP 每分钟 3 次、每天 10 次；创建订单每 IP 每分钟 5 次；查单每 IP 每分钟 60 次、每凭证每分钟 15 次；webhook 每 IP 每分钟 60 次。仅使用 Cloudflare `CF-Connecting-IP`，忽略 `X-Forwarded-For`。
- 每 5 秒轮询，最多 10 分钟；支付后、页面恢复可见/焦点时自动确认。桌面端使用付款链接与说明，没有引入二维码依赖或外部 CDN；手机端打开付款窗口。浏览器阻止窗口时手机端直接跳转，返回后可从本机保存的关联号继续轮询。
- cron 查最新 7 天订单补漏，并按已入账订单号分组核对近 60 天退款（分页间隔 1.1 秒）；查询/数据库失败会使 cron 报错，下次重新幂等对账。清除过期 7 天以上的分桶、AI 尝试和无入账关联号。订单、凭证与反馈持久保存，不做管理页或通知。
- 退款根据剩余未退款订单重算权益：正常连续续期扣回对应 30 天；某笔旧权益已到期且后来另行打赏时，撤旧单不会误扣新单。已退款订单不会被迟到的成功通知复活。
- **找回码本期未实现**：匿名凭证存在当前浏览器，清空存储或换设备不能找回权益。
