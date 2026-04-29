from output.ship.classifier import classify_turn_deterministic


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


def test_iterative_classifier_refuses_or_clarifies_bad_questions():
    weather = classify_turn_deterministic("What's the weather?", [])
    assert weather is not None
    assert weather.mode == "not_answerable"

    vague = classify_turn_deterministic("Tell me about contracts", [])
    assert vague is not None
    assert vague.mode == "clarify"
