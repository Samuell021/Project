import { useCallback, useEffect, useRef, useState } from "react";
import { apiErrorMessage, apiFetch, readJson } from "../../../shared/lib/apiClient";
import type { Row } from "../types";

export function useLoad(urls: string[], csrfToken: string, deps: unknown[] = []) {
  const [data, setData] = useState<Record<string, any>>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const requestSequence = useRef(0);
  const activeController = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    activeController.current?.abort();
    const controller = new AbortController();
    activeController.current = controller;
    const requestId = ++requestSequence.current;
    setLoading(true);
    setError("");
    try {
      const out: Record<string, any> = {};
      for (const url of urls.filter(Boolean)) {
        const collected: any[] = [];
        const visited = new Set<string>();
        const initialUrl = new URL(url, window.location.origin);
        if (!initialUrl.searchParams.has("page_size")) initialUrl.searchParams.set("page_size", "100");
        let nextUrl: string | null = `${initialUrl.pathname}${initialUrl.search}`;
        while (nextUrl) {
          if (visited.has(nextUrl)) throw new Error("پاسخ صفحه‌بندی سرور معتبر نیست.");
          visited.add(nextUrl);
          const res = await apiFetch(nextUrl, { method: "GET", signal: controller.signal }, csrfToken);
          const body = await readJson(res);
          if (!res.ok) throw new Error(apiErrorMessage(body, "خطا در دریافت اطلاعات"));
          if (Array.isArray(body)) {
            out[url] = body;
            nextUrl = null;
          } else if (Array.isArray(body?.results)) {
            collected.push(...body.results);
            if (!body.next) {
              out[url] = collected;
              nextUrl = null;
            } else {
              const parsedNext = new URL(body.next, window.location.origin);
              if (!parsedNext.pathname.startsWith("/")) throw new Error("پیوند صفحه‌بندی سرور معتبر نیست.");
              nextUrl = `${parsedNext.pathname}${parsedNext.search}`;
            }
          } else {
            out[url] = body;
            nextUrl = null;
          }
        }
      }
      if (requestId === requestSequence.current) setData(out);
    } catch (e) {
      if (!controller.signal.aborted && requestId === requestSequence.current) {
        setError(e instanceof Error ? e.message : "خطا در دریافت اطلاعات");
      }
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }, [csrfToken, urls.join("|")]);
  useEffect(() => {
    void load();
    return () => {
      activeController.current?.abort();
      requestSequence.current += 1;
    };
  }, [load, ...deps]);
  return { data, error, loading, reload: load };
}
