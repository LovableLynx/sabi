// A single lesson ("bus stop"): one exam question, optional chat with Sabi,
// hints, and a locked-in multiple-choice answer that is marked exactly.
//
// Chat uses the live fine-tuned model when serve_sabi.py is reachable and
// falls back to Offline Guided mode (Sabi's authored steps for this problem)
// when it isn't. Marking never depends on the model.

import { answer, ask, emit, provide } from "../core/bus.js";
import { chat, health } from "../core/api.js";
import { loadContent } from "../core/content.js";
import { h, clear, richText } from "../core/dom.js";
import { SUBJECTS } from "../core/nigeria.js";

const LETTERS = ["A", "B", "C", "D"];

function outOfFuel(container) {
  const stats = ask("stats", null, null);
  const mins = stats ? Math.ceil(stats.nextHeartIn / 60000) : null;
  container.appendChild(
    h("div", { class: "card center out-of-fuel" },
      h("div", { class: "big-emoji" }, "⛽"),
      h("h2", {}, "Your danfo don run out of fuel!"),
      h("p", { class: "muted" }, mins ? `1 fuel refills in about ${mins} min.` : "Fuel refills with time."),
      h("p", { class: "muted" }, "Practise a stop you've already finished to earn fuel back, or ask Sabi anything in the meantime."),
      h("div", { class: "btn-row" },
        h("button", { class: "btn btn-primary", onclick: () => emit("nav", { screen: "learn" }) }, "Back to route"),
        h("button", { class: "btn btn-ghost", onclick: () => emit("nav", { screen: "chat" }) }, "Ask Sabi")
      )
    )
  );
}

function render(container, content, lesson) {
  const s = {
    selected: null,
    wrong: new Set(),
    eliminated: new Set(),
    hintsUsed: 0,
    chatTurns: 0,
    finished: false,
    messages: [], // {role: "student"|"tutor"|"note", text}
    guidedIndex: 0,
    mode: "checking", // model | mock | offline
    pending: false,
  };
  const subject = SUBJECTS[lesson.subject];

  const optionEls = lesson.options.map((opt, i) =>
    h("button", {
      class: "option",
      onclick: () => {
        if (s.finished || s.wrong.has(i) || s.eliminated.has(i)) return;
        s.selected = i;
        emit("ui:tap");
        paintOptions();
      },
    }, h("span", { class: "option-letter" }, LETTERS[i]), h("span", {}, opt))
  );

  function paintOptions() {
    optionEls.forEach((el, i) => {
      el.className =
        "option" +
        (s.selected === i ? " selected" : "") +
        (s.wrong.has(i) ? " wrong" : "") +
        (s.eliminated.has(i) ? " eliminated" : "") +
        (s.finished && i === lesson.answer_index ? " correct" : "");
      el.disabled = s.finished || s.wrong.has(i) || s.eliminated.has(i);
    });
    checkBtn.disabled = s.selected === null || s.finished;
  }

  // ---- hints ----
  const hintBox = h("div", { class: "hint-box", hidden: true });
  const hintBtn = h("button", { class: "btn btn-tool", onclick: useHint }, "💡 Hint");

  function useHint() {
    if (s.finished) return;
    if (s.hintsUsed === 0) {
      hintBox.hidden = false;
      hintBox.textContent = "💡 " + lesson.hint;
    } else if (s.hintsUsed === 1) {
      const candidates = [0, 1, 2, 3].filter((i) => i !== lesson.answer_index && !s.wrong.has(i) && !s.eliminated.has(i));
      if (candidates.length) {
        const out = candidates[Math.floor(Math.random() * candidates.length)];
        s.eliminated.add(out);
        if (s.selected === out) s.selected = null;
        hintBox.textContent += `\n✂️ Option ${LETTERS[out]} is not it.`;
      }
    } else {
      return;
    }
    s.hintsUsed += 1;
    hintBtn.textContent = s.hintsUsed >= 2 ? "💡 No more hints" : "💡 Another hint (−XP)";
    hintBtn.disabled = s.hintsUsed >= 2;
    emit("ui:tap");
    paintOptions();
  }

  // ---- chat with Sabi ----
  const chatLog = h("div", { class: "chat-log" });
  const chatInput = h("textarea", { class: "field chat-input", rows: 2, placeholder: "Tell Sabi how you're thinking about it…" });
  const sendBtn = h("button", { class: "btn btn-primary", onclick: sendChat }, "Send");
  const modeLabel = h("span", { class: "mode-label" }, "Connecting to Sabi…");
  const chatPanel = h("div", { class: "chat-panel", hidden: true },
    h("div", { class: "chat-head" }, h("strong", {}, "💬 Talk it through with Sabi"), modeLabel),
    chatLog,
    h("div", { class: "chat-send" }, chatInput, sendBtn)
  );
  const chatBtn = h("button", {
    class: "btn btn-tool",
    onclick: () => {
      chatPanel.hidden = !chatPanel.hidden;
      if (!chatPanel.hidden) {
        if (!s.messages.length) {
          s.messages.push({ role: "tutor", text: "I won't just give you the answer — but I'll help you find it. Tell me what you think, or where you're stuck." });
          paintChat();
        }
        chatInput.focus();
      }
    },
  }, "💬 Ask Sabi");
  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendChat();
    }
  });

  function setMode(mode) {
    s.mode = mode;
    modeLabel.textContent = {
      model: "Live · fine-tuned N-ATLAS",
      mock: "Test mode",
      offline: "Offline guided steps",
      checking: "Connecting…",
    }[mode];
    modeLabel.className = "mode-label mode-" + mode;
  }

  function paintChat() {
    clear(chatLog);
    for (const m of s.messages) {
      const bubble = h("div", { class: "chat-msg " + m.role });
      bubble.appendChild(richText(m.text));
      chatLog.appendChild(bubble);
    }
    if (s.pending) chatLog.appendChild(h("div", { class: "chat-msg tutor thinking" }, "Sabi is thinking…"));
    chatLog.scrollTop = chatLog.scrollHeight;
    sendBtn.disabled = s.pending;
  }

  function guidedReply() {
    const steps = content.guided[lesson.source_id] || [];
    if (s.guidedIndex < steps.length) return steps[s.guidedIndex++];
    return "That's all the guided steps I have for this one. You don reason am well — lock in your answer!";
  }

  async function sendChat() {
    const text = chatInput.value.trim();
    if (!text || s.pending) return;
    chatInput.value = "";
    s.messages.push({ role: "student", text });
    s.chatTurns += 1;
    s.pending = true;
    paintChat();

    if (s.mode === "model" || s.mode === "mock") {
      const turns = s.messages.filter((m) => m.role === "student" || m.role === "tutor").slice(1); // drop the greeting
      const msgs = turns.map((m, i) => ({
        role: m.role === "student" ? "user" : "assistant",
        content: i === 0 ? `Question: ${lesson.question}\n\n${m.text}` : m.text,
      }));
      try {
        const data = await chat(msgs, "sabi");
        s.messages.push({ role: "tutor", text: data.reply });
      } catch (err) {
        setMode("offline");
        s.messages.push({ role: "note", text: `Live Sabi is unavailable (${err.message}). Switching to offline guided steps.` });
        s.messages.push({ role: "tutor", text: guidedReply() });
      }
    } else {
      await new Promise((r) => setTimeout(r, 500));
      s.messages.push({ role: "tutor", text: guidedReply() });
    }
    s.pending = false;
    paintChat();
  }

  health().then((st) => setMode(st.tutor === "offline" ? "offline" : st.tutor));

  // ---- checking the answer ----
  const sheet = h("div", { class: "result-sheet", hidden: true });
  const checkBtn = h("button", { class: "btn btn-primary btn-block", disabled: true, onclick: check }, "Lock in answer");

  function finish(correct) {
    s.finished = true;
    paintOptions();
    const firstTry = correct && s.wrong.size === 0;
    const result = ask("awardLesson", { lesson, correct, firstTry, hintsUsed: s.hintsUsed, chatTurns: s.chatTurns }, null);
    clear(sheet);
    sheet.hidden = false;
    sheet.className = "result-sheet " + (correct ? "good" : "bad");
    sheet.append(
      h("h3", {}, correct ? (firstTry ? "You don sabi! 🎉" : "You got there! 👏") : "Na the correct one be this 👇"),
      h("p", {}, lesson.explanation),
      result
        ? h("ul", { class: "xp-list" },
            result.parts.map((p) => h("li", {}, h("span", {}, p.label), p.xp ? h("strong", {}, `+${p.xp} XP`) : null)),
            h("li", { class: "xp-total" }, h("span", {}, result.replay ? "Practice total" : "Total"), h("strong", {}, `+${result.gained} XP`))
          )
        : null,
      h("button", { class: "btn btn-primary btn-block", onclick: () => emit("nav", { screen: "learn" }) }, "Continue")
    );
    sheet.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function check() {
    if (s.selected === null || s.finished) return;
    if (s.selected === lesson.answer_index) {
      emit("answer:correct");
      finish(true);
      return;
    }
    emit("answer:wrong");
    s.wrong.add(s.selected);
    s.selected = null;
    const fuelLeft = ask("loseHeart", null, null);
    paintOptions();
    if (s.wrong.size >= 2) {
      finish(false);
    } else if (fuelLeft === 0) {
      clear(sheet);
      sheet.hidden = false;
      sheet.className = "result-sheet bad";
      sheet.append(
        h("h3", {}, "Out of fuel ⛽"),
        h("p", {}, "That one cost your last fuel. Practise a finished stop to refuel, then come back."),
        h("button", { class: "btn btn-primary btn-block", onclick: () => emit("nav", { screen: "learn" }) }, "Back to route")
      );
      s.finished = true;
      paintOptions();
    } else {
      emit("toast", { text: "E no easy — one more try! (−1 ⛽)", kind: "bad" });
    }
  }

  // ---- layout ----
  container.appendChild(
    h("div", { class: "lesson", style: `--subject:${subject.color}` },
      h("div", { class: "lesson-top" },
        h("button", { class: "icon-btn", "aria-label": "Close lesson", onclick: () => emit("nav", { screen: "learn" }) }, "✕"),
        h("div", { class: "grow" },
          h("div", { class: "small muted" }, `${subject.emoji} ${subject.label} · Unit ${lesson.unitIndex + 1}`),
          h("strong", {}, `Stop ${lesson.lessonIndex + 1}: ${lesson.unit.title}`)
        )
      ),
      h("div", { class: "card question-card" }, richText(lesson.question)),
      h("div", { class: "options" }, optionEls),
      hintBox,
      h("div", { class: "tool-row" }, hintBtn, chatBtn),
      chatPanel,
      checkBtn,
      sheet
    )
  );
  paintOptions();
}

function screen(container, params = {}) {
  if (!ask("canPlay", null, true)) {
    outOfFuel(container);
    return;
  }
  container.appendChild(h("div", { class: "card center muted" }, "Loading lesson…"));
  loadContent()
    .then((content) => {
      const lesson = content.lessons.get(params.id);
      clear(container);
      if (!lesson) {
        container.appendChild(h("div", { class: "card center" }, h("p", {}, "That lesson wasn't found."),
          h("button", { class: "btn btn-primary", onclick: () => emit("nav", { screen: "learn" }) }, "Back to route")));
        return;
      }
      render(container, content, lesson);
    })
    .catch((err) => {
      clear(container).appendChild(h("div", { class: "card center" }, h("p", {}, `Couldn't load the lesson: ${err.message}`)));
    });
}

export function init() {
  provide("screen:lesson", screen);
}
