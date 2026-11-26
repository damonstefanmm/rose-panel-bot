// Group Check-in, Streak Bonus, Level Progression & Achievement Badges Engine

import { BADGE_CATALOG, LEVELS, safeGetJSON, safePutJSON } from './config.js';

const LEADERBOARD_KEY = 'checkin:leaderboard';

function randomIntInclusive(min, max) {
  if (max <= min) return min;
  const range = max - min + 1;
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return min + (buf[0] % range);
}

export function getLocalDateParts(nowDate = new Date(), offsetHours = 8) {
  const shifted = new Date(nowDate.getTime() + offsetHours * 3600 * 1000);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  const hour = shifted.getUTCHours();
  const minute = shifted.getUTCMinutes();

  const yesterday = new Date(shifted.getTime() - 86400 * 1000);
  const yYear = yesterday.getUTCFullYear();
  const yMonth = String(yesterday.getUTCMonth() + 1).padStart(2, '0');
  const yDay = String(yesterday.getUTCDate()).padStart(2, '0');

  return {
    dateKey: `${year}-${month}-${day}`,
    yesterdayKey: `${yYear}-${yMonth}-${yDay}`,
    hour,
    minute,
  };
}

export function resolveLevel(points = 0) {
  const safePoints = Math.max(0, Number(points) || 0);
  let currentIndex = 0;
  for (let i = 0; i < LEVELS.length; i += 1) {
    if (safePoints >= LEVELS[i].minXp) {
      currentIndex = i;
    }
  }
  const current = LEVELS[currentIndex];
  const next = LEVELS[currentIndex + 1] || null;
  if (!next) {
    return {
      current,
      next: null,
      xpIntoLevel: safePoints - current.minXp,
      xpNeeded: 0,
      remainingXp: 0,
      progressPct: 100,
    };
  }
  const span = next.minXp - current.minXp;
  const into = safePoints - current.minXp;
  return {
    current,
    next,
    xpIntoLevel: into,
    xpNeeded: span,
    remainingXp: Math.max(0, next.minXp - safePoints),
    progressPct: Math.min(100, Math.max(0, Math.round((into / span) * 100))),
  };
}

export function buildLast7DaysStrip(historyDates = [], nowDate = new Date(), offsetHours = 8) {
  const set = new Set(historyDates);
  const strip = [];
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date(nowDate.getTime() - i * 86400 * 1000);
    const { dateKey } = getLocalDateParts(d, offsetHours);
    strip.push({
      date: dateKey,
      label: dateKey.slice(5).replace('-', '/'),
      checked: set.has(dateKey),
      isToday: i === 0,
    });
  }
  return strip;
}

function displayNameOf(user) {
  if (!user) return '神秘旅人';
  const full = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  return full || (user.username ? `@${user.username}` : `UID ${user.id}`);
}

export async function getMemberTicket(env, user, communityConfig, nowDate = new Date()) {
  const offset = Number(communityConfig?.timezoneOffsetHours ?? 8);
  const { dateKey } = getLocalDateParts(nowDate, offset);
  const uid = String(user?.id || '');
  const raw = uid ? await safeGetJSON(env.TOPIC_MAP, `checkin:user:${uid}`, null) : null;

  const points = Number(raw?.points || 0);
  const streak = Number(raw?.streak || 0);
  const bestStreak = Number(raw?.bestStreak || 0);
  const totalDays = Number(raw?.totalDays || 0);
  const lastCheckinDate = raw?.lastCheckinDate || null;
  const checkedInToday = lastCheckinDate === dateKey;
  const historyDates = Array.isArray(raw?.historyDates) ? raw.historyDates : [];
  const unlockedIds = new Set(Array.isArray(raw?.badges) ? raw.badges : []);
  const logs = Array.isArray(raw?.logs) ? raw.logs : [];

  const levelInfo = resolveLevel(points);
  const badges = BADGE_CATALOG.map((b) => ({
    ...b,
    unlocked: unlockedIds.has(b.id),
  }));

  return {
    userId: uid,
    displayName: displayNameOf(user) || raw?.displayName || '访客',
    username: user?.username || raw?.username || '',
    points,
    streak,
    bestStreak,
    totalDays,
    lastCheckinDate,
    checkedInToday,
    joinedAt: raw?.joinedAt || null,
    level: levelInfo,
    badges,
    unlockedBadgeCount: unlockedIds.size,
    totalBadgeCount: BADGE_CATALOG.length,
    recent7Days: buildLast7DaysStrip(historyDates, nowDate, offset),
    logs: logs.slice(0, 20),
  };
}

export async function performCheckin(env, user, communityConfig, nowDate = new Date()) {
  if (!user?.id) {
    throw new Error('Missing user identity');
  }

  const uid = String(user.id);
  const key = `checkin:user:${uid}`;
  const offset = Number(communityConfig?.timezoneOffsetHours ?? 8);
  const { dateKey, yesterdayKey, hour, minute } = getLocalDateParts(nowDate, offset);

  const existing = (await safeGetJSON(env.TOPIC_MAP, key, null)) || {
    userId: uid,
    points: 0,
    streak: 0,
    bestStreak: 0,
    totalDays: 0,
    lastCheckinDate: null,
    joinedAt: nowDate.toISOString(),
    historyDates: [],
    badges: [],
    logs: [],
  };

  if (existing.lastCheckinDate === dateKey) {
    const ticket = await getMemberTicket(env, user, communityConfig, nowDate);
    return {
      alreadyCheckedIn: true,
      gained: 0,
      breakdown: { base: 0, streakBonus: 0, milestoneBonus: 0 },
      newlyUnlocked: [],
      ticket,
    };
  }

  const newStreak = existing.lastCheckinDate === yesterdayKey ? (existing.streak || 0) + 1 : 1;
  const bestStreak = Math.max(existing.bestStreak || 0, newStreak);
  const totalDays = (existing.totalDays || 0) + 1;

  const minPts = Number(communityConfig?.dailyMinPoints ?? 10);
  const maxPts = Number(communityConfig?.dailyMaxPoints ?? 25);
  const base = randomIntInclusive(minPts, maxPts);

  const stepBonus = Number(communityConfig?.streakStepBonus ?? 2);
  const maxBonus = Number(communityConfig?.streakMaxBonus ?? 20);
  const streakBonus = Math.min(maxBonus, Math.max(0, (newStreak - 1) * stepBonus));

  let milestoneBonus = 0;
  if (newStreak === 7) milestoneBonus = Number(communityConfig?.milestone7Bonus ?? 30);
  else if (newStreak === 30) milestoneBonus = Number(communityConfig?.milestone30Bonus ?? 120);

  const gained = base + streakBonus + milestoneBonus;
  const nextPoints = (existing.points || 0) + gained;

  // Evaluate newly unlocked achievement badges
  const badgeSet = new Set(Array.isArray(existing.badges) ? existing.badges : []);
  const beforeSize = badgeSet.size;
  const newlyUnlocked = [];

  const maybeUnlock = (id, condition) => {
    if (condition && !badgeSet.has(id)) {
      badgeSet.add(id);
      const meta = BADGE_CATALOG.find((b) => b.id === id);
      if (meta) newlyUnlocked.push(meta);
    }
  };

  maybeUnlock('first_checkin', totalDays >= 1);
  maybeUnlock('streak_3', newStreak >= 3);
  maybeUnlock('streak_7', newStreak >= 7);
  maybeUnlock('streak_30', newStreak >= 30);
  maybeUnlock('loyal_10', totalDays >= 10);
  maybeUnlock('points_500', nextPoints >= 500);
  maybeUnlock('points_2000', nextPoints >= 2000);
  const minsOfDay = hour * 60 + minute;
  maybeUnlock('early_bird', minsOfDay >= 5 * 60 && minsOfDay <= 8 * 60 + 30);

  const historyDates = Array.isArray(existing.historyDates) ? existing.historyDates : [];
  if (!historyDates.includes(dateKey)) historyDates.push(dateKey);
  const trimmedDates = historyDates.slice(-60);

  const reasonParts = [`每日签到 +${base}`];
  if (streakBonus > 0) reasonParts.push(`连签奖励 +${streakBonus}`);
  if (milestoneBonus > 0) reasonParts.push(`里程碑 +${milestoneBonus}`);

  const logs = Array.isArray(existing.logs) ? existing.logs : [];
  logs.unshift({
    date: dateKey,
    at: nowDate.toISOString(),
    delta: gained,
    balance: nextPoints,
    reason: reasonParts.join(' · '),
  });

  const displayName = displayNameOf(user);
  const updated = {
    ...existing,
    userId: uid,
    displayName,
    username: user.username || existing.username || '',
    points: nextPoints,
    streak: newStreak,
    bestStreak,
    totalDays,
    lastCheckinDate: dateKey,
    historyDates: trimmedDates,
    badges: Array.from(badgeSet),
    logs: logs.slice(0, 30),
    updatedAt: nowDate.toISOString(),
  };

  await safePutJSON(env.TOPIC_MAP, key, updated);

  // Update leaderboard index
  await updateLeaderboard(env, {
    userId: uid,
    displayName,
    username: updated.username,
    points: nextPoints,
    streak: newStreak,
    totalDays,
    badgeCount: badgeSet.size,
    level: resolveLevel(nextPoints).current.level,
    levelTitle: resolveLevel(nextPoints).current.title,
    updatedAt: updated.updatedAt,
  });

  const ticket = await getMemberTicket(env, user, communityConfig, nowDate);
  return {
    alreadyCheckedIn: false,
    gained,
    breakdown: { base, streakBonus, milestoneBonus },
    newlyUnlocked: badgeSet.size > beforeSize ? newlyUnlocked : [],
    ticket,
  };
}

async function updateLeaderboard(env, entry) {
  if (!env.TOPIC_MAP) return;
  const list = (await safeGetJSON(env.TOPIC_MAP, LEADERBOARD_KEY, [])) || [];
  const filtered = list.filter((item) => String(item.userId) !== String(entry.userId));
  filtered.push(entry);
  filtered.sort((a, b) => b.points - a.points || b.streak - a.streak);
  await safePutJSON(env.TOPIC_MAP, LEADERBOARD_KEY, filtered.slice(0, 100));
}

export async function getLeaderboard(env, limit = 20) {
  const list = (await safeGetJSON(env.TOPIC_MAP, LEADERBOARD_KEY, [])) || [];
  return {
    levels: LEVELS,
    badges: BADGE_CATALOG,
    items: list.slice(0, limit),
  };
}
