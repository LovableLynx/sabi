// School / State / National leaderboards with Honor-of-Kings-style regional
// titles ("No.1 in Kings College", "Top 10 · Lagos").
//
// Scores sync to serve_sabi.py (/api/score, /api/leaderboard) ONLY when the
// player has ticked the permission box (a parent/teacher said yes, or 18+).
// The board identifies players by a public pid; the device's secret id is
// sent only in its own updates and never shown. Without a server (or without
// permission) it shows an on-device board, and the rest of the game is
// unaffected.

import { answer, ask, emit, on, provide } from "../core/bus.js";
import { deleteScore, fetchLeaderboard, health, submitScore } from "../core/api.js";
import { h, clear } from "../core/dom.js";
import { load, save } from "../core/storage.js";

let board = load("board-cache", { players: [], fetchedAt: 0, online: false });
let myPid = load("board-pid", null); // public id the server gave this device
let syncTimer = null;
let tab = "school";

function schoolKey(name) {
  return String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// What this player looks like on the board. Deliberately excludes the
// secret profile id so it can never end up in the page or on screen.
function me() {
  const profile = ask("profile", null, null);
  if (!profile) return null;
  const stats = ask("stats", null, null);
  return {
    pid: myPid || "me", nickname: profile.nickname, avatar: profile.avatar,
    state: profile.state, school: profile.school, xp: stats ? stats.xp : 0, shared: !!profile.consent,
  };
}

// Merge my latest local XP into the board so I see my own progress instantly.
function players() {
  const mine = me();
  const list = board.players.filter((p) => !mine || p.pid !== mine.pid);
  if (mine) list.push(mine);
  return list.sort((a, b) => b.xp - a.xp || a.nickname.localeCompare(b.nickname));
}

function positions() {
  const mine = me();
  if (!mine) return null;
  const all = players();
  const rankIn = (list) => list.findIndex((p) => p.pid === mine.pid) + 1;
  return {
    national: rankIn(all),
    nationalSize: all.length,
    state: rankIn(all.filter((p) => p.state === mine.state)),
    stateSize: all.filter((p) => p.state === mine.state).length,
    school: rankIn(all.filter((p) => schoolKey(p.school) === schoolKey(mine.school))),
    schoolSize: all.filter((p) => schoolKey(p.school) === schoolKey(mine.school)).length,
  };
}

function titles() {
  const mine = me();
  const pos = positions();
  if (!mine || !pos || mine.xp <= 0) return [];
  const t = [];
  if (pos.national === 1 && pos.nationalSize > 1) t.push("👑 Sabi King of Nigeria");
  else if (pos.national <= 10 && pos.nationalSize >= 10) t.push("🇳🇬 Nigeria Top 10");
  else if (pos.national <= 100 && pos.nationalSize >= 100) t.push("🇳🇬 Nigeria Top 100");
  if (pos.state === 1 && pos.stateSize > 1) t.push(`🥇 No.1 in ${mine.state}`);
  else if (pos.state <= 10 && pos.stateSize >= 10) t.push(`🏅 Top 10 · ${mine.state}`);
  if (pos.school === 1 && pos.schoolSize > 1) t.push(`🏆 No.1 in ${mine.school}`);
  else if (pos.school <= 3 && pos.schoolSize >= 3) t.push(`🎖️ Top 3 · ${mine.school}`);
  return t;
}

function aggregate(keyFn, labelFn) {
  const groups = new Map();
  for (const p of players()) {
    const key = keyFn(p);
    if (!key) continue;
    const g = groups.get(key) || { label: labelFn(p), xp: 0, count: 0, state: p.state };
    g.xp += p.xp;
    g.count += 1;
    groups.set(key, g);
  }
  return [...groups.entries()].map(([key, g]) => ({ key, ...g })).sort((a, b) => b.xp - a.xp);
}

async function refresh() {
  const status = await health();
  if (!status.leaderboard) {
    board = { ...board, online: false };
    return;
  }
  try {
    const data = await fetchLeaderboard();
    board = { players: data.players || [], fetchedAt: Date.now(), online: true };
    save("board-cache", board);
  } catch {
    board = { ...board, online: false };
  }
}

function scheduleSync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => {
    const profile = ask("profile", null, null);
    if (!profile || !profile.consent) return; // no permission: nothing leaves the device
    const mine = me();
    const status = await health();
    if (!status.leaderboard) return;
    try {
      const res = await submitScore({
        id: profile.id, nickname: mine.nickname, avatar: mine.avatar,
        state: mine.state, school: mine.school, xp: mine.xp,
      });
      if (res.pid && res.pid !== myPid) {
        myPid = res.pid;
        save("board-pid", myPid);
      }
    } catch {
      /* stays local; retried on the next XP change or leaderboard visit */
    }
  }, 1200);
}

const MEDALS = ["🥇", "🥈", "🥉"];

function playerRow(p, i, minePid) {
  return h("li", { class: "lb-row" + (p.pid === minePid ? " me" : "") },
    h("span", { class: "lb-pos" }, MEDALS[i] || String(i + 1)),
    h("span", { class: "lb-avatar" }, p.avatar || "🙂"),
    h("span", { class: "lb-name" },
      h("strong", {}, p.nickname + (p.pid === minePid ? " (you)" : "")),
      h("span", { class: "muted small" }, `${p.school} · ${p.state}`)
    ),
    h("span", { class: "lb-xp" }, `${p.xp} XP`)
  );
}

function groupRow(g, i, mineKey, sub) {
  return h("li", { class: "lb-row" + (g.key === mineKey ? " me" : "") },
    h("span", { class: "lb-pos" }, MEDALS[i] || String(i + 1)),
    h("span", { class: "lb-name" },
      h("strong", {}, g.label),
      h("span", { class: "muted small" }, sub(g))
    ),
    h("span", { class: "lb-xp" }, `${g.xp} XP`)
  );
}

function renderBoard(container) {
  clear(container);
  const mine = me();
  const pos = positions();

  container.appendChild(
    h("div", { class: "card lb-hero" },
      h("h2", {}, "🏆 Leaderboard"),
      mine && pos
        ? h("div", { class: "lb-standing" },
            h("div", {}, h("strong", {}, `#${pos.school}`), h("span", {}, "in school")),
            h("div", {}, h("strong", {}, `#${pos.state}`), h("span", {}, `in ${mine.state}`)),
            h("div", {}, h("strong", {}, `#${pos.national}`), h("span", {}, "in Nigeria"))
          )
        : h("p", { class: "muted" }, "Create a profile to rank for your school and state."),
      titles().length ? h("div", { class: "title-list" }, titles().map((t) => h("span", { class: "title-chip" }, t))) : null,
      mine && !mine.shared
        ? h("p", { class: "lb-offline" }, "🔒 Private: your scores stay on this device. To appear on the leaderboard, get a parent's or teacher's OK, then turn on sharing under Me → Edit.")
        : !board.online
        ? h("p", { class: "lb-offline" }, "📴 Offline: showing this device only. Rankings sync when the Sabi server is running.")
        : null,
      !mine ? h("button", { class: "btn btn-primary", onclick: () => emit("nav", { screen: "onboarding" }) }, "Create profile") : null
    )
  );

  const tabs = [
    ["school", "My School"], ["state", "My State"], ["national", "Nigeria"], ["states", "States"], ["schools", "Schools"],
  ];
  container.appendChild(
    h("div", { class: "tabs" },
      tabs.map(([key, label]) =>
        h("button", {
          class: "tab" + (tab === key ? " active" : ""),
          onclick: () => { tab = key; emit("ui:tap"); renderBoard(container); },
        }, label)
      )
    )
  );

  const all = players();
  const list = h("ol", { class: "lb-list" });
  let rows = [];
  if (tab === "school") {
    rows = mine ? all.filter((p) => schoolKey(p.school) === schoolKey(mine.school)).slice(0, 50).map((p, i) => playerRow(p, i, mine.pid)) : [];
  } else if (tab === "state") {
    rows = mine ? all.filter((p) => p.state === mine.state).slice(0, 50).map((p, i) => playerRow(p, i, mine.pid)) : [];
  } else if (tab === "national") {
    rows = all.slice(0, 100).map((p, i) => playerRow(p, i, mine?.pid));
  } else if (tab === "states") {
    rows = aggregate((p) => p.state, (p) => p.state).map((g, i) =>
      groupRow(g, i, mine?.state, (x) => `${x.count} player${x.count === 1 ? "" : "s"}`));
  } else {
    rows = aggregate((p) => schoolKey(p.school), (p) => p.school).slice(0, 50).map((g, i) =>
      groupRow(g, i, mine ? schoolKey(mine.school) : null, (x) => `${x.state} · ${x.count} player${x.count === 1 ? "" : "s"}`));
  }
  if (!rows.length) list.appendChild(h("li", { class: "lb-empty muted" }, mine ? "No players here yet — be the first!" : "Create a profile to see this board."));
  rows.forEach((r) => list.appendChild(r));
  container.appendChild(h("div", { class: "card" }, list));
}

function screen(container) {
  renderBoard(container);
  refresh().then(() => container.isConnected && renderBoard(container));
  scheduleSync();
}

export function init() {
  provide("screen:leaderboard", screen);
  answer("titles", titles);
  on("xp:changed", scheduleSync);
  on("profile:changed", scheduleSync);
  // "Delete my data": remove this player from the server board too.
  on("data:delete", ({ id } = {}) => {
    clearTimeout(syncTimer);
    if (id) deleteScore(id).catch(() => {});
    myPid = null;
    board = { players: [], fetchedAt: 0, online: board.online };
    save("board-pid", null);
    save("board-cache", board);
  });
  refresh();
}
