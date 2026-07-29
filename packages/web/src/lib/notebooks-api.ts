import { API_BASE_URL } from "./api.js";
import type { NotebookJson, NotebookSummary, RunStartedResponse } from "@zaa-tool/shared";

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

  run: (id: string, input?: Record<string, unknown>): Promise<RunStartedResponse> =>
    request(`/api/notebooks/${id}/run`, {
      method: "POST",
      body: JSON.stringify({ input }),
    }),
};
