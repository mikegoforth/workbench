"use client";

import { useEffect, useState } from "react";
import { BookOpen } from "lucide-react";
import Markdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { EmptyState, Panel } from "./ui";

const hasScheme = (url: string) => /^[a-z][a-z0-9+.-]*:/i.test(url);

/** A link relative to the README (which sits at the repo root) as a repo path; null if it escapes the repo. */
function repoPath(url: string): string | null {
  let clean: string;
  try {
    clean = decodeURI(url.split(/[?#]/)[0]);
  } catch {
    return null;
  }
  const parts: string[] = [];
  for (const part of clean.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.length ? parts.join("/") : null;
}

type Readme = { file: string; content: string; truncated: boolean };

export default function ReadmePanel({
  projectName,
  repoUrl,
  className = "",
}: {
  projectName: string;
  repoUrl?: string;
  className?: string;
}) {
  // undefined while loading, null when the project has no README.
  const [readme, setReadme] = useState<Readme | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/readme?project=${encodeURIComponent(projectName)}`)
      .then((res) => (res.ok ? (res.json() as Promise<Readme>) : null))
      .then((r) => {
        if (!cancelled) setReadme(r);
      })
      .catch(() => {
        if (!cancelled) setReadme(null);
      });
    return () => {
      cancelled = true;
    };
  }, [projectName]);

  // Relative images load from the project folder; relative links go to the file on GitHub.
  const urlTransform = (url: string, key: string) => {
    const safe = defaultUrlTransform(url);
    if (!safe || hasScheme(safe) || safe.startsWith("//") || safe.startsWith("#")) return safe;
    const rel = repoPath(safe);
    if (!rel) return null;
    if (key === "src") {
      return `/api/file?project=${encodeURIComponent(projectName)}&path=${encodeURIComponent(rel)}`;
    }
    return repoUrl ? `${repoUrl}/blob/HEAD/${rel.split("/").map(encodeURIComponent).join("/")}` : null;
  };

  return (
    <Panel
      id="readme-heading"
      title="README"
      description={readme ? <span className="font-mono">{readme.file}</span> : undefined}
      className={className}
      bodyClassName="px-6 py-5"
    >
      {readme === undefined ? (
        <p className="text-[13px] text-fg-3">Loading…</p>
      ) : readme === null ? (
        <EmptyState icon={BookOpen} title="No README">
          Add a README.md at the project root and it shows up here.
        </EmptyState>
      ) : (
        <div className="markdown">
          <Markdown
            remarkPlugins={[remarkGfm]}
            skipHtml
            urlTransform={urlTransform}
            components={{
              a: ({ href, children }) => (
                <a href={href} {...(href?.startsWith("#") ? {} : { target: "_blank", rel: "noopener noreferrer" })}>
                  {children}
                </a>
              ),
              // eslint-disable-next-line @next/next/no-img-element -- arbitrary README images, not optimizable assets
              img: ({ src, alt }) => <img src={typeof src === "string" ? src : undefined} alt={alt ?? ""} loading="lazy" />,
            }}
          >
            {readme.content}
          </Markdown>
          {readme.truncated && <p className="mt-4 text-[12px] text-fg-3">README truncated at 256 KB.</p>}
        </div>
      )}
    </Panel>
  );
}
