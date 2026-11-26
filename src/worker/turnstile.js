// Cloudflare Turnstile strict verification page (/verify) & server-side siteverify (/verify-submit)

import { escapeHtml } from './telegram.js';

export function renderTurnstileVerifyPage(siteKey, verifyId) {
  const safeKey = escapeHtml(siteKey || '');
  const safeVid = escapeHtml(verifyId || '');

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <title>人机安全验证 · RosePanel</title>
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      background: #faf4f5;
      color: #1e1619;
      font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'PingFang SC', sans-serif;
    }
    @media (prefers-color-scheme: dark) {
      body { background: #141012; color: #f7eef1; }
      .card { background: #1f181b !important; border-color: rgba(255,224,235,0.08) !important; }
      .sub { color: #b9a6ae !important; }
    }
    .card {
      width: 100%;
      max-width: 380px;
      background: #ffffff;
      border-radius: 24px;
      border: 1px solid rgba(163, 41, 82, 0.1);
      box-shadow: 0 10px 32px rgba(140, 38, 72, 0.08);
      padding: 26px 22px;
      text-align: center;
    }
    .icon { font-size: 38px; margin-bottom: 10px; }
    h1 { margin: 0 0 8px; font-size: 19px; font-weight: 700; }
    .sub { margin: 0 0 20px; font-size: 13px; color: #6f5f66; line-height: 1.5; }
    .widget-wrap { display: flex; justify-content: center; min-height: 70px; margin-bottom: 16px; }
    .status {
      font-size: 13px;
      font-weight: 600;
      min-height: 22px;
      color: #a32952;
    }
    .status.ok { color: #16935d; }
    .status.err { color: #d43448; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">🛡️</div>
    <h1>Cloudflare 人机安全验证</h1>
    <p class="sub">请完成下方人机核验，通过后您的私聊消息将自动送达，30 天内无需重复验证。</p>
    <div class="widget-wrap">
      <div class="cf-turnstile" data-sitekey="${safeKey}" data-callback="onTurnstileSuccess" data-error-callback="onTurnstileError"></div>
    </div>
    <div id="status" class="status">正在加载安全验证组件…</div>
  </div>
  <script>
    const tg = window.Telegram && window.Telegram.WebApp;
    if (tg) { try { tg.ready(); tg.expand(); } catch {} }
    const statusEl = document.getElementById('status');
    window.onTurnstileError = function() {
      statusEl.className = 'status err';
      statusEl.textContent = '验证组件加载失败，请刷新重试。';
    };
    window.onTurnstileSuccess = async function(token) {
      statusEl.className = 'status';
      statusEl.textContent = '正在核验，请稍候…';
      try {
        const res = await fetch('/verify-submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ verifyId: '${safeVid}', token })
        });
        const data = await res.json();
        if (res.ok && data.ok) {
          statusEl.className = 'status ok';
          statusEl.textContent = '✅ 验证通过！消息已自动送达，正在返回聊天…';
          setTimeout(() => { if (tg && tg.close) tg.close(); }, 1100);
        } else {
          statusEl.className = 'status err';
          statusEl.textContent = '❌ ' + (data.error || '验证失败，请刷新重试');
        }
      } catch (e) {
        statusEl.className = 'status err';
        statusEl.textContent = '❌ 网络异常，请稍后再试';
      }
    };
  </script>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

export async function verifyTurnstileToken(secret, token, remoteIp = '') {
  if (!secret || !token) return { success: false, error: 'Missing Turnstile credentials or token' };
  const body = new URLSearchParams();
  body.set('secret', secret);
  body.set('response', token);
  if (remoteIp) body.set('remoteip', remoteIp);

  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const data = await res.json().catch(() => ({ success: false }));
  return {
    success: Boolean(data?.success),
    errorCodes: data?.['error-codes'] || [],
  };
}
