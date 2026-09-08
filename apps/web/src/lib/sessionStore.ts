/**
 * What this machine remembers about the person signed in at it.
 *
 * The identity itself stays in a signed, HTTP-only cookie: a script on the
 * page cannot read it and cannot forge one, which is the property worth
 * keeping. What is mirrored here is the CSRF secret issued alongside it and
 * the moment the session runs out.
 *
 * That mirror is what makes a reload survivable. Without it the page comes
 * back holding a valid cookie but no CSRF secret, and the first answer a
 * candidate saves is rejected until the application has been round the server
 * again. With it, the machine picks up where it left off.
 *
 * Same lifetime rule as the machine's own setup: it lapses on its own rather
 * than lingering on a shared examination machine after the sitting has ended.
 */

const STORAGE_KEY = 'sep.session.v1';

/** Never longer than this, however long the server would allow. */
const MAX_HOURS = 4;

export interface StoredSession {
  /** The double-submit secret sent with every write. Not an identity token. */
  csrfToken: string;
  kind: 'STAFF' | 'CANDIDATE';
  /** When this stops being usable and the person has to sign in again. */
  expiresAt: string;
  storedAt: string;
}

function cap(expiresAt: string): string {
  const ceiling = Date.now() + MAX_HOURS * 3_600_000;
  const wanted = new Date(expiresAt).getTime();
  const effective = Number.isFinite(wanted) ? Math.min(wanted, ceiling) : ceiling;
  return new Date(effective).toISOString();
}

export function rememberSession(session: { csrfToken: string; kind: 'STAFF' | 'CANDIDATE'; expiresAt: string }): void {
  try {
    const stored: StoredSession = {
      csrfToken: session.csrfToken,
      kind: session.kind,
      expiresAt: cap(session.expiresAt),
      storedAt: new Date().toISOString(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Storage unavailable. The cookie still carries the session; the page will
    // simply fetch the CSRF secret from the server after a reload.
  }
}

export function recallSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const stored = JSON.parse(raw) as StoredSession;
    if (!stored.csrfToken || new Date(stored.expiresAt).getTime() <= Date.now()) {
      forgetSession();
      return null;
    }
    return stored;
  } catch {
    return null;
  }
}

export function forgetSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do.
  }
}
