# Security and privacy

Sabi Arena is a learning game for Nigerian secondary and primary school students, many of them under 18. This document records what we protect, how, and what is not yet protected.

**Reporting a problem:** please email the maintainers listed in [docs/team_profile.md](docs/team_profile.md) rather than opening a public issue.

## What we hold, and where

| Data | Where it lives | Who can see it |
|---|---|---|
| Nickname, avatar, state, school, XP, lesson progress | The student's own browser (`localStorage`) | Only that device |
| Nickname, avatar, state, school, XP | The Sabi server's `ml/outputs/leaderboard.json`, **only if the student ticks the permission box** | Everyone who opens the leaderboard |
| A random secret device ID | Browser, plus the server (as a lookup key) | Never shown or published |
| Chat messages to the tutor | Sent to the Sabi server to generate a reply, then dropped (not stored with the profile) | The server operator, through server logs |

We **never ask for** real names, phone numbers, emails, dates of birth or locations more precise than a state.

## Children's data (Nigeria Data Protection Act 2023)

- **Consent before sharing.** Nothing leaves the device until the student ticks: *"I'm 18 or older, or a parent or teacher has said yes."* Without that, the leaderboard shows a "Private" notice and scores stay local.
- **Data minimisation.** Students are told to use a nickname, not their real name. The server rejects nicknames and school names containing links, @handles, phone numbers (7 or more digits) or common slurs, and the app runs the same checks.
- **Right to erasure.** *Me → Delete my data* removes the player from the server (`POST /api/delete`) and wipes the device copy.
- **Supervised pilots.** Run student testing sessions with a teacher present and parental permission, and record the consent outside the app.

## Threats and mitigations

| Threat | Mitigation | Where |
|---|---|---|
| Taking over another player's leaderboard entry | The board publishes only `pid = sha256(secret_id)[:16]`. Updates need the secret ID, which is at least 16 characters and random. | `serve_sabi.py` `Leaderboard` |
| Fake scores ("1,000,000 XP") | New players start at 1,000 XP or less. XP may rise by at most 200 plus 120 per minute, far above real play (about 35 per lesson). | `Leaderboard.upsert` |
| Flooding the GPU or the leaderboard | Per-visitor rate limits: 6 chats, 30 score writes and 60 board reads per minute. Behind the Cloudflare tunnel the real visitor IP comes from `CF-Connecting-IP`, trusted only on loopback requests. | `RateLimiter` |
| Oversized or malformed requests | Body caps (64 KB chat, 4 KB score), at most 2,000 characters per chat message and 16 messages of history, JSON object required, strict type checks | `do_POST` |
| Cross-site scripting through nicknames or model output | All text is inserted with `textContent` and never parsed as HTML. The only `innerHTML` is a built-in SVG constant. A strict CSP blocks inline scripts and styles. | `app/src/core/dom.js`, `PAGE_CSP` |
| Clickjacking and content sniffing | `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` | `SECURITY_HEADERS` |
| Reading server files through the web server | Paths are resolved and must stay inside `app/`. `app/tools/` is not served. Traversal attempts return 404. | `do_GET` |
| Leaking internals in error messages | Model errors are logged on the server only; the browser gets a generic message. The server version banner is hidden. | `do_POST` |
| Eavesdropping on public Wi-Fi | The live demo is only reachable through the Cloudflare tunnel's HTTPS. The server sends `Strict-Transport-Security` on tunnel requests, so browsers refuse to fall back to HTTP. There are no logins, passwords or cookies to steal. | `_headers` |
| A child in distress, or a student steering the tutor to unsafe topics | A child-safety guard checks every chat **before** the model sees it and every reply **after**. First-person self-harm ("I want to kill myself", "I wan commit suicide") gets a caring reply pointing to a trusted adult and **112**, Nigeria's emergency number. Explicit sexual requests and requests to make weapons or drugs are redirected to school work. Patterns are first-person and narrow, so school work such as *why did Okonkwo commit suicide?* still works. | `safety_reply` |
| A crafted link (`?api=https://evil.example`) pointing the app at a hostile server | The app only accepts its own tunnel (`https://*.trycloudflare.com`) or this machine. Anything else is ignored, and the server's CSP (`connect-src 'self'`) blocks it too. | `app/src/core/api.js` |
| Students' IP addresses sent to Google, and the app breaking offline | The Nunito font is self-hosted (SIL OFL licence, `app/fonts/OFL.txt`). The page loads nothing from any third party, and this is tested. | `app/styles.css` |
| Fake sign-ups filling the server's disk | The leaderboard stores at most 20,000 players | `MAX_PLAYERS_STORED` |
| The server reachable from the local network | Binds to `127.0.0.1` by default. The tunnel connects locally. | `--host` |

All of these are covered by an automated security suite of 46 checks. It covers id privacy, takeover attempts, XP limits, the nickname filter, size limits, deletion, headers, path traversal, rate limits, loopback binding, the child-safety guard, the `?api=` allowlist, having no third-party requests, the app running under CSP, consent gating and XSS rendering.

## Secrets

- **API keys never go into the repository.** `ml/.hf_token`, `ml/.groq_key`, `.env`, `kaggle.json` and the whole of `ml/outputs/` are gitignored. The full git history has been scanned and contains no keys.
- **No tokens in clone URLs.** A URL like `https://TOKEN@github.com/...` is saved by git in `.git/config`, and Kaggle saves `/kaggle/working` (including `.git/`) as notebook output. An early run did exactly this; that GitHub token has to be revoked. The repository is public, so cloning needs no token at all.
- **Kaggle jobs started from a laptop** (`ml/kaggle/run_job.py`) can't read notebook secrets. They carry the one key each job needs in a temporary **private** Kaggle dataset. The job keeps keys in memory and never writes them to `/kaggle/working`, and the runner deletes the dataset when the job ends.
- **The live demo link** (a Cloudflare quick tunnel) is public but random and temporary. Share it only with testers, and stop the Kaggle session when you finish.

## Third parties

These services see Sabi data while it is in use:

| Service | What it sees | When |
|---|---|---|
| **Kaggle (Google)** | The model server, its logs, chats in flight, and the leaderboard file | While the live demo or a benchmark runs on a Kaggle GPU |
| **Cloudflare** | Encrypted traffic to the demo link | While the live demo tunnel is open |
| **Groq** | Benchmark transcripts: scripted student turns and model replies, with no student data | Only during benchmark judging |
| **Hugging Face** | Downloads of the N-ATLaS weights | Only when a model server starts |

Real students' chats never go to Groq. The app itself loads nothing from any third party.

## Checklist items that don't apply

- **Database row-level security (RLS):** there is no Supabase, Firebase or SQL database. The leaderboard is one server-side file, and the rule "you can only edit your own entry" is enforced by the secret device ID.
- **SQL injection:** there are no SQL queries at all. User input never reaches a shell, `eval` or a query; it is only validated, stored as JSON, or passed to the model as text.
- **Managed authentication (Clerk, Auth0, Supabase Auth):** Sabi deliberately has no accounts, so children never create passwords or give an email. If accounts are added later, they must use a managed provider, never home-made login code.

## Known limitations (not yet protected)

- **There are no accounts or authentication.** XP is reported by the client and only sanity-checked, so a determined user could still inflate a score within the allowed rate. Real competitions or prizes would need server-side lesson verification.
- **Content moderation is basic.** Nickname filtering is a short list. The tutor model has no separate safety filter on its replies. It is trained to stay on WAEC/JAMB topics, but a student could try to steer it elsewhere. Supervise class use, and review the server logs.
- **The leaderboard is a single JSON file** on the server with no backups or encryption at rest. It is fine for pilots, not for scale.
- **Dependencies are not pinned to exact versions** (`ml/requirements.txt`). Pin them before any production deployment.
- **The child-safety guard is pattern-based.** It catches clear first-person distress and obvious unsafe requests, not every possible phrasing. It supports supervision; it doesn't replace it. A production version should add a proper moderation model and a referral route agreed with schools.
- **The demo tunnel binary is downloaded unverified.** `ml/serve/kaggle_launch.py` fetches the latest `cloudflared` from GitHub without checking a checksum. Pin a version and verify its SHA-256 before using it outside demos.
- **The Kaggle API key** (`~/.kaggle/kaggle.json`) on the development laptop has full control of the Kaggle account. Regenerate it after the competition, and never commit it (it is gitignored).
