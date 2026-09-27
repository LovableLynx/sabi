// Sabi — chat UI
// Three subjects: literature (plain text), physics (symbol palette + KaTeX),
// accounting (structured ledger row entry -> fixed markdown table).
//
// Talks to ml/serve/serve_sabi.py (POST /api/chat). When the app is served by
// that server, the API is same-origin. To point a separately hosted copy at a
// server, open it with ?api=https://your-tunnel-url

const SUBJECTS = {
  literature: { label: "Literature", mode: "plain" },
  physics: { label: "Physics", mode: "physics" },
  accounting: { label: "Financial Accounting", mode: "accounting" },
};

const API_BASE = (new URLSearchParams(location.search).get("api") || "").replace(/\/$/, "");

const state = {
  subject: "literature",
  history: {
    literature: [],
    physics: [],
    accounting: [],
  },
  pending: false,
  compare: false, // also ask base N-ATLAS and show its reply alongside Sabi's
  backend: { status: "checking", model: "" }, // checking | model | mock | offline
};

const app = document.getElementById("app");

function render() {
  app.innerHTML = "";
  app.appendChild(buildHeader());
  app.appendChild(buildTabs());
  app.appendChild(buildChatWindow());
  app.appendChild(buildInputArea());
  app.appendChild(buildFooter());
  renderMath();
  const win = document.querySelector(".chat-window");
  if (win) win.scrollTop = win.scrollHeight;
}

function buildHeader() {
  const header = document.createElement("header");
  header.className = "app-header";
  header.innerHTML = `
    <h1>Sabi — N-ATLAS Tutor</h1>
    <p>Guides you to the answer instead of handing it over. Fine-tuned for WAEC/JAMB Arts, Science &amp; Commerce streams with Nigerian cultural grounding.</p>
  `;

  const bar = document.createElement("div");
  bar.className = "status-bar";

  const labels = {
    checking: "Connecting…",
    model: "Live: fine-tuned N-ATLAS",
    mock: "Test mode: mock replies",
    offline: "Offline: no model server",
  };
  const badge = document.createElement("span");
  badge.className = "status-badge " + state.backend.status;
  badge.textContent = labels[state.backend.status];
  if (state.backend.model) badge.title = state.backend.model;
  bar.appendChild(badge);

  const toggle = document.createElement("label");
  toggle.className = "compare-toggle";
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = state.compare;
  box.disabled = state.backend.status === "offline";
  box.onchange = () => {
    state.compare = box.checked;
  };
  toggle.appendChild(box);
  toggle.appendChild(document.createTextNode(" Compare with base N-ATLAS"));
  bar.appendChild(toggle);

  header.appendChild(bar);
  return header;
}

function buildFooter() {
  const footer = document.createElement("footer");
  footer.className = "app-footer";
  // Required by the N-ATLAS Open-Source Research and Innovation License —
  // do not remove. See docs/n_atlas_model_notes.md.
  footer.innerHTML = `<p>Built on N-ATLAS · Powered by Awarri Technologies</p>`;
  return footer;
}

function buildTabs() {
  const wrap = document.createElement("div");
  wrap.className = "subject-tabs";
  Object.entries(SUBJECTS).forEach(([key, cfg]) => {
    const btn = document.createElement("button");
    btn.className = "subject-tab" + (state.subject === key ? " active" : "");
    btn.textContent = cfg.label;
    btn.onclick = () => {
      state.subject = key;
      render();
    };
    wrap.appendChild(btn);
  });
  return wrap;
}

function buildChatWindow() {
  const win = document.createElement("div");
  win.className = "chat-window";
  const msgs = state.history[state.subject];
  if (msgs.length === 0) {
    const hint = document.createElement("div");
    hint.className = "hint";
    hint.textContent = "No messages yet — ask a question below to start a Socratic dialogue.";
    win.appendChild(hint);
  }
  msgs.forEach((m) => {
    if (m.role === "tutor" && m.baseText !== undefined) {
      // Side-by-side: Sabi's reply next to what base N-ATLAS would have said.
      const pair = document.createElement("div");
      pair.className = "compare-pair";
      pair.appendChild(makeBubble("tutor", m.text, "Sabi (fine-tuned)"));
      pair.appendChild(makeBubble("base", m.baseText, "Base N-ATLAS (no fine-tuning)"));
      win.appendChild(pair);
    } else {
      win.appendChild(makeBubble(m.role, m.text));
    }
  });
  if (state.pending) {
    const thinking = document.createElement("div");
    thinking.className = "bubble tutor thinking";
    thinking.textContent = "Sabi is thinking…";
    win.appendChild(thinking);
  }
  return win;
}

function makeBubble(role, text, label) {
  const bubble = document.createElement("div");
  bubble.className = "bubble " + role;
  bubble.innerHTML =
    (label ? `<div class="bubble-label">${escapeHtml(label)}</div>` : "") + renderContent(text, role);
  return bubble;
}

// Render markdown tables (accounting) as real <table> elements; leave
// physics equations as raw text for KaTeX auto-render to pick up.
function renderContent(text, role) {
  if (text.includes("|") && text.includes("---")) {
    return markdownTableToHtml(text);
  }
  return escapeHtml(text);
}

function markdownTableToHtml(text) {
  const lines = text.trim().split("\n").filter((l) => l.trim().startsWith("|"));
  if (lines.length < 2) return escapeHtml(text);
  const rows = lines
    .filter((l, i) => i !== 1) // drop the "---" separator row
    .map((l) => l.split("|").slice(1, -1).map((c) => c.trim()));
  const [headerRow, ...bodyRows] = rows;
  let html = "<table><thead><tr>";
  headerRow.forEach((h) => (html += `<th>${escapeHtml(h)}</th>`));
  html += "</tr></thead><tbody>";
  bodyRows.forEach((r) => {
    html += "<tr>" + r.map((c) => `<td>${escapeHtml(c)}</td>`).join("") + "</tr>";
  });
  html += "</tbody></table>";
  return html;
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

function renderMath() {
  if (state.subject !== "physics") return;
  if (window.renderMathInElement) {
    window.renderMathInElement(document.querySelector(".chat-window"), {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "$", right: "$", display: false },
      ],
      throwOnError: false,
    });
  }
}

function buildInputArea() {
  const wrap = document.createElement("div");
  wrap.className = "input-area";

  const mode = SUBJECTS[state.subject].mode;

  if (mode === "physics") {
    wrap.appendChild(buildPhysicsPalette());
    wrap.appendChild(buildPlainInputRow((text) => submitMessage(text)));
    const hint = document.createElement("div");
    hint.className = "hint";
    hint.textContent =
      "Notation: powers with ^ (v^2), explicit * for multiplication (2*a*s), fractions as (v-u)/t, Greek letters as θ Δ ω μ, vectors as vec(F). Wrap expressions in $...$ so they render, e.g. $v^2 = u^2 + 2*a*s$.";
    wrap.appendChild(hint);
  } else if (mode === "accounting") {
    wrap.appendChild(buildLedgerForm());
  } else {
    wrap.appendChild(buildPlainInputRow((text) => submitMessage(text)));
  }

  return wrap;
}

function buildPlainInputRow(onSend) {
  const row = document.createElement("div");
  row.className = "text-input-row";
  const textarea = document.createElement("textarea");
  textarea.placeholder = "Type your question…";
  textarea.id = "plain-input";
  const btn = document.createElement("button");
  btn.className = "send-btn";
  btn.textContent = "Ask";
  btn.disabled = state.pending;
  textarea.onkeydown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      btn.click();
    }
  };
  btn.onclick = () => {
    if (state.pending) return;
    const val = textarea.value.trim();
    if (!val) return;
    onSend(val);
  };
  row.appendChild(textarea);
  row.appendChild(btn);
  return row;
}

function buildPhysicsPalette() {
  const wrap = document.createElement("div");
  wrap.className = "symbol-palette";
  const symbols = ["^2", "^", "√", "Δ", "θ", "ω", "μ", "→", "vec()", "/", "*"];
  symbols.forEach((sym) => {
    const btn = document.createElement("button");
    btn.textContent = sym;
    btn.onclick = () => {
      const input = document.getElementById("plain-input");
      if (!input) return;
      const pos = input.selectionStart ?? input.value.length;
      input.value = input.value.slice(0, pos) + sym + input.value.slice(pos);
      input.focus();
      input.selectionStart = input.selectionEnd = pos + sym.length;
    };
    wrap.appendChild(btn);
  });
  return wrap;
}

// ---- Accounting: structured Dr/Cr ledger row entry ----

let ledgerRows = [{ date: "", account: "", debit: "", credit: "" }];

function buildLedgerForm() {
  const wrap = document.createElement("div");
  wrap.className = "ledger-form";

  const heading = document.createElement("div");
  heading.className = "hint";
  heading.textContent = "Enter each ledger line, then submit — it will be sent as a fixed Debit/Credit table.";
  wrap.appendChild(heading);

  ledgerRows.forEach((row, idx) => {
    const rowEl = document.createElement("div");
    rowEl.className = "ledger-row";

    rowEl.appendChild(makeLedgerInput("Date", row.date, (v) => (row.date = v)));
    rowEl.appendChild(makeLedgerInput("Account", row.account, (v) => (row.account = v)));
    rowEl.appendChild(makeLedgerInput("Debit (₦)", row.debit, (v) => (row.debit = v)));
    rowEl.appendChild(makeLedgerInput("Credit (₦)", row.credit, (v) => (row.credit = v)));

    const removeBtn = document.createElement("button");
    removeBtn.textContent = "✕";
    removeBtn.onclick = () => {
      ledgerRows.splice(idx, 1);
      if (ledgerRows.length === 0) ledgerRows.push({ date: "", account: "", debit: "", credit: "" });
      render();
    };
    rowEl.appendChild(removeBtn);

    wrap.appendChild(rowEl);
  });

  const controls = document.createElement("div");
  controls.className = "ledger-controls";

  const addBtn = document.createElement("button");
  addBtn.textContent = "+ Add row";
  addBtn.onclick = () => {
    ledgerRows.push({ date: "", account: "", debit: "", credit: "" });
    render();
  };

  const askInput = document.createElement("textarea");
  askInput.placeholder = "Optional: describe the transaction or ask your question…";
  askInput.style.flex = "1";

  const submitBtn = document.createElement("button");
  submitBtn.className = "send-btn";
  submitBtn.textContent = "Submit ledger";
  submitBtn.disabled = state.pending;
  submitBtn.onclick = () => {
    if (state.pending) return;
    const table = ledgerRowsToMarkdown(ledgerRows);
    const question = askInput.value.trim();
    const combined = question ? `${question}\n\n${table}` : table;
    submitMessage(combined);
    ledgerRows = [{ date: "", account: "", debit: "", credit: "" }];
  };

  controls.appendChild(addBtn);
  controls.appendChild(submitBtn);

  wrap.appendChild(askInput);
  wrap.appendChild(controls);

  return wrap;
}

function makeLedgerInput(placeholder, value, onChange) {
  const input = document.createElement("input");
  input.placeholder = placeholder;
  input.value = value;
  input.oninput = (e) => onChange(e.target.value);
  return input;
}

function ledgerRowsToMarkdown(rows) {
  const header = "| Date | Account | Debit (₦) | Credit (₦) |";
  const sep = "|------|---------|-----------|------------|";
  const body = rows
    .filter((r) => r.date || r.account || r.debit || r.credit)
    .map((r) => `| ${r.date} | ${r.account} | ${r.debit} | ${r.credit} |`)
    .join("\n");
  return [header, sep, body].join("\n");
}

// ---- Message submission / model calls ----

async function submitMessage(text) {
  const subject = state.subject; // the student may switch tabs while waiting
  const history = state.history[subject];
  history.push({ role: "student", text });
  state.pending = true;
  render();

  try {
    const { reply, baseReply } = await sendToModel(history, state.compare);
    history.push(baseReply === undefined ? { role: "tutor", text: reply } : { role: "tutor", text: reply, baseText: baseReply });
  } catch (err) {
    history.push({ role: "error", text: `Could not reach Sabi: ${err.message}` });
  } finally {
    state.pending = false;
    render();
  }
}

// Only student/tutor turns go to the model; error notices and base replies
// shown in compare mode are UI-only and are never part of the conversation.
async function sendToModel(history, compare) {
  if (state.backend.status === "offline") {
    throw new Error("no model server is running. Start ml/serve/serve_sabi.py and reload.");
  }
  const messages = history
    .filter((m) => m.role === "student" || m.role === "tutor")
    .map((m) => ({ role: m.role === "student" ? "user" : "assistant", content: m.text }));

  const res = await fetch(`${API_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, model: compare ? "both" : "sabi" }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `server returned ${res.status}`);
  return { reply: data.reply, baseReply: data.base_reply };
}

async function checkBackend() {
  try {
    const res = await fetch(`${API_BASE}/api/health`);
    const data = await res.json();
    state.backend = { status: data.mode === "mock" ? "mock" : "model", model: data.model || "" };
  } catch {
    state.backend = { status: "offline", model: "" };
  }
  render();
}

render();
checkBackend();
