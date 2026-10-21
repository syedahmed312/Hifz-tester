// Arabic normalisation and word-level alignment. Pure functions, no DOM,
// so they can be unit-tested under Node.

const MARKS = /[ؐ-ًؚ-ٰٟۖ-ۭ࣓-ࣿ]/g;

export function normalize(word) {
  return word
    .replace(/ـ/g, '')            // tatweel
    .replace(MARKS, '')                // harakat, quranic annotation marks
    .replace(/[ٱآأإ]/g, 'ا') // alef variants -> ا
    .replace(/ى/g, 'ي')      // alef maqsura -> ya
    .replace(/ة/g, 'ه')      // ta marbuta -> ha
    .replace(/ؤ/g, 'و')      // hamza on waw -> waw
    .replace(/ئ/g, 'ي')      // hamza on ya -> ya
    .replace(/ء/g, '')            // bare hamza
    .replace(/[^ء-ي]/g, '')  // anything else (punctuation, latin)
    .replace(/(.)\1+/g, '$1');         // collapse doubled letters (shadda-ish noise)
}

// Split text into words, dropping standalone waqf/pause signs.
export function tokenize(text) {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((raw) => ({ raw, norm: normalize(raw) }))
    .filter((w) => w.norm.length > 0);
}

export function editDistance(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = cur;
  }
  return prev[n];
}

export function wordDistance(a, b) {
  if (a === b) return 0;
  return editDistance(a, b) / Math.max(a.length, b.length);
}

export const CLOSE_THRESHOLD = 0.34;

/**
 * Align expected words against recited words.
 * Returns one entry per expected word, in order, plus extras:
 *   { status: 'correct' | 'close' | 'wrong' | 'missed' | 'notreached' | 'extra',
 *     expected?: token, said?: string, ayah?: any }
 * 'close' means a near-match (likely a mispronunciation or a recogniser slip).
 * 'notreached' marks the expected tail after the last thing the user said.
 */
export function align(expected, saidWords) {
  const m = expected.length, n = saidWords.length;
  const INDEL = 1, SUB = 1.2;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  const back = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(''));
  for (let i = 1; i <= m; i++) { dp[i][0] = i * INDEL; back[i][0] = 'D'; }
  for (let j = 1; j <= n; j++) { dp[0][j] = j * INDEL; back[0][j] = 'I'; }
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const d = wordDistance(expected[i - 1].norm, saidWords[j - 1]);
      const pair = d <= CLOSE_THRESHOLD ? d : SUB;
      const cands = [
        [dp[i - 1][j - 1] + pair, 'M'],
        [dp[i - 1][j] + INDEL, 'D'],
        [dp[i][j - 1] + INDEL, 'I'],
      ];
      cands.sort((x, y) => x[0] - y[0]);
      dp[i][j] = cands[0][0];
      back[i][j] = cands[0][1];
    }
  }
  const out = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    const op = back[i][j];
    if (op === 'M') {
      const d = wordDistance(expected[i - 1].norm, saidWords[j - 1]);
      const status = d === 0 ? 'correct' : d <= CLOSE_THRESHOLD ? 'close' : 'wrong';
      out.push({ status, expected: expected[i - 1], said: saidWords[j - 1] });
      i--; j--;
    } else if (op === 'D') {
      out.push({ status: 'missed', expected: expected[i - 1] });
      i--;
    } else {
      out.push({ status: 'extra', said: saidWords[j - 1] });
      j--;
    }
  }
  out.reverse();
  // Trailing "missed" words after the last thing said were simply never recited.
  let k = out.length - 1;
  while (k >= 0 && out[k].status === 'missed') { out[k].status = 'notreached'; k--; }
  return out;
}

export function summarize(result) {
  const c = { correct: 0, close: 0, wrong: 0, missed: 0, notreached: 0, extra: 0 };
  for (const r of result) c[r.status]++;
  const total = c.correct + c.close + c.wrong + c.missed + c.notreached;
  return { ...c, total, accuracy: total ? (c.correct + c.close) / total : 0 };
}

// If the user repeated the prompt words first, drop them from the transcript.
export function stripPrompt(saidWords, promptTokens) {
  if (!promptTokens.length || saidWords.length < promptTokens.length) return saidWords;
  for (let k = 0; k < promptTokens.length; k++) {
    if (wordDistance(promptTokens[k].norm, saidWords[k]) > CLOSE_THRESHOLD) return saidWords;
  }
  return saidWords.slice(promptTokens.length);
}
