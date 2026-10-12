// Per-device storage that never throws. Uses localStorage when the browser
// allows it, and silently falls back to memory (private windows, blocked
// site data) so every feature keeps working for the session.

const memory = new Map();
let persistent = true;

try {
  const probe = "__sabi_probe__";
  localStorage.setItem(probe, "1");
  localStorage.removeItem(probe);
} catch {
  persistent = false;
}

export function isPersistent() {
  return persistent;
}

export function load(key, fallback) {
  try {
    const raw = persistent ? localStorage.getItem("sabi:" + key) : memory.get(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  const raw = JSON.stringify(value);
  try {
    if (persistent) localStorage.setItem("sabi:" + key, raw);
    else memory.set(key, raw);
  } catch {
    memory.set(key, raw);
  }
}

// Remove every Sabi key from this device ("Delete my data"). Features that are
// still running keep their in-memory state until they react to data:delete.
export function clearAll() {
  memory.clear();
  try {
    if (persistent) {
      Object.keys(localStorage).filter((k) => k.startsWith("sabi:")).forEach((k) => localStorage.removeItem(k));
    }
  } catch {
    /* storage blocked: nothing saved to clear */
  }
}
