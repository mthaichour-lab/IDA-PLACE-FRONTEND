import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CoChip } from '@/components/ui/CoChip';
import { safeColor, safeDocumentUrl } from './safe-values';

afterEach(() => vi.unstubAllEnvs());

describe('safeDocumentUrl (SEC-50)', () => {
  it.each(['https://storage.example/d-1?sig=abc', 'blob:http://localhost:3000/5f1c'])('accepte %s', (url) => {
    expect(safeDocumentUrl(url)).toBe(new URL(url).toString());
  });

  it.each(['javascript:alert(1)', ' JaVaScRiPt:alert(1)', 'data:text/html;base64,PHNjcmlwdD4=', 'vbscript:x', 'file:///etc/passwd', 'ftp://x/y', 'http://evil.example/x', '', null, 42])(
    'refuse %j',
    (url) => {
      expect(safeDocumentUrl(url)).toBeUndefined();
    },
  );

  it('résout un chemin relatif de l’API sur l’origine de l’API (http toléré en développement seulement)', () => {
    expect(safeDocumentUrl('/api/v1/documents/local/k?sig=1')).toBe('http://localhost:3001/api/v1/documents/local/k?sig=1');
    vi.stubEnv('NODE_ENV', 'production');
    expect(safeDocumentUrl('/api/v1/documents/local/k?sig=1')).toBeUndefined();
  });
});

describe('safeColor / CoChip (SEC-50)', () => {
  it('n’accepte que #RRGGBB', () => {
    expect(safeColor('#1A2b3C')).toBe('#1A2b3C');
    for (const bad of ['red', '#fff', '#12345g', 'url(javascript:alert(1))', '#123456;background:url(x)', 'expression(alert(1))', undefined]) {
      expect(safeColor(bad)).toBe('#6A6E6D');
    }
  });

  it('CoChip n’injecte jamais une couleur non conforme dans le style', () => {
    const { container, rerender } = render(<CoChip code="SAA" color="#0A7A3B" />);
    expect((container.firstChild as HTMLElement).getAttribute('style') ?? '').toMatch(/rgb\(10, 122, 59\)|#0a7a3b/i);
    rerender(<CoChip code="SAA" color="red;background-image:url(https://evil.example/x)" />);
    const style = (container.firstChild as HTMLElement).getAttribute('style') ?? '';
    expect(style).not.toContain('evil.example');
    expect(style).toMatch(/rgb\(106, 110, 109\)|#6a6e6d/i);
  });
});
