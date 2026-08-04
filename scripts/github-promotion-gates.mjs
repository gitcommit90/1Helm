#!/usr/bin/env node
const REPOSITORY = "gitcommit90/1Helm";

async function github(path, token, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(`https://api.github.com/repos/${REPOSITORY}${path}`, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "user-agent": "1helm-stable-promotion-gate",
      "x-github-api-version": "2022-11-28",
    },
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  return response;
}

export async function assertRemoteVersionAbsent(version, token, fetchImpl) {
  if (!/^\d+\.\d+\.\d+$/.test(String(version || "")) || !token) throw new Error("Remote version absence check received invalid inputs");
  const tag = `v${version}`;
  for (const [kind, path] of [
    ["tag", `/git/ref/tags/${encodeURIComponent(tag)}`],
    ["release", `/releases/tags/${encodeURIComponent(tag)}`],
  ]) {
    const response = await github(path, token, fetchImpl);
    if (response.status === 404) continue;
    if (response.ok) throw new Error(`Refusing because ${kind} ${tag} already exists`);
    throw new Error(`Could not prove ${kind} ${tag} absent: GitHub API ${response.status}`);
  }
}

if (process.argv[1] && new URL(`file://${process.argv[1]}`).href === import.meta.url) {
  const command = process.argv[2];
  try {
    if (command === "version-absent") await assertRemoteVersionAbsent(process.argv[3], process.env.GH_TOKEN);
    else throw new Error("Usage: github-promotion-gates.mjs version-absent <version>");
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}
