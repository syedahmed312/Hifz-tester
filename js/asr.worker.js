// Runs the Whisper model off the main thread so the page stays responsive while it works.
const TRANSFORMERS = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.0/dist/transformers.min.js';
const MODEL = 'eventhorizon0/tarteel-ai-onnx-whisper-base-ar-quran';

let pipePromise = null;
function load() {
  if (!pipePromise) {
    pipePromise = (async () => {
      postMessage({ type: 'status', text: 'Loading speech model…' });
      const { pipeline } = await import(TRANSFORMERS);
      const files = {};
      const pipe = await pipeline('automatic-speech-recognition', MODEL, {
        device: 'wasm',
        dtype: { encoder_model: 'q4', decoder_model_merged: 'q4' },
        progress_callback: (p) => {
          if (p.status === 'progress' && p.total) {
            files[p.file] = [p.loaded, p.total];
            const [l, t] = Object.values(files).reduce((a, b) => [a[0] + b[0], a[1] + b[1]], [0, 0]);
            postMessage({ type: 'status', text: `Downloading speech model… ${Math.round((l / t) * 100)}%` });
          }
        },
      });
      postMessage({ type: 'status', text: 'Speech model ready.' });
      return pipe;
    })();
    pipePromise.catch(() => { pipePromise = null; });
  }
  return pipePromise;
}

let queue = Promise.resolve(); // one job at a time
self.onmessage = (e) => {
  const m = e.data;
  queue = queue.then(async () => {
    try {
      const pipe = await load();
      if (m.type === 'load') { postMessage({ type: 'loaded', id: m.id }); return; }
      const out = await pipe(m.samples, { chunk_length_s: 30 });
      postMessage({ type: 'result', id: m.id, text: out.text.trim() });
    } catch (err) {
      postMessage({ type: 'error', id: m.id, message: String(err && err.message || err) });
    }
  });
};
