from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

_ROOT_ENV = Path(__file__).parent.parent.parent / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(_ROOT_ENV, ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    google_api_key: str
    gemini_model: str = "gemini-flash-3.1-preview"
    gemini_image_model: str = "gemini-flash-3.1-image-preview"
    gemini_temperature: float = 0.7
    gemini_max_retries: int = 3

    environment: str = "local"
    cors_origins: list[str] = ["http://localhost:3000"]
    api_v1_prefix: str = "/api/v1"


settings = Settings()
