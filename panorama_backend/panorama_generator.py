"""
panorama_generator.py
=====================

AI-powered equirectangular panorama generation using Google Gemini
Nano Banana Pro (gemini-3-pro-image-preview).

Supports:
- Text-to-panorama generation (initial room creation)
- Image editing (modify an existing panorama)
- Multi-turn conversational editing (iterative refinement)

All outputs are equirectangular (2:1 aspect ratio) images suitable
for 360° viewing in Pannellum.
"""

from __future__ import annotations

import base64
import io
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from PIL import Image

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Prompt templates (derived from prompts.txt)
# ---------------------------------------------------------------------------

SYSTEM_INSTRUCTIONS = (
    "You are an expert Architectural Visualization AI. Your task is to "
    "generate a high-fidelity 360-degree Equirectangular Panorama of an "
    "interior space."
)

BASE_CONTEXT = (
    "Format: 360-degree, equirectangular projection, 2:1 aspect ratio. "
    "Style: Photorealistic, architectural photography, 8k resolution, "
    "Unreal Engine 5 render. "
    "Lighting: Global illumination, natural sunlight from windows."
)

TECHNICAL_KEYWORDS = (
    "360-degree, panoramic view, equirectangular projection, aspect ratio 2:1, "
    "ultra-wide angle, distorted perspective for 3D sphere, seamless horizon, "
    "full interior view, 8k resolution, photorealistic, sharp details, "
    "architectural photography style"
)

NEGATIVE_PROMPT = (
    "Do NOT include: fisheye lens distortion, black bars, cut-off edges, "
    "2D flat image, people, blur, low resolution, broken geometry."
)

GENERATION_RULES = (
    "1. Maintain the overall spatial geometry and architectural structure of the room. "
    "2. If asked to change a single element, modify ONLY that element and keep "
    "everything else identical. "
    "3. If asked for a style change, transform the lighting, materials, and furniture "
    "while keeping the 360-degree perspective intact. "
    "4. Ensure the horizontal line is perfectly straight for seamless 3D sphere mapping."
)


def _build_generation_prompt(scene_description: str, style_hints: str = "") -> str:
    """Build the full generation prompt from templates."""
    parts = [
        SYSTEM_INSTRUCTIONS,
        "",
        f"BASE CONTEXT: {BASE_CONTEXT}",
        "",
        f"SCENE DESCRIPTION: {scene_description}",
    ]
    if style_hints:
        parts.append(f"STYLE HINTS: {style_hints}")
    parts.extend([
        "",
        f"TECHNICAL KEYWORDS: {TECHNICAL_KEYWORDS}",
        "",
        NEGATIVE_PROMPT,
    ])
    return "\n".join(parts)


def _get_pixel_coords(pitch: float, yaw: float, width: int, height: int) -> tuple[int, int]:
    """Convert equirectangular pitch/yaw to pixel x/y."""
    # yaw is [-180, 180], pitch is [-90, 90]
    x = int(((yaw + 180) / 360) * width)
    y = int(((90 - pitch) / 180) * height)
    return x, y


def _build_edit_prompt(room_state: str, modification: str, pitch: Optional[float] = None, yaw: Optional[float] = None, width: int = 1024, height: int = 512) -> str:
    """Build an editing prompt from templates."""
    location_context = ""
    if pitch is not None and yaw is not None:
        x, y = _get_pixel_coords(pitch, yaw, width, height)
        location_context = f"STRICT FOCUS: This modification applies ONLY to the object located at pixel coordinates (x={x}, y={y}). "

    return "\n".join([
        SYSTEM_INSTRUCTIONS,
        "",
        f"BASE CONTEXT: {BASE_CONTEXT}",
        "",
        f"CURRENT ROOM STATE: {room_state}",
        "",
        f"USER MODIFICATION REQUEST: {location_context}{modification}",
        "",
        f"GENERATION RULES: {GENERATION_RULES}",
        "5. Local Transformation: Change only the specified area/object. Do not alter the surrounding walls, lighting, or unrelated furniture.",
        "",
        NEGATIVE_PROMPT,
    ])


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass
class PanoramaResult:
    """Result of a panorama generation or editing operation."""

    image: Image.Image
    """The generated panorama as a PIL Image."""

    description: str = ""
    """Text description returned by the model (if any)."""

    prompt_used: str = ""
    """The prompt that was sent to the model."""

    def save(self, path: str | Path, quality: int = 95) -> Path:
        """Save the panorama to disk.

        Parameters
        ----------
        path : str or Path
            Output file path (.jpg or .png).
        quality : int
            JPEG quality (1-100). Ignored for PNG.

        Returns
        -------
        Path
            Absolute path to the saved file.
        """
        path = Path(path).resolve()
        path.parent.mkdir(parents=True, exist_ok=True)

        save_kwargs = {}
        if path.suffix.lower() in (".jpg", ".jpeg"):
            save_kwargs["quality"] = quality

        self.image.save(str(path), **save_kwargs)
        logger.info("Panorama saved to %s (%dx%d)", path, self.image.width, self.image.height)
        return path

    @property
    def width(self) -> int:
        return self.image.width

    @property
    def height(self) -> int:
        return self.image.height


@dataclass
class ChatSession:
    """Wraps a Gemini multi-turn chat for iterative panorama editing."""

    _chat: object = field(repr=False)
    """Internal Gemini chat object."""

    history: list[str] = field(default_factory=list)
    """Textual history of modifications applied."""


# ---------------------------------------------------------------------------
# Main generator class
# ---------------------------------------------------------------------------

class PanoramaGenerator:
    """Generate and edit equirectangular panoramas using Gemini Nano Banana Pro.

    Parameters
    ----------
    api_key : str, optional
        Google AI API key. If not provided, the ``google-genai`` SDK
        will look for the ``GOOGLE_API_KEY`` or ``GEMINI_API_KEY``
        environment variable.
    model : str
        Model identifier. Defaults to ``"gemini-3-pro-image-preview"``
        (Nano Banana Pro) for highest quality.  Use
        ``"gemini-3.1-flash-image-preview"`` (Nano Banana 2) for
        faster/cheaper generation.
    """

    DEFAULT_MODEL = "gemini-3-pro-image-preview"

    def __init__(
        self,
        api_key: Optional[str] = None,
        model: str = DEFAULT_MODEL,
    ):
        from google import genai

        client_kwargs = {}
        if api_key:
            client_kwargs["api_key"] = api_key

        self._client = genai.Client(**client_kwargs)
        self._model = model
        logger.info("PanoramaGenerator initialised with model: %s", model)

    # ------------------------------------------------------------------
    # Text-to-panorama
    # ------------------------------------------------------------------

    def generate(
        self,
        scene_description: str,
        style_hints: str = "",
    ) -> PanoramaResult:
        """Generate a new equirectangular panorama from a text description.

        Parameters
        ----------
        scene_description : str
            Natural-language description of the room/scene.
            Example: *"Modern Mediterranean living room with a curved
            beige sofa, wooden beams, and arched windows."*
        style_hints : str, optional
            Additional style guidance (e.g. ``"warm golden-hour lighting"``).

        Returns
        -------
        PanoramaResult
            The generated panorama image and metadata.
        """
        from google.genai import types

        prompt = _build_generation_prompt(scene_description, style_hints)
        logger.info("Generating panorama — prompt length: %d chars", len(prompt))

        response = self._client.models.generate_content(
            model=self._model,
            contents=[prompt],
            config=types.GenerateContentConfig(
                response_modalities=["TEXT", "IMAGE"],
            ),
        )

        return self._parse_response(response, prompt)

    def detect_and_source_furniture(self, panorama: Image.Image) -> list[dict]:
        """Passive detection of furniture and internet sourcing simulation."""
        from google.genai import types
        import json

        detection_prompt = (
            "Analyze this 360 panorama and list all distinct furniture items. "
            "For each item, provide: "
            "1. A descriptive name (e.g., 'Modern Blue Velvet Sofa') "
            "2. An estimated price in USD "
            "3. A simulated shopping URL. "
            "Respond ONLY with a JSON list of objects: "
            "[{\"name\": \"...\", \"price\": \"...\", \"url\": \"...\"}]"
        )

        try:
            response = self._client.models.generate_content(
                model=self._model,
                contents=[detection_prompt, panorama],
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                ),
            )
            
            # Extract JSON from response
            text = response.candidates[0].content.parts[0].text
            return json.loads(text)
        except Exception as e:
            logger.warning("Furniture detection failed: %s", e)
            return []

    # ------------------------------------------------------------------
    # Image editing (single-shot)
    # ------------------------------------------------------------------

    def edit(
        self,
        panorama: Image.Image,
        modification_request: str,
        room_state: str = "",
        pitch: Optional[float] = None,
        yaw: Optional[float] = None,
    ) -> PanoramaResult:
        """Edit an existing panorama with a text instruction and area-specific context."""
        from google.genai import types

        # Create a localized crop for better context if coordinates are provided
        context_images = [panorama]
        location_msg = "See the full 360 panorama."
        
        if pitch is not None and yaw is not None:
            x, y = _get_pixel_coords(pitch, yaw, panorama.width, panorama.height)
            # Define a context window (e.g., 512x512)
            w, h = 512, 512
            left = max(0, x - w // 2)
            top = max(0, y - h // 2)
            right = min(panorama.width, left + w)
            bottom = min(panorama.height, top + h)
            
            crop = panorama.crop((left, top, right, bottom))
            context_images.append(crop)
            location_msg = f"See the full panorama AND the zoomed-in crop of the target area (centered at x={x}, y={y})."

        prompt = _build_edit_prompt(
            room_state=room_state or location_msg,
            modification=modification_request,
            pitch=pitch,
            yaw=yaw,
            width=panorama.width,
            height=panorama.height,
        )
        logger.info("Editing panorama area — modification: %s", modification_request)

        response = self._client.models.generate_content(
            model=self._model,
            contents=[prompt] + context_images,
            config=types.GenerateContentConfig(
                response_modalities=["TEXT", "IMAGE"],
            ),
        )

        return self._parse_response(response, prompt)

    # ------------------------------------------------------------------
    # Multi-turn editing (conversational)
    # ------------------------------------------------------------------

    def start_session(self, initial_prompt: str = "") -> ChatSession:
        """Start a multi-turn editing chat session.

        Parameters
        ----------
        initial_prompt : str, optional
            System-level context for the session. If empty, the default
            system instructions and base context are used.

        Returns
        -------
        ChatSession
        """
        from google.genai import types

        system_prompt = initial_prompt or f"{SYSTEM_INSTRUCTIONS}\n\n{BASE_CONTEXT}"

        chat = self._client.chats.create(
            model=self._model,
            config=types.GenerateContentConfig(
                response_modalities=["TEXT", "IMAGE"],
                system_instruction=system_prompt,
            ),
        )

        logger.info("Started multi-turn editing session")
        return ChatSession(_chat=chat)

    def iterate(
        self,
        session: ChatSession,
        modification_request: str,
        reference_image: Optional[Image.Image] = None,
    ) -> PanoramaResult:
        """Send a modification request within a multi-turn session.

        Parameters
        ----------
        session : ChatSession
            The active chat session (from ``start_session``).
        modification_request : str
            What to change in the current panorama.
        reference_image : PIL.Image.Image, optional
            Optional reference image to include with the request.

        Returns
        -------
        PanoramaResult
        """
        contents = [modification_request]
        if reference_image is not None:
            contents.append(reference_image)

        logger.info("Iterating in session — request: %s", modification_request)
        response = session._chat.send_message(contents)
        session.history.append(modification_request)

        return self._parse_response(response, modification_request)

    # ------------------------------------------------------------------
    # Response parsing
    # ------------------------------------------------------------------

    @staticmethod
    def _parse_response(response, prompt_used: str) -> PanoramaResult:
        """Extract image and text from a Gemini response."""
        image = None
        description_parts: list[str] = []

        for part in response.candidates[0].content.parts:
            if part.text is not None:
                description_parts.append(part.text)
            elif part.inline_data is not None:
                image = Image.open(io.BytesIO(part.inline_data.data))

        if image is None:
            raise RuntimeError(
                "The model did not return an image. "
                "Try rephrasing the prompt or using a different model. "
                f"Model response text: {' '.join(description_parts)}"
            )

        return PanoramaResult(
            image=image,
            description="\n".join(description_parts),
            prompt_used=prompt_used,
        )
