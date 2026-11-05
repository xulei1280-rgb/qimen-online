# 奇门八字

奇门、八字、六爻、紫微排盘与日运记录的传统文化学习工具。排盘免费，AI 解读每设备凭证共 100 次免费、每天最多 5 次，可自愿打赏获得 30 天次数包，仅供学习参考，不作为医疗、法律或投资决策依据。

- 在线使用：https://xulei1280-rgb.github.io/qimen-online/
- 支持作者（爱发电）：https://afdian.com/a/qimenbazi

## 开发说明

前端是纯静态 HTML/JS，无框架。Worker 使用 Cloudflare D1；测试需 Node 24，无需安装依赖。

在仓库根目录运行全部检查：

```sh
for file in check-*.js check-*.cjs; do
  node "$file" || exit 1
done
```

浏览器检查使用现有 Playwright 环境；未提供时会明确输出 SKIP。

运行 Worker 测试：

```sh
cd worker && node --test test/*.test.js
```

部署、域名、API 配置与 Umami 启用步骤见 [worker/DEPLOY.md](worker/DEPLOY.md)。
