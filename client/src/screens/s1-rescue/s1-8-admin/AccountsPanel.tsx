// S1.8 Accounts — the list, and what happens around the form.
//
// "list of users; create (first/last → auto username shown read-only), assign tier
// (Volunteer/Staff/Admin) and duties (drive/receive/report as toggles), set/reset
// PIN or password. Delete non-admin. Username immutable once set."
//
// Two things this panel is careful about:
//
//   I21 — Remove asks the domain. The confirm names the consequence without
//         predicting which branch runs, and the sentence afterwards reports the
//         server's own answer (`RemoveUserResponse.outcome`). There is never a
//         choice of two buttons.
//   I3  — the username shown after a create is the one the SERVER assigned, not
//         the preview the form was showing. The two can differ when someone else
//         created an account in the same minute, and the real one is what sticks.

import { useCallback, useState } from 'react';
import {
  Button,
  ConfirmModal,
  EmptyState,
  ErrorBlock,
  List,
  ListItem,
  ListRow,
  SkeletonRows,
} from '../../../components/index.ts';
import { useAsyncData, useToast } from '../../../app/index.ts';
import type { ShapedUser } from '../../../api/shared.ts';
import {
  createAccount,
  fetchAccounts,
  removeAccount,
  setAccountCredential,
  updateAccount,
} from './api.ts';
import {
  accountSubtitle,
  buildCreateBody,
  buildUserSave,
  COPY,
  createdNotice,
  fullName,
  inactiveLabel,
  isNoOp,
  removalText,
  writeFailureText,
  type AccountForm as AccountFormValues,
} from './logic.ts';
import { AccountForm } from './AccountForm.tsx';
import { InactiveChip } from './parts.tsx';

type View = { kind: 'list' } | { kind: 'create' } | { kind: 'edit'; user: ShapedUser };

export function AccountsPanel() {
  const toast = useToast();
  const load = useCallback((signal: AbortSignal) => fetchAccounts(signal), []);
  const state = useAsyncData(load);

  const [view, setView] = useState<View>({ kind: 'list' });
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<ShapedUser | null>(null);
  /** The one-time PIN sentence. On the screen, not only in a toast: §3 — a toast is
   *  never the only signal for something critical, and this number is unrecoverable. */
  const [notice, setNotice] = useState<string | null>(null);

  const backToList = () => {
    setView({ kind: 'list' });
    setFailure(null);
  };

  const submit = async (values: AccountFormValues) => {
    setBusy(true);
    setFailure(null);
    try {
      if (view.kind === 'create') {
        const created = await createAccount(buildCreateBody(values));
        const name = fullName(created.user);
        // I3 — the server's username, never the preview.
        toast.success(`${name} added, as ${created.user.username}.`);
        setNotice(createdNotice(name, values, created.generatedCredential));
        backToList();
        state.reload();
        return;
      }
      if (view.kind === 'edit') {
        const plan = buildUserSave(view.user, values);
        if (isNoOp(plan)) {
          backToList();
          return;
        }
        if (plan.patch !== null) {
          await updateAccount(view.user.id, plan.patch);
        } else if (plan.credentialOnly !== null) {
          await setAccountCredential(view.user.id, plan.credentialOnly);
        }
        toast.success(COPY.accounts.savedToast);
        backToList();
        state.reload();
      }
    } catch (cause) {
      setFailure(writeFailureText(cause));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (user: ShapedUser) => {
    setBusy(true);
    setFailure(null);
    try {
      const { outcome } = await removeAccount(user.id);
      setConfirming(null);
      // I21 — say which of the two happened. The admin was not asked to choose.
      toast.success(removalText('user', fullName(user), outcome));
      backToList();
      state.reload();
    } catch (cause) {
      setConfirming(null);
      setFailure(writeFailureText(cause));
    } finally {
      setBusy(false);
    }
  };

  /** §3.3's ACTIVE ⇄ DEACTIVATED return arrow. `{ active: true }` is the whole
   *  patch: the server refuses `false` and points at Delete, so this cannot become
   *  a second deactivation path that skips I21. */
  const reactivate = async (user: ShapedUser) => {
    setBusy(true);
    setFailure(null);
    try {
      await updateAccount(user.id, { active: true });
      toast.success(COPY.accounts.reactivated);
      backToList();
      state.reload();
    } catch (cause) {
      setFailure(writeFailureText(cause));
    } finally {
      setBusy(false);
    }
  };

  if (view.kind !== 'list') {
    const existing = view.kind === 'edit' ? view.user : null;
    return (
      <>
        <AccountForm
          mode={view.kind}
          existing={existing}
          taken={(state.data ?? []).map((user) => user.username)}
          busy={busy}
          failure={failure}
          onSubmit={submit}
          onCancel={backToList}
          {...(existing !== null && existing.tier !== 'ADMIN'
            ? { onRemove: () => setConfirming(existing) }
            : {})}
          {...(existing !== null && !existing.active
            ? { onReactivate: () => void reactivate(existing) }
            : {})}
        />
        {confirming !== null ? (
          <ConfirmModal
            question={`Remove ${fullName(confirming)}?`}
            consequence={COPY.confirm.consequence}
            confirmLabel={COPY.confirm.label}
            busy={busy}
            onConfirm={() => void remove(confirming)}
            onCancel={() => setConfirming(null)}
          />
        ) : null}
      </>
    );
  }

  return (
    <>
      <div className="s18-list-head">
        <h2 className="s18-subheading">{COPY.accounts.heading}</h2>
        <Button variant="primary" onClick={() => setView({ kind: 'create' })}>
          {COPY.accounts.add}
        </Button>
      </div>

      {notice !== null ? (
        <div className="s18-notice s18-notice--strong" role="status">
          <p className="s18-notice__text">{notice}</p>
          <Button variant="secondary" onClick={() => setNotice(null)}>
            {COPY.pinNotice.dismiss}
          </Button>
        </div>
      ) : null}

      {failure !== null ? (
        <p className="s18-error" role="alert">
          {failure}
        </p>
      ) : null}

      {state.error !== null ? <ErrorBlock error={state.error} onRetry={state.reload} /> : null}

      {state.data === null ? (
        // Nothing at all under 300ms (§6) — `showLoading` already carries the delay.
        state.showLoading ? (
          <SkeletonRows rows={6} label={COPY.accounts.loading} />
        ) : null
      ) : state.data.length === 0 ? (
        <EmptyState
          title={COPY.accounts.emptyTitle}
          action={
            <Button variant="primary" onClick={() => setView({ kind: 'create' })}>
              {COPY.accounts.add}
            </Button>
          }
        >
          {COPY.accounts.emptyBody}
        </EmptyState>
      ) : (
        <List label={COPY.accounts.heading}>
          {state.data.map((user) => (
            <ListItem key={user.id}>
              <ListRow
                title={fullName(user)}
                subtitle={accountSubtitle(user)}
                meta={user.username}
                {...(user.active ? {} : { side: <InactiveChip label={inactiveLabel('user')} /> })}
                onClick={() => {
                  setFailure(null);
                  setView({ kind: 'edit', user });
                }}
                ariaLabel={`${fullName(user)}, ${accountSubtitle(user)}`}
              />
            </ListItem>
          ))}
        </List>
      )}
    </>
  );
}
