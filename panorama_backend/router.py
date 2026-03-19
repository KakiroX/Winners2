from fastapi import APIRouter, HTTPException, BackgroundTasks
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from typing import List, Optional
import os
from PIL import Image

from .storage import DesignStorage, HotspotDef
from .studio import StudioManager
from .panorama_generator import PanoramaGenerator

router = APIRouter(prefix="/api", tags=["panorama_studio"])
storage = DesignStorage()
studio = StudioManager()

# We lazily initialize the generator so we don't crash on import if API keys are missing
_generator = None
def get_generator():
    global _generator
    if _generator is None:
        _generator = PanoramaGenerator()
    return _generator


class DesignCreate(BaseModel):
    name: str

class HotspotInput(BaseModel):
    id: str
    pitch: float
    yaw: float
    text: str
    properties: dict

class EditRequest(BaseModel):
    base_version_id: str
    hotspot: HotspotInput
    prompt: str

class GenerateRequest(BaseModel):
    prompt: str


@router.get("/studio", response_class=HTMLResponse)
def get_studio_ui():
    """Returns the standalone interactive editor HTML."""
    return studio.generate_studio_html(pannellum_base_url="/static/pannellum")


@router.get("/designs")
def list_designs():
    """Returns all designs (S3-like storage buckets)."""
    return [d.to_dict() for d in storage.list_designs()]


@router.post("/designs")
def create_design(data: DesignCreate):
    """Creates a new design bucket."""
    design = storage.create_design(data.name)
    return design.to_dict()


@router.get("/designs/{design_id}")
def get_design(design_id: str):
    design = storage.get_design(design_id)
    if not design:
        raise HTTPException(status_code=404, detail="Design not found")
    return design.to_dict()

@router.delete("/designs/{design_id}")
def delete_design(design_id: str):
    storage.delete_design(design_id)
    return {"status": "deleted"}

@router.get("/bom/total")
def get_total_bom():
    return storage.get_total_bom()


@router.post("/designs/{design_id}/generate")
def generate_design(design_id: str, request: GenerateRequest):
    """Generates the initial panorama for a design with passive BOM sourcing."""
    design = storage.get_design(design_id)
    if not design:
        raise HTTPException(status_code=404, detail="Design not found")

    try:
        generator = get_generator()
        result = generator.generate(scene_description=request.prompt)

        temp_path = "temp_gen.jpg"
        result.save(temp_path)
        
        # Passive furniture detection
        bom = generator.detect_and_source_furniture(result.image)

        new_version = storage.save_version(
            design_id=design_id,
            image_path=temp_path,
            prompt_used=request.prompt,
            hotspots=[],
            bom=bom
        )
        
        if os.path.exists(temp_path):
            os.remove(temp_path)

        return new_version.to_dict()
    except Exception as e:
        import traceback; traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/designs/{design_id}/edit")
def edit_design(design_id: str, request: EditRequest):
    """Edits the panorama and updates the BOM passively."""
    design = storage.get_design(design_id)
    if not design:
        raise HTTPException(status_code=404, detail="Design not found")

    base_version = storage.get_version(design_id, request.base_version_id)
    if not base_version:
        raise HTTPException(status_code=404, detail="Base version not found")

    # Reconstruct hotspots
    new_hotspots = []
    found = False
    new_hs_def = HotspotDef(
        id=request.hotspot.id,
        pitch=request.hotspot.pitch,
        yaw=request.hotspot.yaw,
        text=request.hotspot.text,
        properties=request.hotspot.properties
    )
    for hs in base_version.hotspots:
        if hs.id == request.hotspot.id:
            new_hotspots.append(new_hs_def); found = True
        else:
            new_hotspots.append(hs)
    if not found: new_hotspots.append(new_hs_def)

    try:
        full_image_path = storage.base_dir.parent / base_version.image_path
        with Image.open(full_image_path) as img:
            generator = get_generator()
            result = generator.edit(
                panorama=img,
                modification_request=request.prompt,
                pitch=request.hotspot.pitch,
                yaw=request.hotspot.yaw
            )

        temp_path = "temp_edit.jpg"
        result.save(temp_path)
        
        # Passive furniture detection on the new image
        bom = generator.detect_and_source_furniture(result.image)

        new_version = storage.save_version(
            design_id=design_id,
            image_path=temp_path,
            prompt_used=request.prompt,
            hotspots=new_hotspots,
            bom=bom
        )
        
        if os.path.exists(temp_path):
            os.remove(temp_path)

        return new_version.to_dict()
    except Exception as e:
        import traceback; traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
