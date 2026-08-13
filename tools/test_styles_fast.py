# Fast style test: quick check of our fp8 FLUX Space (10s), then Pollinations.
import requests, time, sys

PROMPTS = {
    "fb": ("ethereal dreamy cinematic digital painting, warm golden hour light, soft glowing atmosphere, "
           "painterly brushstrokes, Lucas Alighieri style, emotional surreal fantasy scene, luminous floating "
           "particles, rich amber and rose tones, melancholic romantic mood, ultra detailed"),
    "li": ("high-end photorealistic cyberpunk mecha, futuristic humanoid robot, neon cyberpunk city at night, "
           "reflective wet streets, cinematic rim lighting, holographic glow, ultra detailed, 8k"),
}

def quick_zeroGPU(prompt, out):
    base = "https://slymun-forchi-img.hf.space"
    try:
        r = requests.post(f"{base}/gradio_api/call/generate", json={"data": [prompt]}, timeout=15)
        if r.status_code != 200:
            return False, f"POST {r.status_code}"
        eid = r.json().get("event_id")
        s = requests.get(f"{base}/gradio_api/call/generate/{eid}", timeout=20)
        text = s.text
        import re
        m = list(re.finditer(r'"url"\s*:\s*"(https?:[^"\\]+)"', text))
        if not m:
            return False, "no url"
        u = m[0].group(1).replace("\\u0026", "&")
        img = requests.get(u if u.startswith("http") else f"{base}{u}", timeout=30)
        open(out, "wb").write(img.content)
        return True, f"zeroGPU ({len(img.content)}B)"
    except Exception as e:
        return False, str(e)[:60]

def pollinations(prompt, out):
    url = f"https://image.pollinations.ai/prompt/{requests.utils.quote(prompt)}?width=1024&height=1024&nologo=true"
    r = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=120)
    if r.status_code == 200 and len(r.content) > 5000:
        open(out, "wb").write(r.content)
        return True, f"pollinations ({len(r.content)}B)"
    return False, f"HTTP {r.status_code}"

for key, prompt in PROMPTS.items():
    print(f"\n=== {key} ===")
    out = rf"c:\Users\hp\forchi\temp_media\style_{key}.png"
    ok, who = quick_zeroGPU(prompt, out)
    if not ok:
        print(f"  zeroGPU: {who} -> Pollinations")
        ok, who = pollinations(prompt, out)
    print(f"  RESULT: {who if ok else 'FAILED'}")
