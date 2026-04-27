import type {
  AccountabilityResponseApi,
  CrossDatasetContextApi,
  CrossDatasetContextModel,
  CraFundingPoint,
  DatasetTag,
  EntityGovernancePersonRow,
  EntityGovernanceResponseApi,
  EntityResponseApi,
  EvidenceSection,
  ExternalFundingPoint,
  FundingByYearResponseApi,
  GovernanceInterpretation,
  GovernancePairApi,
  GovernancePairRow,
  GovernancePairsResponseApi,
  GraphEdgeData,
  GraphNodeData,
  GhostCapacityDetailModel,
  GhostCapacityDetailResponseApi,
  GhostCapacityResponseApi,
  HeaderSummary,
  LoopDetailModel,
  LoopDetailResponseApi,
  LoopInterpretation,
  LoopListRow,
  LoopParticipantRow,
  LoopsResponseApi,
  PersonProfileModel,
  PersonProfileResponseApi,
  PersonSearchResponseApi,
  PersonSearchRow,
  RecipientRiskEvidenceApi,
  RecipientRiskEvidenceCard,
  RecipientRiskHistoryRow,
  RecipientRiskHistoryRowApi,
  RecipientRiskRow,
  RecipientRiskSummaryApi,
  RecipientRiskTimelinePoint,
  RecipientRiskTimelinePointApi,
  RelatedResponseApi,
  SearchResponseApi,
  SearchResult,
  SignalCard,
  SignalSeverity,
  ZombieDetailModel,
  ZombieDetailResponseApi,
  ZombiesResponseApi,
} from './types';

function toNumber(value: number | string | null | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function toBoolean(value: boolean | string | null | undefined): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.toLowerCase() === 'true' || value === '1' || value === 'Y';
  return false;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    maximumFractionDigits: 0,
  }).format(amount);
}

export function mapDatasets(raw?: string[] | null): DatasetTag[] {
  const values = (raw ?? []).map((item) => item.toUpperCase());
  const tags: DatasetTag[] = [];
  if (values.some((item) => item.includes('CRA'))) tags.push('CRA');
  if (values.some((item) => item.includes('FED'))) tags.push('FED');
  if (values.some((item) => item === 'AB' || item.includes('AB_'))) tags.push('AB');
  return tags;
}

export function mapSearchResults(response: SearchResponseApi): SearchResult[] {
  return response.results.map((result) => ({
    id: result.id,
    canonicalName: result.canonical_name,
    bnRoot: result.bn_root ?? null,
    datasets: mapDatasets(result.dataset_sources),
    aliasCount: result.alias_count ?? 0,
    linkCount: result.link_count ?? 0,
  }));
}

export function mapHeaderSummary(
  entityResponse: EntityResponseApi,
  relatedResponse: RelatedResponseApi,
): HeaderSummary {
  const aliasCount =
    entityResponse.golden?.aliases?.length ??
    entityResponse.entity.alternate_names?.length ??
    0;

  const relatedIds = new Set<number>();
  for (const item of relatedResponse.candidates) relatedIds.add(item.other_id);
  for (const item of relatedResponse.splink) relatedIds.add(item.other_id);

  return {
    id: entityResponse.entity.id,
    canonicalName: entityResponse.golden?.canonical_name ?? entityResponse.entity.canonical_name,
    bnRoot: entityResponse.entity.bn_root ?? null,
    aliasCount,
    datasets: mapDatasets(
      entityResponse.golden?.dataset_sources ?? entityResponse.entity.dataset_sources,
    ),
    relatedCount: relatedIds.size,
    linkCount:
      entityResponse.entity.source_count ??
      entityResponse.links.reduce((total, link) => total + toNumber(link.c), 0),
  };
}

export function mapFundingSeries(response: FundingByYearResponseApi): {
  external: ExternalFundingPoint[];
  cra: CraFundingPoint[];
} {
  return {
    external: (response.external_fiscal_years ?? []).map((row) => ({
      fiscalYear: row.fy,
      fedGrants: toNumber(row.fed_grants),
      abGrants: toNumber(row.ab_grants),
      abContracts: toNumber(row.ab_contracts),
      abSoleSource: toNumber(row.ab_sole_source),
    })),
    cra: (response.cra_calendar_years ?? []).map((row) => ({
      year: row.year,
      revenue: toNumber(row.cra_revenue),
      expenditures: toNumber(row.cra_expenditures),
      giftsIn: toNumber(row.cra_gifts_in),
      giftsOut: toNumber(row.cra_gifts_out),
    })),
  };
}

function severityForCount(count: number, mediumThreshold: number, highThreshold: number): SignalSeverity {
  if (count >= highThreshold) return 'high';
  if (count >= mediumThreshold) return 'medium';
  if (count > 0) return 'low';
  return 'info';
}

export function mapSignalCards(
  accountability: AccountabilityResponseApi,
  related: RelatedResponseApi,
): SignalCard[] {
  const cards: SignalCard[] = [];
  const latestGovFunding = accountability.govt_funding?.[0];
  if (latestGovFunding) {
    const share = toNumber(latestGovFunding.govt_share_of_rev);
    cards.push({
      id: 'government-funding',
      title: 'Government Funding Dependence',
      severity: share >= 0.6 ? 'high' : share >= 0.3 ? 'medium' : share > 0 ? 'low' : 'info',
      reason:
        share > 0
          ? `${Math.round(share * 100)}% of recent revenue came from government sources.`
          : 'No recent government funding dependence signal was found.',
      metrics: [
        `Latest year: ${latestGovFunding.fiscal_year ?? 'n/a'}`,
        `Total government funding: ${formatCurrency(toNumber(latestGovFunding.total_govt))}`,
      ],
    });
  }

  const totalLoops = toNumber(accountability.loop_universe?.total_loops);
  cards.push({
    id: 'loop-participation',
    title: 'Funding Loop Participation',
    severity: severityForCount(totalLoops, 1, 5),
    reason:
      totalLoops > 0
        ? `This entity appears in ${totalLoops} detected circular funding loop(s).`
        : 'No circular funding loop participation was surfaced.',
    metrics: [
      `2-hop loops: ${toNumber(accountability.loop_universe?.loops_2hop)}`,
      `3-hop loops: ${toNumber(accountability.loop_universe?.loops_3hop)}`,
    ],
  });

  const hasHub = Boolean(accountability.hub?.hub_type);
  const totalDegree = toNumber(accountability.hub?.total_degree);
  cards.push({
    id: 'network-presence',
    title: 'Hub / Network Presence',
    severity: hasHub ? (totalDegree >= 20 ? 'high' : 'medium') : 'info',
    reason: hasHub
      ? `${accountability.hub?.hub_type} hub classification suggests notable network centrality.`
      : 'No hub classification was surfaced for this entity.',
    metrics: [
      `Total degree: ${totalDegree}`,
      `Total inflow: ${formatCurrency(toNumber(accountability.hub?.total_inflow))}`,
    ],
  });

  const latestOverhead = accountability.overhead?.[0];
  if (latestOverhead) {
    const strictOverhead = toNumber(latestOverhead.strict_overhead_pct);
    cards.push({
      id: 'overhead-outlier',
      title: 'Overhead Outlier',
      severity: toBoolean(latestOverhead.outlier_flag)
        ? 'high'
        : strictOverhead >= 35
          ? 'medium'
          : strictOverhead > 0
            ? 'low'
            : 'info',
      reason: toBoolean(latestOverhead.outlier_flag)
        ? 'The backend flagged this entity as an overhead outlier.'
        : strictOverhead > 0
          ? `Strict overhead is ${strictOverhead.toFixed(1)}% in the latest year.`
          : 'No recent overhead outlier signal was surfaced.',
      metrics: [
        `Latest year: ${latestOverhead.fiscal_year ?? 'n/a'}`,
        `Broad overhead: ${toNumber(latestOverhead.broad_overhead_pct).toFixed(1)}%`,
      ],
    });
  }

  const violationCount =
    (accountability.violations?.sanity?.length ?? 0) +
    (accountability.violations?.arithmetic?.length ?? 0) +
    (accountability.violations?.impossibility?.length ?? 0);
  cards.push({
    id: 'data-quality',
    title: 'Data Quality Issues',
    severity: severityForCount(violationCount, 1, 5),
    reason:
      violationCount > 0
        ? `${violationCount} recent data-quality issue(s) were surfaced across sanity and arithmetic checks.`
        : 'No recent data-quality violations were surfaced.',
    metrics: [
      `Sanity: ${accountability.violations?.sanity?.length ?? 0}`,
      `Arithmetic/impossibility: ${(accountability.violations?.arithmetic?.length ?? 0) + (accountability.violations?.impossibility?.length ?? 0)}`,
    ],
  });

  const relatedCount = new Set([
    ...related.candidates.map((item) => item.other_id),
    ...related.splink.map((item) => item.other_id),
  ]).size;
  cards.push({
    id: 'related-entities',
    title: 'Related Entity Complexity',
    severity: severityForCount(relatedCount, 2, 6),
    reason:
      relatedCount > 0
        ? `${relatedCount} direct related or candidate entities were surfaced for review.`
        : 'No direct related entities were surfaced.',
    metrics: [
      `Candidate links: ${related.candidates.length}`,
      `Splink suggestions: ${related.splink.length}`,
    ],
  });

  return cards;
}

export function mapGraph(
  entityResponse: EntityResponseApi,
  relatedResponse: RelatedResponseApi,
): { nodes: GraphNodeData[]; edges: GraphEdgeData[] } {
  const centerNode: GraphNodeData = {
    id: `entity-${entityResponse.entity.id}`,
    entityId: entityResponse.entity.id,
    label: entityResponse.golden?.canonical_name ?? entityResponse.entity.canonical_name,
    bnRoot: entityResponse.entity.bn_root ?? null,
    datasets: mapDatasets(
      entityResponse.golden?.dataset_sources ?? entityResponse.entity.dataset_sources,
    ),
    relation: 'center',
    meta: [`${entityResponse.entity.source_count ?? entityResponse.links.length} linked source groups`],
  };

  const nodeMap = new Map<string, GraphNodeData>([[centerNode.id, centerNode]]);
  const edges: GraphEdgeData[] = [];

  for (const candidate of relatedResponse.candidates) {
    const id = `entity-${candidate.other_id}`;
    const existing = nodeMap.get(id);
    const relation: GraphNodeData['relation'] =
      candidate.status === 'related' ? 'related' : 'candidate';
    const nextNode: GraphNodeData = {
      id,
      entityId: candidate.other_id,
      label: candidate.other_name ?? `Entity ${candidate.other_id}`,
      bnRoot: candidate.other_bn ?? null,
      datasets: mapDatasets(candidate.other_ds),
      relation,
      meta: [
        candidate.candidate_method ? `Method: ${candidate.candidate_method}` : 'Candidate entity',
        candidate.other_link_count ? `${candidate.other_link_count} linked sources` : 'Linked source count unavailable',
      ],
    };
    nodeMap.set(id, existing && existing.relation === 'related' ? existing : nextNode);
    edges.push({
      id: `edge-center-${candidate.other_id}`,
      source: centerNode.id,
      target: id,
      label: relation === 'related' ? 'Related' : 'Candidate',
      relation,
    });
  }

  for (const splink of relatedResponse.splink) {
    const id = `entity-${splink.other_id}`;
    if (!nodeMap.has(id)) {
      nodeMap.set(id, {
        id,
        entityId: splink.other_id,
        label: splink.other_name ?? `Entity ${splink.other_id}`,
        bnRoot: splink.other_bn ?? null,
        datasets: mapDatasets(splink.other_ds),
        relation: 'splink',
        meta: [splink.prob ? `Splink probability ${(splink.prob * 100).toFixed(0)}%` : 'Splink suggestion'],
      });
    }

    if (!edges.some((edge) => edge.target === id)) {
      edges.push({
        id: `edge-splink-${splink.other_id}`,
        source: centerNode.id,
        target: id,
        label: 'Splink',
        relation: 'splink',
      });
    }
  }

  return {
    nodes: [...nodeMap.values()],
    edges,
  };
}

export function mapEvidenceSections(
  entityResponse: EntityResponseApi,
  fundingResponse: FundingByYearResponseApi,
  accountabilityResponse: AccountabilityResponseApi,
  relatedResponse: RelatedResponseApi,
): EvidenceSection[] {
  const fundingItems = [
    ...fundingResponse.external_fiscal_years.flatMap((row) => [
      row.fed_grants
        ? {
            label: 'Federal grants',
            yearOrPeriod: row.fy,
            sourceDataset: 'FED',
            amount: formatCurrency(toNumber(row.fed_grants)),
            note: 'External public funding',
            sourceRef: '/api/entity/:id/funding-by-year',
          }
        : null,
      row.ab_grants
        ? {
            label: 'Alberta grants',
            yearOrPeriod: row.fy,
            sourceDataset: 'AB',
            amount: formatCurrency(toNumber(row.ab_grants)),
            note: 'External public funding',
            sourceRef: '/api/entity/:id/funding-by-year',
          }
        : null,
      row.ab_contracts
        ? {
            label: 'Alberta contracts',
            yearOrPeriod: row.fy,
            sourceDataset: 'AB',
            amount: formatCurrency(toNumber(row.ab_contracts)),
            note: 'Procurement contract value',
            sourceRef: '/api/entity/:id/funding-by-year',
          }
        : null,
      row.ab_sole_source
        ? {
            label: 'Alberta sole source',
            yearOrPeriod: row.fy,
            sourceDataset: 'AB',
            amount: formatCurrency(toNumber(row.ab_sole_source)),
            note: 'Sole-source procurement value',
            sourceRef: '/api/entity/:id/funding-by-year',
          }
        : null,
    ]),
    ...fundingResponse.cra_calendar_years.flatMap((row) => [
      {
        label: 'CRA revenue',
        yearOrPeriod: String(row.year),
        sourceDataset: 'CRA',
        amount: formatCurrency(toNumber(row.cra_revenue)),
        note: 'Self-reported annual revenue',
        sourceRef: '/api/entity/:id/funding-by-year',
      },
      {
        label: 'CRA expenditures',
        yearOrPeriod: String(row.year),
        sourceDataset: 'CRA',
        amount: formatCurrency(toNumber(row.cra_expenditures)),
        note: 'Self-reported annual expenditures',
        sourceRef: '/api/entity/:id/funding-by-year',
      },
    ]),
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));

  const accountabilityItems = [
    accountabilityResponse.loop_universe?.total_loops
      ? {
          label: 'Loop participation',
          yearOrPeriod: 'Current view',
          sourceDataset: 'CRA',
          note: `${toNumber(accountabilityResponse.loop_universe.total_loops)} detected loop(s).`,
          sourceRef: '/api/entity/:id/accountability',
        }
      : null,
    accountabilityResponse.hub?.hub_type
      ? {
          label: 'Hub classification',
          yearOrPeriod: 'Current view',
          sourceDataset: 'CRA',
          note: `${accountabilityResponse.hub.hub_type} hub with degree ${toNumber(accountabilityResponse.hub.total_degree)}.`,
          sourceRef: '/api/entity/:id/accountability',
        }
      : null,
    ...(accountabilityResponse.violations?.sanity ?? []).slice(0, 3).map((item) => ({
      label: item.rule_code ?? 'Sanity issue',
      yearOrPeriod: item.fiscal_year ? String(item.fiscal_year) : 'Unknown period',
      sourceDataset: 'CRA',
      note: item.details ?? 'Sanity violation surfaced by backend.',
      sourceRef: '/api/entity/:id/accountability',
    })),
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));

  const relatedItems = [
    ...relatedResponse.candidates.slice(0, 5).map((item) => ({
      label: item.other_name ?? `Entity ${item.other_id}`,
      yearOrPeriod: item.status ?? 'Candidate',
      sourceDataset: 'GENERAL',
      note: item.llm_reasoning ?? item.candidate_method ?? 'Related entity candidate',
      sourceRef: '/api/entity/:id/related',
    })),
    ...relatedResponse.splink.slice(0, 3).map((item) => ({
      label: item.other_name ?? `Entity ${item.other_id}`,
      yearOrPeriod: 'Splink',
      sourceDataset: 'GENERAL',
      note: item.prob ? `Probability ${(item.prob * 100).toFixed(0)}%` : 'Splink surfaced entity',
      sourceRef: '/api/entity/:id/related',
    })),
  ];

  return [
    {
      id: 'funding',
      title: 'Funding Evidence',
      items: fundingItems,
    },
    {
      id: 'accountability',
      title: 'Network / Accountability Evidence',
      items: accountabilityItems,
    },
    {
      id: 'related',
      title: 'Related Entity Evidence',
      items: relatedItems,
    },
    {
      id: 'sources',
      title: 'Source Coverage',
      items: entityResponse.links.map((link) => ({
        label: `${link.source_schema}.${link.source_table}`,
        yearOrPeriod: `${toNumber(link.c)} linked records`,
        sourceDataset: link.source_schema.toUpperCase(),
        note: `${link.names?.slice(0, 2).join(', ') ?? 'Source names not available'}${(link.names?.length ?? 0) > 2 ? '…' : ''}`,
        sourceRef: '/api/entity/:id',
        sourceSchema: link.source_schema,
        sourceTable: link.source_table,
      })),
    },
  ].filter((section) => section.items.length > 0);
}

function mapCrossDatasetContext(context: CrossDatasetContextApi): CrossDatasetContextModel {
  return {
    resolvedEntityId: context.resolved_entity_id ?? null,
    resolvedEntityName: context.resolved_entity_name ?? null,
    resolvedBnRoot: context.resolved_bn_root ?? null,
    datasetSources: context.dataset_sources ?? [],
    totalAllFunding: toNumber(context.total_all_funding),
    fedTotalGrants: toNumber(context.fed_total_grants),
    abTotalGrants: toNumber(context.ab_total_grants),
    abTotalContracts: toNumber(context.ab_total_contracts),
    abTotalSoleSource: toNumber(context.ab_total_sole_source),
    craTotalRevenue: toNumber(context.cra_total_revenue),
    abNonProfitStatus: context.ab_non_profit_status ?? null,
    abNonProfitStatusDescription: context.ab_non_profit_status_description ?? null,
    abNonProfitRegistrationDate: context.ab_non_profit_registration_date ?? null,
  };
}

function mapRecipientRiskRow(summary: RecipientRiskSummaryApi): RecipientRiskRow {
  return {
    recipientKey: summary.recipient_key,
    name: summary.name,
    bn: summary.bn ?? null,
    recipientType: summary.recipient_type ?? null,
    recipientTypeName: summary.recipient_type_name ?? null,
    province: summary.province ?? null,
    city: summary.city ?? null,
    grantCount: toNumber(summary.grant_count),
    totalValue: toNumber(summary.total_value),
    avgValue: toNumber(summary.avg_value),
    maxValue: toNumber(summary.max_value),
    firstGrant: summary.first_grant ?? null,
    lastGrant: summary.last_grant ?? null,
    lastYear: summary.last_year ?? null,
    deptCount: toNumber(summary.dept_count),
    departments: summary.departments ?? [],
    programs: summary.programs ?? [],
    amendmentCount: toNumber(summary.amendment_count),
    yearsSinceLastSeen: toNumber(summary.years_since_last_seen),
    signalType: summary.signal_type,
    matchedSignals: summary.matched_signals ?? [],
    challengeScore: toNumber(summary.challenge_score),
    confidenceLevel: summary.confidence_level ?? null,
    confidenceNote: summary.confidence_note ?? null,
    matchMethod: summary.match_method ?? null,
    whyFlagged: summary.why_flagged ?? [],
    caveats: summary.caveats ?? [],
    sourceTables: summary.source_tables ?? null,
    sourceLinks: summary.source_links ?? [],
  };
}

function mapTimelinePoints(rows: RecipientRiskTimelinePointApi[]): RecipientRiskTimelinePoint[] {
  return (rows ?? []).map((row) => ({
    year: toNumber(row.year),
    grantCount: toNumber(row.grant_count),
    totalValue: toNumber(row.total_value),
    amendmentCount: toNumber(row.amendment_count),
    deptCount: toNumber(row.dept_count),
  }));
}

function mapHistoryRows(rows: RecipientRiskHistoryRowApi[]): RecipientRiskHistoryRow[] {
  return (rows ?? []).map((row) => ({
    label: row.label,
    grantCount: toNumber(row.grant_count),
    totalValue: toNumber(row.total_value),
    lastYear: row.last_year ?? null,
  }));
}

function mapEvidenceCards(rows: RecipientRiskEvidenceApi[]): RecipientRiskEvidenceCard[] {
  return (rows ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    tone: row.tone,
    body: row.body,
  }));
}

export function recipientRiskSignalLabel(signalType: string): string {
  const labels: Record<string, string> = {
    zombie: 'Zombie',
    high_dependency: 'High dependency',
    disappeared_for_profit: 'Disappeared for-profit',
    registry_dissolution_signal: 'Registry dissolution signal',
    registry_inactive_signal: 'Registry inactive signal',
    post_inactive_funding: 'Post-status funding',
    funding_disappearance_review: 'Funding disappearance review',
    no_bn_funding_disappearance_review: 'No-BN disappearance review',
    no_bn: 'No BN',
    for_profit_no_bn: 'For-profit no BN',
    pass_through: 'Pass-through',
    multi_department_for_profit: 'Multi-department for-profit',
  };
  return labels[signalType] ?? signalType.replace(/_/g, ' ');
}

export function mapZombies(response: ZombiesResponseApi): RecipientRiskRow[] {
  return (response.results ?? []).map(mapRecipientRiskRow);
}

export function mapGhostCapacity(response: GhostCapacityResponseApi): RecipientRiskRow[] {
  return (response.results ?? []).map(mapRecipientRiskRow);
}

export function mapZombieDetail(response: ZombieDetailResponseApi): ZombieDetailModel {
  return {
    summary: mapRecipientRiskRow(response.summary),
    timeline: mapTimelinePoints(response.timeline),
    departmentHistory: mapHistoryRows(response.department_history),
    programHistory: mapHistoryRows(response.program_history),
    evidence: mapEvidenceCards(response.evidence),
    crossDatasetContext: mapCrossDatasetContext(response.cross_dataset_context),
  };
}

export function mapGhostCapacityDetail(
  response: GhostCapacityDetailResponseApi,
): GhostCapacityDetailModel {
  return {
    summary: mapRecipientRiskRow(response.summary),
    timeline: mapTimelinePoints(response.timeline),
    departmentHistory: mapHistoryRows(response.department_history),
    programHistory: mapHistoryRows(response.program_history),
    identitySignals: {
      hasBusinessNumber: Boolean(response.identity_signals?.has_business_number),
      isForProfit: Boolean(response.identity_signals?.is_for_profit),
      departmentReach: toNumber(response.identity_signals?.department_reach),
      averageGrantValue: toNumber(response.identity_signals?.average_grant_value),
      resolvedEntityMatch: Boolean(response.identity_signals?.resolved_entity_match),
      albertaRegistryMatch: Boolean(response.identity_signals?.alberta_registry_match),
    },
    evidence: mapEvidenceCards(response.evidence),
    crossDatasetContext: mapCrossDatasetContext(response.cross_dataset_context),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Challenge 6 — Governance mappers
// ────────────────────────────────────────────────────────────────────────────

const LOOP_INTERPRETATION_LABELS: Record<string, string> = {
  review: 'Needs review',
  likely_normal_denominational_network: 'Likely normal - denominational network',
  likely_normal_foundation_operator: 'Likely normal - foundation / operator',
  likely_normal_federated_network: 'Likely normal - federated network',
};

export function loopInterpretationLabel(value: LoopInterpretation): string {
  return LOOP_INTERPRETATION_LABELS[value] ?? 'Needs review';
}

function mapLoopRow(row: {
  loop_id: number;
  hops: number;
  path_display: string;
  participant_count: number;
  participant_bns: string[] | null;
  participant_names: string[] | null;
  min_year: number | null;
  max_year: number | null;
  same_year: boolean | null;
  bottleneck_window: number | string | null;
  total_flow_window: number | string | null;
  bottleneck_allyears: number | string | null;
  total_flow_allyears: number | string | null;
  max_participant_cra_score: number | string | null;
  avg_participant_cra_score: number | string | null;
  top_flagged_participants: string[] | null;
  challenge3_sort_score: number | string | null;
  loop_interpretation: LoopInterpretation;
}): LoopListRow {
  return {
    loopId: row.loop_id,
    hops: row.hops,
    pathDisplay: row.path_display,
    participantCount: row.participant_count,
    participantBns: row.participant_bns ?? [],
    participantNames: row.participant_names ?? [],
    minYear: row.min_year,
    maxYear: row.max_year,
    sameYear: Boolean(row.same_year),
    bottleneckWindow: toNumber(row.bottleneck_window),
    totalFlowWindow: toNumber(row.total_flow_window),
    bottleneckAllYears: toNumber(row.bottleneck_allyears),
    totalFlowAllYears: toNumber(row.total_flow_allyears),
    maxParticipantCraScore: toNumber(row.max_participant_cra_score),
    avgParticipantCraScore: toNumber(row.avg_participant_cra_score),
    topFlaggedParticipants: row.top_flagged_participants ?? [],
    challenge3SortScore: toNumber(row.challenge3_sort_score),
    loopInterpretation: row.loop_interpretation,
    interpretationLabel: loopInterpretationLabel(row.loop_interpretation),
  };
}

export function mapLoops(response: LoopsResponseApi): LoopListRow[] {
  return response.loops.map(mapLoopRow);
}

function mapLoopParticipant(row: {
  bn: string;
  legal_name: string;
  position_in_loop: number;
  sends_to: string;
  sends_to_name: string | null;
  receives_from: string;
  receives_from_name: string | null;
  total_loops: number | string | null;
  max_bottleneck: number | string | null;
  total_circular_amt: number | string | null;
  cra_loop_score: number | string | null;
  revenue: number | string | null;
  program_spending: number | string | null;
  admin_spending: number | string | null;
  fundraising_spending: number | string | null;
  compensation_spending: number | string | null;
  entity_id?: number | null;
}): LoopParticipantRow {
  return {
    bn: row.bn,
    legalName: row.legal_name,
    positionInLoop: row.position_in_loop,
    sendsTo: row.sends_to,
    sendsToName: row.sends_to_name,
    receivesFrom: row.receives_from,
    receivesFromName: row.receives_from_name,
    totalLoops: toNumber(row.total_loops),
    maxBottleneck: toNumber(row.max_bottleneck),
    totalCircularAmount: toNumber(row.total_circular_amt),
    craLoopScore: toNumber(row.cra_loop_score),
    revenue: toNumber(row.revenue),
    programSpending: toNumber(row.program_spending),
    adminSpending: toNumber(row.admin_spending),
    fundraisingSpending: toNumber(row.fundraising_spending),
    compensationSpending: toNumber(row.compensation_spending),
    entityId: row.entity_id ?? null,
  };
}

export function mapLoopDetail(response: LoopDetailResponseApi): LoopDetailModel | null {
  if (!response.summary) return null;

  return {
    summary: mapLoopRow(response.summary),
    participants: response.participants.map(mapLoopParticipant),
    edges: response.edges.map((edge) => ({
      hopIdx: edge.hop_idx,
      src: edge.src,
      dst: edge.dst,
      yearFlow: toNumber(edge.year_flow),
      giftCount: toNumber(edge.gift_count),
    })),
    graph: response.graph,
    evidence: response.evidence ?? [],
  };
}

const INTERPRETATION_LABELS: Record<string, string> = {
  review: 'Needs review',
  likely_normal_university_affiliate: 'Likely normal · university affiliate',
  likely_normal_foundation_operator: 'Likely normal · foundation / operator',
  likely_normal_denominational_network: 'Likely normal · denominational network',
};

export function interpretationLabel(value: GovernanceInterpretation): string {
  return INTERPRETATION_LABELS[value] ?? 'Needs review';
}

function buildWhyFlagged(pair: GovernancePairApi, combinedFunding: number): string[] {
  const reasons: string[] = [];
  if (pair.shared_person_count >= 5) {
    reasons.push(`${pair.shared_person_count} shared people across both entities`);
  } else if (pair.shared_person_count >= 2) {
    reasons.push(`${pair.shared_person_count} shared people (low-to-moderate overlap)`);
  }

  if (pair.overlap_first_year && pair.overlap_last_year) {
    const span = (pair.overlap_last_year - pair.overlap_first_year) + 1;
    reasons.push(`Overlapping years ${pair.overlap_first_year}–${pair.overlap_last_year} (${span} year${span === 1 ? '' : 's'})`);
  }

  if (combinedFunding >= 100_000_000) {
    reasons.push(`Combined public funding ≥ ${formatCurrency(combinedFunding)}`);
  } else if (combinedFunding >= 10_000_000) {
    reasons.push(`Combined public funding ~${formatCurrency(combinedFunding)}`);
  } else if (combinedFunding > 0) {
    reasons.push(`Combined public funding ${formatCurrency(combinedFunding)}`);
  }

  if (pair.any_non_arms_length_signal) {
    reasons.push('At least one side has a non-arms-length director signal');
  }

  if (pair.network_interpretation && pair.network_interpretation !== 'review') {
    reasons.push(`Context: ${interpretationLabel(pair.network_interpretation)}`);
  }

  return reasons;
}

export function mapGovernancePair(pair: GovernancePairApi): GovernancePairRow {
  const entityAFunding = toNumber(pair.entity_a_total_public_funding);
  const entityBFunding = toNumber(pair.entity_b_total_public_funding);
  const combined = entityAFunding + entityBFunding;

  return {
    pairId: `${pair.entity_a_id}-${pair.entity_b_id}`,
    entityA: {
      id: pair.entity_a_id,
      name: pair.entity_a_name,
      bnRoot: pair.entity_a_bn_root,
      type: pair.entity_a_type,
      datasets: mapDatasets(pair.entity_a_datasets),
    },
    entityB: {
      id: pair.entity_b_id,
      name: pair.entity_b_name,
      bnRoot: pair.entity_b_bn_root,
      type: pair.entity_b_type,
      datasets: mapDatasets(pair.entity_b_datasets),
    },
    sharedPersonCount: pair.shared_person_count,
    sharedPeople: pair.shared_people ?? [],
    overlapFirstYear: pair.overlap_first_year,
    overlapLastYear: pair.overlap_last_year,
    overlappingYearCount:
      pair.overlapping_year_count ??
      (pair.overlap_first_year && pair.overlap_last_year
        ? pair.overlap_last_year - pair.overlap_first_year + 1
        : 0),
    anyNonArmsLengthSignal: Boolean(pair.any_non_arms_length_signal),
    combinedPublicFunding: combined,
    entityATotalPublicFunding: entityAFunding,
    entityBTotalPublicFunding: entityBFunding,
    challenge6Score: pair.challenge6_score,
    networkInterpretation: pair.network_interpretation,
    interpretationLabel: interpretationLabel(pair.network_interpretation),
    whyFlagged: buildWhyFlagged(pair, combined),
  };
}

export function mapGovernancePairs(response: GovernancePairsResponseApi): GovernancePairRow[] {
  return response.pairs.map(mapGovernancePair);
}

export function mapPersonSearchResults(response: PersonSearchResponseApi): PersonSearchRow[] {
  return response.results.map((row) => ({
    personNameDisplay: row.person_name_display,
    personNameNorm: row.person_name_norm,
    linkedEntityCount: row.linked_entity_count,
    linkedPublicFunding: toNumber(row.linked_public_funding),
    firstYearSeen: row.first_year_seen,
    lastYearSeen: row.last_year_seen,
    everNonArmsLength: Boolean(row.ever_non_arms_length),
    linkedEntitiesPreview: row.linked_entities_preview ?? [],
  }));
}

export function mapPersonProfile(response: PersonProfileResponseApi): PersonProfileModel {
  return {
    personNameNorm: response.person_name_norm,
    personNameDisplay: response.person_name_display,
    positions: response.positions ?? [],
    firstYearSeen: response.first_year_seen,
    lastYearSeen: response.last_year_seen,
    activeYearCount: response.active_year_count ?? 0,
    everNonArmsLength: Boolean(response.ever_non_arms_length),
    linkedEntityCount: response.linked_entity_count,
    linkedPublicFunding: toNumber(response.linked_public_funding),
    entities: response.entities,
  };
}

export function mapEntityGovernancePeople(response: EntityGovernanceResponseApi): EntityGovernancePersonRow[] {
  return response.people.map((row) => ({
    personNameNorm: row.person_name_norm,
    personNameDisplay: row.person_name_display,
    positions: row.positions ?? [],
    firstYearSeen: row.first_year_seen,
    lastYearSeen: row.last_year_seen,
    activeYearCount: row.active_year_count ?? 0,
    everNonArmsLength: Boolean(row.ever_non_arms_length),
    otherLinkedEntityCount: row.other_linked_entity_count,
  }));
}

export function formatCurrencyAmount(amount: number): string {
  return formatCurrency(amount);
}
