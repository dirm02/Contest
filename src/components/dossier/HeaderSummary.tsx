import type { HeaderSummary as HeaderSummaryData, SignalCard } from '../../api/types';

interface HeaderSummaryProps {
  summary: HeaderSummaryData;
  signals: SignalCard[];
}

function RiskMeter({ signals }: { signals: SignalCard[] }) {
  // Calculate a composite risk score [0-100] based on signals
  // High = 25, Medium = 15, Low = 5, Info = 0
  const totalScore = signals.reduce((acc, signal) => {
    switch (signal.severity) {
      case 'high': return acc + 25;
      case 'medium': return acc + 15;
      case 'low': return acc + 5;
      default: return acc;
    }
  }, 0);

  const cappedScore = Math.min(totalScore, 100);
  
  // Calculate angle for the needle (0 to 180 degrees)
  // 0 score = -90deg, 100 score = 90deg (assuming 180deg arc)
  // Actually let's map 0-100 to -90 to 90 degrees rotation
  const needleRotation = (cappedScore / 100) * 180 - 90;

  let label = 'Very Low';
  let colorClass = 'text-[var(--color-risk-low)]';
  if (cappedScore > 80) {
    label = 'Very High';
    colorClass = 'text-[var(--color-risk-high)]';
  } else if (cappedScore > 60) {
    label = 'High';
    colorClass = 'text-[var(--color-risk-medium)]'; // Using medium color for high as per reference colors
  } else if (cappedScore > 40) {
    label = 'Moderate';
    colorClass = 'text-yellow-600';
  } else if (cappedScore > 20) {
    label = 'Low';
    colorClass = 'text-lime-600';
  } else {
    label = 'Very Low';
    colorClass = 'text-green-600';
  }

  return (
    <div className="flex flex-col items-center justify-center p-2">
      <div className="relative h-24 w-48 overflow-hidden">
        {/* Gauge Background Segments */}
        <svg viewBox="0 0 100 50" className="h-full w-full">
          {/* Very Low - Green */}
          <path d="M 10 50 A 40 40 0 0 1 26 14.6" fill="none" stroke="#16a34a" strokeWidth="12" />
          {/* Low - Light Green */}
          <path d="M 26 14.6 A 40 40 0 0 1 50 10" fill="none" stroke="#65a30d" strokeWidth="12" />
          {/* Moderate - Yellow */}
          <path d="M 50 10 A 40 40 0 0 1 74 14.6" fill="none" stroke="#ca8a04" strokeWidth="12" />
          {/* High - Orange */}
          <path d="M 74 14.6 A 40 40 0 0 1 90 50" fill="none" stroke="#ea580c" strokeWidth="12" />
          {/* Very High - Red */}
          {/* Note: The reference has 5 segments but I'll adjust the paths to match 5 segments properly */}
        </svg>

        {/* Improved Gauge with 5 segments */}
        <svg viewBox="0 0 100 50" className="absolute inset-0 h-full w-full">
          {/* Very Low (0-20%) - 0 to 36 degrees */}
          <path d="M 10 50 A 40 40 0 0 1 21.7 26.5" fill="none" stroke="#059669" strokeWidth="12" />
          {/* Low (20-40%) - 36 to 72 degrees */}
          <path d="M 21.7 26.5 A 40 40 0 0 1 42.4 12.0" fill="none" stroke="#84cc16" strokeWidth="12" />
          {/* Moderate (40-60%) - 72 to 108 degrees */}
          <path d="M 42.4 12.0 A 40 40 0 0 1 57.6 12.0" fill="none" stroke="#eab308" strokeWidth="12" />
          {/* High (60-80%) - 108 to 144 degrees */}
          <path d="M 57.6 12.0 A 40 40 0 0 1 78.3 26.5" fill="none" stroke="#f97316" strokeWidth="12" />
          {/* Very High (80-100%) - 144 to 180 degrees */}
          <path d="M 78.3 26.5 A 40 40 0 0 1 90 50" fill="none" stroke="#ef4444" strokeWidth="12" />
        </svg>

        {/* Needle */}
        <div 
          className="absolute bottom-0 left-1/2 h-20 w-1 origin-bottom bg-stone-800 transition-transform duration-1000 ease-out"
          style={{ transform: `translateX(-50%) rotate(${needleRotation}deg)` }}
        >
          <div className="absolute -top-1 left-1/2 h-3 w-3 -translate-x-1/2 rounded-full bg-stone-800" />
        </div>
        <div className="absolute bottom-0 left-1/2 h-4 w-4 -translate-x-1/2 translate-y-1/2 rounded-full border-2 border-white bg-stone-800 shadow-sm" />
      </div>
      
      <div className="mt-2 text-center">
        <span className={`text-xs font-bold uppercase tracking-widest ${colorClass}`}>
          {label}
        </span>
        <p className="text-[10px] text-[var(--color-muted)] font-medium">Risk Assessment Score: {cappedScore}</p>
      </div>
    </div>
  );
}

export default function HeaderSummary({ summary, signals }: HeaderSummaryProps) {
  return (
    <section className="app-card rounded-2xl p-6 sm:p-7">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex flex-1 flex-col gap-6 sm:flex-row sm:items-start sm:justify-between lg:justify-start lg:gap-12">
          <div className="space-y-3">
            <p className="section-title">Entity dossier</p>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-ink)] sm:text-4xl">
                {summary.canonicalName}
              </h1>
              <p className="mt-2 text-sm text-[var(--color-muted)]">
                BN root: {summary.bnRoot ?? 'Unavailable'}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {summary.datasets.length > 0 ? (
                summary.datasets.map((dataset) => (
                  <span
                    key={dataset}
                    className="dataset-badge rounded-full px-2.5 py-1 text-xs font-medium"
                  >
                    {dataset}
                  </span>
                ))
              ) : (
                <span className="dataset-badge rounded-full px-2.5 py-1 text-xs font-medium">
                  No dataset tag
                </span>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center justify-center rounded-2xl border border-[var(--color-border)] bg-stone-50/50 p-4 shadow-inner">
            <RiskMeter signals={signals} />
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border border-[var(--color-border)] bg-white/80 p-4">
            <dt className="section-title">Aliases</dt>
            <dd className="metric-value mt-2 text-2xl">{summary.aliasCount}</dd>
          </div>
          <div className="rounded-2xl border border-[var(--color-border)] bg-white/80 p-4">
            <dt className="section-title">Related</dt>
            <dd className="metric-value mt-2 text-2xl">{summary.relatedCount}</dd>
          </div>
          <div className="rounded-2xl border border-[var(--color-border)] bg-white/80 p-4">
            <dt className="section-title">Source links</dt>
            <dd className="metric-value mt-2 text-2xl">{summary.linkCount}</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}
