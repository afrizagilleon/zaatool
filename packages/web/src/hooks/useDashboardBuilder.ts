import { useState, useEffect, useRef } from 'react';
import { useFlowStore } from '../store/flowStore.js';
import { API_BASE_URL } from '../lib/api.js';

export interface DashboardBuilderState {
  uiNodes: any[];
  layout: any[];
  copied: boolean;
  isSaving: boolean;
  containerRef: React.RefObject<HTMLDivElement>;
  width: number;
  dashboardPassword: string;
  setDashboardPassword: (value: string) => void;
  shareUrl: string;
  handleLayoutChange: (newLayout: any) => void;
  handleSaveLayout: () => Promise<void>;
  handleCopyUrl: () => void;
}

export function useDashboardBuilder(): DashboardBuilderState {
  const flowId = useFlowStore((s) => s.id);
  const flowName = useFlowStore((s) => s.name);
  const nodes = useFlowStore((s) => s.nodes);
  const dashboardLayout = useFlowStore((s) => s.dashboardLayout);
  const setDashboardLayout = useFlowStore((s) => s.setDashboardLayout);
  const dashboardPassword = useFlowStore((s) => s.dashboardPassword);
  const setDashboardPassword = useFlowStore((s) => s.setDashboardPassword);

  const [uiNodes, setUiNodes] = useState<any[]>([]);
  const [layout, setLayout] = useState<any[]>([]);
  const [copied, setCopied] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1200);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width) {
          setWidth(entry.contentRect.width);
        }
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const filtered = nodes.filter((n) =>
      ['ui:input', 'ui:text', 'ui:table', 'ui:chart', 'ui:image', 'file'].includes(n.type || '') &&
      n.data?.showInDashboard !== false
    );
    setUiNodes(filtered);

    const savedItems = dashboardLayout?.items || [];
    const newLayout = filtered.map((node) => {
      const existing = savedItems.find((item: any) => item.i === node.id);
      if (existing) return existing;

      let w = 6, h = 4;
      if (node.type === 'ui:input') { w = 4; h = 5; }
      else if (node.type === 'ui:text') { w = 6; h = 4; }
      else if (node.type === 'ui:table') { w = 8; h = 6; }
      else if (node.type === 'ui:chart') { w = 6; h = 5; }
      else if (node.type === 'ui:image') { w = 4; h = 4; }

      return {
        i: node.id,
        x: (filtered.indexOf(node) * 4) % 12,
        y: Math.floor(filtered.indexOf(node) / 3) * 5,
        w,
        h,
      };
    });

    setLayout(newLayout);
  }, [flowId, nodes]);

  const handleLayoutChange = (newLayout: any) => {
    const formatted = newLayout.map((item: any) => ({
      i: item.i,
      x: item.x,
      y: item.y,
      w: item.w,
      h: item.h,
    }));
    setLayout(formatted);
    setDashboardLayout({ items: formatted });
  };

  const handleSaveLayout = async () => {
    setIsSaving(true);
    try {
      const flowStore = useFlowStore.getState();
      const graph = flowStore.getGraphJson();
      const dashboardPassword = flowStore.dashboardPassword;
      const res = await fetch(`${API_BASE_URL}/api/flows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: flowId,
          name: flowName,
          graph_json: graph,
          dashboard_layout: { items: layout },
          dashboard_password: dashboardPassword,
        }),
      });

      if (!res.ok) throw new Error('Failed to save layout');
    } catch (e) {
      console.error(e);
      alert('Failed to save layout to engine.');
    } finally {
      setIsSaving(false);
    }
  };

  const shareUrl = `${window.location.origin}/share/${flowId}`;

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return {
    uiNodes,
    layout,
    copied,
    isSaving,
    containerRef,
    width,
    dashboardPassword,
    setDashboardPassword,
    shareUrl,
    handleLayoutChange,
    handleSaveLayout,
    handleCopyUrl,
  };
}
