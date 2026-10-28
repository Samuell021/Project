import React from "react";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, renderHook, waitFor } from "@testing-library/react";
import { useCommand, useResource } from "./resources";
import { usePageQuery } from "./pageQuery";

let dom: JSDOM;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  dom = new JSDOM("<html><body></body></html>", { url: "https://crm.example.test/app/consultants/" });
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("navigator", dom.window.navigator);
});

afterEach(() => { cleanup(); dom.window.close(); vi.unstubAllGlobals(); });

describe("shared resource and command lifecycle", () => {
  it("ignores an aborted response after the URL changes", async () => {
    let resolveOld: (response: Response) => void = () => {};
    const old = new Promise<Response>((resolve) => { resolveOld = resolve; });
    vi.stubGlobal("fetch", vi.fn((url: string) => url.includes("old") ? old : Promise.resolve(json({ name: "تازه" }))));
    const hook = renderHook(({ url }) => useResource<{ name: string }>(url), { initialProps: { url: "/old/" } });
    hook.rerender({ url: "/new/" });
    await waitFor(() => expect(hook.result.current.data?.name).toBe("تازه"));
    await act(async () => { resolveOld(json({ name: "کهنه" })); await old; });
    expect(hook.result.current.data?.name).toBe("تازه");
  });

  it("reports forbidden resources and supports a successful retry", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({ detail: "دسترسی مجاز نیست" }, 403)).mockResolvedValueOnce(json({ count: 1 }));
    vi.stubGlobal("fetch", fetch);
    const hook = renderHook(() => useResource<{ count: number }>("/resource/"));
    await waitFor(() => expect(hook.result.current.forbidden).toBe(true));
    expect(hook.result.current.error).toBe("دسترسی مجاز نیست");
    act(() => hook.result.current.reload());
    await waitFor(() => expect(hook.result.current.data?.count).toBe(1));
    expect(hook.result.current.forbidden).toBe(false);
  });

  it("reuses an idempotency key after network failure and forwards the version", async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce(json({ id: 4, version: 3 }));
    vi.stubGlobal("fetch", fetch);
    const hook = renderHook(() => useCommand<{ id: number; version: number }>("csrf-value"));
    await act(async () => { await hook.result.current.execute("/record/4/", { version: 2 }, "PATCH"); });
    expect(hook.result.current.errors.detail).toContain("ارتباط");
    await act(async () => { await hook.result.current.execute("/record/4/", { version: 2 }, "PATCH"); });
    const first = fetch.mock.calls[0][1] as RequestInit;
    const second = fetch.mock.calls[1][1] as RequestInit;
    expect(new Headers(first.headers).get("Idempotency-Key")).toBe(new Headers(second.headers).get("Idempotency-Key"));
    expect(new Headers(second.headers).get("X-CSRFToken")).toBe("csrf-value");
    expect(JSON.parse(String(second.body))).toEqual({ version: 2 });
    expect(hook.result.current.errors).toEqual({});
  });

  it("prevents concurrent duplicate requests and exposes Persian conflicts", async () => {
    let complete: (response: Response) => void = () => {};
    const pending = new Promise<Response>((resolve) => { complete = resolve; });
    const fetch = vi.fn().mockReturnValue(pending);
    vi.stubGlobal("fetch", fetch);
    const hook = renderHook(() => useCommand());
    let first: Promise<unknown> | undefined;
    act(() => {
      first = hook.result.current.execute("/record/", { version: 1 }, "PATCH");
      expect(hook.result.current.execute("/record/", { version: 1 }, "PATCH")).toBe(first);
    });
    expect(hook.result.current.pending).toBe(true);
    await act(async () => { complete(json({ detail: "اطلاعات تغییر کرده است" }, 409)); await first; });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(hook.result.current.conflict).toBe(true);
    expect(hook.result.current.pending).toBe(false);
  });

  it("keeps list and detail state in the URL and responds to history", () => {
    const hook = renderHook(usePageQuery);
    act(() => hook.result.current.update({ search: "نام", page: "2", staff: "4" }));
    expect(hook.result.current.page).toBe(2);
    expect(hook.result.current.query.get("staff")).toBe("4");
    act(() => {
      window.history.replaceState({}, "", "/app/consultants/?search=نام&page=2");
      window.dispatchEvent(new dom.window.PopStateEvent("popstate"));
    });
    expect(hook.result.current.query.get("staff")).toBeNull();
    expect(hook.result.current.query.get("search")).toBe("نام");
  });
});
