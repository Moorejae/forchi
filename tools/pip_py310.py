import subprocess, sys, os

def resolve(name, reqs, pyver):
    out = os.path.join(os.environ["TEMP"], f"pip_{name}_{pyver}.txt")
    cmd = [sys.executable, "-m", "pip", "install", "--dry-run", "--ignore-installed",
           "--disable-pip-version-check", "--only-binary", ":all:",
           "--python-version", pyver, "--implementation", "cp",
           "--abi", f"cp{pyver.replace('.','')}", "--platform", "manylinux_2_17_x86_64", "-q"] + reqs
    with open(out, "w", encoding="utf-8") as f:
        try:
            r = subprocess.run(cmd, stdout=f, stderr=subprocess.STDOUT, timeout=150)
            print(f"== {name} py{pyver}: exit {r.returncode} ==")
        except subprocess.TimeoutExpired:
            print(f"== {name} py{pyver}: TIMEOUT ==")
    with open(out, encoding="utf-8") as f:
        data = f.read()
    if "ResolutionImpossible" in data:
        idx = data.find("ERROR:")
        print(data[idx:idx + 2500])
    else:
        lines = [l for l in data.splitlines() if l.strip()]
        print("\n".join(lines[-8:]))
    print("=" * 70)

resolve("no_torch", ["gradio==5.49.0", "spaces==0.51.1", "sentencepiece", "protobuf", "safetensors"], "3.10")
