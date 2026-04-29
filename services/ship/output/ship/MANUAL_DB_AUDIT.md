# Manual Database Audit

Checked at: `2026-04-29T10:42:39.548857+00:00`

This audit reruns each shipped `output/ship/` recipe and compares the recipe's leading factual outputs against separate manual SQL over the underlying source tables/views. It is intentionally narrower than full product verification: the goal is to test whether the core rows and numeric magnitudes agree with the database, not to re-score prose style.

| Recipe | Status | Recipe Latency | Manual Checks | Key Fact |
| --- | --- | ---: | ---: | --- |
| `funding_loops` | pass | 22ms | 6/6 | `{"cycle_id": 1145, "total_flow": 84137641.0}` |
| `zombie_recipients` | pass | 555ms | 5/5 | `{"bn": "895640944RR0001", "canonical_name": "EASTERN REGIONAL INTEGRATED HEALTH AUTHORITY", "entity_id": 84897, "total_government_funding": 6507600605.0}` |
| `ghost_capacity` | pass | 357ms | 4/4 | `{"bn": "849854831RR0001", "canonical_name": "THE CITRINE FOUNDATION OF CANADA", "entity_id": 59489, "fiscal_year": 2023}` |
| `duplicative_funding` | pass | 3292ms | 4/4 | `{"canonical_name": "Alberta Health Services", "entity_id": 92304, "total_all_funding": 165961552107.59}` |
| `vendor_concentration` | pass | 5840ms | 10/10 | `{"fiscal_year": "2004", "segment_owner": "Transport Canada | Transports Canada", "segment_total_amount": 385000000.0, "source_table": "fed.grants_contributions", "supplier_amount": 385000000.0, "supplier_name": "Metrolinx|Metrolinx"}` |
| `sole_source_amendment` | pass | 89ms | 6/6 | `{"fiscal_year": "2018 - 2019", "segment_owner": "Primary and Preventative Health Services", "segment_total_amount": 34395000.0, "source_table": "ab.ab_sole_source", "supplier_amount": 34395000.0, "supplier_name": "Telus Health Solutions Inc."}` |
| `contract_intelligence` | pass | 496ms | 6/6 | `{"fiscal_year": "2025 - 2026", "segment_owner": "Affordability and Utilities", "segment_total_amount": 19166597.19, "source_table": "ab.ab_contracts", "supplier_amount": 17954448.42, "supplier_name": "AESO ALBERTA ELECTRIC SYSTEM OPERATOR"}` |
| `related_parties` | pass | 7518ms | 2/2 | `{"director_norm_name": "ROXANNE JENNINGS"}` |
| `policy_misalignment` | pass | 955ms | 3/3 | `{"metric_value": 50221793893.21, "period": 2025}` |
| `adverse_media` | pass | 24652ms | 4/4 | `{"canonical_name": "Alberta Health Services", "entity_id": 92304, "source_url": "https://oipc.ab.ca/wp-content/uploads/2025/09/Order-HIA2025-02.pdf"}` |

## Details

### funding_loops

Status: **pass**

- `pass` `cycle_exists`: Recipe cycle_id exists in cra.johnson_cycles.
  - recipe: `1145`
  - manual: `1145`
- `pass` `hops`: hops matches manual cycle row.
  - recipe: `4`
  - manual: `4`
- `pass` `total_flow`: total_flow matches manual cycle row.
  - recipe: `84137641.0`
  - manual: `84137641.0`
- `pass` `bottleneck_amt`: bottleneck_amt matches manual cycle row.
  - recipe: `19000.0`
  - manual: `19000.0`
- `pass` `min_year`: min_year matches manual cycle row.
  - recipe: `2020`
  - manual: `2020`
- `pass` `max_year`: max_year matches manual cycle row.
  - recipe: `2021`
  - manual: `2021`

### zombie_recipients

Status: **pass**

- `pass` `bn_exists`: Recipe BN exists in CRA government funding and identification tables.
  - recipe: `"895640944RR0001"`
  - manual: `"895640944RR0001"`
- `pass` `total_government_funding`: total_government_funding matches manual CRA rollup.
  - recipe: `6507600605.0`
  - manual: `6507600605.0`
- `pass` `total_revenue`: total_revenue matches manual CRA rollup.
  - recipe: `6565656948.0`
  - manual: `6565656948.0`
- `pass` `govt_share`: govt_share matches manual CRA rollup.
  - recipe: `0.9911575728887747`
  - manual: `0.9911575728887747`
- `pass` `latest_filing_year`: latest_filing_year matches manual CRA rollup.
  - recipe: `2023`
  - manual: `2023`

### ghost_capacity

Status: **pass**

- `pass` `bn_exists`: Recipe BN exists in overhead table.
  - recipe: `"849854831RR0001"`
  - manual: `"849854831RR0001"`
- `pass` `fiscal_year`: fiscal_year matches latest manual overhead/compensation row.
  - recipe: `2023`
  - manual: `2023`
- `pass` `broad_overhead_pct`: broad_overhead_pct matches latest manual overhead/compensation row.
  - recipe: `351819.4`
  - manual: `351819.4`
- `pass` `reported_compensated_staff`: reported_compensated_staff matches latest manual overhead/compensation row.
  - recipe: `0`
  - manual: `0`

### duplicative_funding

Status: **pass**

- `pass` `entity_exists`: Recipe entity exists in general.vw_entity_funding.
  - recipe: `92304`
  - manual: `92304`
- `pass` `canonical_name`: canonical_name matches manual funding-view row.
  - recipe: `"Alberta Health Services"`
  - manual: `"Alberta Health Services"`
- `pass` `total_all_funding`: total_all_funding matches manual funding-view row.
  - recipe: `165961552107.59`
  - manual: `165961552107.59`
- `pass` `positive_funding_source_count`: positive_funding_source_count matches manual funding-view row.
  - recipe: `4`
  - manual: `4`

### vendor_concentration

Status: **pass**

- `pass` `segment_total_amount`: segment_total_amount matches manual segment aggregation.
  - recipe: `385000000.0`
  - manual: `385000000.0`
- `pass` `supplier_amount`: supplier_amount matches manual segment aggregation.
  - recipe: `385000000.0`
  - manual: `385000000.0`
- `pass` `supplier_count`: supplier_count matches manual segment aggregation.
  - recipe: `1`
  - manual: `1`
- `pass` `award_count`: award_count matches manual segment aggregation.
  - recipe: `1`
  - manual: `1`
- `pass` `supplier_year_count`: supplier_year_count matches manual incumbency aggregation.
  - recipe: `6`
  - manual: `6`
- `pass` `first_year`: first_year matches manual incumbency aggregation.
  - recipe: `2016`
  - manual: `2016`
- `pass` `latest_year`: latest_year matches manual incumbency aggregation.
  - recipe: `2021`
  - manual: `2021`
- `pass` `incumbency_window_years`: incumbency_window_years matches manual incumbency aggregation.
  - recipe: `6`
  - manual: `6`
- `pass` `award_count_window`: award_count_window matches manual incumbency aggregation.
  - recipe: `31`
  - manual: `31`
- `pass` `total_amount_window`: total_amount_window matches manual incumbency aggregation.
  - recipe: `224381544.76`
  - manual: `224381544.76`

### sole_source_amendment

Status: **pass**

- `pass` `segment_total_amount`: segment_total_amount matches manual segment aggregation.
  - recipe: `34395000.0`
  - manual: `34395000.0`
- `pass` `supplier_amount`: supplier_amount matches manual segment aggregation.
  - recipe: `34395000.0`
  - manual: `34395000.0`
- `pass` `supplier_count`: supplier_count matches manual segment aggregation.
  - recipe: `1`
  - manual: `1`
- `pass` `award_count`: award_count matches manual segment aggregation.
  - recipe: `1`
  - manual: `1`
- `pass` `metric_value`: ab_sole_source trend metric_value matches manual period aggregation.
  - recipe: `501251693.63`
  - manual: `501251693.63`
- `pass` `row_count`: ab_sole_source trend row_count matches manual period aggregation.
  - recipe: `411`
  - manual: `411`

### contract_intelligence

Status: **pass**

- `pass` `segment_total_amount`: segment_total_amount matches manual segment aggregation.
  - recipe: `19166597.19`
  - manual: `19166597.19`
- `pass` `supplier_amount`: supplier_amount matches manual segment aggregation.
  - recipe: `17954448.42`
  - manual: `17954448.42`
- `pass` `supplier_count`: supplier_count matches manual segment aggregation.
  - recipe: `61`
  - manual: `61`
- `pass` `award_count`: award_count matches manual segment aggregation.
  - recipe: `1`
  - manual: `1`
- `pass` `metric_value`: ab_contracts trend metric_value matches manual period aggregation.
  - recipe: `4370853764.01`
  - manual: `4370853764.01`
- `pass` `row_count`: ab_contracts trend row_count matches manual period aggregation.
  - recipe: `8574`
  - manual: `8574`

### related_parties

Status: **pass**

- `pass` `connected_org_count`: connected_org_count matches manual director aggregation.
  - recipe: `326`
  - manual: `326`
- `pass` `combined_government_funding`: combined_government_funding matches manual director aggregation.
  - recipe: `1476726105.0`
  - manual: `1476726105.0`

### policy_misalignment

Status: **pass**

- `pass` `metric_value`: ab_grants trend metric_value matches manual period aggregation.
  - recipe: `50221793893.21`
  - manual: `50221793893.21`
- `pass` `row_count`: ab_grants trend row_count matches manual period aggregation.
  - recipe: `180464`
  - manual: `180464`
- `pass` `coverage_row_estimate`: Coverage audit row estimate matches pg_class.
  - recipe: `67079`
  - manual: `67079`

### adverse_media

Status: **pass**

- `pass` `top_funded_entity`: First web candidate maps to the top manually queried funding entity.
  - recipe: `{"canonical_name": "Alberta Health Services", "entity_id": 92304}`
  - manual: `{"canonical_name": "Alberta Health Services", "entity_id": 92304}`
- `pass` `url_live`: Web finding URL resolves and contains identifying claim text.
  - recipe: `"https://oipc.ab.ca/wp-content/uploads/2025/09/Order-HIA2025-02.pdf"`
  - manual: `null`
- `pass` `url_live`: Web finding URL resolves and contains identifying claim text.
  - recipe: `"https://oipc.ab.ca/wp-content/uploads/2025/06/Order-H2025-01.pdf"`
  - manual: `null`
- `pass` `url_live`: Web finding URL resolves and contains identifying claim text.
  - recipe: `"https://oipc.ab.ca/former-alberta-health-services-employee-fined-for-unauthorized-disclosure-of-health-information/"`
  - manual: `null`

## Interpretation

- `pass` means the recipe's checked rows/numbers matched an independent manual database query, within numeric tolerance where relevant.
- `warn` means the recipe returned a usable result but the manual audit did not cover a secondary facet, usually because the recipe had no optional secondary row to compare.
- `fail` means the recipe output did not match the manual database/source check and should not be treated as shipped until repaired.
