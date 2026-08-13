# Test: gradio_client WITH the HF token (authenticated = PRO quota) vs radames hosted Space.
import os, time
from gradio_client import Client

token = [l.split('=', 1)[1].strip() for l in open(r'c:\Users\hp\forchi\.env') if l.startswith('HF_ACCESS_TOKEN=')][0]
os.environ["HF_TOKEN"] = token
os.environ["HUGGING_FACE_HUB_TOKEN"] = token
print("token prefix:", token[:8], "...")

prompt = "ethereal dreamy cinematic digital painting, warm golden light, Lucas Alighieri style, painterly, ultra detailed"

t0 = time.time()
try:
    print("Connecting (auth via HF_TOKEN env)...")
    client = Client("radames/Real-Time-Text-to-Image-SDXL-Lightning")
    print("Connected. Predicting...")
    result = client.predict(prompt, 0.0, 0, api_name="/predict")
    print(f"DONE in {time.time()-t0:.0f}s -> type={type(result)}")
    print("result:", str(result)[:200])
    if isinstance(result, str) and ("/file=" in result or result.startswith("http")):
        import requests
        img = requests.get(result if result.startswith("http") else f"https://radames-real-time-text-to-image-sdxl-lightning.hf.space{result}", timeout=60)
        out = r"c:\Users\hp\forchi\temp_media\auth_test.png"
        open(out, "wb").write(img.content)
        print("SAVED:", out, len(img.content), "bytes")
except Exception as e:
    print("FAILED:", str(e)[:300])
