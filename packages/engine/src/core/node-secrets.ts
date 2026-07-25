import type { NodeDef } from "@zaa-tool/shared";

/**
 * Reads the secret keys a node declared in `data.config.secrets`.
 *
 * Undeclared means none: a node that asks for nothing gets an environment with
 * no secrets in it, rather than inheriting every credential in the workspace.
 */
export function declaredSecretKeys(node: NodeDef): string[] {
  const declared = node.data.config?.secrets;
  if (!Array.isArray(declared)) return [];

  return [...new Set(declared.filter((key): key is string => typeof key === "string" && key.length > 0))];
}
