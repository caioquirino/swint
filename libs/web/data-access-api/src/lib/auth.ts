/** Indirection so tests can observe full-page navigations. */
export const navigation = {
  assign(url: string): void {
    window.location.assign(url);
  },
};

export function loginUrl(returnTo: string): string {
  return `/auth/login?returnTo=${encodeURIComponent(returnTo)}`;
}

/** POST /auth/logout with no body and no content-type (the API rejects empty JSON bodies). */
export async function logout(fetchImpl: typeof fetch = (i, init) => globalThis.fetch(i, init)): Promise<string> {
  try {
    const res = await fetchImpl('/auth/logout', { method: 'POST', credentials: 'same-origin' });
    if (!res.ok) return '/';
    const body = (await res.json()) as { redirectUrl?: unknown };
    return typeof body.redirectUrl === 'string' ? body.redirectUrl : '/';
  } catch {
    return '/';
  }
}
