# 安全策略 / Security Policy

感谢您关注 **RosePanel Bot** 的安全性！本项目为纯自托管开源架构，不收集任何用户数据，也非常重视安全问题响应。

## 支持版本 / Supported Versions

| 版本 / Version | 安全更新支持 / Supported |
| :--- | :---: |
| `v1.2.x`（最新 `main`） | ✅ |
| `< v1.2.2` | ⚠️ 请立即升级至 `v1.2.2+`（修复 Webhook 密钥校验与预览模式鉴权加固） |

## 如何私下报告安全漏洞 / Reporting a Vulnerability

**请勿直接在公开 GitHub Issue 中披露尚未修复的高危安全漏洞详情！**

请通过以下任一私密渠道联系维护者：
1. **GitHub Private Vulnerability Reporting（推荐）**：进入本仓库的 **Security → Advisories → Report a vulnerability** 提交私密报告；
2. **Telegram 联系**：通过 [@Rose202_bot](https://t.me/Rose202_bot) 留言简述漏洞类型、复现步骤与影响范围。

我们会在确认问题后尽快修复、补充回归测试并发布安全更新版本（如您愿意，将在发布日志致谢名单中署上您的名字）。

## 自托管部署安全检查清单

- 务必将 `BOT_TOKEN`、`WEBHOOK_SECRET`、`TURNSTILE_SECRET`、`KOMARI_API_KEY` 配置为 Cloudflare **Secret（加密变量）**，切勿提交到公开仓库；
- 务必设置 `ADMIN_IDS`（站长数字 UID）与高强度随机 `WEBHOOK_SECRET`；
- 生产环境始终保持 `DEV_PREVIEW="false"`（且代码层面已强制锁定仅 `localhost` 生效）；
- 升级后如曾使用根路径 `/` 接收 Webhook，请访问一次 `/setup?secret=<你的WEBHOOK_SECRET>` 重新注册带密钥校验的 `/webhook`。
