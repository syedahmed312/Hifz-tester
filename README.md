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
- Text/metadata: Quran.com API; audio: EveryAyah (internet needed).
- Speech recognition uses the browser's Web Speech API (`ar-SA`). Chrome/Edge/Safari only;
  accuracy on Quranic recitation is limited, so the transcript box is editable.
- Prompt length is estimated from letter share of the ayah audio, so it can be off by a syllable.
- Checks words only, not tajweed. Planned upgrade: a Quran-tuned Whisper model for recognition.
