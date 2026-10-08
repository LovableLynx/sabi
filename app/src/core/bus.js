// Tiny event bus. Features never import each other; they announce things
// ("lesson:complete") and listen for things ("xp:changed"). A listener that
// throws is logged and skipped, so one broken feature can't stop the others.

const listeners = new Map();

export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => listeners.get(event).delete(fn);
}

export function emit(event, payload) {
  for (const fn of listeners.get(event) || []) {
    try {
      fn(payload);
    } catch (err) {
      console.error(`[sabi] listener for "${event}" failed:`, err);
    }
  }
}

// Ask a question any feature may answer (first answer wins). Returns the
// fallback when no feature is listening, e.g. hearts when progress is broken.
const askers = new Map();

export function answer(question, fn) {
  askers.set(question, fn);
}

export function ask(question, payload, fallback) {
  const fn = askers.get(question);
  if (!fn) return fallback;
  try {
    const result = fn(payload);
    return result === undefined ? fallback : result;
  } catch (err) {
    console.error(`[sabi] answer to "${question}" failed:`, err);
    return fallback;
  }
}

// Register a value (e.g. a screen's render function) for others to look up
// without calling it. lookup() returns undefined if nothing was provided.
const provided = new Map();

export function provide(key, value) {
  provided.set(key, value);
}

export function lookup(key) {
  return provided.get(key);
}
