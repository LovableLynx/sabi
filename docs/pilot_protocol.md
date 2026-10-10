# Sabi pilot: running a student testing session

A short, supervised session in which real students use Sabi Arena with the live AI tutor, so we can report how they actually experience it. Allow **30–40 minutes** per group.

## Before the session

1. **Get permission.** Send the parent/guardian note below home, or have the school agree to it. Write down how many students have permission. Don't keep their names in Sabi.
2. **A teacher must be in the room** for the whole session.
3. **Start the live AI** on Kaggle (see the README, *Live demo with the real model*). Then open:
   `https://sabi-app-wine.vercel.app/?api=https://YOUR-TUNNEL.trycloudflare.com`
   Check that *Ask Sabi* shows **"Live · fine-tuned N-ATLAS"**.
4. Have the devices ready: phones, tablets or laptops. One per student is best; pairs are fine.

## Parent / guardian note (to send home or read to the school)

> Dear Parent/Guardian,
>
> Your child's class is helping test **Sabi**, a free study app for WAEC, JAMB, BECE and Common Entrance, made by Nigerian students for the National AI Innovation Challenge 2026. In a supervised session of about 30 minutes, students will answer practice questions, and an AI tutor will help them think them through.
>
> - Your child's **full name stays on the device** they use. Other players only see their first name and last initial, e.g. "Chidi O."
> - We do **not** collect phone numbers, email addresses or locations.
> - After each question, students may answer two anonymous questions ("Did Sabi help?"). These answers have **no name or ID attached**.
> - A teacher is present the whole time. Your child can stop at any time, and can delete their data in the app (Me → Delete my data).
>
> Please tell the teacher if you do **not** want your child to take part.

## During the session (script for the teacher or facilitator)

1. **Intro (2 min):** "Sabi is a study game. It won't just give you answers. It will help you work them out. Please use your first and last name, never your phone number."
2. **Register (3 min):** students choose their class level (Primary, JSS or SS), state and school. Tick the leaderboard box **only** for students with permission.
3. **Play (20 min):** students work through at least **3–5 bus stops**. Encourage them to tap **Ask Sabi** when they're stuck.
4. **After each lesson**, students tap the two quick answers (*Did Sabi help? / Did Sabi just tell you the answer?*). These are the data we report.
5. **Wrap-up (5 min):** ask the group out loud and write down a few answers:
   - "What did you like?"
   - "What was confusing?"
   - "Would you use Sabi at home to study?" (count the hands)

### Observation sheet (facilitator fills in, no names)

| | |
|---|---|
| Date, school, class level | |
| Number of students / devices | |
| Number with parental permission | |
| Did the live AI work the whole time? Any errors? | |
| How many asked Sabi for help without being told? | |
| How many tried to get Sabi to "just tell me the answer"? What happened? | |
| Hands up for "would use at home" | ___ of ___ |
| Best quotes (no names) | |
| Problems or confusing moments | |

## After the session: save the data before stopping Kaggle

The feedback lives on the Kaggle machine, so **download it before you click Stop Session**. Run this in a new cell:

```python
from IPython.display import FileLink, display
import shutil
for f in ["feedback.jsonl", "leaderboard.json"]:
    try:
        shutil.copy(f"/kaggle/working/sabi/ml/outputs/{f}", f"/kaggle/working/{f}")
        display(FileLink(f))
    except FileNotFoundError:
        print("not found:", f)
```

Click the links to download, then put `feedback.jsonl` in `ml/outputs/` on the laptop and run:

```bash
python ml/eval/summarise_pilot.py
```

This writes `ml/outputs/pilot_report.md`, the numbers for the submission's real-world validation section. Combine several sessions by joining their `feedback.jsonl` files into one before running it.

## Reporting honestly

- Report **how many students** and **how many sessions**, and say it was supervised and self-selected.
- "Helped" is the student's own rating, not a measured learning gain.
- Include the problems you saw. Judges trust a report that admits its limits.
