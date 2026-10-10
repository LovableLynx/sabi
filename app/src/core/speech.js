// Read Sabi's replies aloud with the device's built-in voice (Web Speech API).
// Free, works offline, sends nothing anywhere. Prefers a Nigerian English
// voice when the phone has one. If speech isn't supported, canSpeak() is false
// and the app simply hides the speaker buttons.

import { h } from "./dom.js";
import { load, save } from "./storage.js";

const synth = typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null;
let autoRead = load("autoRead", false);

export function canSpeak() {
  return !!synth;
}

export function isAutoRead() {
  return autoRead;
}

export function setAutoRead(on) {
  autoRead = !!on;
  save("autoRead", autoRead);
  if (!autoRead) stop();
}

function pickVoice() {
  const voices = synth.getVoices();
  const by = (test) => voices.find((v) => test(v.lang.toLowerCase().replace("_", "-")));
  return by((l) => l === "en-ng") || by((l) => l === "en-gb") || by((l) => l.startsWith("en")) || null;
}

// Make text sound natural: drop emoji, markdown and table pipes; say symbols.
function forSpeech(text) {
  return String(text)
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, "")
    .replace(/\|[-:\s|]+\|/g, " ")
    .replace(/\|/g, ", ")
    .replace(/\*\*|__|`/g, "")
    .replace(/(\d)\s*\^\s*(\d+)/g, "$1 to the power $2")
    .replace(/×/g, " times ").replace(/÷/g, " divided by ").replace(/−/g, " minus ")
    .replace(/m\/s\^2/g, "metres per second squared").replace(/m\/s/g, "metres per second")
    .replace(/₦\s?([\d,]+)/g, "$1 naira")
    .replace(/\s+/g, " ")
    .trim();
}

export function stop() {
  if (synth) synth.cancel();
}

export function speak(text, { onEnd } = {}) {
  if (!synth) return false;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(forSpeech(text));
  const voice = pickVoice();
  if (voice) u.voice = voice;
  u.lang = voice?.lang || "en-NG";
  u.rate = 0.95;
  if (onEnd) u.onend = u.onerror = onEnd;
  synth.speak(u);
  return true;
}

// A "🔊 Listen" button for one reply (tap again to stop). Null if unsupported.
export function speakerButton(text) {
  if (!canSpeak()) return null;
  return h("button", {
    class: "listen-btn", type: "button", "aria-label": "Read this reply aloud",
    onclick: (e) => {
      const btn = e.currentTarget;
      if (btn.classList.contains("playing")) { stop(); btn.classList.remove("playing"); return; }
      document.querySelectorAll(".listen-btn.playing").forEach((b) => b.classList.remove("playing"));
      btn.classList.add("playing");
      speak(text, { onEnd: () => btn.classList.remove("playing") });
    },
  }, "🔊 Listen");
}

// Some browsers load voices late; ask once so pickVoice() has them later.
if (synth) synth.getVoices();
