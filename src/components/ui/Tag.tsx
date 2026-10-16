export type TagTone = 'ok' | 'warn' | 'ko' | 'a';

/** Composant transverse `.tag` (A.3) — états ok/warn/ko/a. */
export function Tag({ tone, children }: { tone: TagTone; children: React.ReactNode }) {
  return <span className={`tag ${tone}`}>{children}</span>;
}
