import ReactMarkdown from 'react-markdown';

interface DashboardTextWidgetProps {
  node: any;
  data: any;
  outputs: any;
  fontSize?: number;
}

export function DashboardTextWidget({ node: _node, data, outputs, fontSize }: DashboardTextWidgetProps) {
  const currentFontSize = fontSize || 13;
  const value = outputs.value || outputs.text || data.inputs?.text || '';

  if (!value) {
    return <span className="text-muted-foreground text-xs italic">Waiting for text...</span>;
  }

  // Check if value is JSON
  try {
    if (typeof value === 'string' && (value.trim().startsWith('{') || value.trim().startsWith('['))) {
      const parsed = JSON.parse(value);
      return (
        <pre
          style={{ fontSize: `${currentFontSize}px` }}
          className="bg-muted/30 p-2.5 rounded-lg font-mono overflow-x-auto text-foreground border border-border"
        >
          {JSON.stringify(parsed, null, 2)}
        </pre>
      );
    }
  } catch (e) {
    // Not JSON, continue
  }

  if (typeof value === 'object') {
    return (
      <pre
        style={{ fontSize: `${currentFontSize}px` }}
        className="bg-muted/30 p-2.5 rounded-lg font-mono overflow-x-auto text-foreground border border-border"
      >
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  }

  return (
    <div
      style={{ fontSize: `${currentFontSize}px` }}
      className="prose dark:prose-invert max-w-none leading-relaxed text-foreground"
    >
      <ReactMarkdown>{String(value).replace(/\\n/g, '\n')}</ReactMarkdown>
    </div>
  );
}
