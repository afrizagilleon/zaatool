import { API_BASE_URL } from "./api.js";
import type {
  NotebookDeployState,
  NotebookJson,
  NotebookMap,
  NotebookPage,
  NotebookRunDetail,
  NotebookRunSummary,
  NotebookShare,
  NotebookSummary,
  RunStartedResponse,
} from "@zaa-tool/shared";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const { headers: initHeaders, ...restInit } = init ?? {};
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json", ...(initHeaders as Record<string, string>) },
    ...restInit,
  });

  if (!res.ok) {
    // The compiler reports why a notebook is not runnable; surface that instead
    // of a bare status code.
    const detail = await res.json().catch(() => null);
    throw new Error(detail?.error ?? `API ${path} failed: ${res.status}`);
  }

  return res.json();
}

export const notebooksApi = {
  list: (): Promise<NotebookSummary[]> => request("/api/notebooks"),

  /** The derived system map: notebooks, their triggers, and who calls whom. */
  map: (): Promise<NotebookMap> => request("/api/notebooks/map"),

  getById: (id: string): Promise<NotebookJson> => request(`/api/notebooks/${id}`),

  save: (document: NotebookJson): Promise<{ id: string; name: string }> =>
    request("/api/notebooks", { method: "POST", body: JSON.stringify(document) }),

  delete: (id: string): Promise<{ success: boolean }> =>
    request(`/api/notebooks/${id}`, { method: "DELETE" }),

  /**
   * The notebook as the text form — the same one agents read and write.
   *
   * Not `request`, because the answer is markdown rather than JSON. Lossless, so what
   * comes out here goes back in unchanged; that is what makes it an export.
   */
  text: async (id: string): Promise<string> => {
    const res = await fetch(`${API_BASE_URL}/api/notebooks/${id}/text`);
    if (!res.ok) throw new Error(`Could not export: ${res.status}`);
    return res.text();
  },

  /** `asNew` keeps an imported file from overwriting whatever holds the id it names. */
  saveText: (text: string, asNew = false): Promise<{ id: string; name: string }> =>
    request("/api/notebooks/text", { method: "POST", body: JSON.stringify({ text, asNew }) }),

  /** Every deployed notebook with a contract, described well enough to render. */
  pages: (): Promise<NotebookPage[]> => request("/api/notebooks/pages"),

  /**
   * Starts the deployed version and hands back the run id to follow.
   *
   * It used to wait for the whole run and return the outputs at once, which meant a
   * notebook whose fifth cell was slow showed nothing at all until it finished — even
   * though its first cell's table had been ready for twenty seconds.
   */
  runDeployed: (id: string, args: Record<string, unknown>): Promise<RunStartedResponse> =>
    request(`/api/notebooks/${id}/run`, {
      method: "POST",
      body: JSON.stringify({ mode: "deployed", args }),
    }),

  /**
   * Presses a `run` button on a page.
   *
   * The action is named by its position, never by its target: the server reads which
   * notebook that is out of the deployed document, so a page can only reach what its own
   * buttons already point at. Unlike a page run this waits, because the whole answer is
   * whether the other notebook worked.
   */
  runAction: (
    id: string,
    index: number,
    args: Record<string, unknown>
  ): Promise<{ runId: string; notebook: string; status: string; errors?: string[] }> =>
    request(`/api/notebooks/${id}/actions/${index}`, {
      method: "POST",
      body: JSON.stringify({ args }),
    }),

  /** What production runs, and whether the draft has moved on since. */
  deployState: (id: string): Promise<NotebookDeployState> => request(`/api/notebooks/${id}/deploy`),

  /** The document production is running, for comparing against the draft. */
  deployedDocument: (id: string): Promise<NotebookJson> =>
    request(`/api/notebooks/${id}/deployed`),

  /** Pins the current draft as what triggers run. */
  deploy: (id: string): Promise<{ versionId: string }> =>
    request(`/api/notebooks/${id}/deploy`, { method: "POST" }),

  /** Links that let someone without an account use this notebook's page. */
  shares: (id: string): Promise<NotebookShare[]> => request(`/api/notebooks/${id}/shares`),

  /** The reply is the only time the token is readable — it is hashed at rest. */
  createShare: (id: string, password?: string): Promise<NotebookShare> =>
    request(`/api/notebooks/${id}/shares`, {
      method: "POST",
      body: JSON.stringify({ password }),
    }),

  revokeShare: (id: string, shareId: string): Promise<{ revoked: boolean }> =>
    request(`/api/notebooks/${id}/shares/${shareId}`, { method: "DELETE" }),

  /** Stops production without touching the draft, its history or its versions. */
  undeploy: (id: string): Promise<{ wasDeployed: boolean }> =>
    request(`/api/notebooks/${id}/deploy`, { method: "DELETE" }),

  listRuns: (id: string): Promise<NotebookRunSummary[]> => request(`/api/notebooks/${id}/runs`),

  clearRuns: (id: string): Promise<{ deleted: number }> =>
    request(`/api/notebooks/${id}/runs`, { method: 'DELETE' }),

  /** Pass `latest` to get the most recent run — what the editor restores on open. */
  getRun: (id: string, runId: string): Promise<NotebookRunDetail> =>
    request(`/api/notebooks/${id}/runs/${runId}`),

  /**
   * Omit `cellId` to run the whole notebook; supply it with the scope that cell needs
   * as `input`. `args` is different in kind: it is bound to the notebook's declared
   * inputs and rejected if it does not fit, where `input` seeds scope verbatim.
   */
  run: (
    id: string,
    options: {
      input?: Record<string, unknown>;
      args?: Record<string, unknown>;
      cellId?: string;
    } = {}
  ): Promise<RunStartedResponse> =>
    request(`/api/notebooks/${id}/run`, {
      method: "POST",
      body: JSON.stringify(options),
    }),
};
