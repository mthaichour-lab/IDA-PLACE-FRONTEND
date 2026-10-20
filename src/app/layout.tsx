import type { Metadata } from 'next';
import { connection } from 'next/server';
import { Providers } from '@/components/Providers';
// Polices de la charte (Partie A.2) auto-hébergées — servies par 'self', compatibles CSP (SEC-22).
import '@fontsource-variable/urbanist';
import '@fontsource-variable/dm-sans';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import '@/styles/globals.css';

export const metadata: Metadata = {
  title: 'IDA Place',
  description: 'Plateforme de place — chambre de compensation IDA (indemnisation directe des assurés).',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // SEC-22 : rendu dynamique obligatoire pour que Next.js applique le nonce
  // CSP (posé par `src/proxy.ts`) à ses scripts d'hydratation.
  await connection();
  // lang/dir réels sont pilotés côté client par I18nProvider (useEffect sur
  // document.documentElement) ; les valeurs ici sont le repli SSR par défaut.
  return (
    <html lang="fr" dir="ltr">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
