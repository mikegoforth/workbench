"use client";

import { useState } from "react";
import { ArrowLeft, ArrowRight, Check, LoaderCircle, RefreshCw } from "lucide-react";
import type { ProjectsDirInfo, RequirementsResult } from "@/lib/types";
import ProjectsFolder from "./ProjectsFolder";
import RequirementList from "./Requirements";
import { Button, Card, Logo, PropertyList, TextButton } from "./ui";

const STEPS = ["Requirements", "Projects folder", "Finish"] as const;

/**
 * First-run setup: check what's installed, choose the projects folder, then
 * open the dashboard. Also reachable later from Settings → Setup.
 */
export default function Setup({
  requirements,
  checking,
  onRecheck,
  dirInfo,
  onFolderSaved,
  projectCount,
  scanning,
  alreadySetUp,
  onFinish,
  onClose,
}: {
  requirements: RequirementsResult;
  checking: boolean;
  onRecheck: () => void;
  dirInfo: ProjectsDirInfo | null;
  onFolderSaved: (info: ProjectsDirInfo) => void;
  projectCount: number;
  scanning: boolean;
  /** Setup was finished before (shown again because something required went missing, or from Settings). */
  alreadySetUp: boolean;
  onFinish: () => Promise<void>;
  /** Leave without finishing; only offered when setup was finished before. */
  onClose: () => void;
}) {
  const [step, setStep] = useState(0);
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);

  const required = requirements.requirements.filter((r) => !r.optional);
  const missing = required.filter((r) => !r.ok);
  const folderReady = !!dirInfo?.exists;

  const finish = async () => {
    setFinishing(true);
    setFinishError(null);
    try {
      await onFinish();
    } catch (e) {
      setFinishError((e as Error).message);
      setFinishing(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:py-12">
      <div className="mb-6 flex items-center gap-3">
        <Logo />
        <h1 className="text-[22px] leading-tight text-fg">{alreadySetUp ? "workbench setup" : "Set up workbench"}</h1>
        {alreadySetUp && (
          <TextButton onClick={onClose} className="ml-auto">
            Close
          </TextButton>
        )}
      </div>

      <ol className="mb-6 flex items-center gap-2" aria-label="Setup steps">
        {STEPS.map((label, i) => {
          const done = i < step;
          const current = i === step;
          return (
            <li key={label} className="flex min-w-0 flex-1 items-center gap-2 last:flex-none">
              <button
                type="button"
                onClick={() => done && setStep(i)}
                disabled={!done}
                aria-current={current ? "step" : undefined}
                className={`flex min-w-0 items-center gap-2 rounded text-[13px] ${done ? "cursor-pointer hover:underline" : "cursor-default"}`}
              >
                <span
                  className={`grid size-6 shrink-0 place-items-center rounded-full text-[12px] font-medium ${
                    done ? "bg-ok text-on-brand" : current ? "bg-brand text-on-brand" : "border border-line text-fg-3"
                  }`}
                >
                  {done ? <Check aria-hidden size={14} strokeWidth={3} /> : i + 1}
                </span>
                <span className={`truncate ${current ? "font-medium text-fg" : "text-fg-2"}`}>{label}</span>
              </button>
              {i < STEPS.length - 1 && <span aria-hidden className={`h-px min-w-4 flex-1 ${done ? "bg-ok" : "bg-line"}`} />}
            </li>
          );
        })}
      </ol>

      {step === 0 && (
        <>
          <p className="mb-3 text-[13.5px] text-fg-2">
            {missing.length === 0
              ? "Everything workbench needs is installed."
              : `${missing.length === 1 ? "One thing" : `${missing.length} things`} workbench needs ${missing.length === 1 ? "is" : "are"} missing. Install ${missing.length === 1 ? "it" : "them"}, then check again.`}
          </p>
          <Card>
            <RequirementList requirements={requirements.requirements} />
          </Card>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button icon={checking ? LoaderCircle : RefreshCw} spin={checking} disabled={checking} onClick={onRecheck}>
              Check again
            </Button>
            {!requirements.ok && (
              <TextButton onClick={() => (alreadySetUp ? onClose() : setStep(1))}>Continue without them</TextButton>
            )}
            <Button variant="primary" icon={ArrowRight} className="ml-auto flex-row-reverse" disabled={!requirements.ok} onClick={() => setStep(1)}>
              Continue
            </Button>
          </div>
          {!requirements.ok && (
            <p className="mt-3 text-[12.5px] text-fg-3">
              Just installed something? Check again. If it still isn&apos;t found, quit and reopen workbench so it picks up the new PATH.
            </p>
          )}
        </>
      )}

      {step === 1 && (
        <>
          <p className="mb-3 text-[13.5px] text-fg-2">Choose the folder that holds your projects. Each folder directly inside it becomes a project.</p>
          <ProjectsFolder info={dirInfo} onSaved={onFolderSaved} />
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button variant="ghost" icon={ArrowLeft} onClick={() => setStep(0)}>
              Back
            </Button>
            {!folderReady && <p className="text-[12.5px] text-fg-3">Pick a folder that exists to continue.</p>}
            <Button variant="primary" icon={ArrowRight} className="ml-auto flex-row-reverse" disabled={!folderReady} onClick={() => setStep(2)}>
              Continue
            </Button>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <p className="mb-3 text-[13.5px] text-fg-2">You&apos;re ready. You can change any of this later under Settings.</p>
          <Card>
            <PropertyList
              rows={[
                { label: "Projects folder", value: <span className="font-mono text-[12.5px]">{dirInfo?.display ?? "—"}</span> },
                { label: "Projects found", value: scanning ? "Scanning…" : projectCount },
                {
                  label: "Installed",
                  value:
                    requirements.requirements
                      .filter((r) => r.ok)
                      .map((r) => (r.found ? `${r.name} ${r.found}` : r.name))
                      .join(" · ") || "—",
                },
                ...(requirements.requirements.some((r) => !r.ok)
                  ? [
                      {
                        label: "Not set up",
                        value: requirements.requirements
                          .filter((r) => !r.ok)
                          .map((r) => (r.optional ? `${r.name} (optional)` : r.name))
                          .join(" · "),
                      },
                    ]
                  : []),
              ]}
            />
          </Card>
          {finishError && (
            <p role="alert" className="mt-3 text-[13px] text-bad">
              {finishError}
            </p>
          )}
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button variant="ghost" icon={ArrowLeft} onClick={() => setStep(1)}>
              Back
            </Button>
            <Button
              variant="primary"
              icon={finishing ? LoaderCircle : ArrowRight}
              spin={finishing}
              className="ml-auto flex-row-reverse"
              disabled={finishing}
              onClick={finish}
            >
              Open the dashboard
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
