"""
Build app/content/game.json from the lesson files in data/game/ plus the
authored Socratic tutor turns in the dialogue dataset (WAEC/JAMB track), or
each lesson's own "guided" steps (BECE and Common Entrance pilot tracks).

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

# Common chat words, Nigerian Pidgin and greetings that may be missing from
# the lesson data.
EXTRA_WORDS = """
abeg wetin dey no sabi sef una wey abi oya don comot oga madam ehen ehn haba wahala chai kai jare nau na
pikin wan go come fit make dem tori gist bros sis aunty uncle e o ah eh oh hmm hmmm ok okay okk pls plz please
thanks thank thx yes yeah yea nope nah idk dunno hello hi hey good morning afternoon evening night sir ma
explain help understand understood confused confusing stuck lost hard easy simple meaning mean means tell show
why how what when where which who whose whom am is are was were be been being do does did done have has had
can could would should will shall may might must not never again more less same different right wrong correct
answer question formula solve solution step steps example hint try sure think thought know knew idea clue
""".split()


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

    # Pilot tracks (BECE, Common Entrance): lessons carry their own guided
    # steps instead of pointing at a dataset dialogue.
    for pilot_file in sorted((ROOT / "data" / "game").glob("*_challenges.json")):
        pilot = json.loads(pilot_file.read_text(encoding="utf-8"))
        if "track" not in pilot:
            continue
        for subject, data in pilot["subjects"].items():
            for unit in data["units"]:
                for lesson in unit["lessons"]:
                    lid = lesson["id"]
                    if lid in seen_ids:
                        errors.append(f"duplicate lesson id {lid}")
                    seen_ids.add(lid)
                    if len(lesson.get("options", [])) != 4 or not 0 <= lesson.get("answer_index", -1) <= 3:
                        errors.append(f"{lid}: needs 4 options and answer_index 0-3")
                    steps = lesson.pop("guided", None)
                    if not steps:
                        errors.append(f"{lid}: pilot lessons need guided steps")
                        continue
                    lesson["source_id"] = lid
                    guided[lid] = steps
            subjects[subject] = {"units": data["units"]}

    if errors:
        print("Content build FAILED:")
        for e in errors:
            print("  -", e)
        return 1

    # Vocabulary for the gibberish check: every word in our own dialogues,
    # lessons and benchmark questions (English, Pidgin and subject terms),
    # plus common chat words. A message whose words are all unknown (even
    # allowing one typo) is treated as gibberish before the AI is asked.
    import re
    vocab: set[str] = set(EXTRA_WORDS)

    def walk(x):
        if isinstance(x, dict):
            for v in x.values():
                walk(v)
        elif isinstance(x, list):
            for v in x:
                walk(v)
        elif isinstance(x, str):
            vocab.update(w for w in re.findall(r"[a-z]+", x.lower()) if len(w) >= 2)

    for f in sorted((ROOT / "data").rglob("*.json")):
        walk(json.loads(f.read_text(encoding="utf-8")))
    (OUT.parent / "vocab.json").write_text(json.dumps(sorted(vocab), separators=(",", ":")), encoding="utf-8")
    print(f"Wrote app/content/vocab.json: {len(vocab)} words")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"version": 1, "subjects": subjects, "guided": guided}, ensure_ascii=False), encoding="utf-8")
    n = sum(len(u["lessons"]) for s in subjects.values() for u in s["units"])
    print(f"Wrote {OUT.relative_to(ROOT)}: {n} lessons, {len(guided)} guided dialogues, {OUT.stat().st_size // 1024} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
