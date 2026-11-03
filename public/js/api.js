// Dunne laag rond fetch. Fouten van de server komen terug als ApiError met de Nederlandse melding.

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error ?? `Er ging iets mis (${status}).`);
    this.status = status;
    this.body = body ?? {};
  }
}

async function request(method, url, body) {
  const isForm = body instanceof FormData;
  const res = await fetch(`/api${url}`, {
    method,
    headers: body && !isForm ? { 'content-type': 'application/json' } : {},
    body: isForm ? body : body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = (res.headers.get('content-type') ?? '').includes('json') ? await res.json() : null;
  if (res.status === 401 && url !== '/login') {
    window.dispatchEvent(new CustomEvent('jcs:uitgelogd'));
  }
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body) => request('POST', url, body ?? {}),
  put: (url, body) => request('PUT', url, body),
  patch: (url, body) => request('PATCH', url, body),
  del: (url, body) => request('DELETE', url, body),
};

// Gedeelde gegevens (kanalen, statussen, rechten, ingelogde gebruiker), geladen bij het opstarten.
export const meta = { channels: [], calendarStatuses: [], planStatuses: [], roles: [], permissions: {}, ai: {}, user: null };

export async function loadMeta() {
  Object.assign(meta, await api.get('/meta'));
  return meta;
}

export const can = (permission) => Boolean(meta.user && meta.permissions[permission]?.includes(meta.user.role));
export const channelLabel = (key) => meta.channels.find((c) => c.key === key)?.label ?? key;
export const statusLabel = (key) => meta.calendarStatuses.find((s) => s.key === key)?.label ?? key;
// Kleur, tekstkleur en vetgedrukt van een kleurstatus, als CSS-variabelen voor style.
export function statusStyle(key) {
  const s = meta.calendarStatuses.find((x) => x.key === key);
  return s ? { '--kleur': s.color, '--kleur-tekst': s.text, '--kleur-gewicht': s.bold ? '700' : '400' } : {};
}
export const roleLabel = (key) => meta.roles.find((r) => r.key === key)?.label ?? key;
