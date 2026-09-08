import { useState } from 'react';
import { useAnswerSaver, type PutAnswer } from '@/hooks/useAnswerSaver';
import { SaveIndicator } from '@/pages/candidate/ExamSessionScreen';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Feedback';

const OPTIONS = [
  { id: 'opt-a', label: 'A', text: 'An idempotency key' },
  { id: 'opt-b', label: 'B', text: 'A larger connection pool' },
];

/**
 * Minimal harness around the real answer-saving hook and the real save
 * indicator, so the tests exercise production code rather than a copy of it.
 */
export function AnswerHarness({ put, offline = false }: { put: PutAnswer; offline?: boolean }) {
  const [selected, setSelected] = useState<string[]>([]);

  const saver = useAnswerSaver({
    attemptId: 'attempt-1',
    assignmentQuestionId: 'aq-1',
    put,
    offline,
  });

  return (
    <div>
      <SaveIndicator state={saver.state} />

      <fieldset>
        <legend>Select one option</legend>
        {OPTIONS.map((option) => (
          <label key={option.id}>
            <input
              type="radio"
              name="answer"
              checked={selected.includes(option.id)}
              onChange={() => {
                setSelected([option.id]);
                void saver.save([option.id], false);
              }}
            />
            {option.text}
          </label>
        ))}
      </fieldset>

      {saver.state === 'RETRY' && saver.error ? (
        <Alert tone="warning" title="This answer has not reached the server yet">
          <p>{saver.error.guidance}</p>
          <Button size="sm" onClick={() => void saver.retry()}>
            Send it now
          </Button>
        </Alert>
      ) : null}

      {saver.state === 'CONFLICT' && saver.error ? (
        <Alert tone="warning" title="This answer was updated elsewhere">
          {saver.error.guidance}
        </Alert>
      ) : null}
    </div>
  );
}
