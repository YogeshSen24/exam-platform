import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, ShieldAlert } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { deviceSecurity } from '@/lib/deviceSecurity';
import { FACE_OUTCOME_TO_RESULT, useDemoStore } from '@/lib/demoStore';
import { StatusPill } from '@/components/ui/Status';
import { Alert } from '@/components/ui/Feedback';

export interface MonitoringOutcome {
  response: 'NONE' | 'SUBTLE_WARNING' | 'PROMINENT_WARNING' | 'RESTRICT_NAVIGATION';
  restricted: boolean;
  message: string;
  consecutiveFailures: number;
  invigilatorNotified: boolean;
  result: string;
  attemptStatus: string;
}

interface QueuedCapture {
  challengeId: string;
  sequence: number;
  capturedAt: string;
  previousEvidenceHash: string | null;
  simulatedResult: string;
  imageBytes: number;
}

/**
 * Camera-presence monitoring loop.
 *
 * Per capture cycle:
 *   1. ask the server for a challenge
 *   2. capture a low-resolution frame
 *   3. attach attempt, device, sequence, challenge, timestamp and the previous
 *      evidence hash
 *   4. queue locally if the connection is down
 *   5. upload
 *   6. drop the local copy only once the server acknowledges
 *
 * POC boundary: the presence verdict is produced by a mock analyser here. A
 * production system evaluates the frame server-side with a validated service and
 * never trusts a verdict declared by the workstation.
 */
export function CameraMonitor({
  attemptId,
  deviceCode,
  intervalSeconds,
  enabled,
  paused,
  onOutcome,
}: {
  attemptId: string;
  deviceCode: string;
  intervalSeconds: number;
  enabled: boolean;
  paused: boolean;
  onOutcome: (outcome: MonitoringOutcome) => void;
}) {
  const demo = useDemoStore();
  const videoRef = useRef<HTMLVideoElement>(null);
  const queueRef = useRef<QueuedCapture[]>([]);
  const previousHashRef = useRef<string | null>(null);
  const sequenceRef = useRef(0);
  const busyRef = useRef(false);

  const [cameraState, setCameraState] = useState<'IDLE' | 'RUNNING' | 'UNAVAILABLE'>('IDLE');
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [queuedCount, setQueuedCount] = useState(0);
  const [showPreview, setShowPreview] = useState(false);

  /* -------------------------- camera lifecycle -------------------------- */

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    void (async () => {
      const result = await deviceSecurity().requestCamera();
      if (cancelled) return;
      if (!result.granted) {
        setCameraState('UNAVAILABLE');
        return;
      }
      const stream = deviceSecurity().stream;
      if (videoRef.current && stream) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      setCameraState('RUNNING');
    })();

    return () => {
      cancelled = true;
      deviceSecurity().releaseCamera();
    };
  }, [enabled]);

  /* ------------------------------ upload ------------------------------- */

  const flushQueue = useCallback(async () => {
    while (queueRef.current.length > 0) {
      const next = queueRef.current[0]!;
      try {
        const acknowledgement = await api.post<MonitoringOutcome & { evidenceHash: string }>(
          '/evidence/upload-authorize',
          { attemptId, deviceCode, ...next },
        );
        // The local copy is released only after the server acknowledges.
        queueRef.current.shift();
        setQueuedCount(queueRef.current.length);
        previousHashRef.current = acknowledgement.evidenceHash;
        setLastResult(acknowledgement.result);
        onOutcome(acknowledgement);
      } catch (error) {
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
          // A rejected capture is dropped rather than retried forever.
          queueRef.current.shift();
          setQueuedCount(queueRef.current.length);
          continue;
        }
        // Connection problem: keep the capture and try again next cycle.
        return;
      }
    }
  }, [attemptId, deviceCode, onOutcome]);

  const runCycle = useCallback(async () => {
    if (busyRef.current || paused) return;
    busyRef.current = true;
    try {
      if (demo.simulateOffline) {
        // Queue locally without contacting the server.
        sequenceRef.current += 1;
        queueRef.current.push({
          challengeId: `offline-${sequenceRef.current}`,
          sequence: sequenceRef.current,
          capturedAt: new Date().toISOString(),
          previousEvidenceHash: previousHashRef.current,
          simulatedResult: FACE_OUTCOME_TO_RESULT[demo.face],
          imageBytes: 38_400,
        });
        setQueuedCount(queueRef.current.length);
        return;
      }

      await flushQueue();

      const { challenge } = await api.post<{ challenge: { challengeId: string; sequence: number } }>(
        '/evidence/challenge',
        { attemptId },
      );
      const frame = await deviceSecurity().captureFrame();
      sequenceRef.current = challenge.sequence;

      queueRef.current.push({
        challengeId: challenge.challengeId,
        sequence: challenge.sequence,
        capturedAt: frame.capturedAt,
        previousEvidenceHash: previousHashRef.current,
        simulatedResult: FACE_OUTCOME_TO_RESULT[demo.face],
        imageBytes: frame.approximateBytes,
      });
      setQueuedCount(queueRef.current.length);
      await flushQueue();
    } catch {
      // Silent: the loop retries on the next tick and the queue is preserved.
    } finally {
      busyRef.current = false;
    }
  }, [attemptId, demo.face, demo.simulateOffline, flushQueue, paused]);

  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => void runCycle(), intervalSeconds * 1000);
    return () => clearInterval(timer);
  }, [enabled, intervalSeconds, runCycle]);

  if (!enabled) return null;

  return (
    <div className="rounded-card border border-line bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-meta font-medium uppercase tracking-wide text-muted">
          {cameraState === 'UNAVAILABLE' ? (
            <CameraOff aria-hidden className="h-4 w-4" />
          ) : (
            <Camera aria-hidden className="h-4 w-4" />
          )}
          Presence monitoring
        </p>
        <StatusPill
          size="sm"
          tone={cameraState === 'RUNNING' ? 'success' : cameraState === 'UNAVAILABLE' ? 'warning' : 'neutral'}
        >
          {cameraState === 'RUNNING' ? 'Active' : cameraState === 'UNAVAILABLE' ? 'Simulation mode' : 'Starting'}
        </StatusPill>
      </div>

      <div className="mt-3 overflow-hidden rounded-control bg-ink">
        <video
          ref={videoRef}
          muted
          playsInline
          aria-label="Camera preview"
          className={`aspect-[4/3] w-full object-cover transition-opacity ${showPreview ? 'opacity-100' : 'opacity-30'}`}
        />
      </div>

      <div className="mt-3 space-y-2">
        <p className="text-meta text-muted">
          A low-resolution image every {intervalSeconds} seconds, to confirm you are present and alone.
        </p>
        {lastResult ? (
          <p className="text-meta text-muted">
            Last check: <span className="text-ink">{lastResult.replace(/_/g, ' ').toLowerCase()}</span>
          </p>
        ) : null}
        {queuedCount > 0 ? (
          <Alert tone="warning" title={`${queuedCount} capture${queuedCount === 1 ? '' : 's'} waiting to upload`}>
            Stored on this workstation and sent automatically when the connection returns. This does not affect your
            answers.
          </Alert>
        ) : null}
        <button
          type="button"
          onClick={() => setShowPreview((value) => !value)}
          className="text-meta font-medium text-brand hover:underline focus-visible:ring-2 focus-visible:ring-brand"
        >
          {showPreview ? 'Dim the camera preview' : 'Show the camera preview'}
        </button>
      </div>

      {cameraState === 'UNAVAILABLE' ? (
        <p className="mt-3 flex items-start gap-2 rounded-control border border-warning-border bg-warning-soft px-3 py-2 text-meta text-ink">
          <ShieldAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          No camera is available on this workstation, so monitoring is running in simulation mode for this
          demonstration. In a live examination the operator would move you to a workstation with a working camera.
        </p>
      ) : null}
    </div>
  );
}
