"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { applyThemePref, readThemePref, type ThemePref } from "@/lib/theme";
import { Menu } from "./ui";

const CHANGE_EVENT = "workbench-theme-change";

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

const OPTIONS: { value: ThemePref; label: string; Icon: typeof Sun }[] = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "Use system setting", Icon: Monitor },
];

/** Appearance menu in the top bar: light, dark, or follow the system. */
export default function ThemeSwitch() {
  // Server renders "system"; the stored choice takes over after hydration.
  const pref = useSyncExternalStore(subscribe, readThemePref, () => "system" as ThemePref);

  // While following the system, follow it live.
  useEffect(() => {
    if (pref !== "system") return;
    const media = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyThemePref("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [pref]);

  const choose = (value: ThemePref) => {
    applyThemePref(value);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  };

  const current = OPTIONS.find((o) => o.value === pref) ?? OPTIONS[2];
  return (
    <Menu
      label={`Appearance: ${current.label}`}
      icon={current.Icon}
      size="md"
      items={OPTIONS.map((o) => ({ label: o.label, icon: o.Icon, checked: o.value === pref, onSelect: () => choose(o.value) }))}
    />
  );
}
