// Original card art (SVG), drawn in code. A banana character family:
// each card has its own banana with a prop that hints at its effect.

export const CARD_INFO = {
  n0: { label: 'ZERO', num: '0', tier: 'low' },
  n1: { label: 'ONE', num: '1', tier: 'low' },
  n2: { label: 'TWO', num: '2', tier: 'low' },
  n3: { label: 'THREE', num: '3', tier: 'low' },
  n4: { label: 'FOUR', num: '4', tier: 'low' },
  n5: { label: 'FIVE', num: '5', tier: 'mid', ar: 'اكشف كارت من كروتك للكل' },
  n6: { label: 'SIX', num: '6', tier: 'mid', ar: 'اكشف كارت من كروتك للكل' },
  n7: { label: 'SEVEN', num: '7', tier: 'mid', ar: 'بُص على كارت من كروتك' },
  n8: { label: 'EIGHT', num: '8', tier: 'mid', ar: 'بُص على كارت من كروتك' },
  n9: { label: 'NINE', num: '9', tier: 'mid', ar: 'بُص على كارت عند لاعب تاني' },
  n10: { label: 'TEN', num: '10', tier: 'mid', ar: 'بُص على كارت عند لاعب تاني' },
  n15: { label: 'FIFTEEN', num: '15', tier: 'high', ar: 'اكشف كل كروتك للكل' },
  n20: { label: 'TWENTY', num: '20', tier: 'high', ar: 'كروتك تتخلط' },
  n25: { label: 'SCARY', num: '25', tier: 'scary' },
  minus: { label: 'MINUS', num: '-1', tier: 'minus' },
  buzz: { label: 'BUZZ', num: '10', tier: 'cmd', color: '#1f1f1f', ar: 'لبّس لاعب آخر كارت على الأرض' },
  choose: { label: 'CHOOSE', num: '10', tier: 'cmd', color: '#e0233c', ar: 'اختار أمر من ٥' },
  clear: { label: 'CLEAR', num: '10', tier: 'cmd', color: '#1565c0', ar: 'ارمي كارت من كروتك' },
  copy: { label: 'COPY', num: '10', tier: 'cmd', color: '#9e9e9e', ar: 'كرّر آخر أمر اتنفذ' },
  curse: { label: 'CURSE', num: '10', tier: 'cmd', color: '#6b6b2a', ar: 'غيّر كارت عند أي لاعب' },
  extra: { label: 'EXTRA', num: '10', tier: 'cmd', color: '#8e1b2b', ar: 'اسحب كارتين والعب دورين' },
  freeze: { label: 'FREEZE', num: '10', tier: 'cmd', color: '#29a8e0', ar: 'جمّد خانة ٣ أدوار' },
  golden: { label: 'GOLDEN', num: '10', tier: 'cmd', color: '#c79a1b', ar: 'شوف كل كروتك' },
  guard: { label: 'GUARD', num: '10', tier: 'cmd', color: '#d81b60', ar: 'امنع أمر عليك — في أي وقت' },
  plus: { label: 'PLUS', num: '10', tier: 'cmd', color: '#223a63', ar: '+5 على خانة أي لاعب' },
  swap: { label: 'SWAP', num: '10', tier: 'cmd', color: '#127c7c', ar: 'بدّل كارت مع أي لاعب' },
  tornado: { label: 'TORNADO', num: '10', tier: 'cmd', color: '#5f6b78', ar: 'غيّر كل كروت لاعب' },
};

export const CMD_NAMES_AR = {
  buzz: 'Buzz', choose: 'Choose', clear: 'Clear', copy: 'Copy', curse: 'Curse', extra: 'Extra',
  freeze: 'Freeze', golden: 'Golden', guard: 'Guard', plus: 'Plus', swap: 'Swap', tornado: 'Tornado',
};

const TIER = {
  low: ['#1e88e5', '#0d47a1', '#ffffff'],
  mid: ['#16324f', '#0b1a2b', '#ffd54f'],
  high: ['#6a1b9a', '#38006b', '#ffd54f'],
  scary: ['#4a148c', '#1a0033', '#ff8a80'],
  minus: ['#fffdf5', '#ffe9a8', '#c79a1b'],
};

// One banana body; `mood` changes the face, `prop` adds an accessory.
function banana({ mood = 'happy', prop = '', tint = '#ffd84d' } = {}) {
  const face = {
    happy: '<path d="M44 66 q6 6 12 0" stroke="#4a3200" stroke-width="2.2" fill="none" stroke-linecap="round"/>',
    sly: '<path d="M44 67 q6 3 13 -2" stroke="#4a3200" stroke-width="2.2" fill="none" stroke-linecap="round"/>',
    shock: '<ellipse cx="50" cy="68" rx="3.2" ry="4" fill="#4a3200"/>',
    scary: '<path d="M42 66 l4 4 l4 -4 l4 4 l4 -4" stroke="#fff" stroke-width="2" fill="#4a3200" stroke-linejoin="round"/>',
    cool: '<path d="M45 67 h10" stroke="#4a3200" stroke-width="2.2" stroke-linecap="round"/>',
  }[mood];
  const eyes = mood === 'cool'
    ? '<rect x="38" y="52" width="26" height="7" rx="3" fill="#111"/>'
    : mood === 'scary'
      ? '<path d="M40 55 l7 3 M60 55 l-7 3" stroke="#4a3200" stroke-width="2.4" stroke-linecap="round"/><circle cx="44" cy="59" r="2" fill="#4a3200"/><circle cx="56" cy="59" r="2" fill="#4a3200"/>'
      : '<circle cx="44" cy="57" r="3.2" fill="#fff"/><circle cx="56" cy="57" r="3.2" fill="#fff"/><circle cx="44.6" cy="57.6" r="1.7" fill="#2b1b00"/><circle cx="56.6" cy="57.6" r="1.7" fill="#2b1b00"/>';
  return `
  <g>
    <path d="M30 98 C 24 72, 34 44, 58 32 C 62 30, 66 31, 66 35 C 52 46, 48 66, 56 92 C 58 100, 36 106, 30 98 Z" fill="${tint}" stroke="#8a6400" stroke-width="1.6"/>
    <path d="M58 32 C 61 26, 66 24, 70 26 L 68 33 C 66 34, 62 33, 60 34 Z" fill="#6d4c1d"/>
    <path d="M36 92 C 33 74, 40 52, 56 40" stroke="#fff3b0" stroke-width="3" fill="none" opacity=".7" stroke-linecap="round"/>
    ${eyes}${face}
    ${prop}
  </g>`;
}

const PROPS = {
  golden: '<path d="M40 40 l4 -9 l6 6 l6 -6 l4 9 z" fill="#ffca28" stroke="#8a6400" stroke-width="1.2"/>',
  guard: '<path d="M64 62 c0 -6 6 -8 12 -8 c6 0 12 2 12 8 c0 12 -8 18 -12 20 c-4 -2 -12 -8 -12 -20z" fill="#d81b60" stroke="#fff" stroke-width="2"/><path d="M76 58 v16 M70 66 h12" stroke="#fff" stroke-width="2"/>',
  freeze: '<rect x="26" y="40" width="48" height="62" rx="8" fill="#b3e5fc" opacity=".55" stroke="#e1f5fe" stroke-width="2"/><path d="M80 40 v14 M73 47 h14 M75 42 l10 10 M85 42 l-10 10" stroke="#e1f5fe" stroke-width="2"/>',
  tornado: '<path d="M64 40 h22 M66 48 h18 M69 56 h12 M72 64 h7 M74 72 h3" stroke="#cfd8dc" stroke-width="3" stroke-linecap="round"/>',
  plus: '<circle cx="78" cy="56" r="11" fill="#ffd54f"/><text x="78" y="61" font-size="13" font-weight="900" text-anchor="middle" fill="#223a63">+5</text>',
  swap: '<path d="M66 48 h18 l-5 -5 M84 62 h-18 l5 5" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  buzz: '<path d="M70 44 l8 6 l-6 3 l8 7" stroke="#ffeb3b" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  clear: '<path d="M66 48 q10 -6 20 2 M68 58 q8 -4 16 2 M70 68 q6 -3 12 1" stroke="#e3f2fd" stroke-width="2.5" fill="none" stroke-linecap="round"/>',
  copy: '<rect x="66" y="44" width="16" height="20" rx="3" fill="#fff" stroke="#616161" stroke-width="1.5"/><rect x="72" y="50" width="16" height="20" rx="3" fill="#fff" stroke="#616161" stroke-width="1.5"/>',
  curse: '<circle cx="78" cy="52" r="9" fill="#33331a"/><path d="M73 52 l10 0 M78 47 l0 10" stroke="#d4e157" stroke-width="2"/>',
  extra: '<rect x="66" y="42" width="14" height="20" rx="3" fill="#ffd84d" stroke="#fff" stroke-width="1.5" transform="rotate(-12 73 52)"/><rect x="74" y="46" width="14" height="20" rx="3" fill="#ffd84d" stroke="#fff" stroke-width="1.5" transform="rotate(10 81 56)"/>',
  choose: '<circle cx="78" cy="54" r="11" fill="#fff"/><text x="78" y="59" font-size="14" font-weight="900" text-anchor="middle" fill="#e0233c">?</text>',
};

const MOODS = {
  n0: 'happy', n1: 'happy', n2: 'sly', n3: 'happy', n4: 'happy', n5: 'shock', n6: 'sly', n7: 'happy', n8: 'cool',
  n9: 'sly', n10: 'cool', n15: 'shock', n20: 'scary', n25: 'scary', minus: 'happy',
  buzz: 'sly', choose: 'cool', clear: 'happy', copy: 'sly', curse: 'scary', extra: 'happy', freeze: 'shock',
  golden: 'cool', guard: 'cool', plus: 'sly', swap: 'sly', tornado: 'shock',
};

// Card faces Mohammed designed himself (clean versions, no outside characters).
export const IMAGE_CARDS = new Set(Object.keys(CARD_INFO));

export function cardSVG(name) {
  if (IMAGE_CARDS.has(name)) return `<img class="card-svg card-img" src="cards/${name}.webp" alt="" draggable="false">`;
  return drawnCard(name);
}

function drawnCard(name) {
  const info = CARD_INFO[name];
  const isCmd = info.tier === 'cmd';
  let bg1, bg2, ink;
  if (isCmd) { bg1 = '#ffe066'; bg2 = '#ffc93c'; ink = info.color; } else [bg1, bg2, ink] = TIER[info.tier];
  const tint = name === 'golden' ? '#ffd23f' : name === 'n25' || name === 'curse' ? '#c6b04a' : name === 'minus' ? '#ffe37a' : '#ffd84d';
  const band = isCmd ? info.color : ink;
  const id = 'g' + name;
  const num = info.num;
  const big = isCmd ? '' : `<text x="${num.length > 1 ? 79 : 82}" y="${info.ar ? 98 : 104}" font-size="${num.length > 1 ? 30 : 40}" font-weight="900" text-anchor="middle" fill="${ink}" opacity=".95" font-family="system-ui, sans-serif">${num}</text>`;
  return `<svg viewBox="0 0 100 140" xmlns="http://www.w3.org/2000/svg" class="card-svg" direction="ltr" aria-hidden="true">
  <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${bg1}"/><stop offset="1" stop-color="${bg2}"/></linearGradient></defs>
  <rect x="1" y="1" width="98" height="138" rx="9" fill="url(#${id})" stroke="rgba(0,0,0,.25)"/>
  <path d="M0 18 L100 0 L100 8 L0 26 Z" fill="${band}" opacity=".35"/>
  <text x="9" y="20" font-size="18" font-weight="900" fill="${isCmd ? info.color : ink}" font-family="system-ui, sans-serif">${num}</text>
  <g transform="translate(-6 4)">${banana({ mood: MOODS[name], prop: PROPS[name] || '', tint })}</g>
  ${big}
  ${info.ar ? `<rect x="6" y="104" width="88" height="14" rx="4" fill="rgba(0,0,0,.32)"/><text x="50" y="113.6" font-size="${info.ar.length > 26 ? 5.6 : 6.6}" text-anchor="middle" fill="#fff" font-family="system-ui, sans-serif" direction="rtl">${info.ar}</text>` : ''}
  <rect x="6" y="121" width="88" height="13" rx="4" fill="${isCmd ? info.color : 'rgba(255,255,255,.92)'}"/>
  <text x="50" y="131" font-size="9.5" font-weight="900" text-anchor="middle" letter-spacing=".5" fill="${isCmd ? '#fff' : ink === '#ffffff' ? '#0d47a1' : '#16324f'}" font-family="system-ui, sans-serif">${info.label}</text>
</svg>`;
}

export function backSVG() {
  return `<img class="card-svg card-img card-back" src="cards/back.webp" alt="" draggable="false">`;
}

export function drawnBack() {
  return `<svg viewBox="0 0 100 140" xmlns="http://www.w3.org/2000/svg" class="card-svg" direction="ltr" aria-hidden="true">
  <rect x="1" y="1" width="98" height="138" rx="9" fill="#ffd84d" stroke="rgba(0,0,0,.25)"/>
  <rect x="7" y="7" width="86" height="126" rx="6" fill="none" stroke="#f2b705" stroke-width="2" stroke-dasharray="4 3"/>
  <g transform="translate(-2 -6) scale(1.02)">${banana({ mood: 'happy' })}</g>
  <text x="50" y="122" font-size="15" font-weight="900" text-anchor="middle" fill="#5d3f00" font-family="system-ui, sans-serif" letter-spacing="1">BANANA</text>
</svg>`;
}
