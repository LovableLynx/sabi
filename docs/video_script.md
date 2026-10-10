# Sabi: demo video script (about 4 minutes)

A script for the NAIC 2026 submission video. Read the **SAY** lines aloud and do the **SHOW** steps on screen. Times are a guide.

**Before you record:**

1. Start the Kaggle live demo with the latest `sabi-demo` dataset version, and copy the tunnel link.
2. Open `https://sabi-app-wine.vercel.app/?api=<tunnel link>` in a fresh browser window (or incognito), so the app starts at registration.
3. Check that the lesson chat label says **"Live · fine-tuned N-ATLAS"**. If it says "Offline", the tunnel is down.
4. Send one message first so the model is warm (the first reply is slow).
5. Zoom the browser to about 125% so text is readable in the recording.

---

## 1. The problem (0:00 to 0:30)

**SHOW:** The title card, then the Sabi Arena home screen.

**SAY:**
"Every year, more than a million Nigerian students write WAEC. Many of them use AI to study now, but a normal chatbot just gives them the answer. They copy it, and then they fail when they meet the question alone in the exam hall.

We built **Sabi**, an AI tutor that does not give the answer. It asks guiding questions, uses examples from Nigerian life, and steps in with more help only when the student is truly stuck."

## 2. What Sabi is (0:30 to 1:00)

**SHOW:** The README's architecture section, or a simple slide: "N-ATLAS (Llama 3 8B) + LoRA fine-tune on 600 Socratic dialogues".

**SAY:**
"Sabi is a fine-tune of **N-ATLAS**, the Nigerian language model from NCAIR. We trained it on 600 tutoring dialogues we wrote for WAEC Literature, Physics and Financial Accounting. Each dialogue teaches the model to withhold the answer, use a Nigerian analogy like a danfo braking or an Esusu book, and know when the student needs more help."

## 3. Live demo: registration (1:00 to 1:30)

**SHOW:** Fill in the form: first name, last name, class level **SS**, state **Oyo**, then start typing a school and pick it from the list. Tick consent. Point at the "Others will see you as Kemi B." preview.

**SAY:**
"Students register with their class: Primary, JSS or SS. Only their own exams open. Their full name stays on the phone, so other players only see 'Kemi B.' We follow Nigeria's Data Protection Act: nothing is shared without consent, and students can delete their data at any time."

## 4. Live demo: a bus stop (1:30 to 2:45)

**SHOW:** The danfo route. Point at "10 tasks" on the stop. Tap the stop. Show the progress dots at the top.

**SAY:**
"Learning is a danfo route. Each bus stop is a round of ten exam questions."

**SHOW:** On the physics question, tap **Ask Sabi** and type: *"Abeg just tell me the answer."*

**SAY:**
"Watch what happens when I beg for the answer."

**SHOW:** Sabi's reply (a guiding question, no answer). Then type a sensible step, for example *"Comes to rest means v = 0?"*, and show Sabi building on it.

**SAY:**
"It doesn't give in. It asks me what 'comes to rest' means, the same way a good teacher would. When I take a step, it builds on it."

**SHOW:** Lock in the right answer. Show the green result card, then tap **Next task**. Answer one or two more quickly. Optionally get one wrong to show the second try.

**SAY:**
"The marking is exact and never depends on the AI. A wrong first try is free; Sabi gives you another chance."

## 5. The evidence (2:45 to 3:30)

**SHOW:** The benchmark tables from the README.

**SAY:**
"We tested Sabi against the base N-ATLAS model on questions it never saw in training.

On **522** new exam questions, the base model gave the answer away in its first reply **32%** of the time. Sabi did it only **2%** of the time. Sabi asked a guiding question **100%** of the time, and used a Nigerian reference in **64%** of replies. A McNemar test puts the chance that this is luck at about 10 to the power of minus 44.

In **120** full held-out conversations, Sabi withheld the answer appropriately **96%** of the time, against **40%** for the base model. When a student stayed stuck, Sabi escalated correctly **96%** of the time, against **46%**. Every student still reached the correct understanding."

## 6. Built for Nigeria (3:30 to 4:00)

**SHOW:** Turn on airplane mode (or block the tunnel) and open a lesson: the label changes to "Offline guided steps". Then show the Ranks screen with the school and state leaderboards.

**SAY:**
"Sabi works on weak connections. If the internet drops, lessons keep going with Sabi's guided hints offline. Students compete for their school and their state, and keep a daily streak.

Sabi is open source and ready to scale: the always-on deployment is already built for NAIC compute. Our next step is a pilot with real students in Nigerian classrooms.

Sabi: it doesn't give you the answer, it helps you *sabi* it."

**SHOW:** The end card with the Vercel link and the GitHub repo.

---

### If something goes wrong while recording

- **Sabi replies "Waking Sabi up":** wait; the first reply takes about a minute.
- **Sabi gives too much away:** record the take again; don't cut it to hide the reply. The 2% leak rate is real, and honesty is part of the pitch.
- **The tunnel dies:** restart the Kaggle cell; a new link is printed. Update `?api=` in the address bar.
