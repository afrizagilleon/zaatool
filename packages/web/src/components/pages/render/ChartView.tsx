import { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Button } from '../../ui/button';
import { columnsOf } from '../../../lib/notebook-outputs';
import { TableView } from './TableView';

/**
 * Rows as a chart, with nothing to configure.
 *
 * The x axis is the first non-numeric column unless the output names one; the series
 * are every numeric column after it; the colours are the theme's fixed slots in order.
 * There is no place to choose a palette, and that is the point — the old `chartConfig`
 * let you pick three colours and the result was three shades of the same blue.
 *
 * Bars or a line is decided by the x axis: dates and ordered numbers are a trend and
 * get a line, names are categories and get bars.
 *
 * A table view sits beside every chart. Partly because a chart is never the only way a
 * value should be readable, and partly because three of the light-mode series colours
 * sit below 3:1 against the card — the table is what makes that safe.
 */

/** The token ceiling. Past eight, a ninth hue is indistinguishable from one already used. */
const MAX_SERIES = 8;

function isNumeric(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string' && value.trim() !== '') return Number.isFinite(Number(value));
  return false;
}

function looksTemporal(values: unknown[]): boolean {
  const sample = values.slice(0, 12).filter((value) => typeof value === 'string') as string[];
  if (sample.length === 0) return false;
  return sample.every((value) => /^\d{4}-\d{2}|^\d{1,2}[/-]\d{1,2}/.test(value));
}

export function ChartView({
  rows,
  x,
}: {
  rows: Record<string, unknown>[];
  x?: string;
}) {
  const [asTable, setAsTable] = useState(false);
  const columns = useMemo(() => columnsOf(rows), [rows]);

  const xKey = useMemo(() => {
    if (x && columns.includes(x)) return x;
    const categorical = columns.find((column) => !rows.every((row) => isNumeric(row[column])));
    return categorical ?? columns[0];
  }, [columns, rows, x]);

  const series = useMemo(
    () =>
      columns
        .filter((column) => column !== xKey && rows.some((row) => isNumeric(row[column])))
        .slice(0, MAX_SERIES),
    [columns, rows, xKey]
  );

  // Recharts wants numbers; a column of numeric strings is still a measure.
  const data = useMemo(
    () =>
      rows.map((row) => {
        const point: Record<string, unknown> = { [xKey]: row[xKey] };
        for (const key of series) point[key] = isNumeric(row[key]) ? Number(row[key]) : null;
        return point;
      }),
    [rows, series, xKey]
  );

  if (series.length === 0) return <TableView rows={rows} />;

  const trend = looksTemporal(rows.map((row) => row[xKey]));
  const hidden = columns.filter((column) => column !== xKey && !series.includes(column));

  const axis = { stroke: 'var(--muted-foreground)', fontSize: 10, tickLine: false };

  // Recharts paints legend labels in the series colour. Identity is carried by the
  // swatch beside the word; the word itself is text and wears text ink, which also
  // keeps it readable for the light-mode slots that sit below 3:1 against the card.
  const legend = {
    wrapperStyle: { fontSize: 11 },
    formatter: (value: string) => <span style={{ color: 'var(--muted-foreground)' }}>{value}</span>,
  };
  const tooltip = {
    contentStyle: {
      background: 'var(--card)',
      border: '1px solid var(--border)',
      borderRadius: 0,
      fontSize: 11,
    },
    labelStyle: { color: 'var(--foreground)' },
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-end gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[10px] text-muted-foreground"
          onClick={() => setAsTable((showing) => !showing)}
        >
          {asTable ? 'Chart' : 'Table'}
        </Button>
      </div>

      {asTable ? (
        <TableView rows={rows} />
      ) : (
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            {trend ? (
              <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey={xKey} {...axis} />
                <YAxis {...axis} width={44} />
                <Tooltip {...tooltip} />
                {series.length > 1 && <Legend {...legend} />}
                {series.map((key, index) => (
                  <Line
                    key={key}
                    type="monotone"
                    dataKey={key}
                    stroke={`var(--series-${index + 1})`}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--card)' }}
                  />
                ))}
              </LineChart>
            ) : (
              <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey={xKey} {...axis} />
                <YAxis {...axis} width={44} />
                <Tooltip {...tooltip} cursor={{ fill: 'var(--muted)', opacity: 0.4 }} />
                {series.length > 1 && <Legend {...legend} />}
                {series.map((key, index) => (
                  <Bar
                    key={key}
                    dataKey={key}
                    fill={`var(--series-${index + 1})`}
                    radius={[4, 4, 0, 0]}
                    // A surface-coloured gap rather than a stroke around each bar.
                    stroke="var(--card)"
                    strokeWidth={2}
                  />
                ))}
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>
      )}

      {hidden.length > 0 && !asTable && (
        <p className="text-[10px] text-muted-foreground/70">
          {hidden.join(', ')} {hidden.length === 1 ? 'is' : 'are'} in the table view.
        </p>
      )}
    </div>
  );
}
