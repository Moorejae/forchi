import subprocess, sys, os

# Fast dry-run on version-sensitive packages only (no torch/diffusers to avoid big metadata)
tests = {
    "gradio_only": ["gradio==5.49.0"],
    "gradio_5_30": ["gradio==5.30.0", "spaces==0.51.1"],
    "gradio_5_0": ["gradio==5.0.0", "spaces==0.51.1"],
}
for name, reqs in tests.items():
    out = os.path.join(os.environ["TEMP"], f"pip_{name}.txt")
    with open(out, "w", encoding="utf-8") as f:
        try:
            r = subprocess.run(
                [sys.executable, "-m", "pip", "install", "--dry-run", "--ignore-installed",
                 "--disable-pip-version-check", "--only-binary", ":all:", "-q"] + reqs,
                stdout=f, stderr=subprocess.STDOUT, timeout=120,
            )
            print(f"== {name}: exit {r.returncode} ==")
        except subprocess.TimeoutExpired:
            print(f"== {name}: TIMEOUT ==")
    with open(out, encoding="utf-8") as f:
        data = f.read()
    if "ResolutionImpossible" in data:
        idx = data.find("ERROR:")
        print(data[idx:idx + 2000])
    else:
        lines = [l for l in data.splitlines() if l.strip()]
        print("\n".join(lines[-10:]))
    print("=" * 70)
