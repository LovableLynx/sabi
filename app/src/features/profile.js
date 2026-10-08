// Player profile: nickname, avatar, state and school. Owns the onboarding and
// profile screens. Other features read the profile with ask("profile").

import { answer, ask, emit, provide } from "../core/bus.js";
import { h } from "../core/dom.js";
import { AVATARS, STATES } from "../core/nigeria.js";
import { load, save } from "../core/storage.js";

let profile = load("profile", null);
let deleteArmed = false; // "Delete my data" needs two taps

function newId() {
  try {
    return crypto.randomUUID();
  } catch {
    return "p-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
}

function clean(text, max) {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, max);
}

// Mirrors the server's checks so students get instant, friendly feedback.
// The server (serve_sabi.py) is still the authority.
const BLOCKED = ["fuck", "shit", "bitch", "pussy", "nigga", "nigger", "slut", "whore", "bastard",
  "ashawo", "olodo", "mumu", "werey", "yeye", "sex", "porn", "admin", "nitda", "moderator"];

function nameProblem(value) {
  const lowered = value.toLowerCase();
  const squashed = lowered.replace(/[^a-z0-9]/g, "");
  if (/https?:|www\.|\.(com|ng|net|org)\b|@/.test(lowered)) return "links and @handles aren't allowed";
  if ((value.match(/\d/g) || []).length >= 7) return "phone numbers aren't allowed";
  if (BLOCKED.some((w) => squashed.includes(w))) return "please choose a friendlier name";
  return null;
}

function onboardingScreen(container, params = {}) {
  const editing = !!profile;
  let avatar = profile?.avatar || AVATARS[0];

  const nickname = h("input", { class: "field", maxlength: 20, placeholder: "e.g. ChidiSabi", value: profile?.nickname || "" });
  const stateSel = h("select", { class: "field" },
    h("option", { value: "" }, "Choose your state"),
    STATES.map((s) => h("option", { value: s, selected: profile?.state === s }, s))
  );
  const school = h("input", { class: "field", maxlength: 60, placeholder: "e.g. Kings College, Lagos", value: profile?.school || "" });
  const consent = h("input", { type: "checkbox", checked: !!profile?.consent });
  const error = h("p", { class: "form-error" });

  const avatarRow = h("div", { class: "avatar-row" },
    AVATARS.map((a) =>
      h("button", {
        class: "avatar-pick" + (a === avatar ? " picked" : ""),
        type: "button",
        "aria-label": "Avatar " + a,
        onclick: (e) => {
          avatar = a;
          avatarRow.querySelectorAll(".avatar-pick").forEach((b) => b.classList.remove("picked"));
          e.currentTarget.classList.add("picked");
          emit("ui:tap");
        },
      }, a)
    )
  );

  function submit(e) {
    e.preventDefault();
    const nick = clean(nickname.value, 20);
    const sch = clean(school.value, 60);
    if (nick.length < 2) return (error.textContent = "Nickname must be at least 2 letters.");
    if (!stateSel.value) return (error.textContent = "Pick your state — it counts for the State leaderboard.");
    if (sch.length < 2) return (error.textContent = "Type your school name — it counts for the School leaderboard.");
    const problem = nameProblem(nick) || nameProblem(sch);
    if (problem) return (error.textContent = `Hmm — ${problem}.`);
    profile = {
      id: profile?.id || newId(), nickname: nick, avatar, state: stateSel.value, school: sch,
      consent: consent.checked, createdAt: profile?.createdAt || Date.now(),
    };
    save("profile", profile);
    emit("profile:changed", profile);
    emit("nav", { screen: editing ? "profile" : "learn" });
  }

  container.appendChild(
    h("form", { class: "card onboarding", onsubmit: submit },
      h("div", { class: "onboarding-hero" },
        h("h1", {}, editing ? "Edit your profile" : "Welcome to Sabi Arena"),
        h("p", { class: "muted" }, editing ? "Changes show on the leaderboard." : "Learn Literature, Physics and Accounting the Naija way — and carry your school and state to the top.")
      ),
      h("label", { class: "label" }, "Pick your avatar"), avatarRow,
      h("label", { class: "label" }, "Nickname", nickname),
      h("p", { class: "field-hint" }, "🛡️ Use a nickname — not your real name, phone number or address."),
      h("label", { class: "label" }, "State", stateSel),
      h("label", { class: "label" }, "School", school),
      h("label", { class: "consent" }, consent,
        h("span", {}, "Show me on the School, State and Nigeria leaderboards. ",
          h("strong", {}, "I'm 18 or older, or a parent or teacher has said yes."))
      ),
      h("details", { class: "privacy" },
        h("summary", {}, "What does Sabi keep about me?"),
        h("p", {}, "On this phone or computer: your nickname, avatar, state, school and game progress."),
        h("p", {}, "Only if you tick the box above, your nickname, avatar, state, school and XP are sent to the Sabi leaderboard, where other players can see them. Nothing else is sent, and we never ask for your real name, phone number, email or location."),
        h("p", {}, "What you type to Sabi in chat goes to the Sabi server to get a reply and is not saved to your profile."),
        h("p", {}, "You can delete everything at any time under Me → Delete my data.")
      ),
      error,
      h("button", { class: "btn btn-primary btn-block", type: "submit" }, editing ? "Save" : "Oya, let's go!"),
      !editing && h("button", { class: "btn btn-ghost btn-block", type: "button", onclick: () => emit("nav", { screen: "learn" }) }, "Skip for now (no leaderboard)")
    )
  );
  setTimeout(() => nickname.focus(), 50);
}

function profileScreen(container) {
  if (!profile) {
    container.appendChild(
      h("div", { class: "card center" },
        h("h2", {}, "No profile yet"),
        h("p", { class: "muted" }, "Create one to join the School and State leaderboards."),
        h("button", { class: "btn btn-primary", onclick: () => emit("nav", { screen: "onboarding" }) }, "Create profile")
      )
    );
    return;
  }

  container.appendChild(
    h("div", { class: "card profile-head" },
      h("div", { class: "big-avatar" }, profile.avatar),
      h("div", {},
        h("h2", {}, profile.nickname),
        h("p", { class: "muted" }, `${profile.school} · ${profile.state}`)
      ),
      h("button", { class: "btn btn-ghost btn-small", onclick: () => emit("nav", { screen: "onboarding" }) }, "Edit")
    )
  );

  const stats = ask("stats", null, null);
  if (stats) {
    const r = stats.rank;
    container.appendChild(
      h("div", { class: "card" },
        h("div", { class: "rank-line" },
          h("span", { class: "rank-icon" }, r.icon),
          h("div", { class: "grow" },
            h("strong", {}, r.name),
            h("div", { class: "muted small" }, r.blurb),
            h("div", { class: "bar" }, h("div", { class: "bar-fill", style: `width:${Math.round(r.progress * 100)}%` })),
            h("div", { class: "muted small" }, r.next ? `${stats.xp} / ${r.next.xp} XP to ${r.next.name}` : `${stats.xp} XP — top rank!`)
          )
        ),
        h("div", { class: "stat-row" },
          h("div", { class: "stat" }, h("strong", {}, `🔥 ${stats.streak}`), h("span", {}, "day streak")),
          h("div", { class: "stat" }, h("strong", {}, `⭐ ${stats.xp}`), h("span", {}, "total XP")),
          h("div", { class: "stat" }, h("strong", {}, `✅ ${stats.lessonsDone}`), h("span", {}, "lessons"))
        )
      )
    );
  }

  const titles = ask("titles", null, []);
  if (titles.length) {
    container.appendChild(
      h("div", { class: "card" },
        h("h3", {}, "Your titles"),
        h("div", { class: "title-list" }, titles.map((t) => h("span", { class: "title-chip" }, t)))
      )
    );
  }

  container.appendChild(
    h("div", { class: "card" },
      h("h3", {}, "Privacy"),
      h("p", { class: "muted small" }, profile.consent
        ? "🌍 You appear on the leaderboards with your nickname, avatar, state, school and XP."
        : "🔒 Private: your scores stay on this device. Turn on sharing under Edit (with a parent's or teacher's OK)."),
      h("button", {
        class: "btn btn-danger btn-small",
        onclick: () => {
          if (!deleteArmed) {
            deleteArmed = true;
            emit("toast", { text: "Tap again to delete all your Sabi data on this device and the leaderboard.", kind: "bad" });
            setTimeout(() => (deleteArmed = false), 4000);
            return;
          }
          deleteArmed = false;
          emit("data:delete", { id: profile.id });
          profile = null;
          save("profile", null);
          save("seenOnboarding", false);
          emit("profile:changed", null);
          emit("toast", { text: "Your Sabi data has been deleted.", kind: "good" });
          emit("nav", { screen: "onboarding" });
        },
      }, "Delete my data")
    )
  );

  const badges = ask("badges", null, null);
  if (badges) {
    container.appendChild(
      h("div", { class: "card" },
        h("h3", {}, `Badges · ${badges.filter((b) => b.earned).length}/${badges.length}`),
        h("div", { class: "badge-grid" },
          badges.map((b) =>
            h("div", { class: "badge" + (b.earned ? " earned" : ""), title: b.desc },
              h("span", { class: "badge-icon" }, b.earned ? b.icon : "🔒"),
              h("strong", {}, b.name),
              h("span", { class: "muted small" }, b.desc)
            )
          )
        )
      )
    );
  }
}

export function init() {
  answer("profile", () => profile);
  provide("screen:onboarding", onboardingScreen);
  provide("screen:profile", profileScreen);
}
