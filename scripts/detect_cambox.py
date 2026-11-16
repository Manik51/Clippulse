#!/usr/bin/env python3
"""ClipPulse v4 — facecam BOX detection (OpusClip Gameplay layout).

v2's detect_facecam.py only looked for a face in a CORNER, so it missed
cams that sit mid-frame (e.g. this Apex stream: pink-bordered box at
x 0.03-0.21, y 0.38-0.62). This script finds the actual cam BOX anywhere
in the frame:

1. YuNet finds the streamer's face.
2. Canny edges + contours find the rectangular border AROUND that face
   (the cam box) — it must contain the face centre, cover 2-20% of the
   frame, and have aspect 0.9-2.2.
3. Fallback: expand the face rect (box ~2.4x face width, ~4:3 aspect,
   centred on the face) — calibrated on the Apex stream (face w 0.073 of
   frame, box w 0.178, box centre within 0.01 of face centre).

A box only counts if it is found at (nearly) the same place in >=2
sampled frames — the cam box is a static overlay, so it must persist.

Usage:
    python3 detect_cambox.py video.mp4
    -> {"box": [0.031, 0.38, 0.178, 0.239], "faceX": 0.129, "faceY": 0.519,
        "facesDetected": 3, "method": "contour"}
    -> {"box": null, ...} when no persistent cam box is found.
"""
import json
import os
import sys

import cv2
import numpy as np

MODEL = os.path.join(os.path.dirname(os.path.abspath(__file__)), "face_detection_yunet_2023mar.onnx")
TIMES = [0.2, 0.5, 0.8]


def find_box_by_contours(gray, face_cx, face_cy, fw, fh):
    """Best rectangular contour containing the face centre."""
    h, w = gray.shape[:2]
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blurred, 50, 150)
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    best = None
    best_score = 0.0
    for c in contours:
        x, y, cw, ch = cv2.boundingRect(c)
        if cw < fw * 1.5 or ch < fh * 0.8:
            continue
        area_frac = (cw * ch) / (w * h)
        if area_frac < 0.02 or area_frac > 0.20:
            continue
        aspect = cw / max(1, ch)
        if aspect < 0.9 or aspect > 2.2:
            continue
        cx, cy = x + cw / 2, y + ch / 2
        if not (x <= face_cx <= x + cw and y <= face_cy <= y + ch):
            continue
        # Prefer boxes whose centre is near the face centre.
        centre_dist = ((cx - face_cx) ** 2 + (cy - face_cy) ** 2) ** 0.5 / max(w, h)
        score = 1.0 - centre_dist
        if score > best_score:
            best_score = score
            best = (x / w, y / h, cw / w, ch / h)
    return best


def expand_face_box(face_x, face_y, face_w, face_h, img_w, img_h):
    """Fallback: box ~2.4x face width, ~4:3, centred on the face."""
    bw = min(0.45, face_w * 2.4)
    bh = min(0.45, bw / 1.33)
    cx = face_x + face_w / 2
    cy = face_y + face_h / 2
    bx = max(0.0, min(1.0 - bw, cx - bw / 2))
    by = max(0.0, min(1.0 - bh, cy - bh / 2))
    return (round(bx, 3), round(by, 3), round(bw, 3), round(bh, 3))


def main() -> int:
    video = sys.argv[1] if len(sys.argv) > 1 else ""
    out = {"box": None, "faceX": None, "faceY": None, "facesDetected": 0, "method": None}
    if not video or not os.path.exists(video) or not os.path.exists(MODEL):
        print(json.dumps(out))
        return 0

    cap = cv2.VideoCapture(video)
    if not cap.isOpened():
        print(json.dumps(out))
        return 0
    duration_ms = cap.get(cv2.CAP_PROP_POS_MSEC)  # 0; use frame count instead
    total_frames = cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    duration_sec = total_frames / fps if fps else 0

    detector = cv2.FaceDetectorYN.create(MODEL, "", (320, 320), 0.9, 0.3, 5000)
    boxes: list = []
    methods: list = []
    faces_seen = 0
    for t in TIMES:
        target_ms = t * duration_sec * 1000 if duration_sec else 0
        cap.set(cv2.CAP_PROP_POS_MSEC, target_ms)
        ok, frame = cap.read()
        if not ok or frame is None:
            continue
        h, w = frame.shape[:2]
        detector.setInputSize((w, h))
        _ret, faces = detector.detect(frame)
        if faces is None or len(faces) == 0:
            continue
        faces_seen += 1
        best = max(faces, key=lambda f: float(f[2]) * float(f[3]))
        fx, fy, fw, fh = [float(v) for v in best[:4]]
        if fw / w < 0.03 or fw / w > 0.6:
            continue
        face_cx, face_cy = fx + fw / 2, fy + fh / 2
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        box = find_box_by_contours(gray, face_cx, face_cy, fw, fh)
        if box:
            boxes.append(box)
            methods.append("contour")
        else:
            boxes.append(expand_face_box(fx / w, fy / h, fw / w, fh / h, w, h))
            methods.append("expand")
        out["faceX"] = round(face_cx / w, 3)
        out["faceY"] = round(face_cy / h, 2)

    cap.release()
    out["facesDetected"] = faces_seen
    if len(boxes) >= 2:
        # Median box across frames = the static overlay; require the
        # per-frame boxes to roughly agree (within 0.08 on each edge).
        med = tuple(float(np.median([b[i] for b in boxes])) for i in range(4))
        agree = all(
            all(abs(b[i] - med[i]) < 0.08 for i in range(4)) for b in boxes
        )
        if agree:
            out["box"] = [round(v, 3) for v in med]
            out["method"] = methods[0] if len(set(methods)) == 1 else "mixed"
    print(json.dumps(out))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
