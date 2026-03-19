import os
from pathlib import Path
from panorama_backend.panorama_generator import PanoramaGenerator
from panorama_backend.panorama_viewer import PanoramaViewer

def main():
    env_file = Path('.env')
    if env_file.exists():
        with open(env_file, 'r') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#'):
                    if '=' in line:
                        key, val = line.split('=', 1)
                        if key in ['GOOGLE_API_KEY', 'GEMINI_API_KEY']:
                            os.environ[key] = val.strip().strip('"\'')

    print("Initializing generator...")
    generator = PanoramaGenerator()
    
    print("Generating panorama...")
    prompt = "a spacious office building with many cubicles"
    result = generator.generate(scene_description=prompt)
    
    print("Saving panorama image...")
    img_path = result.save("office_panorama.jpg")
    
    print("Creating HTML viewer...")
    viewer = PanoramaViewer()
    html_path = "preview.html"
    viewer.save_viewer(panorama_path=img_path, output_html_path=html_path)
    
    print(f"Success! Viewer saved to {html_path}")

if __name__ == "__main__":
    main()
