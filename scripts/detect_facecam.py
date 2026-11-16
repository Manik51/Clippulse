#!/usr/bin/env python3
"""ClipPulse v2 — real facecam detection (YuNet DNN).

Old logic assumed the streamer's facecam is always in the top-left corner
(``crop=iw*0.26:ih*0.28:0:0``). Many streams put the cam elsewhere — or have
no cam at all — so the split box showed overlay graphics instead of a face.

This script samples frames from a real video, detects faces with YuNet, and
reports:
  - which corner (if any) actually contains a face, with a crop origin the
    gaming-split filter can use directly;
  - the largest face's horizontal centre (faceX, 0-100) for face-track crops;
  - null corner when no face is found, so the caller can fall back to
    face-track instead of rendering a bogus split box.

Usage:
    python3 detect_facecam.py <video> [--times 0.2,0.5,0.8] [--min-score 0.5]

Prints one JSON object to stdout. Exit 0 even when no face is found.
"""
import argparse
import json
import os
import sys

import cv2

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(SCRIPT_DIR, "face_detection_yunet_2023mar.onnx")

# Corner regions (fraction of frame): the gaming-split cam box is 26% wide,
# 28% tall. A face counts for a corner when its centre falls inside a
# slightly larger 34% x 34% zone at that corner, so near-corner cams still hit.
CORNERS = {
    "top-left": {"origin": [0.0, 0.0], "zone": (0.0, 0.0, 0.34, 0.34)},
    "top-right": {"origin": [0.74, 0.0], "zone": (0.66, 0.0, 1.0, 0.34)},
    "bottom-left": {"origin": [0.0, 0.72], "zone": (0.0, 0.66, 0.34, 1.0)},
    "bottom-right": {"origin": [0.74, 0.72], "zone": (0.66, 0.66, 1.0, 1.0)},
}


def detect(video_path: str, times: list[float], min_score: float) -> dict:
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        return {"error": f"cannot open video: {video_path}"}
    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    duration = frame_count / fps if fps else 0.0

    detector = cv2.FaceDetectorYN_create(
        MODEL_PATH, "", (320, 320), min_score, 0.3, 5000
    )

    corner_scores = {name: 0.0 for name in CORNERS}
    corner_hits = {name: 0 for name in CORNERS}
    corner_frames = {name: set() for name in CORNERS}
    faces_total = 0
    frames_with_face = 0
    frames_sampled = 0
    largest_face = None  # (area_frac, cx_frac, cy_frac, box)

    for frame_idx, frac in enumerate(times):
        if duration > 0:
            cap.set(cv2.CAP_PROP_POS_MSEC, frac * duration * 1000.0)
        ok, frame = cap.read()
        if not ok or frame is None:
            continue
        frames_sampled += 1
        h, w = frame.shape[:2]
        detector.setInputSize((w, h))
        _, faces = detector.detect(frame)
        if faces is None:
            continue
        frame_had_face = False
        for face in faces:
            x, y, fw, fh, score = (float(v) for v in face[:5])
            if score < min_score:
                continue
            faces_total += 1
            frame_had_face = True
            cx, cy = (x + fw / 2) / w, (y + fh / 2) / h
            area_frac = (fw * fh) / (w * h)
            if largest_face is None or area_frac > largest_face[0]:
                largest_face = (
                    area_frac,
                    cx,
                    cy,
                    [round(x / w, 3), round(y / h, 3), round(fw / w, 3), round(fh / h, 3)],
                )
            # Facecam rule: a webcam face is human-scale (8–35% of frame
            # width) AND persistent — a distant player's face or a one-frame
            # game portrait must not open a split box.
            if not (0.08 <= fw / w <= 0.35):
                continue
            for name, spec in CORNERS.items():
                zx0, zy0, zx1, zy1 = spec["zone"]
                if zx0 <= cx <= zx1 and zy0 <= cy <= zy1:
                    corner_scores[name] += area_frac
                    corner_hits[name] += 1
                    corner_frames[name].add(frame_idx)
        if frame_had_face:
            frames_with_face += 1

    cap.release()

    best_corner = None
    best_score = 0.0
    for name, score in corner_scores.items():
        # Persistent: seen in at least 2 sampled frames in the same corner.
        if len(corner_frames[name]) < 2:
            continue
        if score > best_score:
            best_score, best_corner = score, name
    # A corner only counts if a face was actually seen there; a zero score
    # means "no facecam found" — the caller must NOT render a split box.
    if best_score <= 0:
        best_corner = None

    return {
        "corner": best_corner,
        "cropOrigin": CORNERS[best_corner]["origin"] if best_corner else None,
        "cornerScore": round(best_score, 4),
        "cornerHits": corner_hits,
        "facesDetected": faces_total,
        "framesWithFace": frames_with_face,
        "framesSampled": frames_sampled,
        "faceX": round(largest_face[1] * 100) if largest_face else None,
        "faceBox": largest_face[3] if largest_face else None,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("--times", default="0.2,0.5,0.8")
    ap.add_argument("--min-score", type=float, default=0.5)
    args = ap.parse_args()
    times = [float(t) for t in args.times.split(",") if t.strip()]
    print(json.dumps(detect(args.video, times, args.min_score)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
