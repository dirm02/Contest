from output.ship.classifier import PlannedOperation
from output.ship.refine import LoadedRun, Refiner
from output.ship.responses import Aggregation, SortKey


class FakeRegistry:
    def __init__(self):
        self.runs = {
            "run-a": LoadedRun(
                run_id="run-a",
                recipe_id="demo",
                params={},
                findings=[
                    {"recipient": "Alpha School", "amount": 2_000_000, "department": "Health"},
                    {"recipient": "Beta School", "amount": 500_000, "department": "Health"},
                    {"recipient": "Gamma Hospital", "amount": 3_000_000, "department": "Infrastructure"},
                ],
                sql_log=[],
            ),
            "run-b": LoadedRun(
                run_id="run-b",
                recipe_id="demo2",
                params={},
                findings=[
                    {"recipient": "Alpha School", "risk": "high"},
                    {"recipient": "Delta College", "risk": "medium"},
                ],
                sql_log=[],
            ),
        }

    async def load(self, run_id):
        return self.runs[run_id]


async def test_iterative_refiner_filter_sort_slice_aggregate_join_compare():
    refiner = Refiner(FakeRegistry())

    filtered = await refiner.execute(PlannedOperation(kind="filter", source_run_id="run-a", predicate="amount >= 1000000", description="filter"))
    assert len(filtered.findings) == 2
    assert filtered.op_record.after_count == 2

    sorted_result = await refiner.execute(
        PlannedOperation(kind="sort", source_run_id="run-a", sort_by=[SortKey(column="amount", dir="desc")], description="sort")
    )
    assert sorted_result.findings[0]["recipient"] == "Gamma Hospital"

    sliced = await refiner.execute(PlannedOperation(kind="slice", source_run_id="run-a", limit=1, description="top 1"))
    assert len(sliced.findings) == 1

    aggregated = await refiner.execute(
        PlannedOperation(
            kind="aggregate",
            source_run_id="run-a",
            group_by=["department"],
            aggregations=[Aggregation(column="amount", fn="sum", alias="total_amount")],
            description="group",
        )
    )
    assert {row["department"] for row in aggregated.findings} == {"Health", "Infrastructure"}

    joined = await refiner.execute(
        PlannedOperation(kind="join", left_run_id="run-a", right_run_id="run-b", keys=["recipient"], how="inner", description="join")
    )
    assert len(joined.findings) == 1
    assert joined.findings[0]["recipient"] == "Alpha School"

    compared = await refiner.execute(
        PlannedOperation(kind="compare", baseline_run_id="run-a", comparison_run_id="run-b", description="compare")
    )
    assert {row["_status"] for row in compared.findings} >= {"added", "removed"}
