import { API_BASE_URL } from "./api.js";
import type { GraphJson, DashboardLayout } from "@zaa-tool/shared";

export interface SaveFlowPayload {
  id?: string;
  name?: string;
  graph_json: GraphJson;
  dashboard_layout?: DashboardLayout;
  dashboard_password?: string;
}

export interface FlowSummary {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface FlowDetail {
  id: string;
  name: string;
  graph_json: GraphJson;
  dashboard_layout: DashboardLayout;
  dashboard_password: string;
}

export interface PublicFlowResponse {
  id: string;
  name: string;
  graph_json?: GraphJson;
  dashboard_layout?: DashboardLayout;
  isPasswordProtected?: boolean;
}

export interface TriggerPayload {
  startNodeId: string;
  inputs?: Record<string, unknown>;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const { headers: initHeaders, ...restInit } = init ?? {};
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json", ...(initHeaders as Record<string, string>) },
    ...restInit,
  });
  if (!res.ok) throw new Error(`API ${path} failed: ${res.status}`);
  return res.json();
}

export const flowsApi = {
  list: (): Promise<FlowSummary[]> =>
    request("/api/flows"),

  getById: (id: string): Promise<FlowDetail> =>
    request(`/api/flows/${id}`),

  save: (payload: SaveFlowPayload): Promise<{ success: boolean; id: string; name: string }> =>
    request("/api/flows", { method: "POST", body: JSON.stringify(payload) }),

  delete: (id: string): Promise<{ success: boolean }> =>
    request(`/api/flows/${id}`, { method: "DELETE" }),

  getPublic: (id: string, password?: string): Promise<PublicFlowResponse> => {
    const headers: Record<string, string> = {};
    if (password) headers["X-Dashboard-Password"] = password;
    return request(`/api/flows/${id}/public`, { headers });
  },

  verifyPassword: (
    id: string,
    password: string
  ): Promise<{ success: boolean; graph_json: GraphJson; dashboard_layout: DashboardLayout }> =>
    request(`/api/flows/${id}/verify-password`, {
      method: "POST",
      body: JSON.stringify({ password }),
    }),

  trigger: (
    id: string,
    payload: TriggerPayload,
    password?: string
  ): Promise<{ status: string }> => {
    const headers: Record<string, string> = {};
    if (password) headers["X-Dashboard-Password"] = password;
    return request(`/api/flows/${id}/trigger`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
  },
};
