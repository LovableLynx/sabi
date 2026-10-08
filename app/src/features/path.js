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

function render(container, content) {
  clear(container);
  const tracking = ask("stats", null, null) !== null;
  const isDone = (id) => ask("lessonDone", id, false);
  if (!content.subjects[subject]) subject = Object.keys(content.subjects)[0]; // saved subject not in this build
  const track = SUBJECTS[subject]?.track || "waec";

  // Only offer tracks that have lessons in this build of the content.
  const tracks = Object.entries(TRACKS).filter(([key]) => subjectsIn(key, content).length);
  if (tracks.length > 1) {
    container.appendChild(
      h("div", { class: "track-switch", role: "tablist" },
        tracks.map(([key, t]) =>
          h("button", {
            class: "track" + (key === track ? " active" : ""),
            role: "tab",
            onclick: () => {
              if (key === track) return;
              subject = subjectsIn(key, content)[0][0];
              save("subject", subject);
              emit("ui:tap");
              render(container, content);
            },
          }, t.label, t.pilot ? h("span", { class: "pilot-tag" }, "PILOT") : null)
        )
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
        `🧪 ${TRACKS[track].short} is a pilot track. Sabi's tutor was trained on WAEC/JAMB, so it may be less sharp here — tell us what you think!`)
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
            h("span", { class: "stop-sub" }, done ? "Done" : current ? "Board here" : open ? "Open" : "Locked")
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
