// VisitorCounter 元件測試
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { VisitorCounter } from './VisitorCounter';

const ABACUS_URL = /abacus\.jasoncameron\.dev/;
const COUNTERAPI_URL = /api\.counterapi\.dev/;

function mockFetchAbacusOk(value = 42) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ value }),
  });
}

function mockFetchAbacusFailThenCounterapiOk(count = 99) {
  return vi.fn().mockImplementation((url: string) => {
    if (ABACUS_URL.test(url)) {
      return Promise.resolve({ ok: false, status: 500 });
    }
    if (COUNTERAPI_URL.test(url)) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ count }) });
    }
    return Promise.reject(new Error('unexpected url'));
  });
}

function mockFetchAllFail() {
  return vi.fn().mockResolvedValue({ ok: false, status: 503 });
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

  it('falls back to counterapi.dev when Abacus 5xx', async () => {
    vi.stubGlobal('fetch', mockFetchAbacusFailThenCounterapiOk(99));
    render(<VisitorCounter namespace="test-ns2" counterKey="visits" />);
    await waitFor(() => {
      expect(screen.getByLabelText(/訪客人次：99/)).toBeInTheDocument();
    });
  });

  it('renders nothing when both providers fail', async () => {
    vi.stubGlobal('fetch', mockFetchAllFail());
    const { container } = render(
      <VisitorCounter namespace="test-ns3" counterKey="visits" />
    );
    await waitFor(() => {
      // After loading completes, container should be empty (returns null)
      expect(container.querySelector('.visitor-counter')).toBeNull();
    });
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
    const url = fetchMock.mock.calls[0]?.[0] as string;
    expect(url).toContain('ns%2Fwith%20slash');
    expect(url).toContain('key%23hash');
  });
});
