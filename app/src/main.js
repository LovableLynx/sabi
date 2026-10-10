// Sabi Arena: app shell.
//
// Each feature is loaded with its own dynamic import inside try/catch, so a
// feature that fails to load (or throws while starting) is simply missing;
// the shell and every other feature keep working. Features never import
// each other, they talk through core/bus.js.

import { ask, emit, lookup, on } from "./core/bus.js";
import { h, clear } from "./core/dom.js";
import { load, save } from "./core/storage.js";
import { loadVocab } from "./core/validate.js";

const FEATURES = ["progress", "sound", "profile", "leaderboard", "path", "lesson", "freechat", "mascot", "feedback"];
const NAV = [
  { screen: "learn", icon: "🚌", label: "Route" },
  { screen: "chat", icon: "💬", label: "Ask Sabi" },
  { screen: "leaderboard", icon: "🏆", label: "Ranks" },
  { screen: "profile", icon: "👤", label: "Me" },
];

const app = document.getElementById("app");
const topbar = h("header", { class: "topbar" });
const screenEl = h("main", { class: "screen" });
const nav = h("nav", { class: "bottom-nav" });
const toasts = h("div", { class: "toasts", "aria-live": "polite" });
const mascotSlot = h("div", { class: "mascot-slot" });
app.append(topbar, screenEl, nav, toasts, mascotSlot);

const loaded = new Set();
let current = { screen: "learn", params: {} };

// Fuel: shows a countdown when not full, and explains itself when tapped.
function fuelChip(stats) {
  const full = stats.hearts >= stats.maxHearts;
  const mins = Math.max(1, Math.ceil(stats.nextHeartIn / 60000));
  const every = stats.refillMinutes || 20;
  const explain = full
    ? `⛽ Fuel: your tank is full (${stats.maxHearts} of ${stats.maxHearts}). Missing a task twice uses 1 fuel. Used fuel comes back on its own, 1 every ${every} minutes.`
    : `⛽ Fuel: ${stats.hearts} of ${stats.maxHearts}. 1 fuel comes back every ${every} minutes (next in about ${mins} min). Replaying a stop you've finished also gives 1 back.`;
  return h("button", {
    class: "chip chip-btn fuel" + (stats.hearts === 0 ? " empty" : ""),
    title: explain,
    "aria-label": explain,
    onclick: () => emit("toast", { text: explain, kind: "info" }),
  }, `⛽ ${stats.hearts}`, full ? null : h("span", { class: "fuel-timer" }, ` · ${mins}m`));
}

// Keep the fuel countdown fresh while the tank is refilling.
setInterval(() => {
  const st = ask("stats", null, null);
  if (st && st.hearts < st.maxHearts) paintTopbar();
}, 30 * 1000);

function paintTopbar() {
  clear(topbar);
  topbar.appendChild(h("div", { class: "brand" }, h("span", { class: "brand-mark" }, "S"), h("span", {}, "Sabi Arena")));
  const stats = ask("stats", null, null);
  const chips = h("div", { class: "chips" });
  if (stats) {
    chips.append(
      h("button", {
        class: "chip chip-btn streak" + (stats.streak > 0 ? " on" : ""),
        title: "Day streak: finish a lesson every day to keep it",
        "aria-label": `${stats.streak} day streak`,
        onclick: () => emit("nav", { screen: "profile" }),
      }, `🔥 ${stats.streak} ${stats.streak === 1 ? "day" : "days"}`),
      fuelChip(stats),
      h("span", { class: "chip", title: `${stats.rank.name} · ${stats.xp} XP` }, `${stats.rank.icon} ${stats.xp}`)
    );
  }
  const muted = ask("muted", null, null);
  if (muted !== null) {
    chips.appendChild(
      h("button", { class: "chip chip-btn", "aria-label": muted ? "Turn sound on" : "Turn sound off", onclick: () => emit("sound:toggle") }, muted ? "🔇" : "🔊")
    );
  }
  topbar.appendChild(chips);
}

function paintNav() {
  clear(nav);
  for (const item of NAV) {
    nav.appendChild(
      h("button", {
        class: "nav-item" + (current.screen === item.screen || (item.screen === "learn" && current.screen === "lesson") ? " active" : ""),
        onclick: () => { emit("ui:tap"); emit("nav", { screen: item.screen }); },
      }, h("span", { class: "nav-icon" }, item.icon), h("span", {}, item.label))
    );
  }
}

function showScreen({ screen, params = {} }) {
  current = { screen, params };
  document.body.dataset.screen = screen; // lets CSS adjust per screen (e.g. hide the mascot on forms)
  clear(screenEl);
  window.scrollTo(0, 0);
  const render = lookup("screen:" + screen);
  try {
    if (typeof render !== "function") throw new Error(`the "${screen}" part of Sabi didn't load`);
    render(screenEl, params);
  } catch (err) {
    console.error("[sabi] screen failed:", screen, err);
    clear(screenEl).appendChild(
      h("div", { class: "card center" },
        h("h2", {}, "This part of Sabi hit a problem"),
        h("p", { class: "muted" }, err.message),
        h("p", { class: "muted" }, "Everything else still works."),
        screen !== "learn" ? h("button", { class: "btn btn-primary", onclick: () => emit("nav", { screen: "learn" }) }, "Go to lessons") : null
      )
    );
  }
  paintNav();
  paintTopbar();
}

function toast(text, kind = "info") {
  const el = h("div", { class: "toast " + kind }, text);
  toasts.appendChild(el);
  setTimeout(() => el.classList.add("leaving"), 2600);
  setTimeout(() => el.remove(), 3100);
}

async function start() {
  loadVocab(); // for the gibberish check; the app works without it
  for (const name of FEATURES) {
    try {
      const mod = await import(`./features/${name}.js`);
      mod.init?.(name === "mascot" ? mascotSlot : undefined);
      loaded.add(name);
    } catch (err) {
      console.error(`[sabi] feature "${name}" failed to load:`, err);
    }
  }
  document.documentElement.dataset.features = [...loaded].join(" ");

  on("nav", showScreen);
  on("toast", ({ text, kind } = {}) => text && toast(text, kind));
  on("badge:earned", (b) => b && toast(`${b.icon} Badge unlocked: ${b.name}`, "good"));
  on("rank:up", (r) => r && toast(`${r.icon} New rank: ${r.name}!`, "good"));
  on("streak:changed", (n) => n && toast(n === 1
    ? "🔥 Streak started! Finish a lesson tomorrow to make it 2 days."
    : `🔥 ${n}-day streak! No dulling, come back tomorrow.`, "good"));
  for (const evt of ["xp:changed", "hearts:changed", "streak:changed", "sound:changed", "profile:changed"]) {
    on(evt, paintTopbar);
  }

  let first = "learn";
  if (!ask("profile", null, null) && !load("seenOnboarding", false) && loaded.has("profile")) {
    save("seenOnboarding", true);
    first = "onboarding";
  }
  showScreen({ screen: first });
}

start();
