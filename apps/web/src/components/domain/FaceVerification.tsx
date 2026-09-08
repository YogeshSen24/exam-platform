import { useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, Lightbulb, ScanFace, ShieldQuestion } from 'lucide-react';
import { deviceSecurity } from '@/lib/deviceSecurity';
import { useDemoStore } from '@/lib/demoStore';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Feedback';
import { StatusPill } from '@/components/ui/Status';
import { PocDisclosure } from '@/components/ui/Explain';
import { ConfirmDialog } from '@/components/ui/Overlay';
import { Field, TextArea } from '@/components/ui/Form';
import { ProgressBar } from '@/components/ui/Misc';

type Phase = 'IDLE' | 'REQUESTING' | 'PREVIEW' | 'CAPTURED' | 'DENIED';

/**
 * Facial verification, POC biometric simulation.
 *
 * The camera and the capture are real where the browser allows it. The
 * comparison is not: it is produced by a mock analyser so a demonstration is
 * repeatable. No sensitive attribute — race, emotion, age, gender or anything
 * comparable — is inferred anywhere in this flow.
 */
export function FaceVerification({
  onResult,
}: {
  onResult: (outcome: 'PASSED' | 'OVERRIDDEN' | 'FAILED') => void;
}) {
  const demo = useDemoStore();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [phase, setPhase] = useState<Phase>('IDLE');
  const [denialReason, setDenialReason] = useState<string | null>(null);
  const [capture, setCapture] = useState<string | null>(null);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [verdict, setVerdict] = useState<'MATCH' | 'MISMATCH' | 'UNCLEAR' | null>(null);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [attempts, setAttempts] = useState(0);

  useEffect(() => {
    return () => deviceSecurity().releaseCamera();
  }, []);

  async function requestCamera() {
    setPhase('REQUESTING');
    const result = await deviceSecurity().requestCamera();
    if (!result.granted) {
      setDenialReason(result.reason ?? 'The camera could not be started.');
      setPhase('DENIED');
      return;
    }
    const stream = deviceSecurity().stream;
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      await videoRef.current.play().catch(() => undefined);
    }
    setPhase('PREVIEW');
  }

  async function captureAndCompare() {
    const frame = await deviceSecurity().captureFrame();
    setCapture(frame.dataUrl);
    setAttempts((count) => count + 1);

    // Simulated comparison. A production system evaluates this server-side.
    const outcome = demo.face;
    const isMatch = outcome === 'VERIFIED';
    const isUnclear = outcome === 'UNCLEAR' || outcome === 'LOW_LIGHT' || outcome === 'NO_FACE';
    setVerdict(isMatch ? 'MATCH' : isUnclear ? 'UNCLEAR' : 'MISMATCH');
    setConfidence(isMatch ? 0.93 : isUnclear ? 0.44 : 0.58);
    setPhase('CAPTURED');
    if (isMatch) onResult('PASSED');
  }

  function retry() {
    setCapture(null);
    setVerdict(null);
    setConfidence(null);
    setPhase(deviceSecurity().stream ? 'PREVIEW' : 'IDLE');
  }

  return (
    <div className="space-y-5">
      <PocDisclosure
        what="The camera and the capture are real where your browser allows it, but the comparison against the enrolment photograph is produced by a mock analyser. No sensitive attribute is inferred at any point."
        production="a validated liveness-detection and face-matching provider with published accuracy, operating server-side"
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* Camera panel */}
        <div className="rounded-card border border-line bg-ink p-4">
          <div className="relative aspect-[4/3] overflow-hidden rounded-control bg-black">
            {phase === 'CAPTURED' && capture ? (
              <img src={capture} alt="Verification photograph just taken" className="h-full w-full object-cover" />
            ) : (
              <video
                ref={videoRef}
                muted
                playsInline
                className="h-full w-full object-cover"
                aria-label="Live camera preview"
              />
            )}

            {/* Face-position frame */}
            {phase === 'PREVIEW' || phase === 'REQUESTING' ? (
              <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="h-[68%] w-[52%] rounded-[45%] border-2 border-dashed border-sky/80" />
              </div>
            ) : null}

            {phase === 'IDLE' || phase === 'DENIED' ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
                {phase === 'DENIED' ? (
                  <CameraOff aria-hidden className="h-10 w-10 text-white/70" />
                ) : (
                  <Camera aria-hidden className="h-10 w-10 text-white/70" />
                )}
                <p className="px-6 text-support text-white/80">
                  {phase === 'DENIED'
                    ? denialReason
                    : 'The camera is not running yet. Start it when you are ready.'}
                </p>
              </div>
            ) : null}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {phase === 'IDLE' ? (
              <Button variant="primary" size="sm" onClick={requestCamera} icon={<Camera aria-hidden className="h-4 w-4" />}>
                Start the camera
              </Button>
            ) : null}
            {phase === 'REQUESTING' ? (
              <Button variant="primary" size="sm" loading loadingText="Requesting camera access…">
                Requesting
              </Button>
            ) : null}
            {phase === 'PREVIEW' ? (
              <Button variant="primary" size="sm" onClick={captureAndCompare} icon={<ScanFace aria-hidden className="h-4 w-4" />}>
                Take the photograph
              </Button>
            ) : null}
            {phase === 'CAPTURED' ? (
              <Button variant="secondary" size="sm" onClick={retry}>
                Retake
              </Button>
            ) : null}
            {phase === 'DENIED' ? (
              <>
                <Button variant="secondary" size="sm" onClick={requestCamera}>
                  Try the camera again
                </Button>
                <Button variant="primary" size="sm" onClick={captureAndCompare}>
                  Continue in simulation mode
                </Button>
              </>
            ) : null}
          </div>
        </div>

        {/* Guidance and result */}
        <div className="space-y-4">
          <div className="rounded-card border border-line bg-page px-4 py-3">
            <p className="flex items-center gap-2 text-support font-semibold text-ink">
              <Lightbulb aria-hidden className="h-4 w-4 text-warning" />
              For a good photograph
            </p>
            <ul className="mt-2 space-y-1.5 text-support text-muted">
              <li>Sit squarely in front of the workstation and look at the camera.</li>
              <li>Place your whole face inside the outline.</li>
              <li>Make sure the light is in front of you, not behind you.</li>
              <li>Remove anything covering your face, unless it is worn for religious or medical reasons.</li>
            </ul>
          </div>

          {phase === 'CAPTURED' && verdict ? (
            <div
              className={`rounded-card border px-4 py-4 ${
                verdict === 'MATCH'
                  ? 'border-success-border bg-success-soft'
                  : verdict === 'UNCLEAR'
                    ? 'border-warning-border bg-warning-soft'
                    : 'border-critical-border bg-critical-soft'
              }`}
              role="status"
              aria-live="polite"
            >
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill tone={verdict === 'MATCH' ? 'success' : verdict === 'UNCLEAR' ? 'warning' : 'critical'} size="sm">
                  {verdict === 'MATCH' ? 'Identity confirmed' : verdict === 'UNCLEAR' ? 'Photograph unclear' : 'Did not match'}
                </StatusPill>
                <StatusPill tone="neutral" size="sm">
                  Simulated comparison
                </StatusPill>
              </div>
              <p className="mt-2 text-support text-ink">
                {verdict === 'MATCH'
                  ? 'Your photograph matched the enrolment photograph on your candidate record.'
                  : verdict === 'UNCLEAR'
                    ? 'The photograph could not be compared clearly. Adjust the lighting or your position and take another.'
                    : 'The photograph did not match the enrolment photograph. This does not end your examination — an invigilator will confirm your identity in person.'}
              </p>
              {confidence !== null ? (
                <div className="mt-3">
                  <ProgressBar
                    label="Comparison confidence"
                    value={Math.round(confidence * 100)}
                    tone={verdict === 'MATCH' ? 'success' : verdict === 'UNCLEAR' ? 'warning' : 'critical'}
                  />
                </div>
              ) : null}

              {verdict !== 'MATCH' ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onClick={retry}>
                    Take another photograph
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<ShieldQuestion aria-hidden className="h-4 w-4" />}
                    onClick={() => setOverrideOpen(true)}
                  >
                    Request an invigilator review
                  </Button>
                </div>
              ) : null}

              {attempts >= 3 && verdict !== 'MATCH' ? (
                <Alert tone="warning" className="mt-3" title="Three attempts have not succeeded">
                  Raise your hand. An invigilator will confirm your identity in person so you can begin without further
                  delay.
                </Alert>
              ) : null}
            </div>
          ) : null}

          {phase === 'DENIED' ? (
            <Alert tone="warning" title="Camera unavailable on this workstation">
              You can continue in simulation mode for this demonstration. In a live examination the centre operator would
              move you to a workstation with a working camera, and the fault would be recorded against this machine.
            </Alert>
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={overrideOpen}
        onClose={() => setOverrideOpen(false)}
        onConfirm={() => {
          setOverrideOpen(false);
          onResult('OVERRIDDEN');
        }}
        title="Invigilator review"
        description="An invigilator confirms the candidate's identity in person. The override and its reason are recorded in the audit trail."
        confirmLabel="Record the review"
        confirmDisabled={overrideReason.trim().length < 5}
      >
        <div className="space-y-4">
          <Alert tone="info" title="For the invigilator">
            Check the candidate’s admit card and photographic identity document against the person at this workstation
            before recording a review outcome.
          </Alert>
          <Field label="How was identity confirmed?" htmlFor="face-override" required>
            <TextArea
              id="face-override"
              rows={3}
              value={overrideReason}
              onChange={(event) => setOverrideReason(event.target.value)}
              placeholder="Admit card and photographic identity document checked in person by the invigilator."
            />
          </Field>
        </div>
      </ConfirmDialog>
    </div>
  );
}
