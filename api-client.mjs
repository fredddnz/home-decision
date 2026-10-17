/** A per-browser capability avoids third-party-cookie dependence on GitHub Pages. */
export function createAPIClient({ apiOrigin = '', storage, cryptoImpl = globalThis.crypto, fetchImpl = globalThis.fetch } = {}) {
  let origin = '';
  if (apiOrigin) {
    const u = new URL(apiOrigin);
    if (u.username || u.password || u.pathname !== '/' || u.search || u.hash || !(u.protocol === 'https:' || u.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(u.hostname))) throw new Error('Invalid API origin.');
    origin = u.origin;
  }
  return async (path, init = {}) => {
    const target = new URL(path, origin || 'http://local.invalid');
    if (!path.startsWith('/api/') || path.includes('\\') || target.origin !== (origin || 'http://local.invalid') || !target.pathname.startsWith('/api/')) throw new Error('Only an API path can be requested.');
    const headers = new Headers(init.headers);
    if (origin) {
      let token;
      try {
        const saved = storage ?? globalThis.localStorage, key = `home-decision-cloud-session-v1:${origin}`;
        token = saved.getItem(key);
        if (!/^[a-f0-9]{64}$/.test(token ?? '')) {
          token = [...cryptoImpl.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, '0')).join('');
          saved.setItem(key, token);
        }
      } catch { throw new Error('Enable browser storage for this preview so your saved projects remain accessible.'); }
      headers.set('Authorization', `Bearer ${token}`);
    }
    return fetchImpl(origin ? target.href : path, { ...init, headers, credentials: origin ? 'omit' : 'same-origin' });
  };
}
