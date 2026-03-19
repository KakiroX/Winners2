import os
from google import genai
from google.genai import types
from pathlib import Path
from PIL import Image

def main():
    env_file = Path('.env')
    if env_file.exists():
        with open(env_file, 'r') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    k, v = line.split('=', 1)
                    if k in ['GOOGLE_API_KEY', 'GEMINI_API_KEY']:
                        os.environ[k] = v.strip().strip('"\'')

    client = genai.Client()
    
    try:
        print("Testing gemini-3-pro-image-preview with generate_images...")
        response = client.models.generate_images(
            model='gemini-3-pro-image-preview',
            prompt='A simple red square',
            config=types.GenerateImagesConfig(
                number_of_images=1,
                aspect_ratio="1:1",
            )
        )
        print("Success! Image generated.")
    except Exception as e:
        print(f"Failed with gemini-3-pro-image-preview: {e}")

if __name__ == "__main__":
    main()
