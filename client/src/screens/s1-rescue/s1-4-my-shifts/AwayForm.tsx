// Declaring time away — S1.4's "pick a date range OR a time window within dates",
// and its one primary action.
//
// The refusal this form has to render well is I20's declaration gate
// (`domain-modeling.md §5.2`): a driver may not save a block over a run they own in
// CLAIMED or IN_PROGRESS. The server decides that, inside the transaction, and
// sends back the sentence S1.4 specifies — including the different one for a run
// already in progress, which I9 makes impossible to release. So the 409's message
// is shown verbatim rather than re-derived here; `failureMessage` is the whole of
// this screen's error policy.
//
// Nothing here converts a date to an instant. The pantry's zone decides where a
// day starts (state A55), and this form only assembles `YYYY-MM-DD` / `HH:MM`.

import { useState } from 'react';
import { Button } from '../../../components/index.ts';
import { useToast } from '../../../app/index.ts';
import { DayRangePicker } from './DayRangePicker.tsx';
import { declareTimeAway } from './data.ts';
import {
  COPY,
  EMPTY_FORM,
  buildDeclaration,
  failureMessage,
  formatTimeLabel,
  minutesOfTime,
  pickDay,
  summarySentence,
  timeOptions,
  validateForm,
} from './logic.ts';
import type { AwayForm as AwayFormState } from './logic.ts';

function TimeChoice({
  label,
  value,
  options,
  onSelect,
}: {
  label: string;
  value: string | null;
  options: readonly string[];
  onSelect: (time: string) => void;
}) {
  return (
    <fieldset className="s14-times">
      <legend className="s14-label">{label}</legend>
      <div className="s14-times__grid">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            className={`s14-time${option === value ? ' s14-time--active' : ''}`}
            aria-pressed={option === value}
            onClick={() => onSelect(option)}
          >
            {formatTimeLabel(option)}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export interface AwayFormProps {
  /** Reload the list once a declaration lands. */
  onSaved: () => void;
  now: Date;
}

export function AwayForm({ onSaved, now }: AwayFormProps) {
  const toast = useToast();
  const [form, setForm] = useState<AwayFormState>(EMPTY_FORM);
  const [month, setMonth] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 });
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const times = timeOptions();
  const startTime = form.startTime;
  // Only times later in the same day are offered as an end: a window is intra-day
  // (state A57), and §3 prefers hiding an option over showing one that is refused.
  const laterTimes =
    startTime === null
      ? times
      : times.filter((time) => minutesOfTime(time) > minutesOfTime(startTime));
  const summary = summarySentence(form, now);

  const setKind = (kind: AwayFormState['kind']) => {
    setProblem(null);
    setForm((current) =>
      kind === 'DATES'
        ? { ...current, kind, startTime: null, endTime: null }
        : { ...current, kind },
    );
  };

  const save = async () => {
    const invalid = validateForm(form);
    if (invalid !== null) {
      setProblem(invalid);
      return;
    }
    const request = buildDeclaration(form);
    if (request === null) return;

    setSaving(true);
    setProblem(null);
    try {
      await declareTimeAway(request);
      setForm(EMPTY_FORM);
      toast.success(COPY.saved);
      onSaved();
    } catch (cause) {
      // I20's declaration gate, in the server's own words — S1.4's two sentences
      // differ by whether the conflicting run can still be released, and only the
      // server knows which one applies.
      setProblem(failureMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="s14-form" aria-label="Mark time away">
      <h2 className="s14-heading">When are you away?</h2>

      <DayRangePicker
        form={form}
        month={month}
        now={now}
        onMonthChange={setMonth}
        onPick={(iso) => {
          setProblem(null);
          setForm((current) => pickDay(current, iso));
        }}
      />

      <fieldset className="s14-kind">
        <legend className="s14-label">How much of the day?</legend>
        <div className="s14-kind__row">
          <button
            type="button"
            className={`s14-choice${form.kind === 'DATES' ? ' s14-choice--active' : ''}`}
            aria-pressed={form.kind === 'DATES'}
            onClick={() => setKind('DATES')}
          >
            All day
          </button>
          <button
            type="button"
            className={`s14-choice${form.kind === 'WINDOW' ? ' s14-choice--active' : ''}`}
            aria-pressed={form.kind === 'WINDOW'}
            onClick={() => setKind('WINDOW')}
          >
            Part of the day
          </button>
        </div>
      </fieldset>

      {form.kind === 'WINDOW' ? (
        <>
          <TimeChoice
            label="From"
            value={form.startTime}
            options={times}
            onSelect={(time) => {
              setProblem(null);
              setForm((current) => ({
                ...current,
                startTime: time,
                // An end time that is no longer later in the day than the start
                // cannot stand: a window is intra-day (state A57), and leaving a
                // stale value would send the server a request it will refuse.
                endTime:
                  current.endTime !== null && minutesOfTime(current.endTime) <= minutesOfTime(time)
                    ? null
                    : current.endTime,
              }));
            }}
          />
          <TimeChoice
            label="Until"
            value={form.endTime}
            options={laterTimes}
            onSelect={(time) => {
              setProblem(null);
              setForm((current) => ({ ...current, endTime: time }));
            }}
          />
          <p className="s14-hint">
            The same hours on every day you picked. For an overnight absence, use All day.
          </p>
        </>
      ) : null}

      {summary ? <p className="s14-summary">{summary}</p> : null}
      {problem ? (
        <p className="s14-error" role="alert">
          {problem}
        </p>
      ) : null}

      <Button variant="primary" block loading={saving} onClick={() => void save()}>
        Save time away
      </Button>
    </section>
  );
}
