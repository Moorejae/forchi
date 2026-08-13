# Dump gradio API functions (dependencies) of candidate image Spaces to find a simple prompt->image call.
import requests

spaces = [
    "yanze/PuLID-FLUX",
    "multimodalart/flux-lora-the-explorer",
    "prodia/fast-stable-diffusion",
    "prodia/sdxl-stable-diffusion-xl",
    "stabilityai/stable-diffusion-3-medium",
    "KingNish/Realtime-FLUX",
    "radames/Real-Time-Text-to-Image-SDXL-Lightning",
    "diffusers/unofficial-SDXL-Turbo-i2i-t2i",
    "multimodalart/FLUX.1-merged",
]

for sid in spaces:
    base = f"https://{sid.replace('/', '-')}.hf.space"
    try:
        r = requests.get(f"{base}/config", timeout=20)
        cfg = r.json() if r.status_code == 200 else None
    except Exception as e:
        print(f"\n== {sid}: ERR {str(e)[:60]}")
        continue
    if not cfg:
        print(f"\n== {sid}: HTTP {r.status_code}")
        continue
    deps = cfg.get("dependencies") or []
    print(f"\n== {sid} | title={cfg.get('title') or cfg.get('name')} | deps={len(deps)}")
    for d in deps[:8]:
        if isinstance(d, dict):
            api = d.get("api_name") or d.get("id")
            ins = d.get("inputs")
            outs = d.get("outputs")
            print(f"   fn api_name={api} inputs={len(ins) if isinstance(ins, list) else ins} outputs={len(outs) if isinstance(outs, list) else outs}")
