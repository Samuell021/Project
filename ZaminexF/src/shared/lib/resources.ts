import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "./apiClient";

export type PageResult<T> = { count: number; next: string | null; previous: string | null; results: T[] };
export type FormErrors = Record<string, string>;

function message(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(message).filter(Boolean).join("، ");
  if (value && typeof value === "object") return Object.values(value).map(message).filter(Boolean).join("، ");
  return "";
}

export function formErrors(value: unknown): FormErrors {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { detail: "پاسخ سرور معتبر نیست." };
  return Object.fromEntries(Object.entries(value).map(([key, content]) => [key, message(content)]));
}

export function useResource<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [pending, setPending] = useState(Boolean(url));
  const [error, setError] = useState("");
  const [forbidden, setForbidden] = useState(false);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError("");
    setForbidden(false);
    if (!url) { setPending(false); return () => controller.abort(); }
    setPending(true);
    void (async () => {
      try {
        const response = await apiFetch(url, { signal: controller.signal });
        const body: unknown = await response.json();
        if (controller.signal.aborted) return;
        if (!response.ok) {
          setForbidden(response.status === 403);
          throw new Error(message(body) || "دریافت اطلاعات انجام نشد.");
        }
        setData(body as T);
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "دریافت اطلاعات انجام نشد.");
      } finally {
        if (!controller.signal.aborted) setPending(false);
      }
    })();
    return () => controller.abort();
  }, [url, revision]);
  return { data, pending, error, forbidden, reload };
}

export function useCommand<T>(csrfToken?: string) {
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [conflict, setConflict] = useState(false);
  const active = useRef<Promise<T | null> | null>(null);
  const receipt = useRef<{ signature: string; key: string } | null>(null);
  const execute = useCallback((url: string, payload: object, method: "POST" | "PATCH" | "DELETE" = "POST"): Promise<T | null> => {
    if (active.current) return active.current;
    const body = JSON.stringify(payload);
    const signature = `${method}:${url}:${body}`;
    if (receipt.current?.signature !== signature) receipt.current = { signature, key: crypto.randomUUID() };
    const key = receipt.current.key;
    setPending(true);
    setErrors({});
    setConflict(false);
    const request = (async (): Promise<T | null> => {
      try {
        const response = await apiFetch(url, { method, body, headers: { "Idempotency-Key": key } }, csrfToken);
        const result: unknown = response.status === 204 ? null : await response.json();
        if (!response.ok) {
          setConflict(response.status === 409);
          setErrors(formErrors(result));
          return null;
        }
        receipt.current = null;
        return result as T;
      } catch {
        setErrors({ detail: "ارتباط با سرور برقرار نشد؛ دوباره تلاش کنید." });
        return null;
      } finally {
        active.current = null;
        setPending(false);
      }
    })();
    active.current = request;
    return request;
  }, [csrfToken]);
  return { execute, pending, errors, conflict, clearErrors: () => setErrors({}) };
}
