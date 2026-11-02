// SIM SIM notebook data: the setup choices and the THEMES TABLE.
// Shared by the page (window.SIMSIM_DATA) and the server (require), so both use the same lists.
// Each theme is a set of CSS variables; the app paints itself only from these.
(function (root) {
  const GENDERS = ['Female', 'Male', 'Other', 'Prefer not to say'];

  const STATES = ['Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware', 'Florida', 'Georgia',
    'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland',
    'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey',
    'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina',
    'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming'];

  // The two helper bots. Sim Sim is the third member and the chief; its name is fixed.
  const BOT_ROLES = [
    { role: 'Researcher', blurb: 'facts + sources' },
    { role: 'Challenger', blurb: 'a different angle + the risks' }
  ];

  // v: bg = page background · side = sidebar tint · surface = cards · line = borders · text = main text · muted = quiet text
  //    bubble = soft hover tint · userBubble / simBubble = message bubbles · accent / accent2 = brand pair (mic, avatar)
  //    accentText = accent that reads on the background · accentInk = selected labels · primary1/2 + onPrimary = text buttons
  const THEMES = [
    { id: 'orange', name: 'Sim Sim Orange', vibe: 'Warm', v: {
      bg: '#fffaf5', side: '#f9eee2', surface: '#fffcf9', line: '#efe2d3', text: '#2a211b', muted: '#7d6a5b', bubble: '#f6ebdf',
      userBubble: '#fbe4d4', simBubble: '#fffcf9', accent: '#e8582a', accent2: '#ffa24a', accentText: '#c94818', accentInk: '#b23c10',
      primary1: '#c94818', primary2: '#b23c10', onPrimary: '#ffffff' } },
    { id: 'ocean', name: 'Ocean', vibe: 'Calm', v: {
      bg: '#f4f9fd', side: '#e6f1fa', surface: '#fcfeff', line: '#d3e3f0', text: '#122230', muted: '#506a7e', bubble: '#dcebf7',
      userBubble: '#d9eaf8', simBubble: '#fcfeff', accent: '#2a86d1', accent2: '#5ab8e8', accentText: '#1f6fb2', accentInk: '#175a93',
      primary1: '#1f6fb2', primary2: '#175a93', onPrimary: '#ffffff' } },
    { id: 'blossom', name: 'Blossom', vibe: 'Soft', v: {
      bg: '#fff6f8', side: '#fdeaf0', surface: '#fffcfd', line: '#f4d5df', text: '#2e1820', muted: '#85606c', bubble: '#fbdfe8',
      userBubble: '#fadbe5', simBubble: '#fffcfd', accent: '#d94a77', accent2: '#f59ab5', accentText: '#c43c68', accentInk: '#a52f55',
      primary1: '#c43c68', primary2: '#a52f55', onPrimary: '#ffffff' } },
    { id: 'forest', name: 'Forest', vibe: 'Fresh', v: {
      bg: '#f5faf3', side: '#e8f2e3', surface: '#fcfefb', line: '#d2e4ca', text: '#16241a', muted: '#5a6f5c', bubble: '#dcecd4',
      userBubble: '#d9ebd0', simBubble: '#fcfefb', accent: '#3a8f49', accent2: '#9acb6a', accentText: '#2f7a3d', accentInk: '#256431',
      primary1: '#2f7a3d', primary2: '#256431', onPrimary: '#ffffff' } },
    { id: 'sunset', name: 'Sunset', vibe: 'Bold', v: {
      bg: '#fff5f0', side: '#fde5dc', surface: '#fffcfa', line: '#f6cfc0', text: '#2b1512', muted: '#86584d', bubble: '#fcd9cc',
      userBubble: '#fcd7cb', simBubble: '#fffcfa', accent: '#e0405a', accent2: '#ff9f3c', accentText: '#c0303f', accentInk: '#a32535',
      primary1: '#c0303f', primary2: '#a32535', onPrimary: '#ffffff' } },
    { id: 'midnight', name: 'Midnight', vibe: 'Focused', dark: true, v: {
      bg: '#0f1520', side: '#141c2a', surface: '#1b2536', line: '#2a3650', text: '#e8edf6', muted: '#97a5bd', bubble: '#24314a',
      userBubble: '#263a5e', simBubble: '#1d2839', accent: '#5b95ff', accent2: '#8ab8ff', accentText: '#8ab8ff', accentInk: '#b3d0ff',
      primary1: '#3a6dd0', primary2: '#2c58b5', onPrimary: '#ffffff' } },
    { id: 'lavender', name: 'Lavender', vibe: 'Gentle', v: {
      bg: '#faf7fe', side: '#f1ebfa', surface: '#fdfbff', line: '#e2d6f2', text: '#211a2e', muted: '#6d6184', bubble: '#ebe1f8',
      userBubble: '#e8ddf8', simBubble: '#fdfbff', accent: '#8a5fd0', accent2: '#c3a6f0', accentText: '#7a4fc4', accentInk: '#633aa8',
      primary1: '#7a4fc4', primary2: '#633aa8', onPrimary: '#ffffff' } },
    { id: 'sand', name: 'Sand', vibe: 'Easy', v: {
      bg: '#fbf8f1', side: '#f3ecdd', surface: '#fffdf8', line: '#e5d9c3', text: '#29231b', muted: '#75695a', bubble: '#efe5d2',
      userBubble: '#eee2cc', simBubble: '#fffdf8', accent: '#b0874f', accent2: '#d8b27a', accentText: '#8c6430', accentInk: '#6f4e24',
      primary1: '#8c6430', primary2: '#6f4e24', onPrimary: '#ffffff' } }
  ];

  // Sim Sim's face (founder, 2026-10-29): starter faces shipped in public/faces/<id>.svg. Only the FACE changes —
  // the name "Sim Sim" is fixed and has no rename anywhere.
  const FACES = [
    { id: 'sunny', name: 'Sunny' }, { id: 'bolt', name: 'Bolt' }, { id: 'hoot', name: 'Hoot' },
    { id: 'puff', name: 'Puff' }, { id: 'kit', name: 'Kit' }, { id: 'pip', name: 'Pip' }
  ];

  const data = { GENDERS, STATES, BOT_ROLES, THEMES, FACES, DEFAULT_THEME: 'orange' };
  if (typeof module !== 'undefined' && module.exports) module.exports = data;
  else root.SIMSIM_DATA = data;
})(this);
