const REMOTE_PROTOCOLS = new Set(["http:", "https:", "ssh:", "git:", "git+ssh:", "ssh+git:"]);

/**
 * Browser URL for a git remote, or null if it isn't a hosted repo (e.g. a
 * local path or file:// remote). Handles https, ssh:// and scp-style
 * (git@host:owner/repo.git) remotes. Usernames, tokens and ports are dropped,
 * so credentials in a remote URL never reach the page.
 */
export function toWebUrl(remote: string): string | null {
  const url = remote.trim();
  let protocol = "https:";
  let host: string;
  let repoPath: string;

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    if (!REMOTE_PROTOCOLS.has(parsed.protocol)) return null;
    if (parsed.protocol === "http:") protocol = "http:";
    host = parsed.hostname;
    repoPath = decodeURIComponent(parsed.pathname);
  } else {
    // scp-style: [user@]host:path (but not a Windows drive like C:/...)
    const scp = url.match(/^(?:[^@/\s]+@)?([^:/\s]+):(?!\/)(\S+)$/);
    if (!scp || scp[1].length === 1) return null;
    host = scp[1];
    repoPath = scp[2];
  }

  repoPath = repoPath.replace(/^\/+/, "").replace(/\/+$/, "").replace(/\.git$/, "");
  if (!host || !repoPath) return null;
  return `${protocol}//${host}/${repoPath.split("/").map(encodeURIComponent).join("/")}`;
}

/** Short label for a repo host: "GitHub", "GitLab", "Bitbucket", or the hostname. */
export function repoHostLabel(webUrl: string): string {
  const host = new URL(webUrl).hostname.replace(/^www\./, "");
  if (host === "github.com") return "GitHub";
  if (host === "gitlab.com") return "GitLab";
  if (host === "bitbucket.org") return "Bitbucket";
  return host;
}
