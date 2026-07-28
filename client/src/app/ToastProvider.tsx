// Toast queue — `ui-ux-spec.md §3`: bottom, 4s, success/error.
//
// A toast is never the only signal for a critical action (§3). It is the light
// confirmation on top of a change the screen already shows — the partial-claim
// summary in S1.2, the lost-race revert in §6.

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ToastList } from '../components/index.ts';
import type { ToastKind, ToastMessage } from '../components/index.ts';
import { duration } from '../tokens/index.ts';

interface ToastValue {
  show: (kind: ToastKind, text: string, action?: ToastMessage['action']) => void;
  success: (text: string, action?: ToastMessage['action']) => void;
  error: (text: string, action?: ToastMessage['action']) => void;
}

const ToastContext = createContext<ToastValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback<ToastValue['show']>(
    (kind, text, action) => {
      const id = nextId.current;
      nextId.current += 1;
      setToasts((current) => [...current, { id, kind, text, ...(action ? { action } : {}) }]);
      setTimeout(() => dismiss(id), duration.toastMs);
    },
    [dismiss],
  );

  const value = useMemo<ToastValue>(
    () => ({
      show,
      success: (text, action) => show('success', text, action),
      error: (text, action) => show('error', text, action),
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastList toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastValue {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToast used outside ToastProvider');
  return value;
}
