# SIM SIM — CLAUDE.md

## PART A — THE PROJECT RULE

You are the coding builder for a project called SIM SIM. Read this rule first, before you write any code, and follow it for the whole project.

WHO OWNS THIS PROJECT
Sim Sim is Hassan Ali's project for the Meta Global AI Developer Hackathon (Indie track). Hassan is the founder and the decision-maker. You are his coding tool — like a worker who writes code from his instructions. Hassan directs the work with prompts, tests what you build, and owns the finished work. Do exactly what each prompt asks, one prompt at a time. Do not add features nobody asked for.

WHAT SIM SIM IS
A personal AI assistant that: (1) talks — voice in, voice out; (2) answers when Hassan calls its name, "Sim Sim" (the name is the wake word); (3) answers precise questions exactly, from real sources it cites; (4) remembers facts across sessions; (5) tracks every task until Hassan confirms it is done (open-loops); (6) gives a spoken morning briefing.

THE RULE — YOUR BRAIN CANNOT BE IN THIS PRODUCT
You (Claude) help BUILD Sim Sim. You are NOT Sim Sim's brain, and you can never become its brain.

- The ONLY AI brain allowed inside Sim Sim is Meta's model, through the Meta Model API. All thinking, reasoning, and conversation inside the product must go through the Meta Model API.
- NEVER write code that calls the Claude / Anthropic API, the OpenAI API, or any other AI model API inside this product. Not as the main brain, not as a fallback, not as a "temporary" brain.
- If a library, example, or your own suggestion would put a non-Meta model inside the product, STOP and flag it to Hassan in plain words before writing that code.
- Non-AI tools are fine: a file or database for memory, and Hassan's own source documents are plumbing, not brains. The rule is only about which model does the thinking.

SPEECH CLARIFICATION (Hassan stamped option B on 2026-10-24, after Claude flagged that speech tools are themselves small AI models):
Speech-to-text, text-to-speech, and wake-word listening are PLUMBING, not thinking — but only these sources are allowed for them, in this order:
1. FIRST: the browser's / phone's built-in voice tools (Chrome Web Speech — free, no API key).
2. ALSO ALLOWED: Meta's own speech tools, if the Meta Model API offers them and they test clearly better.
3. NO other provider's speech AI (no Whisper, no cloud-voice APIs) without asking Hassan first.
Speech models may ONLY convert sound to text and text to sound. All thinking, reasoning, and conversation goes through the Meta Model API only.
EARS HONESTY RULE (founder, 2026-10-24, after he caught simja's false wording): Chrome's built-in speech recognition is NOT on-device — Chrome sends the microphone audio to Google's speech servers to turn it into text. So any listening feature must tell users this, in the app, where they can read it. The ONLY true privacy promise Sim Sim may make is: non-wake words never reach SIM SIM's server, never reach the Meta brain, and are never stored by us. NEVER write or imply that non-wake words "go nowhere" or are "never sent anywhere" — in Chrome they pass through Google first, and our copy must say so.

PLACEHOLDER / STUB RULE (added 2026-10-24):
Before the Meta API key arrives, the only placeholder brain allowed is a DUMB stub that returns canned replies like "Meta brain not connected yet." Never use another AI model as a placeholder — not as the main brain, not as a fallback, not "temporarily." Note: the stub fixes the brain rule only — it does not change the build window (no product code before Mon Oct 26, 12:00 PM CT).

THE API KEY
Hassan will provide the Meta Model API key when the hackathon window opens. That key is a secret: keep it only on the server side (in an environment variable), never in the front-end code, never printed in chat output, never in a file that gets committed or shown in the demo. If you do not have the key, ask Hassan for it — never invent one and never substitute another provider's key.

HOW TO WORK WITH HASSAN
Hassan is a beginner at code. He drives with prompts. Keep explanations plain and short. Build in small steps, and after each step tell him exactly how to test it and what he should see if it worked. If a decision is his (a feature choice, a look/feel choice, anything creative), ask him instead of deciding for him.

---

## PART B — DESIGN (decided)

- **Layout:** like the Muse chat app.
  - Left sidebar: Sim Sim brand, New chat button, rows: Chat, Group Chat, Morning briefing, Open loops with a count badge, and the user's profile row at the bottom.
  - NO Memory row — memory lives inside Profile.
  - Main chat area: user messages as bubbles on the right, Sim Sim replies on the left with its avatar.
  - Top bar: a green "Listening for Sim Sim" pill and the Speak answers ON/OFF toggle.
  - One round bottom composer bar: "Talk or type to Sim Sim…" with a mic button and a send button.
- **Size:** full Chrome window. This is a web app; the page fills the whole browser window. Not phone-size, not a small box.
- **Fonts:** Poppins bold for the SIM SIM name and all headings (name never under 16px). Verdana for all body/message text, about 16–17px, line spacing about 1.6.
- **COMFY rule:** softer, warmer, roomier than a normal office chat app — rounded corners, generous spacing, soft shadows, warm light background. Design tokens as CSS variables at the top of the CSS, so the app can be re-themed later.
- **Initial theme:** the mockup file `sim-sim-look-5-like-muse-chat.html` is the starting reference. During the build, polish it better in the same direction, under Hassan's direction — same layout family, same fonts.
- **REJECTED — never build from these:** the dark + gold orb design, and Looks 1–4 (Clean Light, Color Wave, Tech Rings, Bright Friend).
- Image lane: a clear request to create a picture is handled by the Muse Image lane inside POST /api/chat before any answer classification; later steps must keep this lane and must skip image turns in memory/loop extraction.

---

## CHANGES LOG

### 2026-10-27 (night)
- **Screen Watch fix:** frames are scaled to 1280px on the long edge, JPEG 0.7. `/api/chat` reads its body with a picture-sized limit that says "That picture is too large", so the user's words are never blamed. A failed snapshot shows "I couldn't read that frame — try Look again." The mini chat floats in Chrome's Document Picture-in-Picture window, with the in-page panel as the fallback (the "Float" button).
- **Returning users:** a dev-door sign-in with an email that already has a Firebase-made account (matched on `profile.email`) opens THAT account (`accountForEmail` in server.js). A new email still gets `dev-<email>`. Setup shows only when the account has no profile.
- **Chat history:**
  - 1-on-1 threads are saved per user in `data/chats.json` (chats.js) and listed by the sidebar row "Chat history", newest first.
  - Opening a thread restores its last 12 messages as context, so it can be continued. The most recent chat opens on sign-in.
  - Title = the first message, cut near 60 characters. Pictures are never saved, and secret-looking messages are saved as a "not saved" note.
  - Screen Watch mini-chat turns are not saved. Export and "Forget everything" include chat history.
- **Discussion pacing:** the three calls still run in parallel. Answers are revealed one by one (Sim Sim, then bot 1, then bot 2), each after a "<name> is typing…" bubble. The `PACE` constants are in public/group.js. A new question shows the rest of a round at once. A pick made during the reveal is spoken when the reveal ends.
- **Composers:** the main box (Chat + Discussion) and the Screen Watch box are auto-growing textareas. Enter sends and Shift+Enter makes a new line (one `composer()` rule in public/app.js).
- **Settings completed:**
  - Account is first, with the call name, email and Sign out. A Back button returns to where the user was.
  - The briefing-time picker is removed; its line is now "Your briefing is ready when you open Sim Sim" (`briefingTime` stays stored and unused).
  - The theme saves through POST /api/profile.
  - "Forget everything" ends on the signed-out landing page.
  - The vault-off line reads exactly "Add VAULT_KEY to .env to turn on Saved logins".
  - Help and Legal copy updated (chat history, the Meta brain, listening).
- **Speak answers is ONE server setting:** `settings.speakAnswers` (default true). The page loads it at sign-in. The top bar and Settings both write it through POST /api/settings. The old browser value (`localStorage simsim-speak`) is moved to the server once, then deleted. When OFF, nothing makes sound: no wake chime, no spoken answers, and the wake reply is the "I'm here" bubble. The one exception is the briefing's explicit "Read it to me" button.
