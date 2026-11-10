"use client";

import { useState } from "react";
import { CodeXml, LoaderCircle, Palette, RefreshCw, SquareTerminal, TimerReset } from "lucide-react";
import { editorLabel, RESCAN_INTERVALS, type Preferences as Prefs } from "@/lib/preferences";
import type { AppChoices, PreferencesInfo } from "@/lib/types";
import { ThemeSetting } from "./ThemeSwitch";
import { Badge, Panel, Segmented, TextButton } from "./ui";
import { reloadPreferences, setPreferences, usePreferences } from "./usePreferences";

async function save(patch: Partial<Prefs>): Promise<PreferencesInfo> {
  const res = await fetch("/api/preferences", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
  return body as PreferencesInfo;
}

/**
 * Settings → Preferences: the editor and terminal workbench hands projects
 * to, the color theme, and how often projects are rescanned. Each choice
 * saves as soon as it's made.
 */
export default function Preferences({ projectsDir }: { projectsDir: string }) {
  const info = usePreferences();
  const [saving, setSaving] = useState<keyof Prefs | null>(null);
  const [error, setError] = useState<{ key: keyof Prefs; message: string } | null>(null);
  const [checking, setChecking] = useState(false);

  const choose = async <K extends keyof Prefs>(key: K, value: Prefs[K]) => {
    if (!info || info.preferences[key] === value) return;
    setSaving(key);
    setError(null);
    try {
      setPreferences(await save({ [key]: value }));
    } catch (e) {
      setError({ key, message: (e as Error).message });
    } finally {
      setSaving(null);
    }
  };

  const checkAgain = async () => {
    setChecking(true);
    await reloadPreferences();
    setChecking(false);
  };

  const errorFor = (key: keyof Prefs) =>
    error?.key === key && (
      <p role="alert" className="px-5 pb-3.5 text-[13px] text-bad">
        {error.message}
      </p>
    );

  const recheck = (
    <TextButton onClick={checkAgain} disabled={checking || !info}>
      {checking ? "Checking…" : "Check again"}
    </TextButton>
  );

  const editor = info ? editorLabel(info.preferences.editor) : "your editor";
  const rescanItems = RESCAN_INTERVALS.map((r) => ({ id: r.id, label: r.label }));

  return (
    <div className="flex flex-col gap-4">
      <Panel
        id="prefs-editor"
        title="Editor"
        icon={CodeXml}
        bodyClassName=""
        description={`Where Open in ${editor}, the O key and changed files open a project.`}
        actions={recheck}
      >
        <AppList
          name="editor"
          choices={info?.editors}
          value={info?.preferences.editor}
          disabled={saving !== null}
          saving={saving === "editor"}
          onChange={(id) => choose("editor", id as Prefs["editor"])}
        />
        {errorFor("editor")}
      </Panel>

      <Panel
        id="prefs-terminal"
        title="Terminal"
        icon={SquareTerminal}
        bodyClassName=""
        description="What the T key and Open in Terminal open, in the project's folder."
        actions={recheck}
      >
        {info?.platform === "other" ? (
          <p className="px-5 py-3.5 text-[13px] text-fg-3">Opening a terminal works on macOS, Linux and Windows.</p>
        ) : (
          <AppList
            name="terminal"
            choices={info?.terminals}
            value={info?.preferences.terminal}
            disabled={saving !== null}
            saving={saving === "terminal"}
            onChange={(id) => choose("terminal", id as Prefs["terminal"])}
          />
        )}
        {errorFor("terminal")}
      </Panel>

      <Panel id="prefs-appearance" title="Appearance" icon={Palette} description="The color theme, also in the top bar. Remembered on this computer.">
        <ThemeSetting />
      </Panel>

      <Panel
        id="prefs-rescan"
        title="Rescan projects"
        icon={TimerReset}
        description={
          <>
            How often <span className="font-mono">{projectsDir}</span> is scanned again while workbench is open. Manual only: when you press{" "}
            <RefreshCw aria-label="Rescan" size={12} className="inline align-[-1px]" /> in the top bar.
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-3">
          {info ? (
            <Segmented label="Rescan interval" items={rescanItems} value={info.preferences.rescan} onChange={(id) => choose("rescan", id)} />
          ) : (
            <Loading />
          )}
          {saving === "rescan" && <LoaderCircle aria-label="Saving" size={16} className="animate-spin text-brand" />}
        </div>
        {error?.key === "rescan" && (
          <p role="alert" className="mt-2 text-[13px] text-bad">
            {error.message}
          </p>
        )}
      </Panel>
    </div>
  );
}

function Loading() {
  return (
    <p className="flex items-center gap-2 text-[13px] text-fg-3">
      <LoaderCircle aria-hidden size={15} className="animate-spin" /> Looking for installed apps…
    </p>
  );
}

/** One choice of app: the installed ones (and the current one, even if it's gone) as radio rows. */
function AppList({
  name,
  choices,
  value,
  disabled,
  saving,
  onChange,
}: {
  name: string;
  choices: AppChoices | undefined;
  value: string | undefined;
  disabled: boolean;
  saving: boolean;
  onChange: (id: string) => void;
}) {
  if (!choices) {
    return (
      <div className="px-5 py-3.5">
        <Loading />
      </div>
    );
  }
  return (
    <>
      <fieldset disabled={disabled}>
        <legend className="sr-only">{name === "editor" ? "Editor" : "Terminal"}</legend>
        <ul className="divide-y divide-line">
          {choices.offered.map((o) => {
            const checked = o.id === value;
            return (
              <li key={o.id}>
                <label className={`flex cursor-pointer items-center gap-3.5 px-5 py-3 transition-colors hover:bg-hover ${checked ? "bg-brand-soft/50" : ""}`}>
                  <input
                    type="radio"
                    name={name}
                    value={o.id}
                    checked={checked}
                    onChange={() => onChange(o.id)}
                    className="size-4 shrink-0 accent-brand"
                  />
                  <span className="min-w-0 flex-1">
                    <span className={`block text-[14px] ${checked ? "font-medium text-fg" : "text-fg"}`}>{o.label}</span>
                    {o.detail && <span className="block text-[12.5px] text-fg-3">{o.detail}</span>}
                  </span>
                  {checked && saving && <LoaderCircle aria-label="Saving" size={16} className="shrink-0 animate-spin text-brand" />}
                  {!o.installed && <Badge tone="warn">Not found</Badge>}
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>
      {choices.missing.length > 0 && (
        <p className="border-t border-line px-5 py-2.5 text-[12.5px] text-fg-3">
          Not found on this computer: {choices.missing.join(", ")}. Install one and press Check again to choose it.
        </p>
      )}
    </>
  );
}
