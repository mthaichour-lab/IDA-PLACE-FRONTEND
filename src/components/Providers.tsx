'use client';

import { AppShell } from '@/components/shell/AppShell';
import { ThemeProvider } from '@/components/theme-provider';
import { ToastProvider } from '@/components/ui/Toast';
import { AuthProvider } from '@/lib/auth-context';
import { CompanyDirectoryProvider } from '@/lib/company-directory';
import { QueryProvider } from '@/lib/query-provider';
import { I18nProvider } from '@/i18n/provider';

/** Composition de tous les providers applicatifs + coque (A.3). */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryProvider>
      <I18nProvider>
        <ThemeProvider>
          <ToastProvider>
            <AuthProvider>
              <CompanyDirectoryProvider>
                <AppShell>{children}</AppShell>
              </CompanyDirectoryProvider>
            </AuthProvider>
          </ToastProvider>
        </ThemeProvider>
      </I18nProvider>
    </QueryProvider>
  );
}
