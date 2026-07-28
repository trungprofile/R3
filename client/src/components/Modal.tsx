// Modal and destructive confirm — `ui-ux-spec.md §3` and `§6`.
//
// Centered, ONE question, TWO buttons. A destructive confirm names the
// consequence ("Release this run? It goes back to the board for others.") rather
// than asking "Are you sure?", which tells nobody anything.
//
// §6: "Cancel is the calm default; the destructive button is red." So Cancel
// takes focus on open, Escape cancels, and a click on the scrim cancels. The
// destructive path is never the one a stray keypress takes.

import { useEffect, useRef } from 'react';
import type { ReactNode, RefObject } from 'react';
import { Button } from './Button.tsx';

export interface ModalProps {
  /** The one question, e.g. "Release this run?" */
  question: string;
  /** What happens if they go ahead. Required for destructive confirms. */
  children?: ReactNode;
  onCancel: () => void;
  /** Rendered right of Cancel. */
  actions: ReactNode;
  /** Element to focus on open. Defaults to Cancel. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Drop the Cancel button for a dialog with nothing to cancel — the "Still
   *  here?" prompt (§5), where staying signed in IS the calm default. `onCancel`
   *  still runs on Escape and on a click outside. */
  showCancel?: boolean;
}

export function Modal({
  question,
  children,
  onCancel,
  actions,
  initialFocusRef,
  showCancel = true,
}: ModalProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Focus lands on Cancel — the calm default (§6). With no Cancel, it lands on
    // the dialog itself so a screen reader announces the question rather than
    // leaving focus back on the page behind.
    (initialFocusRef?.current ?? cancelRef.current ?? dialogRef.current)?.focus();
  }, [initialFocusRef]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div
      className="r3-modal__scrim"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        className="r3-modal"
        role="dialog"
        aria-modal="true"
        aria-label={question}
        ref={dialogRef}
        tabIndex={-1}
      >
        <p className="r3-modal__question">{question}</p>
        {children ? <div className="r3-modal__consequence">{children}</div> : null}
        <div className="r3-modal__actions">
          {showCancel ? (
            <button
              type="button"
              ref={cancelRef}
              className="r3-btn r3-btn--secondary"
              onClick={onCancel}
            >
              Cancel
            </button>
          ) : null}
          {actions}
        </div>
      </div>
    </div>
  );
}

export interface ConfirmModalProps {
  question: string;
  /** One sentence naming the consequence. Question + consequence is the confirm
   *  pattern §7 fixes. */
  consequence: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** Red confirm button. Leave false for a confirm that destroys nothing. */
  destructive?: boolean;
  busy?: boolean;
}

export function ConfirmModal({
  question,
  consequence,
  confirmLabel,
  onConfirm,
  onCancel,
  destructive = true,
  busy = false,
}: ConfirmModalProps) {
  return (
    <Modal
      question={question}
      onCancel={onCancel}
      actions={
        <Button variant={destructive ? 'danger' : 'primary'} onClick={onConfirm} loading={busy}>
          {confirmLabel}
        </Button>
      }
    >
      {consequence}
    </Modal>
  );
}
