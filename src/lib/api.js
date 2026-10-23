/* /api 호출 — 실패하면 ApiError(status, message=서버 detail, requestId) 를 던진다 */
export class ApiError extends Error {
  constructor(status, message, requestId) {
    super(message);
    this.status = status;
    this.requestId = requestId ?? null;
  }
}

async function request(path, options = {}) {
  // 샘플 빌드(--mode sample)만 픽스처를 읽는다. 운영 빌드에서는 상수 폴딩으로 이 줄과 api.sample.js 가 빠진다
  if (import.meta.env.VITE_SAMPLE) return (await import("./api.sample.js")).request(path, options);
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    headers: { "content-type": "application/json", ...options.headers },
    ...options,
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      message = body.detail || message;
    } catch {
      /* JSON 본문 없음 */
    }
    throw new ApiError(res.status, message, res.headers.get("x-request-id"));
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  get: (path) => request(path),
  post: (path, data) => request(path, { method: "POST", body: JSON.stringify(data) }),
  put: (path, data) => request(path, { method: "PUT", body: JSON.stringify(data) }),
};
