// Client for ml/serve/serve_sabi.py. Every call has a timeout and returns a
// rejected promise on failure; callers decide how to degrade.
//
// Served by serve_sabi.py, the API is same-origin. Elsewhere (e.g. GitHub
// Pages) pass ?api=https://your-tunnel-url, or run without it: the game then
// uses offline guided mode and an on-device leaderboard.

const params = new URLSearchParams(location.search);

// Only our own servers may be used: the demo's Cloudflare tunnel or this
// machine. Otherwise a crafted link (?api=https://evil.example) could feed
// students fake tutor replies or collect what they type.
function trustedApi(raw) {
  if (!raw) return "";
  try {
    const url = new URL(raw);
    const local = ["localhost", "127.0.0.1"].includes(url.hostname);
    const tunnel = url.protocol === "https:" && url.hostname.endsWith(".trycloudflare.com");
    if (local || tunnel) return url.origin;
  } catch {
    /* not a URL */
  }
  console.warn("[sabi] ignoring untrusted ?api= value:", raw);
  return "";
}

export const API_BASE = trustedApi(params.get("api"));
// Static hosts (Vercel, GitHub Pages) have no Sabi server; skip API calls
// unless a trusted ?api= tunnel was given.
const STATIC_HOST = /(\.vercel\.app|\.github\.io)$/.test(location.hostname) && !API_BASE;

async function request(path, { method = "GET", body, timeout = 8000 } = {}) {
  if (STATIC_HOST) throw new Error("no server on a static host");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(API_BASE + path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `server returned ${res.status}`);
    return data;
  } catch (err) {
    throw new Error(err.name === "AbortError" ? "the server took too long to reply" : err.message);
  } finally {
    clearTimeout(timer);
  }
}

let healthPromise = null;

// Resolves to { tutor: "model" | "mock" | "offline", leaderboard: bool }.
export function health() {
  if (!healthPromise) {
    healthPromise = request("/api/health", { timeout: 5000 })
      .then((d) => ({ tutor: d.mode === "mock" ? "mock" : "model", leaderboard: !!d.leaderboard, feedback: !!d.feedback, model: d.model || "" }))
      .catch(() => ({ tutor: "offline", leaderboard: false, feedback: false, model: "" }));
  }
  return healthPromise;
}

export function chat(messages, model = "sabi") {
  // Generation on a T4 takes 10-40 s; give it room.
  return request("/api/chat", { method: "POST", body: { messages, model }, timeout: 120000 });
}

export function submitScore(entry) {
  return request("/api/score", { method: "POST", body: entry });
}

export function fetchLeaderboard() {
  return request("/api/leaderboard");
}

export function deleteScore(id) {
  return request("/api/delete", { method: "POST", body: { id } });
}

export function sendFeedback(row) {
  return request("/api/feedback", { method: "POST", body: row });
}
