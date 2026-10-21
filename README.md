# Hifz Tester

Browser app for Quran memorisation practice. Pick a range (surah/ayah to surah/ayah),
hear the first few words (or half) of a random ayah, work out which one it is, keep
reciting, and get a word-by-word diff of what you said vs. the actual text.

## Run
    python3 -m http.server 8000     # then open http://localhost:8000 in Chrome/Edge/Safari
(localhost counts as a secure origin, so the microphone works.)

## Test
    node tests/align.test.mjs

## Notes
- Text, word list and per-word audio timings: Quran.com API v4; audio files from Quran.com / Quranic Audio (internet needed).
- The prompt is cut at the real end time of the chosen word (falls back to an estimate for the few ayat whose timings are incomplete).
- Recognition runs in the browser with a Quran-tuned Whisper model (`eventhorizon0/tarteel-ai-onnx-whisper-base-ar-quran`, via transformers.js, WASM, q4). About 140 MB, downloaded once on first use and then cached. Transcription takes a few seconds per 10 s of recitation on CPU.
- The transcript box stays editable so a misheard word can be fixed before pressing Check.
- Checks words only, not tajweed.
