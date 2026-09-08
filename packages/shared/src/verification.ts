import type { SecurityProfileId } from './securityProfiles.js';
import { profileFlags } from './securityProfiles.js';
import type { VerificationPolicy } from './types.js';

/**
 * Verification policy defaults and resolution.
 *
 * A security profile *suggests* a verification posture. The examination's own
 * policy *decides* it. Selecting Maximum Assurance turns biometrics on by
 * default because that is what the profile implies — but an administrator can
 * switch either check off entirely without abandoning the network, device and
 * publication controls the profile also brings.
 *
 * This matters practically: a centre with no fingerprint scanners, or a cohort
 * with an accessibility exception, should not be forced to choose between "no
 * biometrics" and "no device certificates".
 */

export function defaultVerificationPolicy(profileId: SecurityProfileId): VerificationPolicy {
  const flags = profileFlags(profileId);

  return {
    passwordRequired: true,

    fingerprint: {
      enabled: flags.fingerprintVerification !== 'off',
      requirement: flags.fingerprintVerification === 'required' ? 'REQUIRED' : 'OPTIONAL',
      allowInvigilatorOverride: true,
      skipIfNotEnrolled: true,
    },

    face: {
      enabled: flags.requireFaceVerificationAtLogin,
      // Face is a strong signal but a fallible one; a human review path is
      // always available rather than blocking a legitimate candidate.
      requirement: 'OPTIONAL',
      allowInvigilatorOverride: true,
      skipIfNotEnrolled: true,
      compareToEnrolment: true,
    },

    requireAssignedDevice: flags.bindAttemptToDevice,
    requireAssignedNetwork: flags.ipAllowlist,
    autoDetectDevice: flags.requireRegisteredDevice,
    // Only the highest profile insists on the managed Windows application.
    requireNativeClient: profileId === 'MAXIMUM_ASSURANCE',
  };
}

/** A policy with every optional identity check switched off. */
export function minimalVerificationPolicy(): VerificationPolicy {
  return {
    passwordRequired: true,
    fingerprint: { enabled: false, requirement: 'OPTIONAL', allowInvigilatorOverride: true, skipIfNotEnrolled: true },
    face: {
      enabled: false,
      requirement: 'OPTIONAL',
      allowInvigilatorOverride: true,
      skipIfNotEnrolled: true,
      compareToEnrolment: false,
    },
    requireAssignedDevice: false,
    requireAssignedNetwork: false,
    autoDetectDevice: false,
    requireNativeClient: false,
  };
}

export interface VerificationStep {
  key: 'password' | 'fingerprint' | 'face' | 'device' | 'network' | 'client';
  label: string;
  enabled: boolean;
  blocking: boolean;
  explanation: string;
  simulated: boolean;
}

/** The steps a candidate will actually see, in the order they happen. */
export function verificationSteps(policy: VerificationPolicy): VerificationStep[] {
  return [
    {
      key: 'password',
      label: 'Application ID and password',
      enabled: true,
      blocking: true,
      explanation: 'The candidate signs in with the details printed on their admit card.',
      simulated: false,
    },
    {
      key: 'client',
      label: 'Managed examination application',
      enabled: policy.requireNativeClient,
      blocking: true,
      explanation:
        'Only the managed Windows examination application may start an attempt. A web browser cannot enforce operating-system lockdown, so it is refused.',
      simulated: false,
    },
    {
      key: 'device',
      label: 'Assigned workstation',
      enabled: policy.requireAssignedDevice,
      blocking: true,
      explanation: policy.autoDetectDevice
        ? 'The workstation is identified from its own hardware and checked against the seat assigned to this candidate.'
        : 'The workstation identifier is checked against the seat assigned to this candidate.',
      simulated: false,
    },
    {
      key: 'network',
      label: 'Approved network',
      enabled: policy.requireAssignedNetwork,
      blocking: true,
      explanation: 'The connection must come from a network range approved for this candidate’s centre.',
      simulated: false,
    },
    {
      key: 'fingerprint',
      label: 'Fingerprint verification',
      enabled: policy.fingerprint.enabled,
      blocking: policy.fingerprint.requirement === 'REQUIRED' && !policy.fingerprint.allowInvigilatorOverride,
      explanation:
        policy.fingerprint.requirement === 'REQUIRED'
          ? 'The candidate must present the fingerprint enrolled on their record.'
          : 'The candidate is asked for a fingerprint, but a failure raises a warning rather than blocking entry.',
      simulated: true,
    },
    {
      key: 'face',
      label: 'Facial verification',
      enabled: policy.face.enabled,
      blocking: policy.face.requirement === 'REQUIRED' && !policy.face.allowInvigilatorOverride,
      explanation: policy.face.compareToEnrolment
        ? 'A photograph taken at sign-in is compared with the enrolment photograph on the candidate record.'
        : 'A photograph taken at sign-in confirms a candidate is present, without comparing it to an enrolment image.',
      simulated: true,
    },
  ];
}

export function enabledVerificationSteps(policy: VerificationPolicy): VerificationStep[] {
  return verificationSteps(policy).filter((step) => step.enabled);
}

/** A short sentence describing the posture, for lists and summaries. */
export function describeVerification(policy: VerificationPolicy): string {
  const parts: string[] = ['application ID and password'];
  if (policy.fingerprint.enabled) {
    parts.push(`fingerprint (${policy.fingerprint.requirement.toLowerCase()})`);
  }
  if (policy.face.enabled) parts.push(`face (${policy.face.requirement.toLowerCase()})`);
  if (policy.requireAssignedDevice) parts.push('assigned workstation');
  if (policy.requireAssignedNetwork) parts.push('approved network');
  if (policy.requireNativeClient) parts.push('managed Windows application');

  const last = parts.pop();
  return parts.length > 0 ? `${parts.join(', ')} and ${last}` : (last ?? 'password only');
}
