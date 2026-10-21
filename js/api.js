// Data + audio sources. Text/metadata: Quran.com API v4. Audio: EveryAyah.
const API = 'https://api.quran.com/api/v4';

export const RECITERS = [
  { id: 'Alafasy_128kbps', name: 'Mishary Alafasy' },
  { id: 'Husary_128kbps', name: 'Mahmoud Khalil Al-Husary' },
  { id: 'Abdul_Basit_Murattal_192kbps', name: 'Abdul Basit (Murattal)' },
  { id: 'Minshawy_Murattal_128kbps', name: 'Al-Minshawi (Murattal)' },
  { id: 'Abdurrahmaan_As-Sudais_192kbps', name: 'Abdur-Rahman As-Sudais' },
  { id: 'MaherAlMuaiqly128kbps', name: 'Maher Al-Muaiqly' },
  { id: 'Ghamadi_40kbps', name: 'Saad Al-Ghamdi' },
  { id: 'Hudhaify_128kbps', name: 'Ali Al-Hudhaify' },
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

export async function loadVerses(chapter) {
  const key = `qt:verses:v1:${chapter}`;
  const hit = cache(key);
  if (hit) return hit;
  const data = await getJSON(`${API}/verses/by_chapter/${chapter}?fields=text_imlaei&per_page=300`);
  const verses = data.verses.map((v) => ({
    chapter, ayah: v.verse_number, text: v.text_imlaei,
  }));
  store(key, verses);
  return verses;
}

const pad3 = (n) => String(n).padStart(3, '0');
export const audioUrl = (reciter, chapter, ayah) =>
  `https://everyayah.com/data/${reciter}/${pad3(chapter)}${pad3(ayah)}.mp3`;
