"""
Build app/content/game.json from the lesson files in data/game/ plus the
authored Socratic tutor turns in the dialogue dataset.

The tutor turns power Offline Guided mode: when no model server is running,
the lesson chat replays Sabi's authored guiding steps for that problem, so
the game works with no GPU and no internet beyond the first page load.

Run after editing any data/game/*_challenges.json:
    python app/tools/build_content.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATASETS = {
    "literature": ROOT / "data" / "arts_literature" / "arts_literature.json",
    "physics": ROOT / "data" / "science_physics" / "science_physics.json",
    "accounting": ROOT / "data" / "commerce_accounting" / "commerce_accounting.json",
}
OUT = ROOT / "app" / "content" / "game.json"


def main() -> int:
    errors: list[str] = []
    subjects, guided = {}, {}
    seen_ids: set[str] = set()

    for subject, dataset_path in DATASETS.items():
        lesson_file = ROOT / "data" / "game" / f"{subject}_challenges.json"
        if not lesson_file.exists():
            errors.append(f"missing {lesson_file}")
            continue
        game = json.loads(lesson_file.read_text(encoding="utf-8"))
        dialogues = {e["id"]: e for e in json.loads(dataset_path.read_text(encoding="utf-8"))["examples"]}

        for unit in game["units"]:
            for lesson in unit["lessons"]:
                lid = lesson["id"]
                if lid in seen_ids:
                    errors.append(f"duplicate lesson id {lid}")
                seen_ids.add(lid)
                if len(lesson.get("options", [])) != 4 or not 0 <= lesson.get("answer_index", -1) <= 3:
                    errors.append(f"{lid}: needs 4 options and answer_index 0-3")
                src = dialogues.get(lesson.get("source_id"))
                if not src:
                    errors.append(f"{lid}: source_id {lesson.get('source_id')} not in dataset")
                    continue
                guided[src["id"]] = [t["text"] for t in src["turns"] if t["role"] == "tutor"]
        subjects[subject] = {"units": game["units"]}

    if errors:
        print("Content build FAILED:")
        for e in errors:
            print("  -", e)
        return 1

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"version": 1, "subjects": subjects, "guided": guided}, ensure_ascii=False), encoding="utf-8")
    n = sum(len(u["lessons"]) for s in subjects.values() for u in s["units"])
    print(f"Wrote {OUT.relative_to(ROOT)}: {n} lessons, {len(guided)} guided dialogues, {OUT.stat().st_size // 1024} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
