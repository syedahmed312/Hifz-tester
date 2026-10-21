import { loadChapters, loadVerses, RECITERS } from './api.js';
import { normalize, align, summarize, stripPrompt } from './arabic.js';
import { transcribe, loadModel } from './asr.js';

const $ = (id) => document.getElementById(id);
const state = {
  chapters: [], pool: [], queue: [], q: null, asked: 0, correctGuesses: 0, guessed: 0,
  recorder: null, chunks: [], listening: false, busy: false,
};

// ---------- setup ----------
async function init() {
  $('reciter').innerHTML = RECITERS.map((r) => `<option value="${r.id}">${r.name}</option>`).join('');
  try {
    state.chapters = await loadChapters();
  } catch (e) {
    $('setupMsg').textContent = 'Could not load the surah list. Check your connection and reload.';
    return;
  }
  const opts = state.chapters.map((c) => `<option value="${c.id}">${c.id}. ${c.name} (${c.arabic})</option>`).join('');
  $('fromSurah').innerHTML = opts;
  $('toSurah').innerHTML = opts;
  $('fromSurah').addEventListener('change', syncLimits);
  $('toSurah').addEventListener('change', syncLimits);
  $('toSurah').value = '1';
  syncLimits();
  $('toAyah').value = state.chapters[0].verses;
  $('start').addEventListener('click', start);
}

function syncLimits() {
  const f = state.chapters[$('fromSurah').value - 1], t = state.chapters[$('toSurah').value - 1];
  $('fromAyah').max = f.verses; $('toAyah').max = t.verses;
  if (+$('fromAyah').value > f.verses) $('fromAyah').value = f.verses;
  if (+$('toAyah').value > t.verses) $('toAyah').value = t.verses;
}

async function start() {
  const fs = +$('fromSurah').value, fa = +$('fromAyah').value;
  const ts = +$('toSurah').value, ta = +$('toAyah').value;
  if (fs > ts || (fs === ts && fa > ta)) {
    $('setupMsg').textContent = 'The "from" point must come before the "to" point.';
    return;
  }
  $('start').disabled = true;
  $('setupMsg').textContent = 'Loading text…';
  try {
    const all = [];
    for (let s = fs; s <= ts; s++) all.push(...await loadVerses(s, +$('reciter').value));
    state.all = all;
    state.pool = all.filter((v) => !(v.chapter === fs && v.ayah < fa) && !(v.chapter === ts && v.ayah > ta));
  } catch (e) {
    $('setupMsg').textContent = 'Could not load the Quran text: ' + e.message;
    $('start').disabled = false;
    return;
  }
  $('start').disabled = false;
  $('setupMsg').textContent = '';
  state.asked = 0; state.guessed = 0; state.correctGuesses = 0; state.queue = [];
  $('quiz').hidden = false;
  warmUpModel();
  nextQuestion();
  $('quiz').scrollIntoView({ behavior: 'smooth' });
}

// ---------- questions ----------
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function nextQuestion() {
  stopAudio();
  discardRecording();
  for (let tries = 0; tries < 20; tries++) {
    if (!state.queue.length) state.queue = shuffle(state.pool.map((_, i) => i));
    const verse = state.pool[state.queue.pop()];
    const q = buildQuestion(verse);
    if (q) { state.q = q; break; }
  }
  state.asked++;
  $('qTitle').textContent = `Question ${state.asked}`;
  updateScore();
  $('transcript').value = '';
  $('guessSurah').value = ''; $('guessAyah').value = '';
  $('result').hidden = true;
  $('playback').hidden = true;
  $('recState').textContent = '';
  playPrompt();
}

const toTokens = (verse) =>
  verse.words
    .map((raw) => ({ raw, norm: normalize(raw), ref: `${verse.chapter}:${verse.ayah}` }))
    .filter((w) => w.norm.length);

function buildQuestion(verse) {
  if (!verse.url) return null;
  // Keep Quran.com word positions so the audio timings line up with each word.
  const units = verse.words.map((raw, i) => ({ raw, norm: normalize(raw), pos: verse.pos[i] }))
    .filter((w) => w.norm.length);
  if (!units.length) return null;
  const mode = $('promptLen').value;
  let n = mode === 'half' ? Math.ceil(units.length / 2) : +mode;
  if (n >= units.length) n = Math.max(1, Math.floor(units.length / 2));
  const extra = +$('moreAyat').value;
  const ref = `${verse.chapter}:${verse.ayah}`;

  const expected = units.slice(n).map((w) => ({ ...w, ref }));
  // Continue into following ayat (across surah boundaries) if requested,
  // but never past the end of the chosen range.
  let idx = state.all.indexOf(verse);
  const poolEnd = state.pool[state.pool.length - 1];
  let remaining = extra || (expected.length ? 0 : 1);
  while (remaining > 0) {
    if (state.all[idx] === poolEnd) break;
    idx++;
    const nv = state.all[idx];
    if (!nv) break;
    expected.push(...toTokens(nv));
    remaining--;
  }
  if (!expected.length) return null;
  return { verse, prompt: units.slice(0, n), expected, promptWords: n, totalWords: units.length, url: verse.url };
}

function updateScore() {
  $('score').textContent = state.guessed ? `Ayah guesses: ${state.correctGuesses}/${state.guessed}` : '';
}

// ---------- audio ----------
let audio = null, stopTimer = null;
function stopAudio() {
  clearInterval(stopTimer);
  if (audio) { audio.pause(); audio = null; }
}

function playPrompt() {
  stopAudio();
  const q = state.q;
  const seg = q.verse.seg;
  const first = q.prompt[0], last = q.prompt[q.prompt.length - 1];
  const a = (audio = new Audio(q.url));
  a.addEventListener('error', () => { $('recState').textContent = 'Could not load the audio for this ayah.'; });
  a.addEventListener('loadedmetadata', () => {
    // Real word timings from Quran.com; fall back to a letter-share estimate if a word has none.
    let start = 0, end;
    if (seg[first.pos]) start = Math.max(0, seg[first.pos][0] / 1000 - 0.1);
    if (seg[last.pos]) end = seg[last.pos][1] / 1000 + 0.1;
    else end = a.duration * (q.promptWords / q.totalWords) + 0.25;
    end = Math.min(a.duration, end);
    a.currentTime = start;
    a.play().catch(() => { $('recState').textContent = 'Tap "Play prompt" to start audio.'; });
    stopTimer = setInterval(() => {
      if (a.currentTime >= end) { a.pause(); clearInterval(stopTimer); }
    }, 20);
  });
}

$('play').addEventListener('click', playPrompt);
$('replay').addEventListener('click', playPrompt);

// ---------- recording + recognition (Quran-tuned Whisper, in the browser) ----------
function setModelStatus(text) { $('modelState').textContent = text; }
function warmUpModel() {
  loadModel((p) => setModelStatus(p)).catch(() => setModelStatus('Speech model failed to load — you can still type your recitation below.'));
}

$('rec').addEventListener('click', () => (state.listening ? stopRecording() : startRecording()));

async function startRecording() {
  if (state.busy) return;
  stopAudio();
  $('transcript').value = '';
  $('playback').hidden = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false } });
    state.stream = stream;
    const chunks = [];
    const token = state.token = (state.token || 0) + 1;
    const rec = new MediaRecorder(stream);
    rec.ondataavailable = (e) => chunks.push(e.data);
    rec.onstop = () => { if (token === state.token) onRecorded(new Blob(chunks, { type: rec.mimeType })); };
    state.recorder = rec;
    rec.start();
  } catch {
    releaseMic();
    $('recState').textContent = 'Microphone unavailable — allow mic access, or type what you recited below.';
    return;
  }
  state.listening = true;
  $('rec').classList.add('live');
  $('rec').textContent = '■ Stop';
  $('recState').textContent = 'Recording… recite from where the prompt stopped, then press Stop.';
}

function releaseMic() {
  if (state.stream) state.stream.getTracks().forEach((t) => t.stop());
  state.stream = null;
}

// Stop recording and ignore whatever it captured (used when skipping to the next question).
function discardRecording() {
  state.token = (state.token || 0) + 1;
  state.listening = false;
  $('rec').classList.remove('live');
  $('rec').textContent = '● Record my recitation';
  if (state.recorder && state.recorder.state !== 'inactive') { state.recorder.onstop = null; state.recorder.stop(); }
  state.recorder = null;
  releaseMic();
}

function stopRecording() {
  if (!state.listening) return;
  state.listening = false;
  $('rec').classList.remove('live');
  $('rec').textContent = '● Record my recitation';
  if (state.recorder && state.recorder.state !== 'inactive') state.recorder.stop();
}

async function onRecorded(blob) {
  releaseMic();
  const el = $('playback');
  el.src = URL.createObjectURL(blob);
  el.hidden = false;
  state.busy = true;
  $('check').disabled = true;
  $('recState').textContent = 'Transcribing… (the first time this downloads the speech model)';
  const token = state.token;
  try {
    const text = await transcribe(blob, (p) => { if (token === state.token) $('recState').textContent = p; });
    if (token !== state.token) { state.busy = false; $('check').disabled = false; return; }
    $('transcript').value = text;
    $('recState').textContent = 'Done. Fix any word the recogniser got wrong, then press Check.';
    $('check').disabled = false;
    state.busy = false;
    check();
  } catch (e) {
    $('recState').textContent = 'Could not transcribe: ' + e.message + '. You can type your recitation below.';
    $('check').disabled = false;
    state.busy = false;
  }
}

// ---------- checking ----------
$('check').addEventListener('click', () => { if (!state.busy) check(); });
$('reveal').addEventListener('click', () => { if (!state.listening) reveal(); });
$('next').addEventListener('click', nextQuestion);

function showAnswer() {
  const q = state.q;
  const ch = state.chapters[q.verse.chapter - 1];
  $('answerRef').textContent = `Answer: Surah ${ch.name} (${q.verse.chapter}), ayah ${q.verse.ayah}`;
  const gs = $('guessSurah').value, ga = $('guessAyah').value;
  const g = $('guessResult');
  if (gs || ga) {
    const ok = +gs === q.verse.chapter && +ga === q.verse.ayah;
    state.guessed++; if (ok) state.correctGuesses++;
    g.textContent = ok ? '✓ You identified the ayah correctly.' : `✗ You guessed ${gs || '?'}:${ga || '?'}.`;
    updateScore();
  } else g.textContent = '';
  $('result').hidden = false;
}

function renderDiff(result) {
  const blocks = [];
  let cur = null;
  for (const r of result) {
    const ref = r.expected && r.expected.ref;
    if (ref && (!cur || cur.ref !== ref)) { cur = { ref, html: [] }; blocks.push(cur); }
    if (!cur) { cur = { ref: null, html: [] }; blocks.push(cur); }
    const word = r.expected ? r.expected.raw : r.said;
    const note = r.status === 'wrong' || r.status === 'close' ? `<small>${r.said}</small>` : '';
    cur.html.push(`<span class="w ${r.status}">${word}${note}</span>`);
  }
  $('diff').innerHTML = blocks
    .map((b) => `<div class="ayahrow"><span class="ref">${b.ref || ''}</span>${b.html.join(' ')}</div>`)
    .join('');
}

function check() {
  showAnswer();
  const q = state.q;
  let said = $('transcript').value.split(/\s+/).map(normalize).filter(Boolean);
  said = stripPrompt(said, q.prompt);
  const result = align(q.expected, said);
  const s = summarize(result);
  $('summary').textContent = said.length
    ? `${s.correct} correct, ${s.close} close, ${s.wrong} wrong, ${s.missed} missed, ${s.extra} extra` +
      (s.notreached ? `, ${s.notreached} not reached` : '') + ` — ${Math.round(s.accuracy * 100)}%`
    : 'Nothing was recorded — showing the expected text.';
  renderDiff(result);
}

function reveal() {
  showAnswer();
  $('summary').textContent = '';
  renderDiff(align(state.q.expected, []));
}

init();
