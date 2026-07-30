// The recurring builder — S1.6's "pick a weekly pattern with plain language".
//
// THE "STARTING __" DATE IS A COMPUTED, READ-ONLY DISPLAY. Not an input, and not an
// oversight:
//
//   `domain-modeling.md §5.3` (locked) gives a pattern exactly one stop condition,
//   `endDate`, and runs its loop over `[now, horizon]`; `data-model.md §5.2` has no
//   `start_date` column to hold anything else. A series begins when it is created.
//   A date picker here could therefore only be honoured by the create call — the
//   rolling sweep asks the database "which dates in range have no run?" and would
//   back-fill every skipped date on its next pass — so the picker would be a
//   promise the system breaks by itself, silently, hours later.
//
// The sentence instead tells staff which date "now" works out to, computed the same
// way `services/recurrence.ts` computes it, including the part that surprises
// people: a Tuesday rule saved on a Tuesday afternoon starts NEXT Tuesday, because
// materialization skips a window that has already begun.
//
// The form is used for both create and I24's pattern-level edit; the only
// difference is which call it makes and what the response has to report.

import { useState } from 'react';
import { Button, Card } from '../../../components/index.ts';
import { useSession, useToast } from '../../../app/index.ts';
import type { RouteDetail, UpdatePatternResponse } from '../../../api/shared.ts';
import { ChoiceList, DayPicker, TimeChoice, WeekdayChoice } from './controls.tsx';
import { createPattern, updatePattern } from './api.ts';
import {
  COPY,
  buildPatternCreate,
  buildPatternUpdate,
  duplicateNotice,
  failureMessage,
  minutesOfTime,
  monthOf,
  pantryClock,
  pantryToday,
  patternSentence,
  schedulableRoutes,
  timeOptions,
  toggleWeekday,
  validatePattern,
} from './logic.ts';
import type { PatternForm as PatternFormState } from './logic.ts';

const END_NONE = 'none';
const END_DATE = 'date';

export interface PatternFormProps {
  form: PatternFormState;
  onChange: (form: PatternFormState) => void;
  routes: readonly RouteDetail[];
  /** Reload the list once a repeating run lands. */
  onSaved: () => void;
}

export function PatternForm({ form, onChange, routes, onSaved }: PatternFormProps) {
  const { timezone } = useSession();
  const toast = useToast();
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // Both come from the PANTRY's clock (A120). The computed start date is only
  // right if "today" and "now" are the pantry's, which is the whole reason the
  // session carries the zone.
  const now = new Date();
  const today = pantryToday(now, timezone);
  const nowClock = pantryClock(now, timezone);

  const [month, setMonth] = useState(() => monthOf(form.endDate ?? today, { year: 2026, month: 1 }));

  const pickable = schedulableRoutes(routes);
  const times = timeOptions();
  const startTime = form.startTime;
  const laterTimes =
    startTime === null
      ? times
      : times.filter((time) => minutesOfTime(time) > minutesOfTime(startTime));

  const sentence = patternSentence(form, today, nowClock);
  const editing = form.patternId !== null;

  const save = async () => {
    const invalid = validatePattern(form);
    if (invalid !== null) {
      setProblem(invalid);
      return;
    }
    setSaving(true);
    setProblem(null);
    setNotice([]);
    try {
      if (form.patternId === null) {
        const body = buildPatternCreate(form);
        if (body === null) return;
        const result = await createPattern(body);
        toast.success(COPY.repeatCreated(result.materialized));
        const duplicate = duplicateNotice(result.duplicates);
        setNotice(duplicate === null ? [] : [duplicate]);
      } else {
        const body = buildPatternUpdate(form);
        if (body === null) return;
        const result = await updatePattern(form.patternId, body);
        toast.success(COPY.repeatUpdated);
        setNotice(editNotices(result));
      }
      onSaved();
    } catch (cause) {
      setProblem(failureMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card ariaLabel={editing ? COPY.repeatEditHeading : COPY.repeatHeading}>
      <h3 className="s16-heading">{editing ? COPY.repeatEditHeading : COPY.repeatHeading}</h3>

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
          onChange({ ...form, routeId });
        }}
        empty={COPY.routeEmptyBody}
      />

      <WeekdayChoice
        label={COPY.repeatWeekdays}
        value={form.weekdays}
        onToggle={(day) => {
          setProblem(null);
          onChange({ ...form, weekdays: toggleWeekday(form.weekdays, day) });
        }}
      />

      <TimeChoice
        label={COPY.publishStart}
        value={form.startTime}
        options={times}
        onSelect={(picked) => {
          setProblem(null);
          onChange({
            ...form,
            startTime: picked,
            endTime:
              form.endTime !== null && minutesOfTime(form.endTime) <= minutesOfTime(picked)
                ? null
                : form.endTime,
          });
        }}
      />

      <TimeChoice
        label={COPY.publishEnd}
        value={form.endTime}
        options={laterTimes}
        onSelect={(endTime) => {
          setProblem(null);
          onChange({ ...form, endTime });
        }}
      />

      {/* `endDate` is the ONLY stop condition (§5.3) — there is deliberately no
          active/paused switch that could disagree with it. */}
      <ChoiceList
        label={COPY.repeatEnds}
        items={[
          { id: END_NONE, label: COPY.repeatNoEnd },
          { id: END_DATE, label: COPY.repeatEndOn },
        ]}
        value={form.endDate === null ? END_NONE : END_DATE}
        onSelect={(choice) => {
          setProblem(null);
          onChange({ ...form, endDate: choice === END_NONE ? null : (form.endDate ?? today) });
        }}
      />

      {form.endDate !== null ? (
        <DayPicker
          label={COPY.repeatEndOn}
          month={month}
          onMonthChange={setMonth}
          from={form.endDate}
          earliest={today}
          onPick={(endDate) => {
            setProblem(null);
            onChange({ ...form, endDate });
          }}
        />
      ) : null}

      {/* Read-only by construction: a paragraph, not a control. */}
      {sentence !== null ? (
        <p className="s16-starting" aria-live="polite">
          <span className="s16-starting__label">{COPY.startingLabel}</span> {sentence}
        </p>
      ) : null}

      {problem ? (
        <p className="s16-problem" role="alert">
          {problem}
        </p>
      ) : null}

      {notice.length > 0 ? (
        <div className="s16-notice" role="status">
          {notice.map((line) => (
            <p key={line}>{line}</p>
          ))}
          <Button variant="secondary" onClick={() => setNotice([])}>
            Dismiss
          </Button>
        </div>
      ) : null}

      <Button variant="primary" loading={saving} onClick={() => void save()}>
        {COPY.repeatSave}
      </Button>
    </Card>
  );
}

/**
 * What a pattern edit did to runs that already existed. The server reports three
 * separate counts because they are three different facts, and staff has to be told
 * the last two: a run with a driver was NOT moved (moving it is cap 9 and needs that
 * driver's conflicts confirmed), and a run the edited rule no longer generates was
 * left on the board (§5.3 retracts nothing already materialized — ending part of a
 * series is the explicit cancel below).
 */
function editNotices(result: UpdatePatternResponse): string[] {
  const lines: string[] = [];
  if (result.moved > 0) lines.push(COPY.repeatMoved(result.moved));
  if (result.ownedInstances.length > 0) {
    lines.push(COPY.repeatOwned(result.ownedInstances.length));
  }
  if (result.offPatternInstances.length > 0) {
    lines.push(COPY.repeatOffPattern(result.offPatternInstances.length));
  }
  const duplicate = duplicateNotice(result.duplicates);
  if (duplicate !== null) lines.push(duplicate);
  return lines;
}
