// "Ask Sabi": open chat about anything in the three subjects, with the
// physics symbol palette, the structured Debit/Credit ledger entry, and the
// "compare with base N-ATLAS" toggle for side-by-side demos.
// Needs the model server; without it the screen explains how to start it.

import { answer, emit, provide } from "../core/bus.js";
import { chat, health } from "../core/api.js";
import { h, clear, richText } from "../core/dom.js";
import { SUBJECTS } from "../core/nigeria.js";

const state = {
  subject: "physics",
  history: { literature: [], physics: [], accounting: [] },
  compare: false,
  pending: false,
};
let ledgerRows = [{ date: "", account: "", debit: "", credit: "" }];

const PHYSICS_SYMBOLS = ["^2", "^", "√", "Δ", "θ", "ω", "μ", "→", "vec()", "/", "*"];

function ledgerToMarkdown(rows) {
  const body = rows
    .filter((r) => r.date || r.account || r.debit || r.credit)
    .map((r) => `| ${r.date} | ${r.account} | ${r.debit} | ${r.credit} |`);
  return ["| Date | Account | Debit (₦) | Credit (₦) |", "|------|---------|-----------|------------|", ...body].join("\n");
}

function render(container, status) {
  clear(container);
  const live = status.tutor !== "offline";

  container.appendChild(
    h("div", { class: "card" },
      h("h2", {}, "💬 Ask Sabi"),
      h("p", { class: "muted" }, "Bring any WAEC/JAMB question. Sabi guides you to the answer instead of handing it over."),
      h("div", { class: "status-row" },
        h("span", { class: "status-badge " + status.tutor }, { model: "Live · fine-tuned N-ATLAS", mock: "Test mode", offline: "Offline" }[status.tutor]),
        h("label", { class: "compare-toggle" },
          h("input", { type: "checkbox", checked: state.compare, disabled: !live, onchange: (e) => (state.compare = e.target.checked) }),
          " Compare with base N-ATLAS"
        )
      )
    )
  );

  if (!live) {
    container.appendChild(
      h("div", { class: "card center" },
        h("div", { class: "big-emoji" }, "📴"),
        h("h3", {}, "Sabi's brain is offline right now"),
        h("p", { class: "muted" }, "Open chat needs the fine-tuned model server (ml/serve/serve_sabi.py). Lessons still work offline with guided steps."),
        h("button", { class: "btn btn-primary", onclick: () => emit("nav", { screen: "learn" }) }, "Go to lessons")
      )
    );
    return;
  }

  container.appendChild(
    h("div", { class: "tabs" },
      Object.entries(SUBJECTS).map(([key, s]) =>
        h("button", {
          class: "tab" + (state.subject === key ? " active" : ""),
          onclick: () => { state.subject = key; render(container, status); },
        }, `${s.emoji} ${s.label}`)
      )
    )
  );

  const log = h("div", { class: "chat-log tall" });
  const history = state.history[state.subject];
  if (!history.length) log.appendChild(h("p", { class: "muted center" }, "No messages yet. Ask your question below."));
  for (const m of history) {
    if (m.role === "tutor" && m.baseText !== undefined) {
      log.appendChild(
        h("div", { class: "compare-pair" },
          h("div", { class: "chat-msg tutor" }, h("div", { class: "msg-label" }, "Sabi (fine-tuned)"), richText(m.text)),
          h("div", { class: "chat-msg base" }, h("div", { class: "msg-label" }, "Base N-ATLAS"), richText(m.baseText))
        )
      );
    } else {
      log.appendChild(h("div", { class: "chat-msg " + m.role }, richText(m.text)));
    }
  }
  if (state.pending) log.appendChild(h("div", { class: "chat-msg tutor thinking" }, "Sabi is thinking…"));
  container.appendChild(h("div", { class: "card" }, log));
  setTimeout(() => (log.scrollTop = log.scrollHeight), 0);

  async function send(text) {
    if (!text.trim() || state.pending) return;
    const subject = state.subject;
    const hist = state.history[subject];
    hist.push({ role: "student", text });
    state.pending = true;
    render(container, status);
    try {
      const msgs = hist
        .filter((m) => m.role === "student" || m.role === "tutor")
        .map((m) => ({ role: m.role === "student" ? "user" : "assistant", content: m.text }));
      const data = await chat(msgs, state.compare ? "both" : "sabi");
      hist.push(data.base_reply === undefined ? { role: "tutor", text: data.reply } : { role: "tutor", text: data.reply, baseText: data.base_reply });
    } catch (err) {
      hist.push({ role: "note", text: `Couldn't reach Sabi: ${err.message}` });
    } finally {
      state.pending = false;
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
      h("p", { class: "muted small" }, "Optional: enter ledger lines — they're sent as a proper Debit/Credit table."),
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
