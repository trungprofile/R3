// The AGFP→NTFB matching editor.
//
// IT LIVES IN ADMIN, NOT ON S3.1 (D17, overriding D11). D11 built it on the Report
// screen and said so in the same breath as saying the location was "still the
// human's to override — moving it to S1.8 is a route-access change and a screen
// move, not a data change". `ui-ux-spec.md §8` open assumption 3 asked the pantry to
// choose between the Report screen and Admin, and they chose Admin: this is master
// data, and it belongs beside the rest of the master data with the rest of the
// Admin-tier controls. See `mapping.ts` for what that costs a blocked Reporter.
//
// WHY THE FOOD BANK CATEGORY LIST STARTS EMPTY (D12). Those names are North Texas
// Food Bank's, they appear in no foundation doc, and migration 0012 seeds nothing
// rather than guessing. Inventing them would put fabricated values in the one
// column that decides what the pantry reports, and every gate in this repo would
// pass while it did. So the empty state here is not an oversight — it is the
// screen asking for the one fact the repo cannot know, and the blocked export is
// what stops a short file going out in the meantime.
//
// Removal is I21, same as every other master record: archived if any of our
// categories still report under it, destroyed only when none do. The confirm
// names the consequence without predicting which branch, and the sentence
// afterwards reports the server's own answer. One button, never two.

import { useCallback, useState } from 'react';
import { useAsyncData, useToast } from '../../../../app/index.ts';
import {
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
import type { CategoryMapping, NtfbCategory, UnmappedCategory } from '../../../../api/shared.ts';
import {
  createNtfbCategory,
  fetchMappings,
  fetchNtfbCategories,
  removeNtfbCategory,
  setMapping,
  updateNtfbCategory,
} from './api.ts';
import {
  COPY,
  mappedCountLabel,
  mappingRows,
  mappingSavedText,
  mappingTargetLabel,
  messageFor,
  normalizeOptional,
  ntfbLabel,
  ntfbNameError,
  ntfbRemovalText,
  pickerOptions,
  sortNtfbCategories,
  storageGapNote,
  weightWithUnit,
  type MappingRow,
} from './mapping.ts';
import './mapping.css';

interface EditorData {
  mappings: CategoryMapping[];
  categories: NtfbCategory[];
}

type View =
  | { kind: 'list' }
  | { kind: 'picker'; row: MappingRow }
  | { kind: 'create' }
  | { kind: 'edit'; category: NtfbCategory };

/**
 * Both props are optional, and Admin passes neither.
 *
 * They exist because this editor was built inside S3.1, where a week was on screen
 * and could be re-read: `unmapped` sorted the categories blocking THAT week to the
 * top, and `onChanged` told the report to reload. Admin has no week and nothing
 * above it to refresh, so it renders `<MappingEditor />` and the defaults do the
 * right thing — an empty blocking list simply means no row sorts to the top, which
 * is exactly true here.
 */
export interface MappingEditorProps {
  /** Categories carrying weight in a week with nowhere to report it, sorted to the
   *  top. Empty from Admin, which has no week on screen. */
  unmapped?: readonly UnmappedCategory[];
  /** Told when the matching changes, for a caller with something to re-read. */
  onChanged?: () => void;
}

const NOTHING_UNMAPPED: readonly UnmappedCategory[] = [];

export function MappingEditor({
  unmapped = NOTHING_UNMAPPED,
  onChanged = () => undefined,
}: MappingEditorProps = {}) {
  const toast = useToast();

  const load = useCallback(async (signal: AbortSignal): Promise<EditorData> => {
    const [mappings, categories] = await Promise.all([
      fetchMappings(signal),
      fetchNtfbCategories(signal),
    ]);
    return { mappings, categories };
  }, []);
  const remote = useAsyncData<EditorData>(load);

  const [view, setView] = useState<View>({ kind: 'list' });
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  /** The picker's second field. Storage is half of a Meal Connect line item, so it
   *  is chosen alongside the category rather than on a screen of its own. */
  const [storage, setStorage] = useState('');
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

  const choose = async (row: MappingRow, ntfbCategoryId: string | null, label: string) => {
    setBusy(true);
    setFailure(null);
    try {
      // Sent on the same request as the category: they are one line item, and
      // saving them separately would leave a window where the mapping says
      // "Produce, frozen" because the old storage outlived the old category.
      await setMapping(row.categoryId, { ntfbCategoryId, storage: normalizeOptional(storage) });
      toast.success(mappingSavedText(row.categoryName, ntfbCategoryId === null ? null : label));
      openList();
      remote.reload();
      // The week's unmapped block may have just emptied out.
      onChanged();
    } catch (cause) {
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

  const { mappings, categories } = remote.data;

  // --- picking where one of our categories reports ---------------------------
  if (view.kind === 'picker') {
    const options = pickerOptions(categories);
    return (
      <div className="s18-map">
        <h2 className="s18-map__subheading">{`${COPY.pickerLabel}: ${view.row.categoryName}`}</h2>
        {/* D21: the hint that used to sit here said "Pick one, or leave it
            unmatched." above a list whose last row IS "Leave it unmatched". A hint
            that only restates the control under it is one more thing to read. */}

        {/* Storage sits ABOVE the category list because choosing a category is what
            submits: the admin fills this in, then taps where it reports, and both
            halves of the line item go in one request. Free text, not a fixed list —
            the three values we have seen came off one receipt, and the pantry's own
            form is the authority on the rest (migration 0013). */}
        <TextInput
          label={COPY.storageField}
          hint={COPY.storageHint}
          value={storage}
          onChange={setStorage}
          disabled={busy}
          autoComplete="off"
        />

        {errorNote}
        {/* §1.5 rules out a dropdown where a visible column of big targets fits,
            and the food bank's list is short by construction. */}
        <List label={COPY.pickerLabel}>
          {options.map((option) => (
            <ListItem key={option.id ?? 'none'}>
              <ListRow
                title={option.label}
                {...(view.row.ntfbCategoryId === option.id ? { side: COPY.pickerCurrent } : {})}
                onClick={() => void choose(view.row, option.id, option.label)}
              />
            </ListItem>
          ))}
        </List>
        <Button variant="secondary" onClick={openList} disabled={busy}>
          {COPY.back}
        </Button>
      </div>
    );
  }

  // --- adding or editing one of the food bank's categories -------------------
  if (view.kind === 'create' || view.kind === 'edit') {
    const editing = view.kind === 'edit' ? view.category : null;
    return (
      <div className="s18-map">
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
            <Button variant="primary" type="submit" loading={busy}>
              {view.kind === 'create' ? COPY.createNtfb : COPY.saveNtfb}
            </Button>
            <Button variant="secondary" onClick={openList} disabled={busy}>
              {COPY.back}
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

  // --- the two lists ---------------------------------------------------------
  const rows = mappingRows(mappings, unmapped);
  const ordered = sortNtfbCategories(categories);

  return (
    <div className="s18-map">
      {errorNote}

      <section aria-label={COPY.mappingLabel}>
        <h2 className="s18-map__subheading">{COPY.mappingHeading}</h2>
        <p className="s18-map__note">{COPY.mappingIntro}</p>
        <p className="s18-map__note">{COPY.remapNotice}</p>

        {rows.length === 0 ? (
          <EmptyState title={COPY.mappingEmptyTitle}>{COPY.mappingEmptyBody}</EmptyState>
        ) : (
          <List label={COPY.mappingLabel}>
            {rows.map((row) => (
              <ListItem key={row.categoryId}>
                <ListRow
                  title={row.categoryName}
                  {...(rowSubtitle(row) !== null ? { subtitle: rowSubtitle(row) } : {})}
                  side={
                    <span
                      className={
                        row.ntfbCategoryId === null ? 's18-map__target s18-map__target--none' : 's18-map__target'
                      }
                    >
                      {mappingTargetLabel(row)}
                    </span>
                  }
                  onClick={() => {
                    setStorage(row.storage ?? '');
                    setFailure(null);
                    setView({ kind: 'picker', row });
                  }}
                  ariaLabel={`${row.categoryName}, ${mappingTargetLabel(row)}`}
                />
              </ListItem>
            ))}
          </List>
        )}
      </section>

      <section aria-label={COPY.ntfbLabel}>
        <div className="s18-map__list-head">
          <h2 className="s18-map__subheading">{COPY.ntfbHeading}</h2>
          <Button variant="primary" onClick={openCreate}>
            {COPY.addNtfb}
          </Button>
        </div>
        <p className="s18-map__note">{COPY.ntfbIntro}</p>

        {ordered.length === 0 ? (
          <EmptyState
            title={COPY.ntfbEmptyTitle}
            action={
              <Button variant="primary" onClick={openCreate}>
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

/** What sits under one of our categories in the matching list: the weight it is
 *  holding the export up with, or the fact that it is archived, or the storage it
 *  is still missing, or nothing. Ordered by how much it costs to ignore. */
function rowSubtitle(row: MappingRow): string | null {
  if (row.blockingWeight !== null) {
    return `${weightWithUnit(row.blockingWeight)} ${COPY.blockingTail}`;
  }
  if (row.archived) return COPY.archivedCategory;
  return storageGapNote(row);
}
