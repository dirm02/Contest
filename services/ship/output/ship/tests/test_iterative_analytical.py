from output.ship.analytical import AnalyticalAgent
from output.ship.schema_catalog import get_catalog
from output.ship.sql_compiler import compile_query_plan


class NoopSandbox:
    def __init__(self):
        self.catalog = get_catalog()

    def validate(self, sql):
        return True, None, sql


def test_iterative_analytical_schools_question_compiles_to_safe_count_query():
    agent = AnalyticalAgent(catalog=get_catalog(), sandbox=NoopSandbox())
    extraction = agent.extract_concepts("How many schools received funding in 2024?")
    plan, concepts = agent.plan("How many schools received funding in 2024?", extraction)
    compiled = compile_query_plan(plan, get_catalog(), concepts)
    assert plan.template_id == "count_distinct"
    assert "COUNT(DISTINCT recipient_legal_name)" in compiled.sql
    assert "EXTRACT(YEAR FROM agreement_start_date)::int = 2024" in compiled.sql
    assert any(concept.concept == "schools" for concept in concepts)
    assert any("School matching" in caveat for caveat in compiled.caveats)


def test_iterative_analytical_universities_threshold_uses_having():
    agent = AnalyticalAgent(catalog=get_catalog(), sandbox=NoopSandbox())
    extraction = agent.extract_concepts("List universities with more than $10M in federal contracts.")
    plan, concepts = agent.plan("List universities with more than $10M in federal contracts.", extraction)
    compiled = compile_query_plan(plan, get_catalog(), concepts)
    assert plan.template_id == "aggregate_by_group"
    assert "HAVING total_amount > 10000000.0" in compiled.sql
    assert "university" in compiled.sql.lower()
