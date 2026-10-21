// Office API client. Reads are GET, writes are POST text/plain (no CORS preflight).
// Every call resolves to the backend's JSON ({success, ...}) or, when the network / Apps Script
// keeps failing, to {success:false, network:true, error}. Network errors, fetch rejects and
// non-JSON (HTML error page) bodies are retried with back-off; backend answers never are.
const DELAYS = [1000, 2000, 4000, 8000];

export function createApi({ fetch, getToken, backendUrl, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  async function attempt(action, data, method) {
    const body = { action, idToken: await getToken(), data };
    const res = method === 'GET'
      ? await fetch(backendUrl + '?' + new URLSearchParams({ action, idToken: body.idToken, data: JSON.stringify(data) }))
      : await fetch(backendUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) });
    return JSON.parse(await res.text()); // throws on HTML
  }

  async function request(action, data, method) {
    let last;
    try { await getToken(); } catch (e) { return { success: false, code: 'AUTH', error: 'Not authorized: ' + (e && e.message || e) }; }
    for (let i = 0; i <= DELAYS.length; i++) {
      try {
        const out = await attempt(action, data, method);
        if (out && typeof out === 'object') return out;
        last = new Error('Bad response');
      } catch (e) { last = e; }
      if (i < DELAYS.length) await sleep(DELAYS[i]);
    }
    return { success: false, network: true, error: String(last && last.message || last) };
  }

  const seqs = {}, done = {};
  return {
    // key (optional): a response older than the latest completed one for that key resolves {stale:true}.
    async read(action, data, key) {
      const seq = key == null ? 0 : (seqs[key] = (seqs[key] || 0) + 1);
      const out = await request(action, data, 'GET');
      if (key == null) return out;
      if (seq < (done[key] || 0)) return { stale: true };
      done[key] = seq;
      return out;
    },
    write: (action, data) => request(action, data, 'POST'),
  };
}

// Token expiry / sign-in failure: the caller must re-authenticate, not retry.
export const isAuthFailure = (r) => !!r && r.success === false && (r.code === 'AUTH' || /^Not authorized/.test(r.error || ''));
