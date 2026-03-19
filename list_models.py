import os
from google import genai
from pathlib import Path

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
    print("Available Models:")
    for m in client.models.list():
        print(f" - {m.name}")

if __name__ == "__main__":
    main()
