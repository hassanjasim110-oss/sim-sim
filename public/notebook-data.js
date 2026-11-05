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
    // Muse Cream (founder, 2026-11-04 — "Theme colors from Muse"): Muse's own measured palette, light mode.
    // The Send button is pale blue with a near-black arrow (as Muse's own product does it); every OTHER primary
    // element (New chat, btn-primary) stays solid Muse blue with white text, via sendBg/sendInk (setup.js/styles.css).
    { id: 'muse-cream', name: 'Muse Cream', vibe: 'Warm', v: {
      bg: '#ffffff', side: '#f5f2ec', surface: '#ffffff', line: '#e4e5e5', text: '#222222', muted: '#767676', bubble: '#cce5fe',
      userBubble: '#cce5fe', simBubble: '#ffffff', accent: '#0073e7', accent2: '#0073e7', accentText: '#0073e7', accentInk: '#0073e7',
      primary1: '#0073e7', primary2: '#0073e7', onPrimary: '#ffffff', sendBg: '#cce5fe', sendInk: '#1a1a1a' } },
    // Muse Dark (founder, 2026-11-04 — "Theme colors from Muse"): Muse's own measured palette, dark mode. Filled
    // elements (buttons, Send, the user bubble) keep the pure brand blue with white text/arrow, since they have
    // good contrast on their own background; TEXT-colored accents (links, the active-nav tint) use the lightened
    // #4F9CF9 instead — #0073E7 as plain text on near-black reads too dim to be comfortably readable.
    { id: 'muse-dark', name: 'Muse Dark', vibe: 'Night', dark: true, v: {
      bg: '#0b0b0b', side: '#131313', surface: '#202020', line: '#3d3d3d', text: '#f5f5f5', muted: '#9c9c9c', bubble: '#0073e7',
      userBubble: '#0073e7', simBubble: '#202020', accent: '#0073e7', accent2: '#4f9cf9', accentText: '#4f9cf9', accentInk: '#4f9cf9',
      primary1: '#0073e7', primary2: '#0073e7', onPrimary: '#ffffff', composerBg: '#262626' } },
    { id: 'midnight', name: 'Midnight', vibe: 'Focused', dark: true, v: {
      bg: '#0f1520', side: '#141c2a', surface: '#1b2536', line: '#2a3650', text: '#e8edf6', muted: '#97a5bd', bubble: '#24314a',
      userBubble: '#263a5e', simBubble: '#1d2839', accent: '#5b95ff', accent2: '#8ab8ff', accentText: '#8ab8ff', accentInk: '#b3d0ff',
      primary1: '#3a6dd0', primary2: '#2c58b5', onPrimary: '#ffffff' } }
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
