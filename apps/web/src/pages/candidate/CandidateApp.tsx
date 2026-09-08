import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { api, setWorkstationCode } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useCandidateStore } from '@/lib/candidateStore';
import { forgetStation } from '@/lib/stationStore';
import { useDemoStore } from '@/lib/demoStore';
import { LoadingScreen } from '@/components/layout/LoadingScreen';
import { DemoDrawer } from '@/components/domain/DemoDrawer';
import { Button } from '@/components/ui/Button';

import { CandidateLoginScreen } from './CandidateLoginScreen';
import { StationSetupScreen } from './StationSetupScreen';
import { VerificationScreen } from './VerificationScreen';
import { InstructionsScreen } from './InstructionsScreen';
import { WaitingRoomScreen } from './WaitingRoomScreen';
import { ExamSessionScreen } from './ExamSessionScreen';
import { ReverifyScreen } from './ReverifyScreen';
import { SubmissionReviewScreen } from './SubmissionReviewScreen';
import { ReceiptScreen } from './ReceiptScreen';

/** What the machine in front of the candidate has been set up to run. */
export interface StationResponse {
  configured: boolean;
  /** True when the machine was set up but the setup has since run out. */
  lapsed?: boolean;
  station?: {
    id: string;
    code: string;
    room: string;
    session: string;
    centreCode: string;
    attemptCount: number;
    expiresAt: string;
  };
  exam?: { id: string; code: string; name: string; startsAt: string; durationMinutes: number } | null;
  windowOpen?: boolean;
}

export interface CandidateContextResponse {
  candidate: {
    id: string;
    candidateId: string;
    applicationId: string;
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
    totalQuestions: number;
    totalMarks: number;
    navigationMode: string;
    negativeMarking: boolean;
    negativeMarkValue: number;
    startsAt: string;
    status: string;
  };
  centre: { id: string; name: string; city: string } | null;
  workstation: {
    deviceCode: string;
    name?: string;
    status: string;
    certificateStatus?: string;
    cameraStatus?: string;
    fingerprintScannerStatus?: string;
    networkStatus?: string;
  };
  securityProfile: { id: string; name: string; summary: string };
  flags: {
    requireRegisteredDevice: boolean;
    requireFaceVerificationAtLogin: boolean;
    fingerprintVerification: 'off' | 'optional' | 'required';
    periodicFacePresence: boolean;
    ipAllowlist: boolean;
    deviceCertificateRequired: boolean;
    singleActiveSession: boolean;
    invigilatorReviewWorkflow: boolean;
  };
  monitoring: {
    cameraMonitoringEnabled: boolean;
    loginSnapshotEnabled: boolean;
    snapshotIntervalSeconds: number;
    consecutiveFailureThreshold: number;
    reverificationMode: string;
    evidenceRetentionDays: number;
    candidateNotice: string;
  };
  network: { clientAddress: string; approvedRange: string };
  attempt: (Record<string, unknown> & { id: string; status: string; remainingSeconds: number }) | null;
  serverTime: string;
}

/**
 * The candidate workstation application.
 *
 * Deliberately a separate shell from the administration portal: no global
 * navigation, no links out, and a single task on screen at a time. In a
 * production deployment this runs inside a native Windows shell under kiosk
 * policy; here it is a full-screen browser simulation, and the interface says so.
 */
export function CandidateApp() {
  const { status, user } = useSession();
  const location = useLocation();
  const demo = useDemoStore();
  const workstationCode = useCandidateStore((state) => state.workstationCode);

  useEffect(() => {
    setWorkstationCode(workstationCode);
  }, [workstationCode]);

  useEffect(() => {
    document.title = 'Examination workstation';
  }, []);

  /**
   * What this machine is set up to run.
   *
   * Asked before anything else: a board runs several examinations at once, and
   * an unconfigured machine cannot show a sign-in screen that would work.
   */
  const station = useQuery({
    queryKey: ['station'],
    queryFn: async () => {
      const response = await api.get<StationResponse>('/activation/station');
      // The local copy exists to describe a machine that is set up. The moment
      // it is not, the copy goes, so nothing on screen claims otherwise.
      if (!response.configured) forgetStation();
      return response;
    },
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });

  const context = useQuery({
    queryKey: ['candidate-context'],
    queryFn: () => api.get<CandidateContextResponse>('/attempts/context'),
    enabled: status === 'authenticated' && user?.kind === 'CANDIDATE',
    refetchOnWindowFocus: false,
  });

  if (status === 'loading' || station.isLoading) return <LoadingScreen label="Preparing this workstation" />;

  const authenticated = status === 'authenticated' && user?.kind === 'CANDIDATE';
  // Nobody signs in on a machine that has not been told which examination it
  // is running, so the setup screen comes before everything else.
  const configured = station.data?.configured === true;

  return (
    <div className="min-h-screen bg-page">
      <a href="#exam-main" className="skip-link">
        Skip to the main examination content
      </a>

      {!configured ? (
        <StationSetupScreen />
      ) : !authenticated ? (
        <Routes>
          <Route path="/" element={<CandidateLoginScreen station={station.data} />} />
          <Route path="*" element={<Navigate to="/exam" replace state={{ from: location.pathname }} />} />
        </Routes>
      ) : context.isLoading ? (
        <LoadingScreen label="Loading your examination" />
      ) : context.isError || !context.data ? (
        <CandidateContextError onRetry={() => void context.refetch()} />
      ) : (
        <Routes>
          <Route path="/" element={<Navigate to="/exam/verify" replace />} />
          <Route path="/verify" element={<VerificationScreen context={context.data} />} />
          <Route path="/instructions" element={<InstructionsScreen context={context.data} />} />
          <Route path="/waiting" element={<WaitingRoomScreen context={context.data} />} />
          <Route path="/session" element={<ExamSessionScreen context={context.data} />} />
          <Route path="/reverify" element={<ReverifyScreen context={context.data} />} />
          <Route path="/review" element={<SubmissionReviewScreen context={context.data} />} />
          <Route path="/receipt" element={<ReceiptScreen context={context.data} />} />
          <Route path="*" element={<Navigate to="/exam/verify" replace />} />
        </Routes>
      )}

      {demo.enabled ? (
        <>
          <button
            type="button"
            onClick={() => demo.setOpen(true)}
            className="no-print fixed bottom-4 left-4 z-40 rounded-full border border-line bg-white px-3.5 py-2 text-meta font-medium text-muted shadow-raised transition-colors hover:border-brand-200 hover:text-brand focus-visible:ring-2 focus-visible:ring-brand"
          >
            Demo mode
          </button>
          <DemoDrawer />
        </>
      ) : null}
    </div>
  );
}

function CandidateContextError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="surface w-full max-w-lg p-8 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-panel bg-navy">
          <ShieldCheck aria-hidden className="h-6 w-6 text-sky" />
        </span>
        <h1 className="mt-5 text-section font-semibold text-ink">Your examination could not be loaded</h1>
        <p className="mt-2 text-body text-muted">
          The workstation could not reach the examination service, or no examination is assigned to your account. Any
          answers already saved on the server are safe.
        </p>
        <p className="mt-2 text-support text-muted">Raise your hand — the examination-centre operator will help.</p>
        <div className="mt-6 flex justify-center gap-2">
          <Button variant="primary" onClick={onRetry}>
            Try again
          </Button>
        </div>
      </div>
    </div>
  );
}
