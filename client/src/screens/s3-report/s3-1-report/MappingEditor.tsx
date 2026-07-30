// The AGFP→NTFB matching editor.
//
// It lives on S3.1 and not in Admin (D11, which resolved `ui-ux-spec.md`'s own
// open assumption 3): this is where the mapping's effect is visible, and a
// Reporter who hits the blocked export should be able to fix it without changing
// screens — or tiers. The routes are `REPORT`-duty for the same reason.
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
import { useAsyncData, useToast } from '../../../app/index.ts';
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
} from '../../../components/index.ts';
import type { CategoryMapping, NtfbCategory, UnmappedCategory } from '../../../api/shared.ts';
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
  normalizeCode,
  ntfbLabel,
  ntfbNameError,
  ntfbRemovalText,
  pickerOptions,
  sortNtfbCategories,
  weightWithUnit,
  type MappingRow,
} from './report.ts';

interface EditorData {
  mappings: CategoryMapping[];
  categories: NtfbCategory[];
}

type View =
  | { kind: 'list' }
  | { kind: 'picker'; row: MappingRow }
  | { kind: 'create' }
  | { kind: 'edit'; category: NtfbCategory };

export interface MappingEditorProps {
  /** The categories carrying weight in the week on screen with nowhere to report
   *  it. Passed in so the rows that are blocking the export sort to the top —
   *  that is what the Reporter came here to fix. */
  unmapped: readonly UnmappedCategory[];
  /** Told when the matching changes, so the week above re-reads. A remap can turn
   *  a blocked week into an exportable one in a single click. */
  onChanged: () => void;
}

export function MappingEditor({ unmapped, onChanged }: MappingEditorProps) {
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
        await createNtfbCategory({ name: name.trim(), code: normalizeCode(code) });
      } else if (view.kind === 'edit') {
        await updateNtfbCategory(view.category.id, {
          name: name.trim(),
          code: normalizeCode(code),
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
      await setMapping(row.categoryId, { ntfbCategoryId });
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
      <p className="s31-error" role="alert">
        {failure}
      </p>
    ) : null;

  if (remote.error !== null) {
    return (
      <div className="s31-mapping">
        <ErrorBlock error={remote.error} onRetry={remote.reload} />
      </div>
    );
  }

  if (remote.data === null) {
    // Nothing at all under 300ms (§6).
    return remote.showLoading ? (
      <div className="s31-mapping">
        <SkeletonRows rows={6} label={COPY.ntfbLoading} />
      </div>
    ) : null;
  }

  const { mappings, categories } = remote.data;

  // --- picking where one of our categories reports ---------------------------
  if (view.kind === 'picker') {
    const options = pickerOptions(categories);
    return (
      <div className="s31-mapping">
        <h2 className="s31-subheading">{`${COPY.pickerLabel}: ${view.row.categoryName}`}</h2>
        <p className="s31-note">{COPY.pickerHint}</p>
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
      <div className="s31-mapping">
        <form
          className="s31-form"
          onSubmit={(event) => {
            event.preventDefault();
            void saveCategory();
          }}
        >
          <h2 className="s31-subheading">
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

          <div className="s31-form__actions">
            <Button variant="primary" type="submit" loading={busy}>
              {view.kind === 'create' ? COPY.createNtfb : COPY.saveNtfb}
            </Button>
            <Button variant="secondary" onClick={openList} disabled={busy}>
              {COPY.back}
            </Button>
          </div>

          {editing !== null ? (
            <div className="s31-form__danger">
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
    <div className="s31-mapping">
      {errorNote}

      <section aria-label={COPY.mappingLabel}>
        <h2 className="s31-subheading">{COPY.mappingHeading}</h2>
        <p className="s31-note">{COPY.mappingIntro}</p>
        <p className="s31-note">{COPY.remapNotice}</p>

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
                        row.ntfbCategoryId === null ? 's31-target s31-target--none' : 's31-target'
                      }
                    >
                      {mappingTargetLabel(row)}
                    </span>
                  }
                  onClick={() => setView({ kind: 'picker', row })}
                  ariaLabel={`${row.categoryName} — ${mappingTargetLabel(row)}`}
                />
              </ListItem>
            ))}
          </List>
        )}
      </section>

      <section aria-label={COPY.ntfbLabel}>
        <div className="s31-list-head">
          <h2 className="s31-subheading">{COPY.ntfbHeading}</h2>
          <Button variant="primary" onClick={openCreate}>
            {COPY.addNtfb}
          </Button>
        </div>
        <p className="s31-note">{COPY.ntfbIntro}</p>

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
                      : { side: <span className="s31-archived">{COPY.archivedCategory}</span> })}
                    onClick={() => openEdit(category)}
                    ariaLabel={
                      category.active
                        ? `${category.name} — ${mappedCountLabel(category)}`
                        : `${category.name} — ${COPY.archivedCategory}`
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
 *  holding the export up with, or the fact that it is archived, or nothing. */
function rowSubtitle(row: MappingRow): string | null {
  if (row.blockingWeight !== null) {
    return `${weightWithUnit(row.blockingWeight)} ${COPY.blockingTail}`;
  }
  return row.archived ? COPY.archivedCategory : null;
}
