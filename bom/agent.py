import json
import logging
import asyncio
from concurrent.futures import ThreadPoolExecutor
from PIL import Image
from google.genai import Client, types
from .models import SourcedItem

logger = logging.getLogger(__name__)

class BOMAgent:
    """Ultra-fast agent for furniture detection and sourcing in a single pass."""
    
    def __init__(self, client: Client, model: str = "gemini-2.0-flash"):
        self.client = client
        self.model = model
        self._executor = ThreadPoolExecutor(max_workers=2)

    async def process_room(self, panorama: Image.Image) -> list[dict]:
        """Process everything in a single, high-speed grounded pass."""
        prompt = (
            "1. Analyze this 360 panorama and detect all furniture/decor items. "
            "2. For each item, use your internal search knowledge to find a real product for sale. "
            "3. Provide: Product Name, Estimated Price in USD, and a valid retail URL. "
            "Respond ONLY with a JSON list: [{\"name\": \"...\", \"price\": \"...\", \"url\": \"...\"}]"
        )
        
        loop = asyncio.get_event_loop()
        try:
            # We perform a single call with Grounding enabled.
            # gemini-2.0-flash is exceptionally fast at this consolidated task.
            response = await loop.run_in_executor(
                self._executor,
                lambda: self.client.models.generate_content(
                    model=self.model,
                    contents=[prompt, panorama],
                    config=types.GenerateContentConfig(
                        tools=[types.Tool(google_search=types.GoogleSearch())],
                        response_mime_type="application/json"
                    )
                )
            )
            
            text = response.candidates[0].content.parts[0].text
            items = json.loads(text)
            logger.info("BOM Agent sourced %d items in a single pass.", len(items))
            return items
            
        except Exception as e:
            logger.error("BOM single-pass failed: %s", e)
            return []
