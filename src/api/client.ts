import type {
  AccountabilityResponseApi,
  EntityResponseApi,
  FundingByYearResponseApi,
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
