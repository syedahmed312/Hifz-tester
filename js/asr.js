// In-browser speech recognition with a Quran-tuned Whisper model (transformers.js).
// The model (~140 MB) is downloaded once and cached by the browser.
const TRANSFORMERS = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.0/dist/transformers.min.js';
const MODEL = 'eventhorizon0/tarteel-ai-onnx-whisper-base-ar-quran';

let pipePromise = null;

export function loadModel(onStatus = () => {}) {
  if (!pipePromise) {
    pipePromise = (async () => {
      onStatus('Loading speech model…');
      const { pipeline } = await import(TRANSFORMERS);
      const files = {};
      const pipe = await pipeline('automatic-speech-recognition', MODEL, {
        device: 'wasm',
        dtype: { encoder_model: 'q4', decoder_model_merged: 'q4' },
        progress_callback: (p) => {
          if (p.status === 'progress' && p.total) {
            files[p.file] = [p.loaded, p.total];
            const [l, t] = Object.values(files).reduce((a, b) => [a[0] + b[0], a[1] + b[1]], [0, 0]);
            onStatus(`Downloading speech model… ${Math.round((l / t) * 100)}%`);
          }
        },
      });
      onStatus('Speech model ready.');
      return pipe;
    })();
    pipePromise.catch(() => { pipePromise = null; });
  }
  return pipePromise;
}

async function decode(blob) {
  const ctx = new AudioContext({ sampleRate: 16000 });
  try {
    const audio = await ctx.decodeAudioData(await blob.arrayBuffer());
    return audio.getChannelData(0);
  } finally {
    ctx.close();
  }
}

export async function transcribe(blob, onStatus = () => {}) {
  const pipe = await loadModel(onStatus);
  onStatus('Transcribing…');
  const samples = await decode(blob);
  if (samples.length < 16000 * 0.5) throw new Error('recording was too short');
  const out = await pipe(samples, { chunk_length_s: 30 });
  return out.text.trim();
}
