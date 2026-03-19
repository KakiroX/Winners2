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
        #left-panel { width: 250px; background: var(--panel-bg); border-right: 1px solid var(--border); display: flex; flex-direction: column; }
        #center-panel { flex: 1; position: relative; }
        #right-panel { width: 320px; background: var(--panel-bg); border-left: 1px solid var(--border); display: flex; flex-direction: column; transform: translateX(100%); transition: transform 0.3s ease; position: absolute; right: 0; top: 0; bottom: 0; z-index: 10; }
        #right-panel.open { transform: translateX(0); }
        
        #panorama { width: 100%; height: 100%; }
        .header { padding: 15px; border-bottom: 1px solid var(--border); font-weight: bold; background: #252525; }
        .content { padding: 15px; overflow-y: auto; flex: 1; }
        
        .design-item, .version-item { padding: 10px; cursor: pointer; border-radius: 4px; margin-bottom: 5px; }
        .design-item:hover, .version-item:hover { background: #3d3d3d; }
        .active { background: var(--accent) !important; color: white; }
        
        button {
            background: var(--accent); color: white; border: none; padding: 10px 12px; border-radius: 4px; cursor: pointer; width: 100%; margin-top: 10px; font-weight: bold;
        }
        button:hover { background: #357abd; }
        input, textarea {
            width: 100%; padding: 10px; margin-top: 10px; margin-bottom: 15px; background: #1a1a1a; border: 1px solid var(--border); color: white; border-radius: 4px; font-size: 14px;
        }
        
        .furniture-hotspot {
            width: 30px; height: 30px; background: rgba(74, 144, 226, 0.4); border: 2px solid white; border-radius: 50%; cursor: pointer;
            box-shadow: 0 0 10px rgba(0,0,0,0.5); transition: all 0.2s;
        }
        .furniture-hotspot:hover { transform: scale(1.2); background: rgba(74, 144, 226, 0.8); }
        
        #loading {
            position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: none; justify-content: center; align-items: center; z-index: 20; flex-direction: column;
        }
        .spinner { width: 40px; height: 40px; border: 4px solid #f3f3f3; border-top: 4px solid var(--accent); border-radius: 50%; animation: spin 1s linear infinite; margin-bottom: 10px; }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    </style>
</head>
<body>
    <div id="left-panel">
        <div class="header">Designs History</div>
        <div class="content" id="design-list"></div>
        <div style="padding: 15px; border-top: 1px solid var(--border);">
            <input type="text" id="new-design-name" placeholder="Room Name">
            <button onclick="createDesign()">New Design</button>
        </div>
    </div>
    
    <div id="center-panel">
        <div id="panorama"></div>
        <div id="loading">
            <div class="spinner"></div>
            <div id="loading-text">Processing...</div>
        </div>
    </div>
    
    <div id="right-panel">
        <div class="header">Edit Area</div>
        <div class="content">
            <input type="hidden" id="edit-pitch">
            <input type="hidden" id="edit-yaw">
            <input type="hidden" id="edit-hotspot-id">
            
            <p style="font-size: 14px; opacity: 0.8;">What would you like to change or add at this location?</p>
            <textarea id="edit-prompt" rows="6" placeholder="e.g. Change this sofa to a red leather one..."></textarea>
            
            <button onclick="applyEdit()">Apply Change</button>
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
        let selectionMarker = null;

        const API_BASE = window.location.origin + '/api';

        async function init() {
            await loadDesigns();
        }

        async function loadDesigns() {
            try {
                const res = await fetch(`${API_BASE}/designs`);
                designs = await res.json();
                renderDesignList();
            } catch (e) { console.error(e); }
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
                        vDiv.innerText = `Version ${v.id.split('_')[0]}`;
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
                const res = await fetch(`${API_BASE}/designs`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({name})
                });
                const d = await res.json();
                document.getElementById('new-design-name').value = '';
                await loadDesigns();
                selectDesign(d);
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
                showInitialPrompt();
            }
        }

        function showInitialPrompt() {
            const center = document.getElementById('center-panel');
            let box = document.getElementById('initial-prompt-box');
            if (!box) {
                box = document.createElement('div');
                box.id = 'initial-prompt-box';
                box.style = "position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); background:var(--panel-bg); padding:25px; border-radius:8px; z-index:5; width:400px; border:1px solid var(--border);";
                box.innerHTML = `
                    <h3 style="margin-bottom:10px;">Create your room</h3>
                    <textarea id="initial-prompt" rows="4" placeholder="e.g. A modern living room with large windows..."></textarea>
                    <button onclick="generateInitial()">Generate Panorama</button>
                `;
                center.appendChild(box);
            } else {
                box.style.display = 'block';
            }
        }

        async function generateInitial() {
            const prompt = document.getElementById('initial-prompt').value;
            if (!prompt) return;
            document.getElementById('initial-prompt-box').style.display = 'none';
            document.getElementById('loading').style.display = 'flex';
            document.getElementById('loading-text').innerText = "Generating initial scene...";
            try {
                await fetch(`${API_BASE}/designs/${currentDesignId}/generate`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({prompt})
                });
                await loadDesigns();
                const d = designs.find(x => x.id === currentDesignId);
                if (d) selectDesign(d);
            } catch (e) { console.error(e); alert('Failed to generate.'); }
            finally { document.getElementById('loading').style.display = 'none'; }
        }

        function loadVersion(designId, version) {
            currentDesignId = designId;
            currentVersionId = version.id;
            renderDesignList();
            if (document.getElementById('initial-prompt-box')) 
                document.getElementById('initial-prompt-box').style.display = 'none';
            initViewer('/' + version.image_path, version.hotspots || []);
        }

        function initViewer(imageUrl, hotspots) {
            if (viewer) viewer.destroy();
            const hsConfig = hotspots.map(h => ({
                id: h.id, pitch: h.pitch, yaw: h.yaw,
                cssClass: 'furniture-hotspot',
                clickHandlerFunc: (e, a) => openRightPanel(a.pitch, a.yaw, a.id, a.properties.prompt)
            }));

            viewer = pannellum.viewer('panorama', {
                "type": "equirectangular", "panorama": imageUrl,
                "autoLoad": true, "compass": true, "hotSpots": hsConfig
            });
            viewer.on('mousedown', onPanoramaClick);
        }

        function onPanoramaClick(event) {
            if (event.target.classList.contains('furniture-hotspot')) return;
            const coords = viewer.mouseEventToCoords(event);
            
            if (selectionMarker) viewer.removeHotSpot(selectionMarker);
            selectionMarker = 'sel_' + Date.now();
            viewer.addHotSpot({
                id: selectionMarker, pitch: coords[0], yaw: coords[1],
                cssClass: 'furniture-hotspot',
                attributes: { style: 'background:rgba(255,255,255,0.3); border-color:#fff;' }
            });
            openRightPanel(coords[0], coords[1]);
        }

        function openRightPanel(pitch, yaw, id = '', prompt = '') {
            document.getElementById('edit-pitch').value = pitch;
            document.getElementById('edit-yaw').value = yaw;
            document.getElementById('edit-hotspot-id').value = id;
            document.getElementById('edit-prompt').value = prompt;
            document.getElementById('right-panel').classList.add('open');
        }

        function closeRightPanel() {
            document.getElementById('right-panel').classList.remove('open');
            if (selectionMarker) { viewer.removeHotSpot(selectionMarker); selectionMarker = null; }
        }

        async function applyEdit() {
            const prompt = document.getElementById('edit-prompt').value;
            if (!prompt) return alert('Prompt required');

            const payload = {
                base_version_id: currentVersionId,
                prompt: prompt,
                hotspot: {
                    id: document.getElementById('edit-hotspot-id').value || 'hs_'+Math.random().toString(36).substr(2,9),
                    pitch: parseFloat(document.getElementById('edit-pitch').value),
                    yaw: parseFloat(document.getElementById('edit-yaw').value),
                    text: prompt.substring(0,20),
                    properties: { prompt }
                }
            };

            closeRightPanel();
            document.getElementById('loading').style.display = 'flex';
            document.getElementById('loading-text').innerText = "Applying surgical edit...";
            try {
                await fetch(`${API_BASE}/designs/${currentDesignId}/edit`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify(payload)
                });
                await loadDesigns();
                const d = designs.find(x => x.id === currentDesignId);
                if (d) selectDesign(d);
            } catch (e) { alert('Edit failed'); }
            finally { document.getElementById('loading').style.display = 'none'; }
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
        return html_template.replace("PANNELLUM_BASE_URL", pannellum_base_url)
