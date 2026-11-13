// An account's avatar colours, derived only from a seed string, so the same seed gives the same
// avatar on every device. The caller chooses the seed (see `accountSeed` in Shell.tsx).

/** Every stop stays in these ranges: vivid on the light header, never muddy or washed out. */
export const SATURATION = { min: 62, max: 80 } as const;
export const LIGHTNESS = { min: 48, max: 66 } as const;

export type AvatarStop = { h: number; s: number; l: number };
export type AvatarColors = { stops: [AvatarStop, AvatarStop, AvatarStop]; angle: number; background: string };

/** EVM addresses compare case-insensitively; any other seed (a NEAR account id) is used as is. */
export const canonicalSeed = (seed: string) => (/^0x[0-9a-f]{40}$/i.test(seed) ? seed.toLowerCase() : seed);

// FNV-1a over the seed's UTF-16 code units, then murmur3's finaliser to spread the bits, so
// seeds that differ by one character still land far apart.
function hash(text: string, basis = 0x811c9dc5) {
  let h = basis;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

const within = (bits: number, range: { min: number; max: number }) => range.min + (bits % (range.max - range.min + 1));
const hsl = ({ h, s, l }: AvatarStop) => `hsl(${h} ${s}% ${l}%)`;

/**
 * Three hues from different bits of the hash, all within about 160 degrees of each other so
 * every blend stays vivid (opposite hues mix to grey): a base, a neighbour 35-90 degrees on, and
 * an accent 95-160 degrees on, laid as a soft blob over an angled two-stop gradient.
 */
export function avatarColors(seed: string): AvatarColors {
  const a = hash(canonicalSeed(seed));
  const b = hash(canonicalSeed(seed), a);
  const h1 = a % 360;
  const stops: AvatarColors['stops'] = [
    { h: h1, s: within(a >>> 9, SATURATION), l: within(b, LIGHTNESS) },
    { h: (h1 + 35 + ((a >>> 17) % 56)) % 360, s: within(b >>> 5, SATURATION), l: within(a >>> 13, LIGHTNESS) },
    { h: (h1 + 95 + ((b >>> 11) % 66)) % 360, s: within(b >>> 19, SATURATION), l: within(b >>> 23, LIGHTNESS) },
  ];
  const angle = (b >>> 3) % 360;
  const x = 22 + ((a >>> 25) % 56);
  const y = 22 + ((b >>> 27) % 32);
  const background = `radial-gradient(circle at ${x}% ${y}%, ${hsl(stops[2])} 0, transparent 58%), linear-gradient(${angle}deg, ${hsl(stops[0])}, ${hsl(stops[1])})`;
  return { stops, angle, background };
}
