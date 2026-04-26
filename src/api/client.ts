import type {
  AccountabilityResponseApi,
  AdverseMediaResponse,
  AmendmentCreepDetailResponse,
  AmendmentCreepFilters,
  AmendmentCreepResponse,
  ChallengeComparisonReport,
  ChallengeReviewResponse,
  ContractIntelligenceFilters,
  ContractIntelligenceResponse,
  EntityGovernanceResponseApi,
  EntityResponseApi,
  FundingByYearResponseApi,
  GhostCapacityDetailResponseApi,
  GhostCapacityFilters,
  GhostCapacityResponseApi,
  GovernanceGraphResponseApi,
  GovernancePairsFilter,
  GovernancePairsResponseApi,
  LoopDetailResponseApi,
  LoopFilters,
  LoopsResponseApi,
  PersonProfileResponseApi,
  PersonSearchResponseApi,
  RelatedResponseApi,
  SearchResponseApi,
  VendorConcentrationFilters,
  VendorConcentrationResponse,
  ZombieDetailResponseApi,
  ZombieFilters,
  ZombiesResponseApi,
} from './types';

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // ignore JSON parse failure
    }
    throw new Error(message);
  }

  return response.json() as Promise<T>;
}

export const queryKeys = {
  search: (query: string) => ['search', query] as const,
  entity: (id: number) => ['entity', id] as const,
  funding: (id: number) => ['funding', id] as const,
  accountability: (id: number) => ['accountability', id] as const,
  related: (id: number) => ['related', id] as const,
  detailedLinks: (id: number) => ['detailed-links', id] as const,
  zombies: (filters: ZombieFilters) => ['risk', 'zombies', filters] as const,
  zombieDetail: (recipientKey: string) => ['risk', 'zombies', recipientKey] as const,
  ghostCapacity: (filters: GhostCapacityFilters) => ['risk', 'ghost-capacity', filters] as const,
  ghostCapacityDetail: (recipientKey: string) => ['risk', 'ghost-capacity', recipientKey] as const,
  governancePairs: (filters: GovernancePairsFilter) => ['governance', 'pairs', filters] as const,
  governancePairGraph: (a: number, b: number) => ['governance', 'pair-graph', a, b] as const,
  governancePeopleSearch: (query: string) => ['governance', 'people', 'search', query] as const,
  governancePersonProfile: (personNorm: string) => ['governance', 'person', personNorm] as const,
  governanceEntityPeople: (id: number) => ['governance', 'entity', id, 'people'] as const,
  loops: (filters: LoopFilters) => ['loops', filters] as const,
  loopDetail: (loopId: number) => ['loops', 'detail', loopId] as const,
  adverseMedia: (query: string) => ['adverse-media', query] as const,
  amendmentCreep: (filters: AmendmentCreepFilters) => ['amendment-creep', filters] as const,
  amendmentCreepDetail: (caseId: string) => ['amendment-creep', 'detail', caseId] as const,
  vendorConcentration: (filters: VendorConcentrationFilters) => ['vendor-concentration', filters] as const,
  contractIntelligence: (filters: ContractIntelligenceFilters) => ['contract-intelligence', filters] as const,
  challengeReview: () => ['challenge-review'] as const,
  challengeComparison: (challengeId: string) => ['challenge-review', 'compare', challengeId] as const,
};

export function searchEntities(query: string) {
  return getJson<SearchResponseApi>(`/api/search?q=${encodeURIComponent(query)}`);
}

export function fetchEntity(id: number) {
  return getJson<EntityResponseApi>(`/api/entity/${id}`);
}

export function fetchFundingByYear(id: number) {
  return getJson<FundingByYearResponseApi>(`/api/entity/${id}/funding-by-year`);
}

export function fetchAccountability(id: number) {
  return getJson<AccountabilityResponseApi>(`/api/entity/${id}/accountability`);
}

export function fetchRelated(id: number) {
  return getJson<RelatedResponseApi>(`/api/entity/${id}/related`);
}

function buildZombieQuery(filters: ZombieFilters): string {
  const params = new URLSearchParams();
  if (filters.limit != null) params.set('limit', String(filters.limit));
  if (filters.offset != null) params.set('offset', String(filters.offset));
  if (filters.minTotalValue != null) params.set('min_total_value', String(filters.minTotalValue));
  if (filters.lastSeenBeforeYear != null) {
    params.set('last_seen_before_year', String(filters.lastSeenBeforeYear));
  }
  if (filters.signalType) params.set('signal_type', filters.signalType);
  if (filters.recipientType) params.set('recipient_type', filters.recipientType);
  if (filters.province) params.set('province', filters.province);
  if (filters.requireEntityMatch != null) {
    params.set('require_entity_match', String(filters.requireEntityMatch));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

function buildGhostCapacityQuery(filters: GhostCapacityFilters): string {
  const params = new URLSearchParams();
  if (filters.limit != null) params.set('limit', String(filters.limit));
  if (filters.offset != null) params.set('offset', String(filters.offset));
  if (filters.minTotalValue != null) params.set('min_total_value', String(filters.minTotalValue));
  if (filters.maxGrantCount != null) params.set('max_grant_count', String(filters.maxGrantCount));
  if (filters.minAvgValue != null) params.set('min_avg_value', String(filters.minAvgValue));
  if (filters.minDeptCount != null) params.set('min_dept_count', String(filters.minDeptCount));
  if (filters.requireNoBn != null) params.set('require_no_bn', String(filters.requireNoBn));
  if (filters.signalType) params.set('signal_type', filters.signalType);
  if (filters.recipientType) params.set('recipient_type', filters.recipientType);
  if (filters.province) params.set('province', filters.province);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export function fetchZombies(filters: ZombieFilters = {}) {
  return getJson<ZombiesResponseApi>(`/api/zombies${buildZombieQuery(filters)}`);
}

export function fetchZombieDetail(recipientKey: string) {
  return getJson<ZombieDetailResponseApi>(`/api/zombies/${encodeURIComponent(recipientKey)}`);
}

export function fetchGhostCapacity(filters: GhostCapacityFilters = {}) {
  return getJson<GhostCapacityResponseApi>(
    `/api/ghost-capacity${buildGhostCapacityQuery(filters)}`,
  );
}

export function fetchGhostCapacityDetail(recipientKey: string) {
  return getJson<GhostCapacityDetailResponseApi>(
    `/api/ghost-capacity/${encodeURIComponent(recipientKey)}`,
  );
}

function buildLoopsQuery(filters: LoopFilters): string {
  const params = new URLSearchParams();
  if (filters.limit != null) params.set('limit', String(filters.limit));
  if (filters.offset != null) params.set('offset', String(filters.offset));
  if (filters.minHops != null) params.set('min_hops', String(filters.minHops));
  if (filters.sameYearOnly != null) params.set('same_year_only', String(filters.sameYearOnly));
  if (filters.minTotalFlow != null) params.set('min_total_flow', String(filters.minTotalFlow));
  if (filters.minBottleneck != null) params.set('min_bottleneck', String(filters.minBottleneck));
  if (filters.minCraScore != null) params.set('min_cra_score', String(filters.minCraScore));
  if (filters.interpretation) params.set('interpretation', filters.interpretation);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export function fetchLoops(filters: LoopFilters = {}) {
  return getJson<LoopsResponseApi>(`/api/loops${buildLoopsQuery(filters)}`);
}

export function fetchLoopDetail(loopId: number) {
  return getJson<LoopDetailResponseApi>(`/api/loops/${loopId}`);
}

function buildGovernancePairsQuery(filters: GovernancePairsFilter): string {
  const params = new URLSearchParams();
  if (filters.limit != null) params.set('limit', String(filters.limit));
  if (filters.offset != null) params.set('offset', String(filters.offset));
  if (filters.minShared != null) params.set('min_shared', String(filters.minShared));
  if (filters.minScore != null) params.set('min_score', String(filters.minScore));
  if (filters.minFunding != null) params.set('min_funding', String(filters.minFunding));
  if (filters.interpretation) params.set('interpretation', filters.interpretation);
  if (filters.entityType) params.set('entity_type', filters.entityType);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export function fetchGovernancePairs(filters: GovernancePairsFilter = {}) {
  return getJson<GovernancePairsResponseApi>(
    `/api/governance/pairs${buildGovernancePairsQuery(filters)}`,
  );
}

export function fetchGovernancePairGraph(entityA: number, entityB: number) {
  return getJson<GovernanceGraphResponseApi>(
    `/api/governance/pairs/${entityA}/${entityB}/graph`,
  );
}

export function fetchDetailedLinks(entityId: number) {
  return getJson<Record<string, any[]>>(`/api/entity/${entityId}/links/detailed`);
}

export function searchGovernancePeople(query: string, limit = 30) {
  return getJson<PersonSearchResponseApi>(
    `/api/governance/people/search?q=${encodeURIComponent(query)}&limit=${limit}`,
  );
}

export function fetchGovernancePersonProfile(personNorm: string) {
  return getJson<PersonProfileResponseApi>(
    `/api/governance/people/${encodeURIComponent(personNorm)}`,
  );
}

export function fetchGovernanceEntityPeople(entityId: number) {
  return getJson<EntityGovernanceResponseApi>(
    `/api/governance/entity/${entityId}/people`,
  );
}

export function fetchAdverseMedia(query: string) {
  return getJson<AdverseMediaResponse>(`/api/adverse-media?q=${encodeURIComponent(query)}`);
}

function buildAmendmentCreepQuery(filters: AmendmentCreepFilters): string {
  const params = new URLSearchParams();
  if (filters.limit != null) params.set('limit', String(filters.limit));
  if (filters.offset != null) params.set('offset', String(filters.offset));
  if (filters.source) params.set('source', filters.source);
  if (filters.minScore != null) params.set('min_score', String(filters.minScore));
  if (filters.minCreepRatio != null) {
    params.set('min_creep_ratio', String(filters.minCreepRatio));
  }
  if (filters.department) params.set('department', filters.department);
  if (filters.vendor) params.set('vendor', filters.vendor);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export function fetchAmendmentCreep(filters: AmendmentCreepFilters = {}) {
  return getJson<AmendmentCreepResponse>(
    `/api/amendment-creep${buildAmendmentCreepQuery(filters)}`,
  );
}

export function fetchAmendmentCreepDetail(caseId: string) {
  return getJson<AmendmentCreepDetailResponse>(
    `/api/amendment-creep/${encodeURIComponent(caseId)}`,
  );
}

function buildVendorConcentrationQuery(filters: VendorConcentrationFilters): string {
  const params = new URLSearchParams();
  if (filters.limit != null) params.set('limit', String(filters.limit));
  if (filters.offset != null) params.set('offset', String(filters.offset));
  if (filters.source) params.set('source', filters.source);
  if (filters.minHhi != null) params.set('min_hhi', String(filters.minHhi));
  if (filters.minTotalDollars != null) {
    params.set('min_total_dollars', String(filters.minTotalDollars));
  }
  if (filters.department) params.set('department', filters.department);
  if (filters.category) params.set('category', filters.category);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export function fetchVendorConcentration(filters: VendorConcentrationFilters = {}) {
  return getJson<VendorConcentrationResponse>(
    `/api/vendor-concentration${buildVendorConcentrationQuery(filters)}`,
  );
}

function buildContractIntelligenceQuery(filters: ContractIntelligenceFilters): string {
  const params = new URLSearchParams();
  if (filters.limit != null) params.set('limit', String(filters.limit));
  if (filters.offset != null) params.set('offset', String(filters.offset));
  if (filters.department) params.set('department', filters.department);
  if (filters.category) params.set('category', filters.category);
  if (filters.growthDriver) params.set('growth_driver', filters.growthDriver);
  if (filters.minDelta != null) params.set('min_delta', String(filters.minDelta));
  if (filters.minHhi != null) params.set('min_hhi', String(filters.minHhi));
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export function fetchContractIntelligence(filters: ContractIntelligenceFilters = {}) {
  return getJson<ContractIntelligenceResponse>(
    `/api/contract-intelligence${buildContractIntelligenceQuery(filters)}`,
  );
}

export function fetchChallengeReview() {
  return getJson<ChallengeReviewResponse>('/api/challenge-review');
}

export function fetchChallengeComparison(challengeId: string) {
  return getJson<ChallengeComparisonReport>(
    `/api/challenge-review/compare/${encodeURIComponent(challengeId)}`,
  );
}
