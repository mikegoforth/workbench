import { afterEach, describe, expect, it, vi } from "vitest";
import { openInEditor, openInTerminal } from "./openInEditor";

// The browser side of "Open in VS Code / Terminal": it only POSTs to /api/open,
// so fetch is stubbed and no app is ever launched.

function stubFetch(response: { ok: boolean; json?: () => Promise<unknown> }) {
  const fetchMock = vi.fn().mockResolvedValue({ json: () => Promise.resolve({}), ...response });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("openInEditor", () => {
  it("posts the project and file to /api/open", async () => {
    const fetchMock = stubFetch({ ok: true });
    await expect(openInEditor("alpha", "src/index.ts")).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/open");
    expect(init).toMatchObject({ method: "POST", headers: { "Content-Type": "application/json" } });
    expect(JSON.parse(init.body)).toEqual({ projectName: "alpha", file: "src/index.ts" });
  });

  it("leaves the file out when opening the whole project", async () => {
    const fetchMock = stubFetch({ ok: true });
    await openInEditor("alpha");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ projectName: "alpha" });
  });

  it("throws the server's error message", async () => {
    stubFetch({ ok: false, json: () => Promise.resolve({ error: "VS Code isn't installed" }) });
    await expect(openInEditor("alpha")).rejects.toThrow("VS Code isn't installed");
  });

  it("falls back to a generic message when the error has no message", async () => {
    stubFetch({ ok: false, json: () => Promise.resolve({}) });
    await expect(openInEditor("alpha")).rejects.toThrow("Couldn't open VS Code");
  });

  it("falls back to a generic message when the error body isn't JSON", async () => {
    stubFetch({ ok: false, json: () => Promise.reject(new SyntaxError("Unexpected token <")) });
    await expect(openInEditor("alpha")).rejects.toThrow("Couldn't open VS Code");
  });
});

describe("openInTerminal", () => {
  it("asks for the terminal app", async () => {
    const fetchMock = stubFetch({ ok: true });
    await openInTerminal("alpha");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ projectName: "alpha", app: "terminal" });
  });

  it("throws with its own fallback message", async () => {
    stubFetch({ ok: false, json: () => Promise.resolve(null) });
    await expect(openInTerminal("alpha")).rejects.toThrow("Couldn't open Terminal");
  });
});
