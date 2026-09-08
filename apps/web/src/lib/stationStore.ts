/**
 * What this machine remembers about its own setup.
 *
 * The authority is a signed, HTTP-only cookie the browser cannot read or
 * forge; this is a plain-language copy kept beside it so the interface can
 * show an invigilator which examination the machine is running and how long
 * the setup has left, without asking the server on every render.
 *
 * The key itself is deliberately never stored here. Anyone sitting at the
 * machine can read local storage, and a key in reach of a candidate is a key
 * that can set up machines the board never intended.
 */

const STORAGE_KEY = 'sep.station.v1';

export interface StoredStation {
  stationCode: string;
  room: string;
  session: string;
  centreCode: string;
  examCode: string;
  examName: string;
  /** When the setup lapses and the machine has to be keyed again. */
  expiresAt: string;
  setUpAt: string;
}

export function rememberStation(station: StoredStation): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(station));
  } catch {
    // Private browsing, a full disk, or storage switched off. The cookie is
    // the authority, so the machine still works; it just cannot show the
    // details without asking the server.
  }
}

export function recallStation(): StoredStation | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const station = JSON.parse(raw) as StoredStation;
    if (new Date(station.expiresAt).getTime() <= Date.now()) {
      forgetStation();
      return null;
    }
    return station;
  } catch {
    return null;
  }
}

export function forgetStation(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do: the cookie still governs whether the machine is set up.
  }
}

/** How long the setup has left, for a countdown an invigilator can act on. */
export function stationTimeRemaining(expiresAt: string): { expired: boolean; label: string } {
  const remaining = new Date(expiresAt).getTime() - Date.now();
  if (!Number.isFinite(remaining) || remaining <= 0) return { expired: true, label: 'expired' };

  const hours = Math.floor(remaining / 3_600_000);
  const minutes = Math.floor((remaining % 3_600_000) / 60_000);

  if (hours > 0) return { expired: false, label: `${hours}h ${minutes}m` };
  return { expired: false, label: `${minutes} minutes` };
}
