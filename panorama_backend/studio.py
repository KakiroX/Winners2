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
            --danger: #e74c3c;
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
        #left-panel { width: 280px; background: var(--panel-bg); border-right: 1px solid var(--border); display: flex; flex-direction: column; }
        #center-panel { flex: 1; position: relative; }
        
        #right-panel { 
            width: 320px; 
            background: var(--panel-bg); 
            border: 1px solid var(--border); 
            display: none; 
            flex-direction: column; 
            position: absolute; 
            z-index: 100; 
            border-radius: 8px;
            box-shadow: 0 10px 25px rgba(0,0,0,0.5);
        }
        #right-panel.open { display: flex; }
        
        #panorama { width: 100%; height: 100%; }
        .header { padding: 15px; border-bottom: 1px solid var(--border); font-weight: bold; background: #252525; display: flex; justify-content: space-between; align-items: center; }
        .content { padding: 15px; overflow-y: auto; flex: 1; }
        
        .design-item { padding: 10px; cursor: pointer; border-radius: 4px; margin-bottom: 5px; position: relative; }
        .design-item:hover { background: #3d3d3d; }
        .design-item.active { background: var(--accent); color: white; }
        .delete-btn { color: #888; cursor: pointer; padding: 5px; font-size: 12px; }
        .delete-btn:hover { color: var(--danger); }
        
        .version-item { padding: 8px; cursor: pointer; border-radius: 4px; margin-bottom: 3px; font-size: 13px; opacity: 0.8; }
        .version-item:hover { background: #444; opacity: 1; }
        .version-item.active { border-left: 3px solid white; background: #555; opacity: 1; }
        
        button {
            background: var(--accent); color: white; border: none; padding: 10px 12px; border-radius: 4px; cursor: pointer; width: 100%; margin-top: 10px; font-weight: bold;
        }
        button:hover { background: #357abd; }
        button.secondary { background: #555; }
        button.danger { background: var(--danger); }
        
        input, textarea {
            width: 100%; padding: 10px; margin-top: 10px; margin-bottom: 15px; background: #1a1a1a; border: 1px solid var(--border); color: white; border-radius: 4px; font-size: 14px;
        }
        
        .furniture-hotspot {
            width: 30px; height: 30px; background: rgba(74, 144, 226, 0.4); border: 2px solid white; border-radius: 50%; cursor: pointer;
            box-shadow: 0 0 10px rgba(0,0,0,0.5); transition: all 0.2s;
        }
        .furniture-hotspot:hover { transform: scale(1.2); background: rgba(74, 144, 226, 0.8); }
        
        #loading {
            position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: none; justify-content: center; align-items: center; z-index: 200; flex-direction: column;
        }
        .spinner { width: 40px; height: 40px; border: 4px solid #f3f3f3; border-top: 4px solid var(--accent); border-radius: 50%; animation: spin 1s linear infinite; margin-bottom: 10px; }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }

        /* BOM Modal */
        #bom-modal {
            position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
            width: 600px; max-height: 80vh; background: var(--panel-bg); border: 1px solid var(--border);
            border-radius: 12px; z-index: 300; display: none; flex-direction: column;
            box-shadow: 0 20px 50px rgba(0,0,0,0.8);
        }
        #bom-modal.open { display: flex; }
        .bom-table { width: 100%; border-collapse: collapse; margin-top: 10px; }
        .bom-table th, .bom-table td { padding: 12px; text-align: left; border-bottom: 1px solid var(--border); }
        .bom-table th { background: #252525; }
        .bom-link { color: var(--accent); text-decoration: none; font-size: 12px; }
        .bom-link:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <div id="left-panel">
        <div class="header">
            <span>Designs History</span>
        </div>
        <div class="content" id="design-list"></div>
        <div style="padding: 15px; border-top: 1px solid var(--border);">
            <button onclick="showTotalBOM()" style="background: #27ae60; margin-bottom: 15px;">Project Bill of Materials (Total)</button>
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
            <p style="font-size: 14px; opacity: 0.8;">What would you like to change or add here?</p>
            <textarea id="edit-prompt" rows="5" placeholder="e.g. Change this sofa to a red leather one..."></textarea>
            <button onclick="applyEdit()">Apply Change</button>
            <button onclick="closeRightPanel()" class="secondary">Cancel</button>
        </div>
    </div>

    <div id="bom-modal">
        <div class="header">
            <span id="bom-title">Bill of Materials</span>
            <span onclick="closeBOM()" style="cursor:pointer">&times; Close</span>
        </div>
        <div class="content" id="bom-content">
            <!-- BOM Table -->
        </div>
    </div>

    <script src="PANNELLUM_BASE_URL/libpannellum.js"></script>
    <script src="PANNELLUM_BASE_URL/pannellum.js"></script>
    <script>
        let viewer = null;
        let currentDesignId = null;
        let currentVersionId = null;
        let designs = [];
        let currentBOM = [];
        let selectionMarker = null;

        const API_BASE = window.location.origin + '/api';

        async function init() { await loadDesigns(); }

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
                div.innerHTML = `
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <strong onclick="selectDesignById('${d.id}')">${d.name}</strong>
                        <span class="delete-btn" onclick="deleteDesign('${d.id}', event)">Delete</span>
                    </div>
                    <small>${d.versions.length} versions</small>
                `;
                list.appendChild(div);
                
                if (d.id === currentDesignId) {
                    const vList = document.createElement('div');
                    vList.style.paddingLeft = '15px';
                    vList.style.marginTop = '10px';
                    d.versions.slice().reverse().forEach(v => {
                        const vDiv = document.createElement('div');
                        vDiv.className = `version-item ${v.id === currentVersionId ? 'active' : ''}`;
                        vDiv.innerHTML = `Version ${v.id.split('_')[0]}`;
                        vDiv.onclick = (e) => { e.stopPropagation(); loadVersion(d.id, v); };
                        vList.appendChild(vDiv);
                    });
                    list.appendChild(vList);
                    
                    if (currentVersionId) {
                        const bomBtn = document.createElement('button');
                        bomBtn.innerText = "View Room BOM";
                        bomBtn.style.padding = "5px";
                        bomBtn.style.fontSize = "12px";
                        bomBtn.onclick = () => showRoomBOM();
                        vList.appendChild(bomBtn);
                    }
                }
            });
        }

        async function deleteDesign(id, e) {
            e.stopPropagation();
            if (!confirm("Delete this design?")) return;
            await fetch(`${API_BASE}/designs/${id}`, { method: 'DELETE' });
            if (currentDesignId === id) currentDesignId = null;
            await loadDesigns();
        }

        function selectDesignById(id) {
            const d = designs.find(x => x.id === id);
            if (d) selectDesign(d);
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
            } else { box.style.display = 'block'; }
        }

        async function generateInitial() {
            const prompt = document.getElementById('initial-prompt').value;
            if (!prompt) return;
            document.getElementById('initial-prompt-box').style.display = 'none';
            document.getElementById('loading').style.display = 'flex';
            document.getElementById('loading-text').innerText = "Generating & Sourcing Furniture...";
            try {
                await fetch(`${API_BASE}/designs/${currentDesignId}/generate`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({prompt})
                });
                await loadDesigns();
                const d = designs.find(x => x.id === currentDesignId);
                if (d) selectDesign(d);
            } catch (e) { alert('Failed to generate.'); }
            finally { document.getElementById('loading').style.display = 'none'; }
        }

        function loadVersion(designId, version) {
            currentDesignId = designId;
            currentVersionId = version.id;
            currentBOM = version.bom || [];
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
                clickHandlerFunc: (e, a) => openRightPanel(a.pitch, a.yaw, e.clientX, e.clientY, a.id, a.properties.prompt)
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
            openRightPanel(coords[0], coords[1], event.clientX, event.clientY);
        }

        function openRightPanel(pitch, yaw, x, y, id = '', prompt = '') {
            document.getElementById('edit-pitch').value = pitch;
            document.getElementById('edit-yaw').value = yaw;
            document.getElementById('edit-hotspot-id').value = id;
            document.getElementById('edit-prompt').value = prompt;
            const p = document.getElementById('right-panel');
            p.style.left = Math.min(x + 20, window.innerWidth - 340) + 'px';
            p.style.top = Math.min(y + 20, window.innerHeight - 280) + 'px';
            p.classList.add('open');
            setTimeout(() => document.getElementById('edit-prompt').focus(), 100);
        }

        function closeRightPanel() {
            document.getElementById('right-panel').classList.remove('open');
            if (selectionMarker) { viewer.removeHotSpot(selectionMarker); selectionMarker = null; }
        }

        async function applyEdit() {
            const prompt = document.getElementById('edit-prompt').value;
            if (!prompt) return alert('Prompt required');
            const payload = {
                base_version_id: currentVersionId, prompt: prompt,
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
            document.getElementById('loading-text').innerText = "Updating Room & BOM...";
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

        function showRoomBOM() {
            renderBOM(currentBOM, `Room BOM - ${designs.find(x=>x.id===currentDesignId).name}`);
        }

        async function showTotalBOM() {
            const res = await fetch(`${API_BASE}/bom/total`);
            const totalBOM = await res.json();
            renderBOM(totalBOM, "Total Project Bill of Materials");
        }

        function renderBOM(items, title) {
            document.getElementById('bom-title').innerText = title;
            const content = document.getElementById('bom-content');
            if (items.length === 0) {
                content.innerHTML = "<p>No furniture items detected yet.</p>";
            } else {
                let html = `<table class="bom-table">
                    <tr><th>Item</th><th>Estimate</th>${items[0].design_source ? '<th>Room</th>' : ''}<th>Link</th></tr>`;
                items.forEach(i => {
                    html += `<tr>
                        <td>${i.name}</td>
                        <td>${i.price}</td>
                        ${i.design_source ? `<td>${i.design_source}</td>` : ''}
                        <td><a href="${i.url}" target="_blank" class="bom-link">View Item</a></td>
                    </tr>`;
                });
                html += "</table>";
                content.innerHTML = html;
            }
            document.getElementById('bom-modal').classList.add('open');
        }

        function closeBOM() { document.getElementById('bom-modal').classList.remove('open'); }

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
