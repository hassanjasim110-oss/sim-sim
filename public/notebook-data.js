// SIM SIM notebook data: the setup choices and the THEMES TABLE.
// Shared by the page (window.SIMSIM_DATA) and the server (require), so both use the same lists.
// Each theme is a set of CSS variables; the app paints itself only from these.
(function (root) {
  const GENDERS = ['Female', 'Male', 'Other', 'Prefer not to say'];

  // 50 states + the District of Columbia (founder, 2026-11-04 — "Pretty dropdowns + Country + Language"): used as
  // the State list whenever Country = United States; any other country's state/province/region is free text instead.
  const STATES = ['Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware', 'District of Columbia', 'Florida', 'Georgia',
    'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland',
    'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey',
    'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina',
    'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming'];

  // The standard ~195-country list, alphabetical by English short name. Stored on the profile as plain text (no ISO
  // codes needed elsewhere in the app, unlike Language below, which has to carry a real code for the speech APIs).
  const COUNTRIES = ['Afghanistan', 'Albania', 'Algeria', 'Andorra', 'Angola', 'Antigua and Barbuda', 'Argentina', 'Armenia', 'Australia', 'Austria',
    'Azerbaijan', 'Bahamas', 'Bahrain', 'Bangladesh', 'Barbados', 'Belarus', 'Belgium', 'Belize', 'Benin', 'Bhutan',
    'Bolivia', 'Bosnia and Herzegovina', 'Botswana', 'Brazil', 'Brunei', 'Bulgaria', 'Burkina Faso', 'Burundi', 'Cabo Verde', 'Cambodia',
    'Cameroon', 'Canada', 'Central African Republic', 'Chad', 'Chile', 'China', 'Colombia', 'Comoros', 'Congo (Congo-Brazzaville)', 'Costa Rica',
    'Croatia', 'Cuba', 'Cyprus', 'Czechia (Czech Republic)', 'Democratic Republic of the Congo', 'Denmark', 'Djibouti', 'Dominica', 'Dominican Republic', 'Ecuador',
    'Egypt', 'El Salvador', 'Equatorial Guinea', 'Eritrea', 'Estonia', 'Eswatini', 'Ethiopia', 'Fiji', 'Finland', 'France',
    'Gabon', 'Gambia', 'Georgia', 'Germany', 'Ghana', 'Greece', 'Grenada', 'Guatemala', 'Guinea', 'Guinea-Bissau',
    'Guyana', 'Haiti', 'Honduras', 'Hungary', 'Iceland', 'India', 'Indonesia', 'Iran', 'Iraq', 'Ireland',
    'Israel', 'Italy', 'Jamaica', 'Japan', 'Jordan', 'Kazakhstan', 'Kenya', 'Kiribati', 'Kosovo', 'Kuwait',
    'Kyrgyzstan', 'Laos', 'Latvia', 'Lebanon', 'Lesotho', 'Liberia', 'Libya', 'Liechtenstein', 'Lithuania', 'Luxembourg',
    'Madagascar', 'Malawi', 'Malaysia', 'Maldives', 'Mali', 'Malta', 'Marshall Islands', 'Mauritania', 'Mauritius', 'Mexico',
    'Micronesia', 'Moldova', 'Monaco', 'Mongolia', 'Montenegro', 'Morocco', 'Mozambique', 'Myanmar (Burma)', 'Namibia', 'Nauru',
    'Nepal', 'Netherlands', 'New Zealand', 'Nicaragua', 'Niger', 'Nigeria', 'North Korea', 'North Macedonia', 'Norway', 'Oman',
    'Pakistan', 'Palau', 'Palestine', 'Panama', 'Papua New Guinea', 'Paraguay', 'Peru', 'Philippines', 'Poland', 'Portugal',
    'Qatar', 'Romania', 'Russia', 'Rwanda', 'Saint Kitts and Nevis', 'Saint Lucia', 'Saint Vincent and the Grenadines', 'Samoa', 'San Marino', 'Sao Tome and Principe',
    'Saudi Arabia', 'Senegal', 'Serbia', 'Seychelles', 'Sierra Leone', 'Singapore', 'Slovakia', 'Slovenia', 'Solomon Islands', 'Somalia',
    'South Africa', 'South Korea', 'South Sudan', 'Spain', 'Sri Lanka', 'Sudan', 'Suriname', 'Sweden', 'Switzerland', 'Syria',
    'Taiwan', 'Tajikistan', 'Tanzania', 'Thailand', 'Timor-Leste', 'Togo', 'Tonga', 'Trinidad and Tobago', 'Tunisia', 'Turkey',
    'Turkmenistan', 'Tuvalu', 'Uganda', 'Ukraine', 'United Arab Emirates', 'United Kingdom', 'United States', 'Uruguay', 'Uzbekistan', 'Vanuatu',
    'Vatican City', 'Venezuela', 'Vietnam', 'Yemen', 'Zambia', 'Zimbabwe'];
  const DEFAULT_COUNTRY = 'United States';

  // Spoken/written language — the one chosen set, founder's own order (not alphabetical): wires speech recognition
  // (recognition.lang), the brain's reply language, and the browser voice picked for Speak answers.
  const LANGUAGES = [
    { name: 'English', code: 'en-US' }, { name: 'Spanish', code: 'es-ES' }, { name: 'Urdu', code: 'ur-PK' }, { name: 'Arabic', code: 'ar-SA' },
    { name: 'Hindi', code: 'hi-IN' }, { name: 'Bengali', code: 'bn-IN' }, { name: 'Punjabi', code: 'pa-IN' }, { name: 'French', code: 'fr-FR' },
    { name: 'German', code: 'de-DE' }, { name: 'Italian', code: 'it-IT' }, { name: 'Portuguese', code: 'pt-BR' }, { name: 'Dutch', code: 'nl-NL' },
    { name: 'Polish', code: 'pl-PL' }, { name: 'Russian', code: 'ru-RU' }, { name: 'Ukrainian', code: 'uk-UA' }, { name: 'Turkish', code: 'tr-TR' },
    { name: 'Persian', code: 'fa-IR' }, { name: 'Chinese — Simplified', code: 'zh-CN' }, { name: 'Chinese — Traditional', code: 'zh-TW' }, { name: 'Japanese', code: 'ja-JP' },
    { name: 'Korean', code: 'ko-KR' }, { name: 'Vietnamese', code: 'vi-VN' }, { name: 'Thai', code: 'th-TH' }, { name: 'Indonesian', code: 'id-ID' },
    { name: 'Malay', code: 'ms-MY' }, { name: 'Filipino', code: 'fil-PH' }, { name: 'Swahili', code: 'sw-KE' }, { name: 'Greek', code: 'el-GR' },
    { name: 'Czech', code: 'cs-CZ' }, { name: 'Romanian', code: 'ro-RO' }, { name: 'Hungarian', code: 'hu-HU' }, { name: 'Swedish', code: 'sv-SE' },
    { name: 'Norwegian', code: 'nb-NO' }, { name: 'Danish', code: 'da-DK' }, { name: 'Finnish', code: 'fi-FI' }, { name: 'Hebrew', code: 'he-IL' }
  ];
  const DEFAULT_LANGUAGE = 'en-US';

  // The two helper bots. Sim Sim is the third member and the chief; its name is fixed.
  const BOT_ROLES = [
    { role: 'Researcher', blurb: 'facts + sources' },
    { role: 'Challenger', blurb: 'a different angle + the risks' }
  ];

  // v: bg = page background · side = sidebar tint · surface = cards · line = borders · text = main text · muted = quiet text
  //    bubble = soft hover tint · userBubble / simBubble = message bubbles · accent / accent2 = brand pair (mic, avatar)
  //    accentText = accent that reads on the background · accentInk = selected labels · primary1/2 + onPrimary = text buttons
  const THEMES = [
    // Design 7 (founder, 2026-11-03): the ChatGPT-structure reference's OWN colors — design-7-chatgpt-structure.html
    // (flat light-gray sidebar, white main column, soft gray user pills, near-black text) — on the rebuilt structure.
    // The reference itself has no accent color at all (every button is black); accent/accent2 here are used
    // sparingly (the mic, the listening-pill dot, focus rings) — a quiet teal, never the loud brand orange.
    { id: 'design7', name: 'Design 7', vibe: 'Clear', v: {
      bg: '#ffffff', side: '#f9f9f9', surface: '#f7f7f7', line: '#ececec', text: '#111111', muted: '#8e8e8e', bubble: '#f4f4f4',
      userBubble: '#f4f4f4', simBubble: '#ffffff', accent: '#10a37f', accent2: '#34c796', accentText: '#0e8c6d', accentInk: '#0b6f57',
      primary1: '#111111', primary2: '#000000', onPrimary: '#ffffff' } },
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

  // Design 7 (founder, 2026-11-03) is now the default presentation — what a fresh/new arrival sees, and setup's
  // own starting pick. Sim Sim Orange and every other theme stay in the list, unchanged and selectable.
  const data = { GENDERS, STATES, COUNTRIES, DEFAULT_COUNTRY, LANGUAGES, DEFAULT_LANGUAGE, BOT_ROLES, THEMES, FACES, DEFAULT_THEME: 'design7' };
  if (typeof module !== 'undefined' && module.exports) module.exports = data;
  else root.SIMSIM_DATA = data;
})(this);
