import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQueries, useQuery } from '@tanstack/react-query';
import {
  fetchAccountability,
  fetchAdverseMedia,
  fetchAmendmentCreep,
  fetchDetailedLinks,
  fetchEntity,
  fetchFundingByYear,
  fetchGovernanceEntityPeople,
  fetchRelated,
  queryKeys,
} from '../api/client';
import {
  mapEntityGovernancePeople,
  mapEvidenceSections,
  mapFundingSeries,
  mapGraph,
  mapHeaderSummary,
  mapSignalCards,
} from '../api/mappers';
import HeaderSummary from '../components/dossier/HeaderSummary';
import FundingCharts from '../components/dossier/FundingCharts';
import SignalCards from '../components/dossier/SignalCards';
import RelationshipGraph from '../components/graph/RelationshipGraph';
import GraphFocusPanel from '../components/graph/GraphFocusPanel';
import EvidencePanel from '../components/dossier/EvidencePanel';
import DossierGovernanceSection from '../components/governance/DossierGovernanceSection';
import type { GraphNodeData } from '../api/types';

function LoadingSection({ label }: { label: string }) {
  return (
    <div className="app-card rounded-sm p-6">
      <div className="animate-pulse space-y-3">
        <div className="h-4 w-32 rounded-sm bg-[var(--color-border)]" />
        <div className="h-8 w-1/2 rounded-sm bg-[var(--color-border)]" />
        <div className="h-40 rounded-sm bg-[var(--color-surface-subtle)]" />
      </div>
      <p className="mt-4 text-[10px] font-black text-[var(--color-muted)] uppercase tracking-widest">{label}</p>
    </div>
  );
}

export default function DossierPage() {
  const params = useParams<{ id: string }>();
  const navigate = useNavigate();
  const entityId = Number(params.id);
  const [selectedNode, setSelectedNode] = useState<GraphNodeData | null>(null);

  const [entityQuery, fundingQuery, accountabilityQuery, relatedQuery] = useQueries({
    queries: [
      {
        queryKey: queryKeys.entity(entityId),
        queryFn: () => fetchEntity(entityId),
        enabled: Number.isFinite(entityId) && entityId > 0,
      },
      {
        queryKey: queryKeys.funding(entityId),
        queryFn: () => fetchFundingByYear(entityId),
        enabled: Number.isFinite(entityId) && entityId > 0,
      },
      {
        queryKey: queryKeys.accountability(entityId),
        queryFn: () => fetchAccountability(entityId),
        enabled: Number.isFinite(entityId) && entityId > 0,
      },
      {
        queryKey: queryKeys.related(entityId),
        queryFn: () => fetchRelated(entityId),
        enabled: Number.isFinite(entityId) && entityId > 0,
      },
    ],
  });

  const governanceQuery = useQuery({
    queryKey: queryKeys.governanceEntityPeople(entityId),
    queryFn: () => fetchGovernanceEntityPeople(entityId),
    enabled: Number.isFinite(entityId) && entityId > 0,
  });

  const detailedLinksQuery = useQuery({
    queryKey: queryKeys.detailedLinks(entityId),
    queryFn: () => fetchDetailedLinks(entityId),
    enabled: Number.isFinite(entityId) && entityId > 0,
  });

  const governancePeople = useMemo(
    () => (governanceQuery.data ? mapEntityGovernancePeople(governanceQuery.data) : []),
    [governanceQuery.data],
  );

  const isLoading =
    entityQuery.isLoading ||
    fundingQuery.isLoading ||
    accountabilityQuery.isLoading ||
    relatedQuery.isLoading;

  const isError =
    entityQuery.isError ||
    fundingQuery.isError ||
    accountabilityQuery.isError ||
    relatedQuery.isError;

  const errorMessage = [entityQuery, fundingQuery, accountabilityQuery, relatedQuery]
    .map((query) => (query.error instanceof Error ? query.error.message : null))
    .find(Boolean);

  const viewModel = useMemo(() => {
    if (
      !entityQuery.data ||
      !fundingQuery.data ||
      !accountabilityQuery.data ||
      !relatedQuery.data
    ) {
      return null;
    }

    const summary = mapHeaderSummary(entityQuery.data, relatedQuery.data);
    const funding = mapFundingSeries(fundingQuery.data);
    const signals = mapSignalCards(accountabilityQuery.data, relatedQuery.data);
    const graph = mapGraph(entityQuery.data, relatedQuery.data);
    const evidence = mapEvidenceSections(
      entityQuery.data,
      fundingQuery.data,
      accountabilityQuery.data,
      relatedQuery.data,
    );

    return { summary, funding, signals, graph, evidence };
  }, [accountabilityQuery.data, entityQuery.data, fundingQuery.data, relatedQuery.data]);

  const adverseMediaQuery = useQuery({
    queryKey: queryKeys.adverseMedia(viewModel?.summary.canonicalName ?? ''),
    queryFn: () => fetchAdverseMedia(viewModel?.summary.canonicalName ?? ''),
    enabled: Boolean(viewModel?.summary.canonicalName),
    staleTime: 30 * 60 * 1000,
  });

  const amendmentCreepQuery = useQuery({
    queryKey: queryKeys.amendmentCreep({
      vendor: viewModel?.summary.canonicalName ?? '',
      limit: 1,
      minCreepRatio: 0,
    }),
    queryFn: () =>
      fetchAmendmentCreep({
        vendor: viewModel?.summary.canonicalName ?? '',
        limit: 1,
        minCreepRatio: 0,
      }),
    enabled: Boolean(viewModel?.summary.canonicalName),
    staleTime: 30 * 60 * 1000,
  });

  if (!Number.isFinite(entityId) || entityId <= 0) {
    return (
      <div className="app-card rounded-sm p-8 text-center border-l-4 border-l-[var(--color-risk-high)]">
        <p className="section-title text-[var(--color-risk-high)]">INVALID ENTITY IDENTIFIER</p>
        <p className="mt-3 text-sm font-bold text-[var(--color-ink-strong)]">
          The requested dossier route requires a valid numeric entity identifier.
        </p>
      </div>
    );
  }

  if (isLoading || !viewModel) {
    return (
      <section className="space-y-6">
        <LoadingSection label="INITIALIZING FORENSIC DOSSIER..." />
        <LoadingSection label="FETCHING FUNDING PROVENANCE AND GRAPH DATA..." />
      </section>
    );
  }

  if (isError) {
    return (
      <div className="app-card rounded-sm border-l-4 border-l-[var(--color-risk-high)] p-8">
        <p className="section-title text-[var(--color-risk-high)]">DOSSIER RETRIEVAL FAILED</p>
        <p className="mt-3 text-sm font-bold text-[var(--color-ink-strong)]">
          {errorMessage ?? 'One or more forensic dossier endpoints returned an unrecoverable error.'}
        </p>
        <Link
          className="mt-6 inline-flex rounded-sm bg-[var(--color-accent)] px-6 py-2.5 text-[11px] font-black tracking-widest text-white uppercase hover:bg-[var(--color-accent-hover)] transition-colors"
          to="/"
        >
          RETURN TO SEARCH
        </Link>
      </div>
    );
  }

  return (
    <section className="space-y-8">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-4">
        <div className="flex items-center gap-4">
          <Link
            to="/"
            className="flex items-center gap-2 rounded-sm border border-[var(--color-border)] bg-white px-3 py-1.5 text-[10px] font-black text-[var(--color-muted)] uppercase tracking-widest transition hover:bg-[var(--color-surface-subtle)]"
          >
            ← BACK TO SEARCH
          </Link>
          <div className="h-4 w-px bg-[var(--color-border)]" />
          <span className="text-[10px] font-black text-[var(--color-muted-light)] uppercase tracking-[0.2em]">
            OFFICIAL DOSSIER #{viewModel.summary.id}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex size-2 rounded-full bg-[var(--color-success)] animate-pulse" />
          <span className="text-[10px] font-black text-[var(--color-success)] uppercase tracking-widest">
            LIVE EVIDENCE
          </span>
        </div>
      </div>

      <HeaderSummary
        summary={viewModel.summary}
        signals={viewModel.signals}
        adverseMediaCount={adverseMediaQuery.data?.total}
        isAdverseMediaLoading={adverseMediaQuery.isLoading}
        isAdverseMediaError={adverseMediaQuery.isError}
        amendmentCreepCount={amendmentCreepQuery.data?.total}
        amendmentCreepMaxScore={amendmentCreepQuery.data?.results[0]?.risk_score}
        isAmendmentCreepLoading={amendmentCreepQuery.isLoading}
        isAmendmentCreepError={amendmentCreepQuery.isError}
      />

      <FundingCharts external={viewModel.funding.external} cra={viewModel.funding.cra} />

      <SignalCards cards={viewModel.signals} />

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <div>
            <p className="section-title">RELATIONSHIP GRAPH</p>
            <h2 className="mt-2 text-xl font-black text-[var(--color-ink-strong)] uppercase tracking-tight">
              Direct related entities and candidate links
            </h2>
          </div>
          <RelationshipGraph
            nodes={viewModel.graph.nodes}
            edges={viewModel.graph.edges}
            selectedNodeId={selectedNode?.id ?? null}
            onSelectNode={setSelectedNode}
          />
        </div>

        <GraphFocusPanel
          node={selectedNode}
          onOpenEntity={(nextId) => {
            setSelectedNode(null);
            navigate(`/entity/${nextId}`);
          }}
        />
      </section>

      <DossierGovernanceSection
        entityId={entityId}
        rows={governancePeople}
        isLoading={governanceQuery.isLoading}
        isError={governanceQuery.isError}
        errorMessage={governanceQuery.error instanceof Error ? governanceQuery.error.message : undefined}
      />

      <EvidencePanel
        sections={viewModel.evidence}
        detailedLinks={detailedLinksQuery.data}
        isDetailedLinksLoading={detailedLinksQuery.isLoading || detailedLinksQuery.isFetching}
        isDetailedLinksError={detailedLinksQuery.isError}
        detailedLinksErrorMessage={
          detailedLinksQuery.error instanceof Error ? detailedLinksQuery.error.message : undefined
        }
      />
    </section>
  );
}
