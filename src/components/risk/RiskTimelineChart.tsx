import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { RecipientRiskTimelinePoint } from '../../api/types';

interface RiskTimelineChartProps {
  data: RecipientRiskTimelinePoint[];
}

export default function RiskTimelineChart({ data }: RiskTimelineChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-[320px] items-center justify-center rounded-2xl border border-dashed border-[var(--color-border)] bg-white/70 text-sm text-[var(--color-muted)]">
        No yearly funding timeline surfaced for this recipient.
      </div>
    );
  }

  return (
    <div className="h-[320px]">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#d8d0c7" />
          <XAxis dataKey="year" tick={{ fill: '#6b645c', fontSize: 12 }} />
          <YAxis yAxisId="funding" tick={{ fill: '#6b645c', fontSize: 12 }} />
          <YAxis yAxisId="count" orientation="right" tick={{ fill: '#6b645c', fontSize: 12 }} />
          <Tooltip />
          <Bar yAxisId="funding" dataKey="totalValue" fill="#2551b0" name="Total funding" radius={[6, 6, 0, 0]} />
          <Line yAxisId="count" type="monotone" dataKey="grantCount" stroke="#b54708" strokeWidth={2.5} dot={false} name="Grant count" />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
