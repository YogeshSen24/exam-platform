import type { ActivationPayload } from './types.js';

/**
 * Plain-language rendering of a key.
 *
 * A centre moderator pastes a key and must be able to see, before committing,
 * exactly what it is about to do to the machine in front of them. Everything
 * here is written for someone who has never read a specification.
 */

export interface KeySummaryLine {
  label: string;
  value: string;
  /** Drawn to the moderator's attention: it changes what candidates experience. */
  emphasis?: boolean;
}

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'not set';
  return date.toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function list(parts: string[]): string {
  if (parts.length === 0) return 'none';
  if (parts.length === 1) return parts[0] as string;
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** The headline: what this key sets up, in one sentence. */
export function summariseKey(payload: ActivationPayload): string {
  const where = [payload.labels.room, payload.labels.session].filter(Boolean).join(', ');
  return `This machine will run ${payload.exam.name} at ${payload.centre.name}${where ? ` (${where})` : ''}.`;
}

export function describeKey(payload: ActivationPayload): KeySummaryLine[] {
  const { rules } = payload;
  const lines: KeySummaryLine[] = [
    { label: 'Examination', value: `${payload.exam.name} (${payload.exam.code})`, emphasis: true },
    { label: 'Centre', value: `${payload.centre.name} (${payload.centre.code})` },
    { label: 'Examination opens', value: formatDateTime(payload.window.opensAt) },
    { label: 'Examination closes', value: formatDateTime(payload.window.closesAt) },
    { label: 'Time allowed', value: `${payload.window.durationMinutes} minutes per candidate` },
    { label: 'Key valid until', value: formatDateTime(payload.expiresAt) },
  ];

  if (payload.labels.room || payload.labels.session) {
    lines.push({
      label: 'Room and sitting',
      value: [payload.labels.room, payload.labels.session].filter(Boolean).join(' · '),
    });
  }

  const identityChecks: string[] = ['application ID and password'];
  if (rules.verification.fingerprint === 'REQUIRED') identityChecks.push('a fingerprint scan');
  else if (rules.verification.fingerprint === 'OPTIONAL') identityChecks.push('an optional fingerprint scan');
  if (rules.verification.faceAtLogin) identityChecks.push('a face check at sign-in');
  lines.push({ label: 'Candidates verify with', value: list(identityChecks), emphasis: true });

  const accessChecks = [
    rules.verification.registeredWorkstation ? 'an approved workstation certificate' : null,
    rules.verification.assignedWorkstation ? 'the candidate assigned workstation' : null,
    rules.verification.approvedNetwork ? 'an approved examination network' : null,
    rules.verification.managedClient ? 'the managed Windows application' : null,
  ].filter((item): item is string => Boolean(item));
  lines.push({
    label: 'Security checks',
    value: accessChecks.length > 0 ? list(accessChecks) : 'Password only; workstation and network checks are not enforced.',
    emphasis: accessChecks.length > 0,
  });

  lines.push({
    label: 'During the examination',
    value: rules.monitoring.cameraMonitoring
      ? `The camera stays on, checking every ${rules.monitoring.snapshotIntervalSeconds} seconds${
          rules.monitoring.multipleFaceDetection ? ', and reports if more than one face appears' : ''
        }.`
      : 'No camera monitoring.',
    emphasis: rules.monitoring.cameraMonitoring,
  });

  lines.push({
    label: 'Questions per candidate',
    value: `${rules.delivery.totalDelivered} questions worth ${rules.delivery.totalMarks} marks, drawn as ${list(
      rules.delivery.quotas.map((q) => `${q.deliver} from ${q.categoryName}`),
    )}.`,
    emphasis: true,
  });

  lines.push({
    label: 'Every candidate gets',
    value: `The same number of questions from each section, but a different selection${
      rules.delivery.randomizeQuestionOrder ? ' in a different order' : ''
    }${rules.delivery.randomizeOptionOrder ? ', with answer options shuffled too' : ''}.`,
  });

  if (rules.delivery.negativeMarking) {
    lines.push({ label: 'Marking', value: 'Negative marking is on. Wrong answers lose marks.', emphasis: true });
  }

  lines.push({
    label: 'This machine',
    value: list(
      [
        rules.station.trackStation ? 'is recorded against every attempt started on it' : null,
        rules.station.fullScreenExamShell ? 'runs the examination full screen' : null,
        rules.station.reportFocusLoss ? 'reports if the candidate switches away' : null,
      ].filter((v): v is string => v !== null),
    ),
  });

  lines.push({ label: 'Machines this key may set up', value: `Up to ${rules.station.maxStations}.` });

  const tags = Object.entries(payload.labels.tags);
  if (tags.length > 0) {
    lines.push({
      label: 'Recorded on every result',
      value: tags.map(([key, value]) => `${key}: ${value}`).join(' · '),
    });
  }

  if (payload.note.trim()) {
    lines.push({ label: 'Note from the board', value: payload.note.trim() });
  }

  return lines;
}

/**
 * The things a moderator should be warned about before they commit, phrased as
 * consequences rather than settings.
 */
export function activationWarnings(payload: ActivationPayload): string[] {
  const warnings: string[] = [];
  const { rules } = payload;

  if (rules.verification.fingerprint === 'REQUIRED') {
    warnings.push('A fingerprint reader must be attached to every machine, or candidates will not be able to start.');
  }
  if (rules.verification.faceAtLogin || rules.monitoring.cameraMonitoring) {
    warnings.push('A working camera is required on every machine.');
  }
  if (!rules.verification.registeredWorkstation) {
    warnings.push('Workstation registration is not enforced for this key. Use this only for a controlled demo or an approved exception.');
  }
  if (!rules.verification.approvedNetwork && rules.station.allowedCidrs.length > 0) {
    warnings.push('Network allowlisting is not enforced for candidates using this key.');
  }
  warnings.push(
    `Any machine this key is pasted into can run the examination, up to ${rules.station.maxStations}. Keep it inside the centre.`,
  );
  return warnings;
}
