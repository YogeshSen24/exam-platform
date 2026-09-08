import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FailureState, OfflineBanner } from '@/components/ui/Feedback';
import { CheckBadge } from '@/components/ui/Status';
import { renderWithProviders } from './utils';

/**
 * Warning and reverification presentation.
 *
 * Every failure state in this product must answer the same four questions.
 * These tests hold that contract, because it is the difference between a
 * candidate who panics and one who knows their work is safe.
 */
describe('failure and warning states', () => {
  it('always answers what happened, whether answers are safe, what to do and whether staff know', () => {
    renderWithProviders(
      <FailureState
        title="Question navigation is paused"
        whatHappened="Three consecutive presence checks did not detect you."
        answersSafe
        whatToDo="Face the camera and take a new photograph, or raise your hand."
        invigilatorNotified
      />,
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('What happened')).toBeInTheDocument();
    expect(screen.getByText('Are your answers safe?')).toBeInTheDocument();
    expect(screen.getByText('What to do next')).toBeInTheDocument();
    expect(screen.getByText('Has an invigilator been notified?')).toBeInTheDocument();

    expect(screen.getByText(/Every answer the server has acknowledged is stored/i)).toBeInTheDocument();
    expect(screen.getByText(/An invigilator has been alerted/i)).toBeInTheDocument();
  });

  it('says plainly when an invigilator has not been notified', () => {
    renderWithProviders(
      <FailureState
        title="This workstation is not approved"
        whatHappened="Workstation LAPTOP-UNKNOWN is not registered with this centre."
        answersSafe
        whatToDo="Do not continue on this machine."
        invigilatorNotified={false}
      />,
    );
    expect(screen.getByText(/Raise your hand if you need an invigilator/i)).toBeInTheDocument();
  });

  it('warns honestly when recent answers may not have reached the server', () => {
    renderWithProviders(
      <FailureState
        title="Saving failed"
        whatHappened="The last save could not be sent."
        answersSafe={false}
        whatToDo="Follow the steps below."
        invigilatorNotified={false}
      />,
    );
    expect(screen.getByText(/may not have reached the server/i)).toBeInTheDocument();
  });

  it('reassures the candidate while offline instead of alarming them', () => {
    renderWithProviders(<OfflineBanner reconnecting />);
    expect(screen.getByText('Reconnecting to the examination service')).toBeInTheDocument();
    expect(screen.getByText(/nothing you have entered will be lost/i)).toBeInTheDocument();
  });

  it('never signals a check result by colour alone', () => {
    renderWithProviders(
      <div>
        <CheckBadge state="PASSED" />
        <CheckBadge state="WARNING" />
        <CheckBadge state="FAILED" />
        <CheckBadge state="SKIPPED" />
      </div>,
    );
    // Each state carries a readable text label alongside its icon and colour.
    expect(screen.getByText('Passed')).toBeInTheDocument();
    expect(screen.getByText('Warning')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText('Not required')).toBeInTheDocument();
  });

  it('offers a recovery action the candidate can actually take', async () => {
    let retried = false;
    renderWithProviders(
      <FailureState
        title="Could not load the question"
        whatHappened="The connection dropped."
        answersSafe
        whatToDo="Try again."
        invigilatorNotified={false}
        actions={
          <button type="button" onClick={() => { retried = true; }}>
            Try again
          </button>
        }
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(retried).toBe(true);
  });
});
