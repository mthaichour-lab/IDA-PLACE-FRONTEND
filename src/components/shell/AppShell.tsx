import { MobileBar } from './MobileBar';
import { Rail } from './Rail';
import { Topbar } from './Topbar';

/** Coque applicative (A.3) : rail + topbar + contenu + barre mobile. */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="shell">
      <Rail />
      <div className="main">
        <Topbar />
        <main className="content">{children}</main>
        <MobileBar />
      </div>
    </div>
  );
}
