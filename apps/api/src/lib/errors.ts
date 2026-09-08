/**
 * Structured application errors.
 *
 * Every failure the candidate or staff member can see explains, in plain
 * language: what happened, whether answers are safe, and what to do next.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly guidance: string;
  readonly answersSafe: boolean;
  readonly details?: unknown;

  constructor(init: {
    statusCode: number;
    code: string;
    message: string;
    guidance: string;
    answersSafe?: boolean;
    details?: unknown;
  }) {
    super(init.message);
    this.name = 'AppError';
    this.statusCode = init.statusCode;
    this.code = init.code;
    this.guidance = init.guidance;
    this.answersSafe = init.answersSafe ?? true;
    this.details = init.details;
  }
}

export const Errors = {
  unauthenticated: () =>
    new AppError({
      statusCode: 401,
      code: 'UNAUTHENTICATED',
      message: 'You are not signed in, or your session has expired.',
      guidance: 'Sign in again. Any answers already saved on the server are unaffected.',
    }),

  forbidden: (what: string) =>
    new AppError({
      statusCode: 403,
      code: 'FORBIDDEN',
      message: `Your role does not permit this action: ${what}.`,
      guidance: 'Ask an administrator if you believe you should have access to this area.',
    }),

  notFound: (what: string) =>
    new AppError({
      statusCode: 404,
      code: 'NOT_FOUND',
      message: `${what} was not found.`,
      guidance: 'Check the link or return to the previous page.',
    }),

  validation: (details: unknown) =>
    new AppError({
      statusCode: 400,
      code: 'VALIDATION_FAILED',
      message: 'Some of the information supplied is not valid.',
      guidance: 'Correct the highlighted fields and try again.',
      details,
    }),

  conflict: (message: string, guidance: string, details?: unknown) =>
    new AppError({ statusCode: 409, code: 'CONFLICT', message, guidance, details }),

  answerConflict: (serverVersion: number) =>
    new AppError({
      statusCode: 409,
      code: 'ANSWER_VERSION_CONFLICT',
      message: 'This answer was updated by another request while you were editing it.',
      guidance:
        'Your previously saved answer is safe on the server. The latest saved value has been reloaded — check it and change it if needed.',
      answersSafe: true,
      details: { serverVersion },
    }),

  attemptFinalised: () =>
    new AppError({
      statusCode: 409,
      code: 'ATTEMPT_FINALISED',
      message: 'This examination has already been submitted and is locked.',
      guidance: 'No further changes can be made. Your submission receipt is available on the receipt page.',
      answersSafe: true,
    }),

  attemptNotActive: (status: string) =>
    new AppError({
      statusCode: 409,
      code: 'ATTEMPT_NOT_ACTIVE',
      message: `Your examination session is currently "${status}" and cannot accept answers.`,
      guidance:
        'Your saved answers are safe. Follow the on-screen verification steps, or raise your hand for the invigilator.',
      answersSafe: true,
    }),

  timeExpired: () =>
    new AppError({
      statusCode: 409,
      code: 'TIME_EXPIRED',
      message: 'The examination time for this attempt has ended.',
      guidance: 'All answers saved before the deadline have been kept and submitted automatically.',
      answersSafe: true,
    }),

  unauthorizedDevice: (deviceCode: string) =>
    new AppError({
      statusCode: 403,
      code: 'UNAUTHORIZED_DEVICE',
      message: `Workstation ${deviceCode} is not approved for this examination.`,
      guidance:
        'Do not continue on this machine. Inform the examination-centre operator, who can move you to an approved workstation.',
    }),

  unmanagedClient: () =>
    new AppError({
      statusCode: 403,
      code: 'UNMANAGED_CLIENT',
      message: 'This examination can only be taken in the managed examination application.',
      guidance:
        'A web browser cannot lock the workstation to the examination, so it is not accepted for this examination. Ask the examination-centre operator to start the installed examination application.',
    }),

  wrongWorkstation: (detail: string) =>
    new AppError({
      statusCode: 403,
      code: 'WRONG_WORKSTATION',
      message: detail,
      guidance:
        'Move to the workstation assigned to you, or raise your hand so an invigilator can release the seat assignment. Any answers already saved are safe.',
    }),

  paragraphTooLong: (words: number, limit: number) =>
    new AppError({
      statusCode: 400,
      code: 'ANSWER_TOO_LONG',
      message: `This answer is ${words} words. The limit for this question is ${limit}.`,
      guidance: 'Shorten the answer to within the limit. Everything you have written is still on screen.',
      answersSafe: true,
      details: { words, limit },
    }),

  unauthorizedNetwork: (address: string) =>
    new AppError({
      statusCode: 403,
      code: 'UNAUTHORIZED_NETWORK',
      message: `This workstation is connecting from ${address}, which is outside the approved examination network.`,
      guidance:
        'Connections are only accepted from approved examination-centre networks. Contact technical support at the centre.',
    }),

  paperIntegrity: (summary: string) =>
    new AppError({
      statusCode: 409,
      code: 'PAPER_INTEGRITY_FAILED',
      message: `The question paper failed its integrity check. ${summary}`,
      guidance:
        'Release has been blocked and the examination controller has been notified. No candidate has received the affected paper.',
    }),

  rateLimited: () =>
    new AppError({
      statusCode: 429,
      code: 'RATE_LIMITED',
      message: 'Too many requests were received from this workstation in a short period.',
      guidance: 'Wait a few seconds and try again. Saved answers are unaffected.',
    }),

  accountLocked: (minutes: number) =>
    new AppError({
      statusCode: 423,
      code: 'ACCOUNT_LOCKED',
      message: `This account is temporarily locked after repeated failed sign-in attempts.`,
      guidance: `Wait ${minutes} minute(s) and try again, or ask the examination-centre operator for help.`,
    }),

  badCredentials: () =>
    new AppError({
      statusCode: 401,
      code: 'INVALID_CREDENTIALS',
      message: 'The sign-in details supplied were not correct.',
      guidance: 'Check the application ID and password on your admit card, then try again.',
    }),

  demoDisabled: () =>
    new AppError({
      statusCode: 403,
      code: 'DEMO_DISABLED',
      message: 'Demonstration controls are disabled in this environment.',
      guidance: 'Demo Mode is available only in development builds.',
    }),

  internal: (traceId: string) =>
    new AppError({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      message: 'The service could not complete this request.',
      guidance:
        'Your saved answers are safe on the server. Try again shortly; if the problem continues, notify technical support with the reference below.',
      details: { traceId },
    }),
};
