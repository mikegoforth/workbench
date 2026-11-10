import { describe, expect, it } from "vitest";
import { repoHostLabel, toWebUrl } from "./repoUrl";

describe("toWebUrl", () => {
  it.each([
    ["https://github.com/owner/repo.git", "https://github.com/owner/repo"],
    ["https://github.com/owner/repo", "https://github.com/owner/repo"],
    ["https://github.com/owner/repo/", "https://github.com/owner/repo"],
    ["git@github.com:owner/repo.git", "https://github.com/owner/repo"],
    ["github.com:owner/repo", "https://github.com/owner/repo"],
    ["ssh://git@github.com/owner/repo.git", "https://github.com/owner/repo"],
    ["ssh://git@gitlab.example.com:2222/group/sub/repo.git", "https://gitlab.example.com/group/sub/repo"],
    ["git+ssh://git@bitbucket.org/team/repo.git", "https://bitbucket.org/team/repo"],
    ["git://example.org/repo.git", "https://example.org/repo"],
    ["http://intranet.local/team/repo.git", "http://intranet.local/team/repo"],
    ["  https://github.com/owner/repo.git\n", "https://github.com/owner/repo"],
    ["https://github.com/owner/my%20repo.git", "https://github.com/owner/my%20repo"],
  ])("%s → %s", (remote, expected) => {
    expect(toWebUrl(remote)).toBe(expected);
  });

  it("drops credentials and ports from the URL", () => {
    expect(toWebUrl("https://user:ghp_secret@github.com:443/owner/repo.git")).toBe("https://github.com/owner/repo");
    expect(toWebUrl("https://x-access-token:abc@github.com/owner/repo")).not.toContain("abc");
  });

  it.each([
    ["a local path", "/Users/me/repos/thing.git"],
    ["a relative path", "../thing"],
    ["a file:// URL", "file:///Users/me/repos/thing.git"],
    ["a Windows drive", "C:/repos/thing"],
    ["an unsupported scheme", "javascript://github.com/%0Aalert(1)"],
    ["a host with no path", "https://github.com/"],
    ["an empty string", ""],
    ["a malformed URL", "https://exa mple.com/repo"],
  ])("returns null for %s", (_label, remote) => {
    expect(toWebUrl(remote)).toBeNull();
  });
});

describe("repoHostLabel", () => {
  it.each([
    ["https://github.com/o/r", "GitHub"],
    ["https://www.github.com/o/r", "GitHub"],
    ["https://gitlab.com/o/r", "GitLab"],
    ["https://bitbucket.org/o/r", "Bitbucket"],
    ["https://git.example.com/o/r", "git.example.com"],
  ])("%s → %s", (url, label) => {
    expect(repoHostLabel(url)).toBe(label);
  });
});
