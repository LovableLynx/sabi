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
import { load, save } from "../core/storage.js";

// Exam mode: each question gets a countdown, like a real objective paper, and
// hints and Ask Sabi are switched off. Running out of time counts the task as
// missed but never costs fuel. Off by default; the choice is remembered.
const EXAM_SECONDS = 60;

const LETTERS = ["A", "B", "C", "D"];

function outOfFuel(container) {
  const stats = ask("stats", null, null);
  const mins = stats ? Math.ceil(stats.nextHeartIn / 60000) : null;
  container.appendChild(
    h("div", { class: "card center out-of-fuel" },
      h("div", { class: "big-emoji" }, "⛽"),
      h("h2", {}, "Your danfo don run out of fuel!"),
      h("p", {}, `Fuel comes back by itself: 1 every 20 minutes.${mins ? ` Your next fuel arrives in about ${mins} min.` : ""}`),
      h("p", { class: "muted" }, "Practise a stop you've already finished to earn fuel back, or ask Sabi anything in the meantime."),
      h("div", { class: "btn-row" },
        h("button", { class: "btn btn-primary", onclick: () => emit("nav", { screen: "learn" }) }, "Back to route"),
        h("button", { class: "btn btn-ghost", onclick: () => emit("nav", { screen: "chat" }) }, "Ask Sabi")
      )
    )
  );
}


// Real Nigerian & Premium Vehicles Roster
export const VEHICLES = [
  {
    id: "hijapa",
    name: "Hijapa",
    tier: "Starting Ride",
    color: "#22c55e",
    icon: "🐢",
    desc: "Small local Naija classic bug. Resilient and ready to roll.",
    svg: `<svg viewBox="0 0 100 48" class="car-svg"><ellipse cx="48" cy="24" rx="34" ry="16" fill="#15803d"/><path d="M 22 24 Q 48 8 74 24 Z" fill="#22c55e"/><circle cx="38" cy="20" r="6" fill="#bae6fd"/><circle cx="58" cy="20" r="6" fill="#bae6fd"/><rect x="74" y="22" width="6" height="4" rx="2" fill="#eab308"/><circle cx="30" cy="36" r="8" fill="#1f2937"/><circle cx="30" cy="36" r="3" fill="#9ca3af"/><circle cx="66" cy="36" r="8" fill="#1f2937"/><circle cx="66" cy="36" r="3" fill="#9ca3af"/></svg>`,
  },
  {
    id: "danfo",
    name: "Danfo",
    tier: "Level 1 Upgrade",
    color: "#eab308",
    icon: "🚌",
    desc: "Iconic Lagos yellow commercial bus with twin black stripes. Agile and sharp!",
    svg: `<svg viewBox="0 0 110 50" class="car-svg"><rect x="15" y="10" width="75" height="28" rx="6" fill="#facc15"/><rect x="15" y="24" width="75" height="5" fill="#18181b"/><rect x="15" y="31" width="75" height="5" fill="#18181b"/><rect x="22" y="14" width="14" height="8" rx="2" fill="#e0f2fe"/><rect x="40" y="14" width="14" height="8" rx="2" fill="#e0f2fe"/><rect x="58" y="14" width="14" height="8" rx="2" fill="#e0f2fe"/><rect x="76" y="14" width="10" height="8" rx="2" fill="#bae6fd"/><circle cx="89" cy="28" r="3" fill="#fef08a"/><circle cx="32" cy="38" r="8" fill="#27272a"/><circle cx="32" cy="38" r="3" fill="#a1a1aa"/><circle cx="75" cy="38" r="8" fill="#27272a"/><circle cx="75" cy="38" r="3" fill="#a1a1aa"/></svg>`,
  },
  {
    id: "brt",
    name: "BRT",
    tier: "Level 2 Upgrade",
    color: "#2563eb",
    icon: "🚍",
    desc: "Lagos Blue Mass Transit bus. Modern, high-capacity expressway cruiser.",
    svg: `<svg viewBox="0 0 130 52" class="car-svg"><rect x="12" y="8" width="98" height="30" rx="6" fill="#1d4ed8"/><rect x="12" y="24" width="98" height="4" fill="#ffffff"/><rect x="18" y="12" width="16" height="9" rx="2" fill="#dbeafe"/><rect x="38" y="12" width="16" height="9" rx="2" fill="#dbeafe"/><rect x="58" y="12" width="16" height="9" rx="2" fill="#dbeafe"/><rect x="78" y="12" width="16" height="9" rx="2" fill="#dbeafe"/><rect x="98" y="12" width="10" height="9" rx="2" fill="#bfdbfe"/><circle cx="109" cy="27" r="3" fill="#fef08a"/><circle cx="30" cy="38" r="8" fill="#1e293b"/><circle cx="30" cy="38" r="3" fill="#cbd5e1"/><circle cx="85" cy="38" r="8" fill="#1e293b"/><circle cx="85" cy="38" r="3" fill="#cbd5e1"/></svg>`,
  },
  {
    id: "jeep",
    name: "Jeep",
    tier: "Level 3 Upgrade",
    color: "#059669",
    icon: "🚙",
    desc: "Rugged lifted Naija 4x4 SUV. High ground clearance and tough bumper.",
    svg: `<svg viewBox="0 0 115 54" class="car-svg"><rect x="18" y="16" width="70" height="22" rx="4" fill="#047857"/><path d="M 32 16 L 46 8 L 74 8 L 84 16 Z" fill="#065f46"/><polygon points="48,10 72,10 80,16 48,16" fill="#a7f3d0"/><rect x="12" y="18" width="6" height="18" rx="3" fill="#111827"/><rect x="88" y="24" width="4" height="10" rx="2" fill="#475569"/><circle cx="88" cy="26" r="3" fill="#fef08a"/><circle cx="34" cy="38" r="10" fill="#0f172a"/><circle cx="34" cy="38" r="4" fill="#94a3b8"/><circle cx="74" cy="38" r="10" fill="#0f172a"/><circle cx="74" cy="38" r="4" fill="#94a3b8"/></svg>`,
  },
  {
    id: "escalade",
    name: "Escalade",
    tier: "Level 4 Upgrade",
    color: "#0f172a",
    icon: "🚘",
    desc: "Executive Obsidian Black Luxury SUV. Chrome accents & VIP privacy glass.",
    svg: `<svg viewBox="0 0 125 52" class="car-svg"><rect x="14" y="14" width="86" height="24" rx="5" fill="#09090b"/><path d="M 32 14 L 46 7 L 82 7 L 94 14 Z" fill="#18181b"/><polygon points="48,9 80,9 90,14 48,14" fill="#38bdf8"/><rect x="94" y="22" width="5" height="12" fill="#e2e8f0"/><line x1="14" y1="26" x2="100" y2="26" stroke="#94a3b8" stroke-width="1.5"/><circle cx="98" cy="22" r="3" fill="#ffffff"/><circle cx="34" cy="38" r="9" fill="#09090b" stroke="#cbd5e1" stroke-width="2"/><circle cx="34" cy="38" r="3" fill="#f1f5f9"/><circle cx="82" cy="38" r="9" fill="#09090b" stroke="#cbd5e1" stroke-width="2"/><circle cx="82" cy="38" r="3" fill="#f1f5f9"/></svg>`,
  },
  {
    id: "limousine",
    name: "Limousine",
    tier: "Supreme VIP",
    color: "#6b21a8",
    icon: "🏎️",
    desc: "Ultra-stretch VIP Presidential Limousine. The highest pinnacle of style!",
    svg: `<svg viewBox="0 0 155 50" class="car-svg"><rect x="10" y="15" width="126" height="21" rx="5" fill="#3b0764"/><rect x="30" y="10" width="88" height="12" rx="4" fill="#581c87"/><rect x="36" y="12" width="16" height="7" rx="1.5" fill="#cbd5e1"/><rect x="56" y="12" width="16" height="7" rx="1.5" fill="#cbd5e1"/><rect x="76" y="12" width="16" height="7" rx="1.5" fill="#cbd5e1"/><rect x="96" y="12" width="16" height="7" rx="1.5" fill="#cbd5e1"/><line x1="10" y1="25" x2="136" y2="25" stroke="#facc15" stroke-width="2"/><polygon points="135,16 138,13 138,19" fill="#e11d48"/><circle cx="134" cy="22" r="3" fill="#ffffff"/><circle cx="28" cy="36" r="8" fill="#18181b" stroke="#facc15" stroke-width="1.5"/><circle cx="28" cy="36" r="3" fill="#e2e8f0"/><circle cx="114" cy="36" r="8" fill="#18181b" stroke="#facc15" stroke-width="1.5"/><circle cx="114" cy="36" r="3" fill="#e2e8f0"/></svg>`,
  },
];

// Nigerian Conductor & Driver Street Slangs
export const GOOD_SLANGS = [
  "Pigeon soul, oh well done, you sabi! 🕊️",
  "Drive on now! No stopping on Third Mainland! 🚗💨",
  "You dey move! Speed throttle! 🚀",
  "Oya clear road for this ride! 🛣️",
  "Motor don accelerate, you sharp well well! 🔥",
  "Master driver! Green light all the way! 🟢",
];

export const WRONG_SLANGS = [
  "Hold am! Hold am! Wrong bus stop! 🛑",
  "Oga driver, step on brake quick! ⚠️",
  "Which kind turn be this? Park well first! 🚌",
  "Conductor say: Wait first, check your map! 🔄",
  "Engine cough small! Cool down reason am! ⛽",
];

// Random positive achievement cards awarded at end of stage
export const REWARD_CARDS = [
  {
    id: "expressway-master",
    icon: "🛣️",
    title: "Expressway Master",
    tag: "High Velocity",
    condition: (score, total, fastCount) => fastCount >= 3,
    blurb: "You navigated the bus route with lightning speed. Pure throttle!",
  },
  {
    id: "distinction-scholar",
    icon: "⭐",
    title: "Naija Distinction Scholar",
    tag: "Top Accuracy",
    condition: (score, total) => score >= total * 0.8,
    blurb: "Academic perfection! Your brain compass nailed every twist and turn.",
  },
  {
    id: "limo-vip",
    icon: "🏎️",
    title: "Presidential Fleet VIP",
    tag: "Highway Prestige",
    condition: (score, total, fastCount, vehIdx) => vehIdx >= 2,
    blurb: "Cruising in top luxury! You upgraded high up the transport hierarchy.",
  },
  {
    id: "sabi-navigator",
    icon: "🧭",
    title: "Sharp Route Navigator",
    tag: "Resilient Sabi",
    condition: (score, total, fastCount, vehIdx, hints) => hints <= 1,
    blurb: "Zero traffic held you back. You read every question with complete clarity!",
  },
  {
    id: "danfo-hustler",
    icon: "🚌",
    title: "Lagos Street Hustler",
    tag: "No Dulling",
    condition: () => true,
    blurb: "Pure energy and resilience! You kept the wheels moving forward to victory.",
  },
  {
    id: "lionheart-scholar",
    icon: "🦁",
    title: "Lionheart Scholar",
    tag: "Courageous Mind",
    condition: (score, total, fastCount, vehIdx, hints, firstTry) => firstTry >= total * 0.7,
    blurb: "Unshakable first-try focus of a champion. The road belongs to you!",
  },
];

// A stop is a round of tasks: the stop's exam question first (with Sabi's
// authored guiding steps), then practice tasks on the same idea. A wrong first
// try is free; failing a task costs 1 fuel. The stop is passed with 60%.
const PASS_SHARE = 0.6;

function render(container, content, lesson) {
  const subject = SUBJECTS[lesson.subject];
  // On a replay of a finished stop, the practice tasks come in a new order
  // with their options mixed, so it doesn't feel like the same round again.
  const replaying = ask("lessonDone", lesson.id, false);
  const shuffle = (list) => {
    const a = [...list];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const mixOptions = (t) => {
    const order = shuffle([0, 1, 2, 3]);
    return { ...t, options: order.map((i) => t.options[i]), answer_index: order.indexOf(t.answer_index) };
  };
  const practice = (lesson.round || []).map((t) => ({ ...t, steps: t.hint ? [t.hint] : [] }));
  const tasks = [
    { ...lesson, steps: content.guided[lesson.source_id] || [] },
    ...(replaying ? shuffle(practice).map(mixOptions) : practice),
  ];
  const total = tasks.length;
  const passMark = Math.ceil(total * PASS_SHARE);
  const round = { index: 0, results: [], hintsUsed: 0, chatTurns: 0, liveAi: false };
  const replay = ask("lessonDone", lesson.id, false); // practising a finished stop never strands you
  let examMode = load("examMode", false);
  let examTimer = null;
  const stopTimer = () => { clearInterval(examTimer); examTimer = null; };
  let restartTask = null; // set by showTask so the exam toggle can restart an untouched task
  let mode = "checking"; // model | mock | offline

  // ---- car journey state & performance progression ----
  let currentVehicleIdx = 0; // Everyone starts with Hijapa
  let carSpeedState = "moving"; // moving | fast | stopped
  let fastCorrectCount = 0;
  let correctCount = 0;

  function evaluateCarUpgrade(isFast, isFirstTry) {
    if (isFirstTry) correctCount += 1;
    if (isFast && isFirstTry) fastCorrectCount += 1;

    let targetVehicle = currentVehicleIdx;
    if (fastCorrectCount >= 8 && correctCount >= 8) targetVehicle = 5; // Limousine
    else if (fastCorrectCount >= 6 && correctCount >= 6) targetVehicle = 4; // Escalade
    else if (fastCorrectCount >= 4 && correctCount >= 4) targetVehicle = 3; // Jeep
    else if (fastCorrectCount >= 2) targetVehicle = 2; // BRT
    else if (fastCorrectCount >= 1) targetVehicle = 1; // Danfo

    if (targetVehicle > currentVehicleIdx) {
      currentVehicleIdx = targetVehicle;
      const upgraded = VEHICLES[currentVehicleIdx];
      emit("toast", {
        text: `🚀 VEHICLE UPGRADE! You don upgrade to ${upgraded.name} (${upgraded.tier})! ${upgraded.icon}`,
        kind: "good",
      });
      emit("rank:up", { name: upgraded.name });
    }
  }

  const modeLabels = [];
  function setMode(m) {
    mode = m;
    for (const el of modeLabels) {
      el.textContent = { model: "Live · fine-tuned N-ATLAS", mock: "Test mode", offline: "Offline guided steps", checking: "Connecting…" }[m];
      el.className = "mode-label mode-" + m;
    }
  }
  health().then((st) => setMode(st.tutor === "offline" ? "offline" : st.tutor));

  // ---- car journey ui (Option A: persistent top road) ----
  const carRunner = h("div", { class: "journey-car-runner moving", html: VEHICLES[0].svg });
  const roadDashes = h("div", { class: "journey-road-dashes moving" });
  const carStatus = h("span", { class: "journey-status-text" }, `${VEHICLES[0].icon} ${VEHICLES[0].name}`);

  function openFleetModal() {
    emit("ui:tap");
    const modal = h("div", { class: "fleet-modal-backdrop", onclick: (e) => { if (e.target === modal) modal.remove(); } },
      h("div", { class: "fleet-modal card" },
        h("div", { class: "fleet-modal-head" },
          h("h3", {}, "🚘 Sabi Highway Fleet"),
          h("button", { class: "icon-btn", type: "button", onclick: () => modal.remove() }, "✕")
        ),
        h("p", { class: "muted small" }, "Start with the humble Hijapa. Answer correctly and with good speed to upgrade through Danfo, BRT, Jeep, Escalade, and Limousine!"),
        h("div", { class: "fleet-grid" },
          VEHICLES.map((veh, idx) => {
            const isCurrent = idx === currentVehicleIdx;
            const isUnlocked = idx <= currentVehicleIdx;
            return h("div", { class: "fleet-card" + (isCurrent ? " current" : "") + (isUnlocked ? " unlocked" : "") },
              h("div", { class: "fleet-card-badge" }, isCurrent ? "Active Ride" : isUnlocked ? "Unlocked" : `Stage ${idx + 1}`),
              h("div", { class: "fleet-svg-wrap", html: veh.svg }),
              h("strong", {}, `${veh.icon} ${veh.name}`),
              h("span", { class: "fleet-tier small" }, veh.tier),
              h("p", { class: "fleet-desc small muted" }, veh.desc)
            );
          })
        ),
        h("button", { class: "btn btn-primary btn-block", type: "button", onclick: () => modal.remove() }, "Back to Driving")
      )
    );
    document.body.appendChild(modal);
  }

  const fleetBtn = h("button", {
    class: "journey-fleet-btn",
    type: "button",
    onclick: openFleetModal,
    "aria-label": "View Nigerian car fleet and upgrades",
  }, "🚘 Fleet");

  const journeyBar = h("div", { class: "journey-bar card" },
    h("div", { class: "journey-info-row" },
      h("div", { class: "journey-title-wrap" },
        h("span", { class: "journey-kicker small" }, "🛣️ Express Journey"),
        carStatus
      ),
      fleetBtn
    ),
    h("div", { class: "journey-road-box", onclick: openFleetModal, title: "Tap to view vehicle fleet" },
      h("span", { class: "journey-flag-start small" }, "🏁"),
      h("div", { class: "journey-road-surface" },
        roadDashes,
        carRunner
      ),
      h("span", { class: "journey-flag-end small" }, `🚏 Stop ${lesson.lessonIndex + 1}`)
    )
  );

  function updateJourneyCar() {
    const v = VEHICLES[currentVehicleIdx];
    carRunner.innerHTML = v.svg;
    carStatus.textContent = `${v.icon} ${v.name}`;
    const percent = Math.min(92, Math.max(2, Math.round((round.index / total) * 100)));
    carRunner.style.left = `calc(${percent}% - 22px)`;
    roadDashes.className = `journey-road-dashes ${carSpeedState}`;
    carRunner.className = `journey-car-runner ${carSpeedState}`;
  }

  // ---- progress dots ----
  const dots = tasks.map(() => h("span", { class: "task-dot" }));
  const counter = h("span", { class: "task-count" });
  function paintProgress() {
    dots.forEach((d, i) => {
      const r = round.results[i];
      d.className = "task-dot" + (i === round.index && r === undefined ? " now" : "") + (r === "first" || r === "second" ? " right" : "") + (r === "missed" ? " missed" : "");
    });
    counter.textContent = round.index < total ? `Task ${round.index + 1} of ${total}` : `${total} of ${total} done`;
    updateJourneyCar();
  }

  const taskArea = h("div", { class: "task-area" });

  function showTask(task) {
    const s = { selected: null, wrong: new Set(), eliminated: new Set(), hintsUsed: 0, done: false, messages: [], guidedIndex: 0, pending: false, waking: false };
    const taskStartTime = Date.now();
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

    function endTask(result, slang) {
      stopTimer();
      s.done = true;
      round.results[round.index] = result;
      paintOptions();
      paintProgress();
      const right = result !== "missed";
      const last = round.index + 1 >= total;
      clear(sheet);
      sheet.hidden = false;
      sheet.className = "result-sheet " + (right ? "good" : "bad");
      const conductorQuote = slang || (right ? "Drive on now, you sabi am!" : "Hold am! Wrong turn!");
      sheet.append(
        h("div", { class: "journey-conductor-callout " + (right ? "good" : "bad") },
          h("span", { class: "small kicker" }, right ? "🗣️ Driver & Conductor:" : "🛑 Conductor caution:"),
          h("strong", {}, conductorQuote)
        ),
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
      const elapsed = (Date.now() - taskStartTime) / 1000;
      const isFast = elapsed <= 14;

      if (s.selected === task.answer_index) {
        emit("answer:correct");
        carSpeedState = isFast ? "fast" : "moving";
        const isFirstTry = s.wrong.size === 0;
        evaluateCarUpgrade(isFast, isFirstTry);
        const slang = GOOD_SLANGS[Math.floor(Math.random() * GOOD_SLANGS.length)];
        emit("toast", { text: slang, kind: "good" });
        endTask(isFirstTry ? "first" : "second", slang);
        return;
      }

      emit("answer:wrong");
      carSpeedState = "stopped";
      updateJourneyCar();
      const wrongSlang = WRONG_SLANGS[Math.floor(Math.random() * WRONG_SLANGS.length)];
      s.wrong.add(s.selected);
      s.selected = null;
      paintOptions();
      if (s.wrong.size < 2) {
        emit("toast", { text: `${wrongSlang} E no easy, one more try!`, kind: "bad" });
        return;
      }

      // Two misses: the task is lost and costs 1 fuel.
      const fuelLeft = ask("loseHeart", null, null);
      if (fuelLeft === 0 && round.index + 1 < total && !replay) {
        stopTimer();
        s.done = true;
        round.results[round.index] = "missed";
        paintOptions();
        paintProgress();
        clear(sheet);
        sheet.hidden = false;
        sheet.className = "result-sheet bad";
        sheet.append(
          h("div", { class: "journey-conductor-callout bad" },
            h("span", { class: "small kicker" }, "🛑 Conductor caution:"),
            h("strong", {}, wrongSlang)
          ),
          h("h3", {}, "Out of fuel ⛽"),
          h("p", {}, tidyDashes(task.explanation)),
          h("p", {}, "That one cost your last fuel. Practise a finished stop to refuel, then come back to this one."),
          h("button", { class: "btn btn-primary btn-block", onclick: () => emit("nav", { screen: "learn" }) }, "Back to route")
        );
        return;
      }
      emit("toast", { text: `${wrongSlang} That one cost 1 ⛽. Fuel comes back by itself, 1 every 20 minutes.`, kind: "bad" });
      endTask("missed", wrongSlang);
    }

    // ---- exam-mode countdown ----
    stopTimer();
    const timerBox = h("div", { class: "exam-timer", hidden: !examMode });
    if (examMode) {
      let left = EXAM_SECONDS;
      const paint = () => {
        timerBox.textContent = `⏱ ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
        timerBox.classList.toggle("low", left <= 10);
      };
      paint();
      examTimer = setInterval(() => {
        if (!taskArea.isConnected) return stopTimer(); // left the lesson
        left -= 1;
        paint();
        if (left <= 0 && !s.done) {
          emit("answer:wrong");
          emit("toast", { text: "⏱ Time up! In the exam hall, move on and come back later. No fuel lost.", kind: "bad" });
          endTask("missed", "Time don finish! Next one.");
        }
      }, 1000);
    }
    restartTask = () => { if (!s.done && s.wrong.size === 0 && s.selected === null) showTask(task); };

    taskArea.append(
      timerBox,
      h("div", { class: "card question-card" }, richText(task.question)),
      h("div", { class: "options" }, optionEls),
      hintBox,
      examMode ? h("p", { class: "muted small exam-note" }, "📝 Exam mode: no hints or Ask Sabi, just like the exam hall.") : h("div", { class: "tool-row" }, hintBtn, chatBtn),
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
    stopTimer();
    const firstTry = round.results.filter((r) => r === "first").length;
    const right = round.results.filter((r) => r !== "missed").length;
    const passed = right >= passMark;
    const result = ask("awardLesson", {
      lesson, correct: passed, firstTry: firstTry === total, hintsUsed: round.hintsUsed, chatTurns: round.chatTurns,
      round: { total, right, firstTry },
    }, null);

    let rewardCardEl = null;
    if (passed) {
      const candidates = REWARD_CARDS.filter((c) =>
        c.condition(right, total, fastCorrectCount, currentVehicleIdx, round.hintsUsed, firstTry)
      );
      const chosen = candidates[Math.floor(Math.random() * candidates.length)] || REWARD_CARDS[0];
      rewardCardEl = h("div", { class: "stage-reward-card" },
        h("div", { class: "reward-card-badge small" }, `🎁 STAGE REWARD CARD · ${chosen.tag}`),
        h("div", { class: "reward-card-icon" }, chosen.icon),
        h("strong", { class: "reward-card-title" }, chosen.title),
        h("p", { class: "reward-card-blurb small" }, chosen.blurb)
      );
    }

    paintProgress();
    clear(taskArea);
    taskArea.append(
      h("div", { class: "result-sheet round-summary " + (passed ? "good" : "bad") },
        h("div", { class: "big-emoji" }, passed ? (right === total ? "🏆" : "🎉") : "💪"),
        h("h3", {}, passed ? (right === total ? "Perfect round! You don sabi am well well!" : "Stop complete!") : "Almost there!"),
        h("p", { class: "round-score" }, `You got ${right} of ${total} right`),
        rewardCardEl,
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

  // ---- exam mode switch ----
  const examToggle = h("button", {
    class: "exam-toggle" + (examMode ? " on" : ""), type: "button",
    onclick: () => {
      examMode = !examMode;
      save("examMode", examMode);
      examToggle.className = "exam-toggle" + (examMode ? " on" : "");
      examToggle.textContent = examMode ? `⏱ Exam mode: ON (${EXAM_SECONDS} s per question)` : "⏱ Exam mode: OFF";
      emit("toast", { text: examMode ? `⏱ Exam mode on: ${EXAM_SECONDS} seconds per question, no hints. Like the real exam!` : "Exam mode off. Take your time and use hints.", kind: "info" });
      if (restartTask) restartTask(); // applies now if this question hasn't been tried yet, else from the next one
    },
  }, examMode ? `⏱ Exam mode: ON (${EXAM_SECONDS} s per question)` : "⏱ Exam mode: OFF");

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
      journeyBar,
      total > 1 ? h("div", { class: "task-progress" }, h("div", { class: "task-dots" }, dots), counter) : null,
      examToggle,
      taskArea
    )
  );
  showTask(tasks[0]);
}

function stripPraise(step) {
  return step.replace(/^(good|great|yes|exactly|correct|that's (it|right)|right|nice|well done|perfect|ehen)\b[^.!?—–-]*[.!?—–-]+\s*/i, "");
}


function screen(container, params = {}) {
  // With no fuel, new stops wait, but finished stops can still be replayed:
  // that is how students earn fuel back.
  if (!ask("canPlay", null, true) && !ask("lessonDone", params.id, false)) {
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
