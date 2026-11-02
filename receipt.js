// SIM SIM — "How I answered": the receipt under each 1-on-1 answer (founder, 2026-10-29).
// Plain code, no AI: the steps are composed ONLY from facts of the route the server actually took, and the time is the
// server's own measurement (request arrived -> reply ready). A step that did not run is never listed; an unknown is left out.
// The receipt is never fed to the brain, the notebook or memory learning.

// How long, in words for the page ("2.4s") and for speech ("2.4 seconds").
function shortTime(ms) { return ms < 100 ? 'under 0.1s' : (ms / 1000).toFixed(1) + 's'; }
function spokenTime(ms) { return ms < 100 ? 'under a tenth of a second' : (ms / 1000).toFixed(1) + ' seconds'; }

const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

// p: the process facts gathered along the route. Returns [{ text, links? }] in the order the steps ran.
function steps(p) {
  const out = [];
  const add = (text, links) => out.push(links && links.length ? { text, links } : { text });
  if (p.stub) { add("The Meta brain isn't connected yet, so this is the placeholder reply"); return out; }
  if (p.command) add(p.command);   // handled by Sim Sim's own code, no brain call
  // the Action Layer: only actions that actually ran (from their results), plus any held for the user's OK / refused / declined
  (p.actions || []).forEach(a => add(a));
  if (p.usedMake) {
    add('Read your message as a request to make a picture');
    add(p.usedMake === 'failed' ? 'Tried to make the picture with Muse Image (Meta\'s image model) — it didn\'t work' : 'Made the picture with Muse Image (Meta\'s image model)');
  }
  if (p.usedEdit) {
    add('Read your message as a change to a picture');
    if (p.usedEdit === 'nophoto') add('There was no picture in this chat to edit');
    else {
      const which = p.usedEdit === 'upload' || p.usedEdit === 'upload-failed' ? 'the photo you attached' : 'the latest picture in this chat';
      add(/failed$/.test(p.usedEdit) ? 'Tried to edit ' + which + ' with Muse Image — it didn\'t work' : 'Edited ' + which + ' with Muse Image (Meta\'s image model)');
    }
  }
  if (typeof p.usedNotebook === 'number') {
    add('Loaded your profile and notebook (' + (p.usedNotebook ? plural(p.usedNotebook, 'fact', 'facts') : 'no facts yet') + ')' +
      (p.openLoops ? ' and ' + plural(p.openLoops, 'open loop', 'open loops') : ''));
  }
  if (p.usedVision) add(p.usedVision === 'failed' ? "Couldn't look at your picture this time — answered your words only" : 'Looked at your picture');
  if (p.sorted === 'plain') add('Sorted the question: everyday chat, answered from what Sim Sim knows');
  if (p.sorted === 'checked') add('Sorted the question: it has high-stakes specifics, so they were checked against sources');
  if (p.bookChecked !== undefined) {
    if (p.usedBook && p.usedBook.length) add('Checked the Book — the answer stands on ' + (p.usedBook.length === 1 ? 'this source:' : 'these sources:'), p.usedBook);
    else if (p.bookChecked) add('Checked the Book' + (p.bookTopic ? ': ' + p.bookTopic : '') + " — it didn't back this answer");
    else add('Checked the Book — it has no page on this');
  }
  if (typeof p.webSearched === 'number') {
    add('Searched for official pages online: ' + (p.webSearched ? 'found ' + plural(p.webSearched, 'page', 'pages') : 'none found'));
    if (p.usedWeb && p.usedWeb.length) add('Read the official ' + (p.usedWeb.length === 1 ? 'page' : 'pages') + ' the answer stands on', p.usedWeb);
  }
  if (p.usedDocument) add(p.usedDocument === 'failed' ? "Tried to make a PDF file — it didn't work, so no file was made" : 'Made: ' + p.usedDocument.title + '.pdf');
  if (p.usedWebsite) add(p.usedWebsite === 'failed' ? "Tried to make a website — it didn't work, so no page was made" : 'Made: ' + p.usedWebsite.title + '.html');
  if (p.browser) {   // Sim Sim's browser: only the pages it really opened and read (or looked at)
    const b = p.browser;
    if (b.failed === 'brain') add("Used Sim Sim's browser, but the Meta brain didn't answer — the task stopped");
    else if (b.failed) add("Tried to use Sim Sim's browser — it couldn't start");
    else {
      add("Used Sim Sim's browser (" + plural(b.steps || 0, 'step', 'steps') + ')' + (b.pages && b.pages.length ? ' — the pages it read:' : ' — no page was read'), b.pages || []);
      if (b.shots) add('Looked at ' + plural(b.shots, 'screenshot', 'screenshots') + ' of the page');
      if (b.stopped) add('You stopped the task');
    }
  }
  if (p.wrote) add('The Meta brain wrote the answer' + (p.unverified ? ' — exact details it couldn\'t verify are said plainly, not guessed' : ''));
  if (p.guardian) add('Added a reminder from your open loops');
  if (p.savedChat) add('Saved this turn to your Chat history');
  // added later by the learn step, with the counts it actually saved
  if (p.savedMemory) add('Saved ' + plural(p.savedMemory, 'thing', 'things') + ' to your notebook for next time');
  if (p.savedLoops) add('Updated your open loops (' + plural(p.savedLoops, 'change', 'changes') + ')');
  return out;
}

// One plain line for "how long did that take?".
function summary(list) {
  return list.map(s => s.text.replace(/ \(Meta's image model\)/, '')).join('; ');
}

// ---- Asking in chat (handled by code, before the brain) ----
// "how long did that take?", "how long did you take", "how fast was that", "how did you answer that?"
// The WHOLE message must be the question — "how long did it take to renew my license?" is a real question for the brain.
const LEAD_IN = "^(?:(?:ok|okay|so|and|hey|wow|sim\\s*sim)[,\\s]+)*";
const ABOUT_LAST = [
  new RegExp(LEAD_IN + "how (?:long|fast|quick(?:ly)?|many seconds) (?:did|was) (?:that|it|this|you|that answer|that one|your (?:last )?answer)" +
    "(?: (?:take|took))?(?: you)?(?: to (?:answer|reply|respond|do that|think))?(?: (?:just now|there))?[\\s?.!]*$", 'i'),
  new RegExp(LEAD_IN + "how did you (?:answer|get|come up with|work out|figure out) (?:that|this)(?: one| answer)?(?: just now)?[\\s?.!]*$", 'i')
];
function asksAboutLast(text) {
  const t = String(text || '').trim();
  return ABOUT_LAST.some(re => re.test(t));
}
// "how do you answer questions?", "what is your process?", "how does Sim Sim work?"
const PROCESS_ASKS = [
  // ("how do you work?" is NOT here: it is about all of Sim Sim, answered from about.md — founder, 2026-10-30)
  new RegExp(LEAD_IN + "how do you (?:answer(?: (?:questions|things|me))?|come up with (?:your )?answers|decide what to (?:say|answer))" +
    "(?:,? sim\\s*sim)?[\\s?.!]*$", 'i'),
  new RegExp(LEAD_IN + "what(?:'s| is) your (?:process|method)(?: for answering(?: questions)?)?(?:,? sim\\s*sim)?[\\s?.!]*$", 'i'),
  new RegExp(LEAD_IN + "how does sim\\s*sim (?:answer(?: questions)?|work)[\\s?.!]*$", 'i')
];
function asksProcess(text) {
  const t = String(text || '').trim();
  return PROCESS_ASKS.some(re => re.test(t));
}

function lastAnswerLine(last) {
  if (!last) return "I don't have timing saved for that one.";
  return 'That took ' + spokenTime(last.ms) + ' on my side. ' + (last.steps.length ? 'Steps: ' + summary(last.steps) + '.' : '');
}

// The fixed, truthful explanation of Sim Sim's own parts — never improvised, never anyone else's tools.
const PROCESS_TEXT = "Here's how I answer. Your message arrives at Sim Sim's server, and I load your profile and notebook. " +
  'Then I pick the road the message needs: plain chat, the Book (official sources saved for Sim Sim), an official page online, ' +
  'looking at a picture you share, making a picture, or editing one. Meta\'s models do the work — the Meta brain writes the words, ' +
  'and Muse Image makes or edits pictures. Then the chat is saved to your Chat history, and anything worth keeping is learned into ' +
  'your notebook for next time. Under each answer, the time it took on my side is shown.';

module.exports = { steps, summary, shortTime, spokenTime, asksAboutLast, asksProcess, lastAnswerLine, PROCESS_TEXT };
