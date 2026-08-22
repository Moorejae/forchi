# Portable repo-root resolution for the video/asset tools.
# Works on Windows AND Linux (VPS): repo root = parent of tools/.
# Allow an explicit override (systemd/VPS can export FORCHI_BASE=/opt/forchi).
import os

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.environ.get("FORCHI_BASE", BASE).rstrip("/\\")


def p(*parts):
    return os.path.join(BASE, *parts)
