import { useMemo, useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchLoopDetail, queryKeys } from '../api/client';
import {
  formatCurrencyAmount,
  loopInterpretationLabel,
  mapLoopDetail,
} from '../api/mappers';
import LoopGraph from '../components/loops/LoopGraph';
import { useChat } from '../components/chat/ChatContext';

function LoadingSection({ label }: { label: string }) {
  return (
    <div className="app-card rounded-2xl p-6">
      <div className="animate-pulse space-y-3">
        <div className="h-4 w-32 rounded bg-stone-200" />
        <div className="h-8 w-1/2 rounded bg-stone-200" />
        <div className="h-40 rounded bg-stone-100" />
      </div>
      <p className="mt-4 text-sm text-[var(--color-muted)]">{label}</p>
    </div>
  );
}

export default function LoopDetailPage() {
  const params = useParams<{ loopId: string }>();
  const navigate = useNavigate();
  const loopId = Number(params.loopId);
  const { setPageContext } = useChat();

  const detailQuery = useQuery({
    queryKey: queryKeys.loopDetail(loopId),
    queryFn: () => fetchLoopDetail(loopId),
    enabled: Number.isFinite(loopId),
    staleTime: 60_000,
  });

  const detail = useMemo(
    () => (detailQuery.data ? mapLoopDetail(detailQuery.data) : null),
    [detailQuery.data],
  );

  useEffect(() => {
    if (detail) {
      setPageContext({
        type: 'funding_loop',
        loopId: detail.summary.loopId,
        path: detail.summary.pathDisplay,
        participantCount: detail.summary.participantCount,
        totalFlow: detail.summary.totalFlowWindow,
        bottleneck: detail.summary.bottleneckWindow,
        interpretation: detail.summary.interpretationLabel,
        participants: detail.participants.map(p => ({ name: p.legalName, bn: p.bn })),
      });
    }
    return () => setPageContext(null);
  }, [detail, setPageContext]);

  if (!Number.isFinite(loopId)) {
    return (
      <div className="app-card rounded-2xl p-6">
        <p className="section-title">Invalid loop</p>
        <p className="mt-2 text-sm text-[var(--color-muted)]">A numeric loop id is required.</p>
      </div>
    );
  }

  if (detailQuery.isLoading) {
    return (
      <section className="space-y-6">
        <LoadingSection label="Loading loop summary…" />
        <LoadingSection label="Loading loop detail graph…" />
      </section>
    );
  }

  if (detailQuery.isError) {
    return (
      <div className="app-card rounded-2xl border-[var(--color-risk-high)] p-6">
        <p className="section-title">Loop detail failed to load</p>
        <p className="mt-2 text-sm text-[var(--color-risk-high)]">
          {detailQuery.error instanceof Error
            ? detailQuery.error.message
            : 'Loop endpoint returned an error.'}
        </p>
      </div>
    );
  }

  if (!detail) return null;

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          to="/loops"
          className="rounded-full border border-[var(--color-border)] bg-white/80 px-3 py-1.5 text-sm text-[var(--color-muted)] transition hover:bg-white"
        >
          Back to loops
        </Link>
        <span className="section-title">Loop #{detail.summary.loopId}</span>
      </div>

      <section className="app-card rounded-2xl p-6 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="section-title">Loop summary</p>
            <h1 className="mt-2 max-w-5xl text-2xl font-semibold tracking-tight text-[var(--color-ink)] sm:text-4xl">
              {detail.summary.pathDisplay}
            </h1>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-wide signal-badge-medium">
                Score {detail.summary.challenge3SortScore}
              </span>
              <span className="rounded-full px-2.5 py-1 text-[11px] font-medium signal-badge-info">
                {detail.summary.interpretationLabel}
              </span>
              {detail.summary.sameYear && (
                <span className="rounded-full px-2.5 py-1 text-[11px] font-medium signal-badge-high">
                  Same-year
                </span>
              )}
            </div>
          </div>
          <div className="rounded-2xl border border-[var(--color-border)] bg-white/80 px-4 py-3 text-sm text-[var(--color-muted)]">
            <div>Years {detail.summary.minYear ?? '—'}–{detail.summary.maxYear ?? '—'}</div>
            <div className="mt-1">
              {loopInterpretationLabel(detail.summary.loopInterpretation)}
            </div>
          </div>
        </div>

        <dl className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-[var(--color-border)] bg-white/80 p-4">
            <dt className="section-title">Participants</dt>
            <dd className="metric-value mt-2 text-2xl">{detail.summary.participantCount}</dd>
          </div>
          <div className="rounded-2xl border border-[var(--color-border)] bg-white/80 p-4">
            <dt className="section-title">Hops</dt>
            <dd className="metric-value mt-2 text-2xl">{detail.summary.hops}</dd>
          </div>
          <div className="rounded-2xl border border-[var(--color-border)] bg-white/80 p-4">
            <dt className="section-title">Bottleneck</dt>
            <dd className="metric-value mt-2 text-2xl">
              {formatCurrencyAmount(detail.summary.bottleneckWindow)}
            </dd>
          </div>
          <div className="rounded-2xl border border-[var(--color-border)] bg-white/80 p-4">
            <dt className="section-title">Window flow</dt>
            <dd className="metric-value mt-2 text-2xl">
              {formatCurrencyAmount(detail.summary.totalFlowWindow)}
            </dd>
          </div>
        </dl>
      </section>

      <section className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
        {detail.evidence.map((item) => {
          const tone =
            item.tone === 'review'
              ? 'signal-badge-medium'
              : item.tone === 'context'
                ? 'signal-badge-info'
                : 'signal-badge-low';
          return (
            <article key={item.id} className="app-card rounded-2xl p-5">
              <div className="flex items-center justify-between gap-3">
                <p className="section-title">Why surfaced</p>
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${tone}`}>
                  {item.tone}
                </span>
              </div>
              <h2 className="mt-2 text-lg font-semibold text-[var(--color-ink)]">{item.title}</h2>
              <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">{item.body}</p>
            </article>
          );
        })}
      </section>

      <section className="space-y-3">
        <div>
          <p className="section-title">Loop graph</p>
          <h2 className="mt-2 text-xl font-semibold text-[var(--color-ink)]">
            Circular path across {detail.summary.participantCount} participants
          </h2>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            Nodes are placed in loop order. Click a node to open its dossier when an entity match is available.
          </p>
        </div>
        <LoopGraph
          nodes={detail.graph.nodes}
          edges={detail.graph.edges}
          onSelectEntity={(entityId) => navigate(`/entity/${entityId}`)}
        />
      </section>

      <section className="space-y-3">
        <div>
          <p className="section-title">Participants</p>
          <h2 className="mt-2 text-xl font-semibold text-[var(--color-ink)]">
            Ordered participant breakdown
          </h2>
        </div>

        <div className="grid gap-4">
          {detail.participants.map((participant) => (
            <article key={participant.bn} className="app-card rounded-2xl p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-[var(--color-border)] bg-white/80 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
                      Position {participant.positionInLoop}
                    </span>
                    <span className="rounded-full px-2.5 py-1 text-[11px] font-medium signal-badge-info">
                      CRA score {participant.craLoopScore}
                    </span>
                    <span className="rounded-full px-2.5 py-1 text-[11px] font-medium signal-badge-low">
                      {participant.totalLoops} loop{participant.totalLoops === 1 ? '' : 's'}
                    </span>
                  </div>

                  <div>
                    <h3 className="text-lg font-semibold text-[var(--color-ink)]">{participant.legalName}</h3>
                    <p className="text-xs text-[var(--color-muted)]">{participant.bn}</p>
                  </div>

                  <div className="grid gap-2 text-sm text-[var(--color-muted)] md:grid-cols-2 xl:grid-cols-3">
                    <p>
                      Sends to <span className="font-medium text-[var(--color-ink)]">{participant.sendsToName ?? participant.sendsTo}</span>
                    </p>
                    <p>
                      Receives from <span className="font-medium text-[var(--color-ink)]">{participant.receivesFromName ?? participant.receivesFrom}</span>
                    </p>
                    <p>
                      Circular amount <span className="font-medium text-[var(--color-ink)]">{formatCurrencyAmount(participant.totalCircularAmount)}</span>
                    </p>
                    <p>
                      Revenue <span className="font-medium text-[var(--color-ink)]">{formatCurrencyAmount(participant.revenue)}</span>
                    </p>
                    <p>
                      Programs <span className="font-medium text-[var(--color-ink)]">{formatCurrencyAmount(participant.programSpending)}</span>
                    </p>
                    <p>
                      Admin + FR + Comp <span className="font-medium text-[var(--color-ink)]">{formatCurrencyAmount(participant.adminSpending + participant.fundraisingSpending + participant.compensationSpending)}</span>
                    </p>
                  </div>
                </div>

                {participant.entityId ? (
                  <Link
                    to={`/entity/${participant.entityId}`}
                    className="btn rounded-xl border border-transparent bg-[var(--color-accent)] px-4 py-2.5 text-sm font-medium text-white hover:opacity-90"
                  >
                    Open dossier
                  </Link>
                ) : (
                  <span className="rounded-xl border border-[var(--color-border)] bg-white/80 px-4 py-2.5 text-sm text-[var(--color-muted)]">
                    No entity match
                  </span>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}
