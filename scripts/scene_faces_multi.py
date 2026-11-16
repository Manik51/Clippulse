#!/usr/bin/env python3
"""ClipPulse v8.2 — per-scene MULTI-face check for the DOAC layout.

The DOAC reference is single-speaker close-ups, so its 4:5 centre crop
never meets a two-shot — but our source does, and the 4:5 crop cuts both
faces at the edges. This script reports EVERY human-scale face per frame
so the renderer can switch a two-shot scene to a 16:9 letterbox picture.

Takes image paths (one middle frame per scene) and prints a JSON array:
per frame, a list of [centreX_pct, width_pct] pairs (0-100 of frame
width), or [] when no face is found. Loads the YuNet model once.

Usage:
    python3 scene_faces_multi.py frame1.jpg frame2.jpg ...
    -> [[[25.1, 11.2], [74.8, 12.0]], [[50.0, 12.5]], []]
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
        print(json.dumps([[] for _ in paths]))
        return 0
    detector = cv2.FaceDetectorYN.create(MODEL, "", (320, 320), 0.9, 0.3, 5000)
    results: list = []
    for p in paths:
        img = cv2.imread(p)
        if img is None:
            results.append([])
            continue
        h, w = img.shape[:2]
        detector.setInputSize((w, h))
        _retval, faces = detector.detect(img)
        found: list = []
        if faces is not None:
            for face in faces:
                x, _y, fw, _fh = [float(v) for v in face[:4]]
                face_w_frac = fw / w
                # Human-scale face only; a tiny face is background, not a subject
                if face_w_frac < 0.03 or face_w_frac > 0.6:
                    continue
                face_x = (x + fw / 2) / w * 100
                found.append([round(face_x, 1), round(face_w_frac * 100, 1)])
        # Widest face first, so the caller can read [0] as the main subject
        found.sort(key=lambda f: -f[1])
        results.append(found)
    print(json.dumps(results))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
