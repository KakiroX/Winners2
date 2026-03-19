import json
import logging
import asyncio
from concurrent.futures import ThreadPoolExecutor
from PIL import Image
from google.genai import Client, types
from .models import SourcedItem

logger = logging.getLogger(__name__)

class BOMAgent:
    """Agentic orchestrator for parallel furniture detection and sourcing."""
    
    def __init__(self, client: Client, model: str = "gemini-3-pro-image-preview"):
        self.client = client
        self.model = model
        self._executor = ThreadPoolExecutor(max_workers=5)

    async def process_room(self, panorama: Image.Image) -> list[dict]:
        """Orchestrate detection and parallel search sourcing."""
        try:
            # 1. Detect items in the room (Vision Task)
            items = await self._detect_items(panorama)
            if not items:
                return []

            # 2. Source each item in parallel (Search Grounding Tasks)
            # Limit to top 5 items for efficiency
            tasks = [self._source_item_task(desc) for desc in items[:5]]
            results = await asyncio.gather(*tasks, return_exceptions=True)
            
            sourced = []
            for res in results:
                if isinstance(res, dict) and "name" in res:
                    sourced.append(res)
                elif isinstance(res, Exception):
                    logger.warning("Parallel search task failed: %s", res)
            
            return sourced
        except Exception as e:
            logger.error("BOM process_room failed: %s", e)
            return []

    async def _detect_items(self, image: Image.Image) -> list[str]:
        """Detect furniture items and get specific descriptions."""
        prompt = (
            "Analyze this room panorama and list all distinct furniture and decor items. "
            "For each item, give a very specific product description including color, material, and style. "
            "Respond ONLY with a JSON list of strings: [\"description 1\", \"description 2\", ...]"
        )
        
        loop = asyncio.get_event_loop()
        try:
            response = await loop.run_in_executor(
                self._executor,
                lambda: self.client.models.generate_content(
                    model=self.model,
                    contents=[prompt, image],
                    config=types.GenerateContentConfig(response_mime_type="application/json")
                )
            )
            return json.loads(response.candidates[0].content.parts[0].text)
        except Exception as e:
            logger.warning("Furniture detection failed: %s", e)
            return []

    async def _source_item_task(self, description: str) -> dict:
        """Individual search task for grounding an item."""
        prompt = (
            f"Find a real product for sale online matching this description: {description}. "
            "Provide: 1. Product Name, 2. Current Price in USD, 3. Real Purchase URL. "
            "Respond ONLY with a JSON object: {\"name\": \"...\", \"price\": \"...\", \"url\": \"...\"}"
        )
        
        loop = asyncio.get_event_loop()
        try:
            # gemini-2.0-flash is faster and great for search grounding
            response = await loop.run_in_executor(
                self._executor,
                lambda: self.client.models.generate_content(
                    model='gemini-2.0-flash',
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        tools=[types.Tool(google_search=types.GoogleSearch())],
                        response_mime_type="application/json"
                    )
                )
            )
            return json.loads(response.candidates[0].content.parts[0].text)
        except Exception as e:
            logger.warning("Search failed for item '%s': %s", description, e)
            return {"error": str(e)}
