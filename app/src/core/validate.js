// Input checks shared by every text box in the app: names, school, chat,
// feedback comments. The server (ml/serve/serve_sabi.py) runs the same rules,
// so they can't be skipped by editing the page; this copy just gives students
// instant, friendly feedback. Keep the two word lists in sync.

// Matched anywhere, even inside other words or with tricks like "f*ck", "sh1t".
// Used for every input, including chat.
const BLOCK_ANYWHERE = [
  "fuck", "fuk", "shit", "bitch", "pussy", "cunt", "nigger", "nigga", "asshole", "motherf",
  "whore", "slut", "porn", "dickhead", "ashawo", "ashewo", "oloshi", "olosho",
];
// Real Nigerian names that contain a blocked string ("Shittu", "Shitta").
const ALLOW_TOKENS = ["shittu", "shitta", "scunthorpe"];
// Whole words only, and only for names/schools (strict mode). Not used for
// chat, because some are school vocabulary: King Lear's "Fool", Edmund the
// "bastard", "sex" chromosomes in Biology. "Yeye", "Ode", "were", "ofe" are
// left out on purpose: they're Yoruba titles/surnames, English or Igbo words.
const NAME_ONLY_WORDS = [
  "dick", "ass", "sex", "sexy", "nude", "nudes", "boobs", "damn", "idiot", "stupid", "fool", "bastard",
  "mumu", "olodo", "werey", "mugu", "shege", "dan iska", "onye ara",
];
const IMPERSONATE = ["admin", "moderator", "nitda", "ncair", "teacher", "official"];

const LEET = { 0: "o", 1: "i", 3: "e", 4: "a", 5: "s", 7: "t", "@": "a", $: "s", "!": "i", "|": "i" };

// Lowercase, drop accents, undo leetspeak, squeeze repeated letters
// ("fuuuuck" -> "fuck"), keep letters and single spaces.
export function normalize(text) {
  return String(text)
    .toLowerCase()
    .normalize("NFKD").replace(/\p{M}/gu, "")
    .replace(/[013457@$!|]/g, (c) => LEET[c])
    .replace(/[^a-z ]+/g, "")
    .replace(/(.)\1{2,}/g, "$1$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function isOffensive(text, { strict = false } = {}) {
  let words = normalize(text);
  for (const ok of ALLOW_TOKENS) words = words.split(ok).join(" ");
  const squashed = words.replace(/ /g, "");
  const squashedSingle = squashed.replace(/(.)\1+/g, "$1"); // "fuuck"/"fuck" both -> "fuck"
  if (BLOCK_ANYWHERE.some((w) => squashed.includes(w) || squashedSingle.includes(w))) return true;
  if (!strict) return false;
  const padded = ` ${words} `;
  return NAME_ONLY_WORDS.some((w) => padded.includes(` ${w} `));
}

const KEYBOARD_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];
function keyboardRun(word) {
  return word.length >= 4 && KEYBOARD_ROWS.some((r) => r.includes(word) || [...r].reverse().join("").includes(word));
}
function wordLooksReal(w) {
  if (w.length <= 3) return true;
  if (keyboardRun(w)) return false;
  if (!/[aeiouy]/.test(w)) return false;          // "bcdfg"
  if (/[^aeiouy]{5,}/.test(w)) return false;      // "jhdjhsd"
  if (/(.)\1\1/.test(w)) return false;            // "aaaa"
  return true;
}

// Vocabulary built from Sabi's own lessons and dialogues (content/vocab.json).
// Loaded once in the background; until it arrives, the letter-pattern check
// below is used on its own.
let VOCAB = null;
export function loadVocab() {
  if (VOCAB || typeof fetch !== "function") return Promise.resolve(VOCAB);
  return fetch("content/vocab.json")
    .then((r) => (r.ok ? r.json() : []))
    .then((list) => (VOCAB = new Set(list)))
    .catch(() => null);
}
export function setVocab(list) {
  VOCAB = new Set(list);
}

const ALPHABET = "abcdefghijklmnopqrstuvwxyz";
// Known word, or one typo away from one ("physic" -> "physics", "anwser" -> "answer").
function known(w) {
  if (VOCAB.has(w)) return true;
  if (w.length < 4) return false;
  for (let i = 0; i <= w.length; i++) {
    if (i < w.length && VOCAB.has(w.slice(0, i) + w.slice(i + 1))) return true;                      // extra letter
    if (i < w.length - 1 && VOCAB.has(w.slice(0, i) + w[i + 1] + w[i] + w.slice(i + 2))) return true; // swapped
    for (const c of ALPHABET) {
      if (i < w.length && VOCAB.has(w.slice(0, i) + c + w.slice(i + 1))) return true;                // wrong letter
      if (VOCAB.has(w.slice(0, i) + c + w.slice(i))) return true;                                    // missing letter
    }
  }
  return false;
}

// True for keyboard mashing, made-up strings and symbol-only messages.
// useVocab: false for proper nouns (school names), where unknown words are normal.
export function isGibberish(text, { useVocab = true } = {}) {
  const raw = String(text);
  const words = raw.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").match(/[a-z]+/g) || [];
  if (!words.length) return !/\d/.test(raw); // only symbols/emoji, no letters or numbers
  if (/\d/.test(raw) && words.every((w) => w.length <= 3)) return false; // "20 m/s", "v = u + a*t"
  const real = words.filter((w) => wordLooksReal(w) && (!useVocab || !VOCAB || w.length <= 2 || known(w)));
  return real.length / words.length < 0.5;
}

// --- Field checks: return an error message, or null when OK. ---

const NAME_RE = /^[\p{L}][\p{L}\p{M}' -]*$/u;

export function checkName(value, label) {
  const v = String(value).trim();
  if (v.length < 2) return `Type your ${label} (at least 2 letters).`;
  if (!NAME_RE.test(v)) return `Your ${label} can only have letters, spaces, hyphens or apostrophes.`;
  // Check before normalize(), which shortens "aaaa" to "aa" and would let it through.
  if (/(\p{L})\1\1/iu.test(v)) return `That doesn't look like a real ${label}. Please check it.`;
  if (isOffensive(v, { strict: true })) return "Please use your real name, nicely.";
  if (IMPERSONATE.includes(normalize(v))) return `"${v}" can't be used as a name.`;
  const words = normalize(v).split(" ").filter(Boolean);
  if (!words.length || !words.every(wordLooksReal)) return `That doesn't look like a real ${label}. Please check it.`;
  return null;
}

const SCHOOL_RE = /^[\p{L}\p{M}0-9 .,'&()\/-]+$/u;

export function checkSchool(value) {
  const v = String(value).trim();
  if (v.length < 3) return "Type your school's name.";
  if (!SCHOOL_RE.test(v)) return "School names can only use letters, numbers and . , ' & ( ) / -";
  if ((v.match(/\p{L}/gu) || []).length < 3) return "Type your school's name in words.";
  if (/https?:|www\.|@/.test(v.toLowerCase())) return "Links and @handles aren't allowed.";
  if ((v.match(/\d/g) || []).length >= 7) return "Phone numbers aren't allowed.";
  if (isOffensive(v, { strict: true })) return "Please type your school's real name.";
  if (isGibberish(v, { useVocab: false })) return "That doesn't look like a real school name. Please check it.";
  return null;
}

// Chat: returns { block: "offensive" | "gibberish" | null }.
// "ahhh", "I don't understand", "abeg help": a stuck student, not gibberish.
// Mirrors STUCK in ml/serve/arith_coach.py.
const STUCK = /^(a+h+|u+g+h+|h+m+|e+h+|o+h+|c+h+a+i+|h+a+b+a+|w+a+h+a+l+a+|kai+|e+y+a+h*|i ?(don'?t|dont|do not|no) (know|understand|get( it)?|sabi)|idk|dunno|i'?m (lost|stuck|confused)|confused|stuck|lost|help|help me|abeg|please|pls|hint|i give up|e (hard|too hard|dey hard)|hard)[\s!.?😩😭😢🙁]*$/iu;

export function isStuck(value) {
  return STUCK.test(String(value).trim());
}

export function checkChat(value) {
  if (isOffensive(value)) return "offensive";
  if (isGibberish(value) && !isStuck(value)) return "gibberish";
  return null;
}

export const CHAT_REPLIES = {
  offensive: "Abeg, let's keep it respectful 🙏. I'm here to help you study. Ask me about your question and we'll work it out together.",
  gibberish: "Hmm, I no understand that one 😅. Try telling me in your own words what the question is asking, or which part is confusing you.",
};
