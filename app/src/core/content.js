// Lesson content (built by app/tools/build_content.py into content/game.json).
// Loaded once; a failure only affects screens that need lessons.

let contentPromise = null;

export function loadContent() {
  if (!contentPromise) {
    contentPromise = fetch("content/game.json")
      .then((res) => {
        if (!res.ok) throw new Error(`content/game.json returned ${res.status}`);
        return res.json();
      })
      .then(index)
      .catch((err) => {
        contentPromise = null; // allow a retry
        throw err;
      });
  }
  return contentPromise;
}

function index(raw) {
  const lessons = new Map();
  for (const [subject, data] of Object.entries(raw.subjects)) {
    data.units.forEach((unit, u) => {
      unit.lessons.forEach((lesson, l) => {
        lessons.set(lesson.id, {
          ...lesson,
          subject,
          unit,
          unitIndex: u,
          lessonIndex: l,
          next: unit.lessons[l + 1]?.id || data.units[u + 1]?.lessons[0]?.id || null,
        });
      });
    });
  }
  return { ...raw, lessons };
}
