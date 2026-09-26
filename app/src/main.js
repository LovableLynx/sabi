// Sabi — minimal chat UI skeleton
// Three subjects: literature (plain text), physics (symbol palette + KaTeX),
// accounting (structured ledger row entry -> fixed markdown table).
//
// Wire `sendToModel()` to your fine-tuned N-ATLAS inference endpoint when ready.
// Until then it echoes a stub Socratic-style response so the UI/render path
// can be demoed and tested independently of the model.

const SUBJECTS = {
  literature: { label: "Literature", mode: "plain" },
  physics: { label: "Physics", mode: "physics" },
  accounting: { label: "Financial Accounting", mode: "accounting" },
};

const state = {
  subject: "literature",
  history: {
    literature: [],
    physics: [],
    accounting: [],
  },
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
    <p>Guides, never gives the answer directly. Fine-tuned for WAEC/JAMB Arts, Science &amp; Commerce streams with Nigerian cultural grounding.</p>
  `;
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
    const bubble = document.createElement("div");
    bubble.className = "bubble " + m.role;
    bubble.innerHTML = renderContent(m.text, m.role);
    win.appendChild(bubble);
  });
  return win;
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
  btn.onclick = () => {
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
  submitBtn.onclick = () => {
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

// ---- Message submission / model call stub ----

function submitMessage(text) {
  state.history[state.subject].push({ role: "student", text });
  render();

  sendToModel(state.subject, state.history[state.subject]).then((reply) => {
    state.history[state.subject].push({ role: "tutor", text: reply });
    render();
  });
}

// STUB: replace with a fetch() call to your fine-tuned N-ATLAS inference
// endpoint once it's deployed. Keep the contract: (subject, historyArray) ->
// Promise<string>. The returned string may contain a markdown table
// (accounting) or $...$ math (physics), both of which the renderer handles.
async function sendToModel(subject, history) {
  await new Promise((r) => setTimeout(r, 400));
  return "[stub tutor response] This is a placeholder — connect sendToModel() in main.js to your fine-tuned N-ATLAS endpoint. The tutor should never state the answer directly; it should ask a guiding question using a Nigerian cultural analogy.";
}

render();
