// Player pictures (round icons).
// Real players pick one of the pictures in avatars/p*.webp.
// Robots always get a 3D-style robot face; each robot at the table gets
// its own colour: 1st yellow, 2nd blue, 3rd purple, 4th red.
export const AVATAR_IDS = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p10', 'p11', 'p12', 'p13', 'p14', 'p15'];
export const BOT_AVATARS = ['bot0', 'bot1', 'bot2', 'bot3'];

const BOT_COLORS = [
  { hi: '#fff3a0', mid: '#ffd23a', lo: '#c98a00', bg: '#2e6b4a' }, // yellow
  { hi: '#bfe6ff', mid: '#3d9cf0', lo: '#1c5aa8', bg: '#f4c542' }, // blue
  { hi: '#e7d0ff', mid: '#9b5cf0', lo: '#5d2aa8', bg: '#7fe3a0' }, // purple
  { hi: '#ffc4c4', mid: '#ef4b4b', lo: '#a01d1d', bg: '#7fd3f0' }, // red
];

function robot(i) {
  const c = BOT_COLORS[i % BOT_COLORS.length], g = 'rb' + i;
  return `<svg class="avf" viewBox="0 0 100 100" aria-hidden="true">
  <defs>
    <radialGradient id="${g}h" cx="38%" cy="30%" r="75%"><stop offset="0" stop-color="${c.hi}"/><stop offset=".55" stop-color="${c.mid}"/><stop offset="1" stop-color="${c.lo}"/></radialGradient>
    <linearGradient id="${g}v" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#24323f"/><stop offset="1" stop-color="#0b1219"/></linearGradient>
    <radialGradient id="${g}e" cx="50%" cy="45%" r="60%"><stop offset="0" stop-color="#ffffff"/><stop offset=".35" stop-color="#9ff4ff"/><stop offset="1" stop-color="#19b8d8"/></radialGradient>
    <radialGradient id="${g}b" cx="50%" cy="40%" r="70%"><stop offset="0" stop-color="${c.bg}" stop-opacity=".9"/><stop offset="1" stop-color="#14251c"/></radialGradient>
  </defs>
  <rect width="100" height="100" fill="url(#${g}b)"/>
  <rect x="47" y="10" width="6" height="14" rx="3" fill="${c.lo}"/>
  <circle cx="50" cy="10" r="6.5" fill="url(#${g}h)" stroke="#2a1608" stroke-width="2"/>
  <rect x="9" y="42" width="12" height="22" rx="5" fill="${c.lo}" stroke="#2a1608" stroke-width="2.5"/>
  <rect x="79" y="42" width="12" height="22" rx="5" fill="${c.lo}" stroke="#2a1608" stroke-width="2.5"/>
  <rect x="17" y="22" width="66" height="60" rx="22" fill="url(#${g}h)" stroke="#2a1608" stroke-width="3"/>
  <path d="M27 30 Q 40 24 58 26" stroke="#fff" stroke-opacity=".7" stroke-width="4" fill="none" stroke-linecap="round"/>
  <rect x="25" y="38" width="50" height="28" rx="13" fill="url(#${g}v)" stroke="#2a1608" stroke-width="2.5"/>
  <circle cx="39" cy="51" r="6.5" fill="url(#${g}e)"/><circle cx="61" cy="51" r="6.5" fill="url(#${g}e)"/>
  <circle cx="37" cy="49" r="2" fill="#fff"/><circle cx="59" cy="49" r="2" fill="#fff"/>
  <path d="M40 73 h20" stroke="#2a1608" stroke-width="3" stroke-linecap="round"/>
  <path d="M44 73 v-3 M50 73 v-3 M56 73 v-3" stroke="#2a1608" stroke-width="2" stroke-linecap="round"/>
</svg>`;
}

export function avatarInner(id) {
  if (typeof id !== 'string') return null;
  const b = BOT_AVATARS.indexOf(id);
  if (b >= 0) return robot(b);
  if (AVATAR_IDS.includes(id)) return `<img class="avf" src="avatars/${id}.webp" alt="" draggable="false">`;
  if (/^g[1-5]$/.test(id)) return `<img class="avf" src="gifts/av${id.slice(1)}.webp" alt="" draggable="false">`;
  return null;
}

export const isPlayerAvatar = (id) => AVATAR_IDS.includes(id);

// Next free robot colour at a table.
export function nextBotAvatar(used = []) {
  return BOT_AVATARS.find((x) => !used.includes(x)) || BOT_AVATARS[0];
}

// Gift frames: a ring drawn around a player's picture.
export function frameHTML(fr) {
  return typeof fr === 'string' && /^f[1-5]$/.test(fr) ? `<img class="frame" src="gifts/frame${fr.slice(1)}.webp" alt="" draggable="false">` : '';
}
