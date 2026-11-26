// 4-Layer Anti-Spam Shield for RosePanel Bot:
// 1. Combot Anti-Spam (CAS) global blacklist lookup with KV caching (fail-open)
// 2. Unicode de-obfuscation (zero-width stripping, NFKC full-width folding, Cyrillic homoglyph folding)
// 3. Heuristic risk scoring (forwarded ads, external/t.me links, zero-width tricks, ad profile names, blocked keywords)
// 4. Intercepted spam counter in KV for admin visibility

const ZERO_WIDTH_REGEX = /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g;

// Common Cyrillic/Greek homoglyphs spammers use to bypass Latin keyword/link filters
const HOMOGLYPH_MAP = {
  а: 'a',
  е: 'e',
  о: 'o',
  р: 'p',
  с: 'c',
  у: 'y',
  х: 'x',
  к: 'k',
  м: 'm',
  т: 't',
  н: 'h',
  в: 'b',
  і: 'i',
  ј: 'j',
  ѕ: 's',
  ԁ: 'd',
  ɡ: 'g',
  ν: 'v',
};

const SPAM_STATS_KEY = 'stats:blocked_spam';

/**
 * Strips invisible zero-width characters, folds full-width Unicode (NFKC),
 * and normalizes common homoglyphs into clean lowercase text for reliable matching.
 */
export function normalizeAntiSpamText(raw = '') {
  const input = String(raw || '');
  const zeroWidthMatches = input.match(ZERO_WIDTH_REGEX);
  const zeroWidthCount = zeroWidthMatches ? zeroWidthMatches.length : 0;

  const stripped = input.replace(ZERO_WIDTH_REGEX, '').normalize('NFKC').toLowerCase();
  let folded = '';
  for (const ch of stripped) {
    folded += HOMOGLYPH_MAP[ch] || ch;
  }

  return {
    normalized: folded,
    zeroWidthCount,
  };
}

export function parseBlockedKeywords(raw = '') {
  if (Array.isArray(raw)) {
    return raw.map((k) => normalizeAntiSpamText(k).normalized.trim()).filter(Boolean);
  }
  return String(raw || '')
    .split(/[\n,，;；]+/)
    .map((k) => normalizeAntiSpamText(k).normalized.trim())
    .filter(Boolean);
}

/**
 * Layer 1: Checks Combot Anti-Spam (CAS) global spammer database (`https://api.cas.chat/check`).
 * Cached in KV (24h for flagged spammers, 6h for clean accounts). Fails open on network errors.
 */
export async function checkCasBlacklist(env, userId, fetchFn = fetch) {
  const uid = String(userId || '');
  if (!/^\d+$/.test(uid)) return { isSpammer: false, cached: false };

  const cacheKey = `cas:${uid}`;
  if (env.TOPIC_MAP) {
    const cached = await env.TOPIC_MAP.get(cacheKey);
    if (cached === '1') return { isSpammer: true, cached: true };
    if (cached === '0') return { isSpammer: false, cached: true };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    const res = await fetchFn(`https://api.cas.chat/check?user_id=${encodeURIComponent(uid)}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) return { isSpammer: false, cached: false, error: `HTTP ${res.status}` };
    const data = await res.json();
    const isSpammer = Boolean(data?.ok === true);

    if (env.TOPIC_MAP) {
      await env.TOPIC_MAP.put(cacheKey, isSpammer ? '1' : '0', {
        expirationTtl: isSpammer ? 86400 : 21600,
      });
    }
    return { isSpammer, cached: false, offenses: data?.result?.offenses || 0 };
  } catch (err) {
    // Always fail open so legitimate users are never locked out if CAS is slow/unreachable
    return { isSpammer: false, cached: false, error: err?.message || 'timeout' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Layer 2 & 4: Evaluates incoming or edited message for spam signals & blocked keywords.
 */
export function assessIncomingRisk(msg = {}, pmBotConfig = {}) {
  const rawText = String(msg.text || msg.caption || '');
  const rawName = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ');

  const textInfo = normalizeAntiSpamText(rawText);
  const nameInfo = normalizeAntiSpamText(rawName);
  const combinedNorm = `${textInfo.normalized}\n${nameInfo.normalized}`;

  const reasons = [];

  // 1. Forwarded message from a channel or third party (classic ad broadcast)
  const isForwarded = Boolean(
    msg.forward_origin || msg.forward_from || msg.forward_from_chat || msg.forward_sender_name
  );
  if (isForwarded) reasons.push('forwarded');

  // 1b. Unsolicited photo / video / animation / document poster (classic USDT/casino/VPN flyer ad)
  const isMedia = Boolean(
    (Array.isArray(msg.photo) && msg.photo.length > 0) ||
      msg.video ||
      msg.animation ||
      msg.document ||
      msg.sticker
  );
  if (isMedia && pmBotConfig.blockUnverifiedMedia !== false) {
    reasons.push('unverified_media');
  }

  // 2. Contains external URL or t.me link (in text or hidden text_link entity)
  const entities = [...(msg.entities || []), ...(msg.caption_entities || [])];
  const hasEntityLink = entities.some(
    (e) => e.type === 'url' || e.type === 'text_link' || (e.type === 'mention' && rawText.length > 40)
  );
  const hasRegexLink = /(?:https?:\/\/|t\.me\/|telegram\.me\/|wa\.me\/)/i.test(textInfo.normalized);
  if (hasEntityLink || hasRegexLink) reasons.push('contains_link');

  // 3. Zero-width invisible character obfuscation
  if (textInfo.zeroWidthCount >= 3 || nameInfo.zeroWidthCount >= 3) {
    reasons.push('zero_width_obfuscation');
  }

  // 4. Profile display name advertises a link/domain (Bio/Name spam)
  if (/(?:https?:\/\/|t\.me\/|\.(?:com|net|org|vip|xyz|cc|top|shop)\b)/i.test(nameInfo.normalized)) {
    reasons.push('suspicious_profile_name');
  }

  // 5. Admin custom blocked keywords (evaluated after de-obfuscation!)
  const keywords = parseBlockedKeywords(pmBotConfig.blockedKeywords || '');
  const matchedKeyword = keywords.find((kw) => kw && combinedNorm.includes(kw)) || '';
  if (matchedKeyword) {
    reasons.push(`blocked_keyword:${matchedKeyword}`);
  }

  return {
    isBlockedKeyword: Boolean(matchedKeyword),
    matchedKeyword,
    isHighRisk: reasons.length > 0,
    isForwarded,
    isMedia,
    hasLink: hasEntityLink || hasRegexLink,
    reasons,
  };
}

export async function recordBlockedSpam(env) {
  if (!env.TOPIC_MAP) return 0;
  const cur = Number((await env.TOPIC_MAP.get(SPAM_STATS_KEY)) || 0);
  const next = cur + 1;
  await env.TOPIC_MAP.put(SPAM_STATS_KEY, String(next));
  return next;
}

export async function getBlockedSpamCount(env) {
  if (!env.TOPIC_MAP) return 0;
  return Number((await env.TOPIC_MAP.get(SPAM_STATS_KEY)) || 0);
}
