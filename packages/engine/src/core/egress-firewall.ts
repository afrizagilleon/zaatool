/**
 * The check that the cell firewall (S-06) is really there.
 *
 * The image's entrypoint installs iptables rules for the cell uid range as root, then drops
 * `CAP_NET_ADMIN` and starts the engine. After the drop the engine cannot read the rules
 * either, and a marker file would only prove that the entrypoint ran. So the engine asks the
 * network itself: it listens on its own loopback, starts a child as a cell uid, and the child
 * tries to connect. A firewall that is there answers "connection refused"; no firewall
 * answers "connected". The child is the engine's own and runs fixed code, so no cell can
 * influence the answer.
 *
 * Only meaningful where cells change uid (Linux, root, sandbox configured). Elsewhere, such
 * as `pnpm dev` or Windows, there is no firewall to check and nothing here does anything.
 */
import { spawn } from "node:child_process";
import net from "node:net";
import { activeSandbox, type SandboxConfig } from "./sandbox-identity.js";

export type EgressFirewallMode = "on" | "off" | "invalid";

/** `CELL_EGRESS_FIREWALL`: on unless it says off; anything else is a mistake to report. */
export function egressFirewallMode(env: Record<string, string | undefined>): EgressFirewallMode {
  const raw = (env.CELL_EGRESS_FIREWALL ?? "").trim().toLowerCase();
  if (raw === "" || raw === "on") return "on";
  if (raw === "off") return "off";
  return "invalid";
}

/** What a probe child reports: `connected`, an errno code such as ECONNREFUSED, or `timeout`. */
type Outcome = string;

/** Fixed code run by the probe child; argv is `[node, host, port]`. */
const PROBE_CODE = `
const net = require("net");
const s = net.connect({ host: process.argv[1], port: Number(process.argv[2]) });
s.setTimeout(2500);
s.on("connect", () => { process.stdout.write("connected"); process.exit(0); });
s.on("timeout", () => { process.stdout.write("timeout"); process.exit(0); });
s.on("error", (e) => { process.stdout.write(String(e.code || e.message)); process.exit(0); });
`;

/** Outcomes that mean the kernel stopped the connection (REJECT, or DROP seen as a timeout). */
const BLOCKED = new Set(["ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH", "EPERM", "timeout"]);

function listen(host: string): Promise<net.Server | undefined> {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => socket.destroy());
    server.once("error", () => resolve(undefined));
    server.listen(0, host, () => resolve(server));
  });
}

function probe(config: SandboxConfig, host: string, port: number): Promise<Outcome> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", PROBE_CODE, host, String(port)], {
      uid: config.uidBase,
      gid: config.gid,
      cwd: "/",
      env: { PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin" },
      stdio: ["ignore", "pipe", "ignore"],
    });
    let out = "";
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString();
    });
    const killer = setTimeout(() => child.kill("SIGKILL"), 8000);
    child.once("error", (err) => {
      clearTimeout(killer);
      reject(err);
    });
    child.once("close", () => {
      clearTimeout(killer);
      resolve(out.trim() || "no-answer");
    });
  });
}

function closeServer(server: net.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

/**
 * Reasons to refuse to start because the firewall is not in place. Empty when it is, when the
 * operator chose `CELL_EGRESS_FIREWALL=off`, and when cells do not change uid here.
 * `CELL_EGRESS_FIREWALL` being off is not reported here; see {@link egressFirewallWarnings}.
 */
export async function egressFirewallProblems(
  platform: NodeJS.Platform,
  env: Record<string, string | undefined>,
  getuid: (() => number) | undefined
): Promise<string[]> {
  const mode = egressFirewallMode(env);
  if (mode === "invalid") {
    return [`CELL_EGRESS_FIREWALL is "${env.CELL_EGRESS_FIREWALL}"; use "on" (the default) or "off".`];
  }
  const config = activeSandbox(platform, env, getuid);
  if (!config || mode === "off") return [];

  const hint =
    "Cells would be able to reach this engine, the database and the rest of the network. The image's " +
    "entrypoint installs the firewall and needs cap_add: [NET_ADMIN] (docker-compose.yml has it). " +
    "To start without it anyway, set CELL_EGRESS_FIREWALL=off, knowing what that leaves open.";

  const servers: net.Server[] = [];
  try {
    const targets: Array<{ host: string; port: number }> = [];
    for (const host of ["127.0.0.1", "::1"]) {
      const server = await listen(host);
      if (!server) {
        if (host === "127.0.0.1") {
          return ["Could not open a loopback port to test the cell firewall; refusing to start unverified."];
        }
        continue; // no IPv6 loopback in this container: nothing to leak
      }
      servers.push(server);
      targets.push({ host, port: (server.address() as net.AddressInfo).port });
    }

    const problems: string[] = [];
    for (const { host, port } of targets) {
      let outcome: Outcome;
      try {
        outcome = await probe(config, host, port);
      } catch (err: unknown) {
        return [`Could not start the cell firewall test as uid ${config.uidBase}: ${(err as Error).message}`];
      }
      if (outcome === "connected") {
        problems.push(`The cell firewall is not installed: uid ${config.uidBase} connected to ${host}. ${hint}`);
      } else if (!BLOCKED.has(outcome)) {
        problems.push(`The cell firewall test as uid ${config.uidBase} against ${host} was inconclusive (${outcome}). ${hint}`);
      }
    }
    return problems;
  } finally {
    await Promise.all(servers.map(closeServer));
  }
}

/** The loud line for an operator who turned the firewall off, or undefined. */
export function egressFirewallWarnings(
  platform: NodeJS.Platform,
  env: Record<string, string | undefined>,
  getuid: (() => number) | undefined
): string[] {
  if (egressFirewallMode(env) !== "off" || !activeSandbox(platform, env, getuid)) return [];
  return [
    "CELL_EGRESS_FIREWALL=off: cells are NOT firewalled. They can reach this engine's port, the " +
      "database, other containers, the cloud metadata address and private networks.",
  ];
}
