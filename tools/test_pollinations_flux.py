import requests, time

prompt = "a lone figure walking through rain at night, high-end anime art, lo-fi digital illustration, manga-style painting, soft atmospheric detail"
for model in ["flux", "flux-realism", "turbo", None]:
    url = f"https://image.pollinations.ai/prompt/{requests.utils.quote(prompt)}?width=1024&height=1024&nologo=true"
    if model:
        url += f"&model={model}"
    t0 = time.time()
    try:
        r = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=150)
        ct = r.headers.get("content-type", "?")
        tag = model or "default"
        print(f"model={tag}: status={r.status_code} bytes={len(r.content)} time={time.time()-t0:.0f}s type={ct}")
        if r.status_code == 200 and len(r.content) > 5000:
            open(rf"c:\Users\hp\forchi\temp_media\poll_{tag}.png", "wb").write(r.content)
    except Exception as e:
        print(f"model={model}: ERR {str(e)[:80]}")
