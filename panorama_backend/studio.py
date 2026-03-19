import json
from pathlib import Path
from typing import Optional

from .storage import DesignStorage
from .panorama_viewer import PANNELLUM_DIR, ViewerConfig

html_template = """<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>360° Design Studio</title>
    <link rel="stylesheet" href="PANNELLUM_BASE_URL/pannellum.css">
    <style>
        :root {
            --bg-color: #1e1e1e;
            --panel-bg: #2d2d2d;
            --text-color: #f0f0f0;
            --accent: #4a90e2;
            --border: #444;
        }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: var(--bg-color);
            color: var(--text-color);
            display: flex;
            height: 100vh;
            overflow: hidden;
        }
        /* Layout */
        #left-panel { width: 250px; background: var(--panel-bg); border-right: 1px solid var(--border); display: flex; flex-direction: column; }
        #center-panel { flex: 1; position: relative; }
        #right-panel { width: 300px; background: var(--panel-bg); border-left: 1px solid var(--border); display: flex; flex-direction: column; transform: translateX(100%); transition: transform 0.3s ease; position: absolute; right: 0; top: 0; bottom: 0; z-index: 10; }
        #right-panel.open { transform: translateX(0); }
        
        #panorama { width: 100%; height: 100%; }
        
        /* UI Components */
        .header { padding: 15px; border-bottom: 1px solid var(--border); font-weight: bold; background: #252525; }
        .content { padding: 15px; overflow-y: auto; flex: 1; }
        
        .design-item, .version-item { padding: 10px; cursor: pointer; border-radius: 4px; margin-bottom: 5px; }
        .design-item:hover, .version-item:hover { background: #3d3d3d; }
        .active { background: var(--accent) !important; color: white; }
        
        button {
            background: var(--accent); color: white; border: none; padding: 8px 12px; border-radius: 4px; cursor: pointer; width: 100%; margin-top: 10px;
        }
        button:hover { background: #357abd; }
        input, select, textarea {
            width: 100%; padding: 8px; margin-top: 5px; margin-bottom: 15px; background: #1a1a1a; border: 1px solid var(--border); color: white; border-radius: 4px;
        }
        
        .furniture-hotspot {
            width: 24px; height: 24px; background: rgba(74, 144, 226, 0.8); border: 2px solid white; border-radius: 50%; cursor: pointer;
            box-shadow: 0 0 10px rgba(0,0,0,0.5); transition: transform 0.2s;
        }
        .furniture-hotspot:hover { transform: scale(1.2); }
        
        #loading {
            position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: none; justify-content: center; align-items: center; z-index: 20; flex-direction: column;
        }
        .spinner { width: 40px; height: 40px; border: 4px solid #f3f3f3; border-top: 4px solid var(--accent); border-radius: 50%; animation: spin 1s linear infinite; margin-bottom: 10px; }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    </style>
</head>
<body>
    <div id="left-panel">
        <div class="header">Designs (S3 Bucket)</div>
        <div class="content" id="design-list">
            <!-- Populated by JS -->
        </div>
        <div style="padding: 15px; border-top: 1px solid var(--border);">
            <input type="text" id="new-design-name" placeholder="New Design Name">
            <button onclick="createDesign()">Create Design</button>
        </div>
    </div>
    
    <div id="center-panel">
        <div id="panorama"></div>
        <div id="loading">
            <div class="spinner"></div>
            <div>Generating...</div>
        </div>
    </div>
    
    <div id="right-panel">
        <div class="header" id="right-panel-title">Edit Furniture</div>
        <div class="content">
            <input type="hidden" id="edit-pitch">
            <input type="hidden" id="edit-yaw">
            <input type="hidden" id="edit-hotspot-id">
            
            <label>Item Type</label>
            <input type="text" id="edit-type" placeholder="e.g. Sofa, Plant, Table">
            
            <label>Material / Style</label>
            <input type="text" id="edit-material" placeholder="e.g. Leather, Wood">
            
            <label>Color</label>
            <input type="text" id="edit-color" placeholder="e.g. Red, Dark Oak">
            
            <label>Custom Instruction</label>
            <textarea id="edit-prompt" rows="3" placeholder="Change the item to..."></textarea>
            
            <button onclick="applyEdit()">Apply Changes</button>
            <button onclick="closeRightPanel()" style="background: #555;">Cancel</button>
        </div>
    </div>

    <script src="PANNELLUM_BASE_URL/libpannellum.js"></script>
    <script src="PANNELLUM_BASE_URL/pannellum.js"></script>
    <script>
        let viewer = null;
        let currentDesignId = null;
        let currentVersionId = null;
        let designs = [];
        let currentHotspots = [];

        // API Base URL (adjust if running on a different port)
        const API_BASE = window.location.origin + '/api';

        async function init() {
            await loadDesigns();
        }

        async function loadDesigns() {
            try {
                const res = await fetch(`${API_BASE}/designs`);
                designs = await res.json();
                renderDesignList();
            } catch (e) { console.error("Failed to load designs", e); }
        }

        function renderDesignList() {
            const list = document.getElementById('design-list');
            list.innerHTML = '';
            
            designs.forEach(d => {
                const div = document.createElement('div');
                div.className = `design-item ${d.id === currentDesignId ? 'active' : ''}`;
                div.innerHTML = `<strong>${d.name}</strong><br><small>${d.versions.length} versions</small>`;
                div.onclick = () => selectDesign(d);
                list.appendChild(div);
                
                if (d.id === currentDesignId) {
                    const vList = document.createElement('div');
                    vList.style.paddingLeft = '15px';
                    d.versions.slice().reverse().forEach(v => {
                        const vDiv = document.createElement('div');
                        vDiv.className = `version-item ${v.id === currentVersionId ? 'active' : ''}`;
                        vDiv.innerText = `${v.id}`;
                        vDiv.onclick = (e) => { e.stopPropagation(); loadVersion(d.id, v); };
                        vList.appendChild(vDiv);
                    });
                    list.appendChild(vList);
                }
            });
        }

        async function createDesign() {
            const name = document.getElementById('new-design-name').value;
            if (!name) return;
            try {
                await fetch(`${API_BASE}/designs`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({name})
                });
                document.getElementById('new-design-name').value = '';
                await loadDesigns();
            } catch (e) { console.error(e); }
        }

        function selectDesign(design) {
            currentDesignId = design.id;
            if (design.versions.length > 0) {
                loadVersion(design.id, design.versions[design.versions.length - 1]);
            } else {
                currentVersionId = null;
                renderDesignList();
                if (viewer) viewer.destroy();
                viewer = null;

                const center = document.getElementById('center-panel');
                let promptBox = document.getElementById('initial-prompt-box');
                if (!promptBox) {
                    promptBox = document.createElement('div');
                    promptBox.id = 'initial-prompt-box';
                    promptBox.style.position = 'absolute';
                    promptBox.style.top = '50%';
                    promptBox.style.left = '50%';
                    promptBox.style.transform = 'translate(-50%, -50%)';
                    promptBox.style.background = 'var(--panel-bg)';
                    promptBox.style.padding = '20px';
                    promptBox.style.borderRadius = '8px';
                    promptBox.style.zIndex = '5';
                    promptBox.style.width = '400px';
                    promptBox.innerHTML = `
                        <h3>Generate Initial Room</h3>
                        <p style="margin: 10px 0;">Describe the room you want to create:</p>
                        <textarea id="initial-prompt" rows="4" style="width: 100%; margin-bottom: 10px;"></textarea>
                        <button onclick="generateInitial()">Generate</button>
                    `;
                    center.appendChild(promptBox);
                } else {
                    promptBox.style.display = 'block';
                }
            }
        }

        async function generateInitial() {
            const prompt = document.getElementById('initial-prompt').value;
            if (!prompt) return;

            document.getElementById('initial-prompt-box').style.display = 'none';
            document.getElementById('loading').style.display = 'flex';

            try {
                await fetch(`${API_BASE}/designs/${currentDesignId}/generate`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({prompt})
                });
                await loadDesigns();
                const d = designs.find(x => x.id === currentDesignId);
                if (d) selectDesign(d);
            } catch (e) {
                console.error(e);
                alert('Generation failed.');
            } finally {
                document.getElementById('loading').style.display = 'none';
            }
        }

        function loadVersion(designId, version) {
            currentDesignId = designId;
            currentVersionId = version.id;
            renderDesignList();
            currentHotspots = version.hotspots || [];

            const promptBox = document.getElementById('initial-prompt-box');
            if (promptBox) promptBox.style.display = 'none';

            initViewer('/' + version.image_path, currentHotspots);
        }

        function initViewer(imageUrl, hotspots) {
            if (viewer) viewer.destroy();
            
            const hsConfig = hotspots.map(h => ({
                id: h.id,
                pitch: h.pitch,
                yaw: h.yaw,
                cssClass: 'furniture-hotspot',
                createTooltipArgs: h,
                createTooltipFunc: hotspotTooltip,
                clickHandlerFunc: onHotspotClick,
                clickHandlerArgs: h
            }));

            viewer = pannellum.viewer('panorama', {
                "type": "equirectangular",
                "panorama": imageUrl,
                "autoLoad": true,
                "compass": true,
                "hotSpots": hsConfig
            });
            
            viewer.on('mousedown', onPanoramaClick);
        }

        function hotspotTooltip(hotSpotDiv, args) {
            hotSpotDiv.classList.add('custom-tooltip');
            const span = document.createElement('span');
            span.innerHTML = args.text || args.type;
            span.style.position = 'absolute';
            span.style.top = '-25px';
            span.style.left = '50%';
            span.style.transform = 'translateX(-50%)';
            span.style.background = 'rgba(0,0,0,0.7)';
            span.style.color = 'white';
            span.style.padding = '2px 5px';
            span.style.borderRadius = '3px';
            span.style.whiteSpace = 'nowrap';
            span.style.display = 'none';
            hotSpotDiv.appendChild(span);
            
            hotSpotDiv.onmouseover = () => span.style.display = 'block';
            hotSpotDiv.onmouseout = () => span.style.display = 'none';
        }

        function onPanoramaClick(event) {
            // Ignore if clicking on a hotspot
            if (event.target.classList.contains('furniture-hotspot')) return;
            
            const coords = viewer.mouseEventToCoords(event);
            openRightPanel('add', coords[0], coords[1]);
        }

        function onHotspotClick(event, args) {
            openRightPanel('edit', args.pitch, args.yaw, args);
        }

        function openRightPanel(mode, pitch, yaw, hotspot = null) {
            const panel = document.getElementById('right-panel');
            document.getElementById('right-panel-title').innerText = mode === 'add' ? 'Add Furniture' : 'Edit Furniture';
            document.getElementById('edit-pitch').value = pitch;
            document.getElementById('edit-yaw').value = yaw;
            
            if (mode === 'edit' && hotspot) {
                document.getElementById('edit-hotspot-id').value = hotspot.id;
                document.getElementById('edit-type').value = hotspot.properties.type || hotspot.text || '';
                document.getElementById('edit-material').value = hotspot.properties.material || '';
                document.getElementById('edit-color').value = hotspot.properties.color || '';
                document.getElementById('edit-prompt').value = '';
            } else {
                document.getElementById('edit-hotspot-id').value = '';
                document.getElementById('edit-type').value = '';
                document.getElementById('edit-material').value = '';
                document.getElementById('edit-color').value = '';
                document.getElementById('edit-prompt').value = '';
            }
            
            panel.classList.add('open');
        }

        function closeRightPanel() {
            document.getElementById('right-panel').classList.remove('open');
        }

        async function applyEdit() {
            if (!currentDesignId || !currentVersionId) return alert('No active design version.');
            
            const pitch = parseFloat(document.getElementById('edit-pitch').value);
            const yaw = parseFloat(document.getElementById('edit-yaw').value);
            const hsId = document.getElementById('edit-hotspot-id').value;
            const type = document.getElementById('edit-type').value;
            const material = document.getElementById('edit-material').value;
            const color = document.getElementById('edit-color').value;
            const customPrompt = document.getElementById('edit-prompt').value;
            
            let action = hsId ? "Change the existing" : "Add a new";
            let desc = `${color} ${material} ${type}`.trim() || "item";
            let prompt = customPrompt || `${action} ${desc} at this location.`;

            closeRightPanel();
            document.getElementById('loading').style.display = 'flex';

            const payload = {
                base_version_id: currentVersionId,
                hotspot: {
                    id: hsId || `hs_${Math.random().toString(36).substr(2, 9)}`,
                    pitch: pitch,
                    yaw: yaw,
                    text: type,
                    properties: { type, material, color }
                },
                prompt: prompt
            };

            try {
                await fetch(`${API_BASE}/designs/${currentDesignId}/edit`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify(payload)
                });
                await loadDesigns();
            } catch (e) {
                console.error(e);
                alert('Edit failed.');
            } finally {
                document.getElementById('loading').style.display = 'none';
            }
        }

        window.onload = init;
    </script>
</body>
</html>"""


class StudioManager:
    """Generates the interactive design studio UI."""

    def __init__(self, pannellum_dir: Optional[str | Path] = None):
        self._pannellum_dir = Path(pannellum_dir) if pannellum_dir else PANNELLUM_DIR

    def generate_studio_html(self, pannellum_base_url: str = "/static/pannellum") -> str:
        """Generate the standalone HTML page for the interactive editor.
        
        This HTML expects the host application to provide the following API endpoints:
        - GET /api/designs -> List designs
        - POST /api/designs -> Create design (body: {name})
        - GET /api/designs/{id} -> Get design details (versions)
        - POST /api/designs/{id}/edit -> Edit image (body: {hotspot, prompt, base_version_id})
        - POST /api/designs/{id}/generate -> Generate initial panorama (body: {prompt})
        """
        return html_template.replace("PANNELLUM_BASE_URL", pannellum_base_url)
