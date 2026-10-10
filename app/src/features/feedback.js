// Anonymous pilot feedback after each finished lesson: two one-tap questions.
// Only shown, and only sent, when a Sabi server that accepts feedback is
// running (the live demo during supervised pilot sessions). No names or ids
// are sent: just the lesson, what the student did, and the two answers.

import { ask, on } from "../core/bus.js";
import { health, sendFeedback } from "../core/api.js";
import { h, clear } from "../core/dom.js";

function render(slot, ctx) {
  const answers = { helpful: null, gave_answer: ctx.chatTurns > 0 ? undefined : null };
  const box = h("div", { class: "feedback-box" });

  function send() {
    if (answers.helpful === null || answers.gave_answer === undefined) return;
    const profile = ask("profile", null, null);
    sendFeedback({
      lesson: ctx.lesson, subject: ctx.subject, level: profile?.level || null,
      helpful: answers.helpful, gave_answer: answers.gave_answer,
      correct: ctx.correct, first_try: ctx.firstTry, hints: ctx.hints,
      chat_turns: Math.min(ctx.chatTurns, 50), live_ai: !!ctx.liveAi,
    }).catch(() => {});
    clear(box).appendChild(h("p", { class: "feedback-thanks" }, "Thank you! 🙏 Your answer helps make Sabi better."));
  }

  function choiceRow(key, options) {
    const row = h("div", { class: "feedback-row" });
    options.forEach(([value, label]) => {
      row.appendChild(
        h("button", {
          class: "feedback-pick", type: "button",
          onclick: (e) => {
            answers[key] = value;
            row.querySelectorAll(".feedback-pick").forEach((b) => b.classList.remove("picked"));
            e.currentTarget.classList.add("picked");
            send();
          },
        }, label)
      );
    });
    return row;
  }

  box.append(
    h("p", { class: "feedback-q" }, "Did Sabi help you understand this one?"),
    choiceRow("helpful", [[1, "😕 Not really"], [2, "🙂 A bit"], [3, "😃 Yes!"]])
  );
  if (ctx.chatTurns > 0) {
    box.append(
      h("p", { class: "feedback-q" }, "When you chatted, did Sabi just tell you the answer?"),
      choiceRow("gave_answer", [[true, "Yes, it told me"], [false, "No, it helped me think"]])
    );
  }
  slot.appendChild(box);
}

export function init() {
  on("lesson:finished", (ctx) => {
    if (!ctx || !ctx.slot) return;
    health().then((st) => st.feedback && ctx.slot.isConnected && render(ctx.slot, ctx));
  });
}
