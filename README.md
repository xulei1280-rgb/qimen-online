# 奇门八字

奇门、八字、六爻、紫微排盘的传统文化学习工具，排盘免费，AI 解读仅作学习参考。

- 在线使用：https://xulei1280-rgb.github.io/qimen-online/
- 支持作者（爱发电）：https://afdian.com/a/qimenbazi

## GitHub Pages

这是纯静态网页，发布到 GitHub Pages 时直接使用仓库根目录即可：

- Branch: `main`
- Folder: `/ (root)`

入口文件是 `index.html`。

## AI 解读

AI 解读由本站服务提供，每日有免费额度。免费每凭证每天 5 次、每 IP 每天 20 次，全站每天 300 次；有效打赏凭证每天 20 次，不占 IP 额度，仍受全站上限。重试会消耗额度。

服务端与部署步骤见 [worker/DEPLOY.md](worker/DEPLOY.md)。默认 API 地址为 `https://api.qimenbazi.cn`，本地测试可设置 `localStorage.qimen_api_base` 后刷新。

## 校验

修改排盘逻辑后先运行：

```bash
node check-baselines.js
```

当前基准盘通过时会输出：

```text
18 baselines ok
```
