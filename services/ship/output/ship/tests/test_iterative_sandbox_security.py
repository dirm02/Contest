from output.ship.schema_catalog import get_catalog
from output.ship.sql_sandbox import SqlSandbox


class DummyPool:
    pass


def test_iterative_sandbox_rejects_multi_statement_and_dml():
    sandbox = SqlSandbox(DummyPool(), get_catalog())
    ok, reason, _ = sandbox.validate("SELECT * FROM fed.grants_contributions; DROP TABLE fed.grants_contributions")
    assert not ok
    assert "multiple" in reason

    ok, reason, _ = sandbox.validate("DELETE FROM fed.grants_contributions")
    assert not ok
    assert "forbidden" in reason


def test_iterative_sandbox_rejects_unknown_tables_and_caps_limit():
    sandbox = SqlSandbox(DummyPool(), get_catalog())
    ok, reason, _ = sandbox.validate("SELECT * FROM private.secret_table LIMIT 10")
    assert not ok
    assert "allow-list" in reason

    ok, reason, sql = sandbox.validate("SELECT recipient_legal_name FROM fed.grants_contributions LIMIT 999999")
    assert ok
    assert reason is None
    assert "LIMIT 10000" in sql
