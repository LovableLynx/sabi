// Client for ml/serve/serve_sabi.py. Every call has a timeout and returns a
// rejected promise on failure; callers decide how to degrade.
//
// Where requests go, in order of preference:
//   1. ?api=https://xxxx.trycloudflare.com  (Kaggle live demo: one server does everything)
//   2. AI_URL / API_URL in config.js        (always-on Modal services)
//   3. same origin                          (served by serve_sabi.py locally)
// On a static host (Vercel) with none of these, the game runs offline:
// guided hints in lessons and an on-device leaderboard.

import { AI_URL, API_URL } from "./config.js";

const params = new URLSearchParams(location.search);

// Only our own servers may be used: a Cloudflare demo tunnel, our Modal
// services, or this machine. Otherwise a crafted link (?api=https://evil.example)
// could feed students fake tutor replies or collect what they type.
function trusted(raw) {
  if (!raw) return "";
  try {
    const url = new URL(raw);
    const local = ["localhost", "127.0.0.1"].includes(url.hostname);
    const https = url.protocol === "https:";
    const ours = https && (url.hostname.endsWith(".trycloudflare.com") || url.hostname.endsWith(".modal.run"));
    if (local || ours) return url.origin;
  } catch {
    /* not a URL */
  }
  console.warn("[sabi] ignoring untrusted server address:", raw);
  return "";
}

const TUNNEL = trusted(params.get("api"));
const STATIC_HOST = /(\.vercel\.app|\.github\.io)$/.test(location.hostname);
const DATA_BASE = TUNNEL || trusted(API_URL) || (STATIC_HOST ? null : "");
const AI_BASE = TUNNEL || trusted(AI_URL) || (STATIC_HOST ? null : "");
export const API_BASE = DATA_BASE || "";

async function request(base, path, { method = "GET", body, timeout = 8000 } = {}) {
  if (base === null) throw new Error("no server on a static host");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(base + path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `server returned ${res.status}`);
      err.waking = !!data.waking || res.status === 503;
      throw err;
    }
    return data;
  } catch (err) {
    if (err.waking) throw err;
    throw new Error(err.name === "AbortError" ? "the server took too long to reply" : err.message);
  } finally {
    clearTimeout(timer);
  }
}

let healthPromise = null;

// Resolves to { tutor: "model" | "mock" | "offline", leaderboard, feedback }.
// Only the cheap data service is checked, never the GPU: with a separate AI
// service configured we report the tutor as available and let the first chat
// wake it up.
export function health() {
  if (!healthPromise) {
    healthPromise = request(DATA_BASE, "/api/health", { timeout: 8000 })
      .then((d) => {
        let tutor = d.mode === "mock" ? "mock" : "model";
        if (d.mode === "none") tutor = AI_BASE ? "model" : "offline";
        return { tutor, leaderboard: !!d.leaderboard, feedback: !!d.feedback, model: d.model || "" };
      })
      .catch(() => ({ tutor: AI_BASE && AI_BASE !== DATA_BASE ? "model" : "offline", leaderboard: false, feedback: false, model: "" }));
  }
  return healthPromise;
}

// Chat with the tutor. If the GPU is waking from sleep (503), wait and retry
// for up to ~3 minutes, calling onWaking() so the UI can say so.
export async function chat(messages, model = "sabi", { onWaking } = {}) {
  const started = Date.now();
  for (;;) {
    try {
      // Generation on a T4/L4 takes 10-40 s; a cold start can add a minute.
      return await request(AI_BASE, "/api/chat", { method: "POST", body: { messages, model }, timeout: 150000 });
    } catch (err) {
      if (!err.waking || Date.now() - started > 180000) throw err;
      if (onWaking) onWaking();
      await new Promise((r) => setTimeout(r, 12000));
    }
  }
}

export function submitScore(entry) {
  return request(DATA_BASE, "/api/score", { method: "POST", body: entry });
}

export function fetchLeaderboard() {
  return request(DATA_BASE, "/api/leaderboard");
}

export function deleteScore(id) {
  return request(DATA_BASE, "/api/delete", { method: "POST", body: { id } });
}

export function sendFeedback(row) {
  return request(DATA_BASE, "/api/feedback", { method: "POST", body: row });
}
