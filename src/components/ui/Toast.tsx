'use client';

import { AlertTriangle, Check, X } from 'lucide-react';
import { createContext, useCallback, useContext, useState } from 'react';

type Tone = 'ok' | 'ko' | 'warn';
interface ToastItem {
  id: number;
  msg: string;
  tone: Tone;
}

interface ToastContextValue {
  toast: (msg: string, tone?: Tone) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);
let nextId = 1;

/** Composant transverse `toast(msg,tone)` (A.3). */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const toast = useCallback((msg: string, tone: Tone = 'ok') => {
    const id = nextId++;
    setItems((prev) => [...prev, { id, msg, tone }]);
    setTimeout(() => setItems((prev) => prev.filter((i) => i.id !== id)), 4000);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {items.map((i) => (
          <div key={i.id} className={`toast ${i.tone}`}>
            <span className="toast-dot" aria-hidden="true" />
            {i.tone === 'ok' ? <Check size={14} strokeWidth={2.4} aria-hidden="true" /> : i.tone === 'ko' ? <X size={14} strokeWidth={2.4} aria-hidden="true" /> : <AlertTriangle size={14} strokeWidth={2.2} aria-hidden="true" />}
            <span>{i.msg}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast doit être utilisé sous ToastProvider');
  return ctx;
}
