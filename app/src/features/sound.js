// Sound effects synthesised with Web Audio (no audio files to download).
// Listens for game events; if audio is unsupported or muted it does nothing.

import { answer, emit, on } from "../core/bus.js";
import { load, save } from "../core/storage.js";

let muted = load("muted", false);
let ctx = null;

function audio() {
  if (muted) return null;
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

// notes: [[frequencyHz, startSec, durationSec], ...]
function play(notes, type = "sine", volume = 0.18) {
  const ac = audio();
  if (!ac) return;
  const now = ac.currentTime;
  for (const [freq, start, dur] of notes) {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, now + start);
    gain.gain.linearRampToValueAtTime(volume, now + start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + start + dur);
    osc.connect(gain).connect(ac.destination);
    osc.start(now + start);
    osc.stop(now + start + dur + 0.02);
  }
}

const SOUNDS = {
  tap: () => play([[660, 0, 0.05]], "triangle", 0.08),
  correct: () => play([[659, 0, 0.12], [880, 0.1, 0.22]], "triangle"),
  wrong: () => play([[220, 0, 0.18], [180, 0.12, 0.25]], "sawtooth", 0.1),
  badge: () => play([[784, 0, 0.12], [988, 0.1, 0.12], [1175, 0.2, 0.3]], "triangle"),
  rankup: () => play([[523, 0, 0.14], [659, 0.12, 0.14], [784, 0.24, 0.14], [1047, 0.36, 0.45]], "square", 0.1),
};

export function init() {
  on("answer:correct", SOUNDS.correct);
  on("answer:wrong", SOUNDS.wrong);
  on("badge:earned", SOUNDS.badge);
  on("rank:up", SOUNDS.rankup);
  on("ui:tap", SOUNDS.tap);

  answer("muted", () => muted);
  on("sound:toggle", () => {
    muted = !muted;
    save("muted", muted);
    emit("sound:changed", muted);
    if (!muted) SOUNDS.tap();
  });
}
