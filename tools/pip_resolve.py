import subprocess, sys, os

reqs = [
    "diffusers>=0.31.0",
    "transformers>=4.44.0",
    "accelerate>=0.33.0",
    "torch>=2.3.0",
    "torchvision>=0.19.0",
    "gradio>=5.0.0",
    "spaces>=0.51.0",
    "huggingface_hub==0.25.2",
    "sentencepiece",
    "protobuf",
    "safetensors",
]
out = os.path.join(os.environ["TEMP"], "pipres2.txt")
with open(out, "w", encoding="utf-8") as f:
    r = subprocess.run(
        [sys.executable, "-m", "pip", "install", "--dry-run", "--ignore-installed",
         "--disable-pip-version-check", "-q"] + reqs,
        stdout=f, stderr=subprocess.STDOUT, timeout=300,
    )
print("exit", r.returncode)
with open(out, encoding="utf-8") as f:
    data = f.read()
print("len", len(data))
print(data[-4000:])
