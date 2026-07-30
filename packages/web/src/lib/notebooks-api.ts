import { API_BASE_URL } from "./api.js";
import type {
  NotebookJson,
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

  getById: (id: string): Promise<NotebookJson> => request(`/api/notebooks/${id}`),

  save: (document: NotebookJson): Promise<{ id: string; name: string }> =>
    request("/api/notebooks", { method: "POST", body: JSON.stringify(document) }),

  delete: (id: string): Promise<{ success: boolean }> =>
    request(`/api/notebooks/${id}`, { method: "DELETE" }),

  listRuns: (id: string): Promise<NotebookRunSummary[]> => request(`/api/notebooks/${id}/runs`),

  clearRuns: (id: string): Promise<{ deleted: number }> =>
    request(`/api/notebooks/${id}/runs`, { method: 'DELETE' }),

  /** Pass `latest` to get the most recent run — what the editor restores on open. */
  getRun: (id: string, runId: string): Promise<NotebookRunDetail> =>
    request(`/api/notebooks/${id}/runs/${runId}`),

  /** Omit `cellId` to run the whole notebook; supply it with the scope that cell needs as `input`. */
  run: (
    id: string,
    options: { input?: Record<string, unknown>; cellId?: string } = {}
  ): Promise<RunStartedResponse> =>
    request(`/api/notebooks/${id}/run`, {
      method: "POST",
      body: JSON.stringify(options),
    }),
};
