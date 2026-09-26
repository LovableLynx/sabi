# Sabi — Positioning Against Prior Work

Use this as the basis for the "why this, why now" section of the technical
documentation and demo video narration. Judges with any AI/ed-tech exposure
will already know Khanmigo and may ask "isn't this just that?" — this doc is
the answer, backed by search-verified sources.

## What already exists (be upfront about this, don't oversell novelty)

**Socratic-method AI tutors are an established category:**
- **Khanmigo** (Khan Academy) — production-deployed, explicitly designed to
  never give direct answers, guiding via questions instead.
  [Source](https://hechingerreport.org/proof-points-khanmigo-math-ai-tutor/)
- **SocraticLM** — a 6B model fine-tuned on a dedicated Socratic-teaching
  dataset (SocraTeach), reported to outperform GPT-4 on pedagogical quality.
- **EULER / socratic-llm** (EURECOM) — Phi-3-mini fine-tuned via DPO
  specifically for Socratic interactions; training pipeline open-sourced.
  [GitHub](https://github.com/GiovanniGatti/socratic-llm)
- **SocraticAI** — scaffolded Socratic tutoring for CS education.

**Nigerian/African-culturally-grounded AI tutoring also already exists:**
- **[Naijalingual](https://github.com/Obasi253/Naijalingual)** — open-source
  STEM audio tutor explaining concepts in Nigerian dialects using cultural
  analogies.
- **CLEVA** — explains concepts "the way an aunty explains photosynthesis
  using cassava plants and palm trees."
- **Tutorial.ng, PassAm, ExamPrep, LearnLift** — multiple existing WAEC/JAMB/
  NECO AI exam-prep products live in the Nigerian market today, some with
  Pidgin support.

**Conclusion: neither the Socratic method nor cultural-analogy tutoring is,
on its own, a novel contribution.** Any submission or demo narration that
claims "first Socratic AI tutor" or "first tutor with local analogies" will
not survive scrutiny from an informed judge. Do not claim this.

## What is actually new here

1. **The combination, fine-tuned into one N-ATLAS model, benchmarked across
   three WAEC/JAMB streams.** No located prior work combines bounded
   Socratic refusal + Nigerian cultural grounding + a formal before/after
   fine-tuning benchmark, built specifically on Nigeria's sovereign LLM
   (N-ATLAS) and validated against WAEC examiner reports across Arts,
   Science and Commerce in one project.

2. **A direct, evidence-based fix for a documented failure mode.** Real
   classroom deployment of Khanmigo found that many students got frustrated
   and disengaged when the AI kept refusing to answer and pushing more
   questions instead of helping.
   [Hechinger Report](https://hechingerreport.org/proof-points-khanmigo-math-ai-tutor/)
   This is not a hypothetical concern — it is the single most-cited real-world
   problem with production Socratic AI tutoring today.

   Sabi's `frustration_threshold` / escalation mechanism (see
   [dialogue_schema.md](../data/schema/dialogue_schema.md)) is designed
   directly against this failure: after a bounded number of probing turns,
   or on explicit frustration signals, the tutor escalates to a stronger
   hint and, if needed, a short worked example — rather than refusing
   indefinitely. This is a concrete, testable design response to a named
   gap in existing work, not a novelty claim invented for the pitch.

3. **A hypothesis worth stating explicitly (and honestly, as a hypothesis,
   not a proven result) in the submission**: student disengagement with
   Socratic refusal may be worsened when the guiding questions feel foreign
   or abstract (Khanmigo's hints are generic/Western in framing). Grounding
   the same bounded-Socratic behavior in Nigerian cultural analogies (market
   trading, farm work, Esusu/Ajo, proverbs, village storytelling) is
   hypothesized to keep engagement higher for Nigerian students than a
   culturally generic equivalent. The real-student validation step
   (required by the competition anyway) is the place to gather actual
   evidence for or against this — report honestly whatever you observe,
   including if it doesn't hold up.

## How to phrase this in submission docs / demo video

Do:
- "Socratic AI tutoring and culturally-grounded tutoring both exist
  separately; we combine them, fine-tune them into N-ATLAS specifically,
  and benchmark the result across three WAEC/JAMB streams."
- "Production Socratic tutors like Khanmigo have a documented disengagement
  problem when they refuse indefinitely — we designed a bounded escalation
  behavior directly against that failure mode."
- "We treat cultural grounding's effect on engagement as a hypothesis we
  test with real students, not an assumed win."

Don't:
- "First Socratic AI tutor."
- "First AI tutor with Nigerian context."
- Any claim implying no one has tried either piece before.

## Benchmark implication

The eval harness (see project root, TODO once built) should score fine-tuned
vs. base N-ATLAS on three axes, not two:
1. **Withholds appropriately** — does it avoid stating the answer before
   `frustration_threshold` is reached.
2. **Escalates appropriately** — on `escalated: true` examples, does it
   correctly move to `escalated_hint`/`worked_example` rather than either
   (a) caving immediately or (b) refusing forever past the threshold.
3. **Outcome correctness** — does the student reach `correct_understanding`
   within `max_turns_to_resolution` (or via the escalation path).

Reporting all three axes, with the escalation axis explicitly framed as
"designed against the Khanmigo disengagement problem," is what makes the
500+-example benchmark tell a defensible, differentiated story rather than
just reproducing known Socratic-tutor results.
