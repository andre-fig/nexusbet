export type Esport = "cs2" | "lol" | "valorant";
export type Status = "scheduled" | "live" | "suspended" | "finished";
export interface Source {
  transport: "xhr" | "http";
  url: string;
  method: "GET";
  capture:
    | "chrome-devtools-copy-response"
    | "playwright-response"
    | "chrome-cdp-response"
    | "direct-http";
  authenticated: boolean | null;
}
