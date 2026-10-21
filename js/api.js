// Data + audio sources. Text, word list and per-word audio timings: Quran.com API v4.
// Audio files: verses.quran.com / quranicaudio mirrors (as returned by the API).
const API = 'https://api.quran.com/api/v4';

// ids are Quran.com recitation ids
export const RECITERS = [
  { id: 7, name: 'Mishary Alafasy' },
  { id: 2, name: 'Abdul Basit (Murattal)' },
  { id: 3, name: 'Abdur-Rahman As-Sudais' },
  { id: 5, name: 'Hani Ar-Rifai' },
  { id: 9, name: 'Al-Minshawi (Murattal)' },
  { id: 10, name: "Sa'ud Ash-Shuraym" },
  { id: 4, name: 'Abu Bakr Al-Shatri' },
];

const cache = (key) => {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
};
const store = (key, val) => {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* quota/private mode */ }
};

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed (${res.status}): ${url}`);
  return res.json();
}

export async function loadChapters() {
  const hit = cache('qt:chapters:v1');
  if (hit) return hit;
  const data = await getJSON(`${API}/chapters?language=en`);
  const chapters = data.chapters.map((c) => ({
    id: c.id, name: c.name_simple, arabic: c.name_arabic, verses: c.verses_count,
  }));
  store('qt:chapters:v1', chapters);
  return chapters;
}

const absolute = (u) => (u.startsWith('//') ? `https:${u}` : u.startsWith('http') ? u : `https://verses.quran.com/${u}`);

/**
 * Verses of one surah for one reciter:
 *   { chapter, ayah, words: [raw...], seg: { [wordPosition]: [startMs, endMs] }, url }
 * `words` are Quran.com's own word units, so word positions line up with `seg`.
 */
export async function loadVerses(chapter, reciter) {
  const key = `qt:verses:v3:${reciter}:${chapter}`;
  const hit = cache(key);
  if (hit) return hit;
  const data = await getJSON(
    `${API}/verses/by_chapter/${chapter}?audio=${reciter}&words=true&word_fields=text_imlaei&per_page=300`
  );
  const verses = data.verses.map((v) => {
    const words = [];
    const pos = [];
    for (const w of v.words) {
      if (w.char_type_name !== 'word') continue;
      words.push(w.text_imlaei || w.text);
      pos.push(w.position);
    }
    const seg = {};
    for (const s of (v.audio && v.audio.segments) || []) {
      if (s.length === 4) seg[s[1]] = [s[2], s[3]];
    }
    return {
      chapter, ayah: v.verse_number, words, pos, seg,
      url: v.audio ? absolute(v.audio.url) : null,
    };
  });
  store(key, verses);
  return verses;
}
