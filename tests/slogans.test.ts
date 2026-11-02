import assert from 'node:assert/strict';
import test from 'node:test';
import { findRisks } from '../src/riskTerms.ts';
import { pickSlogan, slogans } from '../src/slogans.ts';

test('every slogan names its issue and appears once', () => {
  assert.equal(new Set(slogans.map((s) => s.text)).size, slogans.length);
  assert.equal(new Set(slogans.map((s) => s.issue)).size, slogans.length);
  for (const { issue } of slogans) assert.match(issue, /^№ \d{2} \(\d{4}\)$/);
});

test('no slogan trips the redaction dictionary', () => {
  for (const { text } of slogans) assert.deepEqual(findRisks(text), [], text);
});

test('pickSlogan stays inside the list at both ends of the random range', () => {
  assert.equal(pickSlogan(() => 0), slogans[0]);
  assert.equal(pickSlogan(() => 0.999999), slogans[slogans.length - 1]);
});
