import { CdpConnection } from "./cdp-connection.js";
interface Entry {
  connection: Promise<CdpConnection>;
  users: number;
}
const connections = new Map<string, Entry>();
/** One normal CDP connection per endpoint, isolated target/session per collector. */
export async function acquireCdp(endpoint: string) {
  let entry = connections.get(endpoint);
  if (!entry) {
    entry = { connection: CdpConnection.connect(endpoint), users: 0 };
    connections.set(endpoint, entry);
    const current = entry;
    void current.connection.then(
      (c) =>
        c.once("disconnected", () => {
          if (connections.get(endpoint) === current)
            connections.delete(endpoint);
        }),
      () => {
        if (connections.get(endpoint) === current) connections.delete(endpoint);
      },
    );
  }
  entry.users++;
  const current = entry;
  let released = false;
  try {
    const cdp = await current.connection;
    return {
      cdp,
      release: () => {
        if (released) return;
        released = true;
        current.users--;
        if (!current.users) {
          if (connections.get(endpoint) === current)
            connections.delete(endpoint);
          cdp.close();
        }
      },
    };
  } catch (error) {
    current.users--;
    throw error;
  }
}
