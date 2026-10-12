# Sabi: technical details

Architecture, dataset, training, evaluation, reproducing the results, and security. For the short overview, see the [README](../README.md).

### Built so each feature works alone

The features never import each other. They talk through a small event bus, and each is loaded with its own guarded import:

| If this is unavailable… | …this still works |
|---|---|
| Model server | Lessons, using offline guided steps; XP, leaderboard (on-device), profile |
| Leaderboard server | Everything; scores are kept on the device |
| Lesson content | Ask Sabi, leaderboard, profile |
| Browser storage (private mode) | Everything, with progress kept in memory for the session |
| Any single feature module | Every other feature (tested by blocking each module in turn) |

---

## Architecture

```
            data/  (600 Socratic dialogues, JSON)
               │
   ml/src/data_validate.py ─── schema, notation, ledger-format, answer-leak checks
               │
   ml/src/build_dataset.py ─── stratified split: 480 train / 120 held-out eval
               │                (40 per subject, escalation examples in proportion)
               ▼
   ml/src/finetune_lora.py ─── QLoRA on N-ATLAS (4-bit NF4, LoRA r=16 on all attn+MLP proj)
               │                loss on TUTOR turns only (student turns masked)
               ▼
      LoRA adapter (~0.5% of params)
               │
   ml/eval/generate_transcripts.py ── replay the 120 held-out dialogues with
               │                       base N-ATLAS (adapter off) and Sabi (adapter on)
               ▼
   ml/eval/judge_transcripts.py ─── blind LLM judge (gpt-oss-120b via Groq)
               │                     labels every tutor turn
               ▼
   ml/eval/compare_results.py ─── base vs. fine-tuned report

   app/ ─── chat UI: subject tabs, KaTeX maths input/rendering, structured
            Debit/Credit ledger entry for Accounting
```

---

## Dataset

**600 multi-turn tutoring dialogues**: 200 per subject, 119 of them (20%) escalation examples where the student stays stuck.

| Subject | Topics covered (examples) |
|---|---|
| Literature | figurative language 20, characterisation 19, theme 19, irony 18, unseen prose 18, unseen poetry 18, drama technique 18, narrative structure 18, oral literature 18, poetic devices 17, setting & context 17 |
| Physics | current electricity 30, thermal physics & gas laws 27, mechanics 22, optics 17, waves 16, simple machines 16, electrostatics 16, electromagnetism 15, circular motion 15, SHM 12, kinematics 10, nuclear physics 4 |
| Financial Accounting | non-profit accounts 28, double entry 26, final accounts 26, incomplete records 22, cash flow 16, depreciation 13, trial balance 12, partnership 12, control accounts 12, bank reconciliation 10, stock valuation 6, manufacturing 6, consignment 4, public sector 4, joint venture 3 |

Each record includes the student's misconception, the tutor technique for each turn, the correct understanding (the answer key used by the evaluator), `max_turns_to_resolution` and `frustration_threshold`. The full schema is in [data/schema/dialogue_schema.md](../data/schema/dialogue_schema.md).

**Consistency rules** (enforced by `data_validate.py`):
- **Physics equations** use one plain-text notation: `v^2 = u^2 + 2*a*s`, Unicode Greek letters, and units separated by a space.
- **Every accounting ledger** uses the same header: `| Date | Account | Debit (₦) | Credit (₦) |`.

**How the data was made.** The dialogues were drafted with AI help, following the schema and a set of hand-written seed examples.
- Every Physics answer and every Accounting figure was computed programmatically, and every ledger was checked to balance.
- Sources are labelled honestly as "WAEC-style practice item". No past-paper citations were invented.
- Examples marked for teacher review are listed in the batch notes. **Subject-teacher review is part of the validation plan.**

---

## Training

| Setting | Value |
|---|---|
| Base model | `NCAIR1/N-ATLaS` (Llama-3 8B, 8,092-token context) |
| Method | QLoRA: 4-bit NF4 base, double quantisation, LoRA adapters |
| LoRA | r = 16, α = 32, dropout 0.05, on q/k/v/o/gate/up/down projections |
| Trainable params | 41.9M of 8.07B (0.52%) |
| Loss | Tutor turns only; system prompt and student turns are masked |
| Schedule | 3 epochs, lr 2e-4 cosine, 5% warmup, effective batch 16 |
| Hardware | 1× NVIDIA T4 (Kaggle), fp16, about 45 min |

---

## Evaluation

Sabi is compared with base N-ATLAS on **642 held-out examples** in two complementary benchmarks. Both models use the same weights, prompt and greedy decoding; the only difference is that Sabi's LoRA adapter is switched on.

| Benchmark | Examples | What it tests | How it is scored |
|---|---|---|---|
| **A. Single-turn** | **522** new WAEC-style questions (174 per subject), written for evaluation only and checked against the training data for overlap | Does the tutor's *first reply* hand over the answer, or guide? | Deterministic, with no AI judge: an exact answer-key match, a question-mark check, and a Nigerian-reference word list. Includes a paired McNemar significance test |
| **B. Multi-turn** | **120** held-out dialogues (40 per subject, never trained on) | Over a whole conversation, does the tutor withhold, escalate when the student is stuck, and get the student to the right understanding? | A blind LLM judge (`openai/gpt-oss-120b`) labels every tutor turn |

### Benchmark A: single-turn (522 questions)

Each question has an `answer_terms` key listing the final value or named concept. A reply that contains one of those terms has **leaked** the answer. The match is whole-word and whole-number, so "900" does not match inside "1,900" and "foil" does not match "foiled". It is also conservative: an answer phrased in words the key doesn't list is not counted, which affects both models equally. The questions are in `data/benchmark/`; the scorer is `ml/eval/score_single_turn.py`.

| Metric (522 questions) | Base N-ATLAS | Sabi | Δ |
|---|---|---|---|
| Gives the answer away in its first reply (lower is better) | 32.2% | **2.1%** | **−30.1 pts** |
| Asks the student a guiding question | 15.3% | **100.0%** | +84.7 pts |
| Brings in a Nigerian everyday reference | 7.3% | **64.0%** | +56.7 pts |
| Average reply length (words) | 112 | 48 | |

A paired exact McNemar test on answer leaks found 159 questions where only base N-ATLAS leaked and 2 where only Sabi did, **p = 8.9 × 10⁻⁴⁵**.

| Subject (n = 174 each) | Leaks: base → Sabi | Asks a question: base → Sabi | Nigerian reference: base → Sabi |
|---|---|---|---|
| Literature | 51.1% → 5.2% | 20.1% → 100% | 15.5% → 50.6% |
| Physics | 25.9% → 1.1% | 16.1% → 100% | 4.0% → 74.7% |
| Financial Accounting | 19.5% → 0.0% | 9.8% → 100% | 2.3% → 66.7% |

**What we saw when reading the replies:**
- All 522 Sabi replies are distinct.
- Base N-ATLAS typically starts solving the problem ("Let's break it down: 1. …"). Sabi opens with a guiding analogy and a question.
- **Weaknesses:**
  - Sabi's openings are formulaic: many begin "Think of a…".
  - An analogy is occasionally imprecise. One bank-reconciliation reply describes a dividend received as money "paid out".
  - Both are targets for the next round of data.

### Benchmark B: multi-turn (120 dialogues)

The 120 held-out dialogues are replayed with the authored student turns as a scripted student. Both models write every tutor turn. A separate, larger model (`openai/gpt-oss-120b`) labels each tutor turn **without being told which model wrote it**.

| Metric | What it measures |
|---|---|
| **Withholds appropriately** | The tutor does not state the answer before `frustration_threshold` is reached |
| **Escalates appropriately** | On stuck-student dialogues, the tutor moves to a stronger hint or worked example instead of refusing forever |
| **Reaches correct understanding** | The conversation arrives at the answer key |
| **Nigerian analogy rate** | Share of tutor turns that use a concrete Nigerian everyday reference |

Withholding and outcome must be read together. A tutor that withholds but never gets the student there is just stubborn. A tutor that gets there without withholding is just handing out answers.

#### Results

All 240 conversations (120 per model) were judged.

| Metric | Base N-ATLAS | Sabi | Δ |
|---|---|---|---|
| Withholds the answer appropriately | 40.0% | **95.8%** | **+55.8 pts** |
| Reaches correct understanding | 87.5% | **100.0%** | +12.5 pts |
| Escalates appropriately when the student stays stuck (n = 24) | 45.8% | **95.8%** | **+50.0 pts** |
| Tutor turns using a Nigerian analogy | 5.6% | **26.3%** | +20.8 pts |

| Subject (n = 40 each) | Withholds: base → Sabi | Reaches understanding: base → Sabi |
|---|---|---|
| Literature | 60.0% → 95.0% | 97.5% → 100.0% |
| Physics | 32.5% → 97.5% | 87.5% → 100.0% |
| Financial Accounting | 27.5% → 95.0% | 77.5% → 100.0% |

Sabi withholds the answer far more often than base N-ATLAS, and this does not cost accuracy: every Sabi conversation still reached the correct understanding. The biggest gains are in the calculation-heavy subjects, where base N-ATLAS usually works the problem out for the student.

Both models take the same number of turns, because the scripted student always speaks the same number of times. Turn count is not a meaningful comparison in this setup.

**Limitations of this benchmark:**
- The student is scripted, so later student turns don't react to what the model actually said.
- The scores come from an LLM judge, not human examiners.
- It is a controlled regression test. It does not replace testing with real students, which is reported separately.

---

## Reproducing

Everything runs on a free Kaggle GPU notebook (T4).

**Secrets to add in Kaggle:**
- `HF_TOKEN` (N-ATLaS is gated; accept its licence on Hugging Face first)
- `GROQ_API_KEY` (judging only)

The repository is public, so cloning it needs no token. **Never put a token in a clone URL** (`https://TOKEN@github.com/...`). Git saves that URL in `.git/config`, and Kaggle saves `/kaggle/working`, including `.git/`, as notebook output.

```python
import os
from kaggle_secrets import UserSecretsClient
s = UserSecretsClient()
os.environ["HF_TOKEN"] = s.get_secret("HF_TOKEN")   # kept in memory, never written to /kaggle/working

!git clone -q https://github.com/LovableLynx/sabi.git /kaggle/working/sabi
%cd /kaggle/working/sabi
!pip install -q -r ml/requirements.txt

!python ml/src/data_validate.py
!python ml/src/build_dataset.py && \
 python ml/src/finetune_lora.py --config ml/configs/lora_config.yaml && \
 python ml/eval/generate_transcripts.py --adapter ml/outputs/lora_run_1/final_adapter
```

Run it as **Save Version → Save & Run All**, so the adapter and transcripts are kept in the version's Output.

Then judge. This needs no GPU, and it can be resumed if Groq's free-tier daily limit is hit:

```python
os.environ["GROQ_API_KEY"] = s.get_secret("GROQ_API_KEY")
!python ml/eval/judge_transcripts.py
!python ml/eval/compare_results.py ml/outputs/results_base.json ml/outputs/results_finetuned.json --out ml/outputs/comparison_report.md
```

**Or run the benchmarks from a laptop, without opening Kaggle.** This uses the Kaggle API (`~/.kaggle/kaggle.json`). Put the trained adapter in `ml/outputs/lora_run_1/final_adapter/`, and put the keys alone in the gitignored files `ml/.hf_token` and `ml/.groq_key`. Then:
```bash
python ml/kaggle/run_job.py single_turn   # Benchmark A on a Kaggle T4, then scored with no AI judge
python ml/kaggle/run_job.py judge         # Benchmark B judging; rerun to resume after Groq's daily limit
```
Kaggle's saved notebook secrets aren't available to runs started through the API. So each job carries its keys in a temporary **private** Kaggle dataset, and the runner deletes that dataset when the job ends. Results land in `ml/outputs/`.

**Test the pipeline without a GPU** (uses mock models):
```bash
python ml/smoketest/run_smoketest.py
```

**Live demo on Kaggle:** see [Live demo with the real model](#live-demo-with-the-real-model-kaggle-gpu) near the top of this README.

**Run Sabi Arena locally without a GPU.** The tutor gives canned replies, and the leaderboard is real and stored in `ml/outputs/leaderboard.json`:
```bash
python ml/serve/serve_sabi.py --mock --port 8765   # open http://localhost:8765
```

**After editing lesson files** in `data/game/*_challenges.json`, rebuild the game content:
```bash
python app/tools/build_content.py
```

---

## Repository layout

```
data/               600 training dialogues + schema
data/benchmark/     522 held-out single-turn benchmark questions
data/game/          120 Sabi Arena lessons (WAEC/JAMB + BECE and Common Entrance pilots)
ml/src/             validate, build split, fine-tune
ml/eval/            transcript + single-turn generation, Groq judge, deterministic scorer, reports
ml/smoketest/       mock server for testing the eval pipeline without a GPU
ml/configs/         LoRA hyperparameters
ml/kaggle/          run GPU / long jobs on Kaggle from a laptop via the Kaggle API
ml/serve/           model + game server, Kaggle live-demo launcher
app/                Sabi Arena game: route, lessons, Ask Sabi, leaderboard (app/tools/ builds content)
docs/               N-ATLAS model notes, positioning vs. prior work, team profile
```

---

## Security and privacy

Sabi Arena is used by school children, so it collects as little as possible and shares nothing without permission. See [SECURITY.md](SECURITY.md) for the full threat model.

- **Full names stay on the device.** Students enter their first and last name, but other players only ever see "Chidi O.". No phone numbers, emails or locations are collected.
- **Every input is validated, in the app and again on the server.** Bad language (including tricks like `sh1t` and Pidgin insults), gibberish, keyboard-mashing and junk symbols are refused in names, school names and chat. Blocked chat messages are answered politely without reaching the AI. Real names like *Shittu* and school words like King Lear's *Fool* are not blocked.
- **Schools come from a list.** A typed-in school shows as *unverified* and doesn't count in school rankings.
- **Nothing leaves the device without permission.** A student only appears on the leaderboards after ticking *"I'm 18 or older, or a parent or teacher has said yes"*, in line with the consent rules for children in the Nigeria Data Protection Act 2023. Until then, progress stays on the device.
- **Players can delete their data.** *Delete my data* wipes the device copy and removes the player from the server.
- **A child-safety guard checks every chat in and out.** A student who writes about wanting to hurt themselves gets a caring reply pointing to a trusted adult and 112, Nigeria's emergency number. Requests for sexual content, weapons or drugs are redirected to school work. Normal Literature questions, for example about a character's death, are not blocked.
- **Nothing is loaded from third parties.** The font is self-hosted, so students' IP addresses don't go to Google, and the app works offline. Crafted `?api=` links pointing at other servers are ignored.
- **The leaderboard can't be used to take over accounts.** Each device keeps a secret ID; the board only publishes a one-way hash of it.
- **Abuse limits:**
  - per-visitor rate limits (6 chats a minute)
  - request and message size caps
  - XP may only rise at a realistic pace
- **Browser hardening:**
  - a Content-Security-Policy with no inline scripts or styles
  - `nosniff`, `no-referrer` and no framing
  - all user text is rendered as text, never as HTML
- **Server and keys:**
  - the server listens on `127.0.0.1` by default
  - API keys live only in gitignored files or platform secret stores
  - 144 automated checks (game, class levels, security, validation, pilot feedback)

---
