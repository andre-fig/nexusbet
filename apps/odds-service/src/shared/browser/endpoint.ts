import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
export async function nativeDebugEndpoint(
  overrideFile?: string,
): Promise<string> {
  const file =
    overrideFile ||
    process.env.CHROME_DEBUG_PORT_FILE ||
    join(
      homedir(),
      "Library/Application Support/Google/Chrome/DevToolsActivePort",
    );
  const [port, path] = (await readFile(file, "utf8")).trim().split(/\r?\n/);
  if (!/^\d+$/.test(port) || !path?.startsWith("/devtools/browser/"))
    throw Error("Invalid Chrome debug endpoint file");
  return `ws://127.0.0.1:${port}${path}`;
}
