import type { Metadata } from 'next';
import { Providers } from '@/components/Providers';
import '@/styles/globals.css';

export const metadata: Metadata = {
  title: 'IDA Place',
  description: 'Plateforme de place — chambre de compensation IDA (indemnisation directe des assurés).',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
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
