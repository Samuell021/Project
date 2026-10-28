import { useCallback, useEffect, useState } from "react";

export function usePageQuery() {
  const [search, setSearch] = useState(() => typeof window === "undefined" ? "" : window.location.search);
  useEffect(() => {
    const sync = () => setSearch(window.location.search);
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  const update = useCallback((values: Record<string, string | null>, replace = false) => {
    const url = new URL(window.location.href);
    for (const [key, value] of Object.entries(values)) {
      if (value === null || value === "") url.searchParams.delete(key);
      else url.searchParams.set(key, value);
    }
    if (replace) window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
    else window.history.pushState(window.history.state, "", `${url.pathname}${url.search}`);
    setSearch(url.search);
  }, []);
  const query = new URLSearchParams(search);
  const rawPage = Number(query.get("page") || "1");
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  return { query, update, page };
}
