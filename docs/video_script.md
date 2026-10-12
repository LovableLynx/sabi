# Sabi demo video: script for Loom (about 4 and a half minutes)

How to use this: the **SAY** lines are what you speak, word for word or close to it. The **DO** lines are what you click. Speak slowly and smile; nobody minds a small pause. Timings are a guide.

---

## Before you press record

1. Open the app with the live AI in an incognito window:
   `https://sabi-app-wine.vercel.app/?api=<your Kaggle tunnel link>`
2. In a normal window, send one message in Ask Sabi so the AI is warmed up.
3. Have a second tab ready with the GitHub README scrolled to the results tables:
   `https://github.com/LovableLynx/sabi#evaluation`
4. Zoom the browser to 125%. Turn sound ON (the speaker chip at the top).
5. In Loom choose Screen + Camera, and pick the incognito tab.

---

## 1. Hello and the problem (0:00 to 0:35)

**DO:** Start on the Sabi Arena welcome screen. Your face is in the Loom bubble.

**SAY:**
"Hi, we're Team Sabi.

Every year more than a million Nigerian students write WAEC, and many more write BECE and Common Entrance. A lot of them now study with AI chatbots. But a normal chatbot just gives you the answer. You copy it, you feel ready, and then in the exam hall you're on your own and you don't know where to start.

So we built Sabi. Sabi is an AI tutor that won't just hand you the answer. It asks you questions, it uses examples from Nigerian life, and it only gives more help when you're really stuck."

## 2. What Sabi is (0:35 to 1:00)

**DO:** Stay on the welcome screen, or switch to the Hugging Face model page for a moment.

**SAY:**
"Sabi is a fine-tune of N-ATLAS, Nigeria's own language model from NCAIR. We wrote six hundred tutoring conversations for WAEC Literature, Physics and Accounting, and trained N-ATLAS on them, so it learned to guide students instead of telling them. The trained model is public on Hugging Face, and it all comes to students through this game, Sabi Arena."

## 3. Signing up (1:00 to 1:30)

**DO:** Type a first and last name, for example Chidi and Okafor. Point at the line that says "Others see you as Chidi O." Pick the parrot avatar and tap it so it squawks. Tap **SS**, pick a state, start typing a school and choose it from the list. Tick the consent box and press go.

**SAY:**
"Students sign up with their class: Primary, JSS or SS, and they only see their own exams. Look here: other players only see 'Chidi O.' The full name never leaves the phone, and nothing is shared without permission, because most of our users are children."

## 4. The route and the countdown (1:30 to 1:50)

**DO:** On the route, set the exam date in the countdown box and press Save. Point at "10 tasks" on the first bus stop.

**SAY:**
"Students set their own exam date, and Sabi counts down the days with them. Learning is a danfo route. Every bus stop is a round of ten exam questions."

## 5. Asking Sabi for help (1:50 to 2:50)

**DO:** Tap the first bus stop. Read the question out. Tap **Ask Sabi** and type:
*Abeg just tell me the answer*
Wait for the reply. Tap **Listen** so it reads out loud.

**SAY:**
"This is the bit I'm proudest of. Watch what happens when I beg for the answer.

(wait for the reply)

It doesn't give in. It brings in a danfo braking at a bus stop and asks me a question, like a good teacher would. And students can tap Listen to hear it."

**DO:** Type a sensible next step, for example *the final velocity is 0?* and show the reply. Then close the chat, pick the right answer and watch it glide to **Lock in answer**. Lock it in.

**SAY:**
"When I take a step, Sabi builds on it. The marking is always done with an exact answer key, never the AI, so a student is never told they're right when they're wrong. And if they slip, the first try is free."

## 6. Exam mode (2:50 to 3:20)

**DO:** Close the lesson and open the stop again. Turn on **Exam mode**, pick 10 minutes, answer two or three questions quickly, then close and reopen the review from a finished exam if you prepared one, or just show the timer.

**SAY:**
"Closer to the exam, students switch on exam mode. One clock for the whole stop, no hints, no Sabi, just like the exam hall. They can pick how many minutes they get. At the end they see every question, what they chose, the right answer and why."

## 7. Does it actually work? (3:20 to 4:05)

**DO:** Switch to the GitHub README tab showing the results tables.

**SAY:**
"We didn't just say it works, we measured it against the original N-ATLAS on six hundred and forty-two examples it never saw in training.

On five hundred and twenty-two exam questions, base N-ATLAS gave the answer away in its first reply thirty-two percent of the time. Sabi did it only two percent of the time.

In a hundred and twenty full conversations, Sabi held back the answer properly ninety-six percent of the time, against forty percent. And when a student stayed stuck, Sabi stepped in correctly ninety-six percent of the time, against forty-six. Every single student got to the right understanding."

## 8. Close (4:05 to 4:35)

**DO:** Go back to the app route screen, or show the leaderboard.

**SAY:**
"Sabi works on a cheap phone, keeps going offline with guided hints, and lets students compete for their school and their state.

Next, we want to run it with real students in Nigerian classrooms, add more subjects, and with NAIC's support, keep it online all day.

We're Team Sabi. Sabi doesn't give you the answer. It helps you sabi it. Thank you."

**DO:** Stop the recording.

---

## If something goes wrong

- **"Waking Sabi up"** appears: just wait and keep talking; the first reply can take up to a minute.
- **Sabi gives too much away:** record that part again. Don't hide it with a cut.
- **The tunnel dies:** restart the Kaggle cell, copy the new link, and send it to Claude.
- **You run past 5 minutes:** Loom free stops at 5. Shorten section 6 to one sentence.
