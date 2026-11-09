// VisitorCounter 元件測試
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { VisitorCounter } from './VisitorCounter';

function mockFetchAbacusOk(value = 42) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ value }),
  });
}

describe('VisitorCounter', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows loading then count when Abacus succeeds', async () => {
    vi.stubGlobal('fetch', mockFetchAbacusOk(42));
    render(<VisitorCounter namespace="test-ns" counterKey="visits" />);
    expect(screen.getByLabelText('載入中')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByLabelText(/訪客人次：42/)).toBeInTheDocument();
    });
  });

  // 原本的備援 counterapi.dev 的 v1 已停用（回 410），v2 要帶 API key，靜態網站放不了
  it('Abacus 失敗時不顯示，也不改連其他計數服務', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    vi.stubGlobal('fetch', fetchMock);
    const { container } = render(
      <VisitorCounter namespace="test-ns3" counterKey="visits" />
    );
    await waitFor(() => {
      // After loading completes, container should be empty (returns null)
      expect(container.querySelector('.visitor-counter')).toBeNull();
    });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://abacus.jasoncameron.dev/hit/test-ns3/visits',
    ]);
  });

  it('sessionStorage 讀不到（封鎖網站資料）時照常顯示', async () => {
    vi.stubGlobal('fetch', mockFetchAbacusOk(42));
    const descriptor = Object.getOwnPropertyDescriptor(window, 'sessionStorage')!;
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      get() {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    });
    try {
      render(<VisitorCounter namespace="test-ns-blocked" counterKey="visits" />);
      expect(await screen.findByLabelText(/訪客人次：42/)).toBeInTheDocument();
    } finally {
      Object.defineProperty(window, 'sessionStorage', descriptor);
    }
  });

  it('sessionStorage 寫不進去（額度用完）時數字照常顯示', async () => {
    vi.stubGlobal('fetch', mockFetchAbacusOk(42));
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    render(<VisitorCounter namespace="test-ns-quota" counterKey="visits" />);
    expect(await screen.findByLabelText(/訪客人次：42/)).toBeInTheDocument();
  });

  it('uses GET endpoint when sessionStorage marks visited', async () => {
    sessionStorage.setItem('visited-test-ns4-visits', 'true');
    const fetchMock = mockFetchAbacusOk(7);
    vi.stubGlobal('fetch', fetchMock);
    render(<VisitorCounter namespace="test-ns4" counterKey="visits" />);
    await waitFor(() => {
      expect(screen.getByLabelText(/訪客人次：7/)).toBeInTheDocument();
    });
    // Abacus URL path should contain '/get/' not '/hit/'
    const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
    expect(calledUrl).toMatch(/\/get\//);
  });

  it('encodes namespace and key', async () => {
    const fetchMock = mockFetchAbacusOk(1);
    vi.stubGlobal('fetch', fetchMock);
    render(<VisitorCounter namespace="ns/with slash" counterKey="key#hash" />);
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    const url = fetchMock.mock.calls[0]?.[0] as string;
    expect(url).toContain('ns%2Fwith%20slash');
    expect(url).toContain('key%23hash');
  });
});
