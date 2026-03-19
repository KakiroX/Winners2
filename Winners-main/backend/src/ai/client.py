from functools import lru_cache

from langchain_google_genai import ChatGoogleGenerativeAI

from src.config import settings


@lru_cache(maxsize=1)
def get_gemini_client() -> ChatGoogleGenerativeAI:
    return ChatGoogleGenerativeAI(
        model=settings.gemini_model,
        google_api_key=settings.google_api_key,
        temperature=settings.gemini_temperature,
        max_retries=settings.gemini_max_retries,
    )


@lru_cache(maxsize=1)
def get_gemini_image_client() -> ChatGoogleGenerativeAI:
    return ChatGoogleGenerativeAI(
        model=settings.gemini_image_model,
        google_api_key=settings.google_api_key,
        temperature=settings.gemini_temperature,
        max_retries=settings.gemini_max_retries,
    )
