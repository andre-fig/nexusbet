import WebSocket from "ws";
import { EventEmitter } from "node:events";
export class CdpConnection extends EventEmitter {
  private next = 0;
  private pending = new Map<
    number,
    {
      resolve: (v: any) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private constructor(readonly socket: WebSocket) {
    super();
    socket.addEventListener("message", (event) => {
      const m = JSON.parse(String(event.data));
      if (m.id) {
        const p = this.pending.get(m.id);
        if (p) {
          this.pending.delete(m.id);
          clearTimeout(p.timer);
          m.error
            ? p.reject(Error(`CDP ${m.error.message}`))
            : p.resolve(m.result);
        }
      } else this.emit("protocol", m);
    });
    socket.addEventListener("close", () => {
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(Error("CDP disconnected"));
      }
      this.pending.clear();
      this.emit("disconnected");
    });
  }
  static async connect(endpoint: string) {
    const u = new URL(endpoint);
    if (
      !["ws:", "wss:"].includes(u.protocol) ||
      !["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)
    )
      throw Error("CDP must use a local WebSocket endpoint");
    const socket = new WebSocket(endpoint),
      client = new CdpConnection(socket);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.close();
        reject(Error("Chrome connection not approved within 45 seconds"));
      }, 45000);
      socket.addEventListener(
        "open",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
      socket.addEventListener(
        "error",
        () => {
          clearTimeout(timer);
          reject(Error("CDP connection failed"));
        },
        { once: true },
      );
    });
    return client;
  }
  send(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = ++this.next;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Error(`CDP timeout: ${method}`));
      }, 30000);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.socket.send(
          JSON.stringify({
            id,
            method,
            params,
            ...(sessionId ? { sessionId } : {}),
          }),
        );
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e);
      }
    });
  }
  close() {
    this.socket.close();
  }
}
