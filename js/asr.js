// Main-thread client for the Whisper worker, plus 16 kHz microphone capture.
let worker = null;
let nextId = 1;
const pending = new Map();
let statusCb = () => {};

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./asr.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'status') { statusCb(m.text); return; }
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      if (m.type === 'error') p.reject(new Error(m.message)); else p.resolve(m.text);
    };
  }
  return worker;
}

function call(msg, transfer = []) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ ...msg, id }, transfer);
  });
}

export function loadModel(onStatus = () => {}) {
  statusCb = onStatus;
  return call({ type: 'load' });
}

export function transcribe(samples) {
  const copy = new Float32Array(samples); // worker takes ownership of the copy
  return call({ type: 'transcribe', samples: copy }, [copy.buffer]);
}

function resample(input, from, to) {
  if (from === to) return input;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const pos = i * ratio, i0 = Math.floor(pos), i1 = Math.min(i0 + 1, input.length - 1);
    out[i] = input[i0] + (input[i1] - input[i0]) * (pos - i0);
  }
  return out;
}

/** Capture mono PCM from a MediaStream at 16 kHz. */
export function startCapture(stream) {
  let ctx;
  try { ctx = new AudioContext({ sampleRate: 16000 }); } catch { ctx = new AudioContext(); }
  const source = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  const chunks = [];
  let length = 0, level = 0;
  proc.onaudioprocess = (e) => {
    const d = new Float32Array(e.inputBuffer.getChannelData(0));
    chunks.push(d); length += d.length;
    let peak = 0;
    for (let i = 0; i < d.length; i += 16) peak = Math.max(peak, Math.abs(d[i]));
    level = peak;
  };
  source.connect(proc);
  proc.connect(ctx.destination); // required for onaudioprocess to fire; output is silent
  const rate = ctx.sampleRate;
  const samples = () => {
    const all = new Float32Array(length);
    let o = 0;
    for (const c of chunks) { all.set(c, o); o += c.length; }
    return resample(all, rate, 16000);
  };
  return {
    samples,
    level: () => level,
    seconds: () => length / rate,
    stop() {
      proc.disconnect(); source.disconnect();
      const s = samples();
      ctx.close();
      return s;
    },
  };
}
