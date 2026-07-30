// Publish one run — S1.6's "Publish shift: date/time, route".
//
// THREE FIELDS AND NO MORE, and the two that are missing are missing on purpose:
//
//   * No truck. The driver picks the truck when they start the run (S1.5), and I8
//     binds it there; staff choosing one at publish would contradict the domain and
//     would have to be un-chosen later.
//   * No driver. A shift exists independently of any driver (PRD cap 4) — it goes
//     up open and anyone eligible claims it from the board. Setting an owner is a
//     separate, later action with its own conflict warning (see `AssignDriver`).
//
// The form assembles pantry-local text — `YYYY-MM-DD` and `HH:MM` — and never an
// instant. The server converts once, against `app_config.timezone`.

import { useState } from 'react';
import { Button, Card, TextInput } from '../../../components/index.ts';
import { useToast } from '../../../app/index.ts';
import type { RouteDetail } from '../../../api/shared.ts';
import { ChoiceList, DayPicker, TimeChoice } from './controls.tsx';
import { publishRun } from './api.ts';
import {
  COPY,
  EMPTY_PUBLISH,
  buildPublish,
  duplicateNotice,
  failureMessage,
  minutesOfTime,
  monthOf,
  schedulableRoutes,
  timeOptions,
  validatePublish,
} from './logic.ts';
import type { PublishForm as PublishFormState } from './logic.ts';

export interface PublishFormProps {
  routes: readonly RouteDetail[];
  /** Today at the PANTRY (A120) — the earliest day this form offers. */
  today: string;
  /** Reload the runs list once one lands. */
  onPublished: () => void;
}

export function PublishForm({ routes, today, onPublished }: PublishFormProps) {
  const toast = useToast();
  const [form, setForm] = useState<PublishFormState>(EMPTY_PUBLISH);
  const [month, setMonth] = useState(() => monthOf(today, { year: 2026, month: 1 }));
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const pickable = schedulableRoutes(routes);
  const times = timeOptions();
  const startTime = form.startTime;
  // Only times later in the same day are offered as an end: the window is
  // intra-day (`ck_shift_window`), and §3 prefers hiding an option over showing
  // one the server would refuse.
  const laterTimes =
    startTime === null
      ? times
      : times.filter((time) => minutesOfTime(time) > minutesOfTime(startTime));

  const publish = async () => {
    const invalid = validatePublish(form);
    if (invalid !== null) {
      setProblem(invalid);
      return;
    }
    const body = buildPublish(form);
    if (body === null) return;

    setSaving(true);
    setProblem(null);
    try {
      const result = await publishRun(body);
      setForm(EMPTY_PUBLISH);
      toast.success(COPY.published);
      // The soft duplicate check (`data-model.md §5.3`): the run WAS published, so
      // this is a card that stays on screen rather than an error — §3 forbids a
      // toast being the only signal for something that mattered.
      setNotice(duplicateNotice(result.duplicates));
      onPublished();
    } catch (cause) {
      setProblem(failureMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card ariaLabel={COPY.publishHeading}>
      <h2 className="s16-heading">{COPY.publishHeading}</h2>
      <p className="s16-hint">{COPY.publishHint}</p>

      <ChoiceList
        label={COPY.publishRoute}
        items={pickable.map((route) => ({
          id: route.id,
          label: route.name,
          detail: COPY.stopCount(route.stops.length),
        }))}
        value={form.routeId}
        onSelect={(routeId) => {
          setProblem(null);
          setForm((current) => ({ ...current, routeId }));
        }}
        empty={COPY.routeEmptyBody}
      />

      <DayPicker
        label={COPY.publishDate}
        month={month}
        onMonthChange={setMonth}
        from={form.date}
        earliest={today}
        onPick={(date) => {
          setProblem(null);
          setForm((current) => ({ ...current, date }));
        }}
      />

      <TimeChoice
        label={COPY.publishStart}
        value={form.startTime}
        options={times}
        onSelect={(startTime) => {
          setProblem(null);
          setForm((current) => ({
            ...current,
            startTime,
            // An end that is no longer later in the day is dropped rather than
            // silently submitted and refused.
            endTime:
              current.endTime !== null &&
              minutesOfTime(current.endTime) <= minutesOfTime(startTime)
                ? null
                : current.endTime,
          }));
        }}
      />

      <TimeChoice
        label={COPY.publishEnd}
        value={form.endTime}
        options={laterTimes}
        onSelect={(endTime) => {
          setProblem(null);
          setForm((current) => ({ ...current, endTime }));
        }}
      />

      <TextInput
        label={COPY.publishNote}
        value={form.staffNote}
        multiline
        onChange={(staffNote) => setForm((current) => ({ ...current, staffNote }))}
      />

      {problem ? (
        <p className="s16-problem" role="alert">
          {problem}
        </p>
      ) : null}

      {notice ? (
        <div className="s16-notice" role="status">
          <p>{notice}</p>
          <Button variant="secondary" onClick={() => setNotice(null)}>
            Dismiss
          </Button>
        </div>
      ) : null}

      {/* The panel's one primary action (§1.1). */}
      <Button variant="primary" loading={saving} onClick={() => void publish()}>
        {COPY.publish}
      </Button>
    </Card>
  );
}
