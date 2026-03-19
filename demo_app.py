import os
import shutil
from pathlib import Path
import uvicorn
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from panorama_backend.router import router as studio_router

def setup_demo():
    # 1. Load environment variables from .env
    env_file = Path('.env')
    if env_file.exists():
        with open(env_file, 'r') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    k, v = line.split('=', 1)
                    if k in ['GOOGLE_API_KEY', 'GEMINI_API_KEY']:
                        os.environ[k] = v.strip().strip('"\'')

    # 2. Setup static directory for Pannellum
    static_dir = Path("demo_static")
    static_dir.mkdir(exist_ok=True)
    pannellum_static = static_dir / "pannellum"
    pannellum_static.mkdir(exist_ok=True)

    src_css = Path("pannellum-2.5.7/src/css")
    src_js = Path("pannellum-2.5.7/src/js")

    if src_css.exists() and src_js.exists():
        shutil.copy2(src_css / "pannellum.css", pannellum_static / "pannellum.css")
        if (src_css / "img").exists():
            shutil.copytree(src_css / "img", pannellum_static / "img", dirs_exist_ok=True)
        shutil.copy2(src_js / "pannellum.js", pannellum_static / "pannellum.js")
        shutil.copy2(src_js / "libpannellum.js", pannellum_static / "libpannellum.js")
    
    Path("storage/designs").mkdir(parents=True, exist_ok=True)
    return str(pannellum_static)

app = FastAPI()
pano_static_path = setup_demo()

# Mount storage so images are accessible. 
# image_path is "designs/{id}/versions/{v}.jpg"
# We mount "/" so that "/designs" works as expected.
app.mount("/designs", StaticFiles(directory="storage/designs"), name="designs")
app.mount("/static/pannellum", StaticFiles(directory=pano_static_path), name="pannellum")

app.include_router(studio_router)

if __name__ == "__main__":
    import threading
    import time
    import webbrowser

    def open_browser():
        time.sleep(2)
        webbrowser.open("http://localhost:8001/api/studio")

    print("\n--- 360° Design Studio Demo (Port 8001) ---")
    threading.Thread(target=open_browser, daemon=True).start()
    uvicorn.run(app, host="0.0.0.0", port=8001)
