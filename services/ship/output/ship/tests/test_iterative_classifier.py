from output.ship.classifier import PlannedOperation, TurnClassification, _validate_plan, classify_turn_deterministic


LATEST = {
    "run_id": "11111111-1111-1111-1111-111111111111",
    "recipe_id": "sole_source_amendment",
    "row_count": 412,
    "columns": ["recipient_legal_name", "amount", "fiscal_year", "department", "province", "hhi"],
    "sample_rows": [],
    "pinned": False,
}

OLDER = {
    "run_id": "22222222-2222-2222-2222-222222222222",
    "recipe_id": "sole_source_amendment",
    "row_count": 399,
    "columns": ["recipient_legal_name", "amount", "fiscal_year", "department", "province", "hhi"],
    "sample_rows": [],
    "pinned": False,
}


def test_iterative_classifier_follow_up_modes():
    cases = [
        ("Filter that to 2024", "refined", "filter"),
        ("Sort by amount", "refined", "sort"),
        ("Top 5 only", "refined", "slice"),
        ("Group by department", "refined", "aggregate"),
        ("Why is row 12's HHI so high?", "conversational", "commentary"),
    ]
    for question, mode, kind in cases:
        plan = classify_turn_deterministic(question, [LATEST, OLDER])
        assert plan is not None
        assert plan.mode == mode
        assert plan.operations[0].kind == kind
        assert LATEST["run_id"] in plan.referenced_run_ids


def test_iterative_classifier_composed_and_analytical_modes():
    compare = classify_turn_deterministic("Compare FY2023 to FY2024", [LATEST, OLDER])
    assert compare is not None
    assert compare.mode == "composed"
    assert compare.operations[0].kind == "compare"

    analytical = classify_turn_deterministic("How many schools received funding in 2024?", [])
    assert analytical is not None
    assert analytical.mode == "analytical_query"
    assert analytical.operations[0].recipe_id == "__analytical__"

    named_total = classify_turn_deterministic("How much funding did Pizza Pizza receive?", [])
    assert named_total is not None
    assert named_total.mode == "analytical_query"
    assert named_total.operations[0].recipe_id == "__analytical__"

    named_total_with_memory = classify_turn_deterministic("How much funding did Pizza Pizza receive?", [LATEST])
    assert named_total_with_memory is not None
    assert named_total_with_memory.mode == "analytical_query"
    assert named_total_with_memory.operations[0].recipe_id == "__analytical__"


def test_iterative_classifier_rewrites_empty_commentary_for_named_funding_question():
    bad_plan = TurnClassification(
        mode="fresh",
        reasoning_one_line="Bad LLM plan selected commentary without memory.",
        operations=[
            PlannedOperation(
                kind="commentary",
                source_run_ids=[],
                description="Query funding records for recipient names matching Pizza Pizza.",
            )
        ],
        referenced_run_ids=[],
    )

    plan = _validate_plan("How much funding did Pizza Pizza receive?", bad_plan, [])
    assert plan.mode == "analytical_query"
    assert plan.operations[0].kind == "recipe_run"
    assert plan.operations[0].recipe_id == "__analytical__"


def test_iterative_classifier_routes_visible_zombie_charity_question_to_recipe():
    plan = classify_turn_deterministic("Which charities had government funding above 70% and stopped filing?", [])
    assert plan is not None
    assert plan.mode == "fresh"
    assert plan.operations[0].kind == "recipe_run"
    assert plan.operations[0].recipe_id == "zombie_recipients"


def test_iterative_classifier_refuses_or_clarifies_bad_questions():
    weather = classify_turn_deterministic("What's the weather?", [])
    assert weather is not None
    assert weather.mode == "not_answerable"

    vague = classify_turn_deterministic("Tell me about contracts", [])
    assert vague is not None
    assert vague.mode == "clarify"
