"""Local runtime configuration for the portable ship analyst service."""

from __future__ import annotations

from functools import lru_cache
from typing import Any

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


FORBIDDEN_MODEL_MARKERS = (
    "anthropic",
    "claude",
    "gemini",
    "grok",
    "llama",
    "mistral",
)


class ShipSettings(BaseSettings):
    """Environment-backed settings used only by `output.ship`.

    This intentionally mirrors the small subset of the parent app settings that
    the ship service needs, so the service can be lifted into another project as
    an HTTP sidecar without importing the parent `src` package.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    openai_api_key: SecretStr | None = None
    canlii_api_key: SecretStr | None = None
    primary_model: str = Field(default="gpt-5.5")
    fast_model: str = Field(default="gpt-5.5")

    @field_validator("primary_model", "fast_model")
    @classmethod
    def models_must_be_openai_only(cls, value: str) -> str:
        lowered = value.lower()
        if any(marker in lowered for marker in FORBIDDEN_MODEL_MARKERS):
            raise ValueError("output.ship only supports OpenAI models")
        return value

    def openai_key_value(self) -> str:
        if self.openai_api_key is None:
            raise RuntimeError("OPENAI_API_KEY is required to run output.ship LLM routing, summarization, and web classification")
        return self.openai_api_key.get_secret_value()

    def canlii_key_value(self) -> str | None:
        if self.canlii_api_key is None:
            return None
        return self.canlii_api_key.get_secret_value()

    def safe_dict(self) -> dict[str, Any]:
        return {
            "primary_model": self.primary_model,
            "fast_model": self.fast_model,
            "openai_api_key": "***redacted***" if self.openai_api_key else None,
            "canlii_api_key": "***redacted***" if self.canlii_api_key else None,
        }


@lru_cache(maxsize=1)
def get_ship_settings() -> ShipSettings:
    return ShipSettings()


settings = get_ship_settings()
