# GENERATION — 样图生成说明

版本：1.0 · 2026-10-31

## 1. 生成工具

| 项 | 值 |
|---|---|
| 工具 | WorkBuddy 内置图片生成能力（ImageGen） |
| 提供方 | `pending-review`（工具接口未暴露可确认的模型名/条款地址） |
| 模型 | `pending-review` |
| 参数 | 单张独立出图，每次调用生成 1 张，**不做拼图** |
| 输出 | PNG（1024×1024 或 1024×1536）→ 等比裁剪去角标 → WebP |

> 工具不提供独立的负面提示词入参，因此负面约束以 `Avoid: ...` 形式写入提示词正文，
> 同时在 `GENERATION_QUEUE.json` 中以独立字段保存，便于换用其他工具复现。

## 2. 三类共用提示词骨架

### 2.1 脸（face）
```
Photorealistic studio reference portrait of an adult man, age {age}, {hair}, {beard}.
Head-and-shoulders framing showing the head, both shoulders and upper chest, with clear margin above the hair.
Natural 85mm portrait lens perspective, no wide-angle distortion.
Plain solid light grey seamless backdrop, soft even diffused studio lighting, realistic skin texture,
sharp focus on facial features, masculine facial structure with a defined jawline and brow.
Neutral relaxed expression, no accessories.
Avoid: text, watermark, logo, brand mark, extra faces, distorted or asymmetrical features,
plastic skin, heavy makeup, jewellery, sunglasses, scarf, visible text.
```
共性要求：纯色背景、柔和光线、头肩构图、只突出一个参考目标。

### 2.2 姿势（pose）
```
Photorealistic 3D render reference of a faceless grey male mannequin, uniform matte light grey surface
over the whole body, anatomically correct adult male proportions, {action}.
The entire body from head to shoes is inside the frame with clear margin around the figure.
Plain white studio background, soft even lighting, natural joint articulation.
Wearing a simple fitted plain crew-neck t-shirt and slim straight trousers so joints and limb positions stay readable.
Avoid: facial features, hair, skin tone, text, watermark, logo, extra limbs, cropped feet,
extreme wide-angle distortion, complex background.
```
共性要求：无脸灰色人偶、全身入画、关节清晰、服装简洁贴身。

### 2.3 服装（outfit）
```
Photorealistic 3D product render of a headless male ghost mannequin displaying a complete men's outfit,
no head and no visible body, blank neck opening, hollow collar and empty cuffs and hem.
{garments}. The whole outfit is fully inside the frame with margin around it.
Plain white studio backdrop, soft even studio lighting, realistic fabric drape and stitching,
correct menswear tailoring with a proper shoulder seam and sleeve hem.
Avoid: visible head, face, skin, hands, text, watermark, logo, brand, extreme perspective,
cluttered background, flat-lay, mixed garment forms.
```
共性要求：统一 ghost mannequin 形式（**不与真人模特、平铺形式混用**）、全套服装完整入画。

## 3. 负向提示词（共用）

```
text, watermark, logo, brand mark, signature, letters, caption,
extra faces, duplicated features, distorted face, asymmetrical eyes, deformed hands,
extra limbs, missing limbs, cropped feet, extreme wide-angle distortion,
plastic skin, heavy makeup, jewellery, text overlay, busy background, cluttered scene
```

## 4. 尺寸与质量检查点

| 分类 | 生成尺寸 | 交付尺寸 | 裁剪说明 |
|---|---|---|---|
| face | 1024×1024 | 896×1024 | 裁掉右侧 128 列（去角标） |
| pose | 1024×1536 | 896×1536 | 裁掉右侧 128 列（去角标） |
| outfit | 1024×1536 | 896×1536 | 裁掉右侧 128 列（去角标） |

**关于右下角角标**：生成平台会在每张图右下角压印 `AI生成 / WORKBUDDY` 标识。工具接口未提供关闭该标识的参数（`footnote` 传空值无效）。其中 `WORKBUDDY` 属第三方品牌标识，规范要求图片不含明显品牌标志；但服务协议 §6.4(i)/(j) 禁止移除或规避 AI 生成标识。因此交付前统一做两步处理：

1. **裁掉右侧 128 列**，去除含品牌词的角标（左上角对齐等比裁剪，不缩放、不拉伸）；
2. **在原角标位置补打一枚不含任何第三方品牌的「AI生成」标识**（半透明深色底 + 白字）。

原始 PNG 保留在 `work/raw/`，未随项目分发。AI 生成属性在 `PROVENANCE.md`、`ASSET_LICENSE.md` 与 `README.md` 中完整披露，图片本体也带可见标识。

角标位置经模板匹配验证，在全部 15 张原图中**完全一致**（1024×1024 图位于 x=898/y=954，1024×1536 图位于 x=898/y=1466），因此只裁掉右侧 128 列即可完整去除角标，**不裁剪底部**，避免切掉鞋尖与裤脚。

## 5. 每张素材的质量检查点

**脸**
- 五官位置合理，无重复面孔、无明显变形、无多余眼睛
- 头部与双肩完整入画，发顶留白
- 背景纯色，无文字/水印/logo
- 年龄与发型、胡须与标签一致

**姿势**
- 四肢完整入画（含双脚），无缺失肢体
- 关节自然，无扭曲
- 动作与标签一致（如「侧面行走」确为侧面且在行走）
- 无脸，比例接近成年男性

**服装**
- 结构完整：领口、袖口、裤腿无明显异常
- 全套服装同框，无混用形式
- 无头无手，符合 ghost mannequin 定义
- 无文字/水印/品牌 logo

**通用**
- 文件可打开、路径正确、画面内容符合分类

## 6. 生成流程与重试策略

1. 每类先生成 1 张（共 3 张），检查构图 / 人体 / 服装形式。
2. 修正共用提示词后，再生成余下素材。
3. 每张默认**最多重试 1 次**，避免失控消耗额度。
4. 不合格素材标记 `rejected`，不混入正式可选集合。
5. 少量素材仍不合格时，**报告缺口**，不无限重试。

## 7. 授权立场

服务条款未确认允许再分发时，`license` 一律记为 `pending-review`，**不得声称素材已获开放许可**。
本项目所有图片均为 AI 生成，不涉及真实人物肖像权。
