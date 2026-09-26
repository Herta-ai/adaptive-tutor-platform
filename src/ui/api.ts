let csrf = '';
export async function connect() {
  const hash = new URLSearchParams(location.hash.slice(1));
  const token = hash.get('bootstrap');
  if (token) {
    history.replaceState(null, '', location.pathname);
    const r = await fetch('/api/v1/bootstrap', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const p = await r.json();
    if (!r.ok) throw Error(p.error.message);
    csrf = p.csrf;
  } else {
    const r = await fetch('/api/v1/session');
    const p = await r.json();
    if (!r.ok) throw Error(p.error.message);
    csrf = p.csrf;
  }
}
export async function api(path: string, method = 'GET', payload?: unknown) {
  const response = await fetch('/api/v1' + path, {
    method,
    headers: method === 'GET' ? {} : { 'content-type': 'application/json', 'x-csrf-token': csrf },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok)
    throw Object.assign(new Error(data.error?.message ?? '请求失败'), { code: data.error?.code });
  return data;
}
export const command = (path: string, payload: Record<string, unknown> = {}, method = 'POST') =>
  api(path, method, { clientRequestId: crypto.randomUUID(), ...payload });
export async function uploadLearn(file: File) {
  if (file.size > 100 * 1024 * 1024) throw Error('课程包超过100 MiB');
  const r = await fetch('/api/v1/imports/validate', {
    method: 'POST',
    headers: {
      'content-type': 'application/octet-stream',
      'x-csrf-token': csrf,
      'x-client-request-id': crypto.randomUUID(),
    },
    body: file,
  });
  const data = await r.json();
  if (!r.ok) throw Error(data.error?.message ?? '课程包校验失败');
  return data;
}
export async function subscribe(
  courseId: string,
  sessionId: string | undefined,
  initialCursor: string,
  signal: AbortSignal,
  onEvent: (event: any) => void,
  onRecover: () => Promise<string>,
) {
  let cursor = initialCursor,
    delay = 1000;
  while (!signal.aborted) {
    try {
      const response = await fetch(
        `/api/v1/events?courseId=${encodeURIComponent(courseId)}${sessionId ? '&sessionId=' + encodeURIComponent(sessionId) : ''}&after=${cursor}`,
        { signal },
      );
      if (response.status === 409) {
        cursor = await onRecover();
        continue;
      }
      if (!response.ok || !response.body) throw Error('事件连接失败');
      const reader = response.body.getReader(),
        decoder = new TextDecoder();
      let buffer = '';
      delay = 1000;
      while (!signal.aborted) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let end;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const data = frame
            .split('\n')
            .filter((l) => l.startsWith('data:'))
            .map((l) => l.slice(5).trimStart())
            .join('\n');
          if (!data) continue;
          const event = JSON.parse(data);
          if (BigInt(event.eventId) > BigInt(cursor)) {
            cursor = event.eventId;
            onEvent(event);
          }
        }
      }
    } catch {
      if (signal.aborted) return;
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, delay);
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
    delay = Math.min(delay * 2, 30000);
  }
}
