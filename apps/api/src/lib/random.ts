import { createHash, randomBytes } from 'node:crypto';

/**
 * Deterministic pseudo-random generator.
 *
 * Candidate paper order is generated once from a per-attempt seed and then
 * stored. The generator is deterministic so the same seed always reproduces the
 * same paper, which is what makes a reconnection safe: the stored assignment is
 * replayed rather than regenerated.
 */
export function createSeededRng(seed: string): () => number {
  // xoshiro-style state derived from the seed hash.
  const digest = createHash('sha256').update(seed).digest();
  let s0 = digest.readUInt32LE(0) || 1;
  let s1 = digest.readUInt32LE(4) || 2;
  let s2 = digest.readUInt32LE(8) || 3;
  let s3 = digest.readUInt32LE(12) || 4;

  const rotl = (x: number, k: number) => ((x << k) | (x >>> (32 - k))) >>> 0;

  return function next(): number {
    const result = (rotl((s1 * 5) >>> 0, 7) * 9) >>> 0;
    const t = (s1 << 9) >>> 0;
    s2 = (s2 ^ s0) >>> 0;
    s3 = (s3 ^ s1) >>> 0;
    s1 = (s1 ^ s2) >>> 0;
    s0 = (s0 ^ s3) >>> 0;
    s2 = (s2 ^ t) >>> 0;
    s3 = rotl(s3, 11);
    return result / 4294967296;
  };
}

/** Fisher–Yates shuffle driven by a seeded generator. */
export function seededShuffle<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = out[i];
    const b = out[j];
    out[i] = b as T;
    out[j] = a as T;
  }
  return out;
}

export function newSeed(): string {
  return randomBytes(16).toString('hex');
}

/** Stable numeric hash used for deterministic demo data. */
export function stableIndex(input: string, modulo: number): number {
  const digest = createHash('sha256').update(input).digest();
  return digest.readUInt32LE(0) % modulo;
}
