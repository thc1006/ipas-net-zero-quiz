// Puter 認證流程守門。
//
// 這段以前是「不碰 auth，直接呼叫 puter.ai.chat，讓 SDK 自己隱式跳認證」——
// 我們無法指定要臨時帳號，也讀不到最後是誰在用。改成自己控制之後，
// 最需要被釘住的是：**沒登入時，我們確實有送出 attempt_temp_user_creation**。
// 這個旗標一旦被改掉或漏掉，畫面上看不出差別（照樣會跳認證），只有第一次造訪的
// 使用者會突然被要求註冊 —— 正是這種「安靜壞掉」需要測試。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ensurePuterAuth } from './ai-helper';

type AuthMock = {
  isSignedIn: ReturnType<typeof vi.fn>;
  signIn: ReturnType<typeof vi.fn>;
  getUser: ReturnType<typeof vi.fn>;
};

function installPuter(auth: Partial<AuthMock>): AuthMock {
  const mock: AuthMock = {
    isSignedIn: vi.fn(() => false),
    signIn: vi.fn(async () => ({})),
    getUser: vi.fn(async () => ({ username: 'temp_abc', is_temp: true })),
    ...auth,
  } as AuthMock;
  (window as unknown as { puter?: unknown }).puter = {
    ai: { chat: vi.fn() },
    auth: mock,
    print: vi.fn(),
  };
  return mock;
}

describe('ensurePuterAuth（明確要求臨時帳號）', () => {
  beforeEach(() => {
    delete (window as unknown as { puter?: unknown }).puter;
  });
  afterEach(() => {
    delete (window as unknown as { puter?: unknown }).puter;
    vi.restoreAllMocks();
  });

  it('尚未登入時，必須明確要求建立臨時帳號', async () => {
    const auth = installPuter({});
    const r = await ensurePuterAuth();

    expect(auth.signIn).toHaveBeenCalledTimes(1);
    expect(
      auth.signIn.mock.calls[0][0],
      'signIn 必須帶 attempt_temp_user_creation: true，否則第一次造訪的使用者會被要求註冊'
    ).toEqual({ attempt_temp_user_creation: true });
    expect(r.ok).toBe(true);
    expect(r.isTemporary).toBe(true);
    expect(r.username).toBe('temp_abc');
    expect(r.fellBackToRegularSignIn).toBe(false);
  });

  it('已登入時不重複跳認證', async () => {
    const auth = installPuter({
      isSignedIn: vi.fn(() => true),
      getUser: vi.fn(async () => ({ username: 'real_user', is_temp: false })),
    });
    const r = await ensurePuterAuth();

    expect(auth.signIn).not.toHaveBeenCalled();
    expect(r.ok).toBe(true);
    expect(r.isTemporary).toBe(false);
    // 沒要求過臨時帳號，就不算「退回一般登入」
    expect(r.fellBackToRegularSignIn).toBe(false);
  });

  it('要了臨時帳號卻拿到正式帳號 —— 標記為退回一般登入流程', async () => {
    // 官方限制：瀏覽器已有 Puter 使用紀錄／舊 session 時，仍可能轉向一般登入或註冊
    installPuter({
      getUser: vi.fn(async () => ({ username: 'someone', is_temp: false })),
    });
    const r = await ensurePuterAuth();

    expect(r.ok).toBe(true);
    expect(r.isTemporary).toBe(false);
    expect(r.fellBackToRegularSignIn).toBe(true);
  });

  it('使用者關掉認證視窗 —— 回可讀的錯誤，不是丟例外', async () => {
    installPuter({
      signIn: vi.fn(async () => {
        throw { code: 'user_cancelled', msg: 'cancelled' };
      }),
    });
    const r = await ensurePuterAuth();

    expect(r.ok).toBe(false);
    expect(r.error).toContain('再試一次');
  });

  it('彈窗被瀏覽器封鎖 —— 提示允許彈出式視窗', async () => {
    installPuter({
      signIn: vi.fn(async () => {
        throw { code: 'popup_blocked' };
      }),
    });
    const r = await ensurePuterAuth();

    expect(r.ok).toBe(false);
    expect(r.error).toContain('彈出式視窗');
  });

  it('併發點擊只跳一次認證視窗', async () => {
    // 結果頁每張錯題卡都有自己的 AI 按鈕。連點兩張若各跳一個認證視窗，
    // 第二個通常還會被瀏覽器當成非使用者觸發而擋掉。
    let resolveSignIn: (v?: unknown) => void = () => {};
    const auth = installPuter({
      signIn: vi.fn(
        () =>
          new Promise((res) => {
            resolveSignIn = res;
          })
      ),
    });

    const a = ensurePuterAuth();
    const b = ensurePuterAuth();
    // 等 signIn 真的被呼叫再放行：載 SDK 是 await，太早 resolve 會抓到還沒被指派的 resolver
    await vi.waitFor(() => expect(auth.signIn).toHaveBeenCalled());
    resolveSignIn();
    const [ra, rb] = await Promise.all([a, b]);

    expect(auth.signIn).toHaveBeenCalledTimes(1);
    expect(ra.ok).toBe(true);
    expect(rb.ok).toBe(true);
  });

  it('認證成功但讀不到使用者資訊時，仍讓使用者用得到 AI', async () => {
    // getUser() 只是拿來記錄身分與判斷是否臨時帳號，它失敗不代表認證失敗
    installPuter({
      getUser: vi.fn(async () => {
        throw new Error('network');
      }),
    });
    const r = await ensurePuterAuth();

    expect(r.ok).toBe(true);
    expect(r.username).toBeUndefined();
    // 讀不到就不該亂猜「退回一般登入」
    expect(r.fellBackToRegularSignIn).toBe(false);
  });

  it('SDK 不可用時安全失敗（不呼叫任何 auth API）', async () => {
    // 先放一個 puter script 標籤，讓 loadPuterSDK 走「等待既有標籤」那條分支，
    // 再用假時鐘直接走完它的 10 秒等待 —— 不必真的等。
    const tag = document.createElement('script');
    tag.src = 'https://js.puter.com/v2/';
    document.head.appendChild(tag);
    vi.useFakeTimers();

    const pending = ensurePuterAuth();
    await vi.advanceTimersByTimeAsync(10_100);
    const r = await pending;

    vi.useRealTimers();
    tag.remove();

    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  });
});
