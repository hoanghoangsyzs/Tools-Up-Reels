from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "FB Reels Publisher"
    app_env: str = "development"
    app_debug: bool = True

    database_url: str
    redis_url: str

    meta_app_id: str = ""
    meta_app_secret: str = ""
    meta_graph_version: str = ""
    meta_redirect_uri: str = ""
    meta_config_id: str = ""
    secret_key: str
    video_storage_dir: str = "storage/videos"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )


settings = Settings()