// The Learn screen: pick a stream, then ride a danfo route of units
// and bus stops (lessons). Lessons unlock in order when progress tracking is available;
// if it isn't, every lesson is open so the game is still playable.

import { answer, ask, emit, provide } from "../core/bus.js";
import { loadContent } from "../core/content.js";
import { h, clear } from "../core/dom.js";
import { SUBJECTS, TRACKS } from "../core/nigeria.js";
import { load, save } from "../core/storage.js";

let subject = SUBJECTS[load("subject", "physics")] ? load("subject", "physics") : "physics";

function subjectsIn(track, content) {
  return Object.entries(SUBJECTS).filter(([key, s]) => s.track === track && content.subjects[key]);
}

// Days left to the student's own exam (WAEC/JAMB, BECE or Common Entrance).
// Exam dates differ by school and year, so each student sets theirs; it is
// kept on this device per track.
function examCountdown(track, rerender) {
  const exam = TRACKS[track].short;
  const key = "examDate:" + track;
  const today = new Date(new Date().toDateString());
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const saved = load(key, null);
  // Ignore anything that isn't a real YYYY-MM-DD date (damaged or hand-edited data).
  const date = typeof saved === "string" && /^\d{4}-\d{2}-\d{2}$/.test(saved) && !isNaN(new Date(saved + "T00:00:00")) ? saved : null;
  const days = date ? Math.round((new Date(date + "T00:00:00") - today) / 86400000) : null;
  const input = h("input", { class: "field", type: "date", value: days !== null && days >= 0 ? date : "", min: iso(today), "aria-label": `${exam} date` });
  const saveBtn = h("button", {
    class: "btn btn-primary btn-small", type: "button",
    onclick: () => {
      if (!input.value) return emit("toast", { text: "Pick the date of your exam first.", kind: "bad" });
      if (input.value < iso(today)) return emit("toast", { text: "That date has already passed. Pick your next exam date.", kind: "bad" });
      save(key, input.value);
      emit("toast", { text: `📅 Exam date saved. Oya, let's prepare!`, kind: "good" });
      rerender();
    },
  }, "Save");
  if (days === null || days < 0) {
    return h("div", { class: "card exam-countdown" },
      h("div", {}, h("strong", {}, days < 0 ? `📅 Your ${exam} date has passed.` : `📅 When is your ${exam}?`),
        h("div", { class: "small muted" }, "Set the date and Sabi will count down the days with you.")),
      h("div", { class: "btn-row" }, input, saveBtn));
  }
  const change = h("button", { class: "btn btn-ghost btn-small", type: "button", onclick: () => { save(key, null); rerender(); } }, "Change");
  const message = days === 0 ? `📅 Your ${exam} is today. You don prepare, go and sabi am! 💪`
    : `📅 ${days} ${days === 1 ? "day" : "days"} to your ${exam}`;
  const tip = days === 0 ? "" : days <= 14 ? "Final stretch: try Exam mode on a stop to practise under time." : "A stop a day keeps the exam fear away.";
  return h("div", { class: "card exam-countdown" },
    h("div", {}, h("strong", {}, message), tip ? h("div", { class: "small muted" }, tip) : null), change);
}

function render(container, content) {
  clear(container);
  const tracking = ask("stats", null, null) !== null;
  const isDone = (id) => ask("lessonDone", id, false);
  if (!content.subjects[subject]) subject = Object.keys(content.subjects)[0]; // saved subject not in this build

  // Only offer tracks that have lessons in this build of the content.
  const tracks = Object.entries(TRACKS).filter(([key]) => subjectsIn(key, content).length);

  // The student's class level (chosen at registration, or here for guests)
  // decides which track is open; the others stay locked. If the profile
  // feature isn't available, the level is asked here and kept on this device.
  const level = ask("profile", null, null)?.level || load("guestLevel", null);
  if (!level && tracks.length > 1) {
    container.appendChild(
      h("div", { class: "card center level-ask" },
        h("h2", {}, "Which class are you in?"),
        h("p", { class: "muted" }, "We'll show you the lessons for your exam."),
        h("div", { class: "level-row" },
          [["ncee", "🎒 Primary", "Common Entrance"], ["bece", "📘 JSS", "BECE"], ["waec", "🎓 SS", "WAEC / JAMB"]]
            .filter(([key]) => tracks.some(([t]) => t === key))
            .map(([key, label, exam]) =>
              h("button", {
                class: "level-pick", type: "button", "data-level": key,
                onclick: () => { save("guestLevel", key); emit("ui:tap"); render(container, content); },
              }, h("strong", {}, label), h("span", { class: "small" }, exam))
            )
        )
      )
    );
    return;
  }
  if (level && SUBJECTS[subject]?.track !== level && subjectsIn(level, content).length) {
    subject = subjectsIn(level, content)[0][0];
  }
  const track = SUBJECTS[subject]?.track || "waec";

  if (tracks.length > 1) {
    container.appendChild(
      h("div", { class: "track-switch", role: "tablist" },
        tracks.map(([key, t]) => {
          const locked = level && key !== level;
          return h("button", {
            class: "track" + (key === track ? " active" : "") + (locked ? " locked" : ""),
            role: "tab",
            "aria-disabled": locked ? "true" : null,
            onclick: () => {
              if (locked) {
                emit("toast", { text: `🔒 That's for another class. Your level is ${TRACKS[level].short} . Change it under Me → Edit.`, kind: "info" });
                return;
              }
              if (key === track) return;
              subject = subjectsIn(key, content)[0][0];
              save("subject", subject);
              emit("ui:tap");
              render(container, content);
            },
          }, locked ? "🔒 " : null, t.label, t.pilot ? h("span", { class: "pilot-tag" }, "PILOT") : null);
        })
      )
    );
  }

  container.appendChild(
    h("div", { class: "subject-switch" },
      subjectsIn(track, content).map(([key, s]) =>
        h("button", {
          class: "subject-card" + (key === subject ? " active" : ""),
          style: `--subject:${s.color}`,
          onclick: () => { subject = key; save("subject", key); emit("ui:tap"); render(container, content); },
        },
          h("span", { class: "subject-emoji" }, s.emoji),
          h("strong", {}, s.label),
          h("span", { class: "small" }, s.stream)
        )
      )
    )
  );
  if (TRACKS[track].pilot) {
    container.appendChild(
      h("p", { class: "pilot-note" },
        `🧪 ${TRACKS[track].short} is a pilot track. Sabi's tutor was trained on WAEC/JAMB, so it may be less sharp here. Tell us what you think!`)
    );
  }

  container.appendChild(examCountdown(track, () => render(container, content)));

  const stats = ask("stats", null, null);
  if (stats && stats.hearts === 0) {
    const mins = Math.max(1, Math.ceil(stats.nextHeartIn / 60000));
    container.appendChild(
      h("p", { class: "fuel-note" },
        `⛽ Out of fuel. 1 fuel comes back every ${stats.refillMinutes || 20} minutes (next in about ${mins} min). Replay a finished stop to refuel faster.`)
    );
  }

  const data = content.subjects[subject];
  if (!data) {
    container.appendChild(h("div", { class: "card center muted" }, "Lessons for this subject are coming soon."));
    return;
  }

  let previousDone = true;
  const color = SUBJECTS[subject].color;
  data.units.forEach((unit, u) => {
    const doneCount = unit.lessons.filter((l) => isDone(l.id)).length;
    const section = h("section", { class: "unit", style: `--subject:${color}` },
      h("div", { class: "unit-banner" },
        h("div", {},
          h("span", { class: "small unit-kicker" }, `Unit ${u + 1}`),
          h("h2", {}, `${unit.emoji} ${unit.title}`)
        ),
        h("span", { class: "unit-count" }, `${doneCount}/${unit.lessons.length}`)
      )
    );
    // A danfo route: a road down the middle, bus-stop signs on alternate
    // sides, and the danfo parked at the next stop to finish.
    const road = h("div", { class: "route" });
    unit.lessons.forEach((lesson, l) => {
      const done = isDone(lesson.id);
      const open = !tracking || done || previousDone;
      const current = open && !done && tracking;
      road.appendChild(
        h("div", { class: "stop-row " + (l % 2 ? "right" : "left") },
          h("button", {
            class: "stop" + (done ? " done" : "") + (open ? "" : " locked") + (current ? " current" : ""),
            disabled: !open,
            "aria-label": `Stop ${l + 1}${done ? " (done)" : open ? "" : " (locked)"}`,
            onclick: () => { emit("ui:tap"); emit("nav", { screen: "lesson", params: { id: lesson.id } }); },
          },
            h("span", { class: "stop-tag" }, "BUS STOP"),
            h("span", { class: "stop-num" }, done ? "★" : open ? String(l + 1) : "🔒"),
            h("span", { class: "stop-sub" }, done ? "Done" : current ? "Board here" : open ? "Open" : "Locked"),
            h("span", { class: "stop-tasks" }, `${1 + (lesson.round?.length || 0)} tasks`)
          ),
          h("span", { class: "stop-post" }),
          current ? h("span", { class: "danfo", "aria-hidden": "true" }, "🚌") : null
        )
      );
      previousDone = done;
    });
    section.appendChild(road);
    container.appendChild(section);
  });
}

function screen(container) {
  container.appendChild(h("div", { class: "card center muted" }, "Loading lessons…"));
  loadContent()
    .then((content) => container.isConnected && render(container, content))
    .catch((err) => {
      clear(container).appendChild(
        h("div", { class: "card center" },
          h("h2", {}, "Couldn't load lessons"),
          h("p", { class: "muted" }, err.message),
          h("p", { class: "muted" }, "You can still chat with Sabi or check the leaderboard."),
          h("button", { class: "btn btn-primary", onclick: () => emit("nav", { screen: "learn" }) }, "Try again")
        )
      );
    });
}

export function init() {
  provide("screen:learn", screen);
}
