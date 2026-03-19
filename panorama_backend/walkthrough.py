"""
walkthrough.py
==============

Walkthrough® — multi-room 360° navigation with Street View-like
movement controls.  Builds on Pannellum's multi-scene tour
capability to let users click hotspot arrows to navigate between
rooms, just like Google Street View.
"""

from __future__ import annotations

import json
import logging
import shutil
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from .panorama_viewer import PanoramaViewer, PANNELLUM_DIR

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------

@dataclass
class Hotspot:
    """A navigation hotspot within a panorama — click to move to another room."""

    target_room_id: str
    """ID of the room this hotspot navigates to."""

    yaw: float
    """Horizontal angle in degrees (0 = centre of view)."""

    pitch: float
    """Vertical angle in degrees (0 = horizon)."""

    label: str = ""
    """Tooltip text shown on hover."""

    id: str = field(default_factory=lambda: uuid.uuid4().hex[:8])


@dataclass
class Room:
    """A single room in a walkthrough, with its panorama and navigation hotspots."""

    name: str
    """Display name of the room (e.g. "Living Room")."""

    panorama_path: str
    """Path or URL to the equirectangular panorama image."""

    hotspots: list[Hotspot] = field(default_factory=list)
    """Navigation hotspots linking to other rooms."""

    id: str = field(default_factory=lambda: uuid.uuid4().hex[:8])
    """Unique room identifier."""

    default_yaw: float = 0.0
    """Initial horizontal view angle when entering this room."""

    default_pitch: float = 0.0
    """Initial vertical view angle when entering this room."""

    hfov: int = 110
    """Horizontal field of view in degrees."""


@dataclass
class Walkthrough:
    """A collection of connected rooms forming a walkthrough tour."""

    rooms: list[Room] = field(default_factory=list)
    """All rooms in the walkthrough."""

    title: str = "360° Walkthrough"
    """Tour title."""

    first_room_id: str = ""
    """ID of the starting room. Defaults to the first room added."""

    id: str = field(default_factory=lambda: uuid.uuid4().hex[:8])

    def get_room(self, room_id: str) -> Optional[Room]:
        """Look up a room by ID."""
        for room in self.rooms:
            if room.id == room_id:
                return room
        return None


# ---------------------------------------------------------------------------
# Manager
# ---------------------------------------------------------------------------

class WalkthroughManager:
    """Create and manage multi-room 360° walkthroughs.

    Parameters
    ----------
    pannellum_dir : str or Path, optional
        Override path to the Pannellum installation.
    """

    def __init__(self, pannellum_dir: Optional[str | Path] = None):
        self._pannellum_dir = Path(pannellum_dir) if pannellum_dir else PANNELLUM_DIR

    # ------------------------------------------------------------------
    # Walkthrough CRUD
    # ------------------------------------------------------------------

    def create_walkthrough(
        self,
        rooms: list[Room],
        title: str = "360° Walkthrough",
    ) -> Walkthrough:
        """Create a new walkthrough from a list of rooms.

        Parameters
        ----------
        rooms : list[Room]
            Rooms with their panoramas and hotspots.
        title : str
            Tour title.

        Returns
        -------
        Walkthrough
        """
        wt = Walkthrough(rooms=list(rooms), title=title)
        if rooms:
            wt.first_room_id = rooms[0].id
        logger.info("Created walkthrough '%s' with %d rooms", title, len(rooms))
        return wt

    def add_room(self, walkthrough: Walkthrough, room: Room) -> None:
        """Add a room to an existing walkthrough."""
        walkthrough.rooms.append(room)
        if not walkthrough.first_room_id:
            walkthrough.first_room_id = room.id
        logger.info("Added room '%s' to walkthrough '%s'", room.name, walkthrough.title)

    @staticmethod
    def link_rooms(
        room_a: Room,
        room_b: Room,
        a_to_b_yaw: float = 0.0,
        a_to_b_pitch: float = 0.0,
        b_to_a_yaw: float = 180.0,
        b_to_a_pitch: float = 0.0,
    ) -> None:
        """Create bidirectional navigation hotspots between two rooms.

        Parameters
        ----------
        room_a, room_b : Room
            The two rooms to connect.
        a_to_b_yaw, a_to_b_pitch : float
            Hotspot position in room A pointing toward room B.
        b_to_a_yaw, b_to_a_pitch : float
            Hotspot position in room B pointing back to room A.
        """
        room_a.hotspots.append(Hotspot(
            target_room_id=room_b.id,
            yaw=a_to_b_yaw,
            pitch=a_to_b_pitch,
            label=f"Go to {room_b.name}",
        ))
        room_b.hotspots.append(Hotspot(
            target_room_id=room_a.id,
            yaw=b_to_a_yaw,
            pitch=b_to_a_pitch,
            label=f"Go to {room_a.name}",
        ))

    # ------------------------------------------------------------------
    # Viewer generation
    # ------------------------------------------------------------------

    def generate_viewer_html(
        self,
        walkthrough: Walkthrough,
        panorama_base_url: str = "",
        pannellum_base_url: str = "/static/pannellum",
    ) -> str:
        """Generate a multi-scene Pannellum tour HTML page.

        Parameters
        ----------
        walkthrough : Walkthrough
            The walkthrough data.
        panorama_base_url : str
            URL prefix for panorama images.
        pannellum_base_url : str
            URL prefix for Pannellum assets.

        Returns
        -------
        str
            Complete HTML page.
        """
        tour_config = self._build_tour_config(walkthrough, panorama_base_url)

        return f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{walkthrough.title}</title>
    <link rel="stylesheet" href="{pannellum_base_url}/pannellum.css">
    <style>
        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
        html, body {{ width: 100%; height: 100%; overflow: hidden; background: #000; }}
        #panorama {{ width: 100vw; height: 100vh; }}
    </style>
</head>
<body>
    <div id="panorama"></div>
    <script src="{pannellum_base_url}/libpannellum.js"></script>
    <script src="{pannellum_base_url}/pannellum.js"></script>
    <script>
        pannellum.viewer('panorama', {json.dumps(tour_config, indent=4)});
    </script>
</body>
</html>"""

    def save_viewer(
        self,
        walkthrough: Walkthrough,
        output_html_path: str | Path,
    ) -> Path:
        """Save a self-contained walkthrough viewer with all assets.

        Copies Pannellum assets and all panorama images into the output
        directory so the tour works offline.

        Parameters
        ----------
        walkthrough : Walkthrough
            The walkthrough data.
        output_html_path : str or Path
            Destination path for the HTML file.

        Returns
        -------
        Path
            Absolute path to the generated HTML file.
        """
        output_html_path = Path(output_html_path).resolve()
        output_dir = output_html_path.parent
        output_dir.mkdir(parents=True, exist_ok=True)

        # Copy Pannellum assets
        viewer = PanoramaViewer(self._pannellum_dir)
        assets_dir = output_dir / "pannellum"
        viewer._copy_pannellum_assets(assets_dir)

        # Copy panorama images
        pano_dir = output_dir / "panoramas"
        pano_dir.mkdir(exist_ok=True)
        for room in walkthrough.rooms:
            src = Path(room.panorama_path).resolve()
            if src.is_file():
                shutil.copy2(src, pano_dir / src.name)

        # Generate HTML with relative paths
        tour_config = self._build_tour_config(walkthrough, "panoramas")

        html = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{walkthrough.title}</title>
    <link rel="stylesheet" href="pannellum/pannellum.css">
    <style>
        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
        html, body {{ width: 100%; height: 100%; overflow: hidden; background: #000; }}
        #panorama {{ width: 100vw; height: 100vh; }}
    </style>
</head>
<body>
    <div id="panorama"></div>
    <script src="pannellum/libpannellum.js"></script>
    <script src="pannellum/pannellum.js"></script>
    <script>
        pannellum.viewer('panorama', {json.dumps(tour_config, indent=4)});
    </script>
</body>
</html>"""

        output_html_path.write_text(html, encoding="utf-8")
        logger.info("Walkthrough viewer saved to %s", output_html_path)
        return output_html_path

    # ------------------------------------------------------------------
    # Internal — Pannellum tour config
    # ------------------------------------------------------------------

    @staticmethod
    def _build_tour_config(
        walkthrough: Walkthrough,
        panorama_base_url: str,
    ) -> dict:
        """Build the Pannellum multi-scene tour JSON config."""
        scenes = {}

        for room in walkthrough.rooms:
            # Build panorama URL
            pano_filename = Path(room.panorama_path).name
            if panorama_base_url:
                pano_url = f"{panorama_base_url}/{pano_filename}"
            else:
                pano_url = pano_filename

            # Build hotspots
            hotspots = []
            for hs in room.hotspots:
                hotspots.append({
                    "id": hs.id,
                    "pitch": hs.pitch,
                    "yaw": hs.yaw,
                    "type": "scene",
                    "text": hs.label or f"Navigate",
                    "sceneId": hs.target_room_id,
                })

            scenes[room.id] = {
                "title": room.name,
                "type": "equirectangular",
                "panorama": pano_url,
                "hfov": room.hfov,
                "yaw": room.default_yaw,
                "pitch": room.default_pitch,
                "hotSpots": hotspots,
            }

        first_scene = walkthrough.first_room_id or (
            walkthrough.rooms[0].id if walkthrough.rooms else ""
        )

        return {
            "default": {
                "firstScene": first_scene,
                "autoLoad": True,
                "autoRotate": -2,
                "compass": True,
                "showZoomCtrl": True,
                "showFullscreenCtrl": True,
                "mouseZoom": True,
                "draggable": True,
            },
            "scenes": scenes,
        }
