import { loadChapters, loadVerses, audioUrl, RECITERS } from './api.js';
import { tokenize, normalize, align, summarize, stripPrompt } from './arabic.js';

const $ = (id) => document.getElementById(id);
const state = {
  chapters: [], pool: [], queue: [], q: null, asked: 0, correctGuesses: 0, guessed: 0,
  recognizer: null, recorder: null, chunks: [], listening: false, finalText: '',
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
    for (let s = fs; s <= ts; s++) all.push(...await loadVerses(s));
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
  stopRecording();
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
  state.finalText = '';
  $('guessSurah').value = ''; $('guessAyah').value = '';
  $('result').hidden = true;
  $('playback').hidden = true;
  $('recState').textContent = '';
  playPrompt();
}

function buildQuestion(verse) {
  const words = tokenize(verse.text);
  if (!words.length) return null;
  const mode = $('promptLen').value;
  let n = mode === 'half' ? Math.ceil(words.length / 2) : +mode;
  if (n >= words.length) n = Math.max(1, Math.floor(words.length / 2));
  const extra = +$('moreAyat').value;

  const expected = words.slice(n).map((w) => ({ ...w, ref: `${verse.chapter}:${verse.ayah}` }));
  // Continue into following ayat (across surah boundaries) if requested,
  // but never past the end of the chosen range.
  let idx = state.all.indexOf(verse);
  const poolEnd = state.pool[state.pool.length - 1];
  let remaining = extra || (expected.length ? 0 : 1);
  while (remaining > 0) {
    const cur = state.all[idx];
    if (cur === poolEnd) break;
    idx++;
    const nv = state.all[idx];
    if (!nv) break;
    expected.push(...tokenize(nv.text).map((w) => ({ ...w, ref: `${nv.chapter}:${nv.ayah}` })));
    remaining--;
  }
  if (!expected.length) return null;
  return {
    verse, prompt: words.slice(0, n), expected, fraction: promptFraction(words, n),
    url: audioUrl($('reciter').value, verse.chapter, verse.ayah),
  };
}

function promptFraction(words, n) {
  const len = (arr) => arr.reduce((s, w) => s + w.norm.length, 0);
  return len(words.slice(0, n)) / len(words);
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
  audio = new Audio(q.url);
  const a = audio;
  a.addEventListener('error', () => { $('recState').textContent = 'Could not load the audio for this ayah.'; });
  a.addEventListener('loadedmetadata', () => {
    // Estimate where the prompt ends from the share of letters it covers.
    const end = Math.min(a.duration, a.duration * q.fraction + 0.25);
    a.play().catch(() => { $('recState').textContent = 'Tap "Play prompt" to start audio.'; });
    stopTimer = setInterval(() => {
      if (a.currentTime >= end) { a.pause(); clearInterval(stopTimer); }
    }, 30);
  });
}

$('play').addEventListener('click', playPrompt);
$('replay').addEventListener('click', playPrompt);

// ---------- recording + recognition ----------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

$('rec').addEventListener('click', () => (state.listening ? stopRecording() : startRecording()));

async function startRecording() {
  stopAudio();
  state.finalText = '';
  $('transcript').value = '';
  $('playback').hidden = true;
  state.listening = true;
  $('rec').classList.add('live');
  $('rec').textContent = '■ Stop';

  try { // optional: keep the audio so the user can listen back
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    state.stream = stream;
    state.chunks = [];
    state.recorder = new MediaRecorder(stream);
    state.recorder.ondataavailable = (e) => state.chunks.push(e.data);
    state.recorder.onstop = () => {
      const blob = new Blob(state.chunks, { type: state.recorder.mimeType });
      const el = $('playback');
      el.src = URL.createObjectURL(blob);
      el.hidden = false;
      state.stream.getTracks().forEach((t) => t.stop());
    };
    state.recorder.start();
  } catch {
    $('recState').textContent = 'Microphone unavailable — allow mic access, or type what you recited below.';
    state.listening = false;
    $('rec').classList.remove('live'); $('rec').textContent = '● Record my recitation';
    return;
  }

  if (!SR) {
    $('recState').textContent = 'Recording… (this browser has no speech recognition — type your recitation below after listening back)';
    return;
  }
  const r = new SR();
  r.lang = 'ar-SA'; r.continuous = true; r.interimResults = true;
  r.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) state.finalText += ' ' + t; else interim += ' ' + t;
    }
    $('transcript').value = (state.finalText + interim).trim();
  };
  r.onerror = (e) => { $('recState').textContent = 'Recognition error: ' + e.error; };
  r.onend = () => { if (state.listening) { try { r.start(); } catch { /* already running */ } } };
  state.recognizer = r;
  $('recState').textContent = 'Listening… recite from where the prompt stopped.';
  r.start();
}

function stopRecording() {
  state.listening = false;
  if (state.recognizer) { state.recognizer.onend = null; try { state.recognizer.stop(); } catch { /* noop */ } state.recognizer = null; }
  if (state.recorder && state.recorder.state !== 'inactive') state.recorder.stop();
  $('rec').classList.remove('live');
  $('rec').textContent = '● Record my recitation';
  if ($('recState').textContent.startsWith('Listening')) $('recState').textContent = 'Stopped. Edit the text if needed, then press Check.';
}

// ---------- checking ----------
$('check').addEventListener('click', () => { stopRecording(); check(); });
$('reveal').addEventListener('click', () => { stopRecording(); reveal(); });
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
  const html = [];
  let lastRef = null;
  for (const r of result) {
    const ref = r.expected && r.expected.ref;
    if (ref && lastRef && ref !== lastRef) html.push(`<span class="ayah-end">﴿${lastRef.split(':')[1]}﴾</span>`);
    if (ref) lastRef = ref;
    const word = r.expected ? r.expected.raw : r.said;
    const note = r.status === 'wrong' || r.status === 'close' ? `<small>${r.said}</small>` : '';
    html.push(`<span class="w ${r.status}">${word}${note}</span>`);
  }
  if (lastRef) html.push(`<span class="ayah-end">﴿${lastRef.split(':')[1]}﴾</span>`);
  $('diff').innerHTML = html.join(' ');
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
