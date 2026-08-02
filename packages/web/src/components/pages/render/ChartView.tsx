import { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Button } from '../../ui/button';
import { columnsOf } from '../../../lib/notebook-outputs';
import { TableView } from './TableView';

/**
 * Rows as a chart.
 *
 * The *form* is declarable because the four forms answer four different questions: pie
 * asks what share of a whole, line asks how something changed, bar asks which is bigger,
 * area asks how a total filled up. Only the notebook's author knows which is being
 * asked. Everything around that question — colours, axes, gridlines, legend — is fixed,
 * so this is still one declaration rather than a configuration screen.
 *
 * Left unsaid, the form is inferred: a date-like x axis is a trend and gets a line,
 * anything else gets bars.
 *
 * A table view sits beside every chart. Partly because a chart should never be the only
 * way to read a value, and partly because three of the light-mode series colours sit
 * below 3:1 against the card — the table is what makes that safe.
 */

export type ChartForm = 'bar' | 'line' | 'area' | 'pie';

/** The token ceiling. Past eight, a ninth hue is indistinguishable from one already used. */
const MAX_SERIES = 8;

/**
 * Past this many slices a pie is unreadable — the segments are too thin to compare and
 * the palette has run out of distinguishable hues. Falling back to bars and saying so
 * beats drawing something nobody can read.
 */
const MAX_SLICES = 6;

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
  form,
}: {
  rows: Record<string, unknown>[];
  x?: string;
  form?: ChartForm;
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

  const tooManySlices = form === 'pie' && rows.length > MAX_SLICES;
  const shape: ChartForm = tooManySlices
    ? 'bar'
    : (form ?? (looksTemporal(rows.map((row) => row[xKey])) ? 'line' : 'bar'));

  const hidden = columns.filter((column) => column !== xKey && !series.includes(column));

  const axis = { stroke: 'var(--muted-foreground)', fontSize: 10, tickLine: false };
  const tooltip = {
    contentStyle: {
      background: 'var(--card)',
      border: '1px solid var(--border)',
      borderRadius: 0,
      fontSize: 11,
    },
    labelStyle: { color: 'var(--foreground)' },
  };

  // Recharts paints legend labels in the series colour. Identity is carried by the
  // swatch beside the word; the word itself is text and wears text ink, which also
  // keeps it readable for the light-mode slots that sit below 3:1 against the card.
  const legend = {
    wrapperStyle: { fontSize: 11 },
    formatter: (value: string) => <span style={{ color: 'var(--muted-foreground)' }}>{value}</span>,
  };

  const grid = <CartesianGrid stroke="var(--border)" vertical={false} />;
  const margin = { top: 8, right: 12, left: 0, bottom: 0 };

  const plot = () => {
    // A pie shows one measure split by category, so it reads the first series only.
    if (shape === 'pie') {
      const measure = series[0];
      return (
        <PieChart margin={margin}>
          <Tooltip {...tooltip} />
          <Legend {...legend} />
          <Pie
            data={data}
            dataKey={measure}
            nameKey={xKey}
            innerRadius="45%"
            outerRadius="75%"
            // A gap of surface between slices instead of a stroke around each one.
            stroke="var(--card)"
            strokeWidth={2}
          >
            {data.map((_, index) => (
              <Cell key={index} fill={`var(--series-${(index % MAX_SERIES) + 1})`} />
            ))}
          </Pie>
        </PieChart>
      );
    }

    if (shape === 'line') {
      return (
        <LineChart data={data} margin={margin}>
          {grid}
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
      );
    }

    if (shape === 'area') {
      return (
        <AreaChart data={data} margin={margin}>
          {grid}
          <XAxis dataKey={xKey} {...axis} />
          <YAxis {...axis} width={44} />
          <Tooltip {...tooltip} />
          {series.length > 1 && <Legend {...legend} />}
          {series.map((key, index) => (
            <Area
              key={key}
              type="monotone"
              dataKey={key}
              stroke={`var(--series-${index + 1})`}
              strokeWidth={2}
              fill={`var(--series-${index + 1})`}
              fillOpacity={0.15}
              stackId="all"
            />
          ))}
        </AreaChart>
      );
    }

    return (
      <BarChart data={data} margin={margin}>
        {grid}
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
            stroke="var(--card)"
            strokeWidth={2}
          />
        ))}
      </BarChart>
    );
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-end">
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
            {plot()}
          </ResponsiveContainer>
        </div>
      )}

      {!asTable && tooManySlices && (
        <p className="text-[10px] text-muted-foreground/70">
          {rows.length} slices is too many to read as a pie, so this is a bar chart. Group
          the rows down to {MAX_SLICES} or fewer in the notebook.
        </p>
      )}

      {!asTable && shape === 'pie' && series.length > 1 && (
        <p className="text-[10px] text-muted-foreground/70">
          A pie shows one measure, so this is “{series[0]}”. The rest are in the table view.
        </p>
      )}

      {!asTable && hidden.length > 0 && (
        <p className="text-[10px] text-muted-foreground/70">
          {hidden.join(', ')} {hidden.length === 1 ? 'is' : 'are'} in the table view.
        </p>
      )}
    </div>
  );
}
