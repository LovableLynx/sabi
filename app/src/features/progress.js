// XP, ranks, daily streak, hearts and badges. Stored per device.
//
// Talks to the rest of the app only through the bus:
//   answers  stats, canPlay, lessonDone, awardLesson, loseHeart, badges
//   emits    xp:changed, rank:up, badge:earned, hearts:changed, streak:changed
// If this module fails to load, lessons still play: canPlay falls back to
// true and no XP is shown.

import { answer, emit, on } from "../core/bus.js";
import { load, save } from "../core/storage.js";

export const RANKS = [
  { name: "JJC", xp: 0, icon: "🌱", blurb: "Johnny Just Come. Everybody start somewhere" },
  { name: "Learner", xp: 100, icon: "📗", blurb: "You don enter the matter" },
  { name: "Sharp", xp: 300, icon: "✏️", blurb: "Sharp guy, sharp babe" },
  { name: "Distinction", xp: 700, icon: "🎓", blurb: "A1 material" },
  { name: "Odogwu", xp: 1500, icon: "🦁", blurb: "The great one" },
  { name: "Professor", xp: 3000, icon: "🧠", blurb: "Them go call you Prof" },
  { name: "Sabi Legend", xp: 6000, icon: "👑", blurb: "Nobody sabi pass you" },
];

export const BADGES = [
  { id: "first-step", name: "First Step", icon: "👣", desc: "Finish your first lesson" },
  { id: "no-hint", name: "I No Need Hint", icon: "💡", desc: "Solve 5 lessons first try, no hints" },
  { id: "curious", name: "Curious Mind", icon: "💬", desc: "Talk a problem through with Sabi" },
  { id: "streak-3", name: "No Dulling", icon: "🔥", desc: "Keep a 3-day streak" },
  { id: "streak-7", name: "Week of Fire", icon: "🌶️", desc: "Keep a 7-day streak" },
  { id: "town-crier", name: "Town Crier", icon: "📯", desc: "Finish 5 Literature lessons" },
  { id: "okada", name: "Okada Physicist", icon: "🏍️", desc: "Finish 5 Physics lessons" },
  { id: "esusu", name: "Esusu Accountant", icon: "🪙", desc: "Finish 5 Accounting lessons" },
  { id: "all-rounder", name: "All-Rounder", icon: "🎯", desc: "Finish a lesson in all three streams" },
  { id: "unit-champ", name: "Unit Champion", icon: "🏅", desc: "Finish every lesson in a unit" },
];

const MAX_HEARTS = 5;
const HEART_REFILL_MS = 20 * 60 * 1000;

const state = load("progress", {
  xp: 0,
  streak: { count: 0, lastDay: null },
  hearts: { count: MAX_HEARTS, updatedAt: Date.now() },
  badges: [],
  lessons: {}, // lessonId -> { subject, unitId, bestFirstTry, completedAt }
  noHintSolves: 0,
  chatted: false,
});

function persist() {
  save("progress", state);
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}

export function rankFor(xp) {
  let index = 0;
  RANKS.forEach((r, i) => {
    if (xp >= r.xp) index = i;
  });
  const rank = RANKS[index];
  const next = RANKS[index + 1] || null;
  const progress = next ? (xp - rank.xp) / (next.xp - rank.xp) : 1;
  return { ...rank, index, next, progress };
}

function refillHearts() {
  const h = state.hearts;
  if (h.count >= MAX_HEARTS) {
    h.updatedAt = Date.now();
    return;
  }
  const gained = Math.floor((Date.now() - h.updatedAt) / HEART_REFILL_MS);
  if (gained > 0) {
    h.count = Math.min(MAX_HEARTS, h.count + gained);
    h.updatedAt += gained * HEART_REFILL_MS;
    persist();
    emit("hearts:changed", h.count);
    emit("toast", { text: h.count >= MAX_HEARTS ? "⛽ Your tank is full again! Let's go." : `⛽ +${gained} fuel! You now have ${h.count} of ${MAX_HEARTS}.`, kind: "good" });
  }
}

function streakNow() {
  const { count, lastDay } = state.streak;
  if (!lastDay) return 0;
  return daysBetween(lastDay, today()) <= 1 ? count : 0; // broken if a day was missed
}

function bumpStreak() {
  const day = today();
  const { lastDay } = state.streak;
  if (lastDay === day) return;
  state.streak = { count: lastDay && daysBetween(lastDay, day) === 1 ? state.streak.count + 1 : 1, lastDay: day };
  emit("streak:changed", state.streak.count);
}

function award(id) {
  if (state.badges.includes(id)) return;
  state.badges.push(id);
  emit("badge:earned", BADGES.find((b) => b.id === id));
}

function checkBadges(lesson, units) {
  const done = Object.values(state.lessons);
  const bySubject = (s) => done.filter((l) => l.subject === s).length;
  if (done.length >= 1) award("first-step");
  if (state.noHintSolves >= 5) award("no-hint");
  if (state.chatted) award("curious");
  if (state.streak.count >= 3) award("streak-3");
  if (state.streak.count >= 7) award("streak-7");
  if (bySubject("literature") >= 5) award("town-crier");
  if (bySubject("physics") >= 5) award("okada");
  if (bySubject("accounting") >= 5) award("esusu");
  if (["literature", "physics", "accounting"].every((s) => bySubject(s) >= 1)) award("all-rounder");
  if (lesson?.unit && lesson.unit.lessons.every((l) => state.lessons[l.id])) award("unit-champ");
}

// result: { lesson, correct, firstTry, hintsUsed, chatTurns }
function awardLesson(result) {
  refillHearts();
  const { lesson, correct, firstTry, hintsUsed, chatTurns } = result;
  const replay = !!state.lessons[lesson.id];
  const parts = [];

  if (result.round && result.round.total > 1) {
    // A round of tasks: 2 XP per task right first time, 1 XP per task right
    // on the second try, plus a bonus for finishing the stop.
    const { total, right, firstTry: first } = result.round;
    parts.push({ label: `${right} of ${total} tasks right`, xp: first * 2 + (right - first) });
    if (correct) parts.push({ label: "Stop complete", xp: 10 });
    if (correct && first === total) parts.push({ label: "Perfect round", xp: 10 });
    if (correct && hintsUsed === 0) parts.push({ label: "No hints needed", xp: 5 });
    if (chatTurns > 0) parts.push({ label: "Thought it through with Sabi", xp: 5 });
  } else if (correct) {
    parts.push({ label: firstTry ? "Correct!" : "Correct", xp: firstTry ? 20 : 10 });
    if (firstTry && hintsUsed === 0) parts.push({ label: "Solved it yourself", xp: 10 });
    if (chatTurns > 0) parts.push({ label: "Thought it through with Sabi", xp: 5 });
  } else {
    parts.push({ label: "For trying", xp: 5 });
  }
  if (replay) parts.forEach((p) => (p.xp = Math.ceil(p.xp / 2)));

  const gained = parts.reduce((s, p) => s + p.xp, 0);
  const before = rankFor(state.xp);
  state.xp += gained;
  const after = rankFor(state.xp);

  if (correct) {
    if ((firstTry || result.round) && hintsUsed === 0 && !replay) state.noHintSolves += 1;
    state.lessons[lesson.id] = {
      subject: lesson.subject,
      unitId: lesson.unit?.id,
      bestFirstTry: firstTry || state.lessons[lesson.id]?.bestFirstTry || false,
      completedAt: Date.now(),
    };
    if (replay && state.hearts.count < MAX_HEARTS) {
      state.hearts.count += 1; // practising a finished lesson earns a heart back
      parts.push({ label: "Practice bonus: +1 ⛽ fuel", xp: 0 });
      emit("hearts:changed", state.hearts.count);
    }
  }
  if (chatTurns > 0) state.chatted = true;

  bumpStreak();
  checkBadges(lesson);
  persist();

  emit("xp:changed", { xp: state.xp, gained, rank: after });
  if (after.index > before.index) emit("rank:up", after);
  return { gained, parts, rank: after, replay };
}

function loseHeart() {
  refillHearts();
  state.hearts.count = Math.max(0, state.hearts.count - 1);
  state.hearts.updatedAt = Date.now();
  persist();
  emit("hearts:changed", state.hearts.count);
  return state.hearts.count;
}

export function init() {
  // "Delete my data" wipes progress too, then starts fresh.
  on("data:delete", () => {
    Object.assign(state, {
      xp: 0, streak: { count: 0, lastDay: null }, hearts: { count: MAX_HEARTS, updatedAt: Date.now() },
      badges: [], lessons: {}, noHintSolves: 0, chatted: false,
    });
    persist();
    emit("xp:changed", { xp: 0, gained: 0, rank: rankFor(0) });
  });
  refillHearts();
  setInterval(refillHearts, 60 * 1000);

  answer("stats", () => {
    refillHearts();
    const nextHeartIn =
      state.hearts.count < MAX_HEARTS ? Math.max(0, HEART_REFILL_MS - (Date.now() - state.hearts.updatedAt)) : 0;
    return {
      xp: state.xp,
      rank: rankFor(state.xp),
      streak: streakNow(),
      hearts: state.hearts.count,
      maxHearts: MAX_HEARTS,
      nextHeartIn,
      refillMinutes: HEART_REFILL_MS / 60000,
      lessonsDone: Object.keys(state.lessons).length,
    };
  });
  answer("canPlay", () => {
    refillHearts();
    return state.hearts.count > 0;
  });
  answer("lessonDone", (id) => !!state.lessons[id]);
  answer("awardLesson", awardLesson);
  answer("loseHeart", loseHeart);
  answer("badges", () => BADGES.map((b) => ({ ...b, earned: state.badges.includes(b.id) })));
  answer("ranks", () => RANKS);
}
