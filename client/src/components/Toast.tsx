// Toast — `ui-ux-spec.md §3`: bottom, 4s, success/error.
//
// "Never the only signal for a critical action." A toast is the light-touch
// confirmation on top of a state change the screen already shows — if the only
// evidence something happened is a message that disappears in four seconds, the
// screen is wrong, not the toast.
//
// This file is the presentation. `app/ToastProvider.tsx` owns the queue and the
// timers, so any screen can raise one without threading state through props.

export type ToastKind = 'success' | 'error';

export interface ToastMessage {
  id: number;
  kind: ToastKind;
  text: string;
  /** Optional follow-up, e.g. "See which dates" after a partial claim (S1.2). */
  action?: { label: string; onClick: () => void };
}

export function ToastList({
  toasts,
  onDismiss,
}: {
  toasts: readonly ToastMessage[];
  onDismiss: (id: number) => void;
}) {
  if (toasts.length === 0) return null;

  return (
    <div className="r3-toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`r3-toast r3-toast--${toast.kind}`}>
          {toast.text}
          {toast.action ? (
            <button
              type="button"
              className="r3-toast__action"
              onClick={() => {
                toast.action?.onClick();
                onDismiss(toast.id);
              }}
            >
              {toast.action.label}
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
