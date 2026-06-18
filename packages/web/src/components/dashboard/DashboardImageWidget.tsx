import { API_BASE_URL } from '../../lib/api.js';

interface DashboardImageWidgetProps {
  node: any;
  outputs: any;
  data: any;
  zoom?: number;
}

export function DashboardImageWidget({ node: _node, outputs, data, zoom }: DashboardImageWidgetProps) {
  const srcObj = outputs.src || data.inputs?.src || '';
  let src = '';
  if (typeof srcObj === 'object' && srcObj !== null) {
    src = srcObj.url || srcObj.path || '';
  } else {
    src = String(srcObj);
  }

  if (!src) {
    return <span className="text-muted-foreground text-xs italic">No image source</span>;
  }

  // Handle storage paths
  const imgUrl = src.startsWith('http') ? src : `${API_BASE_URL}/storage/${src.replace(/^\/+/, '')}`;
  const currentZoom = zoom || 1.0;

  return (
    <div className="w-full h-full flex items-center justify-center min-w-full min-h-full p-2 overflow-auto">
      <img
        src={imgUrl}
        alt="Dynamic Preview"
        className="max-w-full max-h-full object-contain transition-transform duration-200"
        style={{ transform: `scale(${currentZoom})`, transformOrigin: 'center center' }}
      />
    </div>
  );
}
