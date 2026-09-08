/**
 * IP allowlist evaluation.
 *
 * "Allows connections only from approved examination-centre networks. It does
 * not replace encryption or candidate verification."
 */

function ipv4ToInt(ip: string): number | null {
  const parts = ip.trim().split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    value = (value << 8) + n;
  }
  return value >>> 0;
}

export function ipInCidr(ip: string, cidr: string): boolean {
  const [range, bitsRaw] = cidr.split('/');
  const bits = Number(bitsRaw);
  if (!range || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const ipInt = ipv4ToInt(ip);
  const rangeInt = ipv4ToInt(range);
  if (ipInt === null || rangeInt === null) return false;
  if (bits === 0) return true;
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return (ipInt & mask) === (rangeInt & mask);
}

export interface NetworkDecision {
  allowed: boolean;
  matchedRange: string | null;
  reason: string;
}

export function evaluateNetwork(
  ip: string,
  ranges: (string | null | undefined)[],
  enforced: boolean,
): NetworkDecision {
  if (!enforced) {
    return { allowed: true, matchedRange: null, reason: 'IP allowlisting is not enabled for this examination.' };
  }
  const candidates = ranges.filter((r): r is string => Boolean(r));
  for (const range of candidates) {
    if (ipInCidr(ip, range)) {
      return { allowed: true, matchedRange: range, reason: `Address is inside the approved range ${range}.` };
    }
  }
  return {
    allowed: false,
    matchedRange: null,
    reason: `Address ${ip} is not inside any approved examination-centre range (${candidates.join(', ') || 'none configured'}).`,
  };
}

/** Loopback addresses used by local development are treated as centre-local. */
export function normaliseClientIp(raw: string | undefined, demoOverride?: string): string {
  if (demoOverride) return demoOverride;
  if (!raw) return '10.42.10.10';
  const ip = raw.replace(/^::ffff:/, '');
  if (ip === '::1' || ip === '127.0.0.1' || ip === 'localhost') return '10.42.10.10';
  return ip;
}
