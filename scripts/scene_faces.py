#!/usr/bin/env python3
"""ClipPulse v3 — per-scene face check for scene-aware reframing.

Takes image paths (one middle frame per scene) and prints a JSON array:
the horizontal centre (0-100) of the largest face in each frame, or null
when no face is found. Loads the YuNet model once for all frames.

Usage:
    python3 scene_faces.py frame1.jpg frame2.jpg ...
    -> [62.4, null, 41.0]
"""
import json
import os
import sys

import cv2

MODEL = os.path.join(os.path.dirname(os.path.abspath(__file__)), "face_detection_yunet_2023mar.onnx")


def main() -> int:
    paths = sys.argv[1:]
    if not paths:
        print("[]")
        return 0
    if not os.path.exists(MODEL):
        print(json.dumps([None] * len(paths)))
        return 0
    detector = cv2.FaceDetectorYN.create(MODEL, "", (320, 320), 0.9, 0.3, 5000)
    results: list = []
    for p in paths:
        img = cv2.imread(p)
        if img is None:
            results.append(None)
            continue
        h, w = img.shape[:2]
        detector.setInputSize((w, h))
        _retval, faces = detector.detect(img)
        if faces is None or len(faces) == 0:
            results.append(None)
            continue
        # Largest face wins (area), like detect_facecam.py
        best = max(faces, key=lambda f: float(f[2]) * float(f[3]))
        x, _y, fw, _fh = [float(v) for v in best[:4]]
        face_w_frac = fw / w
        # Human-scale face only; a tiny face is background, not the subject
        if face_w_frac < 0.03 or face_w_frac > 0.6:
            results.append(None)
            continue
        face_x = (x + fw / 2) / w * 100
        results.append(round(face_x, 1))
    print(json.dumps(results))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
