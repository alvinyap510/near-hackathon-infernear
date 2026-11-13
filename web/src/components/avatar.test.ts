import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LIGHTNESS, SATURATION, avatarColors, canonicalSeed } from './avatar.ts';

const EVM = '0x7a3f2e9c1b4d5a6e8f0a1b2c3d4e5f6a7b8cc41e';
const hues = (seed: string) => avatarColors(seed).stops.map((s) => s.h);

test('the same seed always gives the same avatar, on any device', () => {
  assert.deepEqual(avatarColors(EVM), avatarColors(EVM));
  // Pinned, so changing the hash (and with it every user's avatar) has to be deliberate.
  assert.deepEqual(hues(EVM), [170, 221, 286]);
  assert.deepEqual(hues('alice.near'), [232, 320, 335]);
});

test('EVM addresses ignore letter case; NEAR ids are kept as they are', () => {
  assert.deepEqual(avatarColors('0x' + EVM.slice(2).toUpperCase()), avatarColors(EVM));
  assert.equal(canonicalSeed('0xABCDEF0123456789ABCDEF0123456789ABCDEF01'), '0xabcdef0123456789abcdef0123456789abcdef01');
  assert.equal(canonicalSeed('Alice.near'), 'Alice.near');
});

test('different accounts get different avatars', () => {
  assert.notDeepEqual(avatarColors('alice.near'), avatarColors('bob.near'));
  assert.notDeepEqual(avatarColors(EVM), avatarColors(EVM.replace(/e$/, 'f')));
});

test('every colour stays within the allowed hue, saturation and lightness ranges', () => {
  for (let i = 0; i < 2000; i++) {
    const seed = i % 2 ? `user${i}.near` : `0x${i.toString(16).padStart(40, '0')}`;
    const { stops, angle } = avatarColors(seed);
    assert.ok(angle >= 0 && angle < 360);
    for (const { h, s, l } of stops) {
      assert.ok(Number.isInteger(h) && h >= 0 && h < 360, `hue ${h} for ${seed}`);
      assert.ok(s >= SATURATION.min && s <= SATURATION.max, `saturation ${s} for ${seed}`);
      assert.ok(l >= LIGHTNESS.min && l <= LIGHTNESS.max, `lightness ${l} for ${seed}`);
    }
  }
});
