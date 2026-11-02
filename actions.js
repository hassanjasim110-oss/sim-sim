// SIM SIM — the Action Layer (founder, 2026-10-31, the Muse pattern): Sim Sim gets HANDS in its own app, governed by the
// user's PERMISSIONS. The 1-on-1 chat brain may call these tools (the same function-tool shape as the browser's tools);
// OUR code runs them (server.js runAction) and every call returns a result { ok, detail } — the brain may only claim what a
// result confirms. Discussion has no actions. Actions fire only in answer to the user's own ask in that turn.
//
// Permissions (settings.permissions, per user): each GROUP is allow | ask | never.
//   allow -> runs at once · ask -> an allowance card in the chat (Allow / Always allow <group> / Not now) · never -> refused before it runs.
// FLOOR actions always ask, whatever their group says (the Settings page marks them "Always asks").

const GROUPS = {
  chats: { name: 'Chats', does: ['Make a new side chat', 'Turn this conversation into a side chat', 'Rename the chat you are in', 'Open one of your chats', 'Delete the chat you are in (always asks)', 'Delete all of your chats (always asks)'] },
  views: { name: 'Views', does: ['Open Discussion, Morning briefing, Open loops, Your pictures, Browser, Settings or Profile'] },
  appearance: { name: 'Appearance', does: ['Change the theme', 'Change the text size', 'Pick a starter face (or the default) for Sim Sim or a Discussion bot'] },
  voice: { name: 'Voice', does: ['Turn Speak answers on or off', "Change Sim Sim's voice (only voices that are set up)"] },
  memory: { name: 'Memory & loops', does: ['Add an open loop', 'Mark an open loop done', 'Forget a fact from your notebook (always asks)', 'Turn the morning briefing on or off', 'Set the time of the morning briefing'] }
};
// Always ask — can't be turned off. Some have no tool yet; they are listed so the rule is in place before any of them exist.
const FLOOR_LIST = ['Deleting a chat', 'Deleting all chats', 'Forgetting a fact', 'Using a saved login', 'Sending or posting anything outside the app', 'Paying for anything'];
const FLOOR = new Set(['delete_current_chat', 'delete_all_chats', 'forget_fact']);

const VIEWS = ['discussion', 'briefing', 'loops', 'pictures', 'browser', 'settings', 'profile'];
const VIEW_NAMES = { discussion: 'Discussion', briefing: 'Morning briefing', loops: 'Open loops', pictures: 'Your pictures', browser: 'the Browser', settings: 'Settings', profile: 'your Profile' };

const fn = (name, group, description, properties, required) =>
  ({ group, tool: { type: 'function', function: { name, description, parameters: { type: 'object', properties: properties || {}, required: required || [] } } } });
const str = d => ({ type: 'string', description: d });
const REGISTRY = [
  fn('create_side_chat', 'chats', 'Make a NEW, empty side chat and move the user into it. Use for a new topic that is not this conversation.', { name: str('Its name, in the user\'s words (optional)') }),
  fn('convert_this_chat_to_side', 'chats', 'Turn THIS conversation into a side chat (it moves, nothing is copied); the user stays in it and the main Chat starts fresh. Use for "a side chat for this".', { name: str('Its name (optional; else it keeps its title)') }),
  fn('rename_current_chat', 'chats', 'Rename the chat the user is in.', { name: str('The new name, up to 60 characters') }, ['name']),
  fn('open_chat', 'chats', 'Open one of the user\'s saved chats by its title ("Chat" = the main chat).', { threadTitle: str('The chat\'s title, or part of it') }, ['threadTitle']),
  fn('delete_current_chat', 'chats', 'Delete the chat the user is in. Always asks the user first.'),
  fn('delete_all_chats', 'chats', 'Delete EVERY one of the user\'s chats, including the Main chat and its history (their memories, open loops, reminders and settings are untouched). Use for "delete all my chats" — never for a single chat (use delete_current_chat for that). Always asks the user first.'),
  fn('open_view', 'views', 'Open one of the app\'s screens.', { view: { type: 'string', enum: VIEWS } }, ['view']),
  fn('set_theme', 'appearance', 'Change the app\'s color theme.', { theme: str('Theme name: Sim Sim Orange, Ocean, Blossom, Forest, Sunset, Midnight, Lavender, …') }, ['theme']),
  fn('set_text_size', 'appearance', 'Change the chat text size.', { size: { type: 'string', enum: ['comfortable', 'large'] } }, ['size']),
  fn('set_face', 'appearance', 'Set a face to one of the starter gallery faces, or back to the default. Uploading or making a face is done in Settings (open_view settings).',
    { seat: { type: 'string', enum: ['sim', 'bot1', 'bot2'] }, gallery: str('A starter face id (sunny, bolt, hoot, puff, kit, pip) or "default"') }, ['seat', 'gallery']),
  fn('set_speak_answers', 'voice', 'Turn Speak answers (Sim Sim reading its answers aloud) on or off.', { on: { type: 'boolean' } }, ['on']),
  fn('set_voice', 'voice', 'Change Sim Sim\'s speaking voice to one of its designed voices.', { name: str('The voice\'s name') }, ['name']),
  fn('set_briefing_enabled', 'memory', 'Turn the morning briefing on or off (the Settings → Briefing & loops switch). Use for "turn off/on the morning briefing".', { on: { type: 'boolean' } }, ['on']),
  fn('set_briefing_time', 'memory', 'Set the time of day the morning briefing is for (the Settings → Briefing & loops time).', { time: str('A time of day, in the user\'s words, e.g. "7am", "7:30 AM", "19:00"') }, ['time']),
  fn('add_loop', 'memory', 'Add a task to the user\'s open loops.', { text: str('The task, short, in the user\'s words') }, ['text']),
  fn('complete_loop', 'memory', 'Mark one of the user\'s open loops done.', { match: str('Words from the loop') }, ['match']),
  fn('forget_fact', 'memory', 'Forget one fact from the user\'s notebook. Always asks the user first.', { match: str('Words from the fact') }, ['match'])
];
const TOOLS = REGISTRY.map(r => r.tool);
const groupOf = name => (REGISTRY.find(r => r.tool.function.name === name) || {}).group || null;

// allow | ask | never for this action, from the user's settings (floor actions always ask, unless the group is never).
function decision(perms, name) {
  const g = groupOf(name);
  const p = (perms && perms[g]) || 'allow';
  if (p === 'never') return 'never';
  return FLOOR.has(name) ? 'ask' : p;
}

// A cheap gate before the extra brain call: the message names something in the app AND has a doing-word. Only then does
// the brain get the tools (it may still just answer — then the message flows on to the usual lanes, untouched).
const APP_THING = /\b(?:side[\s-]?chats?|chats?|threads?|conversations?|themes?|dark mode|light mode|midnight|ocean|blossom|forest|sunset|lavender|text size|font size|text (?:bigger|larger|smaller)|faces?|avatars?|voices?|speak(?:ing)? answers|read (?:your |the )?answers|out loud|aloud|settings|permissions|profile|pictures|gallery|discussion|briefing|open loops?|loops?|to-?dos?|task list|tasks?|notebook)\b/i;
const DOING = /\b(?:make|create|start|open|show|go|take|switch|change|set|turn|put|use|rename|name|call|delete|remove|add|mark|complete|close|finish|forget|stop|mute|can you|could you|would you|please)\b/i;
function mightAct(message) { return APP_THING.test(message) && DOING.test(message); }

// The brain's rules for this turn (added to the identity/system copy for the action call).
const RULES = '\n\nYOU HAVE HANDS IN THIS APP (tools). The user can see the app; you can change it with these tools, under their Permissions:' +
  '\n- When the user ASKS you to do something in the app (make/open/rename/delete a chat, open a screen, change the theme, text size, a face,' +
  ' Speak answers or your voice, add or finish an open loop, forget a fact), CALL THE TOOL. Never describe doing it instead, and never coach' +
  ' them to rephrase. The sentence family "I only reply inside this chat", "I don\'t have the controls", "I can\'t make a side chat from here",' +
  ' "use the button and tell me there", or "start it from the list and tell me there" is BANNED — with hands, it is false.' +
  '\n- A QUESTION about what you can do ("can you make side chats?", "what is a side chat?") is answered in words — call NO tool.' +
  '\n- Claim only what a tool result confirms. ok:false -> say it did not work and the plain reason. blocked:"permission" -> say which' +
  ' Permissions setting blocks it and that it can be changed in Settings → Permissions. denied:true -> accept it in one short, graceful line; do not ask again.' +
  ' pending:true -> say in one short line that you need their OK on the card shown.' +
  '\n- Uploading or making a NEW face is done in Settings (open it with open_view settings); gallery faces and the default can be set directly.' +
  '\n- At most 3 actions per message. After the tools, reply in 1–2 short sentences confirming exactly what the results say.';

module.exports = { GROUPS, FLOOR, FLOOR_LIST, TOOLS, VIEWS, VIEW_NAMES, groupOf, decision, mightAct, RULES };
