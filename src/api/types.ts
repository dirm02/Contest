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
  // Metadata for foldouts
  sourceSchema?: string;
  sourceTable?: string;
}

export interface EvidenceSection {
  id: string;
  title: string;
  items: EvidenceItem[];
}

// ────────────────────────────────────────────────────────────────────────────
// Challenge 6 — Governance lens types
// ────────────────────────────────────────────────────────────────────────────

export type GovernanceInterpretation =
  | 'review'
  | 'likely_normal_university_affiliate'
  | 'likely_normal_foundation_operator'
  | 'likely_normal_denominational_network'
  | string;

export interface GovernancePairApi {
  entity_a_id: number;
  entity_a_name: string;
  entity_a_bn_root: string | null;
  entity_a_type: string | null;
  entity_a_datasets: string[] | null;
  entity_b_id: number;
  entity_b_name: string;
  entity_b_bn_root: string | null;
  entity_b_type: string | null;
  entity_b_datasets: string[] | null;

  shared_person_count: number;
  shared_people: string[];
  overlap_first_year: number | null;
  overlap_last_year: number | null;
  overlapping_year_count: number | null;
  any_non_arms_length_signal: boolean;

  entity_a_total_public_funding: number | string | null;
  entity_b_total_public_funding: number | string | null;
  entity_a_fed_total_grants: number | string | null;
  entity_b_fed_total_grants: number | string | null;
  entity_a_ab_total_grants: number | string | null;
  entity_b_ab_total_grants: number | string | null;
  entity_a_ab_total_contracts: number | string | null;
  entity_b_ab_total_contracts: number | string | null;
  entity_a_ab_total_sole_source: number | string | null;
  entity_b_ab_total_sole_source: number | string | null;

  challenge6_score: number;
  network_interpretation: GovernanceInterpretation;
}

export interface GovernancePairsResponseApi {
  filters: {
    limit: number;
    offset: number;
    min_shared: number;
    min_score: number;
    min_funding: number;
    interpretation: string | null;
    entity_type: string | null;
  };
  pairs: GovernancePairApi[];
}

export interface GovernancePairsFilter {
  limit?: number;
  offset?: number;
  minShared?: number;
  minScore?: number;
  minFunding?: number;
  interpretation?: string | null;
  entityType?: string | null;
}

export interface GovernanceGraphNodeApi {
  id: string;
  kind: 'entity' | 'person';
  label: string;
  entity_id?: number;
  bn_root?: string | null;
  dataset_sources?: string[] | null;
  total_public_funding?: number | string | null;
  person_name_norm?: string;
  overlap_first_year?: number | null;
  overlap_last_year?: number | null;
}

export interface GovernanceGraphEdgeApi {
  id: string;
  source: string;
  target: string;
  label: string;
}

export interface GovernanceGraphResponseApi {
  entity_a_id: number;
  entity_b_id: number;
  nodes: GovernanceGraphNodeApi[];
  edges: GovernanceGraphEdgeApi[];
  shared_person_count: number;
}

export interface PersonSearchResultApi {
  person_name_display: string;
  person_name_norm: string;
  linked_entity_count: number;
  linked_public_funding: number | string | null;
  first_year_seen: number | null;
  last_year_seen: number | null;
  ever_non_arms_length: boolean | null;
  linked_entities_preview: string[] | null;
}

export interface PersonSearchResponseApi {
  query: string;
  normalized: string;
  results: PersonSearchResultApi[];
}

export interface PersonLinkedEntityApi {
  entity_id: number;
  entity_name: string;
  bn_root: string | null;
  entity_type: string | null;
  dataset_sources: string[] | null;
  person_name_norm: string;
  person_name_display: string;
  positions: string[] | null;
  first_year_seen: number | null;
  last_year_seen: number | null;
  active_year_count: number | null;
  ever_non_arms_length: boolean | null;
  total_public_funding: number | string | null;
  fed_total_grants: number | string | null;
  ab_total_grants: number | string | null;
  ab_total_contracts: number | string | null;
  ab_total_sole_source: number | string | null;
  cra_total_revenue: number | string | null;
}

export interface PersonProfileResponseApi {
  person_name_norm: string;
  person_name_display: string;
  positions: string[] | null;
  first_year_seen: number | null;
  last_year_seen: number | null;
  active_year_count: number | null;
  ever_non_arms_length: boolean | null;
  linked_entity_count: number;
  linked_public_funding: number;
  entities: PersonLinkedEntityApi[];
}

export interface EntityGovernancePersonApi {
  person_name_norm: string;
  person_name_display: string;
  positions: string[] | null;
  first_year_seen: number | null;
  last_year_seen: number | null;
  active_year_count: number | null;
  ever_non_arms_length: boolean | null;
  other_linked_entity_count: number;
}

export interface EntityGovernanceResponseApi {
  entity: {
    id: number;
    canonical_name: string;
    bn_root: string | null;
  } | null;
  people: EntityGovernancePersonApi[];
}

// View models used by governance UI components.
export interface GovernancePairRow {
  pairId: string;
  entityA: { id: number; name: string; bnRoot: string | null; type: string | null; datasets: DatasetTag[] };
  entityB: { id: number; name: string; bnRoot: string | null; type: string | null; datasets: DatasetTag[] };
  sharedPersonCount: number;
  sharedPeople: string[];
  overlapFirstYear: number | null;
  overlapLastYear: number | null;
  overlappingYearCount: number;
  anyNonArmsLengthSignal: boolean;
  combinedPublicFunding: number;
  entityATotalPublicFunding: number;
  entityBTotalPublicFunding: number;
  challenge6Score: number;
  networkInterpretation: GovernanceInterpretation;
  interpretationLabel: string;
  whyFlagged: string[];
}

export interface GovernanceGraphModel {
  nodes: GovernanceGraphNodeApi[];
  edges: GovernanceGraphEdgeApi[];
  sharedPersonCount: number;
}

export interface PersonSearchRow {
  personNameDisplay: string;
  personNameNorm: string;
  linkedEntityCount: number;
  linkedPublicFunding: number;
  firstYearSeen: number | null;
  lastYearSeen: number | null;
  everNonArmsLength: boolean;
  linkedEntitiesPreview: string[];
}

export interface PersonProfileModel {
  personNameNorm: string;
  personNameDisplay: string;
  positions: string[];
  firstYearSeen: number | null;
  lastYearSeen: number | null;
  activeYearCount: number;
  everNonArmsLength: boolean;
  linkedEntityCount: number;
  linkedPublicFunding: number;
  entities: PersonLinkedEntityApi[];
}

export interface EntityGovernancePersonRow {
  personNameNorm: string;
  personNameDisplay: string;
  positions: string[];
  firstYearSeen: number | null;
  lastYearSeen: number | null;
  activeYearCount: number;
  everNonArmsLength: boolean;
  otherLinkedEntityCount: number;
}
