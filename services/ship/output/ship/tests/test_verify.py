from output.ship.recipes.base import RecipeResult
from output.ship.summarizer import Citation, Paragraph, Summary
from output.ship.verify import verify


async def test_verify_accepts_cited_refinement_row_count_claim():
    result = RecipeResult(
        recipe_id="__memory__",
        question="Filter to Alberta",
        findings=[{"label": "Alberta recipient"}, {"label": "Alberta school board"}],
        sql_log=[],
    )
    summary = Summary(
        headline="Cached operation completed over prior findings.",
        paragraphs=[
            Paragraph(
                text="The resulting row set contains 2 rows.",
                citations=[Citation(finding_index=0)],
            )
        ],
        caveats=[],
    )

    verification = await verify(summary, result, object(), total_latency_ms=12)  # type: ignore[arg-type]

    assert verification.status == "pass"
    assert verification.failures == []
