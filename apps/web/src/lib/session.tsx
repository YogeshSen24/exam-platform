import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Permission, SessionUser } from '@sep/shared';
import { rolesHavePermission } from '@sep/shared';
import { api, ApiError, setCsrfToken, setWorkstationCode } from './api';
import { forgetSession, recallSession, rememberSession } from './sessionStore';

/**
 * Client session state.
 *
 * This exists to shape navigation and hide controls the user cannot use. It is
 * never the authorisation boundary — the API re-checks every permission.
 */

interface SessionState {
  user: SessionUser | null;
  status: 'loading' | 'authenticated' | 'anonymous';
  expiresAt: string | null;
  loginStaff: (email: string, password: string) => Promise<SessionUser>;
  loginCandidate: (input: {
    applicationId: string;
    password: string;
    workstationCode: string;
  }) => Promise<CandidateLoginResult>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  can: (permission: Permission) => boolean;
}

export interface CandidateLoginResult {
  user: SessionUser;
  candidate: {
    applicationId: string;
    candidateId: string;
    fullName: string;
    photoSeed: string;
    fingerprintEnrolled: boolean;
    faceEnrolled: boolean;
    accommodations: { additionalTimeMinutes: number; requirements: string[]; notes: string };
  };
  exam: {
    id: string;
    name: string;
    code: string;
    durationMinutes: number;
    navigationMode: string;
    startsAt: string;
    securityProfileId: string;
  } | null;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [status, setStatus] = useState<SessionState['status']>('loading');

  const refresh = useCallback(async () => {
    // Pick the CSRF secret back up before asking the server anything, so a
    // reload mid-examination can save an answer straight away rather than
    // failing the first write while the session is re-established.
    const remembered = recallSession();
    if (remembered) setCsrfToken(remembered.csrfToken);

    try {
      const data = await api.get<{ user: SessionUser; csrfToken: string; expiresAt: string }>('/auth/session');
      setCsrfToken(data.csrfToken);
      rememberSession({ csrfToken: data.csrfToken, kind: data.user.kind, expiresAt: data.expiresAt });
      setUser(data.user);
      setExpiresAt(data.expiresAt);
      setStatus('authenticated');
    } catch (error) {
      // Whatever the reason, this machine is no longer signed in, so the local
      // copy goes with it rather than lingering after the sitting.
      forgetSession();
      setCsrfToken('');
      setUser(null);
      setStatus('anonymous');
      if (!(error instanceof ApiError && error.isUnauthenticated)) return;
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const loginStaff = useCallback(async (email: string, password: string) => {
    const data = await api.post<{ user: SessionUser; csrfToken: string; expiresAt: string }>('/auth/login', {
      email,
      password,
    });
    setCsrfToken(data.csrfToken);
    rememberSession({ csrfToken: data.csrfToken, kind: 'STAFF', expiresAt: data.expiresAt });
    setUser(data.user);
    setExpiresAt(data.expiresAt);
    setStatus('authenticated');
    return data.user;
  }, []);

  const loginCandidate = useCallback(
    async (input: { applicationId: string; password: string; workstationCode: string }) => {
      setWorkstationCode(input.workstationCode);
      const data = await api.post<CandidateLoginResult & { csrfToken: string; expiresAt: string }>(
        '/auth/candidate-login',
        input,
      );
      setCsrfToken(data.csrfToken);
      rememberSession({ csrfToken: data.csrfToken, kind: 'CANDIDATE', expiresAt: data.expiresAt });
      setUser(data.user);
      setExpiresAt(data.expiresAt);
      setStatus('authenticated');
      return data;
    },
    [],
  );

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      forgetSession();
      setCsrfToken('');
      setUser(null);
      setExpiresAt(null);
      setStatus('anonymous');
    }
  }, []);

  const can = useCallback(
    (permission: Permission) => (user ? rolesHavePermission(user.roles, permission) : false),
    [user],
  );

  const value = useMemo<SessionState>(
    () => ({ user, status, expiresAt, loginStaff, loginCandidate, logout, refresh, can }),
    [user, status, expiresAt, loginStaff, loginCandidate, logout, refresh, can],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession must be used inside a SessionProvider');
  return context;
}
