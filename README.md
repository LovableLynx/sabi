# Sabi

**An exam tutor built on N-ATLAS that helps Nigerian students work out the answer instead of handing it to them.**

> *Sabi* is Nigerian Pidgin for "to know", as in *"I don sabi am!"*

| | |
|---|---|
| **Play it** | [sabi-app-wine.vercel.app](https://sabi-app-wine.vercel.app) (any phone or laptop; the live AI is switched on during demos) |
| **The model** | [LovableLynx/Sabi-N-ATLaS-Tutor-LoRA-Powered-by-Awarri](https://huggingface.co/LovableLynx/Sabi-N-ATLaS-Tutor-LoRA-Powered-by-Awarri) on Hugging Face |
| **Built for** | National AI Innovation Challenge 2026 (NITDA / NCAIR / ONDI), PS3 Sectoral Fine-Tuning, Education |
| **Team** | Team Sabi: Oluwadarasimi Olowe (team lead) and Pelumi Olusanya |

---

## The problem

Many Nigerian students now study with AI chatbots. A normal chatbot gives the answer straight away, so the student copies it and is stuck when they meet the same kind of question alone in the exam hall. Sabi is a tutor that asks questions, uses examples from Nigerian life, and only gives more help when the student is truly stuck.

## Results

We compared Sabi with base N-ATLAS on **642 examples never used in training**. Same model, same prompt, same settings; the only difference is the Sabi adapter.

| | Base N-ATLAS | **Sabi** |
|---|---|---|
| Gives the answer away in its first reply (522 questions, lower is better) | 32.2% | **2.1%** |
| Asks the student a guiding question | 15.3% | **100%** |
| Uses a Nigerian everyday example | 7.3% | **64.0%** |
| Withholds the answer appropriately (120 full conversations) | 40.0% | **95.8%** |
| Steps in correctly when a student stays stuck | 45.8% | **95.8%** |
| Student reaches the correct understanding | 87.5% | **100%** |

The answer-leak gap is statistically significant (paired McNemar test, p = 8.9 × 10⁻⁴⁵). Full method and per-subject results: [docs/TECHNICAL.md](docs/TECHNICAL.md#evaluation).

## How Sabi tutors

> **Student:** A danfo bus travelling at 20 m/s brakes and comes to rest in 4 s. Abeg just tell me the answer.
>
> **Sabi:** Let's reason it out first. Think of a danfo that has to stop suddenly at a checkpoint. At the start of the stop, is the bus moving fast or slow, and at the end?

1. It **doesn't give the answer**; it asks a guiding question.
2. It **uses a Nigerian example**: a danfo braking, an Esusu book, a town crier.
3. It **steps in with more help** if the student stays stuck, instead of refusing forever.

## How it's built

- **Model:** N-ATLAS (Llama 3, 8B) fine-tuned with QLoRA (4-bit, 0.52% of parameters) on **600 tutoring dialogues** we wrote for WAEC/JAMB Literature, Physics and Financial Accounting.
- **Serving:** a Python server runs N-ATLAS with the adapter on a Kaggle T4 GPU. A serverless version for Modal is ready for compute credits.
- **App:** Sabi Arena, plain JavaScript on Vercel, built to work on cheap phones and weak connections.

## Sabi Arena, the app

- **120 bus stops, 1,200 questions** for three levels: SS (WAEC/JAMB) and pilot tracks for JSS (BECE) and Primary (Common Entrance). Students only see their own level.
- **Ask Sabi** in any lesson, with a 🔊 Listen button that reads replies aloud.
- **Answers are marked with an exact answer key**, never by the AI. Plain sums go to a calculator-checked coach.
- **Exam mode:** one timer for a whole stop (the student picks 2 to 15 minutes), no hints, and a full review at the end.
- **Exam countdown** to each student's own exam date, daily streaks, XP, badges, and school and state leaderboards.
- **Works offline** with Sabi's guided hints when the AI isn't reachable.
- **Private by design:** full names stay on the phone, nothing is shared without consent, and students can delete their data (Nigeria Data Protection Act 2023).

## Limitations

- Trained and benchmarked on three SS subjects. The JSS and Primary tracks are pilots.
- Like any 8B model it can make arithmetic mistakes, which is why marking and sums never rely on it.
- Tested in English with Nigerian Pidgin; Yoruba, Hausa and Igbo are not tested yet.
- Benchmark B was scored by an AI judge, not human examiners. We have not yet run sessions with real students; a pilot plan is ready in [docs/pilot_protocol.md](docs/pilot_protocol.md).

## More

| | |
|---|---|
| [docs/SETUP.md](docs/SETUP.md) | Run it on a laptop, start the live model on Kaggle, deploy to Vercel |
| [docs/TECHNICAL.md](docs/TECHNICAL.md) | Architecture, dataset, training, evaluation, reproducing, security |
| [docs/Sabi_Technical_Documentation_v2.pdf](docs/Sabi_Technical_Documentation_v2.pdf) | The technical write-up for NAIC |
| [docs/positioning_and_prior_work.md](docs/positioning_and_prior_work.md) | How Sabi compares with other tutors |

## Licence and credit

Built on N-ATLAS · **Powered by Awarri Technologies**. Credit to Awarri Technologies and the Federal Ministry of Communications, Innovation and Digital Economy. The Sabi adapter is released under the same N-ATLaS Open-Source Research and Innovation License, which allows educational use for up to 1,000 active users; larger or commercial use needs a licence from Awarri. N-ATLAS is built on Meta Llama 3. See [docs/n_atlas_model_notes.md](docs/n_atlas_model_notes.md).
