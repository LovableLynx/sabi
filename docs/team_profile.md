# Team Profile: Sabi

**Competition:** National AI Innovation Challenge (NAIC) 2026
**Track:** B (Innovation & Enterprise), individual applicants
**Problem statement:** Sectoral Fine-Tuning (Education)
**Project:** Sabi, a WAEC/JAMB tutor fine-tuned on N-ATLAS, delivered through the Sabi Arena learning game
**Repository:** https://github.com/LovableLynx/sabi

---

## Team members

> NAIC requires 2–5 members. Each member must be a Nigerian citizen aged 18 or over.

| # | Full name | Role on Sabi | Affiliation (school / employer / independent) | State of residence | Email | Phone |
|---|---|---|---|---|---|---|
| 1 | _[Full name]_ | Team lead · ML & product | _[Affiliation]_ | _[State]_ | _[Email]_ | _[Phone]_ |
| 2 | _[Full name]_ | _[Role]_ | _[Affiliation]_ | _[State]_ | _[Email]_ | _[Phone]_ |
| 3 | _[Full name]_ | _[Role]_ | _[Affiliation]_ | _[State]_ | _[Email]_ | _[Phone]_ |
| 4 | _[optional]_ | | | | | |
| 5 | _[optional]_ | | | | | |

**Roles to choose from** (one person can hold several):
- ML engineering: data pipeline, fine-tuning, evaluation
- Subject content and review: Literature, Physics, Accounting
- Frontend and product: Sabi Arena
- Field testing and user research: student sessions
- Pitch and communications: video, documentation

---

## What each member contributed

> Two or three lines per person, written in the first person plural ("we").

- **_[Name]_:** _[e.g. built the dataset validation and fine-tuning pipeline; ran QLoRA training of N-ATLAS on Kaggle; ran the blind benchmark]_
- **_[Name]_:** _[e.g. reviewed Physics and Accounting dialogues against the WAEC syllabus; corrected flagged items]_
- **_[Name]_:** _[e.g. ran testing sessions with N students at ___ school; collected feedback and usage data]_

---

## Technical credibility (for the "team expertise" judging criterion)

What this team has built and shipped for this submission:

- **Data:** 600 multi-turn Socratic tutoring dialogues across Literature, Physics and Financial Accounting, with an automated validator for schema, notation, ledger format and answer leaks.
- **Model:** a QLoRA fine-tune of N-ATLAS (Llama-3 8B). Loss is computed on tutor turns only. Trained on a free Kaggle T4 in about 45 minutes; training loss fell from 2.14 to 0.84 without signs of memorisation.
- **Evaluation:** a 120-dialogue held-out benchmark comparing base and fine-tuned N-ATLAS, scored by a separate blind judge model (gpt-oss-120b). Partial results: the fine-tuned model withheld the answer 96.2% of the time, against 40.0% for base N-ATLAS. _[Replace with final numbers once all 240 judgements are done.]_
- **Product:** Sabi Arena, a web game that needs no install, with a live model server, offline guided mode, and School / State / National leaderboards. It is tested end to end (95 automated browser and security checks), including running each feature with the others disabled.
- **Prior relevant experience:** _[Add each member's relevant background: courses, past projects, hackathons, teaching experience.]_

---

## Eligibility checklist (Track B, individuals)

- [ ] 2–5 members listed above
- [ ] Every member is a Nigerian citizen aged 18+
- [ ] Every member has a valid ID ready to upload (NIN slip, international passport, voter's card or driver's licence), if the form asks for it
- [ ] The submission is original and has not been awarded elsewhere
- [ ] The team submits to only **one** problem statement (Sectoral Fine-Tuning)
- [ ] All materials are in English
- [ ] Attribution "Powered by Awarri Technologies" appears in the app and docs (it does)
