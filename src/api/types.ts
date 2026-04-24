export type DatasetTag = 'CRA' | 'FED' | 'AB';
export type SignalSeverity = 'high' | 'medium' | 'low' | 'info';
export type GraphRelation = 'center' | 'related' | 'candidate' | 'splink';

export interface SearchResultApi {
  id: number;
  canonical_name: string;
  bn_root: string | null;
  dataset_sources?: string[] | null;
  alias_count?: number | null;
  link_count?: number | null;
  score?: number | null;
}

export interface SearchResponseApi {
  results: SearchResultApi[];
  by?: 'bn' | 'name';
}

export interface EntityRecordApi {
  id: number;
  canonical_name: string;
  bn_root: string | null;
  alternate_names?: string[] | null;
  dataset_sources?: string[] | null;
  source_count?: number | null;
}

export interface GoldenRecordApi {
  id: number;
  canonical_name: string;
  aliases?: string[] | null;
  dataset_sources?: string[] | null;
}

export interface LinkSummaryApi {
  source_schema: string;
  source_table: string;
  c: number;
  names?: string[] | null;
}

export interface MergeHistoryApi {
  absorbed_id: number;
  merge_method: string | null;
  absorbed_name: string | null;
  absorbed_bn: string | null;
}

export interface EntityResponseApi {
  entity: EntityRecordApi;
  golden: GoldenRecordApi | null;
  links: LinkSummaryApi[];
  merge_history: MergeHistoryApi[];
}

export interface CraYearApi {
  year: number;
  cra_revenue: number;
  cra_expenditures: number;
  cra_gifts_in: number;
  cra_gifts_out: number;
}

export interface ExternalFundingYearApi {
  fy: string;
  fed_grants: number;
  ab_grants: number;
  ab_contracts: number;
  ab_sole_source: number;
}

export interface FundingByYearResponseApi {
  bn: string | null;
  cra_calendar_years: CraYearApi[];
  external_fiscal_years: ExternalFundingYearApi[];
}

export interface OverheadApi {
  fiscal_year: number;
  revenue: number | string | null;
  total_expenditures: number | string | null;
  strict_overhead_pct: number | string | null;
  broad_overhead_pct: number | string | null;
  outlier_flag: boolean | string | null;
}

export interface GovernmentFundingApi {
  fiscal_year: number;
  federal: number | string | null;
  provincial: number | string | null;
  municipal: number | string | null;
  total_govt: number | string | null;
  govt_share_of_rev: number | string | null;
}

export interface ViolationApi {
  fiscal_year?: number | null;
  rule_code?: string | null;
  severity?: string | number | null;
  details?: string | null;
}

export interface LoopUniverseApi {
  total_loops?: number | string | null;
  loops_2hop?: number | string | null;
  loops_3hop?: number | string | null;
  loops_4hop?: number | string | null;
  loops_5hop?: number | string | null;
  loops_6hop?: number | string | null;
}

export interface HubApi {
  hub_type?: string | null;
  total_degree?: number | string | null;
  total_inflow?: number | string | null;
  total_outflow?: number | string | null;
}

export interface NameHistoryApi {
  legal_name?: string | null;
  first_year?: number | null;
  last_year?: number | null;
}

export interface AccountabilityResponseApi {
  bn: string | null;
  overhead?: OverheadApi[];
  govt_funding?: GovernmentFundingApi[];
  violations?: {
    sanity?: ViolationApi[];
    arithmetic?: ViolationApi[];
    impossibility?: ViolationApi[];
  };
  loop_universe?: LoopUniverseApi | null;
  hub?: HubApi | null;
  name_history?: NameHistoryApi[];
}

export interface RelatedCandidateApi {
  other_id: number;
  candidate_method?: string | null;
  similarity_score?: number | null;
  status?: string | null;
  llm_verdict?: string | null;
  llm_confidence?: number | null;
  llm_reasoning?: string | null;
  other_name?: string | null;
  other_bn?: string | null;
  other_ds?: string[] | null;
  other_link_count?: number | null;
}

export interface SplinkRelatedApi {
  other_id: number;
  other_name?: string | null;
  other_bn?: string | null;
  other_ds?: string[] | null;
  prob?: number | null;
}

export interface RelatedResponseApi {
  candidates: RelatedCandidateApi[];
  splink: SplinkRelatedApi[];
}

export interface SearchResult {
  id: number;
  canonicalName: string;
  bnRoot: string | null;
  datasets: DatasetTag[];
  aliasCount: number;
  linkCount: number;
}

export interface HeaderSummary {
  id: number;
  canonicalName: string;
  bnRoot: string | null;
  aliasCount: number;
  datasets: DatasetTag[];
  relatedCount: number;
  linkCount: number;
}

export interface ExternalFundingPoint {
  fiscalYear: string;
  fedGrants: number;
  abGrants: number;
  abContracts: number;
  abSoleSource: number;
}

export interface CraFundingPoint {
  year: number;
  revenue: number;
  expenditures: number;
  giftsIn: number;
  giftsOut: number;
}

export interface SignalCard {
  id: string;
  title: string;
  severity: SignalSeverity;
  reason: string;
  metrics: string[];
}

export interface GraphNodeData {
  id: string;
  entityId: number;
  label: string;
  bnRoot: string | null;
  datasets: DatasetTag[];
  relation: GraphRelation;
  meta: string[];
}

export interface GraphEdgeData {
  id: string;
  source: string;
  target: string;
  label: string;
  relation: Exclude<GraphRelation, 'center'>;
}

export interface EvidenceItem {
  label: string;
  yearOrPeriod: string;
  sourceDataset: string;
  amount?: string;
  note: string;
  sourceRef: string;
}

export interface EvidenceSection {
  id: string;
  title: string;
  items: EvidenceItem[];
}
