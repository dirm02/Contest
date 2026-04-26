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
// Challenge 1/2 — Zombie + Ghost recipient risk types
// ────────────────────────────────────────────────────────────────────────────

export type RecipientSignalTone = 'review' | 'context' | 'info' | string;

export interface ZombieFilters {
  limit?: number;
  offset?: number;
  minTotalValue?: number;
  lastSeenBeforeYear?: number;
  signalType?: string | null;
  recipientType?: string | null;
  province?: string | null;
  requireEntityMatch?: boolean;
}

export interface GhostCapacityFilters {
  limit?: number;
  offset?: number;
  minTotalValue?: number;
  maxGrantCount?: number;
  minAvgValue?: number;
  minDeptCount?: number;
  requireNoBn?: boolean;
  signalType?: string | null;
  recipientType?: string | null;
  province?: string | null;
}

export interface CrossDatasetContextApi {
  resolved_entity_id: number | null;
  resolved_entity_name: string | null;
  resolved_bn_root: string | null;
  dataset_sources: string[] | null;
  total_all_funding: number | string | null;
  fed_total_grants: number | string | null;
  ab_total_grants: number | string | null;
  ab_total_contracts: number | string | null;
  ab_total_sole_source: number | string | null;
  cra_total_revenue: number | string | null;
  ab_non_profit_status: string | null;
  ab_non_profit_status_description: string | null;
  ab_non_profit_registration_date: string | null;
}

export interface RecipientRiskSummaryApi {
  recipient_key: string;
  name: string;
  bn: string | null;
  recipient_type: string | null;
  recipient_type_name: string | null;
  province: string | null;
  city: string | null;
  grant_count: number;
  total_value: number | string;
  avg_value: number | string;
  max_value: number | string;
  first_grant: string | null;
  last_grant: string | null;
  last_year: number | null;
  dept_count: number;
  departments: string[];
  programs: string[];
  amendment_count: number;
  years_since_last_seen: number;
  signal_type: string;
  matched_signals: string[];
  challenge_score: number;
  why_flagged: string[];
  cross_dataset_context: CrossDatasetContextApi;
}

export interface ZombiesResponseApi {
  filters: {
    limit: number;
    offset: number;
    min_total_value: number;
    last_seen_before_year: number;
    signal_type: string | null;
    recipient_type: string | null;
    province: string | null;
    require_entity_match: boolean;
  };
  total: number;
  results: RecipientRiskSummaryApi[];
}

export interface GhostCapacityResponseApi {
  filters: {
    limit: number;
    offset: number;
    min_total_value: number;
    max_grant_count: number;
    min_avg_value: number;
    min_dept_count: number;
    require_no_bn: boolean;
    signal_type: string | null;
    recipient_type: string | null;
    province: string | null;
  };
  total: number;
  results: RecipientRiskSummaryApi[];
}

export interface RecipientRiskTimelinePointApi {
  year: number;
  grant_count: number;
  total_value: number | string;
  amendment_count: number;
  dept_count: number;
}

export interface RecipientRiskHistoryRowApi {
  label: string;
  grant_count: number;
  total_value: number | string;
  last_year: number | null;
}

export interface RecipientRiskEvidenceApi {
  id: string;
  title: string;
  tone: RecipientSignalTone;
  body: string;
}

export interface ZombieDetailResponseApi {
  summary: RecipientRiskSummaryApi;
  timeline: RecipientRiskTimelinePointApi[];
  department_history: RecipientRiskHistoryRowApi[];
  program_history: RecipientRiskHistoryRowApi[];
  evidence: RecipientRiskEvidenceApi[];
  cross_dataset_context: CrossDatasetContextApi;
  resolved_entity_id: number | null;
}

export interface GhostIdentitySignalsApi {
  has_business_number: boolean;
  is_for_profit: boolean;
  department_reach: number;
  average_grant_value: number | string;
  resolved_entity_match: boolean;
  alberta_registry_match: boolean;
}

export interface GhostCapacityDetailResponseApi {
  summary: RecipientRiskSummaryApi;
  timeline: RecipientRiskTimelinePointApi[];
  department_history: RecipientRiskHistoryRowApi[];
  program_history: RecipientRiskHistoryRowApi[];
  identity_signals: GhostIdentitySignalsApi;
  evidence: RecipientRiskEvidenceApi[];
  cross_dataset_context: CrossDatasetContextApi;
  resolved_entity_id: number | null;
}

export interface RecipientRiskRow {
  recipientKey: string;
  name: string;
  bn: string | null;
  recipientType: string | null;
  recipientTypeName: string | null;
  province: string | null;
  city: string | null;
  grantCount: number;
  totalValue: number;
  avgValue: number;
  maxValue: number;
  firstGrant: string | null;
  lastGrant: string | null;
  lastYear: number | null;
  deptCount: number;
  departments: string[];
  programs: string[];
  amendmentCount: number;
  yearsSinceLastSeen: number;
  signalType: string;
  matchedSignals: string[];
  challengeScore: number;
  whyFlagged: string[];
}

export interface RecipientRiskTimelinePoint {
  year: number;
  grantCount: number;
  totalValue: number;
  amendmentCount: number;
  deptCount: number;
}

export interface RecipientRiskHistoryRow {
  label: string;
  grantCount: number;
  totalValue: number;
  lastYear: number | null;
}

export interface RecipientRiskEvidenceCard {
  id: string;
  title: string;
  tone: RecipientSignalTone;
  body: string;
}

export interface CrossDatasetContextModel {
  resolvedEntityId: number | null;
  resolvedEntityName: string | null;
  resolvedBnRoot: string | null;
  datasetSources: string[];
  totalAllFunding: number;
  fedTotalGrants: number;
  abTotalGrants: number;
  abTotalContracts: number;
  abTotalSoleSource: number;
  craTotalRevenue: number;
  abNonProfitStatus: string | null;
  abNonProfitStatusDescription: string | null;
  abNonProfitRegistrationDate: string | null;
}

export interface ZombieDetailModel {
  summary: RecipientRiskRow;
  timeline: RecipientRiskTimelinePoint[];
  departmentHistory: RecipientRiskHistoryRow[];
  programHistory: RecipientRiskHistoryRow[];
  evidence: RecipientRiskEvidenceCard[];
  crossDatasetContext: CrossDatasetContextModel;
}

export interface GhostCapacityDetailModel {
  summary: RecipientRiskRow;
  timeline: RecipientRiskTimelinePoint[];
  departmentHistory: RecipientRiskHistoryRow[];
  programHistory: RecipientRiskHistoryRow[];
  identitySignals: {
    hasBusinessNumber: boolean;
    isForProfit: boolean;
    departmentReach: number;
    averageGrantValue: number;
    resolvedEntityMatch: boolean;
    albertaRegistryMatch: boolean;
  };
  evidence: RecipientRiskEvidenceCard[];
  crossDatasetContext: CrossDatasetContextModel;
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

export type LoopInterpretation =
  | 'review'
  | 'likely_normal_denominational_network'
  | 'likely_normal_foundation_operator'
  | 'likely_normal_federated_network'
  | string;

export interface LoopListRowApi {
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
}

export interface LoopsFiltersApi {
  limit: number;
  offset: number;
  min_hops: number;
  same_year_only: boolean;
  min_total_flow: number;
  min_bottleneck: number;
  min_cra_score: number;
  interpretation: string | null;
}

export interface LoopsResponseApi {
  filters: LoopsFiltersApi;
  total: number;
  loops: LoopListRowApi[];
}

export interface LoopFilters {
  limit?: number;
  offset?: number;
  minHops?: number;
  sameYearOnly?: boolean;
  minTotalFlow?: number;
  minBottleneck?: number;
  minCraScore?: number;
  interpretation?: string | null;
}

export interface LoopParticipantApi {
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
}

export interface LoopEdgeApi {
  hop_idx: number;
  src: string;
  dst: string;
  year_flow: number | string | null;
  gift_count: number | string | null;
}

export interface LoopGraphNodeApi {
  id: string;
  bn: string;
  label: string;
  position_in_loop: number;
  cra_loop_score: number;
  total_loops: number;
  total_circular_amt: number;
  entity_id: number | null;
}

export interface LoopGraphEdgeApi {
  id: string;
  hop_idx: number;
  source: string;
  target: string;
  label: string;
  year_flow: number;
  gift_count: number;
}

export interface LoopEvidenceApi {
  id: string;
  title: string;
  tone: 'review' | 'context' | 'info';
  body: string;
}

export interface LoopDetailResponseApi {
  summary: LoopListRowApi | null;
  participants: LoopParticipantApi[];
  edges: LoopEdgeApi[];
  graph: {
    nodes: LoopGraphNodeApi[];
    edges: LoopGraphEdgeApi[];
  };
  evidence: LoopEvidenceApi[];
}

export interface LoopListRow {
  loopId: number;
  hops: number;
  pathDisplay: string;
  participantCount: number;
  participantBns: string[];
  participantNames: string[];
  minYear: number | null;
  maxYear: number | null;
  sameYear: boolean;
  bottleneckWindow: number;
  totalFlowWindow: number;
  bottleneckAllYears: number;
  totalFlowAllYears: number;
  maxParticipantCraScore: number;
  avgParticipantCraScore: number;
  topFlaggedParticipants: string[];
  challenge3SortScore: number;
  loopInterpretation: LoopInterpretation;
  interpretationLabel: string;
}

export interface LoopParticipantRow {
  bn: string;
  legalName: string;
  positionInLoop: number;
  sendsTo: string;
  sendsToName: string | null;
  receivesFrom: string;
  receivesFromName: string | null;
  totalLoops: number;
  maxBottleneck: number;
  totalCircularAmount: number;
  craLoopScore: number;
  revenue: number;
  programSpending: number;
  adminSpending: number;
  fundraisingSpending: number;
  compensationSpending: number;
  entityId: number | null;
}

export interface LoopDetailModel {
  summary: LoopListRow;
  participants: LoopParticipantRow[];
  edges: Array<{
    hopIdx: number;
    src: string;
    dst: string;
    yearFlow: number;
    giftCount: number;
  }>;
  graph: {
    nodes: LoopGraphNodeApi[];
    edges: LoopGraphEdgeApi[];
  };
  evidence: LoopEvidenceApi[];
}

export interface AdverseMediaResult {
  company: string;
  headline: string;
  link: string;
  date: string;
  severityScore: number;
  thumbnail: string | null;
  sourceName: string;
  sourceProvider: string;
  matchedTerms: string[];
}

export interface AdverseMediaResponse {
  query: string;
  total: number;
  processing_ms: number;
  warnings: string[];
  results: AdverseMediaResult[];
}

export interface AmendmentCreepFilters {
  limit?: number;
  offset?: number;
  source?: 'fed' | 'ab' | null;
  minScore?: number;
  minCreepRatio?: number;
  department?: string | null;
  vendor?: string | null;
}

export interface AmendmentCreepCase {
  case_id: string;
  source: 'fed' | 'ab';
  case_type: string;
  vendor: string;
  department: string | null;
  reference_number: string;
  description: string | null;
  program: string | null;
  original_value: number;
  current_value: number;
  follow_on_value: number;
  creep_ratio: number;
  amendment_count: number;
  competitive_count: number;
  sole_source_count: number;
  record_count: number;
  first_date: string | null;
  last_date: string | null;
  latest_is_amendment?: boolean;
  near_threshold: boolean;
  has_nonstandard_justification: boolean;
  nonstandard_justification_count: number;
  risk_score: number;
  why_flagged: string[];
}

export interface AmendmentCreepResponse {
  filters: {
    limit: number;
    offset: number;
    source: 'fed' | 'ab' | null;
    min_score: number;
    min_creep_ratio: number;
    department: string | null;
    vendor: string | null;
  };
  total: number;
  summary: {
    total: number;
    high_risk_count: number;
    total_flagged_value: number;
    median_creep_ratio: number;
  };
  results: AmendmentCreepCase[];
}

export interface AmendmentCreepEvidence {
  id: string;
  title: string;
  tone: 'review' | 'context' | 'info';
  body: string;
}

export interface AmendmentCreepTimelinePoint {
  id: string;
  label: string;
  date: string | null;
  fiscal_year?: string | null;
  value: number;
  record_type: string;
}

export interface AmendmentCreepRecord {
  id: string;
  record_type: string;
  ref_number: string | null;
  amendment_number: string | null;
  date: string | null;
  agreement_start_date: string | null;
  value: number;
  department: string | null;
  vendor: string;
  description: string | null;
  program: string | null;
  justification_code: string | null;
}

export interface AmendmentCreepDetailResponse {
  summary: AmendmentCreepCase;
  evidence: AmendmentCreepEvidence[];
  timeline: AmendmentCreepTimelinePoint[];
  records: AmendmentCreepRecord[];
  scoring: {
    risk_score: number;
    why_flagged: string[];
    near_threshold: boolean;
    has_nonstandard_justification: boolean;
  };
}

export interface VendorConcentrationFilters {
  limit?: number;
  offset?: number;
  source?: 'federal' | 'alberta_sole_source' | null;
  minHhi?: number;
  minTotalDollars?: number;
  department?: string | null;
  category?: string | null;
}

export interface VendorConcentrationRow {
  source: 'federal' | 'alberta_sole_source';
  source_label: string;
  department: string;
  category_program_service: string;
  category_key: string;
  total_dollars: number;
  entity_count: number;
  top5_entities: string;
  hhi: number;
  cr4: number;
  top_share: number;
  effective_competitors: number;
  share_sum: number;
  distinct_raw_labels: number;
  data_quality_notes: string[];
  invariant_failed_cell_count: number;
  invariant_checked_cell_count: number;
}

export interface VendorConcentrationResponse {
  filters: {
    limit: number;
    offset: number;
    source: 'federal' | 'alberta_sole_source' | null;
    min_hhi: number;
    min_total_dollars: number;
    department: string | null;
    category: string | null;
  };
  total: number;
  summary: {
    total_cells: number;
    federal_cells: number;
    alberta_sole_source_cells: number;
    total_dollars: number;
    median_hhi: number;
    highest_hhi: number;
    invariant_failed_cell_count: number;
    invariant_checked_cell_count: number;
  };
  results: VendorConcentrationRow[];
}

export interface ContractIntelligenceFilters {
  limit?: number;
  offset?: number;
  department?: string | null;
  category?: string | null;
  growthDriver?: string | null;
  minDelta?: number;
  minHhi?: number;
}

export interface ContractIntelligenceRow {
  source_grade: string;
  source: string;
  department: string;
  category_label: string;
  spend_decomposition_metric: string;
  price_index_status: string;
  start_year: number;
  end_year: number;
  start_total_value: number;
  end_total_value: number;
  delta_total_value: number;
  start_contract_count: number;
  end_contract_count: number;
  delta_contract_count: number;
  start_avg_contract_value: number;
  end_avg_contract_value: number;
  avg_contract_value_change: number;
  volume_effect: number;
  value_effect: number;
  interaction_effect: number;
  value_effect_share_of_delta: number;
  start_amendment_value_total: number;
  end_amendment_value_total: number;
  delta_amendment_value: number;
  amendment_share_of_total_end: number;
  end_original_value_total: number;
  amendment_delta_share_of_spend_delta: number;
  solicitation_procedure_mix_end: string;
  end_avg_number_of_bids: number;
  number_of_bids_coverage_end: number;
  standing_offer_contract_share_end: number;
  solicitation_procedure_coverage_end: number;
  hhi: number;
  cr4: number;
  top_share: number;
  effective_competitors: number;
  share_sum: number;
  mega_contract_share_end: number;
  growth_driver_label: string;
  top_vendors_with_shares: string;
  caveats: string[];
  min_year_observed: number;
  max_year_observed: number;
  years_present: number;
  end_vendor_count: number;
}

export interface ContractIntelligenceResponse {
  filters: {
    limit: number;
    offset: number;
    department: string | null;
    category: string | null;
    growth_driver: string | null;
    min_delta: number;
    min_hhi: number;
  };
  total: number;
  summary: {
    rows_analyzed: number;
    total_growth: number;
    highest_hhi: number;
    amendment_heavy_cases: number;
    growth_drivers: string[];
  };
  sources: Array<{ label: string; url: string }>;
  notes: string[];
  results: ContractIntelligenceRow[];
}

export interface ChallengeReviewItem {
  id: string;
  title: string;
  route: string;
  endpoints: string[];
  postgresSources: string[];
  bigQuerySources: string[];
  currentState: string;
  validationGoal: string;
  servingStrategy: string;
  uiReview: string;
  postgresRowCount: number;
  bigQueryRowCount: number;
  hasBigQueryCoverage: boolean;
  status: 'ready_to_validate' | 'needs_source_mapping' | string;
}

export interface ChallengeReviewResponse {
  generated_at: string;
  strategy: {
    analytics_engine: string;
    serving_engine: string;
    priority: string;
  };
  bigquery: {
    available: boolean;
    project_id: string;
    dataset: string;
    location: string;
    error: string | null;
    counts: Record<string, number>;
  };
  postgres: {
    available: boolean;
    counts: Record<string, number>;
  };
  summary: {
    solved_challenges: number;
    ready_to_validate: number;
    needs_source_mapping: number;
    remaining_challenges: string[];
  };
  next_steps: string[];
  challenges: ChallengeReviewItem[];
}

export type ChallengeComparisonVerdict = 'pass' | 'warning' | 'fail';

export interface ChallengeComparisonReport {
  challenge_id: string;
  title: string;
  generated_at: string;
  verdict: ChallengeComparisonVerdict;
  summary: {
    postgres_result_count: number;
    bigquery_result_count: number;
    top_overlap_count: number;
    top_overlap_ratio: number;
    mismatch_count: number;
    metrics_checked: string[];
    notes: string[];
  };
  mismatches: {
    missing_in_postgres_count: number;
    missing_in_bigquery_count: number;
    metric_difference_count: number;
  };
  examples: {
    missing_in_postgres: Array<Record<string, unknown>>;
    missing_in_bigquery: Array<Record<string, unknown>>;
    metric_differences: Array<Record<string, unknown>>;
    warnings?: string[];
    live_result_count?: number;
  };
  source_counts?: {
    postgres: Record<string, number>;
    bigquery: Record<string, number>;
  };
}
