// Sound effects synthesised with Web Audio (no audio files to download).
// Listens for game events; if audio is unsupported or muted it does nothing.

import { answer, emit, on } from "../core/bus.js";
import { load, save } from "../core/storage.js";

let muted = load("muted", false);
let ctx = null;

// Track active voice nodes to guarantee zero overlapping audio on rapid clicks
let activeNodes = [];

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

export function stopActiveSound() {
  if (activeNodes.length > 0) {
    for (const node of activeNodes) {
      try {
        if (node.stop) node.stop();
        if (node.disconnect) node.disconnect();
      } catch {}
    }
    activeNodes = [];
  }
}

function registerNode(node) {
  activeNodes.push(node);
  return node;
}

// Generate procedurally synthesised white noise buffer for breath/snarl textures
function getNoiseBuffer(ac, durationSec = 1.0) {
  const bufferSize = Math.max(256, Math.floor(ac.sampleRate * durationSec));
  const buffer = ac.createBuffer(1, bufferSize, ac.sampleRate);
  const output = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    output[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

// notes: [[frequencyHz, startSec, durationSec], ...]
function play(notes, type = "sine", volume = 0.18) {
  const ac = audio();
  if (!ac) return;
  stopActiveSound();
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
    registerNode(osc);
    osc.start(now + start);
    osc.stop(now + start + dur + 0.02);
  }
}

// ==========================================
// UNIQUE ANIMAL SYNTHESIZERS (ZERO OVERLAP)
// ==========================================
const ANIMAL_SYNTHS = {
  // 🦁 Lion: Authentic guttural roar with FM sub-bass, resonant chest sweep & throat noise
  lion: (ac) => {
    stopActiveSound();
    const now = ac.currentTime;
    const osc = registerNode(ac.createOscillator());
    const sub = registerNode(ac.createOscillator());
    const filter = registerNode(ac.createBiquadFilter());
    const gain = registerNode(ac.createGain());
    const lfo = registerNode(ac.createOscillator());
    const lfoGain = registerNode(ac.createGain());

    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(115, now);
    osc.frequency.exponentialRampToValueAtTime(46, now + 1.0);

    sub.type = "triangle";
    sub.frequency.setValueAtTime(60, now);
    sub.frequency.exponentialRampToValueAtTime(32, now + 1.0);

    lfo.type = "sine";
    lfo.frequency.setValueAtTime(22, now);
    lfoGain.gain.setValueAtTime(28, now);
    lfo.connect(lfoGain).connect(osc.frequency);

    filter.type = "lowpass";
    filter.frequency.setValueAtTime(620, now);
    filter.frequency.exponentialRampToValueAtTime(190, now + 1.0);
    filter.Q.value = 3.5;

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.28, now + 0.15);
    gain.gain.setValueAtTime(0.24, now + 0.65);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 1.15);

    osc.connect(filter);
    sub.connect(filter);
    filter.connect(gain).connect(ac.destination);

    const noiseSource = registerNode(ac.createBufferSource());
    noiseSource.buffer = getNoiseBuffer(ac, 1.2);
    const noiseFilter = registerNode(ac.createBiquadFilter());
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.setValueAtTime(340, now);
    noiseFilter.Q.value = 2.0;
    const noiseGain = registerNode(ac.createGain());
    noiseGain.gain.setValueAtTime(0.001, now);
    noiseGain.gain.linearRampToValueAtTime(0.12, now + 0.2);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 1.1);

    noiseSource.connect(noiseFilter).connect(noiseGain).connect(ac.destination);

    lfo.start(now);
    lfo.stop(now + 1.2);
    osc.start(now);
    osc.stop(now + 1.2);
    sub.start(now);
    sub.stop(now + 1.2);
    noiseSource.start(now);
    noiseSource.stop(now + 1.2);
  },

  // 🐢 Tortoise / Hijapa: Woody shell percussion tap followed by gentle inquisitive squeak
  tortoise: (ac) => {
    stopActiveSound();
    const now = ac.currentTime;
    // 1. Shell tap (woody pop)
    const tap = registerNode(ac.createOscillator());
    const tapGain = registerNode(ac.createGain());
    tap.type = "sine";
    tap.frequency.setValueAtTime(780, now);
    tap.frequency.exponentialRampToValueAtTime(280, now + 0.04);
    tapGain.gain.setValueAtTime(0.22, now);
    tapGain.gain.exponentialRampToValueAtTime(0.001, now + 0.045);
    tap.connect(tapGain).connect(ac.destination);
    tap.start(now);
    tap.stop(now + 0.05);

    // 2. Inquisitive squeak
    const squeak = registerNode(ac.createOscillator());
    const squeakGain = registerNode(ac.createGain());
    squeak.type = "triangle";
    squeak.frequency.setValueAtTime(460, now + 0.06);
    squeak.frequency.linearRampToValueAtTime(620, now + 0.22);
    squeak.frequency.exponentialRampToValueAtTime(380, now + 0.42);

    squeakGain.gain.setValueAtTime(0.001, now);
    squeakGain.gain.setValueAtTime(0.001, now + 0.06);
    squeakGain.gain.linearRampToValueAtTime(0.19, now + 0.16);
    squeakGain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

    squeak.connect(squeakGain).connect(ac.destination);
    squeak.start(now + 0.06);
    squeak.stop(now + 0.46);
  },

  // 🦅 Eagle: Piercing high-pitch raptor screech
  eagle: (ac) => {
    stopActiveSound();
    const now = ac.currentTime;
    const osc = registerNode(ac.createOscillator());
    const gain = registerNode(ac.createGain());
    const lfo = registerNode(ac.createOscillator());
    const lfoGain = registerNode(ac.createGain());

    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(2150, now);
    osc.frequency.linearRampToValueAtTime(2950, now + 0.18);
    osc.frequency.exponentialRampToValueAtTime(1380, now + 0.65);

    lfo.type = "sine";
    lfo.frequency.setValueAtTime(36, now);
    lfoGain.gain.setValueAtTime(160, now);
    lfo.connect(lfoGain).connect(osc.frequency);

    const filter = registerNode(ac.createBiquadFilter());
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(2400, now);
    filter.Q.value = 2.8;

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.24, now + 0.08);
    gain.gain.setValueAtTime(0.22, now + 0.35);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.65);

    osc.connect(filter).connect(gain).connect(ac.destination);
    lfo.start(now);
    lfo.stop(now + 0.68);
    osc.start(now);
    osc.stop(now + 0.68);
  },

  // 🐘 Elephant: Brassy trumpeting call with dual formant filter
  elephant: (ac) => {
    stopActiveSound();
    const now = ac.currentTime;
    const osc1 = registerNode(ac.createOscillator());
    const osc2 = registerNode(ac.createOscillator());
    const filter = registerNode(ac.createBiquadFilter());
    const gain = registerNode(ac.createGain());
    const tremolo = registerNode(ac.createOscillator());
    const tremoloGain = registerNode(ac.createGain());

    osc1.type = "sawtooth";
    osc1.frequency.setValueAtTime(160, now);
    osc1.frequency.linearRampToValueAtTime(300, now + 0.35);
    osc1.frequency.exponentialRampToValueAtTime(215, now + 0.85);

    osc2.type = "sawtooth";
    osc2.frequency.setValueAtTime(163, now);
    osc2.frequency.linearRampToValueAtTime(305, now + 0.35);
    osc2.frequency.exponentialRampToValueAtTime(218, now + 0.85);

    tremolo.type = "sine";
    tremolo.frequency.setValueAtTime(17, now);
    tremoloGain.gain.setValueAtTime(20, now);
    tremolo.connect(tremoloGain).connect(osc1.frequency);

    filter.type = "bandpass";
    filter.frequency.setValueAtTime(550, now);
    filter.frequency.linearRampToValueAtTime(950, now + 0.35);
    filter.frequency.exponentialRampToValueAtTime(620, now + 0.85);
    filter.Q.value = 3.6;

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.26, now + 0.12);
    gain.gain.setValueAtTime(0.22, now + 0.55);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.9);

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(gain).connect(ac.destination);

    tremolo.start(now);
    tremolo.stop(now + 0.92);
    osc1.start(now);
    osc1.stop(now + 0.92);
    osc2.start(now);
    osc2.stop(now + 0.92);
  },

  // 🦒 Giraffe / Siva: Savanna flute hum with harmonic warmth
  giraffe: (ac) => {
    stopActiveSound();
    const now = ac.currentTime;
    const osc1 = registerNode(ac.createOscillator());
    const osc2 = registerNode(ac.createOscillator());
    const filter = registerNode(ac.createBiquadFilter());
    const gain = registerNode(ac.createGain());

    osc1.type = "triangle";
    osc1.frequency.setValueAtTime(135, now);
    osc1.frequency.linearRampToValueAtTime(190, now + 0.3);
    osc1.frequency.exponentialRampToValueAtTime(125, now + 0.7);

    osc2.type = "sine";
    osc2.frequency.setValueAtTime(270, now);
    osc2.frequency.linearRampToValueAtTime(380, now + 0.3);
    osc2.frequency.exponentialRampToValueAtTime(250, now + 0.7);

    filter.type = "lowpass";
    filter.frequency.setValueAtTime(420, now);
    filter.frequency.linearRampToValueAtTime(560, now + 0.3);
    filter.frequency.exponentialRampToValueAtTime(320, now + 0.7);
    filter.Q.value = 2.0;

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.22, now + 0.15);
    gain.gain.setValueAtTime(0.18, now + 0.45);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.72);

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(gain).connect(ac.destination);

    osc1.start(now);
    osc1.stop(now + 0.75);
    osc2.start(now);
    osc2.stop(now + 0.75);
  },

  // 🐆 Leopard / Chiva: Fierce feline growl with AM vibration & snarl noise
  leopard: (ac) => {
    stopActiveSound();
    const now = ac.currentTime;
    const osc = registerNode(ac.createOscillator());
    const amOsc = registerNode(ac.createOscillator());
    const amGain = registerNode(ac.createGain());
    const gain = registerNode(ac.createGain());
    const filter = registerNode(ac.createBiquadFilter());

    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(195, now);
    osc.frequency.linearRampToValueAtTime(160, now + 0.4);
    osc.frequency.exponentialRampToValueAtTime(95, now + 0.75);

    amOsc.type = "sine";
    amOsc.frequency.setValueAtTime(42, now);
    amGain.gain.setValueAtTime(30, now);
    amOsc.connect(amGain).connect(osc.frequency);

    filter.type = "bandpass";
    filter.frequency.setValueAtTime(520, now);
    filter.frequency.exponentialRampToValueAtTime(280, now + 0.75);
    filter.Q.value = 2.5;

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.24, now + 0.08);
    gain.gain.setValueAtTime(0.20, now + 0.45);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.78);

    const noiseSource = registerNode(ac.createBufferSource());
    noiseSource.buffer = getNoiseBuffer(ac, 0.8);
    const noiseFilter = registerNode(ac.createBiquadFilter());
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.setValueAtTime(1100, now);
    noiseFilter.Q.value = 2.8;
    const noiseGain = registerNode(ac.createGain());
    noiseGain.gain.setValueAtTime(0.001, now);
    noiseGain.gain.linearRampToValueAtTime(0.11, now + 0.1);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.75);
    noiseSource.connect(noiseFilter).connect(noiseGain).connect(ac.destination);

    osc.connect(filter).connect(gain).connect(ac.destination);

    amOsc.start(now);
    amOsc.stop(now + 0.8);
    osc.start(now);
    osc.stop(now + 0.8);
    noiseSource.start(now);
    noiseSource.stop(now + 0.8);
  },

  // 🦜 Parrot: Bright dual-tone tropical squawk
  parrot: (ac) => {
    stopActiveSound();
    const now = ac.currentTime;
    const o1 = registerNode(ac.createOscillator());
    const g1 = registerNode(ac.createGain());
    o1.type = "triangle";
    o1.frequency.setValueAtTime(1450, now);
    o1.frequency.linearRampToValueAtTime(2150, now + 0.12);
    g1.gain.setValueAtTime(0.001, now);
    g1.gain.linearRampToValueAtTime(0.22, now + 0.03);
    g1.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
    o1.connect(g1).connect(ac.destination);
    o1.start(now);
    o1.stop(now + 0.15);

    const o2 = registerNode(ac.createOscillator());
    const g2 = registerNode(ac.createGain());
    o2.type = "square";
    o2.frequency.setValueAtTime(1620, now + 0.18);
    o2.frequency.linearRampToValueAtTime(2500, now + 0.28);
    o2.frequency.exponentialRampToValueAtTime(1750, now + 0.42);

    const f2 = registerNode(ac.createBiquadFilter());
    f2.type = "bandpass";
    f2.frequency.setValueAtTime(2200, now + 0.18);
    f2.Q.value = 2.0;

    g2.gain.setValueAtTime(0.001, now + 0.18);
    g2.gain.linearRampToValueAtTime(0.18, now + 0.22);
    g2.gain.exponentialRampToValueAtTime(0.001, now + 0.44);

    o2.connect(f2).connect(g2).connect(ac.destination);
    o2.start(now + 0.18);
    o2.stop(now + 0.46);
  },

  // 🐊 Crocodile: Low subterranean bellow with 14Hz flutter & swamp hiss
  crocodile: (ac) => {
    stopActiveSound();
    const now = ac.currentTime;
    const osc = registerNode(ac.createOscillator());
    const tremolo = registerNode(ac.createOscillator());
    const tremoloGain = registerNode(ac.createGain());
    const filter = registerNode(ac.createBiquadFilter());
    const gain = registerNode(ac.createGain());

    osc.type = "sine";
    osc.frequency.setValueAtTime(68, now);
    osc.frequency.exponentialRampToValueAtTime(36, now + 0.95);

    tremolo.type = "sine";
    tremolo.frequency.setValueAtTime(14, now);
    tremoloGain.gain.setValueAtTime(16, now);
    tremolo.connect(tremoloGain).connect(osc.frequency);

    filter.type = "lowpass";
    filter.frequency.setValueAtTime(190, now);
    filter.Q.value = 3.0;

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.28, now + 0.2);
    gain.gain.setValueAtTime(0.24, now + 0.65);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.98);

    osc.connect(filter).connect(gain).connect(ac.destination);

    const noise = registerNode(ac.createBufferSource());
    noise.buffer = getNoiseBuffer(ac, 1.0);
    const nFilter = registerNode(ac.createBiquadFilter());
    nFilter.type = "lowpass";
    nFilter.frequency.setValueAtTime(450, now);
    const nGain = registerNode(ac.createGain());
    nGain.gain.setValueAtTime(0.001, now);
    nGain.gain.linearRampToValueAtTime(0.08, now + 0.25);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.95);
    noise.connect(nFilter).connect(nGain).connect(ac.destination);

    tremolo.start(now);
    tremolo.stop(now + 1.0);
    osc.start(now);
    osc.stop(now + 1.0);
    noise.start(now);
    noise.stop(now + 1.0);
  },
};

const AVATAR_KEY_MAP = {
  "🐢": "tortoise", "tortoise": "tortoise", "turtle": "tortoise", "hijapa": "tortoise",
  "🦁": "lion", "lion": "lion",
  "🦅": "eagle", "eagle": "eagle",
  "🐘": "elephant", "elephant": "elephant",
  "🦒": "giraffe", "giraffe": "giraffe", "siva": "giraffe",
  "🐆": "leopard", "leopard": "leopard", "chiva": "leopard", "cheetah": "leopard",
  "🦜": "parrot", "parrot": "parrot",
  "🐊": "crocodile", "crocodile": "crocodile", "alligator": "crocodile",
};

export function playAnimalSound(avatarKey) {
  const ac = audio();
  if (!ac) return;
  const key = String(avatarKey || "").trim().toLowerCase();
  const animalName = AVATAR_KEY_MAP[avatarKey] || AVATAR_KEY_MAP[key] || "tortoise";
  const synth = ANIMAL_SYNTHS[animalName] || ANIMAL_SYNTHS.tortoise;
  synth(ac);
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

  // Avatar unique animal sound dispatcher
  on("avatar:sound", playAnimalSound);
  on("avatar:picked", playAnimalSound);

  answer("muted", () => muted);
  on("sound:toggle", () => {
    muted = !muted;
    save("muted", muted);
    emit("sound:changed", muted);
    if (!muted) SOUNDS.tap();
  });
}
