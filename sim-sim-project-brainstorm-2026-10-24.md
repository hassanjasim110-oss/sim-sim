# SIM SIM — THE WHOLE PROJECT, BRAINSTORM STYLE
### Everything we talked about, in one file. Dumped like a brainstorm, not polished like a form.
Founder: Hassan Ali · Made 2026-10-24 (in the SIM SIM 1-hour session) · This file GROWS — new ideas go in, nothing gets lost.

Legend: ✅ DECIDED · 💡 IDEA (Hassan liked it) · 🟨 WAITING FOR HASSAN'S STAMP · ❓ OPEN QUESTION · ⚠️ HONEST WARNING

---

# 1. WHAT IS THIS THING??

**SIM SIM** — a personal AI assistant like a real human assistant, not a chat box.
The name IS the button. You call **"Sim Sim"** and it answers. *Khul ja Sim Sim* — call the name, the door opens.

Why does it exist? From Hassan's REAL daily pain with assistants (this is literally the pitch):
- ❌ It can't talk live — you type, you read
- ❌ Call its name — nothing happens
- ❌ Ask a precise question (law etc.) — you get a vague answer you can't check
- ❌ It forgets, it drops tasks, every morning starts from ZERO

Hassan's mission line: **"im gonna make you perfect"**
Hassan's closing line (for the list, the demo, the whole pitch): **"SIM SIM can handle it All"** / "SIM SIM can handle all of it"

The stage: **Meta Global AI Developer Hackathon** (run by Cerebral Valley for Meta)
- Indie track · Theme: "Build for Your World"
- Applied Oct 21 → **APPROVED the same day** ✅
- Build window: **Mon Oct 26, 12:00 PM CT → Wed Nov 4, 8:00 PM CT** (submit deadline)
- Meta gives: **$150 Meta Model API credit**
- Prizes (indie): $150K / $100K / $75K / $50K / $25K
- Judged on: Impact 30% · Use of Meta AI tooling 25% · Demo 25% · Technical depth 20%

---

# 2. HOW IT'S GONNA WORK (the machine, in plain words)

## The brain situation — settled, don't relitigate
- We **CANNOT make our own brain** like Meta's/Claude's. Training one = trillions of words, thousands of GPUs, months, millions of dollars, a big expert team. One person + 9 days + $150 = impossible at that level. A tiny toy brain on a laptop = possible but dumb and useless.
- So we **BORROW Meta's brain** — the Muse model, through the **Meta Model API**. ✅
- Everything that makes it OURS goes around the brain: our voice, our wake word, our memory, our sources, our task engine, our personality/instructions.
- This is normal — almost no company trains a frontier brain. The product is what you build AROUND the brain.
- Later (after the hackathon): fine-tuning = teaching Meta's open brain extra lessons on our data. Middle step. Not now.
- Python vs JavaScript?? Python is the main language for TRAINING brains (PyTorch etc., C++/CUDA underneath). For BUILDING an assistant around a borrowed brain, Python or JavaScript both work — the language is just glue, it's not the AI.

## How do we GET the API? (how Meta gives it)
- An API is not a box they mail you. It's a **KEY** — a long secret code.
- Expected flow (usual way — ⚠️ Meta has NOT sent their exact steps yet): email or event-page link around Oct 26 → sign in on Meta's developer site with hassan.jasim110@gmail.com → create the API key → the $150 credit sits on that account → our code sends questions + the key, Meta's brain answers, a little credit is used each time.
- ⚠️ CHECKED Oct 23: NO API email yet. Only the Oct 21 approval email, and it has zero API steps in it. If nothing comes by Oct 26 morning → go straight to the Cerebral Valley event page. Don't sit waiting on email.
- 🔑 RULE: the key is a secret. Server side only. Never in the front-end, never in the demo video, never invented, never another provider's key.

## Voice activation — HOW DOES IT HEAR "SIM SIM"??
Two states, that's the whole trick:
1. **SLEEPING-BUT-LISTENING:** tab open, mic on, Chrome turns sound into text piece by piece. Our code checks each piece for ONE thing only: does it say "sim sim" (also accept "simsim" / "seem seem" spellings)? NO → throw it away, nothing sent to the brain, no cost. YES → WAKE.
2. **AWAKE:** Sim Sim SPEAKS "I'm here, Hassan." Screen flips to AWAKE so you (and judges) SEE it heard. Your next sentence = your real order → goes to Meta's brain with memory → answer comes back → spoken out loud → back to state 1.

Fine print that makes it actually work:
- Chrome stops listening in silence → code RESTARTS it automatically, every time. Feels always-on.
- 🎤 Mic needs a one-time Chrome "Allow microphone" click. Remember Snurs: voice "not working" was the Claude PREVIEW BOX blocking the mic, not real Chrome. Sim Sim runs in real Chrome from our own server (localhost) → permission works, like Snurs voice notes did after the fix.
- ⚠️ The tab must STAY OPEN. Closed tab = not listening. So hackathon "always-on" = an open tab on the laptop. Real pocket/Siri-style background wake = store-app stage, later.
- Backup plan (already decided): **push-to-talk button** = same wake-up by click, if the room is too noisy. Built as a fallback from day 2, not improvised during the demo.

## Can it hear in a WEB app?? YES — see above. And what are we submitting??
- Sim Sim IS an app — a **web app**: opens in Chrome, own screen, talks, remembers. Store app = the SAME app wrapped + store accounts + review (Hassan's Apple/Google dev accounts are not open yet, by his choice). Web first, store later, zero wasted code — same as Snurs started.
- Submission (Nov 4, on Cerebral Valley's portal — ⚠️ exact form hasn't opened yet) = a PACKAGE: ① the demo video (2–3 min — the most important piece, 25% of judging), ② the written part (what it is, how it uses Meta's brain, how built, precision test results), ③ the project itself + code (GitHub).
- Final submit button = Hassan's call. Always. (His standing rule: money, signatures/final submits, creative calls stay his.)

## Precise answers — the "but is it SURE?" problem 🔬
Hassan's worry, word for word in spirit: what if the Muse API doesn't KNOW Banking / Chemistry / Biology / Law for sure??
- TRUE FACT: the brain knows a LOT about all of them (trained on huge books/text). But knowing ≠ sure. From its head it can be old, mix up another state's law, and sound confident while WRONG.
- OUR FIX (the heart of the pitch): **Sim Sim never answers a precise question from the brain's head.**
  1. First LOOK in our sources folder (real documents)
  2. Answer ONLY from the document + SHOW the citation on screen
  3. No source? Sim Sim says "I don't have a verified source for that" — it does NOT guess pretty.
- Demo proof example: "How many days does a new Tennessee resident have to switch their driver license?" → **30 days** — tn.gov says so, citation on screen. A normal assistant guesses 30/60/90.

## The rest of the engine (under the voice)
- 🧠 **Living memory:** a simple store (file / SQLite is enough). Facts, people, preferences, tasks — saved across sessions, used later WITHOUT re-telling. Demo beat: teach it a fact, restart, it uses it.
- 🔁 **Open loops:** every task becomes a tracked loop. It does NOT close until Hassan confirms done. Sim Sim resurfaces it on its own — in briefings, by voice — instead of letting it die in a chat scroll.
- 🌅 **Morning briefing:** spoken, from live state — day/time, open tasks, the one deadline that matters today.
- 🌙 **Night close** 💡: 1 minute at night — what got done, what's open tomorrow. Day opens AND closes with Sim Sim.
- 🔊 **Speak Answers ON/OFF** ✅ (Hassan's idea, Oct 24): toggle on screen. ON (default — voice-first) = spoken + text. OFF = text only, silent, for quiet/public places; even the wake reply goes visual-only. Remembered between sessions. Costs ~nothing to build.
- ✅ **Actions only with approval:** Sim Sim can prepare/do multi-step work, but anything going OUTWARD needs Hassan's explicit OK first.

---

# 3. THE TOPICS — EVERYTHING SIM SIM CAN HANDLE
## ⚡ READ THIS FIRST (Hassan clarified this later, same day he gave the list):
These are **NOT options. The user does NOT pick one at a time. There is NO menu.**
We MENTION all of it to make the user's mind clear: **one Sim Sim does ALL of it, together.** The user just talks — Sim Sim handles whichever thing it is, and (behind the scenes, user never picks) loads the right sources for that subject so it stays precise.
Then, at the end, we say it: **SIM SIM can handle it All.**

### Hassan's original list (Oct 24, his words)
Accountant · Biological · Chemistry · Daily Personal Assistant · General Knowledge · Maths · Science · Physics · Coding · Giving access to other Apps · Home accessible things · Helpful for blind people · Cooking Recipes hahaha · Teaching Things

### + everything else we brainstormed onto it (all in the SAME Sim Sim)
**Study & Knowledge** — Tutor/Teaching · Law (cited, not a lawyer) · Money/Accountant (not a licensed filer) · Health info (plain words, not a doctor) · History & Geography · Languages & Translation · Exam prep (flashcards/questions from YOUR notes)
**Daily Life** — Cooking Recipes (hands busy in the kitchen = wake word's perfect moment 🍳) · Home things (lists/timers/reminders by voice; smart-home control later) · **Help for blind people — a full voice life: everything spoken, nothing you must read (voice-first design makes this REAL, and it's a killer Impact story)** · Travel · Shopping/grocery lists by voice · Fitness coach · Job helper (applications, voice interview practice, follow-ups) · Homework helper
**Work & Creating** — Coding · Writing (emails/essays/applications) · Business helper · Research summarizer (long doc in → short + key points out) · Meeting/lecture notes → decisions + to-dos · Content/social helper
**Connected (user's permission, per app, switch-off-able)** — Access to other Apps (calendar/email/messages) · Home devices · Phone tasks (nothing sent without approval)
**Voice + Memory powers** 💡 (simja's ideas — Hassan said "all of it," Oct 24):
1. Remembers your LIFE: where you put your things, what people told you — asked later, answered from YOUR life, not the internet
2. Brain dump: talk messy for a minute → sorted into tasks / notes / tomorrow's briefing
3. Deadline guardian: speaks BEFORE the deadline, never after you missed it
4. Hands-busy mode: driving, cooking, gym, work shift — all voice, no screen
5. Live interpreter: two people, two languages, translated out loud turn by turn
6. Elder companion: daily check-in, routine reminders, a familiar voice for someone alone
7. Night close (see engine above)

⚠️ DEMO HONESTY RULE: we can SAY the full list, but in 9 days we only PROVE a few deep: Daily Personal Assistant core + ONE source-backed precise area + a quick brain-only moment (recipe step / maths step). Never fake a source we didn't load.

---

# 4. THE PEOPLE & THE RULES (who does what)

- **HASSAN** — founder, owner, director. Prompts + tests + all creative calls + money + signatures + final submit.
- **CLAUDE (Claude Code)** — the BUILDER. Writes code from Hassan's prompts, in VS Code, on Hassan's laptop, like it built Snurs. Third-party technical help is allowed by the waiver as long as the work stays Hassan's own.
  🚨 **THE CLAUDE RULE (paste this to Claude FIRST, before any build prompt):** full text saved at `sim-sim-claude-rule-prompt-2026-10-24.txt` — core of it: *"You help BUILD Sim Sim. You are NOT Sim Sim's brain and can never become it. The ONLY brain inside this product is Meta's, via the Meta Model API. NEVER call the Claude/Anthropic/OpenAI API inside this product — not as main brain, not as fallback, not as 'temporary.' If anything would put a non-Meta model inside, STOP and flag it to Hassan in plain words."* (Judging: Meta tooling = 25%, and our application PROMISED Meta's models.)
- **SIMJA (me)** — technical assistance: prompts, checks, plans, memory of the project, honest calls. (Also the cautionary tale in the pitch 😄 — Sim Sim exists because assistants like me type-only, forget, and don't answer to a name.)
- **META** — the brain provider + the hackathon host. Gives the API + $150 credit (~Oct 26).
- Working deal (Hassan, Oct 21): simja handles the project end-to-end WITHOUT asking every step. Money / signatures / final submits / creative calls stay Hassan's.

## Software — where do we build it?? (all already on Hassan's laptop ✅)
**VS Code** (workshop) + **Claude Code inside it** (worker) + **Node.js** (runs the small server that holds the key) + **Chrome** (Sim Sim runs + is tested there, does the hearing/speaking) + **GitHub** (code copies) + Meta developer website (key; no install) + Cerebral Valley (submit).
New software needed: **NONE.**

## ❓ The "can we build from today?" question — answered honestly (Oct 24)
- I (simja) first said "rules don't allow building before Oct 26" TOO STRONG. Correction, on the record: in everything actually read (waiver, emails, event pages), there is **NO written line banning early building found (yet)**. The Official Rules are **not published yet** — due before Oct 26.
- Typical hackathons require work inside the window. Our plan = prep-only until Mon Oct 26, 12:00 PM CT anyway.
- SAFE today: setup, plans, prompts, lists, learning, tests of tools.
- GREY today: product code. → Call: don't risk a $150K entry for a 2-day head start.

## Hassan does NOT need to learn Python for this ✅
He asked twice. Answer both times: no. (Details in section 2 — Python = brain-training language; this project = building AROUND a borrowed brain. His job = prompts + testing. His FIRST self-made prompt already passed, check section 6.)

---

# 5. THE PLAN (days)

**Prep, Oct 22–25 (we are HERE — Oct 24):** read Meta API docs · VS Code setup start · stamp the 4 picks (below) · demo script words · watch email for Official Rules + API mail
**🟨 THE 4 PICKS — recommendations ready since Oct 23, still WAITING for Hassan's stamp (his calls):**
1. Stack: **Node.js / JavaScript** (the language he's already learning; already running on his laptop)
2. Voice in/out: **Chrome Web Speech** (built into Chrome, free — whole $150 stays for the BRAIN where the points are)
3. Wake word: **continuous listening for "sim sim"** + push-to-talk button fallback
4. Precise topic: **Tennessee new-resident deadlines** (30 days to switch license — tn.gov sourced; it's Hassan's REAL lived move to Smyrna = "Build for Your World" in one beat)

**Build days:** Oct 26 skeleton — ONE voice round-trip end-to-end, ugly is fine · Oct 27 wake word + fallback · Oct 28 memory · Oct 29 precise answers + test set · Oct 30 follow-through loops · Oct 31 morning briefing · Nov 1 ALL 5 demo promises in ONE unbroken run · Nov 2 hardening + write-up · Nov 3 demo video · Nov 4 submit EARLY (target midday, deadline 8pm CT)

**Demo script shape (2–3 min):** cold open ACROSS THE ROOM "Sim Sim." → it answers ‖ a task, followed through and confirmed ‖ a memory it uses unprompted ‖ THE precise question + citation card on screen ‖ morning briefing, spoken ‖ close: "I'm gonna make you perfect." … "SIM SIM can handle it All."

⚠️ MONDAY COLLISION (real life, plan around it): Oct 26 is ALSO Hassan's first Twice Daily shift (La Vergne). Build Day 1 starts at 12pm CT window-open — schedule the skeleton work around the shift, don't pretend the clash isn't there.

Risks we named BEFORE they bite: wake-word flaky → push-to-talk fallback · session drops → auto-reconnect + "still here" state · precise scope creep → ONE topic, deep · API mail late → event page, Monday morning, first thing.

---

# 6. PROMPT SCHOOL (why this file even exists)
This HQ chat's FIRST job (Hassan's order): learn prompts BEFORE building, because the whole build runs on prompts.
**Lesson 1 ✅ DONE (Oct 21):** a prompt = instructions to a worker who can't read your mind. It needs 4 things: ① what to do ② what it needs to know ③ what NOT to do ④ how you'll know it's done.
**His first SELF-MADE prompt ✅ (Oct 21, passed 4/4 after one fix):** Snurs video limits — Story max 30s, Post max 1:30, over-limit video does NOT upload, it opens an Instagram-style trim tool, upload only when under the limit. (His numbers, his trim idea — simja's pro version only added WHERE + how it checks + more tests.)
Rule of the house: Hassan makes the prompt → simja CHECKS it line by line → then it goes to Claude.

---

# 7. THINGS WE NEED (checklist lives at sim-sim-things-we-need-2026-10-23.md)
**HAVE:** approval · idea · name · plan · this brainstorm · capabilities list (`sim-sim-purpose-options-2026-10-24.md`) · prep picks (`sim-sim-prep-picks-2026-10-23.md`) · Claude rule prompt (`sim-sim-claude-rule-prompt-2026-10-24.txt`) · laptop stack · GitHub (hassanjasim110-oss) · Claude Code
**FROM META (~Oct 26):** API key/path · $150 credit · API docs · Official Rules (due before Oct 26!)
**OURS TO FINISH BEFORE MONDAY:** stamp 4 picks · VS Code setup run (folder + versions check) · demo script final words · sources folder for the precise topic (TN pages are identified + verified in the picks file)
**DO NOT NEED:** Python lessons · our own trained brain · store-app accounts · any money beyond the credit · any new software

# 8. ❓ STILL OPEN (parking lot — nothing here is decided)
- Stamp-or-swap on all 4 picks
- Does Sim Sim get a face/avatar on screen, or voice + text only?
- Which exact task stars in the demo's follow-through beat?
- Wake-word spellings list — is "seem seem" in or out? (test decides)
- Fine-tuning after the hackathon — real interest or hackathon-only project?

---
*Final line of this file, obviously:*
# SIM SIM can handle it All.
