#!/usr/bin/env python3
"""验证交付图片右下角的「AI生成」标识。

方法（与背景亮度无关）：
  1. 用 process_images 的同一套代码，把 work/raw 的原图重新渲染出「应当的样子」；
  2. 计算「参考渲染 − 原图」与「交付件 − 原图」两张差异图；
  3. 两张差异图在标识矩形内应高度一致（余弦相似度接近 1），
     这既证明标识真实存在，也证明交付件除标识与压缩噪声外没有别的改动。

用法：check_label.py
"""
import importlib.util
import pathlib

import numpy as np
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("pi", ROOT / "work" / "process_images.py")
pi = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pi)

SIGNIFICANT = 14
MIN_CORR = 0.75
MAX_OUTSIDE_PCT = 1.0     # 标识区外的显著差异占比上限（%），仅压缩噪声


def cosine(a, b):
    a = a.astype(np.float64).ravel()
    b = b.astype(np.float64).ravel()
    denom = np.linalg.norm(a) * np.linalg.norm(b)
    return float(a.dot(b) / denom) if denom else 0.0


def check(tid, category):
    raw_png = sorted((ROOT / "work" / "raw" / tid).glob("*.png"))[0]
    delivered = ROOT / "images" / category / f"{tid}.webp"

    with Image.open(raw_png) as im:
        base_im = im.convert("RGB").crop(pi.CROP[category])
    with Image.open(delivered) as im:
        out = np.asarray(im.convert("RGB"), dtype=np.float64)

    base = np.asarray(base_im, dtype=np.float64)
    ref = np.asarray(pi.stamp_label(base_im), dtype=np.float64)   # 应当的成品

    if out.shape != base.shape:
        return {"ok": False, "why": f"尺寸不一致 {base.shape} vs {out.shape}"}

    d_ref = ref - base
    d_out = out - base
    H, W = base.shape[:2]
    x0, y0, x1, y1 = pi.label_rect((W, H))

    rect_d_ref = d_ref[y0:y1, x0:x1]
    rect_d_out = d_out[y0:y1, x0:x1]
    corr = cosine(rect_d_ref, rect_d_out)

    # 参考渲染中标识覆盖的像素数（底板 + 白字）
    plate_px = int((np.abs(rect_d_ref).max(axis=2) > SIGNIFICANT).sum())
    # 交付件中与参考渲染一致的强度（余弦之外的逐点最大偏差）
    max_dev = float(np.abs(rect_d_out - rect_d_ref).max())

    outside = np.abs(d_out).max(axis=2).copy()
    outside[max(0, y0 - 6):y1 + 6, max(0, x0 - 6):x1 + 6] = 0
    outside_pct = float((outside > SIGNIFICANT).mean() * 100)

    res = {
        "ok": False,
        "corr": round(corr, 4),
        "plate": plate_px,
        "maxDev": round(max_dev, 1),
        "outsidePct": round(outside_pct, 3),
        "rect": (x0, y0, x1, y1),
    }
    if corr < MIN_CORR:
        res["why"] = f"标识区差异图与参考渲染相似度仅 {corr:.3f}，标识可能未正确呈现"
        return res
    if max_dev > 90:
        res["why"] = f"标识区与参考渲染最大偏差 {max_dev:.0f}"
        return res
    if outside_pct > MAX_OUTSIDE_PCT:
        res["why"] = f"标识区外显著差异占 {outside_pct:.2f}%，疑似有非预期改动"
        return res
    res["ok"] = True
    return res


def main():
    rows = []
    for cat in ("face", "pose", "outfit"):
        for f in sorted((ROOT / "images" / cat).glob("*.webp")):
            rows.append((f.stem, cat))

    print(f"{'id':<14}{'相似度':>9}{'标识px':>9}{'最大偏差':>9}{'区外显著%':>11}   结果")
    bad = []
    for tid, cat in rows:
        r = check(tid, cat)
        flag = "OK" if r["ok"] else "异常"
        if not r["ok"]:
            bad.append(f"{tid}: {r.get('why', '')}")
        print(f"{tid:<14}{r.get('corr', 0):>9}{r.get('plate', 0):>9}"
              f"{r.get('maxDev', 0):>9}{r.get('outsidePct', 0):>11}   {flag}")

    print(f"\n{len(rows) - len(bad)}/{len(rows)} 张带可见「AI生成」标识，且标识区外无其他改动")
    for b in bad:
        print("  ✗ " + b)
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
