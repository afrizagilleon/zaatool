import { useState, useRef, useEffect, useLayoutEffect } from 'react';

export function useDashboardLayout(layout: any[]) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(
    typeof window !== 'undefined' ? Math.min(window.innerWidth - 32, 1280) : 1200
  );
  const [fontSizes, setFontSizes] = useState<Record<string, number>>({});
  const [imageZooms, setImageZooms] = useState<Record<string, number>>({});
  const [copiedTextNode, setCopiedTextNode] = useState<string | null>(null);

  // Measure synchronously before paint so the grid doesn't briefly render
  // at the fallback width (visible as a "too wide" flash on load) before
  // the ResizeObserver's first, async callback corrects it.
  useLayoutEffect(() => {
    if (containerRef.current) setWidth(containerRef.current.getBoundingClientRect().width);
  }, []);

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

  const getResponsiveLayout = () => {
    if (width >= 768) {
      return layout.map((item) => ({ ...item, isDraggable: false, isResizable: false }));
    }
    const sortedItems = [...layout].sort((a, b) => {
      if (a.y !== b.y) return a.y - b.y;
      return a.x - b.x;
    });

    let currentY = 0;
    return sortedItems.map((item) => {
      const h = item.h || 4;
      const responsiveItem = {
        ...item,
        x: 0,
        y: currentY,
        w: 12,
        h,
        isDraggable: false,
        isResizable: false,
      };
      currentY += h;
      return responsiveItem;
    });
  };

  return {
    containerRef,
    width,
    fontSizes,
    imageZooms,
    copiedTextNode,
    setFontSizes,
    setImageZooms,
    setCopiedTextNode,
    getResponsiveLayout,
  };
}
