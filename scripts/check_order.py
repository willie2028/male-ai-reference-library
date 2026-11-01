#!/usr/bin/env python3
"""离线校验导出图板中三张图片的顺序。

用法：check_order.py <board.png> <face_id> <pose_id> <outfit_id>
输出 JSON：{matched:[...], errors:[...], meanErrors:[...]}
"""
import json
import pathlib
import sys

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[1]

# 与 assets/app.js 的 drawBoard() 保持一致
PW, PANEL_W, GAP, MARGIN = 1440, 440, 30, 30
HEAD, IMG_TOP, IMG_H, IMG_W = 118, 132, 740, 412
SIG = 16


def panel_box(i):
    """图板中第 i 个面板内图片区域的 (left, top, right, bottom)。"""
    x = MARGIN + i * (PANEL_W + GAP) + 14
    return (x, IMG_TOP, x + IMG_W, IMG_TOP + IMG_H)


def signature_from_source(path):
    """按 canvas 的 contain-fit 逻辑把源图放进 IMG_W×IMG_H 画布，再缩到 SIG×SIG。"""
    im = Image.open(path).convert("RGB")
    canvas = Image.new("RGB", (IMG_W, IMG_H), (255, 255, 255))
    scale = min(IMG_W / im.width, IMG_H / im.height)
    dw, dh = int(round(im.width * scale)), int(round(im.height * scale))
    resized = im.resize((dw, dh), Image.LANCZOS)
    canvas.paste(resized, ((IMG_W - dw) // 2, (IMG_H - dh) // 2))
    return list(canvas.convert("L").resize((SIG, SIG), Image.LANCZOS).getdata())


def signature_from_board(board, i):
    crop = board.convert("RGB").crop(panel_box(i))
    return list(crop.convert("L").resize((SIG, SIG), Image.LANCZOS).getdata())


def main():
    board_path, face_id, pose_id, outfit_id = sys.argv[1:5]
    board = Image.open(board_path)
    expected = [
        ("images/face/%s.webp" % face_id),
        ("images/pose/%s.webp" % pose_id),
        ("images/outfit/%s.webp" % outfit_id),
    ]

    src_sigs = [signature_from_source(ROOT / p) for p in expected]
    panel_sigs = [signature_from_board(board, i) for i in range(3)]

    def mae(a, b):
        return sum(abs(x - y) for x, y in zip(a, b)) / len(a)

    matched, errors = [], []
    for i, ps in enumerate(panel_sigs):
        errs = [mae(ps, ss) for ss in src_sigs]
        best = min(range(3), key=lambda j: errs[j])
        matched.append(best)
        errors.append([round(e, 2) for e in errs])

    ok = matched == [0, 1, 2]
    print(json.dumps({
        "ok": ok,
        "matched": matched,
        "errors": errors,
        "expected": [face_id, pose_id, outfit_id],
        "panelBoxes": [panel_box(i) for i in range(3)],
    }, ensure_ascii=False))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
