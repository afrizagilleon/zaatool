import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  egressFirewallMode,
  egressFirewallProblems,
  egressFirewallWarnings,
} from "../src/core/egress-firewall.js";

/**
 * S-06: the cell firewall. The rules themselves need Linux, root and NET_ADMIN and are proven
 * in the image; what runs everywhere here is the decision (when the engine checks, when it
 * refuses) and the entrypoint's parsing of `CELL_EGRESS_ALLOW`, through its dry-run mode.
 * The real connect-as-a-cell check runs only where it can: Linux as root.
 */
let passed = 0;
let failed = 0;
async function check(name: string, run: () => Promise<void> | void): Promise<void> {
  try {
    await run();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  FAIL ${name}`);
    console.log(`       ${(err as Error).message.split("\n").join("\n       ")}`);
  }
}

const root = () => 0;
const sandboxed = { SANDBOX_GID: "10001" };

console.log("\negress-firewall (the engine's side)");

await check("the mode is on unless it says off; anything else is invalid", () => {
  assert.equal(egressFirewallMode({}), "on");
  assert.equal(egressFirewallMode({ CELL_EGRESS_FIREWALL: " ON " }), "on");
  assert.equal(egressFirewallMode({ CELL_EGRESS_FIREWALL: "off" }), "off");
  assert.equal(egressFirewallMode({ CELL_EGRESS_FIREWALL: "maybe" }), "invalid");
});

await check("an invalid value is a startup problem, everywhere", async () => {
  const problems = await egressFirewallProblems("win32", { CELL_EGRESS_FIREWALL: "no" }, undefined);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /CELL_EGRESS_FIREWALL/);
});

await check("no sandbox (dev, Windows, not root): nothing to check, nothing refused", async () => {
  assert.deepEqual(await egressFirewallProblems("win32", sandboxed, undefined), []);
  assert.deepEqual(await egressFirewallProblems("linux", {}, root), []);
  assert.deepEqual(await egressFirewallProblems("linux", sandboxed, () => 1000), []);
});

await check("off skips the check and is warned about, only where there is a sandbox", async () => {
  const env = { ...sandboxed, CELL_EGRESS_FIREWALL: "off" };
  assert.deepEqual(await egressFirewallProblems("linux", env, root), []);
  assert.match(egressFirewallWarnings("linux", env, root)[0], /NOT firewalled/);
  assert.deepEqual(egressFirewallWarnings("linux", { CELL_EGRESS_FIREWALL: "off" }, root), []);
  assert.deepEqual(egressFirewallWarnings("linux", sandboxed, root), []);
});

if (process.platform === "linux" && process.getuid?.() === 0) {
  await check("as root on Linux, the real probe runs as a cell uid and answers about the firewall", async () => {
    const problems = await egressFirewallProblems("linux", { ...sandboxed, SANDBOX_UID_BASE: "20000" }, root);
    // Without the image's firewall a cell uid connects; with it this is empty.
    if (problems.length > 0) assert.match(problems[0], /firewall is not installed/);
  });
}

console.log("\ndocker-entrypoint.sh (what it accepts)");

const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "docker-entrypoint.sh");
function dry(env: Record<string, string>): { status: number | null; out: string; err: string } | undefined {
  const res = spawnSync("sh", [entry, "true"], {
    env: { PATH: process.env.PATH ?? "", CELL_FW_DRYRUN: "1", ...env },
    encoding: "utf8",
  });
  if (res.error) return undefined; // no POSIX sh on this machine
  return { status: res.status, out: res.stdout, err: res.stderr };
}

const haveSh = dry({}) !== undefined;
if (!haveSh) console.log("  skip no POSIX sh on this machine");

if (haveSh) {
  await check("the default: DNS and the private ranges, for the uid range of the sandbox", () => {
    const r = dry({ SANDBOX_UID_BASE: "30000", SANDBOX_UID_COUNT: "10" })!;
    assert.equal(r.status, 0, r.err);
    assert.match(r.out, /-A CELLFW -d 127\.0\.0\.11 -j RETURN/);
    assert.match(r.out, /-I OUTPUT 1 -m owner --uid-owner 30000-30009 -j CELLFW/);
    for (const net of ["127.0.0.0/8", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "169.254.0.0/16", "100.64.0.0/10"]) {
      assert.match(r.out, new RegExp(`iptables -A CELLFW -d ${net.replace(/[./]/g, "\$&")} -j REJECT`));
    }
    assert.match(r.out, /ip6tables -A CELLFW -d ::1\/128 -j REJECT/);
  });

  await check("allowed entries come before the REJECT rules, CIDR and host:port alike", () => {
    const r = dry({ CELL_EGRESS_ALLOW: "10.1.2.0/24, db:5432 [::1]:443" })!;
    assert.equal(r.status, 0, r.err);
    const allow = r.out.indexOf("-d 10.1.2.0/24 -j RETURN");
    assert.ok(allow > 0 && allow < r.out.indexOf("-d 10.0.0.0/8 -j REJECT"));
    assert.match(r.out, /-d db -p tcp --dport 5432 -j RETURN/);
    assert.match(r.out, /ip6tables -A CELLFW -d ::1 -p tcp --dport 443 -j RETURN/);
  });

  for (const bad of ["10.0.0.0/33", "db:99999", "foo", "300.1.1.1", "fd00::/129", "*"]) {
    await check(`a bad entry stops the start with a reason: ${bad}`, () => {
      const r = dry({ CELL_EGRESS_ALLOW: bad })!;
      assert.equal(r.status, 1);
      assert.match(r.err, /CELL_EGRESS_ALLOW entry/);
      assert.equal(r.out, "", "nothing may be installed when the list is wrong");
    });
  }

  await check("a bad CELL_EGRESS_FIREWALL stops the start", () => {
    const r = dry({ CELL_EGRESS_FIREWALL: "maybe" })!;
    assert.equal(r.status, 1);
    assert.match(r.err, /CELL_EGRESS_FIREWALL/);
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
