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

/**
 * IPv6 as a single 128-bit number, so a range can be compared the same way an
 * IPv4 one is. Handles "::" compression and an IPv4 tail (::ffff:203.0.113.5),
 * which is how a dual-stack proxy reports an IPv4 client.
 */
function ipv6ToBigInt(ip: string): bigint | null {
  let text = ip.trim().toLowerCase();
  if (text.startsWith('[') && text.endsWith(']')) text = text.slice(1, -1);
  const zone = text.indexOf('%');
  if (zone !== -1) text = text.slice(0, zone);
  if (text === '') return null;

  const lastColon = text.lastIndexOf(':');
  if (lastColon === -1) return null;
  const tail = text.slice(lastColon + 1);
  if (tail.includes('.')) {
    const embedded = ipv4ToInt(tail);
    if (embedded === null) return null;
    const high = (embedded >>> 16).toString(16);
    const low = (embedded & 0xffff).toString(16);
    text = `${text.slice(0, lastColon + 1)}${high}:${low}`;
  }

  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;

  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...rest];
  let value = 0n;
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    value = (value << 16n) + BigInt(Number.parseInt(group, 16));
  }
  return value;
}

function ipv6InCidr(ip: string, range: string, bits: number): boolean {
  if (bits < 0 || bits > 128) return false;
  const ipValue = ipv6ToBigInt(ip);
  const rangeValue = ipv6ToBigInt(range);
  if (ipValue === null || rangeValue === null) return false;
  if (bits === 0) return true;
  const mask = ((1n << BigInt(bits)) - 1n) << BigInt(128 - bits);
  return (ipValue & mask) === (rangeValue & mask);
}

export function ipInCidr(ip: string, cidr: string): boolean {
  const slash = cidr.lastIndexOf('/');
  if (slash === -1) return false;
  const range = cidr.slice(0, slash);
  const bits = Number(cidr.slice(slash + 1));
  if (!range || !Number.isInteger(bits)) return false;

  // A range and an address of different families never match, and an IPv4
  // client arriving as ::ffff:a.b.c.d is compared as IPv4 by the caller.
  const rangeIsV6 = range.includes(':');
  const ipIsV6 = ip.includes(':');
  if (rangeIsV6 !== ipIsV6) return false;
  if (rangeIsV6) return ipv6InCidr(ip, range, bits);

  if (bits < 0 || bits > 32) return false;
  const ipInt = ipv4ToInt(ip);
  const rangeInt = ipv4ToInt(range);
  if (ipInt === null || rangeInt === null) return false;
  if (bits === 0) return true;
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return (ipInt & mask) === (rangeInt & mask);
}

/**
 * Reads what an administrator typed into an approved-range field.
 *
 * A single machine reporting from a single address is the common reason to
 * edit these, so a bare address is accepted and stored as a one-host range.
 */
export function toCidr(value: string | null | undefined): string | null {
  const text = (value ?? '').trim();
  if (text === '') return null;
  if (text.includes('/')) return text;
  if (text.includes(':')) return `${text}/128`;
  return `${text}/32`;
}

/**
 * Reads the three range fields of a submitted form. An administrator opening
 * that screen usually has one machine and one address in front of them, so a
 * bare address becomes a single-host range before the schema checks it.
 */
export function normaliseRangeBody(body: unknown): unknown {
  if (typeof body !== 'object' || body === null) return body;
  const input = body as Record<string, unknown>;
  const read = (key: string) => (typeof input[key] === 'string' ? toCidr(input[key] as string) : input[key]);
  return { ...input, primaryCidr: read('primaryCidr'), backupCidr: read('backupCidr'), ipv6Cidr: read('ipv6Cidr') };
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
