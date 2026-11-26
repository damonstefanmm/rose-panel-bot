// In-app version checker (Scheme A) & optional GitHub Fork syncer (Scheme B).
// Strictly admin-only. Zero arbitrary URLs / zero SSRF: only talks to api.github.com.

import { APP_VERSION, UPSTREAM_REPO } from './version.js';

const RELEASE_CACHE_KEY = 'cache:latest_release';
const RELEASE_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const RELEASE_ERROR_TTL_MS = 30 * 60 * 1000; // 30 minutes on failure to avoid hammering GitHub

const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const BRANCH_PATTERN = /^[A-Za-z0-9_.\-/]{1,64}$/;

/**
 * Compares two SemVer strings (e.g., "v1.4.0" vs "1.3.0").
 * Returns 1 if a > b, -1 if a < b, 0 if equal.
 */
export function compareSemver(a, b) {
  const parse = (v) =>
    String(v || '')
      .trim()
      .replace(/^v/i, '')
      .split('-')[0]
      .split('.')
      .slice(0, 3)
      .map((n) => {
        const parsed = parseInt(n, 10);
        return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
      });
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i += 1) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff > 0) return 1;
    if (diff < 0) return -1;
  }
  return 0;
}

export function normalizeForkRepo(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  // Accept full GitHub URLs like https://github.com/user/rose-panel-bot(.git)
  s = s.replace(/^https?:\/\/(?:www\.)?github\.com\//i, '').replace(/\.git$/i, '').replace(/\/+$/, '');
  return s;
}

export function validateForkRepo(raw) {
  const repo = normalizeForkRepo(raw);
  if (!repo) {
    return { ok: false, error: '请先填写你自己 Fork 的 GitHub 仓库（格式如 yourname/rose-panel-bot）' };
  }
  if (!REPO_PATTERN.test(repo) || repo.includes('..')) {
    return { ok: false, error: '仓库名格式不正确，请使用 owner/repo 格式（例如 yourname/rose-panel-bot）' };
  }
  if (repo.toLowerCase() === UPSTREAM_REPO.toLowerCase()) {
    return {
      ok: false,
      error: `你填写的是官方上游仓库（${UPSTREAM_REPO}），请改成你自己 Fork 的仓库名`,
    };
  }
  return { ok: true, repo };
}

export function validateBranchName(raw) {
  const branch = String(raw || 'main').trim() || 'main';
  if (!BRANCH_PATTERN.test(branch) || branch.includes('..') || branch.startsWith('/') || branch.endsWith('/')) {
    return { ok: false, error: '分支名格式不正确（默认请填 main）' };
  }
  return { ok: true, branch };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 6500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchVersionFromRawPackageJson() {
  const res = await fetchWithTimeout(
    `https://raw.githubusercontent.com/${UPSTREAM_REPO}/main/package.json`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'RosePanel-Bot-Updater',
      },
    },
    5500
  );
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const pkg = await res.json();
  const ver = String(pkg?.version || '').trim().replace(/^v/i, '');
  if (!ver) throw new Error('package.json missing version');
  return ver;
}

async function cacheReleaseResult(env, payload, ttlSeconds) {
  if (!env.TOPIC_MAP) return;
  try {
    await env.TOPIC_MAP.put(
      RELEASE_CACHE_KEY,
      JSON.stringify({ ...payload, cachedAt: Date.now() }),
      { expirationTtl: ttlSeconds }
    );
  } catch {
    // Ignore KV cache write failures
  }
}

/**
 * Scheme A: Read-only check against GitHub public latest release API (KV-cached 6h).
 * Falls back to raw.githubusercontent.com/main/package.json on shared-IP 403/429 rate limits,
 * and caches failures for 30 minutes to avoid repeated upstream calls.
 */
export async function checkLatestRelease(env, options = {}) {
  const { forceRefresh = false } = options;

  if (!forceRefresh && env.TOPIC_MAP) {
    try {
      const cached = await env.TOPIC_MAP.get(RELEASE_CACHE_KEY, { type: 'json' });
      if (cached) {
        if (cached.failed && Date.now() - cached.cachedAt < RELEASE_ERROR_TTL_MS) {
          return {
            ok: false,
            currentVersion: APP_VERSION,
            latestVersion: null,
            hasUpdate: false,
            upstreamRepo: UPSTREAM_REPO,
            error: cached.error || '检查更新失败，请稍后重试',
            cached: true,
          };
        }
        if (cached.latestVersion && Date.now() - cached.cachedAt < RELEASE_CACHE_TTL_MS) {
          const hasUpdate = compareSemver(cached.latestVersion, APP_VERSION) > 0;
          return {
            ok: true,
            currentVersion: APP_VERSION,
            latestVersion: cached.latestVersion,
            hasUpdate,
            releaseName: cached.releaseName || `v${cached.latestVersion}`,
            releaseUrl: cached.releaseUrl || `https://github.com/${UPSTREAM_REPO}/releases`,
            publishedAt: cached.publishedAt || null,
            notes: cached.notes || '',
            upstreamRepo: UPSTREAM_REPO,
            fallbackSource: cached.fallbackSource || null,
            cached: true,
          };
        }
      }
    } catch {
      // Ignore KV cache read error
    }
  }

  let failureReason = '';
  try {
    const res = await fetchWithTimeout(
      `https://api.github.com/repos/${UPSTREAM_REPO}/releases/latest`,
      {
        method: 'GET',
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'RosePanel-Bot-Updater',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
      6000
    );

    if (res.ok) {
      const data = await res.json();
      const latestVersion = String(data?.tag_name || '').trim().replace(/^v/i, '');
      if (!latestVersion) {
        failureReason = 'GitHub 未返回有效版本号';
      } else {
        const releaseUrl = String(data?.html_url || `https://github.com/${UPSTREAM_REPO}/releases`);
        const releaseName = String(data?.name || `v${latestVersion}`);
        const publishedAt = data?.published_at || null;
        const notes = String(data?.body || '').trim().slice(0, 600);

        await cacheReleaseResult(
          env,
          { latestVersion, releaseName, releaseUrl, publishedAt, notes, fallbackSource: null },
          21600
        );

        return {
          ok: true,
          currentVersion: APP_VERSION,
          latestVersion,
          hasUpdate: compareSemver(latestVersion, APP_VERSION) > 0,
          releaseName,
          releaseUrl,
          publishedAt,
          notes,
          upstreamRepo: UPSTREAM_REPO,
          fallbackSource: null,
          cached: false,
        };
      }
    } else if (res.status === 403 || res.status === 429) {
      // Shared Workers egress IP hit GitHub anonymous 60/hr limit -> fallback to raw package.json
      try {
        const latestVersion = await fetchVersionFromRawPackageJson();
        const releaseUrl = `https://github.com/${UPSTREAM_REPO}/releases`;
        const releaseName = `v${latestVersion}`;
        await cacheReleaseResult(
          env,
          {
            latestVersion,
            releaseName,
            releaseUrl,
            publishedAt: null,
            notes: '',
            fallbackSource: 'raw-package-json',
          },
          21600
        );
        return {
          ok: true,
          currentVersion: APP_VERSION,
          latestVersion,
          hasUpdate: compareSemver(latestVersion, APP_VERSION) > 0,
          releaseName,
          releaseUrl,
          publishedAt: null,
          notes: '',
          upstreamRepo: UPSTREAM_REPO,
          fallbackSource: 'raw-package-json',
          cached: false,
        };
      } catch {
        failureReason = 'GitHub 公开接口请求较频繁，请稍后再试';
      }
    } else {
      failureReason = `检查更新失败 (HTTP ${res.status})`;
    }
  } catch (err) {
    failureReason = `无法连接 GitHub 检查更新 (${err?.message || 'network error'})`;
  }

  await cacheReleaseResult(env, { failed: true, error: failureReason }, 1800);
  return {
    ok: false,
    currentVersion: APP_VERSION,
    latestVersion: null,
    hasUpdate: false,
    upstreamRepo: UPSTREAM_REPO,
    error: failureReason,
    cached: false,
  };
}

/**
 * Scheme B (Optional): Calls GitHub official `POST /repos/{owner}/{repo}/merge-upstream`
 * using the owner's single-repo Fine-grained Token so Cloudflare Git integration
 * automatically builds and deploys the new release.
 */
export async function syncForkWithUpstream(env, updaterConfig = {}) {
  const repoCheck = validateForkRepo(updaterConfig.forkRepo);
  if (!repoCheck.ok) {
    return { ok: false, status: 400, error: repoCheck.error };
  }

  const branchCheck = validateBranchName(updaterConfig.branch);
  if (!branchCheck.ok) {
    return { ok: false, status: 400, error: branchCheck.error };
  }

  const token = String(updaterConfig.githubToken || '').trim();
  if (!token) {
    return {
      ok: false,
      status: 400,
      error: '请先填入 GitHub Token（或直接点击上方「去 GitHub 手动同步」，无需 Token）',
    };
  }

  const [owner, repo] = repoCheck.repo.split('/');
  const endpoint = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/merge-upstream`;

  try {
    const res = await fetchWithTimeout(
      endpoint,
      {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'User-Agent': 'RosePanel-Bot-Updater',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({ branch: branchCheck.branch }),
      },
      8000
    );

    const data = await res.json().catch(() => ({}));

    if (res.ok) {
      const mergeType = String(data?.merge_type || '');
      const alreadyLatest = mergeType === 'none';
      return {
        ok: true,
        status: 200,
        alreadyLatest,
        mergeType: mergeType || 'fast-forward',
        repo: repoCheck.repo,
        branch: branchCheck.branch,
        message: alreadyLatest
          ? `你的仓库 ${repoCheck.repo} (${branchCheck.branch}) 已经是最新代码，无需同步 ✅`
          : `🎉 已将 ${repoCheck.repo} (${branchCheck.branch}) 同步至最新上游代码！Cloudflare 通常会在 30~60 秒内自动完成构建上线。`,
      };
    }

    if (res.status === 409) {
      return {
        ok: false,
        status: 409,
        error: '检测到分支代码冲突，请前往 GitHub 网页端手动解决冲突后再同步',
      };
    }
    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        status: res.status,
        error:
          'GitHub Token 无效或权限不足（请确认 Fine-grained Token 已开启该仓库的 Contents: Read and write；若仓库含 workflow 文件还需开启 Workflows: Read and write）',
      };
    }
    if (res.status === 422) {
      return {
        ok: false,
        status: 422,
        error: `你的仓库 ${repoCheck.repo} 不是 Fork（Cloudflare 一键部署按钮创建的是独立副本，无法直接调用 Sync fork），请参考教程 FAQ Q3 用 git 拉取上游更新，或重新 Fork 后改绑 Cloudflare`,
      };
    }
    if (res.status === 404) {
      return {
        ok: false,
        status: 404,
        error: `未找到仓库 ${repoCheck.repo}，或 Token 缺少该仓库访问权限（${data?.message || 'HTTP 404'}）`,
      };
    }

    return {
      ok: false,
      status: res.status,
      error: `GitHub 同步失败 (HTTP ${res.status}${data?.message ? `: ${data.message}` : ''})`,
    };
  } catch (err) {
    return {
      ok: false,
      status: 502,
      error: `无法连接 GitHub 同步接口 (${err?.message || 'network error'})`,
    };
  }
}
