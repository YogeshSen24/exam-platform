import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useDemoStore } from '@/lib/demoStore';
import { Modal } from '@/components/ui/Overlay';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Feedback';

/** Fresh, single-use verification for every application-controlled download. */
export function useFacialExport() {
  const [pending, setPending] = useState<{ scope: string; action: (token: string) => Promise<void> | void } | null>(null);
  const [challenge, setChallenge] = useState<{ challengeId: string; simulated: boolean } | null>(null);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [ready, setReady] = useState(false);
  const video = useRef<HTMLVideoElement>(null); const stream = useRef<MediaStream | null>(null);
  const active = useRef(0); const demo = useDemoStore();
  function stop() { stream.current?.getTracks().forEach(t => t.stop()); stream.current = null; setReady(false); }
  useEffect(() => () => { active.current++; stream.current?.getTracks().forEach(t => t.stop()); }, []);
  function close() { if (busy) return; active.current++; stop(); setPending(null); setChallenge(null); }
  async function startCamera() {
    if (!pending) return; const generation = ++active.current; setBusy(true); setError(''); stop();
    try {
      const result = await api.post<{ challengeId: string; simulated: boolean }>('/export-verification/challenge', { scope: pending.scope });
      const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 }, audio: false });
      if (generation !== active.current) { media.getTracks().forEach(t => t.stop()); return; }
      stream.current = media; setChallenge(result);
      if (video.current) { video.current.srcObject = media; await video.current.play(); }
      setReady(true);
    } catch (e) { stop(); setError(e instanceof Error ? e.message : 'Camera unavailable. Export remains locked.'); } finally { setBusy(false); }
  }
  async function verify() {
    if (!pending || !challenge || !video.current || !ready) return; setBusy(true); setError('');
    try {
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
      canvas.getContext('2d')!.drawImage(video.current, 0, 0, 640, 480);
      const result = await api.post<{ token: string }>('/export-verification/verify', { challengeId: challenge.challengeId, image: canvas.toDataURL('image/jpeg', 0.75), demoOutcome: challenge.simulated ? (demo.face === 'VERIFIED' ? 'MATCH' : 'MISMATCH') : undefined });
      if (!pending.scope.startsWith('exam:')) await api.post('/export-verification/consume', { scope: pending.scope }, { exportVerification: result.token });
      await pending.action(result.token); stop(); setPending(null); setChallenge(null);
    } catch (e) { stop(); setChallenge(null); setError(e instanceof Error ? e.message : 'Verification failed. Export remains locked.'); } finally { setBusy(false); }
  }
  return {
    begin: (scope: string, action: (token: string) => Promise<void> | void) => { setError(''); setChallenge(null); setPending({ scope, action }); },
    dialog: <Modal open={Boolean(pending)} onClose={close} title="Verify your face to export" description="A fresh check is required for this download. Cancelling keeps the export locked.">
      <div className="space-y-4"><video ref={video} muted playsInline aria-label="Export verification camera" className="aspect-video w-full rounded-card bg-ink object-cover" />
        {challenge?.simulated && <Alert tone="warning" title="Demonstration comparison">The camera is real; identity comparison is simulated. Production exports require an enrolled identity and a server-side face and liveness provider.</Alert>}
        <p className="text-support text-muted">Look directly at the camera. The application does not retain this capture. A configured verification provider may process it under your organisation's retention policy.</p>
        {error && <Alert tone="critical" title="Export is locked">{error}</Alert>}
        <div className="flex flex-wrap justify-end gap-3"><Button onClick={close} disabled={busy}>Cancel</Button>
          {!ready ? <Button variant="primary" loading={busy} onClick={() => void startCamera()}>Enable camera</Button> : <Button variant="primary" loading={busy} onClick={() => void verify()}>Verify and export</Button>}
        </div>
      </div>
    </Modal>,
  };
}
