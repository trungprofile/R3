// The food bank's own category list — the BOTTOM SECTION of Admin's Categories tab
// (D40), and no longer a screen of its own.
//
// IT LIVES IN ADMIN, NOT ON S3.1 (D17, overriding D11). D11 built it on the Report
// screen and said so in the same breath as saying the location was "still the
// human's to override — moving it to S1.8 is a route-access change and a screen
// move, not a data change". `ui-ux-spec.md §8` open assumption 3 asked the pantry to
// choose between the Report screen and Admin, and they chose Admin: this is master
// data, and it belongs beside the rest of the master data with the rest of the
// Admin-tier controls. See `mapping.ts` for what that costs a blocked Reporter.
//
// WHAT D40 TOOK, AND WHAT IT DID NOT. D17 gave this a tab of its own, holding TWO
// lists: ours, with a picker for where each one reports, and the food bank's. That
// meant an admin adding a category filled in a name on the Categories tab, saved,
// came here, found the same category again and only then said where it reports.
// So the first list moved ONTO the category's own editor (`masters.ts`
// `CATEGORY_FIELDS`), and what is left here is the second — the food bank's own
// names, read-mostly, with the count of ours reporting under each.
//
// **The RULES did not move.** `mappingRows`, `pickerOptions`, `storageGapNote`,
// `ntfbLabel`, `mappedCountLabel` and the rest are in `mapping.ts` and are still the
// only place any of them is written down; `masters.ts` imports `ntfbLabel` from
// there rather than spelling the "name (code)" rule a third time. What went is a
// TAB, not a module.
//
// THE FOOD BANK CATEGORY LIST NOW SHIPS SEEDED (D26, retiring D12). It used to start
// empty on purpose: those names were North Texas Food Bank's, they appeared in no
// foundation doc, and inventing them would have put fabricated values in the one
// column that decides what the pantry reports. The pantry supplied the real list on
// 2026-08-02 and migration 0016 seeds it, so this screen now EDITS a mapping rather
// than being where one is entered from nothing.
//
// The empty state stays, because an admin can still clear or archive a mapping, and so
// does the blocked export — which now stops a short SUBMISSION rather than a short
// file, since D29 made the export a printed receipt rather than a download.
//
// Removal is I21, same as every other master record: archived if any of our
// categories still report under it, destroyed only when none do. The confirm
// names the consequence without predicting which branch, and the sentence
// afterwards reports the server's own answer. One button, never two.

import { useCallback, useState } from 'react';
import { useAsyncData, useToast } from '../../../../app/index.ts';
import {
  BackLink,
  Button,
  Card,
  ConfirmModal,
  EmptyState,
  ErrorBlock,
  List,
  ListItem,
  ListRow,
  SkeletonRows,
  TextInput,
} from '../../../../components/index.ts';
import type { NtfbCategory } from '../../../../api/shared.ts';
import {
  createNtfbCategory,
  fetchNtfbCategories,
  removeNtfbCategory,
  updateNtfbCategory,
} from './api.ts';
import {
  COPY,
  mappedCountLabel,
  messageFor,
  normalizeOptional,
  ntfbLabel,
  ntfbNameError,
  ntfbRemovalText,
  sortNtfbCategories,
} from './mapping.ts';
import './mapping.css';

type View =
  | { kind: 'list' }
  | { kind: 'create' }
  | { kind: 'edit'; category: NtfbCategory };

/**
 * The one prop, and it is optional.
 *
 * `onChanged` tells a caller with something to re-read: since D40 that caller is
 * the Categories tab above, whose category rows offer these as choices and whose
 * "reports under" subtitles name them. Archiving one here changes what the form up
 * there may pick.
 */
export interface MappingEditorProps {
  onChanged?: () => void;
}

export function MappingEditor({
  onChanged = () => undefined,
}: MappingEditorProps = {}) {
  const toast = useToast();

  const load = useCallback(
    (signal: AbortSignal): Promise<NtfbCategory[]> => fetchNtfbCategories(signal),
    [],
  );
  const remote = useAsyncData<NtfbCategory[]>(load);

  const [view, setView] = useState<View>({ kind: 'list' });
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<NtfbCategory | null>(null);

  const openList = () => {
    setView({ kind: 'list' });
    setAttempted(false);
    setFailure(null);
  };

  const openCreate = () => {
    setName('');
    setCode('');
    setAttempted(false);
    setFailure(null);
    setView({ kind: 'create' });
  };

  const openEdit = (category: NtfbCategory) => {
    setName(category.name);
    setCode(category.code ?? '');
    setAttempted(false);
    setFailure(null);
    setView({ kind: 'edit', category });
  };

  const nameError = ntfbNameError(name, attempted);

  const saveCategory = async () => {
    setAttempted(true);
    if (name.trim() === '') return;
    setBusy(true);
    setFailure(null);
    try {
      if (view.kind === 'create') {
        await createNtfbCategory({ name: name.trim(), code: normalizeOptional(code) });
      } else if (view.kind === 'edit') {
        await updateNtfbCategory(view.category.id, {
          name: name.trim(),
          code: normalizeOptional(code),
        });
      }
      toast.success(COPY.ntfbSaved);
      openList();
      remote.reload();
      onChanged();
    } catch (cause) {
      setFailure(messageFor(cause));
    } finally {
      setBusy(false);
    }
  };

  /** §3.3's reverse arrow. Only `active: true` is accepted here — archiving goes
   *  through Remove, which is where I21 decides. */
  const reactivate = async (category: NtfbCategory) => {
    setBusy(true);
    setFailure(null);
    try {
      await updateNtfbCategory(category.id, { active: true });
      toast.success(COPY.reactivated);
      openList();
      remote.reload();
    } catch (cause) {
      setFailure(messageFor(cause));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (category: NtfbCategory) => {
    setBusy(true);
    setFailure(null);
    try {
      const outcome = await removeNtfbCategory(category.id);
      setConfirming(null);
      // I21 — which of the two happened is the server's answer, reported here.
      toast.success(ntfbRemovalText(category.name, outcome));
      openList();
      remote.reload();
      onChanged();
    } catch (cause) {
      setConfirming(null);
      setFailure(messageFor(cause));
    } finally {
      setBusy(false);
    }
  };

  const errorNote =
    failure !== null ? (
      <p className="s18-map__error" role="alert">
        {failure}
      </p>
    ) : null;

  if (remote.error !== null) {
    return (
      <div className="s18-map">
        <ErrorBlock error={remote.error} onRetry={remote.reload} />
      </div>
    );
  }

  if (remote.data === null) {
    // Nothing at all under 300ms (§6).
    return remote.showLoading ? (
      <div className="s18-map">
        <SkeletonRows rows={6} label={COPY.ntfbLoading} />
      </div>
    ) : null;
  }

  const categories = remote.data;

  // --- adding or editing one of the food bank's categories -------------------
  if (view.kind === 'create' || view.kind === 'edit') {
    const editing = view.kind === 'edit' ? view.category : null;
    return (
      <div className="s18-map">
        {/* §3's one way out, at the top and before the form's heading (D43) —
            the same shape `MasterPanel` and `AccountForm` use for the editor of
            a master record, since this is one too. */}
        <BackLink label={COPY.ntfbLabel} onBack={openList} />
        <form
          className="s18-map__form"
          onSubmit={(event) => {
            event.preventDefault();
            void saveCategory();
          }}
        >
          <h2 className="s18-map__subheading">
            {view.kind === 'create' ? COPY.createNtfbTitle : COPY.editNtfbTitle}
          </h2>

          <TextInput
            label={COPY.ntfbNameField}
            hint={COPY.ntfbNameHint}
            value={name}
            onChange={setName}
            disabled={busy}
            autoComplete="off"
            {...(nameError !== null ? { error: nameError } : {})}
          />
          {/* Nullable on purpose: Meal Connect may key on a code, and a guessed
              code is worse than a null (D13). */}
          <TextInput
            label={COPY.ntfbCodeField}
            hint={COPY.ntfbCodeHint}
            value={code}
            onChange={setCode}
            disabled={busy}
            autoComplete="off"
          />

          {errorNote}

          <div className="s18-map__form-actions">
            {/* The form's one high-emphasis action (§1 principle 1). The way out
                is the BackLink above, not a second button here (D43). */}
            <Button variant="primary" type="submit" loading={busy}>
              {view.kind === 'create' ? COPY.createNtfb : COPY.saveNtfb}
            </Button>
          </div>

          {editing !== null ? (
            <div className="s18-map__form-danger">
              {editing.active ? null : (
                <Button variant="secondary" onClick={() => void reactivate(editing)} disabled={busy}>
                  {COPY.reactivate}
                </Button>
              )}
              <Button variant="danger" onClick={() => setConfirming(editing)} disabled={busy}>
                {COPY.removeNtfb}
              </Button>
            </div>
          ) : null}
        </form>

        {confirming !== null ? (
          <ConfirmModal
            question={`${COPY.removeQuestion} ${confirming.name}`}
            consequence={COPY.removeConsequence}
            confirmLabel={COPY.removeNtfb}
            busy={busy}
            onConfirm={() => void remove(confirming)}
            onCancel={() => setConfirming(null)}
          />
        ) : null}
      </div>
    );
  }

  // --- the food bank's own list ----------------------------------------------
  const ordered = sortNtfbCategories(categories);

  return (
    <div className="s18-map">
      {errorNote}

      {/* D40 — this is a SECTION now, not a screen, so it opens with an `<h2>`
          under the Categories list rather than owning a tab. Read-mostly: the ten
          names ship seeded (D26) and the count under each is I21's delete/archive
          hint, said as a sentence rather than a bare number. */}
      <section aria-label={COPY.ntfbLabel}>
        <div className="s18-map__list-head">
          <h2 className="s18-map__subheading">{COPY.ntfbHeading}</h2>
          <Button variant="secondary" onClick={openCreate}>
            {COPY.addNtfb}
          </Button>
        </div>
        <p className="s18-map__note">{COPY.ntfbIntro}</p>

        {ordered.length === 0 ? (
          <EmptyState
            title={COPY.ntfbEmptyTitle}
            action={
              <Button variant="secondary" onClick={openCreate}>
                {COPY.addNtfb}
              </Button>
            }
          >
            {COPY.ntfbEmptyBody}
          </EmptyState>
        ) : (
          <Card ariaLabel={COPY.ntfbLabel}>
            <List label={COPY.ntfbLabel}>
              {ordered.map((category) => (
                <ListItem key={category.id}>
                  <ListRow
                    title={ntfbLabel(category)}
                    subtitle={mappedCountLabel(category)}
                    {...(category.active
                      ? {}
                      : { side: <span className="s18-map__archived">{COPY.archivedCategory}</span> })}
                    onClick={() => openEdit(category)}
                    ariaLabel={
                      category.active
                        ? `${category.name}, ${mappedCountLabel(category)}`
                        : `${category.name}, ${COPY.archivedCategory}`
                    }
                  />
                </ListItem>
              ))}
            </List>
          </Card>
        )}
      </section>
    </div>
  );
}
