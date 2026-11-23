/**
 * An in-memory `WorkspaceFs`, for tests that check what the engine does as root on a machine
 * that is not root, not Linux, and has no cell to plant anything.
 *
 * It keeps a tree of nodes (folder, file, symlink) with owner, group and mode, records every
 * call, and lets a test play the cell: `plant` puts a node wherever a cell could write. The
 * rule the tests assert (C-01) is in `rootOpsInside`: root never operates by path inside a
 * folder a cell can write to.
 */
import type { StatLike, WorkspaceFs } from "../src/core/workspace-fs.js";

export interface Node {
  kind: "dir" | "file" | "symlink";
  uid: number;
  gid: number;
  mode: number;
  /** Where a symlink points. */
  target?: string;
}

export interface Call {
  op: string;
  path: string;
  args: unknown[];
}

export function fakeWorkspaceFs(): {
  fs: WorkspaceFs;
  tree: Map<string, Node>;
  calls: Call[];
  /** What a cell does: makes `path` exist as `node`, whatever the folder's owner says. */
  plant(path: string, node: Partial<Node> & { kind: Node["kind"] }): void;
  /** Paths of calls that changed root-side state at or under `folder`, by path (not descriptor). */
  rootOpsInside(folders: string[], ops?: string[]): Call[];
  stageCalls: Array<{ uid: number; gid: number; into: string; files: Array<[string, string]> }>;
} {
  const tree = new Map<string, Node>();
  const calls: Call[] = [];
  const stageCalls: Array<{ uid: number; gid: number; into: string; files: Array<[string, string]> }> = [];
  const record = (op: string, path: string, ...args: unknown[]): void => void calls.push({ op, path, args });

  const stat = (node: Node): StatLike => ({
    isDirectory: () => node.kind === "dir",
    isSymbolicLink: () => node.kind === "symlink",
    uid: node.uid,
    gid: node.gid,
    mode: node.mode,
  });

  /** What a path-based chown/chmod would reach: a symlink is followed, like the real calls. */
  const follow = (path: string): string => {
    let at = path;
    for (let hops = 0; hops < 10; hops += 1) {
      const node = tree.get(at);
      if (node?.kind !== "symlink" || node.target === undefined) return at;
      at = node.target;
    }
    return at;
  };

  const n = (p: string): string => "/" + p.split("/").filter(Boolean).join("/");

  const fs: WorkspaceFs = {
    mkdirSync(dir0, options) {
      const dir = n(dir0);
      record("mkdir", dir, options);
      const parts = dir.split("/").filter(Boolean);
      const recursive = options?.recursive === true;
      for (let i = recursive ? 1 : parts.length; i <= parts.length; i += 1) {
        const at = "/" + parts.slice(0, i).join("/");
        if (!tree.has(at)) tree.set(at, { kind: "dir", uid: 0, gid: 0, mode: (options?.mode ?? 0o777) & ~0o022 });
        else if (!recursive && i === parts.length) throw Object.assign(new Error("EEXIST"), { code: "EEXIST" });
      }
      return undefined;
    },
    lstatSync(target0) {
      const target = n(target0);
      const node = tree.get(target);
      return node ? stat(node) : undefined;
    },
    chmodSync(target0, mode) {
      const target = n(target0);
      record("chmod", target, mode);
      const node = tree.get(follow(target));
      if (node) node.mode = mode;
    },
    chownSync(target0, uid, gid) {
      const target = n(target0);
      record("chown", target, uid, gid);
      const node = tree.get(follow(target));
      if (node) Object.assign(node, { uid, gid });
    },
    adoptDirectory(dir0, uid, gid, mode) {
      const dir = n(dir0);
      record("adopt", dir, uid, gid, mode);
      const node = tree.get(dir);
      if (!node || node.kind !== "dir") throw new Error("ELOOP: not a plain folder");
      Object.assign(node, { uid, gid, mode });
    },
    createFile(target0, content, uid, gid, mode) {
      const target = n(target0);
      record("createFile", target, uid, gid, mode);
      if (tree.has(target)) throw Object.assign(new Error("EEXIST"), { code: "EEXIST" });
      tree.set(target, { kind: "file", uid, gid, mode });
      void content;
    },
    stageAs(uid, gid, into, files) {
      record("stageAs", into, uid, gid);
      stageCalls.push({ uid, gid, into, files });
      for (const [, target] of files) tree.set(target, { kind: "file", uid, gid, mode: 0o600 });
    },
    rmdirSync(dir) {
      record("rmdir", dir);
      for (const key of tree.keys()) if (key.startsWith(dir + "/")) throw new Error("ENOTEMPTY");
      tree.delete(dir);
    },
    statSync: () => ({ isFile: () => true }),
    copyFileSync(source, target) {
      record("copyFile", target, source);
      tree.set(target, { kind: "file", uid: 0, gid: 0, mode: 0o644 });
    },
    rmSync(target) {
      record("rm", target);
      for (const key of [...tree.keys()]) if (key === target || key.startsWith(target + "/")) tree.delete(key);
    },
  };

  return {
    fs,
    tree,
    calls,
    stageCalls,
    plant(path, node) {
      tree.set(path, { uid: 0, gid: 0, mode: 0o777, ...node });
    },
    rootOpsInside(folders, ops = ["chmod", "chown", "copyFile", "rm", "createFile"]) {
      return calls.filter(
        (call) => ops.includes(call.op) && folders.some((folder) => call.path === folder || call.path.startsWith(folder + "/"))
      );
    },
  };
}
