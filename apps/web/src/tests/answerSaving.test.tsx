import { useAnswerSaver } from '@/hooks/useAnswerSaver';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '@/lib/api';
import { renderWithProviders } from './utils';
import { AnswerHarness } from './harness/AnswerHarness';

/**
 * Candidate answer saving.
 *
 * Covers the behaviour a candidate actually depends on: a selection is sent
 * immediately, a failure is shown honestly with the reassurance that answers
 * are safe, and a retry reuses the same idempotency key so nothing is recorded
 * twice.
 */
describe('candidate answer saving', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('sends the answer as soon as an option is selected and confirms it was saved', async () => {
    const put = vi.fn().mockResolvedValue({
      answer: { version: 1, selectedOptionIds: ['opt-a'], flagged: false },
      outcome: 'COMMITTED',
      committedAt: new Date().toISOString(),
    });

    renderWithProviders(<AnswerHarness put={put} />);
    await userEvent.click(screen.getByRole('radio', { name: /An idempotency key/i }));

    await waitFor(() => expect(screen.getByText('Saved to the server')).toBeInTheDocument());
    expect(put).toHaveBeenCalledTimes(1);

    const [, body, extra] = put.mock.calls[0]!;
    expect(body.selectedOptionIds).toEqual(['opt-a']);
    // Optimistic concurrency: the write states the version it expects.
    expect(body.expectedVersion).toBe(0);
    // Idempotency: every write carries a key.
    expect(extra.idempotencyKey).toBeTruthy();
  });

  it('shows an honest retry state when the save fails, and keeps the answer visible', async () => {
    const put = vi.fn().mockRejectedValue(
      new ApiError(0, {
        code: 'NETWORK_UNAVAILABLE',
        message: 'The examination service could not be reached.',
        guidance: 'It is stored on this workstation and will be sent again automatically.',
        answersSafe: true,
        traceId: 'test',
      }),
    );

    renderWithProviders(<AnswerHarness put={put} />);
    await userEvent.click(screen.getByRole('radio', { name: /An idempotency key/i }));

    await waitFor(() => expect(screen.getByText('Retry required')).toBeInTheDocument());
    expect(screen.getByText(/stored on this workstation/i)).toBeInTheDocument();
    // The candidate's selection is not thrown away by a failed save.
    expect(screen.getByRole('radio', { name: /An idempotency key/i })).toBeChecked();
  });

  it('reuses the same idempotency key when the candidate retries', async () => {
    const put = vi
      .fn()
      .mockRejectedValueOnce(
        new ApiError(0, {
          code: 'NETWORK_UNAVAILABLE',
          message: 'The examination service could not be reached.',
          guidance: 'Stored locally.',
          answersSafe: true,
          traceId: 'test',
        }),
      )
      .mockResolvedValueOnce({
        answer: { version: 1, selectedOptionIds: ['opt-a'], flagged: false },
        outcome: 'COMMITTED',
        committedAt: new Date().toISOString(),
      });

    renderWithProviders(<AnswerHarness put={put} />);
    await userEvent.click(screen.getByRole('radio', { name: /An idempotency key/i }));
    await waitFor(() => expect(screen.getByText('Retry required')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /send it now/i }));
    await waitFor(() => expect(screen.getByText('Reconnected and saved')).toBeInTheDocument());

    expect(put).toHaveBeenCalledTimes(2);
    const firstKey = put.mock.calls[0]![2].idempotencyKey;
    const secondKey = put.mock.calls[1]![2].idempotencyKey;
    expect(secondKey).toBe(firstKey);
  });

  it('reports a version conflict without claiming answers were lost', async () => {
    const put = vi.fn().mockRejectedValue(
      new ApiError(409, {
        code: 'ANSWER_VERSION_CONFLICT',
        message: 'This answer was updated by another request while you were editing it.',
        guidance: 'Your previously saved answer is safe on the server.',
        answersSafe: true,
        details: { serverVersion: 3 },
        traceId: 'test',
      }),
    );

    renderWithProviders(<AnswerHarness put={put} />);
    await userEvent.click(screen.getByRole('radio', { name: /An idempotency key/i }));

    await waitFor(() => expect(screen.getByText('Answer reloaded')).toBeInTheDocument());
    expect(screen.getByText(/safe on the server/i)).toBeInTheDocument();
  });
});

it('preserves paragraph text through an offline retry', async () => {
  const put = vi.fn().mockResolvedValue({ answer: { version: 1, selectedOptionIds: [], flagged: true }, outcome: 'COMMITTED', committedAt: new Date().toISOString() });
  const { result, rerender } = renderHook(({ offline }) => useAnswerSaver({ attemptId: 'written-attempt', assignmentQuestionId: 'written-question', put, offline }), { initialProps: { offline: true } });
  await act(async () => { await result.current.save([], true, 'A transaction commits all answer changes together.'); });
  expect(put).not.toHaveBeenCalled();
  rerender({ offline: false });
  await waitFor(() => expect(put).toHaveBeenCalled());
  expect(put.mock.calls[0]?.[1]).toMatchObject({ textAnswer: 'A transaction commits all answer changes together.', flagged: true, expectedVersion: 0 });
});
