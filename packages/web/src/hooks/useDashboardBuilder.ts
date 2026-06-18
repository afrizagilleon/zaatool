import { useState, useEffect, useRef } from 'react';
import { useFlowStore } from '../store/flowStore.js';
import { flowsApi } from '../lib/flows-api.js';
import type { DashboardLayout, DashboardLayoutItem } from '@zaa-tool/shared';

export interface DashboardBuilderState {
  uiNodes: ReturnType<typeof useFlowStore.getState>['nodes'];
  layout: DashboardLayoutItem[];
  copied: boolean;
  isSaving: boolean;
  containerRef: React.RefObject<HTMLDivElement>;
  width: number;
  dashboardPassword: string;
  setDashboardPassword: (value: string) => void;
  shareUrl: string;
  handleLayoutChange: (newLayout: DashboardLayoutItem[]) => void;
  handleSaveLayout: () => Promise<void>;
  handleCopyUrl: () => void;
}

const NODE_DEFAULT_SIZES: Record<string, { w: number; h: number }> = {
  'ui:input': { w: 4, h: 5 },
  'ui:text':  { w: 6, h: 4 },
  'ui:table': { w: 8, h: 6 },
  'ui:chart': { w: 6, h: 5 },
  'ui:image': { w: 4, h: 4 },
};

const UI_NODE_TYPES = ['ui:input', 'ui:text', 'ui:table', 'ui:chart', 'ui:image', 'file'];

export function useDashboardBuilder(): DashboardBuilderState {
  const flowId = useFlowStore((s) => s.id);
  const flowName = useFlowStore((s) => s.name);
  const nodes = useFlowStore((s) => s.nodes);
  const dashboardLayout = useFlowStore((s) => s.dashboardLayout);
  const setDashboardLayout = useFlowStore((s) => s.setDashboardLayout);
  const dashboardPassword = useFlowStore((s) => s.dashboardPassword);
  const setDashboardPassword = useFlowStore((s) => s.setDashboardPassword);

  const [layout, setLayout] = useState<DashboardLayoutItem[]>([]);
  const [copied, setCopied] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1200);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width) setWidth(entry.contentRect.width);
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const uiNodes = nodes.filter(
    (n) => UI_NODE_TYPES.includes(n.type || '') && n.data?.showInDashboard !== false
  );

  useEffect(() => {
    const savedItems = dashboardLayout?.items || [];
    const newLayout: DashboardLayoutItem[] = uiNodes.map((node, idx) => {
      const existing = savedItems.find((item) => item.i === node.id);
      if (existing) return existing;

      const { w, h } = NODE_DEFAULT_SIZES[node.type || ''] ?? { w: 6, h: 4 };
      return {
        i: node.id,
        x: (idx * 4) % 12,
        y: Math.floor(idx / 3) * 5,
        w,
        h,
      };
    });
    setLayout(newLayout);
  }, [flowId, nodes]);

  const handleLayoutChange = (newLayout: DashboardLayoutItem[]) => {
    const formatted = newLayout.map(({ i, x, y, w, h }) => ({ i, x, y, w, h }));
    setLayout(formatted);
    setDashboardLayout({ items: formatted });
  };

  const handleSaveLayout = async () => {
    setIsSaving(true);
    try {
      const { getGraphJson, dashboardPassword: pwd } = useFlowStore.getState();
      await flowsApi.save({
        id: flowId,
        name: flowName,
        graph_json: getGraphJson(),
        dashboard_layout: { items: layout },
        dashboard_password: pwd,
      });
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
