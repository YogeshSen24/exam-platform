/**
 * Device security abstraction.
 *
 * The browser proof of concept CANNOT enforce operating-system lockdown. It
 * implements this interface with honest, clearly-labelled simulations so that a
 * future native Windows shell can supply a real implementation — Windows kiosk
 * mode / Assigned Access, device certificates, TPM-backed keys, camera and
 * fingerprint-scanner access, application health reporting and attestation —
 * without any change to the screens that consume it.
 */

export type CapabilitySupport = 'REAL' | 'SIMULATED' | 'UNAVAILABLE';

export interface DeviceIdentity {
  workstationCode: string;
  certificateThumbprint: string | null;
  certificateStatus: 'VALID' | 'EXPIRING' | 'EXPIRED' | 'REVOKED' | 'UNKNOWN';
  kioskPolicyVersion: string | null;
}

export interface DeviceHealth {
  secureBoot: CapabilitySupport;
  diskEncryption: CapabilitySupport;
  kioskMode: CapabilitySupport;
  applicationSignature: CapabilitySupport;
  attestation: CapabilitySupport;
  camera: CapabilitySupport;
  fingerprintScanner: CapabilitySupport;
}

export type FingerprintOutcome = 'MATCH' | 'LOW_QUALITY' | 'MISMATCH' | 'SCANNER_UNAVAILABLE';

export interface FingerprintResult {
  outcome: FingerprintOutcome;
  quality: number;
  /** Simulated reference identifier. A raw fingerprint is never handled here. */
  referenceId: string | null;
  simulated: true;
  message: string;
}

export interface CameraFrame {
  /** Data URL of a low-resolution still, or null when the camera is simulated. */
  dataUrl: string | null;
  width: number;
  height: number;
  approximateBytes: number;
  capturedAt: string;
}

export interface DeviceSecurityProvider {
  readonly kind: 'browser-simulation' | 'windows-native';
  readonly canEnforceOsLockdown: boolean;
  readonly disclosure: string;

  identity(): DeviceIdentity;
  health(): DeviceHealth;

  /** Enters the closest thing this platform offers to kiosk mode. */
  enterKioskMode(): Promise<{ entered: boolean; note: string }>;
  exitKioskMode(): Promise<void>;

  requestCamera(): Promise<{ granted: boolean; reason?: string }>;
  captureFrame(): Promise<CameraFrame>;
  releaseCamera(): void;

  scanFingerprint(scripted?: FingerprintOutcome): Promise<FingerprintResult>;

  reportHealth(payload: Record<string, unknown>): Promise<void>;
}

/* ------------------------------------------------------------------ */
/* Browser implementation                                              */
/* ------------------------------------------------------------------ */

export class BrowserDeviceSecurityProvider implements DeviceSecurityProvider {
  readonly kind = 'browser-simulation' as const;
  readonly canEnforceOsLockdown = false;
  readonly disclosure =
    'This proof of concept runs in a web browser. It cannot enforce operating-system lockdown, read a TPM-backed key, or attest the state of the machine. Secure boot, disk encryption, kiosk policy, application signature and device attestation are shown as simulated values. A production deployment replaces this component with a native Windows shell.';

  #stream: MediaStream | null = null;
  #video: HTMLVideoElement | null = null;
  #identity: DeviceIdentity = {
    workstationCode: '',
    certificateThumbprint: null,
    certificateStatus: 'UNKNOWN',
    kioskPolicyVersion: null,
  };

  setIdentity(identity: Partial<DeviceIdentity>) {
    this.#identity = { ...this.#identity, ...identity };
  }

  identity(): DeviceIdentity {
    return this.#identity;
  }

  health(): DeviceHealth {
    return {
      secureBoot: 'SIMULATED',
      diskEncryption: 'SIMULATED',
      kioskMode: 'SIMULATED',
      applicationSignature: 'SIMULATED',
      attestation: 'SIMULATED',
      camera: typeof navigator !== 'undefined' && navigator.mediaDevices ? 'REAL' : 'UNAVAILABLE',
      fingerprintScanner: 'SIMULATED',
    };
  }

  async enterKioskMode(): Promise<{ entered: boolean; note: string }> {
    // Full-screen is the closest a browser gets. It is a presentation aid, not
    // a security control, and the interface says so.
    try {
      if (document.fullscreenElement) return { entered: true, note: 'Already in full screen.' };
      await document.documentElement.requestFullscreen?.();
      return {
        entered: Boolean(document.fullscreenElement),
        note: 'Full-screen presentation mode. This simulates the kiosk experience and does not lock the operating system.',
      };
    } catch {
      return {
        entered: false,
        note: 'Full screen was not permitted by the browser. The examination continues normally.',
      };
    }
  }

  async exitKioskMode(): Promise<void> {
    if (document.fullscreenElement) await document.exitFullscreen?.().catch(() => undefined);
  }

  async requestCamera(): Promise<{ granted: boolean; reason?: string }> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      return { granted: false, reason: 'This browser does not provide camera access.' };
    }
    try {
      this.#stream = await navigator.mediaDevices.getUserMedia({
        // Low resolution on purpose: presence checking needs no more than this,
        // and it keeps bandwidth, storage and privacy impact down.
        video: { width: { ideal: 320 }, height: { ideal: 240 }, facingMode: 'user' },
        audio: false,
      });
      const video = document.createElement('video');
      video.srcObject = this.#stream;
      video.muted = true;
      video.playsInline = true;
      await video.play().catch(() => undefined);
      this.#video = video;
      return { granted: true };
    } catch (error) {
      const name = (error as DOMException)?.name;
      return {
        granted: false,
        reason:
          name === 'NotAllowedError'
            ? 'Camera permission was declined.'
            : name === 'NotFoundError'
              ? 'No camera was found on this workstation.'
              : 'The camera could not be started.',
      };
    }
  }

  get stream(): MediaStream | null {
    return this.#stream;
  }

  async captureFrame(): Promise<CameraFrame> {
    const capturedAt = new Date().toISOString();
    if (!this.#video || !this.#stream) {
      // Polished simulation mode when no camera is available.
      return { dataUrl: null, width: 320, height: 240, approximateBytes: 38_400, capturedAt };
    }
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 240;
    const context = canvas.getContext('2d');
    if (!context) return { dataUrl: null, width: 320, height: 240, approximateBytes: 38_400, capturedAt };
    context.drawImage(this.#video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.5);
    return {
      dataUrl,
      width: canvas.width,
      height: canvas.height,
      approximateBytes: Math.round((dataUrl.length * 3) / 4),
      capturedAt,
    };
  }

  releaseCamera(): void {
    this.#stream?.getTracks().forEach((track) => track.stop());
    this.#stream = null;
    this.#video = null;
  }

  async scanFingerprint(scripted: FingerprintOutcome = 'MATCH'): Promise<FingerprintResult> {
    // A browser cannot read a fingerprint sensor, and this POC never handles
    // raw biometric data. The scanner is represented by scripted outcomes.
    await new Promise((resolve) => setTimeout(resolve, 900));
    const messages: Record<FingerprintOutcome, string> = {
      MATCH: 'Fingerprint matched the enrolled reference for this candidate.',
      LOW_QUALITY: 'The scan quality was too low to compare. Clean the sensor and place the finger flat.',
      MISMATCH: 'The fingerprint did not match the enrolled reference. An invigilator must verify identity in person.',
      SCANNER_UNAVAILABLE: 'The fingerprint scanner did not respond. Ask the centre operator for assistance.',
    };
    return {
      outcome: scripted,
      quality: scripted === 'MATCH' ? 0.94 : scripted === 'LOW_QUALITY' ? 0.31 : 0.62,
      referenceId: scripted === 'MATCH' ? 'bio-ref-simulated' : null,
      simulated: true,
      message: messages[scripted],
    };
  }

  async reportHealth(): Promise<void> {
    // A native shell would post attested health telemetry here.
  }
}

/* ------------------------------------------------------------------ */

let provider: BrowserDeviceSecurityProvider | null = null;

export function deviceSecurity(): BrowserDeviceSecurityProvider {
  if (!provider) provider = new BrowserDeviceSecurityProvider();
  return provider;
}
