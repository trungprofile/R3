// S1.8 Donors / Trucks / Categories — one panel, three configs.
//
// The three are the same screen because `domain-modeling.md §3.3` gives all three
// the same single lifecycle toggle and the wire carries the same `active` bit for
// each. Building three near-copies would mean three places to keep I21's removal
// wording honest, and this screen is the one that has to say it right.
//
// I21, twice over and they are NOT the same action:
//   - the status control ("In use" ⇄ "Archived"/"Inactive"/"Deactivated") is an
//     ORDINARY FIELD EDIT, which I21 always allows.
//   - Remove is the removal, and the DOMAIN decides whether it archives or
//     destroys. The confirm names the consequence without predicting the branch,
//     and the sentence afterwards reports the server's own answer. One button,
//     never two.

import { useCallback, useState } from 'react';
import {
  BackLink,
  Button,
  ConfirmModal,
  EmptyState,
  ErrorBlock,
  List,
  ListItem,
  ListRow,
  Segmented,
  SkeletonRows,
  TextInput,
} from '../../../components/index.ts';
import { useAsyncData, useToast } from '../../../app/index.ts';
import {
  COPY,
  EMPTY_MASTER_CONTEXT,
  emptyMasterValues,
  fieldKind,
  hintForField,
  inactiveLabel,
  isValid,
  removalText,
  statusChoices,
  validateMaster,
  writeFailureText,
  type FieldErrors,
  type MasterContext,
  type MasterRecordView,
} from './logic.ts';
import type { MasterConfig } from './masters.ts';
import { ChoiceField, FieldGroup, ImageField, InactiveChip } from './parts.tsx';

type View =
  | { kind: 'list' }
  | { kind: 'create' }
  | { kind: 'edit'; record: MasterRecordView };

export function MasterPanel({ config }: { config: MasterConfig }) {
  const toast = useToast();
  // Keyed on the config so switching tabs re-loads rather than showing the last
  // list under the new heading.
  const load = useCallback((signal: AbortSignal) => config.load(signal), [config]);
  const state = useAsyncData(load);

  /**
   * Whatever the FIELDS need that is not a record (D40).
   *
   * Only the Categories config has any: the food bank's category list, which the
   * `choice` field offers as options. Loaded beside the records rather than with
   * them because it is a different resource on a different route, and a config
   * with no choice field fetches nothing at all.
   */
  const loadContext = useCallback(
    async (signal: AbortSignal): Promise<MasterContext> =>
      config.loadContext ? config.loadContext(signal) : EMPTY_MASTER_CONTEXT,
    [config],
  );
  const contextState = useAsyncData(loadContext);
  const context = contextState.data ?? EMPTY_MASTER_CONTEXT;

  const [view, setView] = useState<View>({ kind: 'list' });
  const [values, setValues] = useState<Record<string, string>>(() =>
    emptyMasterValues(config.fields),
  );
  const [active, setActive] = useState(true);
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<MasterRecordView | null>(null);

  const errors: FieldErrors = validateMaster(config.fields, values);
  const shown = attempted ? errors : {};

  const openList = () => {
    setView({ kind: 'list' });
    setFailure(null);
    setAttempted(false);
  };

  const openCreate = () => {
    setValues(emptyMasterValues(config.fields));
    setActive(true);
    setAttempted(false);
    setFailure(null);
    setView({ kind: 'create' });
  };

  const openEdit = (record: MasterRecordView) => {
    setValues({ ...emptyMasterValues(config.fields), ...record.values });
    setActive(record.active);
    setAttempted(false);
    setFailure(null);
    setView({ kind: 'edit', record });
  };

  const submit = async () => {
    setAttempted(true);
    if (!isValid(errors)) return;
    setBusy(true);
    setFailure(null);
    try {
      if (view.kind === 'create') {
        await config.create(values);
      } else if (view.kind === 'edit') {
        // The whole record, not its id: a photo is not part of the record's JSON,
        // so only a comparison with what was loaded says whether it changed (D20).
        await config.save(view.record, values, active);
      }
      // Categories say something more than "Saved." (D40): an unmatched one will
      // hold the report up while it carries weight, and that is a consequence to
      // hear when it is chosen rather than to discover on S3.1 a week later.
      toast.success(config.savedText?.(values, context) ?? COPY.master.saved);
      openList();
      state.reload();
      // The food bank list carries a "how many of ours report under this" count
      // (I21's delete/archive hint), and a matching change moves it.
      contextState.reload();
    } catch (cause) {
      setFailure(writeFailureText(cause));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (record: MasterRecordView) => {
    setBusy(true);
    setFailure(null);
    try {
      const outcome = await config.remove(record.id);
      setConfirming(null);
      // I21 — which of the two happened is the server's answer, reported here.
      toast.success(removalText(config.entity, record.title, outcome));
      openList();
      state.reload();
    } catch (cause) {
      setConfirming(null);
      setFailure(writeFailureText(cause));
    } finally {
      setBusy(false);
    }
  };

  const confirm =
    confirming !== null ? (
      <ConfirmModal
        question={`Remove ${confirming.title}?`}
        consequence={COPY.confirm.consequence}
        confirmLabel={COPY.confirm.label}
        busy={busy}
        onConfirm={() => void remove(confirming)}
        onCancel={() => setConfirming(null)}
      />
    ) : null;

  if (view.kind !== 'list') {
    const editing = view.kind === 'edit' ? view.record : null;
    return (
      <>
        {/* §3's one way out of a screen, at the top where a person looks for it.
            The label is the destination, in the user's words ("Donors"), not a
            sentence — the chevron already says "back" (D21). */}
        <BackLink label={config.heading} onBack={openList} />
        <form
          className="s18-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <h2 className="s18-subheading">
            {view.kind === 'create' ? config.createTitle : config.editTitle}
          </h2>

          {config.fields.map((field) => {
            const value = values[field.key] ?? '';
            // The hint may depend on what is typed: D27's rate fields say what a
            // BLANK one will fall back to, which a blank control cannot show.
            const hint = hintForField(field, value);
            return (
              <div className="s18-field" key={field.key}>
                {/* A heading and one sentence over a group of fields, set on the
                    group's first field. D27's three rates need saying once, not
                    three times: what the number does is the same sentence for
                    all three, and repeating it would be the D21 cut all over. */}
                {field.section !== undefined ? (
                  <div className="s18-section">
                    <h3 className="s18-section__title">{field.section.title}</h3>
                    <p className="s18-section__body">{field.section.body}</p>
                  </div>
                ) : null}

                {/* One control per FIELD KIND, not one panel per entity (D20).
                    Donors are still this panel with a different config. */}
                {fieldKind(field) === 'choice' ? (
                  /* D40 — where this category reports. §1.5 rules out a dropdown
                     where a visible column of big targets fits, and the food bank's
                     list is short by construction (D26 seeds ten). A radio group
                     rather than a `<select>` for exactly that reason, and because
                     the "leave it unmatched" option has to be as visible as the
                     rest: it is a real answer, not the absence of one. */
                  <ChoiceField
                    label={field.label}
                    hint={hint}
                    value={value}
                    options={field.options?.(context) ?? []}
                    onChange={(next) => setValues({ ...values, [field.key]: next })}
                    disabled={busy}
                  />
                ) : fieldKind(field) === 'image' ? (
                  <ImageField
                    label={field.label}
                    hint={hint}
                    value={value}
                    onChange={(next) => setValues({ ...values, [field.key]: next })}
                    disabled={busy}
                  />
                ) : (
                  <TextInput
                    label={field.label}
                    value={value}
                    onChange={(next) => setValues({ ...values, [field.key]: next })}
                    disabled={busy}
                    autoComplete="off"
                    {...(field.multiline === true ? { multiline: true } : {})}
                    {...(hint !== undefined ? { hint } : {})}
                    {...(shown[field.key] !== undefined ? { error: shown[field.key] } : {})}
                  />
                )}
              </div>
            );
          })}

          {/* §3.3's ACTIVE ⇄ inactive toggle. Only on edit: a record is created in
              use, and offering the choice up front would be a question with one
              sensible answer. */}
          {editing !== null ? (
            <FieldGroup label={COPY.master.status}>
              <Segmented
                label={COPY.master.status}
                options={statusChoices(config.entity)}
                value={active ? 'active' : 'inactive'}
                onChange={(next) => setActive(next === 'active')}
              />
            </FieldGroup>
          ) : null}

          {failure !== null ? (
            <p className="s18-error" role="alert">
              {failure}
            </p>
          ) : null}

          <div className="s18-actions">
            {/* S1.8: "Primary action varies per sub-screen (Save)." The way out is
                the BackLink above, not a second button here (D21). */}
            <Button variant="primary" type="submit" loading={busy}>
              {view.kind === 'create' ? COPY.master.create : COPY.master.save}
            </Button>
          </div>

          {editing !== null ? (
            <div className="s18-danger-zone">
              <Button variant="danger" onClick={() => setConfirming(editing)} disabled={busy}>
                {COPY.master.remove}
              </Button>
            </div>
          ) : null}
        </form>
        {confirm}
      </>
    );
  }

  return (
    <>
      <div className="s18-list-head">
        <h2 className="s18-subheading">{config.heading}</h2>
        <Button variant="primary" onClick={openCreate}>
          {config.addLabel}
        </Button>
      </div>

      {failure !== null ? (
        <p className="s18-error" role="alert">
          {failure}
        </p>
      ) : null}

      {state.error !== null ? <ErrorBlock error={state.error} onRetry={state.reload} /> : null}

      {state.data === null ? (
        // Nothing at all under 300ms (§6).
        state.showLoading ? (
          <SkeletonRows rows={5} label={config.loadingLabel} />
        ) : null
      ) : state.data.length === 0 ? (
        <EmptyState
          title={config.emptyTitle}
          action={
            <Button variant="primary" onClick={openCreate}>
              {config.addLabel}
            </Button>
          }
        >
          {config.emptyBody}
        </EmptyState>
      ) : (
        <List label={config.heading}>
          {state.data.map((record) => (
            <ListItem key={record.id}>
              <ListRow
                title={record.title}
                {...(record.subtitle !== null ? { subtitle: record.subtitle } : {})}
                {...(record.active
                  ? {}
                  : { side: <InactiveChip label={inactiveLabel(config.entity)} /> })}
                onClick={() => openEdit(record)}
                ariaLabel={
                  record.active
                    ? record.title
                    : `${record.title}, ${inactiveLabel(config.entity)}`
                }
              />
            </ListItem>
          ))}
        </List>
      )}
      {confirm}
    </>
  );
}
