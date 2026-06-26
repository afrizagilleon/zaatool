import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { useFlowStore } from '../store/flowStore.js';
import { flowsApi } from '../lib/flows-api.js';
import type { DashboardLayoutItem } from '@zaa-tool/shared';

export interface DashboardBuilderState {
  uiNodes: ReturnType<typeof useFlowStore.getState>['nodes'];
  layout: DashboardLayoutItem[];
  copied: boolean;
  isSaving: boolean;
  containerRef: React.RefObject<HTMLDivElement | null>;
  width: number;
  dashboardPassword: string;
  setDashboardPassword: (value: string) => void;
  shareUrl: string;
  isPublished: boolean;
  setIsPublished: (val: boolean) => void;
  handleRegenerateLink: () => void;
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
  const isPublished = useFlowStore((s) => s.isPublished);
  const setIsPublished = useFlowStore((s) => s.setIsPublished);
  const shareSlug = useFlowStore((s) => s.shareSlug);
  const setShareSlug = useFlowStore((s) => s.setShareSlug);

  const [layout, setLayout] = useState<DashboardLayoutItem[]>([]);
  const [copied, setCopied] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1200);

  // Measure synchronously before paint so the grid doesn't briefly render
  // at the 1200 fallback width (visible as a "too wide" flash on load)
  // before the ResizeObserver's first, async callback corrects it.
  useLayoutEffect(() => {
    if (containerRef.current) setWidth(containerRef.current.getBoundingClientRect().width);
  }, []);

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
    // Pack new (never-saved) items into whichever of the 3 columns is
    // shortest so far, using each item's actual height - a fixed 5-unit
    // row slot regardless of height left dead space below shorter widgets.
    const columnY = [0, 0, 0];
    const newLayout: DashboardLayoutItem[] = uiNodes.map((node) => {
      const existing = savedItems.find((item) => item.i === node.id);
      if (existing) {
        // Heal corrupted width/position from earlier broken states: width
        // must be a whole column count in [2,12] (so a mangled 1.125 can
        // never render as a sliver again), x snapped inside the grid.
        // Height is left fractional on purpose - that is the half-step
        // precision we now allow on the vertical axis.
        const w = Math.min(12, Math.max(2, Math.round(existing.w)));
        const x = Math.min(12 - w, Math.max(0, Math.round(existing.x)));
        const h = Math.max(1, existing.h);
        const y = Math.max(0, existing.y);
        const col = Math.floor(x / 4);
        if (col >= 0 && col < columnY.length) {
          columnY[col] = Math.max(columnY[col], y + h);
        }
        return { i: node.id, x, y, w, h };
      }

      const { w, h } = NODE_DEFAULT_SIZES[node.type || ''] ?? { w: 6, h: 4 };
      const col = columnY.indexOf(Math.min(...columnY));
      const item = { i: node.id, x: col * 4, y: columnY[col], w, h };
      columnY[col] += h;
      return item;
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
      const { getGraphJson, dashboardPassword: pwd, isPublished: pub, shareSlug: slug } = useFlowStore.getState();
      const result = await flowsApi.save({
        id: flowId,
        name: flowName,
        graph_json: getGraphJson(),
        dashboard_layout: { items: layout },
        dashboard_password: pwd,
        is_published: pub,
        share_slug: slug || undefined,
      });
      if (result.share_slug) {
        setShareSlug(result.share_slug);
      }
    } catch (e) {
      console.error(e);
      alert('Failed to save layout to engine.');
    } finally {
      setIsSaving(false);
    }
  };

  const shareUrl = `${window.location.origin}/share/${shareSlug || flowId}`;

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRegenerateLink = () => {
    const newSlug = crypto.randomUUID();
    setShareSlug(newSlug);
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
    isPublished,
    setIsPublished,
    handleRegenerateLink,
    handleLayoutChange,
    handleSaveLayout,
    handleCopyUrl,
  };
}
