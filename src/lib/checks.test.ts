import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// `node --version` is mocked so the Node check doesn't depend on the machine.
// checks.ts looks it up once per module instance, so each test imports a fresh copy.
const { execFile } = vi.hoisted(() => ({ execFile: vi.fn() }));
vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return { ...actual, default: { ...actual, execFile }, execFile };
});

type Callback = (err: Error | null, result?: { stdout: string; stderr: string }) => void;

/** Make `node --version` print this, or fail when null. */
function nodeVersion(stdout: string | null) {
  execFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Callback) => {
    if (stdout === null) cb(new Error("spawn node ENOENT"));
    else cb(null, { stdout, stderr: "" });
  });
}

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "workbench-checks-")));
let dir: string;
let n = 0;

function write(files: Record<string, string>) {
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
}

const opts: { pm: string; composeFile: string | null; composeError: string | null } = { pm: "npm", composeFile: null, composeError: null };

async function run(o: Partial<typeof opts> = {}) {
  vi.resetModules();
  const { runChecks } = await import("./checks");
  return runChecks(dir, { ...opts, ...o });
}

async function check(id: string, o: Partial<typeof opts> = {}) {
  return (await run(o)).find((c) => c.id === id);
}

beforeEach(() => {
  dir = path.join(root, `p${n++}`);
  fs.mkdirSync(dir);
  execFile.mockReset();
  nodeVersion("v22.12.0\n");
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("runChecks", () => {
  it("has nothing to say about an empty folder", async () => {
    expect(await run()).toEqual([]);
    // No version file, so Node isn't even looked up.
    expect(execFile).not.toHaveBeenCalled();
  });

  it("returns checks in order: deps, env, node, compose", async () => {
    fs.mkdirSync(path.join(dir, "node_modules"));
    write({ "package.json": "{}", ".env.example": "A=1", ".env": "A=2", ".nvmrc": "22" });
    const checks = await run({ composeFile: "compose.yaml", composeError: "bad" });
    expect(checks.map((c) => c.id)).toEqual(["deps", "env", "node", "compose"]);
  });
});

describe("dependencies", () => {
  it("is ok when node_modules exists", async () => {
    write({ "package.json": "{}" });
    fs.mkdirSync(path.join(dir, "node_modules"));
    expect(await check("deps")).toEqual({ id: "deps", level: "ok", title: "Dependencies installed" });
  });

  it("offers to install with the project's package manager", async () => {
    write({ "package.json": "{}" });
    expect(await check("deps", { pm: "pnpm" })).toEqual({
      id: "deps",
      level: "warn",
      title: "Dependencies not installed",
      detail: "There's no node_modules folder, so the dev script will fail.",
      action: { kind: "install", label: "Run pnpm install" },
    });
  });

  it("is skipped without a package.json", async () => {
    fs.mkdirSync(path.join(dir, "node_modules"));
    expect(await check("deps")).toBeUndefined();
  });
});

describe("env", () => {
  it("lists what the example asks for when there's no .env", async () => {
    write({ ".env.example": "# Database\nDATABASE_URL=postgres://\nexport API_KEY=\n  PORT = 3000\nnot a var\n" });
    expect(await check("env")).toEqual({
      id: "env",
      level: "warn",
      title: "No .env file",
      detail: ".env.example lists 3 variables: DATABASE_URL, API_KEY, PORT",
      action: { kind: "open", label: "Open .env.example", file: ".env.example" },
    });
  });

  it("says 1 variable, not 1 variables", async () => {
    write({ ".env.sample": "ONLY=1" });
    expect((await check("env"))?.detail).toBe(".env.sample lists 1 variable: ONLY");
  });

  it("shortens a long list", async () => {
    write({ ".env.template": Array.from({ length: 11 }, (_, i) => `K${i}=`).join("\n") });
    expect((await check("env"))?.detail).toBe(".env.template lists 11 variables: K0, K1, K2, K3, K4, K5, K6, K7 and 3 more");
  });

  it("handles an example with no variables", async () => {
    write({ ".env.example": "# nothing yet\n" });
    expect((await check("env"))?.detail).toBe("There's a .env.example but no .env.");
  });

  it("treats an unreadable example as empty", async () => {
    // A folder named .env.example exists but can't be read as a file.
    fs.mkdirSync(path.join(dir, ".env.example"));
    expect((await check("env"))?.detail).toBe("There's a .env.example but no .env.");
  });

  it("prefers .env.example over the other example names", async () => {
    write({ ".env.example": "A=", ".env.sample": "B=" });
    expect((await check("env"))?.detail).toBe(".env.example lists 1 variable: A");
  });

  it("names the variables missing across every env file", async () => {
    write({
      ".env.example": "A=\nB=\nC=\nD.E=\n",
      ".env.local": "A=1\n",
      ".env.development": "D.E=1\n",
    });
    expect(await check("env")).toEqual({
      id: "env",
      level: "warn",
      title: "2 variables from .env.example not set",
      detail: "Missing from .env.local, .env.development: B, C",
      action: { kind: "open", label: "Open .env.local", file: ".env.local" },
    });
  });

  it("says 1 variable when one is missing", async () => {
    write({ ".env.example": "A=\nB=\n", ".env": "export A=1\n" });
    expect(await check("env")).toMatchObject({ title: "1 variable from .env.example not set", detail: "Missing from .env: B" });
  });

  it("is ok when every variable is set somewhere", async () => {
    write({ ".env.example": "A=\nB=\n", ".env": "A=1\n", ".env.development.local": "B=2\n" });
    expect(await check("env")).toEqual({ id: "env", level: "ok", title: "Every variable in .env.example is set" });
  });

  it("is skipped without an example file", async () => {
    write({ ".env": "A=1" });
    expect(await check("env")).toBeUndefined();
  });
});

describe("node", () => {
  it.each([
    ["22", "v22.12.0\n", "Node 22.12.0 matches .nvmrc (22)"],
    ["v22.12", "v22.12.0\n", "Node 22.12.0 matches .nvmrc (22.12)"],
    ["22.12.0\n", "v22.12.0\n", "Node 22.12.0 matches .nvmrc (22.12.0)"],
    ["22 # pinned for CI", "v22.3.1", "Node 22.3.1 matches .nvmrc (22)"],
  ])("accepts .nvmrc %j with Node %j", async (nvmrc, installed, title) => {
    nodeVersion(installed);
    write({ ".nvmrc": nvmrc });
    expect(await check("node")).toEqual({ id: "node", level: "ok", title });
    expect(execFile).toHaveBeenCalledWith("node", ["--version"], { timeout: 5_000, windowsHide: true }, expect.any(Function));
  });

  it.each([
    ["20", "v22.12.0"],
    // 22.1 is not a prefix of 22.12.0.
    ["22.1", "v22.12.0"],
    ["22.12.1", "v22.12.0"],
  ])("warns when .nvmrc %j doesn't match Node %j", async (nvmrc, installed) => {
    nodeVersion(installed);
    write({ ".nvmrc": nvmrc });
    expect(await check("node")).toEqual({
      id: "node",
      level: "warn",
      title: `.nvmrc wants Node ${nvmrc}`,
      detail: "Start will use Node 22.12.0, the version on PATH.",
    });
  });

  it("reads .node-version too", async () => {
    write({ ".node-version": "24.1.0" });
    expect(await check("node")).toMatchObject({ level: "warn", title: ".node-version wants Node 24.1.0" });
  });

  it("can't check nvm aliases", async () => {
    write({ ".nvmrc": "lts/iron" });
    expect(await check("node")).toEqual({
      id: "node",
      level: "info",
      title: '.nvmrc asks for "lts/iron"',
      detail: "Can't check aliases here. Start will use Node 22.12.0.",
    });
  });

  it("warns when Node isn't on PATH", async () => {
    nodeVersion(null);
    write({ ".nvmrc": "v22" });
    expect(await check("node")).toEqual({ id: "node", level: "warn", title: "Node isn't on PATH", detail: ".nvmrc asks for 22." });
  });

  it("looks up Node only once", async () => {
    write({ ".nvmrc": "22" });
    vi.resetModules();
    const { runChecks } = await import("./checks");
    await runChecks(dir, opts);
    await runChecks(dir, opts);
    expect(execFile).toHaveBeenCalledTimes(1);
  });
});

describe("compose", () => {
  it("warns when the compose file doesn't load", async () => {
    expect(await check("compose", { composeFile: "docker-compose.yml", composeError: "services.web.ports must be a list" })).toEqual({
      id: "compose",
      level: "warn",
      title: "docker-compose.yml doesn't load",
      detail: "services.web.ports must be a list",
      action: { kind: "open", label: "Open docker-compose.yml", file: "docker-compose.yml" },
    });
  });

  it("says nothing when it loads or there is none", async () => {
    expect(await check("compose", { composeFile: "compose.yaml", composeError: null })).toBeUndefined();
    expect(await check("compose", { composeFile: null, composeError: "stray error" })).toBeUndefined();
  });
});
