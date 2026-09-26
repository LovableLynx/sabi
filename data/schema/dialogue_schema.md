# Socratic Dialogue Data Schema

This is the shared format all three subject teams (Literature, Physics, Financial
Accounting) use to author training/benchmark examples. Consistency here matters
more than volume — a fine-tune learns whatever inconsistency you feed it.

## File layout

One JSON file per example, OR a single JSON array file per subject
(`arts_literature.json`, `science_physics.json`, `commerce_accounting.json`).
Use the array-file approach — easier to review as a batch in PRs/reviews.

## Top-level record shape

```json
{
  "id": "lit-0001",
  "subject": "literature",
  "topic": "figurative_language",
  "source": "WAEC 2019 Paper 3, Q4 + Examiner Report",
  "difficulty": "credit",
  "student_opening": "What does 'the sun refused to rise' mean in the poem?",
  "misconception": "Student is reading the line literally instead of as personification/pathetic fallacy.",
  "turns": [
    {
      "role": "student",
      "text": "What does 'the sun refused to rise' mean in the poem?"
    },
    {
      "role": "tutor",
      "text": "Good question. Before I tell you — think about when your mother says 'this yam is stubborn, it refuses to get soft.' Can a yam actually refuse anything?",
      "technique": "cultural_analogy_probe"
    },
    {
      "role": "student",
      "text": "No, it's just talking like the yam has a mind."
    },
    {
      "role": "tutor",
      "text": "Exactly that idea. So if the yam can't really 'refuse', what is the writer doing when they say the sun 'refused' to rise?",
      "technique": "guided_transfer"
    },
    {
      "role": "student",
      "text": "The writer is giving the sun human behaviour, like it can choose."
    },
    {
      "role": "tutor",
      "text": "That's it — that's called personification. Now, why might a poet choose to say the sun 'refused' rather than simply 'the sun did not rise'? What mood does 'refused' add?",
      "technique": "extend_to_effect"
    }
  ],
  "correct_understanding": "The line personifies the sun, giving it human will/defiance, which conveys a mood of gloom, wrongness, or resistance beyond a plain literal statement.",
  "max_turns_to_resolution": 4,
  "frustration_threshold": 3,
  "notation_check": "n/a"
}
```

## Why `frustration_threshold` exists — the Khanmigo lesson

Khan Academy's Khanmigo is the best-known production Socratic AI tutor, and it
deliberately never gives direct answers. Real classroom deployments found that
many students got frustrated and disengaged entirely when the AI kept
refusing to answer and pushing more questions instead
([Hechinger Report](https://hechingerreport.org/proof-points-khanmigo-math-ai-tutor/)).
A rigid "never answer, ever" policy is a known failure mode, not a strength.

Sabi is deliberately built to avoid that trap: the tutor holds the
line for a bounded number of turns, then **escalates to a stronger hint or a
worked example** if the student is still stuck — rather than refusing
indefinitely. This is a genuine point of differentiation from existing
Socratic-tutor work (Khanmigo, SocraticLM, EULER) and from existing
Nigerian-context tutors (Naijalingual, CLEVA), none of which combine
(a) bounded Socratic refusal, (b) an explicit escalation/fallback behavior,
and (c) Nigerian cultural grounding, in one fine-tuned model.

- `frustration_threshold`: the number of consecutive tutor turns allowed
  before escalation is triggered if the student still hasn't reached
  `correct_understanding`. Typically `2`–`3`. After this many probing turns
  without progress, the *next* tutor turn must move to `technique:
  "escalated_hint"` or `"worked_example"` (see below) rather than continuing
  to ask pure questions indefinitely.
- Signals that should trigger early escalation even before the threshold is
  reached: the student explicitly asks for the answer more than once, gives
  a repeated wrong/confused answer to the same probe, or expresses
  frustration ("I don't get it", "just tell me", "abeg just explain").
  Author these as separate examples where useful — see `lit-0002`-style
  pattern below.

## Field notes

- `id`: `<subject-prefix>-####`. Prefixes: `lit-`, `phy-`, `acc-`.
- `subject`: one of `literature`, `physics`, `accounting`.
- `topic`: free text but reuse consistent tags within a subject (keep a running
  list at the bottom of each subject's file so tags don't fragment).
- `source`: always cite the past-paper year/question or examiner report page —
  this is your evidence trail for judges and your ground truth for correctness.
- `student_opening`: the initial question/misconception in the student's voice.
- `misconception`: one sentence, what's actually wrong in the student's thinking.
  This is what the tutor's probing should be steering against.
- `turns`: alternating `student`/`tutor` turns. Always ends on a `tutor` turn.
  **The tutor must never state the final answer directly in any turn** — that's
  the core behavioral rule being trained. The `technique` field on tutor turns
  is optional metadata (not sent to the model) for reviewers to sanity-check
  variety of Socratic moves (analogy, restating, narrowing, contrast, etc.)
- `correct_understanding`: the "answer key" — what the student should have
  arrived at by the end. Used by the eval harness to score outcome correctness,
  never shown to the model as an assistant turn.
- `max_turns_to_resolution`: how many tutor turns is "good" for this example —
  used for the benchmark's efficiency scoring (fewer turns to correct
  understanding = better, but zero turns = failure to be Socratic at all).
- `notation_check`: subject-specific, see below. Use `"n/a"` for literature.

## Subject-specific notation rules

### Physics (`science_physics.json`)
Every equation appearing in `text` fields MUST follow this plain-text
convention (no exceptions — the fine-tune needs one consistent style):

- Powers: `^` — `v^2`, `t^2`
- Multiplication spelled out with `*` whenever it could be ambiguous:
  `2*a*s`, not `2as`
- Fractions inline with parentheses: `(v - u)/t`
- Greek letters as Unicode: `θ`, `Δ`, `ω`, `μ`
- Vectors: `vec(F)`, `vec(v)` — not bold markdown
- Units always space-separated: `20 m/s`, `9.8 m/s^2`
- Use ONE canonical rearrangement of a formula per fact — don't mix
  `v = u + a*t` in one example and `a = (v-u)/t` for the same relationship
  in another unless the question specifically asks to solve for a different
  variable.

Set `notation_check` to `"reviewed"` once a second team member has confirmed
the equations in that example follow the convention above.

### Financial Accounting (`commerce_accounting.json`)
Any ledger/table content inside a `text` field MUST use this exact markdown
table shape (column order fixed):

```
| Date | Account | Debit (₦) | Credit (₦) |
|------|---------|-----------|------------|
| ...  | ...     | ...       | ...        |
```

- Running balance / totals go in a final row labeled `Balance c/d` or `Total`.
- Depreciation and bank reconciliation examples: flag these with
  `"topic": "depreciation"` / `"topic": "bank_reconciliation"` — we'll add a
  sub-template for those once the first few are drafted (double-entry pairs
  need both legs shown, always in the same table).
- Set `notation_check` to `"reviewed"` once a second team member confirms the
  table renders correctly and debits/credits balance.

## Review checklist before an example is considered "done"

1. Tutor never states the answer outright in any turn *before*
   `frustration_threshold` is reached.
2. At least one turn uses a genuine Nigerian cultural/real-world analogy
   relevant to the concept (market, farm, family, Agbero, Esusu/Ajo, village
   storytelling, etc.) — this is the whole point, don't skip it.
3. `source` is filled in with a real past-paper/examiner-report reference.
4. `correct_understanding` is accurate and would satisfy an examiner.
5. Notation follows the subject's convention; `notation_check` set to
   `"reviewed"`.
6. `id` is unique and sequential within the subject file.
7. **For roughly 1 in 5 examples per subject**, author a "student stuck"
   variant: the student keeps giving wrong answers or asks for the answer
   outright, and the tutor escalates per `frustration_threshold` (see below).
   Don't make every example a clean first-try success — real students get
   stuck, and your fine-tune and benchmark both need that behavior covered.

## Authoring the escalation path

When the student doesn't reach `correct_understanding` within
`frustration_threshold` probing turns, or explicitly signals frustration, the
next tutor turn should:

1. Acknowledge the difficulty briefly (no scolding, no "let me just tell
   you" abruptness) — one short empathetic clause is enough.
2. Give a **stronger, more concrete hint** (`technique: "escalated_hint"`) —
   narrow the cultural analogy down to something almost 1:1 with the answer,
   or give one worked step of the calculation/reasoning.
3. If the student is *still* stuck after the escalated hint, the final tutor
   turn may give a **short worked example** (`technique: "worked_example"`)
   that walks through the reasoning to the answer — this is the deliberate
   fallback, not a failure of the method. Mark such examples with
   `"escalated": true` at the top level so the eval harness scores them on a
   separate axis (did it escalate appropriately, not just "did it withhold
   forever").

Example skeleton (abbreviated, physics):

```json
{
  "id": "phy-0044",
  "subject": "physics",
  "topic": "kinematics",
  "escalated": true,
  "frustration_threshold": 2,
  "turns": [
    { "role": "student", "text": "..." },
    { "role": "tutor", "text": "... (cultural_analogy_probe) ..." },
    { "role": "student", "text": "I don't know, just tell me the formula." },
    { "role": "tutor", "text": "No wahala, let's slow down. ... (escalated_hint, narrows analogy almost to the answer) ..." },
    { "role": "student", "text": "I still don't get it." },
    { "role": "tutor", "text": "Okay, let's work it through together step by step: ... (worked_example) ..." }
  ]
}
```

## Target volume

~200 examples per subject (600 total), of which roughly 1 in 5 (~40 per
subject) should be escalation/frustration variants per the checklist above.
Quality and notation consistency over raw count — a clean 150 beats a messy
250.
