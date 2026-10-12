// Player profile: first + last name (kept on this device only), the public
// display name built from them ("Chidi O."), avatar, level, state and school.
// Owns the onboarding and
// profile screens. Other features read the profile with ask("profile").

import { answer, ask, emit, provide } from "../core/bus.js";
import { h, clear } from "../core/dom.js";
import { AVATARS, STATES } from "../core/nigeria.js";
import { load, save } from "../core/storage.js";
import { checkName, checkSchool } from "../core/validate.js";

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

// Capitalise each part of a name: "ọlá adébáyọ̀" -> "Ọlá Adébáyọ̀", "tunde-bakare" -> "Tunde-Bakare".
function titleCase(name) {
  return name.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (m, sep, ch) => sep + ch.toUpperCase());
}

function displayName(first, last) {
  if (!first) return "";
  const initial = last ? ` ${last.trim().charAt(0).toUpperCase()}.` : "";
  return `${first.charAt(0).toUpperCase()}${first.slice(1)}${initial}`.slice(0, 20);
}

function onboardingScreen(container, params = {}) {
  const editing = !!profile;
  let avatar = profile?.avatar || AVATARS[0];

  // Full name stays on this device. Only "First L." is ever shown publicly or
  // sent to the leaderboard, so strangers can't find a child by full name + school.
  const firstName = h("input", { class: "field", maxlength: 17, autocomplete: "given-name", placeholder: "e.g. Chidi",
    value: profile?.firstName || (profile && !profile.lastName ? profile.nickname : "") || "" });
  const lastName = h("input", { class: "field", maxlength: 30, autocomplete: "family-name", placeholder: "e.g. Okafor",
    value: profile?.lastName || "" });
  const preview = h("strong", {});
  const paintPreview = () => (preview.textContent = displayName(clean(firstName.value, 17), clean(lastName.value, 30)) || "...");
  firstName.addEventListener("input", paintPreview);
  lastName.addEventListener("input", paintPreview);
  paintPreview();
  const stateSel = h("select", { class: "field" },
    h("option", { value: "" }, "Choose your state"),
    STATES.map((s) => h("option", { value: s, selected: profile?.state === s }, s))
  );
  // School: pick from the real-schools list for the chosen state, or choose
  // "My school isn't listed" and type it (then it's marked unverified and
  // doesn't count in school rankings until confirmed).
  const listId = "school-list-" + Math.random().toString(36).slice(2);
  const school = h("input", { class: "field", maxlength: 60, list: listId, autocomplete: "off",
    placeholder: "Start typing your school…", value: profile?.school || "" });
  const datalist = h("datalist", { id: listId });
  const notListed = h("input", { type: "checkbox", checked: !!(profile && profile.schoolVerified === false) });
  const schoolHint = h("p", { class: "field-hint" });
  let schoolsByState = null; // null = list not loaded (offline or missing): free typing allowed
  const listed = (state) => (schoolsByState && schoolsByState[state]) || [];
  const findListed = (state, name) => listed(state).find((n) => n.toLowerCase() === name.toLowerCase());
  function refreshSchools() {
    clear(datalist);
    const names = listed(stateSel.value);
    names.forEach((n) => datalist.appendChild(h("option", { value: n })));
    if (!schoolsByState) schoolHint.textContent = "Type your school name.";
    else if (!stateSel.value) schoolHint.textContent = "Choose your state first to see its schools.";
    else if (notListed.checked) schoolHint.textContent = "✍️ Type your school's full name. It will show as unverified until confirmed.";
    else schoolHint.textContent = `📋 Pick from ${names.length} ${stateSel.value} schools, or tick the box below if yours isn't there.`;
  }
  stateSel.addEventListener("change", refreshSchools);
  notListed.addEventListener("change", refreshSchools);
  fetch("content/schools.json")
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => { schoolsByState = d && d.states ? d.states : null; refreshSchools(); })
    .catch(() => refreshSchools());
  refreshSchools();
  const consent = h("input", { type: "checkbox", checked: !!profile?.consent });
  // School level decides which exam track the student sees (others stay locked).
  let level = profile?.level || "";
  const LEVELS = [
    ["ncee", "🎒 Primary", "Common Entrance"],
    ["bece", "📘 JSS", "BECE"],
    ["waec", "🎓 SS", "WAEC / JAMB"],
  ];
  const levelRow = h("div", { class: "level-row" },
    LEVELS.map(([key, label, exam]) =>
      h("button", {
        class: "level-pick" + (level === key ? " picked" : ""),
        type: "button",
        "data-level": key,
        onclick: (e) => {
          level = key;
          levelRow.querySelectorAll(".level-pick").forEach((b) => b.classList.remove("picked"));
          e.currentTarget.classList.add("picked");
          emit("ui:tap");
        },
      }, h("strong", {}, label), h("span", { class: "small" }, exam))
    )
  );
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
          emit("avatar:sound", a);
        },
      }, a)
    )
  );

  function submit(e) {
    e.preventDefault();
    const first = titleCase(clean(firstName.value, 17));
    const last = titleCase(clean(lastName.value, 30));
    const nick = displayName(first, last);
    const sch = clean(school.value, 60);
    const nameError = checkName(first, "first name") || checkName(last, "last name");
    if (nameError) return (error.textContent = nameError);
    if (!stateSel.value) return (error.textContent = "Pick your state. It counts for the State leaderboard.");
    const schoolError = checkSchool(sch);
    if (schoolError) return (error.textContent = schoolError);
    let schoolName = sch;
    let schoolVerified = false;
    const match = schoolsByState && findListed(stateSel.value, sch);
    if (match) {
      schoolName = match; // use the list's exact spelling so classmates group together
      schoolVerified = true; // typed in full but it is on the list: same as picking it
    } else if (schoolsByState && !notListed.checked) {
      return (error.textContent = `Pick your school from the ${stateSel.value} list, or tick "My school isn't listed".`);
    }
    if (!level) return (error.textContent = "Choose your class level: Primary, JSS or SS.");
    profile = {
      id: profile?.id || newId(), firstName: first, lastName: last, nickname: nick,
      avatar, state: stateSel.value, school: schoolName, schoolVerified, level,
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
        h("p", { class: "muted" }, editing ? "Changes show on the leaderboard." : "Learn Literature, Physics and Accounting the Naija way, and carry your school and state to the top.")
      ),
      h("label", { class: "label" }, "Pick your avatar"), avatarRow,
      h("div", { class: "name-row" },
        h("label", { class: "label" }, "First name", firstName),
        h("label", { class: "label" }, "Last name", lastName)
      ),
      h("p", { class: "field-hint" }, "🛡️ Your full name stays on this phone. Other players only see ", preview, "."),
      h("label", { class: "label" }, "Your class level"), levelRow,
      h("label", { class: "label" }, "State", stateSel),
      h("label", { class: "label" }, "School", school), datalist, schoolHint,
      h("label", { class: "not-listed" }, notListed, h("span", {}, "My school isn't listed")),
      h("label", { class: "consent" }, consent,
        h("span", {}, "Show me on the School, State and Nigeria leaderboards. ",
          h("strong", {}, "I'm 18 or older, or a parent or teacher has said yes."))
      ),
      h("details", { class: "privacy" },
        h("summary", {}, "What does Sabi keep about me?"),
        h("p", {}, "On this phone or computer: your first and last name, avatar, class level, state, school and game progress."),
        h("p", {}, "Your full name never leaves this device. Only if you tick the box above, your first name and last initial (like \"Chidi O.\"), avatar, state, school and XP are sent to the Sabi leaderboard, where other players can see them. We never ask for your phone number, email or location."),
        h("p", {}, "What you type to Sabi in chat goes to the Sabi server (it runs on cloud computers) to get a reply, and is not saved to your profile. Never type your real name, address or phone number in chat."),
        h("p", {}, "You can delete everything at any time under Me → Delete my data.")
      ),
      error,
      h("button", { class: "btn btn-primary btn-block", type: "submit" }, editing ? "Save" : "Oya, let's go!"),
      !editing && h("button", { class: "btn btn-ghost btn-block", type: "button", onclick: () => emit("nav", { screen: "learn" }) }, "Skip for now (no leaderboard)")
    )
  );
  setTimeout(() => firstName.focus(), 50);
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
      h("button", {
        class: "big-avatar",
        type: "button",
        "aria-label": "Play avatar sound",
        title: "Tap to hear avatar sound",
        onclick: () => emit("avatar:sound", profile.avatar)
      }, profile.avatar),
      h("div", {},
        h("h2", {}, profile.firstName ? `${profile.firstName} ${profile.lastName}` : profile.nickname),
        profile.firstName ? h("p", { class: "muted small" }, `Others see you as ${profile.nickname}`) : null,
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
            h("div", { class: "muted small" }, r.next ? `${stats.xp} / ${r.next.xp} XP to ${r.next.name}` : `${stats.xp} XP. Top rank!`)
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
        ? `🌍 You appear on the leaderboards as ${profile.nickname}, with your avatar, state, school and XP. Your full name is never shared.`
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
