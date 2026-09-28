"""Load official training scripts with the bundled runtime's project paths."""
import runpy
import sys
from pathlib import Path

if __name__ == "__main__":
    engine = Path.cwd()
    sys.path[:0] = [str(engine), str(engine / "GPT_SoVITS")]
    target = sys.argv[1]
    sys.argv = sys.argv[1:]
    runpy.run_path(target, run_name="__main__")
