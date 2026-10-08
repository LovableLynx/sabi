// Minimal DOM builder: h("div", { class: "card", onclick }, "text", child).
// Strings are always inserted as text, never HTML, so user input is safe.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === false) continue;
    if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2), value);
    else if (key === "class") el.className = value;
    else if (key === "html") el.innerHTML = value; // only for trusted, built-in markup (SVG)
    else el.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    el.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

// Render text that may contain a markdown ledger table (Accounting) as a
// real <table>; everything else stays plain text with line breaks.
export function richText(text) {
  const wrap = h("div", { class: "rich" });
  const lines = String(text).split("\n");
  let i = 0;
  while (i < lines.length) {
    if (lines[i].trim().startsWith("|") && lines[i + 1] && /^\s*\|[\s:-]+\|/.test(lines[i + 1])) {
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(lines[i++]);
      const cells = rows
        .filter((_, idx) => idx !== 1)
        .map((r) => r.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
      const [head, ...body] = cells;
      wrap.appendChild(
        h("table", {},
          h("thead", {}, h("tr", {}, head.map((c) => h("th", {}, c)))),
          h("tbody", {}, body.map((r) => h("tr", {}, r.map((c) => h("td", {}, c)))))
        )
      );
    } else {
      const para = [];
      while (i < lines.length && !(lines[i].trim().startsWith("|") && lines[i + 1] && /^\s*\|[\s:-]+\|/.test(lines[i + 1]))) {
        para.push(lines[i++]);
      }
      const text = para.join("\n").trim();
      if (text) wrap.appendChild(h("p", {}, text));
    }
  }
  return wrap;
}
