"""
panorama_viewer.py
==================

Generates interactive 360° panorama viewers using the local
Pannellum 2.5.7 installation.  Designed to be called by the parent
application — returns HTML strings for embedding or saves
self-contained viewer pages.
"""

from __future__ import annotations

import logging
import shutil
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# Path to the local Pannellum installation relative to the project root
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
PANNELLUM_DIR = _PROJECT_ROOT / "pannellum-2.5.7"


@dataclass
class ViewerConfig:
    """Configuration for the Pannellum 360° viewer."""

    title: str = "360° Panorama"
    author: str = ""
    auto_rotate: float = -2.0
    """Auto-rotation speed in deg/sec. Negative = left. 0 = off."""
    auto_load: bool = True
    hfov: int = 110
    """Horizontal field of view in degrees."""
    min_hfov: int = 30
    max_hfov: int = 150
    compass: bool = True
    show_zoom: bool = True
    show_fullscreen: bool = True
    draggable: bool = True
    friction: float = 0.15
    default_yaw: float = 0.0
    default_pitch: float = 0.0


class PanoramaViewer:
    """Generate Pannellum-based 360° panorama viewers.

    Uses the locally-installed Pannellum 2.5.7 assets.  Can return
    inline HTML for embedding in a larger app or save self-contained
    viewer pages with all assets copied alongside.

    Parameters
    ----------
    pannellum_dir : str or Path, optional
        Override path to the Pannellum installation.
        Defaults to ``<project_root>/pannellum-2.5.7``.
    """

    def __init__(self, pannellum_dir: Optional[str | Path] = None):
        self.pannellum_dir = Path(pannellum_dir) if pannellum_dir else PANNELLUM_DIR
        if not self.pannellum_dir.is_dir():
            raise FileNotFoundError(
                f"Pannellum directory not found: {self.pannellum_dir}"
            )

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def get_viewer_html(
        self,
        panorama_url: str,
        config: Optional[ViewerConfig] = None,
        pannellum_base_url: str = "/static/pannellum",
    ) -> str:
        """Return an HTML string for embedding a 360° viewer.

        This method does **not** copy any files — it assumes the parent
        app serves Pannellum assets and the panorama at the given URLs.

        Parameters
        ----------
        panorama_url : str
            URL path to the panorama image (e.g. ``"/static/panoramas/room1.jpg"``).
        config : ViewerConfig, optional
            Viewer configuration. Uses defaults if not provided.
        pannellum_base_url : str
            Base URL where Pannellum assets (JS, CSS) are served.

        Returns
        -------
        str
            Complete HTML page string.
        """
        config = config or ViewerConfig()
        return self._build_html(
            panorama_src=panorama_url,
            css_path=f"{pannellum_base_url}/pannellum.css",
            js_pannellum_path=f"{pannellum_base_url}/pannellum.js",
            js_lib_path=f"{pannellum_base_url}/libpannellum.js",
            config=config,
        )

    def get_viewer_div(
        self,
        panorama_url: str,
        viewer_id: str = "panorama",
        config: Optional[ViewerConfig] = None,
        pannellum_base_url: str = "/static/pannellum",
    ) -> str:
        """Return just the ``<div>`` + ``<script>`` for embedding in a page.

        Useful when the parent app already includes Pannellum CSS/JS
        in its layout template.

        Parameters
        ----------
        panorama_url : str
            URL path to the panorama image.
        viewer_id : str
            DOM element ID for the viewer div.
        config : ViewerConfig, optional
            Viewer configuration.
        pannellum_base_url : str
            Base URL where Pannellum assets are served.

        Returns
        -------
        str
            HTML fragment (div + init script).
        """
        config = config or ViewerConfig()
        return self._build_viewer_fragment(panorama_url, viewer_id, config)

    def save_viewer(
        self,
        panorama_path: str | Path,
        output_html_path: str | Path,
        config: Optional[ViewerConfig] = None,
    ) -> Path:
        """Save a self-contained viewer HTML with all assets.

        Copies Pannellum JS/CSS/images and the panorama image into
        the output directory so the viewer works without a server.

        Parameters
        ----------
        panorama_path : str or Path
            Path to the equirectangular panorama image on disk.
        output_html_path : str or Path
            Destination path for the HTML file.
        config : ViewerConfig, optional
            Viewer configuration.

        Returns
        -------
        Path
            Absolute path to the generated HTML file.
        """
        panorama_path = Path(panorama_path).resolve()
        output_html_path = Path(output_html_path).resolve()
        config = config or ViewerConfig()

        if not panorama_path.is_file():
            raise FileNotFoundError(f"Panorama image not found: {panorama_path}")

        output_dir = output_html_path.parent
        output_dir.mkdir(parents=True, exist_ok=True)

        # Copy Pannellum assets
        assets_dir = output_dir / "pannellum"
        self._copy_pannellum_assets(assets_dir)

        # Copy panorama image
        pano_dest = output_dir / panorama_path.name
        if pano_dest.resolve() != panorama_path.resolve():
            shutil.copy2(panorama_path, pano_dest)

        # Generate HTML
        html = self._build_html(
            panorama_src=panorama_path.name,
            css_path="pannellum/pannellum.css",
            js_pannellum_path="pannellum/pannellum.js",
            js_lib_path="pannellum/libpannellum.js",
            config=config,
        )

        output_html_path.write_text(html, encoding="utf-8")
        logger.info("Viewer saved to %s", output_html_path)
        return output_html_path

    def get_pannellum_assets_dir(self) -> Path:
        """Return the path to the Pannellum source assets.

        Useful for the parent app to serve static files, e.g.::

            app.mount("/static/pannellum", StaticFiles(directory=viewer.get_pannellum_assets_dir()))
        """
        return self.pannellum_dir / "src"

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    def _copy_pannellum_assets(self, dest_dir: Path) -> None:
        """Copy Pannellum JS, CSS, and image assets to *dest_dir*."""
        dest_dir.mkdir(parents=True, exist_ok=True)
        src_css = self.pannellum_dir / "src" / "css"
        src_js = self.pannellum_dir / "src" / "js"

        shutil.copy2(src_css / "pannellum.css", dest_dir / "pannellum.css")

        img_src = src_css / "img"
        if img_src.is_dir():
            img_dest = dest_dir / "img"
            if img_dest.exists():
                shutil.rmtree(img_dest)
            shutil.copytree(img_src, img_dest)

        shutil.copy2(src_js / "pannellum.js", dest_dir / "pannellum.js")
        shutil.copy2(src_js / "libpannellum.js", dest_dir / "libpannellum.js")

    @staticmethod
    def _build_viewer_fragment(
        panorama_src: str,
        viewer_id: str,
        config: ViewerConfig,
    ) -> str:
        """Build just the div + initialisation script."""
        author_line = f'"author": "{config.author}",' if config.author else ""

        return f"""<div id="{viewer_id}" style="width:100%;height:100%;"></div>
<script>
pannellum.viewer('{viewer_id}', {{
    "type": "equirectangular",
    "panorama": "{panorama_src}",
    "title": "{config.title}",
    {author_line}
    "autoLoad": {str(config.auto_load).lower()},
    "autoRotate": {config.auto_rotate},
    "hfov": {config.hfov},
    "minHfov": {config.min_hfov},
    "maxHfov": {config.max_hfov},
    "compass": {str(config.compass).lower()},
    "showZoomCtrl": {str(config.show_zoom).lower()},
    "showFullscreenCtrl": {str(config.show_fullscreen).lower()},
    "mouseZoom": true,
    "keyboardZoom": true,
    "draggable": {str(config.draggable).lower()},
    "friction": {config.friction},
    "yaw": {config.default_yaw},
    "pitch": {config.default_pitch}
}});
</script>"""

    @staticmethod
    def _build_html(
        panorama_src: str,
        css_path: str,
        js_pannellum_path: str,
        js_lib_path: str,
        config: ViewerConfig,
    ) -> str:
        """Build a complete HTML page."""
        author_line = f'"author": "{config.author}",' if config.author else ""

        return f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{config.title}</title>
    <link rel="stylesheet" href="{css_path}">
    <style>
        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
        html, body {{ width: 100%; height: 100%; overflow: hidden; background: #000; }}
        #panorama {{ width: 100vw; height: 100vh; }}
    </style>
</head>
<body>
    <div id="panorama"></div>
    <script src="{js_lib_path}"></script>
    <script src="{js_pannellum_path}"></script>
    <script>
        pannellum.viewer('panorama', {{
            "type": "equirectangular",
            "panorama": "{panorama_src}",
            "title": "{config.title}",
            {author_line}
            "autoLoad": {str(config.auto_load).lower()},
            "autoRotate": {config.auto_rotate},
            "hfov": {config.hfov},
            "minHfov": {config.min_hfov},
            "maxHfov": {config.max_hfov},
            "compass": {str(config.compass).lower()},
            "showZoomCtrl": {str(config.show_zoom).lower()},
            "showFullscreenCtrl": {str(config.show_fullscreen).lower()},
            "mouseZoom": true,
            "keyboardZoom": true,
            "draggable": {str(config.draggable).lower()},
            "friction": {config.friction},
            "yaw": {config.default_yaw},
            "pitch": {config.default_pitch}
        }});
    </script>
</body>
</html>"""
