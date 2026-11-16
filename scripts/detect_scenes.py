#!/usr/bin/env python3
"""ClipPulse v7 — PySceneDetect wrapper.

Prints a JSON list of scenes: [{"startSec": float, "endSec": float}, ...].
Usage: python3 detect_scenes.py <video-path> [content|adaptive]

- content: ContentDetector(threshold=27.0) — frame content change.
- adaptive (default): AdaptiveDetector() — two-pass, better for fast
  camera motion (gaming / sports) and matches the ffmpeg scene filter's
  cuts on podcast footage too (verified: same 6.96s cut on the Raj clip,
  plus one more real cut at 28.4s that content mode missed).

Requires: pip install scenedetect (159KB, OpenCV already present).
Exit code 0 always prints valid JSON (empty list on failure) so the
caller can fall back to the ffmpeg scene filter.
"""
import json
import sys

def main() -> None:
    if len(sys.argv) < 2:
        print("[]")
        return
    path = sys.argv[1]
    mode = sys.argv[2] if len(sys.argv) > 2 else "adaptive"
    try:
        from scenedetect import detect, ContentDetector, AdaptiveDetector
        detector = ContentDetector(threshold=27.0) if mode == "content" else AdaptiveDetector()
        scenes = detect(path, detector)
        out = [
            {"startSec": round(s[0].seconds, 3), "endSec": round(s[1].seconds, 3)}
            for s in scenes
        ]
        print(json.dumps(out))
    except Exception:
        print("[]")

if __name__ == "__main__":
    main()
