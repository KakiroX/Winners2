import logging
from typing import List, Dict

logger = logging.getLogger(__name__)

class BOMManager:
    """Consolidated logic for aggregating project-wide Bill of Materials."""
    
    @staticmethod
    def aggregate_total_bom(designs_list: list, storage_instance) -> List[Dict]:
        """Aggregate BOM from the current version of all provided designs."""
        total_bom = []
        for design in designs_list:
            if not design.current_version_id:
                continue
            version = storage_instance.get_version(design.id, design.current_version_id)
            if version and version.bom:
                for item in version.bom:
                    item_copy = item.copy()
                    item_copy["design_source"] = design.name
                    total_bom.append(item_copy)
        return total_bom
