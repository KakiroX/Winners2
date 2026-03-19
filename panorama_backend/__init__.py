"""
Panorama Backend Module
=======================

AI-generated equirectangular panoramas and interactive 360° viewing.

Components:
    - ``PanoramaGenerator`` — Generate/edit panoramas using Gemini Nano Banana Pro
    - ``PanoramaViewer`` — 360° viewer powered by Pannellum 2.5.7
    - ``WalkthroughManager`` — Multi-room navigation with Street View-like controls
    - ``ViewerConfig`` — Viewer display configuration
    - ``Room``, ``Hotspot``, ``Walkthrough`` — Data models for walkthroughs
"""

from .panorama_generator import PanoramaGenerator, PanoramaResult, ChatSession
from .panorama_viewer import PanoramaViewer, ViewerConfig
from .walkthrough import WalkthroughManager, Room, Hotspot, Walkthrough

__all__ = [
    "PanoramaGenerator",
    "PanoramaResult",
    "ChatSession",
    "PanoramaViewer",
    "ViewerConfig",
    "WalkthroughManager",
    "Room",
    "Hotspot",
    "Walkthrough",
]
__version__ = "1.0.0"
