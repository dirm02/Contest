import { useEffect, useState } from 'react';

type ToastMessage = {
  id: string;
  message: string;
};

let listeners: ((toasts: ToastMessage[]) => void)[] = [];
let toasts: ToastMessage[] = [];

export function addToast(message: string) {
  const id = Math.random().toString(36).substring(2, 9);
  toasts = [...toasts, { id, message }];
  listeners.forEach((l) => l(toasts));
  
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    listeners.forEach((l) => l(toasts));
  }, 5000);
}

export function ToastContainer() {
  const [activeToasts, setActiveToasts] = useState<ToastMessage[]>([]);

  useEffect(() => {
    listeners.push(setActiveToasts);
    setActiveToasts(toasts);
    return () => {
      listeners = listeners.filter((l) => l !== setActiveToasts);
    };
  }, []);

  if (activeToasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {activeToasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          aria-live="polite"
          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm font-medium shadow-lg transition-all duration-300 ease-out animate-in slide-in-from-bottom-2 fade-in"
        >
          {toast.message}
        </div>
      ))}
    </div>
  );
}
