import { API_BASE_URL } from "./api.js";
import type {
  NotebookDeployState,
  NotebookJson,
  NotebookMap,
  NotebookRunDetail,
  NotebookRunSummary,
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

  /** What production runs, and whether the draft has moved on since. */
  deployState: (id: string): Promise<NotebookDeployState> => request(`/api/notebooks/${id}/deploy`),

  /** Pins the current draft as what triggers run. */
  deploy: (id: string): Promise<{ versionId: string }> =>
    request(`/api/notebooks/${id}/deploy`, { method: "POST" }),

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
