// "Ask Sabi": open chat about the student's own subjects, with the
// physics symbol palette, the structured Debit/Credit ledger entry, and the
// "compare with base N-ATLAS" toggle for side-by-side demos.
// Needs the model server; without it the screen explains how to start it.

import { answer, ask, emit, provide } from "../core/bus.js";
import { chat, health } from "../core/api.js";
import { h, clear, richText } from "../core/dom.js";
import { SUBJECTS, TRACKS } from "../core/nigeria.js";
import { load } from "../core/storage.js";
import { CHAT_REPLIES, checkChat } from "../core/validate.js";
import { canSpeak, isAutoRead, setAutoRead, speak, speakerButton } from "../core/speech.js";

const state = {
  subject: "physics",
  history: {}, // subject -> messages, created on first use
  compare: false,
  pending: false,
};
let ledgerRows = [{ date: "", account: "", debit: "", credit: "" }];

// Shown when a first message is too short to be a question ("they", "ok").
const EXAMPLES = {
  literature: "What is the difference between a simile and a metaphor?",
  physics: "How do I find the acceleration of a car that stops?",
  accounting: "Which account do I debit when I buy goods for cash?",
  "bece-english": "What is an adverb?",
  "bece-science": "Why does ice melt in the sun?",
  "bece-business": "What is the difference between a debtor and a creditor?",
  "ncee-maths": "How do I find the LCM of 4 and 6?",
  "ncee-english": "What is the plural of 'child'?",
  "ncee-science": "Why do plants need sunlight?",
};

function tooVague(text) {
  const t = text.trim();
  return t.split(/\s+/).length < 2 && !/[?\d]/.test(t); // "they", "ok"; "Explain refraction" is fine
}

const PHYSICS_SYMBOLS = ["^2", "^", "√", "Δ", "θ", "ω", "μ", "→", "vec()", "/", "*"];

function ledgerToMarkdown(rows) {
  const body = rows
    .filter((r) => r.date || r.account || r.debit || r.credit)
    .map((r) => `| ${r.date} | ${r.account} | ${r.debit} | ${r.credit} |`);
  return ["| Date | Account | Debit (₦) | Credit (₦) |", "|------|---------|-----------|------------|", ...body].join("\n");
}

// The subjects for the student's class level (WAEC, BECE or Common Entrance).
function mySubjects() {
  const level = ask("profile", null, null)?.level || load("guestLevel", null) || "waec";
  const list = Object.entries(SUBJECTS).filter(([, s]) => s.track === level);
  return list.length ? list : Object.entries(SUBJECTS).filter(([, s]) => s.track === "waec");
}

function render(container, status) {
  clear(container);
  const live = status.tutor !== "offline";
  const subjects = mySubjects();
  if (!subjects.some(([key]) => key === state.subject)) state.subject = subjects[0][0];
  const track = TRACKS[SUBJECTS[state.subject].track];

  container.appendChild(
    h("div", { class: "card" },
      h("h2", {}, "💬 Ask Sabi"),
      h("p", { class: "muted" }, `Bring any ${track.short} question. Sabi guides you to the answer instead of handing it over.`),
      h("div", { class: "status-row" },
        h("span", { class: "status-badge " + status.tutor }, { model: "Live · fine-tuned N-ATLAS", mock: "Test mode", offline: "Offline" }[status.tutor]),
        h("label", { class: "compare-toggle" },
          h("input", { type: "checkbox", checked: state.compare, disabled: !live, onchange: (e) => (state.compare = e.target.checked) }),
          " Compare with base N-ATLAS"
        ),
        canSpeak()
          ? h("label", { class: "compare-toggle" },
              h("input", { type: "checkbox", checked: isAutoRead(), onchange: (e) => setAutoRead(e.target.checked) }),
              " 🔊 Read replies aloud"
            )
          : null
      )
    )
  );

  if (!live) {
    container.appendChild(
      h("div", { class: "card center" },
        h("div", { class: "big-emoji" }, "📴"),
        h("h3", {}, "Sabi's brain is offline right now"),
        h("p", { class: "muted" }, "Sabi's AI tutor is switched on during class sessions and demos. Until then, every lesson still works, with step-by-step hints from Sabi."),
        h("button", { class: "btn btn-primary", onclick: () => emit("nav", { screen: "learn" }) }, "Go to lessons")
      )
    );
    return;
  }

  container.appendChild(
    h("div", { class: "tabs" },
      subjects.map(([key, s]) =>
        h("button", {
          class: "tab" + (state.subject === key ? " active" : ""),
          onclick: () => { state.subject = key; render(container, status); },
        }, `${s.emoji} ${s.label}`)
      )
    )
  );

  const log = h("div", { class: "chat-log tall" });
  const history = (state.history[state.subject] ||= []);
  if (!history.length) log.appendChild(h("p", { class: "muted center" }, "No messages yet. Ask your question below."));
  for (const m of history) {
    if (m.role === "tutor" && m.baseText !== undefined) {
      log.appendChild(
        h("div", { class: "compare-pair" },
          h("div", { class: "chat-msg tutor" }, h("div", { class: "msg-label" }, m.calc ? "Sabi · 🧮 steps checked by calculator" : "Sabi (fine-tuned)"), richText(m.text), speakerButton(m.text)),
          h("div", { class: "chat-msg base" }, h("div", { class: "msg-label" }, "Base N-ATLAS"), richText(m.baseText))
        )
      );
    } else {
      log.appendChild(h("div", { class: "chat-msg " + m.role }, m.calc ? h("div", { class: "msg-label" }, "🧮 steps checked by calculator") : null, richText(m.text),
        m.role === "tutor" ? speakerButton(m.text) : null));
    }
  }
  if (state.pending) log.appendChild(h("div", { class: "chat-msg tutor thinking" }, state.waking ? "Waking Sabi up. The first answer takes about a minute…" : "Sabi is thinking…"));
  container.appendChild(h("div", { class: "card" }, log));
  setTimeout(() => (log.scrollTop = log.scrollHeight), 0);

  async function send(text) {
    if (!text.trim() || state.pending) return;
    const subject = state.subject;
    const hist = (state.history[subject] ||= []);
    hist.push({ role: "student", text });
    const blocked = checkChat(text);
    const first = !hist.some((m) => m.role === "tutor" && !m.local);
    const local = blocked ? CHAT_REPLIES[blocked]
      : first && tooVague(text)
        ? `Tell me a bit more 🙂. What would you like to know in ${SUBJECTS[subject].label}? For example: "${EXAMPLES[subject] || "Explain this topic to me"}"`
        : null;
    if (local) {
      // Answered here: insults, keyboard-mashing and one-word openers never reach the tutor.
      hist.push({ role: "tutor", text: local, local: true });
      if (isAutoRead()) speak(local);
      render(container, status);
      return;
    }
    state.pending = true;
    render(container, status);
    try {
      // Local nudges are left out, and the first question says which subject
      // is open, so Sabi doesn't have to guess the topic.
      const msgs = hist
        .filter((m) => (m.role === "student" || m.role === "tutor") && !m.local)
        .filter((m, i, all) => !(m.role === "student" && all[i + 1]?.role === "student"))
        .map((m) => ({ role: m.role === "student" ? "user" : "assistant", content: m.text }));
      const s = SUBJECTS[subject];
      msgs[0] = { ...msgs[0], content: `Subject: ${s.label} (${TRACKS[s.track].short})\n\n${msgs[0].content}` };
      const data = await chat(msgs, state.compare ? "both" : "sabi", {
        onWaking: () => { state.waking = true; if (container.isConnected) render(container, status); },
      });
      const calc = data.checked === "calculator";
      hist.push(data.base_reply === undefined ? { role: "tutor", text: data.reply, calc } : { role: "tutor", text: data.reply, baseText: data.base_reply, calc });
      if (isAutoRead()) speak(data.reply);
    } catch (err) {
      hist.push({ role: "note", text: `Couldn't reach Sabi: ${err.message}` });
    } finally {
      state.pending = false;
      state.waking = false;
      if (container.isConnected) render(container, status);
    }
  }

  const input = h("textarea", { class: "field", rows: 2, id: "freechat-input", placeholder: "Type your question…" });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input.value);
    }
  });
  const composer = h("div", { class: "card composer" });

  if (state.subject === "physics") {
    composer.appendChild(
      h("div", { class: "symbol-palette" },
        PHYSICS_SYMBOLS.map((sym) =>
          h("button", {
            onclick: () => {
              const pos = input.selectionStart ?? input.value.length;
              input.value = input.value.slice(0, pos) + sym + input.value.slice(pos);
              input.focus();
              input.selectionStart = input.selectionEnd = pos + sym.length;
            },
          }, sym)
        )
      )
    );
  }

  if (state.subject === "accounting") {
    const rows = h("div", { class: "ledger-rows" });
    const paintRows = () => {
      clear(rows);
      ledgerRows.forEach((row, i) => {
        const field = (key, ph) => h("input", { class: "field", placeholder: ph, value: row[key], oninput: (e) => (row[key] = e.target.value) });
        rows.appendChild(
          h("div", { class: "ledger-row" },
            field("date", "Date"), field("account", "Account"), field("debit", "Debit (₦)"), field("credit", "Credit (₦)"),
            h("button", { class: "icon-btn", "aria-label": "Remove row", onclick: () => {
              ledgerRows.splice(i, 1);
              if (!ledgerRows.length) ledgerRows.push({ date: "", account: "", debit: "", credit: "" });
              paintRows();
            } }, "✕")
          )
        );
      });
    };
    paintRows();
    composer.append(
      h("p", { class: "muted small" }, "Optional: enter ledger lines. They're sent as a proper Debit/Credit table."),
      rows,
      h("button", { class: "btn btn-ghost btn-small", onclick: () => { ledgerRows.push({ date: "", account: "", debit: "", credit: "" }); paintRows(); } }, "+ Add row")
    );
  }

  const sendBtn = h("button", {
    class: "btn btn-primary",
    disabled: state.pending,
    onclick: () => {
      let text = input.value.trim();
      if (state.subject === "accounting" && ledgerRows.some((r) => r.account || r.debit || r.credit)) {
        text = (text ? text + "\n\n" : "") + ledgerToMarkdown(ledgerRows);
        ledgerRows = [{ date: "", account: "", debit: "", credit: "" }];
      }
      send(text);
    },
  }, "Ask");
  composer.appendChild(h("div", { class: "chat-send" }, input, sendBtn));
  container.appendChild(composer);
}

function screen(container) {
  container.appendChild(h("div", { class: "card center muted" }, "Connecting to Sabi…"));
  health().then((status) => container.isConnected && render(container, status));
}

export function init() {
  provide("screen:chat", screen);
}
