from pydantic import BaseModel
from typing import Optional

class SourcedItem(BaseModel):
    name: str
    price: str
    url: str
    design_source: Optional[str] = None
