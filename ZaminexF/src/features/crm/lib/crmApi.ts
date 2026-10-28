import { apiErrorMessage, apiFetch, readJson } from "../../../shared/lib/apiClient";
import type { Row } from "../types";

export async function patchRecord(csrfToken: string, url: string, body: Row = {}) {
  const res = await apiFetch(url, { method: "PATCH", body: JSON.stringify(body) }, csrfToken);
  const data = await readJson(res);
  if (!res.ok) throw new Error(apiErrorMessage(data, "عملیات ناموفق بود"));
  return data;
}

type PendingPost = { key: string; expiresAt: number };
const pendingPostKeys = new Map<string, PendingPost>();
const inFlightPosts = new Map<string, Promise<any>>();

export function newIdempotencyKey() {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function post(csrfToken: string, url: string, body: Row = {}) {
  const serializedBody = JSON.stringify(body);
  const signature = `${url}\n${serializedBody}`;
  const inFlight = inFlightPosts.get(signature);
  if (inFlight) return inFlight;

  const cached = pendingPostKeys.get(signature);
  const idempotencyKey = cached && cached.expiresAt > Date.now()
    ? cached.key
    : newIdempotencyKey();
  pendingPostKeys.set(signature, { key: idempotencyKey, expiresAt: Date.now() + 120_000 });

  const request = (async () => {
    const res = await apiFetch(url, {
      method: "POST",
      body: serializedBody,
      headers: { "Idempotency-Key": idempotencyKey },
    }, csrfToken);
    const data = await readJson(res);
    if (!res.ok) {
      if (res.status >= 400 && res.status < 500) pendingPostKeys.delete(signature);
      throw new Error(apiErrorMessage(data, "عملیات ناموفق بود"));
    }
    pendingPostKeys.delete(signature);
    return data;
  })();

  inFlightPosts.set(signature, request);
  try {
    return await request;
  } finally {
    if (inFlightPosts.get(signature) === request) inFlightPosts.delete(signature);
  }
}

export async function patch(csrfToken: string, url: string, body: Row = {}) {
  const res = await apiFetch(url, {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Idempotency-Key": newIdempotencyKey() },
  }, csrfToken);
  const data = await readJson(res);
  if (!res.ok) throw new Error(apiErrorMessage(data, "ذخیره تغییرات ناموفق بود"));
  return data;
}

const inFlightUploads = new Map<string, Promise<any>>();
const retryableUploadKeys = new Map<string, PendingPost>();

export async function postForm(csrfToken: string, url: string, formData: FormData) {
  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("فایل قرارداد را انتخاب کنید.");
  if (file.size > 10 * 1024 * 1024) throw new Error("حداکثر حجم پیوست قرارداد ۱۰ مگابایت است.");
  const fileDigest = typeof crypto !== "undefined" && crypto.subtle
    ? Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer())))
        .map((byte) => byte.toString(16).padStart(2, "0")).join("")
    : `${file.name}:${file.size}:${file.lastModified}`;
  const signature = `${url}\n${String(formData.get("document_type") || "").trim()}\n${fileDigest}`;
  const inFlight = inFlightUploads.get(signature);
  if (inFlight) return inFlight;

  const cached = retryableUploadKeys.get(signature);
  const idempotencyKey = cached && cached.expiresAt > Date.now()
    ? cached.key
    : newIdempotencyKey();
  retryableUploadKeys.set(signature, { key: idempotencyKey, expiresAt: Date.now() + 120_000 });

  const request = (async () => {
    const res = await apiFetch(url, {
      method: "POST",
      body: formData,
      headers: { "Idempotency-Key": idempotencyKey },
    }, csrfToken);
    const data = await readJson(res);
    if (!res.ok) {
      if (res.status >= 400 && res.status < 500) retryableUploadKeys.delete(signature);
      throw new Error(apiErrorMessage(data, "بارگذاری پیوست ناموفق بود"));
    }
    retryableUploadKeys.delete(signature);
    return data;
  })();

  inFlightUploads.set(signature, request);
  try {
    return await request;
  } finally {
    if (inFlightUploads.get(signature) === request) inFlightUploads.delete(signature);
  }
}
