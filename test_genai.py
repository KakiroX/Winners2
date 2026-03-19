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
    
    # Try listing attributes of types again to see if we missed something
    print("Checking types.GenerateContentConfig fields again...")
    
    # Try a simple generation with a known model to see what works
    try:
        print("Testing gemini-2.0-flash with IMAGE modality...")
        response = client.models.generate_content(
            model='gemini-2.0-flash',
            contents='A simple red square',
            config=types.GenerateContentConfig(
                response_modalities=["IMAGE"],
            )
        )
        print("Success! Response received.")
        for part in response.candidates[0].content.parts:
            if part.inline_data:
                print("Image data found!")
            if part.text:
                print(f"Text found: {part.text}")
    except Exception as e:
        print(f"Failed with gemini-2.0-flash: {e}")

if __name__ == "__main__":
    main()
