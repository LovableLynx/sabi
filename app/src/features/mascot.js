// Ijapa the tortoise, the clever trickster of Yoruba folktales, cheers the
// student on. Renders into its own slot and reacts to game events. If it
// fails, the game simply has no mascot.

import { on } from "../core/bus.js";
import { h } from "../core/dom.js";

export const IJAPA_SVG = `
<svg viewBox="0 0 120 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <ellipse cx="60" cy="88" rx="40" ry="6" fill="rgba(0,0,0,0.12)"/>
  <ellipse cx="28" cy="78" rx="9" ry="7" fill="#7cb342"/>
  <ellipse cx="88" cy="78" rx="9" ry="7" fill="#7cb342"/>
  <path d="M96 60 q20 -6 18 -22 q-2 -12 -14 -10 q-10 2 -10 14 z" fill="#8bc34a"/>
  <circle cx="106" cy="38" r="3.6" fill="#1b1b1b"/>
  <circle cx="107.2" cy="36.8" r="1.2" fill="#fff"/>
  <path d="M100 48 q5 4 10 1" stroke="#1b1b1b" stroke-width="2" fill="none" stroke-linecap="round"/>
  <path d="M100 24 q8 -12 18 -2 q-2 6 -18 4 z" fill="#008751"/>
  <path d="M14 66 q0 -44 46 -44 q46 0 46 44 z" fill="#008751"/>
  <path d="M14 66 q46 10 92 0" stroke="#005c37" stroke-width="3" fill="none"/>
  <polygon points="60,30 74,38 74,52 60,60 46,52 46,38" fill="#f4b400" opacity="0.9"/>
  <polygon points="32,44 42,48 42,58 32,62 24,58 24,48" fill="#ffffff" opacity="0.85"/>
  <polygon points="88,44 96,48 96,58 88,62 78,58 78,48" fill="#ffffff" opacity="0.85"/>
</svg>`;

const LINES = {
  idle: ["Oya, let's learn something!", "Small small, you go sabi am.", "Which one we dey do today?"],
  correct: ["You don sabi! 🎉", "Correct! Na you be the main character.", "Ehen! See as you reason am!"],
  wrong: ["E no easy, try again!", "No wahala, think am well.", "Almost! Look the options again."],
  badge: ["New badge! You dey try!", "Badge unlocked! 🏅"],
  rankup: ["You don level up! 🚀", "New rank! Them go hear am for your street!"],
};

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

let slot = null;
let timer = null;

function say(mood, text) {
  if (!slot) return;
  slot.className = "mascot mood-" + mood;
  slot.querySelector(".mascot-bubble").textContent = text || pick(LINES[mood] || LINES.idle);
  slot.classList.add("talking");
  clearTimeout(timer);
  timer = setTimeout(() => slot && slot.classList.remove("talking"), 3500);
}

export function init(container) {
  slot = h("div", { class: "mascot" },
    h("div", { class: "mascot-bubble" }, pick(LINES.idle)),
    h("div", { class: "mascot-body", html: IJAPA_SVG })
  );
  container.appendChild(slot);
  // Taps pass straight through Ijapa (pointer-events: none) so it never blocks a button.

  on("answer:correct", () => say("correct"));
  on("answer:wrong", () => say("wrong"));
  on("badge:earned", (b) => say("badge", b ? `${b.icon} ${b.name}!` : undefined));
  on("rank:up", (r) => say("rankup", r ? `${r.icon} You don reach ${r.name}!` : undefined));
  on("mascot:say", ({ mood, text } = {}) => say(mood || "idle", text));
}
