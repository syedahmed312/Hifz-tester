import assert from 'node:assert/strict';
import { tokenize, normalize, align, summarize, stripPrompt } from '../js/arabic.js';

const fatiha2 = 'الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ';
const E = tokenize(fatiha2);
const words = (s) => s.split(' ').map(normalize);

assert.equal(normalize('ٱللَّهِ'), normalize('الله'));
assert.equal(tokenize('لَا ۚ تَأْخُذُهُ').length, 2, 'pause sign dropped');

let r = align(E, words('الحمد لله رب العالمين'));
assert.deepEqual(r.map((x) => x.status), ['correct', 'correct', 'correct', 'correct']);

r = align(E, words('الحمد رب العالمين'));
assert.deepEqual(r.map((x) => x.status), ['correct', 'missed', 'correct', 'correct']);

r = align(E, words('الحمد لله رب'));
assert.deepEqual(r.map((x) => x.status), ['correct', 'correct', 'correct', 'notreached']);

r = align(E, words('الحمد لله سبحان العالمين'));
assert.equal(r[2].status, 'wrong');

r = align(E, words('الحمد لله ثم رب العالمين'));
assert.deepEqual(r.map((x) => x.status), ['correct', 'correct', 'extra', 'correct', 'correct']);

r = align(E, []);
assert.ok(r.every((x) => x.status === 'notreached'));

assert.deepEqual(stripPrompt(words('الحمد لله رب العالمين'), E.slice(0, 2)), words('رب العالمين'));
assert.deepEqual(stripPrompt(words('رب العالمين'), E.slice(0, 2)), words('رب العالمين'));
assert.equal(summarize(align(E, words('الحمد لله رب'))).accuracy, 0.75);
console.log('ok');
