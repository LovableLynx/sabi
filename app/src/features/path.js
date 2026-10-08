// The Learn screen: pick a stream, then ride a danfo route of units
// and bus stops (lessons). Lessons unlock in order when progress tracking is available;
// if it isn't, every lesson is open so the game is still playable.

import { answer, ask, emit, provide } from "../core/bus.js";
import { loadContent } from "../core/content.js";
import { h, clear } from "../core/dom.js";
import { SUBJECTS } from "../core/nigeria.js";
import { load, save } from "../core/storage.js";

let subject = load("subject", "physics");

function render(container, content) {
  clear(container);
  const tracking = ask("stats", null, null) !== null;
  const isDone = (id) => ask("lessonDone", id, false);

  container.appendChild(
    h("div", { class: "subject-switch" },
      Object.entries(SUBJECTS).map(([key, s]) =>
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
