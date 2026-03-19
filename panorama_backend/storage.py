import json
import logging
import shutil
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

@dataclass
class HotspotDef:
    id: str
    pitch: float
    yaw: float
    type: str = "info"
    text: str = ""
    cssClass: str = ""
    properties: dict = field(default_factory=dict)

    def to_dict(self):
        return {
            "id": self.id,
            "pitch": self.pitch,
            "yaw": self.yaw,
            "type": self.type,
            "text": self.text,
            "cssClass": self.cssClass,
            "properties": self.properties,
        }

    @classmethod
    def from_dict(cls, data):
        return cls(**data)

@dataclass
class Version:
    id: str
    image_path: str
    created_at: float
    prompt_used: str = ""
    hotspots: list[HotspotDef] = field(default_factory=list)
    bom: list[dict] = field(default_factory=list)

    def to_dict(self):
        return {
            "id": self.id,
            "image_path": self.image_path,
            "created_at": self.created_at,
            "prompt_used": self.prompt_used,
            "hotspots": [h.to_dict() for h in self.hotspots],
            "bom": self.bom,
        }

    @classmethod
    def from_dict(cls, data):
        data["hotspots"] = [HotspotDef.from_dict(h) for h in data.get("hotspots", [])]
        return cls(**data)

@dataclass
class Design:
    id: str
    name: str
    created_at: float
    versions: list[Version] = field(default_factory=list)
    current_version_id: str = ""

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "created_at": self.created_at,
            "versions": [v.to_dict() for v in self.versions],
            "current_version_id": self.current_version_id,
        }

    @classmethod
    def from_dict(cls, data):
        data["versions"] = [Version.from_dict(v) for v in data.get("versions", [])]
        return cls(**data)

class DesignStorage:
    """S3-like storage abstraction for designs and their version history."""
    
    def __init__(self, base_dir: str | Path = "storage/designs"):
        self.base_dir = Path(base_dir).resolve()
        self.base_dir.mkdir(parents=True, exist_ok=True)
        
    def _get_design_dir(self, design_id: str) -> Path:
        return self.base_dir / design_id
        
    def _get_meta_path(self, design_id: str) -> Path:
        return self._get_design_dir(design_id) / "meta.json"

    def list_designs(self) -> list[Design]:
        designs = []
        for d in self.base_dir.iterdir():
            if d.is_dir() and (d / "meta.json").exists():
                with open(d / "meta.json", "r", encoding="utf-8") as f:
                    designs.append(Design.from_dict(json.load(f)))
        return sorted(designs, key=lambda x: x.created_at, reverse=True)

    def create_design(self, name: str) -> Design:
        import time
        design_id = uuid.uuid4().hex[:12]
        d_dir = self._get_design_dir(design_id)
        d_dir.mkdir(parents=True, exist_ok=True)
        
        design = Design(
            id=design_id,
            name=name,
            created_at=time.time(),
        )
        self._save_design(design)
        logger.info("Created design: %s (%s)", name, design_id)
        return design

    def _save_design(self, design: Design):
        meta_path = self._get_meta_path(design.id)
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump(design.to_dict(), f, indent=2)

    def delete_design(self, design_id: str):
        """Remove a design and all its files."""
        d_dir = self._get_design_dir(design_id)
        if d_dir.exists():
            shutil.rmtree(d_dir)
            logger.info("Deleted design: %s", design_id)

    def get_design(self, design_id: str) -> Optional[Design]:
        meta_path = self._get_meta_path(design_id)
        if not meta_path.exists():
            return None
        with open(meta_path, "r", encoding="utf-8") as f:
            return Design.from_dict(json.load(f))

    def save_version(
        self, 
        design_id: str, 
        image_path: str | Path, 
        prompt_used: str = "",
        hotspots: list[HotspotDef] = None,
        bom: list[dict] = None
    ) -> Version:
        import time
        design = self.get_design(design_id)
        if not design:
            raise ValueError(f"Design {design_id} not found")

        v_id = f"v{len(design.versions) + 1}_{uuid.uuid4().hex[:6]}"
        v_dir = self._get_design_dir(design_id) / "versions"
        v_dir.mkdir(parents=True, exist_ok=True)

        # Copy image to internal storage
        src_image = Path(image_path)
        dest_image = v_dir / f"{v_id}{src_image.suffix}"
        shutil.copy2(src_image, dest_image)

        version = Version(
            id=v_id,
            image_path=str(dest_image.relative_to(self.base_dir.parent)),
            created_at=time.time(),
            prompt_used=prompt_used,
            hotspots=hotspots or [],
            bom=bom or [],
        )

        design.versions.append(version)
        design.current_version_id = version.id
        self._save_design(design)
        
        logger.info("Saved version %s for design %s", v_id, design_id)
        return version

    def get_version(self, design_id: str, version_id: str) -> Optional[Version]:
        design = self.get_design(design_id)
        if not design:
            return None
        for v in design.versions:
            if v.id == version_id:
                return v
        return None
