// A lesson ("bus stop"): a round of up to 10 multiple-choice tasks, each with
// optional chat with Sabi, hints, and a locked-in answer that is marked exactly.
//
// Chat uses the live fine-tuned model when serve_sabi.py is reachable and
// falls back to Offline Guided mode (Sabi's authored steps for this problem)
// when it isn't. Marking never depends on the model.

import { answer, ask, emit, provide } from "../core/bus.js";
import { chat, health } from "../core/api.js";
import { loadContent } from "../core/content.js";
import { h, clear, richText, tidyDashes } from "../core/dom.js";
import { CHAT_REPLIES, checkChat } from "../core/validate.js";
import { isAutoRead, speak, speakerButton } from "../core/speech.js";
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


// A stop is a round of tasks: the stop's exam question first (with Sabi's
// authored guiding steps), then practice tasks on the same idea. A wrong first
// try is free; failing a task costs 1 fuel. The stop is passed with 60%.
const PASS_SHARE = 0.6;

function render(container, content, lesson) {
  const subject = SUBJECTS[lesson.subject];
  const tasks = [
    { ...lesson, steps: content.guided[lesson.source_id] || [] },
    ...(lesson.round || []).map((t) => ({ ...t, steps: t.hint ? [t.hint] : [] })),
  ];
  const total = tasks.length;
  const passMark = Math.ceil(total * PASS_SHARE);
  const round = { index: 0, results: [], hintsUsed: 0, chatTurns: 0, liveAi: false };
  let mode = "checking"; // model | mock | offline

  const modeLabels = [];
  function setMode(m) {
    mode = m;
    for (const el of modeLabels) {
      el.textContent = { model: "Live · fine-tuned N-ATLAS", mock: "Test mode", offline: "Offline guided steps", checking: "Connecting…" }[m];
      el.className = "mode-label mode-" + m;
    }
  }
  health().then((st) => setMode(st.tutor === "offline" ? "offline" : st.tutor));

  // ---- progress dots ----
  const dots = tasks.map(() => h("span", { class: "task-dot" }));
  const counter = h("span", { class: "task-count" });
  function paintProgress() {
    dots.forEach((d, i) => {
      const r = round.results[i];
      d.className = "task-dot" + (i === round.index && r === undefined ? " now" : "") + (r === "first" || r === "second" ? " right" : "") + (r === "missed" ? " missed" : "");
    });
    counter.textContent = round.index < total ? `Task ${round.index + 1} of ${total}` : `${total} of ${total} done`;
  }

  const taskArea = h("div", { class: "task-area" });

  function showTask(task) {
    const s = { selected: null, wrong: new Set(), eliminated: new Set(), hintsUsed: 0, done: false, messages: [], guidedIndex: 0, pending: false, waking: false };
    clear(taskArea);
    paintProgress();

    const optionEls = task.options.map((opt, i) =>
      h("button", {
        class: "option",
        onclick: () => {
          if (s.done || s.wrong.has(i) || s.eliminated.has(i)) return;
          s.selected = i;
          emit("ui:tap");
          paintOptions();
        },
      }, h("span", { class: "option-letter" }, LETTERS[i]), h("span", {}, tidyDashes(opt)))
    );

    function paintOptions() {
      optionEls.forEach((el, i) => {
        el.className =
          "option" +
          (s.selected === i ? " selected" : "") +
          (s.wrong.has(i) ? " wrong" : "") +
          (s.eliminated.has(i) ? " eliminated" : "") +
          (s.done && i === task.answer_index ? " correct" : "");
        el.disabled = s.done || s.wrong.has(i) || s.eliminated.has(i);
      });
      checkBtn.disabled = s.selected === null || s.done;
      checkBtn.hidden = s.done;
    }

    // ---- hints ----
    const hintBox = h("div", { class: "hint-box", hidden: true });
    const hintBtn = h("button", { class: "btn btn-tool", onclick: useHint }, "💡 Hint");

    function useHint() {
      if (s.done) return;
      if (s.hintsUsed === 0) {
        hintBox.hidden = false;
        hintBox.textContent = "💡 " + tidyDashes(task.hint);
      } else if (s.hintsUsed === 1) {
        const candidates = [0, 1, 2, 3].filter((i) => i !== task.answer_index && !s.wrong.has(i) && !s.eliminated.has(i));
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
      round.hintsUsed += 1;
      // Hints never take XP away; they only cost the end-of-stop "No hints needed" bonus.
      if (round.hintsUsed === 1) emit("toast", { text: "Hints are free. You just miss the +5 \"No hints needed\" bonus for this stop." });
      hintBtn.textContent = s.hintsUsed >= 2 ? "💡 No more hints" : "💡 Another hint";
      hintBtn.disabled = s.hintsUsed >= 2;
      emit("ui:tap");
      paintOptions();
    }

    // ---- chat with Sabi (fresh for each task) ----
    const chatLog = h("div", { class: "chat-log" });
    const chatInput = h("textarea", { class: "field chat-input", rows: 2, placeholder: "Tell Sabi how you're thinking about it…" });
    const sendBtn = h("button", { class: "btn btn-primary", onclick: sendChat }, "Send");
    const modeLabel = h("span", { class: "mode-label" });
    modeLabels.length = 0;
    modeLabels.push(modeLabel);
    setMode(mode);
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
            s.messages.push({ role: "tutor", text: "I won't just give you the answer, but I'll help you find it. Tell me what you think, or where you're stuck." });
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

    function paintChat() {
      clear(chatLog);
      for (const m of s.messages) {
        const bubble = h("div", { class: "chat-msg " + m.role });
        bubble.appendChild(richText(m.text));
        if (m.role === "tutor") { const b = speakerButton(m.text); if (b) bubble.appendChild(b); }
        chatLog.appendChild(bubble);
      }
      if (s.pending) chatLog.appendChild(h("div", { class: "chat-msg tutor thinking" }, s.waking ? "Waking Sabi up. The first answer takes about a minute…" : "Sabi is thinking…"));
      chatLog.scrollTop = chatLog.scrollHeight;
      sendBtn.disabled = s.pending;
    }

    // Offline mode can't read what the student typed, so it must not pretend to:
    // the authored steps were written as replies to a sensible student answer
    // ("Good, so…", "Exactly."), so we strip that praise and present each step
    // as a numbered hint. Obvious gibberish gets a gentle nudge instead.
    function guidedReply(studentText) {
      const blocked = checkChat(studentText);
      if (blocked) return CHAT_REPLIES[blocked];
      const steps = task.steps;
      if (s.guidedIndex < steps.length) {
        const n = s.guidedIndex + 1;
        const step = tidyDashes(stripPraise(steps[s.guidedIndex++]));
        return `Hint ${n} of ${steps.length}: ${step.charAt(0).toUpperCase()}${step.slice(1)}`;
      }
      return "That's all the hints I have for this one. You don reason am well. Lock in your answer!";
    }

    async function sendChat() {
      const text = chatInput.value.trim();
      if (!text || s.pending) return;
      chatInput.value = "";
      s.messages.push({ role: "student", text });
      round.chatTurns += 1;
      s.pending = true;
      paintChat();

      const blocked = checkChat(text);
      if (blocked) {
        // Never send insults or keyboard-mashing to the tutor: answer here, save the GPU.
        await new Promise((r) => setTimeout(r, 300));
        s.messages.push({ role: "tutor", text: CHAT_REPLIES[blocked] });
      } else if (mode === "model" || mode === "mock") {
        const turns = s.messages.filter((m) => m.role === "student" || m.role === "tutor").slice(1); // drop the greeting
        const msgs = turns.map((m, i) => ({
          role: m.role === "student" ? "user" : "assistant",
          content: i === 0 ? `Question: ${task.question}\n\n${m.text}` : m.text,
        }));
        try {
          const data = await chat(msgs, "sabi", { onWaking: () => { s.waking = true; paintChat(); } });
          s.messages.push({ role: "tutor", text: data.reply });
          if (mode === "model") round.liveAi = true;
        } catch (err) {
          setMode("offline");
          s.messages.push({ role: "note", text: `Live Sabi is unavailable (${err.message}). Switching to offline guided steps.` });
          s.messages.push({ role: "tutor", text: guidedReply(text) });
        }
      } else {
        await new Promise((r) => setTimeout(r, 500));
        s.messages.push({ role: "tutor", text: guidedReply(text) });
      }
      s.pending = false;
      s.waking = false;
      paintChat();
      const said = s.messages[s.messages.length - 1];
      if (isAutoRead() && said?.role === "tutor") speak(said.text);
    }

    // ---- checking the answer ----
    const sheet = h("div", { class: "result-sheet", hidden: true });
    const checkBtn = h("button", { class: "btn btn-primary btn-block", disabled: true, onclick: check }, "Lock in answer");

    function endTask(result) {
      s.done = true;
      round.results[round.index] = result;
      paintOptions();
      paintProgress();
      const right = result !== "missed";
      const last = round.index + 1 >= total;
      clear(sheet);
      sheet.hidden = false;
      sheet.className = "result-sheet " + (right ? "good" : "bad");
      sheet.append(
        h("h3", {}, right ? (result === "first" ? "You don sabi! 🎉" : "You got there! 👏") : "Na the correct one be this 👇"),
        h("p", {}, tidyDashes(task.explanation)),
        h("button", {
          class: "btn btn-primary btn-block next-task",
          onclick: () => {
            emit("ui:tap");
            round.index += 1;
            if (last) finishRound();
            else showTask(tasks[round.index]);
          },
        }, last ? "See my score" : "Next task ➜")
      );
      sheet.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    function check() {
      if (s.selected === null || s.done) return;
      if (s.selected === task.answer_index) {
        emit("answer:correct");
        endTask(s.wrong.size === 0 ? "first" : "second");
        return;
      }
      emit("answer:wrong");
      s.wrong.add(s.selected);
      s.selected = null;
      paintOptions();
      if (s.wrong.size < 2) {
        emit("toast", { text: "E no easy, one more try!", kind: "bad" });
        return;
      }
      // Two misses: the task is lost and costs 1 fuel.
      const fuelLeft = ask("loseHeart", null, null);
      if (fuelLeft === 0 && round.index + 1 < total) {
        s.done = true;
        round.results[round.index] = "missed";
        paintOptions();
        paintProgress();
        clear(sheet);
        sheet.hidden = false;
        sheet.className = "result-sheet bad";
        sheet.append(
          h("h3", {}, "Out of fuel ⛽"),
          h("p", {}, tidyDashes(task.explanation)),
          h("p", {}, "That one cost your last fuel. Practise a finished stop to refuel, then come back to this one."),
          h("button", { class: "btn btn-primary btn-block", onclick: () => emit("nav", { screen: "learn" }) }, "Back to route")
        );
        return;
      }
      emit("toast", { text: "That one cost 1 ⛽", kind: "bad" });
      endTask("missed");
    }

    taskArea.append(
      h("div", { class: "card question-card" }, richText(task.question)),
      h("div", { class: "options" }, optionEls),
      hintBox,
      h("div", { class: "tool-row" }, hintBtn, chatBtn),
      chatPanel,
      checkBtn,
      sheet
    );
    paintOptions();
    window.scrollTo({ top: 0 });
  }

  // ---- end of the round ----
  const feedbackSlot = h("div", { class: "feedback-slot" });

  function finishRound() {
    const firstTry = round.results.filter((r) => r === "first").length;
    const right = round.results.filter((r) => r !== "missed").length;
    const passed = right >= passMark;
    const result = ask("awardLesson", {
      lesson, correct: passed, firstTry: firstTry === total, hintsUsed: round.hintsUsed, chatTurns: round.chatTurns,
      round: { total, right, firstTry },
    }, null);
    paintProgress();
    clear(taskArea);
    taskArea.append(
      h("div", { class: "result-sheet round-summary " + (passed ? "good" : "bad") },
        h("div", { class: "big-emoji" }, passed ? (right === total ? "🏆" : "🎉") : "💪"),
        h("h3", {}, passed ? (right === total ? "Perfect round! You don sabi am well well!" : "Stop complete!") : "Almost there!"),
        h("p", { class: "round-score" }, `You got ${right} of ${total} right`),
        passed ? null : h("p", {}, `You need ${passMark} of ${total} to finish this stop. Try again, you go get am.`),
        result
          ? h("ul", { class: "xp-list" },
              result.parts.map((p) => h("li", {}, h("span", {}, p.label), p.xp ? h("strong", {}, `+${p.xp} XP`) : null)),
              h("li", { class: "xp-total" }, h("span", {}, result.replay ? "Practice total" : "Total"), h("strong", {}, `+${result.gained} XP`))
            )
          : null,
        feedbackSlot,
        h("div", { class: "btn-row" },
          passed ? null : h("button", { class: "btn btn-ghost", onclick: () => emit("nav", { screen: "lesson", params: { id: lesson.id } }) }, "Try again"),
          h("button", { class: "btn btn-primary", onclick: () => emit("nav", { screen: "learn" }) }, "Continue")
        )
      )
    );
    // The feedback feature (if loaded) fills feedbackSlot; nothing breaks without it.
    emit("lesson:finished", {
      slot: feedbackSlot,
      lesson: lesson.id, subject: lesson.subject, correct: passed, firstTry: firstTry === total,
      score: right, total, hints: round.hintsUsed, chatTurns: round.chatTurns, liveAi: round.liveAi,
    });
    window.scrollTo({ top: 0 });
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
      total > 1 ? h("div", { class: "task-progress" }, h("div", { class: "task-dots" }, dots), counter) : null,
      taskArea
    )
  );
  showTask(tasks[0]);
}

function stripPraise(step) {
  return step.replace(/^(good|great|yes|exactly|correct|that's (it|right)|right|nice|well done|perfect|ehen)\b[^.!?—–-]*[.!?—–-]+\s*/i, "");
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
