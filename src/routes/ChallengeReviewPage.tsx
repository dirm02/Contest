import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchChallengeReview, queryKeys } from '../api/client';

function formatCount(value: number) {
  return new Intl.NumberFormat('en-CA').format(value);
}

function statusLabel(status: string) {
  return status === 'ready_to_validate' ? 'Ready to validate' : 'Needs source mapping';
}

export default function ChallengeReviewPage() {
  const query = useQuery({
    queryKey: queryKeys.challengeReview(),
    queryFn: fetchChallengeReview,
    staleTime: 60_000,
  });

  const review = query.data;

  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <p className="section-title">Validation pass</p>
        <h1 className="max-w-4xl text-3xl font-semibold tracking-tight text-[var(--color-ink)] sm:text-5xl">
          Review solved challenges before moving on
        </h1>
        <p className="max-w-3xl text-sm leading-6 text-[var(--color-muted)] sm:text-base">
          BigQuery is now the analytics layer. This page tracks how Challenges 1, 2, 3, 4,
          6, and 10 should be recomputed, compared, and served before the team starts 5,
          7, 8, or 9.
        </p>
      </div>

      {query.isError && (
        <div className="app-card rounded-2xl border-[var(--color-risk-high)] p-5 text-sm text-[var(--color-risk-high)]">
          {query.error instanceof Error ? query.error.message : 'Challenge review endpoint failed.'}
        </div>
      )}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="app-card rounded-2xl p-5">
          <p className="section-title">Solved challenges</p>
          <p className="metric-value mt-2 text-3xl">
            {review ? review.summary.solved_challenges : '...'}
          </p>
        </div>
        <div className="app-card rounded-2xl p-5">
          <p className="section-title">Ready for BigQuery</p>
          <p className="metric-value mt-2 text-3xl">
            {review ? review.summary.ready_to_validate : '...'}
          </p>
        </div>
        <div className="app-card rounded-2xl p-5">
          <p className="section-title">Remaining</p>
          <p className="metric-value mt-2 text-3xl">
            {review ? review.summary.remaining_challenges.join(', ') : '...'}
          </p>
        </div>
        <div className="app-card rounded-2xl p-5">
          <p className="section-title">BigQuery</p>
          <p className="metric-value mt-2 text-2xl">
            {review ? (review.bigquery.available ? 'Connected' : 'Offline') : '...'}
          </p>
        </div>
      </section>

      {review && (
        <section className="app-card rounded-2xl p-5">
          <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
            <div>
              <p className="section-title">Architecture</p>
              <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">
                {review.strategy.priority}
              </p>
            </div>
            <dl className="grid gap-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="section-title">Analytics</dt>
                <dd className="mt-1 font-semibold text-[var(--color-ink)]">
                  {review.strategy.analytics_engine}
                </dd>
              </div>
              <div>
                <dt className="section-title">Serving</dt>
                <dd className="mt-1 font-semibold text-[var(--color-ink)]">
                  {review.strategy.serving_engine}
                </dd>
              </div>
              <div>
                <dt className="section-title">Dataset</dt>
                <dd className="mt-1 break-words font-semibold text-[var(--color-ink)]">
                  {review.bigquery.dataset}
                </dd>
              </div>
            </dl>
          </div>
          {!review.bigquery.available && review.bigquery.error && (
            <p className="mt-4 rounded-xl border border-[var(--color-risk-high)] bg-white p-3 text-sm text-[var(--color-risk-high)]">
              {review.bigquery.error}
            </p>
          )}
        </section>
      )}

      <div className="grid gap-4">
        {query.isLoading && (
          <div className="app-card rounded-2xl p-6 text-sm text-[var(--color-muted)]">
            Loading challenge validation plan...
          </div>
        )}

        {review?.challenges.map((challenge) => (
          <article key={challenge.id} className="app-card rounded-2xl p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full px-2.5 py-1 text-xs font-semibold signal-badge-info">
                    Challenge {challenge.id}
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                      challenge.status === 'ready_to_validate'
                        ? 'signal-badge-low'
                        : 'signal-badge-medium'
                    }`}
                  >
                    {statusLabel(challenge.status)}
                  </span>
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-[var(--color-ink)]">
                    {challenge.title}
                  </h2>
                  <p className="mt-1 text-sm leading-6 text-[var(--color-muted)]">
                    {challenge.currentState}
                  </p>
                </div>
                <div className="grid gap-3 text-sm lg:grid-cols-3">
                  <div>
                    <p className="section-title">Validate</p>
                    <p className="mt-1 leading-6 text-[var(--color-muted)]">
                      {challenge.validationGoal}
                    </p>
                  </div>
                  <div>
                    <p className="section-title">Serve faster</p>
                    <p className="mt-1 leading-6 text-[var(--color-muted)]">
                      {challenge.servingStrategy}
                    </p>
                  </div>
                  <div>
                    <p className="section-title">UI review</p>
                    <p className="mt-1 leading-6 text-[var(--color-muted)]">
                      {challenge.uiReview}
                    </p>
                  </div>
                </div>
              </div>

              <aside className="grid min-w-[280px] gap-3 text-sm">
                <div className="rounded-xl border border-[var(--color-border)] bg-white p-3">
                  <p className="section-title">Source rows</p>
                  <p className="mt-2 font-semibold text-[var(--color-ink)]">
                    Postgres {formatCount(challenge.postgresRowCount)}
                  </p>
                  <p className="text-[var(--color-muted)]">
                    BigQuery {formatCount(challenge.bigQueryRowCount)}
                  </p>
                </div>
                <div className="rounded-xl border border-[var(--color-border)] bg-white p-3">
                  <p className="section-title">Endpoints</p>
                  <p className="mt-2 text-xs leading-5 text-[var(--color-muted)]">
                    {challenge.endpoints.join(' / ')}
                  </p>
                </div>
                <Link
                  to={challenge.route}
                  className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[var(--color-accent)] px-4 text-sm font-semibold text-white transition hover:opacity-90"
                >
                  Open current view
                </Link>
              </aside>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
