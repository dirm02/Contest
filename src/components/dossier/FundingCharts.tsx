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
import type { CraFundingPoint, ExternalFundingPoint } from '../../api/types';

interface FundingChartsProps {
  external: ExternalFundingPoint[];
  cra: CraFundingPoint[];
}

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="flex h-[320px] items-center justify-center rounded-2xl border border-dashed border-[var(--color-border)] bg-white/70 text-sm text-[var(--color-muted)]">
      {label}
    </div>
  );
}

export default function FundingCharts({ external, cra }: FundingChartsProps) {
  return (
    <section className="grid gap-6 xl:grid-cols-2">
      <article className="app-card rounded-2xl p-5">
        <div className="mb-4">
          <p className="section-title">External public funding</p>
          <h2 className="mt-2 text-xl font-semibold text-[var(--color-ink)]">
            Funding by fiscal year
          </h2>
        </div>
        {external.length === 0 ? (
          <EmptyChart label="No external funding data surfaced for this entity." />
        ) : (
          <div className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={external}>
                <CartesianGrid strokeDasharray="3 3" stroke="#d8d0c7" />
                <XAxis dataKey="fiscalYear" tick={{ fill: '#6b645c', fontSize: 12 }} />
                <YAxis tick={{ fill: '#6b645c', fontSize: 12 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="fedGrants" stackId="funding" fill="#2551b0" name="FED grants" />
                <Bar dataKey="abGrants" stackId="funding" fill="#3b82f6" name="AB grants" />
                <Bar dataKey="abContracts" stackId="funding" fill="#0f766e" name="AB contracts" />
                <Bar dataKey="abSoleSource" stackId="funding" fill="#14b8a6" name="AB sole source" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </article>

      <article className="app-card rounded-2xl p-5">
        <div className="mb-4">
          <p className="section-title">CRA self-reported finances</p>
          <h2 className="mt-2 text-xl font-semibold text-[var(--color-ink)]">
            Revenue vs expenditures
          </h2>
        </div>
        {cra.length === 0 ? (
          <EmptyChart label="No CRA financial history was surfaced for this entity." />
        ) : (
          <div className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={cra}>
                <CartesianGrid strokeDasharray="3 3" stroke="#d8d0c7" />
                <XAxis dataKey="year" tick={{ fill: '#6b645c', fontSize: 12 }} />
                <YAxis tick={{ fill: '#6b645c', fontSize: 12 }} />
                <Tooltip />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="revenue"
                  stroke="#2551b0"
                  strokeWidth={2.5}
                  dot={false}
                  name="CRA revenue"
                />
                <Line
                  type="monotone"
                  dataKey="expenditures"
                  stroke="#b54708"
                  strokeWidth={2.5}
                  dot={false}
                  name="CRA expenditures"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </article>
    </section>
  );
}
