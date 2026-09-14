import { writeFile, rename } from "node:fs/promises";
export async function saveJson(path: string, data: unknown) {
  await writeFile(path + ".tmp", JSON.stringify(data, null, 2), {
    mode: 0o600,
  });
  await rename(path + ".tmp", path);
}
