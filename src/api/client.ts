import type {
  AccountabilityResponseApi,
  EntityGovernanceResponseApi,
  EntityResponseApi,
  FundingByYearResponseApi,
  GovernanceGraphResponseApi,
  GovernancePairsFilter,
  GovernancePairsResponseApi,
  PersonProfileResponseApi,
  PersonSearchResponseApi,
  RelatedResponseApi,
  SearchResponseApi,
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
  governancePairs: (filters: GovernancePairsFilter) => ['governance', 'pairs', filters] as const,
  governancePairGraph: (a: number, b: number) => ['governance', 'pair-graph', a, b] as const,
  governancePeopleSearch: (query: string) => ['governance', 'people', 'search', query] as const,
  governancePersonProfile: (personNorm: string) => ['governance', 'person', personNorm] as const,
  governanceEntityPeople: (id: number) => ['governance', 'entity', id, 'people'] as const,
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
