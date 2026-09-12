"""
Download the InsightFace model pack at BUILD time, then delete what is never loaded.

Run from the Dockerfile, not by hand.

Two jobs:

1. Fetch the pack during the build. The container home directory is ephemeral,
   so without this the first request after every redeploy pays a ~125MB download
   -- which looks exactly like a hang, and fails outright if GitHub is
   unreachable from the host.

2. Drop the models the engine does not load. A pack ships landmark and
   gender/age models alongside the detector and recogniser; with
   allowed_modules=['detection','recognition'] those are never opened, so they
   are pure image weight. In buffalo_s that is 143MB of 158MB.

   NOTE: this saves DISK, not memory. An unloaded ONNX file costs nothing at
   runtime because no session is ever created for it.

Which files survive is decided by asking the prepared app what it actually
loaded, rather than by a hardcoded list -- the filenames differ per pack
(buffalo_s has det_500m/w600k_mbf, buffalo_l has det_10g/w600k_r50), so a fixed
list would silently delete the wrong things the moment the pack changed.
"""

from __future__ import annotations

import os
import sys


def main() -> int:
    pack = os.environ.get("INSIGHTFACE_MODEL_PACK", "buffalo_s")
    root = os.environ.get("INSIGHTFACE_ROOT", "/opt/insightface")

    try:
        from insightface.app import FaceAnalysis
    except ImportError:
        print("insightface not installed; nothing to prefetch.")
        return 0

    print(f"Prefetching InsightFace pack '{pack}' into {root} ...")
    app = FaceAnalysis(
        name=pack,
        root=root,
        providers=["CPUExecutionProvider"],
        allowed_modules=["detection", "recognition"],
    )
    app.prepare(ctx_id=-1)

    keep = set()
    for module, model in app.models.items():
        path = getattr(model, "model_file", None)
        if path:
            keep.add(os.path.normpath(path))
            print(f"  keep  {module:12s} {os.path.basename(path)}")

    if not keep:
        # Never prune on a guess: if the app did not report its files, deleting
        # by elimination would remove the models it is actually using.
        print("  Could not determine loaded model files; skipping prune.")
        return 0

    pack_dir = os.path.join(root, "models", pack)
    if not os.path.isdir(pack_dir):
        print(f"  {pack_dir} not found; skipping prune.")
        return 0

    freed = 0
    for name in sorted(os.listdir(pack_dir)):
        if not name.endswith(".onnx"):
            continue
        path = os.path.normpath(os.path.join(pack_dir, name))
        if path in keep:
            continue
        size = os.path.getsize(path)
        os.remove(path)
        freed += size
        print(f"  prune {name}  ({size / 1048576:.1f} MB)")

    print(f"Pruned {freed / 1048576:.1f} MB of unloaded models.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
