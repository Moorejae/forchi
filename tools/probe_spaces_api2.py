# Inspect inputs + test generation on the two best candidates.
import json, time, requests

def get_config(space_id):
    base = f"https://{space_id.replace('/', '-')}.hf.space"
    cfg = requests.get(f"{base}/config", timeout=25).json()
    return base, cfg

def describe_fn(cfg, api_name):
    comps = cfg.get("components") or []
    deps = cfg.get("dependencies") or []
    # find dependency with this api_name
    dep = next((d for d in deps if isinstance(d, dict) and d.get("api_name") == api_name), None)
    if not dep:
        return
    print(f"  fn '{api_name}': inputs={dep.get('inputs')} outputs={dep.get('outputs')}")
    for cid in dep.get("inputs", []):
        c = next((x for x in comps if x.get("id") == cid), None)
        if c:
            props = c.get("props") or {}
            print(f"    IN id={cid} type={c.get('type')} label={props.get('label')} default={str(props.get('value'))[:40]}")

for sid, api in [("radames/Real-Time-Text-to-Image-SDXL-Lightning", "predict"),
                 ("KingNish/Realtime-FLUX", "generate_image")]:
    print(f"\n=== {sid} ===")
    try:
        base, cfg = get_config(sid)
    except Exception as e:
        print("config err", str(e)[:80]); continue
    describe_fn(cfg, api)
