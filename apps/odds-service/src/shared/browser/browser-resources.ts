import { readdir, readFile } from "node:fs/promises";
/** Linux container processes only; never read command lines, environment or cookie stores. */
export async function chromeResources() {
  if (process.platform !== "linux") return null;
  const rows = await Promise.all(
    (await readdir("/proc"))
      .filter((id) => /^\d+$/.test(id))
      .map(async (id) => {
        try {
          const s = await readFile(`/proc/${id}/status`, "utf8");
          return {
            pid: Number(id),
            ppid: Number(s.match(/^PPid:\s*(\d+)/m)?.[1]),
            name: s.match(/^Name:\s*(\S+)/m)?.[1],
            rss: Number(s.match(/^VmRSS:\s*(\d+)/m)?.[1] ?? 0) * 1024,
          };
        } catch {
          return null;
        }
      }),
  );
  const index = new Map(rows.filter((r) => r !== null).map((r) => [r.pid, r]));
  const owned = rows.filter((r) => {
    if (!r || r.name !== "chrome") return false;
    let parent = r.ppid;
    const visited = new Set<number>();
    while (parent && !visited.has(parent)) {
      if (parent === process.pid) return true;
      visited.add(parent);
      parent = index.get(parent)?.ppid ?? 0;
    }
    return false;
  });
  return {
    sampledAt: new Date().toISOString(),
    chromeProcesses: owned.length,
    chromeRssBytes: owned.reduce((sum, r) => sum + (r?.rss ?? 0), 0),
  };
}
