# Sabi

**A WAEC/JAMB tutor built on N-ATLAS that helps students work out the answer instead of handing it to them.**

Sabi is a LoRA fine-tune of [N-ATLAS](https://huggingface.co/NCAIR1/N-ATLaS), Nigeria's open multilingual LLM. It tutors three of the hardest WAEC/JAMB subjects, one from each stream:

| Stream | Subject | Why this subject |
|---|---|---|
| Arts | Literature-in-English | Abstract devices (irony, synecdoche, unseen poetry) taught with definitions that feel foreign to students |
| Science | Physics | Students must turn everyday events into multi-step formulas, often without lab access |
| Commercial | Financial Accounting | One misplaced ledger entry breaks the whole balance sheet |

Submitted to the **National AI Innovation Challenge 2026** (NITDA / NCAIR / ONDI), Sectoral Fine-Tuning track, Education sector.

> *Sabi* is Nigerian Pidgin for "to know / to understand", as in *"I don sabi am!"*

---

## Quick start: run Sabi Arena on your laptop

This needs no GPU, no API keys and no `pip install`, only Python.

**1. Get the latest code**
```bash
git clone https://github.com/LovableLynx/sabi.git   # first time only
cd sabi
git pull                                            # every time after that
```

**2. Check you have Python 3.10 or newer**
```bash
python --version
```
If it's missing or too old, install it from [python.org](https://www.python.org/downloads/). On Windows, tick **"Add Python to PATH"** during install. On a Mac, use `python3` wherever this guide says `python`.

**3. Start the game**
```bash
python ml/serve/serve_sabi.py --mock --port 8765
```
Leave this terminal window open. When it prints `Serving Sabi (mock ...)`, open **http://localhost:8765** in Chrome.

**4. Stop it:** press **Ctrl + C** in the terminal.

### What works in this test mode

| Feature | Works? |
|---|---|
| All 120 lessons: WAEC/JAMB, plus the BECE and Common Entrance pilot tracks | ✅ |
| XP, fuel ⛽, ranks, streaks and badges | ✅ |
| School / State / Nigeria leaderboards (tick the permission box on your profile to appear) | ✅ |
| Offline guided hints inside lessons | ✅ |
| **Ask Sabi** chat | ⚠️ Canned test replies only. The real fine-tuned model needs a GPU, so use the live demo link the team lead runs on Kaggle. |

### Try it on a phone (same Wi-Fi)

1. Start it with `--host 0.0.0.0` added:
   ```bash
   python ml/serve/serve_sabi.py --mock --port 8765 --host 0.0.0.0
   ```
2. Find your laptop's IP address. Run `ipconfig` on Windows (look for "IPv4 Address") or `ifconfig` on Mac.
3. On the phone, open `http://YOUR-LAPTOP-IP:8765`.

Only do this on a Wi-Fi network you trust, and stop the server when you're done.

### If something goes wrong

| Problem | Fix |
|---|---|
| `python` is not recognised | Reinstall Python and tick "Add Python to PATH", or try `py` (Windows) or `python3` (Mac) |
| `Address already in use` | Another program is using port 8765. Use another port, e.g. `--port 8800`, and open `http://localhost:8800` |
| The page is blank or looks old | Press **Ctrl + Shift + R** to hard-refresh |
| Lessons say "Couldn't load lessons" | Run `git pull` again, then restart the server |

### Before testing with students

- Have a teacher present, and get parents' permission first.
- Tell students to use a **nickname**, never their real name or phone number.
- The leaderboard data is saved in `ml/outputs/leaderboard.json` on the laptop running the server. To clear it, stop the server and delete that file.

### Rules for teammates

- **Never commit keys or tokens.** Files like `ml/.hf_token` and `ml/.groq_key` are git-ignored; keep it that way.
- Run `git pull` before you start work, so you don't overwrite someone else's changes.
- Training and benchmarks need a GPU and API keys. Those steps are under [Reproducing](#reproducing) below.

---

## How Sabi tutors

When a student asks a question, Sabi:

1. **Does not give the answer.** It replies with a guiding question.
2. **Uses a Nigerian analogy to explain the idea.** Examples: an okada braking at a checkpoint for deceleration, an Esusu contribution book for double entry, a town crier repeating a warning for the effect of repetition in a poem.
3. **Gives more help if the student stays stuck.** If the student is still stuck after a set number of turns (`frustration_threshold`), or keeps asking for the answer, Sabi gives a much more concrete hint. If they are still stuck after that, it walks through a short worked example.

The third point is the main design decision. **Khanmigo**, the best-known tutor that refuses to hand out answers, has a documented problem: in classrooms, students got frustrated and stopped using it when it kept refusing ([Hechinger Report](https://hechingerreport.org/proof-points-khanmigo-math-ai-tutor/)). Sabi only withholds the answer for a limited number of turns, and it is trained to recognise when to step in. See [docs/positioning_and_prior_work.md](docs/positioning_and_prior_work.md) for how Sabi compares with existing Socratic and Nigerian-context tutors.

### Example from the training data (Physics, kinematics)

> **Student:** A car decelerates from 20 m/s to rest in 4 s. Find the deceleration. I don't know which formula to use.
>
> **Sabi:** Think of an okada braking to stop at a checkpoint. At the start it is moving fast, and at the end, how fast is it moving when it has fully stopped?
>
> **Student:** It's not moving at all, so the speed is 0.
>
> **Sabi:** Good. So "comes to rest" means final velocity v = 0 m/s. Now, out of u, v, a, t, which three values do you already know from the question?

---

## Sabi Arena: the student app

Students use Sabi through **Sabi Arena**, a learning game built around Nigerian school life:

- **The danfo route.** Each subject is a bus route. Every lesson is a bus stop with one real WAEC-style question. There are 90 stops in total, in 6 units per subject, and finishing a stop moves the danfo to the next one.
- **Three exam tracks.** The main track is **SS · WAEC/JAMB**, which is what the model was fine-tuned and benchmarked on. Two smaller **pilot** tracks cover younger learners:
  - **JSS · BECE:** English Studies, Basic Science, Business Studies. These lead on to Literature, Physics and Accounting, so Sabi can follow a student from JSS3 to WAEC.
  - **Primary · Common Entrance:** Mathematics, English, Basic Science.

  Each pilot track has 15 lessons. Each pilot lesson has its own guided steps, so the track works offline. The tutor has not been benchmarked at these levels, and the app says so.
- **Ask Sabi in any lesson.** The fine-tuned tutor helps the student reason it out without giving the answer away. The answer is then locked in as multiple choice and marked exactly, so marking never relies on the AI.
- **XP that rewards working it out yourself:**
  - +20 for a correct first try.
  - +10 for solving it with no hints.
  - +5 for talking it through with Sabi.
  - Hints are available but cost the no-hint bonus.
- **Fuel ⛽ instead of lives.** A wrong answer burns fuel. Fuel refills over time, or by practising a stop you've already finished.
- **Ranks:**
  1. JJC
  2. Learner
  3. Sharp
  4. Distinction
  5. Odogwu
  6. Professor
  7. Sabi Legend
- **Other rewards:** a daily 🌶️ streak and badges such as *Okada Physicist*, *Esusu Accountant* and *I No Need Hint*.
- **School, State and National leaderboards with regional titles**, as in Honor of Kings: *No.1 in Kings College*, *Top 10 · Lagos*, *Nigeria Top 100*. There are also state-vs-state and school-vs-school standings.
- **Ijapa the tortoise**, the clever trickster from Yoruba folktales, cheers students on in Pidgin.

### What makes it different

Gamified WAEC/JAMB practice already exists: [PassGo](https://passgoapp.carrd.co/), [Edum](https://play.google.com/store/apps/details?id=com.edum.app&hl=en_US), [Prep50](https://prep50.com.ng/), [OBM Tutor](https://obmtutor.vercel.app/) and [Afrilearn](https://www.myafrilearn.com/products/learn-and-earn) all offer streaks, XP or leaderboards around past-question drills. Sabi Arena differs in four ways:

1. **It teaches instead of marking.** The others test what a student already knows. Sabi's fine-tuned tutor guides students to the answer, with Nigerian analogies, and stops holding back once they are stuck (the escalation behaviour).
2. **The points reward thinking.** XP is highest for solving a problem yourself, so the game encourages the same behaviour the tutor is trained for.
3. **Schools compete as schools.** We found no existing WAEC/JAMB app with school-vs-school rankings. This is the hook for selling to schools and state education boards.
4. **It works on weak data connections.** All 120 lessons (90 WAEC/JAMB, 15 BECE, 15 Common Entrance) load as a single 143 KB file. With no server reachable, lessons switch to **Offline Guided mode**, which replays Sabi's authored Socratic steps from the training data.

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

Each record includes the student's misconception, the tutor technique for each turn, the correct understanding (the answer key used by the evaluator), `max_turns_to_resolution` and `frustration_threshold`. The full schema is in [data/schema/dialogue_schema.md](data/schema/dialogue_schema.md).

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

| Metric | Base N-ATLAS | Sabi | Δ |
|---|---|---|---|
| Gives the answer away in its first reply (lower is better) | – | – | – |
| Asks the student a guiding question | – | – | – |
| Brings in a Nigerian everyday reference | – | – | – |

> **Pending:** filled in from `ml/outputs/single_turn_report.md` once the GPU run finishes.

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

> **Pending:** judging is in progress. This table will be filled in from `ml/outputs/comparison_report.md`.

| Metric | Base N-ATLAS | Sabi | Δ |
|---|---|---|---|
| Withholds appropriately | – | – | – |
| Reaches correct understanding | – | – | – |
| Escalates appropriately | – | – | – |
| Nigerian analogy rate | – | – | – |

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

**Live demo on Kaggle.** Use an interactive GPU session, with the training notebook's output added as an Input so the adapter is available:
```python
%run ml/serve/kaggle_launch.py
```
This loads N-ATLaS with the Sabi adapter and serves the chat app. It also opens a free Cloudflare tunnel and prints a public `https://…trycloudflare.com` link. The app's **Compare with base N-ATLAS** toggle shows the original model's reply next to Sabi's.

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

- **No real names, phone numbers, emails or locations are collected.** Students choose a nickname and are told not to use their real name. The server rejects nicknames containing links, @handles, phone numbers or common slurs.
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
  - 46 automated security checks cover all of the above

---

## Licence and attribution

Built on N-ATLAS · **Powered by Awarri Technologies**.

N-ATLAS is released under the *Open-Source Research and Innovation License*:
- It permits educational use, which is Sabi's purpose.
- It limits deployments to 1,000 active end-users.
- Commercial use needs separate licensing.

See [docs/n_atlas_model_notes.md](docs/n_atlas_model_notes.md).

## Team

> *Team names, roles and affiliations go here, as required for the NAIC submission.*
