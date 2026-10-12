# Running Sabi

How to run Sabi Arena on a laptop, run the live model on Kaggle, and deploy the app. For what Sabi is and its results, see the [README](../README.md).

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
| All 120 bus stops (1,200 tasks, 10 per stop): WAEC/JAMB, plus the BECE and Common Entrance pilot tracks | ✅ |
| XP, fuel ⛽, ranks, streaks and badges | ✅ |
| School / State / Nigeria leaderboards (tick the permission box on your profile to appear) | ✅ |
| Offline guided hints inside lessons | ✅ |
| **Ask Sabi** chat | ⚠️ Canned test replies only. The real fine-tuned model needs a GPU; see [Live demo with the real model](#live-demo-with-the-real-model-kaggle-gpu) below. |

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

## Live demo with the real model (Kaggle GPU)

This runs the **fine-tuned N-ATLAS** behind the game, so *Ask Sabi* gives real tutor replies, and gives you a temporary public link to open on any laptop or phone. It's what to use for the demo video and for student sessions with the real AI.

### One-time setup

| You need | How to get it |
|---|---|
| A Kaggle account with GPU access | Sign up at kaggle.com, then verify your phone number under **Settings → Phone verification**. GPU options stay greyed out until you do. |
| Access to N-ATLaS on Hugging Face | Log in at huggingface.co, open [NCAIR1/N-ATLaS](https://huggingface.co/NCAIR1/N-ATLaS) and accept its licence. Approval can take a while, so do this early. |
| A Hugging Face **read** token | huggingface.co/settings/tokens → **Create new token** → type **Read** |
| The trained Sabi adapter | Ask the team lead to share the private **`sabi-adapter`** Kaggle dataset with your Kaggle username. It contains `adapter_model.safetensors` and `adapter_config.json`. |
| A GitHub read token, **only while the repo is private** | github.com/settings/personal-access-tokens → **Fine-grained token** → Repository access: **only `sabi`** → Permissions: **Contents: Read-only**. Delete it once the repo is public. |

### Start the demo

1. On Kaggle, click **Create → New Notebook**.
2. In the right sidebar, set these:
   - **Session options → Accelerator:** **GPU T4 x2**
   - **Session options → Internet:** **On**
   - **Add Input → Datasets:** search for **`sabi-adapter`** and add it
   - **Add-ons → Secrets:** add **`HF_TOKEN`** (your Hugging Face token) and, while the repo is private, **`GH_READ_TOKEN`**. Tick both for this notebook.
3. Paste this into one cell and run it:

```python
import os, base64
from kaggle_secrets import UserSecretsClient
s = UserSecretsClient()
os.environ["HF_TOKEN"] = s.get_secret("HF_TOKEN")   # kept in memory only

# While the repo is private: send the token as a one-off header. Unlike a token
# inside the URL, this is never saved to .git/config or the notebook output.
gh = s.get_secret("GH_READ_TOKEN")
auth = base64.b64encode(f"x-access-token:{gh}".encode()).decode()
!git -c http.extraHeader="Authorization: Basic {auth}" clone -q https://github.com/LovableLynx/sabi.git /kaggle/working/sabi
# Once the repo is public, use this line instead of the three above:
# !git clone -q https://github.com/LovableLynx/sabi.git /kaggle/working/sabi

%cd /kaggle/working/sabi
!pip install -q -r ml/requirements.txt
%run ml/serve/kaggle_launch.py
```

4. Wait **3–5 minutes**: the model downloads (about 16 GB) and loads. When it's ready, it prints:
   ```
     Sabi live demo:  https://something-random.trycloudflare.com
   ```
5. Open that link. The badge on **Ask Sabi** should say **"Live · fine-tuned N-ATLAS"**.

### While it's running

- **Keep the Kaggle tab open.** The demo stops when the session stops.
- **Replies take 10–40 seconds** on a T4, and about twice that with **Compare with base N-ATLAS** turned on. For the video, cut the waiting.
- Each visitor can send **6 chat messages a minute**. This protects the GPU from being flooded.
- **The link works for anyone who has it**, but it's random and dies with the session. Share it only with testers and never post it publicly.
- **The leaderboard starts empty every session**, and its data is deleted when the session ends.
- **When you're done:** click **⋯ → Stop Session**. A running session uses up your weekly GPU hours (about 30 hours).

### Troubleshooting

| Message | Fix |
|---|---|
| `GatedRepoError` / `401` for N-ATLaS | Your Hugging Face account hasn't been approved for N-ATLaS yet, or the `HF_TOKEN` secret isn't ticked for this notebook |
| `No trained adapter found` | The `sabi-adapter` dataset isn't added as an Input |
| `Repository not found` / `403` while cloning | The `GH_READ_TOKEN` secret is missing or not ticked, or the token doesn't include the `sabi` repo |
| `CUDA out of memory` | Choose **GPU T4 x2**, not a single T4, then restart the session |
| GPU option greyed out | Verify your phone number on Kaggle |

## Permanent link on Vercel (for judges)

Vercel hosts the game for free, always on, over HTTPS. Use this link on the submission form.

| What works on the Vercel link | |
|---|---|
| All 120 bus stops (1,200 tasks), XP, fuel, ranks, badges | ✅ |
| Offline guided hints in lessons | ✅ |
| Leaderboard | ✅ On this device only. A shared board would need a database. |
| **Ask Sabi with the real AI** | ✅ **Only while the Kaggle live demo is running.** Open the Vercel link with the tunnel added: `https://sabi-app-wine.vercel.app/?api=https://something-random.trycloudflare.com`. With no tunnel, lessons use offline guided steps. |

Vercel can't run the AI model itself: an 8B model needs a GPU, and Vercel has none.

**Deploy (one time, about 5 minutes):**
1. Sign in at [vercel.com](https://vercel.com) with GitHub.
2. Click **Add New → Project**, then **import `LovableLynx/sabi`**. Vercel can read private repos once you allow it.
3. Leave **Framework Preset: Other**, and don't change the build settings. Then open **Settings → Build and Deployment**, set **Root Directory** to **`app`**, and save. `app/vercel.json` adds the security headers.
4. Click **Deploy**. You get a link like `https://sabi-xxxx.vercel.app`. Ours is **https://sabi-app-wine.vercel.app**.
5. From then on, every `git push` to `main` redeploys automatically.

The page loads nothing from third parties. Its Content-Security-Policy only allows connections to itself and to `*.trycloudflare.com` tunnels, and the app also ignores any other `?api=` value.

### Testing with real students

See **[docs/pilot_protocol.md](pilot_protocol.md)**. It covers the parent note, the session script, the observation sheet, and how to download the anonymous feedback before stopping Kaggle. Then run `python ml/eval/summarise_pilot.py` to turn the feedback into a validation report.

### Rules for teammates

- **Never commit keys or tokens.** Files like `ml/.hf_token` and `ml/.groq_key` are git-ignored; keep it that way.
- Run `git pull` before you start work, so you don't overwrite someone else's changes.
- Training and benchmarks need a GPU and API keys. Those steps are under [Reproducing](#reproducing) below.
