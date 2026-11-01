# SPEC — 男性 AI 作图参考库（male-ai-reference-library）

版本：1.0 · 2026-10-31 · 状态：第一阶段（15 张样图）

## 1. 范围与定位

一个静态网页形式的**成年男性角色**参考素材库，包含三个分类：

| 分类 | code | 内容 |
|---|---|---|
| 脸 | `face` | 面部特征与发型（头肩构图） |
| 姿势 | `pose` | 体型比例与身体姿势（无脸人偶） |
| 服装 | `outfit` | 男性服装全套（无头人台） |

不做账号、支付、后台、数据库、在线生图。所有素材为本地静态文件，可用 `python3 -m http.server` 直接运行，可部署到任意静态托管。

## 2. 人物与内容边界

- **只使用明确成年的人物**。所有生成提示词必须写明成年年龄区间（`adult man, age 30` 等），禁止使用 `girl / boy / teen / young male` 等可能指向未成年人的表述。
- 全部素材为 **AI 生成**，不含真实人物、不影射任何可识别的真人。
- 禁止出现：文字、水印、品牌标识、可识别商标、真实品牌 logo、裸露或暗示性内容。
- 姿势与服装一律使用**无脸/无头人偶形式**，不得出现真人面孔与人体混用。

## 3. 标签词表（固定，避免同义重复）

标签只允许取自下列词表。同一概念不得同时使用多个近义标签（如「短发」与「短头发」只保留前者）。

**脸 face**
`短发` `卷发` `中长发` `无胡须` `短胡须` `络腮胡` `正面` `四分之三` `侧面` `年轻` `中年` `圆脸` `方脸` `长脸`

**姿势 pose**
`正面站立` `四分之三视角` `侧面视角` `行走` `坐姿` `站立` `抬手` `指向一侧` `中等体型` `精瘦体型` `健硕体型` `静态` `动态`

**服装 outfit**
`T恤` `衬衫` `西装` `运动装` `外套` `长裤` `西裤` `牛仔裤` `休闲` `正装` `运动` `春秋` `秋冬`

## 4. 图像规格

- **不拉伸、不为凑尺寸缩放变形**。所有素材按生成时的原生尺寸交付，仅做等比裁剪（去角标）与格式转换。
- 每个分类内部保持**同一画幅**：
  - `face`：896 × 1024（约 0.875:1，接近方形）
  - `pose` / `outfit`：896 × 1536（约 0.583:1，竖幅）
- 交付格式 WebP（保留 PNG 原图于 `work/`，不随项目分发）。
- **图片显示与数据一律使用相对路径**（`images/...`），保证静态托管可用。

## 5. 编号规则

- 编号格式 `<category>-<NNN>`，例如 `face-001`、`pose-003`、`outfit-005`。
- 编号在素材创建时分配，**一经发布即固定，不随排序、筛选或随机而改变**。
- `rejected` 的素材保留编号但不出现在可选集合中，编号不再复用。

## 6. 左右方向约定

姿势描述中的左右一律采用**人物自身左右**（subject's own left / right），与观众视角无关。
例如「抬起他自己的右臂指向画面右侧」必须写成 `his right arm`, 而不是 `the right side of the image`。

## 7. 体型归属

体型（精瘦 / 中等 / 健硕）**作为姿势素材的标签**存在（`pose` 的 `tagsZh`），**不新增第四个素材库**。

## 8. 数据结构

`data/references.json` 为单个 JSON 对象，字段如下。未知信息一律留空或标记 `pending-review`，**不得写成已确认**。

```json
{
  "id": "face-001",
  "category": "face",
  "title": "成年男性短发正面",
  "tagsZh": ["短发", "正面", "无胡须"],
  "tagsEn": ["short hair", "front view", "clean shaven"],
  "image": "images/face/face-001.webp",
  "prompt": "",
  "negativePrompt": "",
  "source": {
    "type": "generated",
    "provider": "WorkBuddy ImageGen",
    "model": "",
    "generatedAt": "2026-10-31T08:36:16",
    "referenceImages": [],
    "termsUrl": "https://www.workbuddy.cn/document/term"
  },
  "license": "approved",
  "licenseBasis": "服务条款 §9.2(d)：Output 归使用者所有，可再分发",
  "status": "ready"
}
```

- `category` ∈ `face` | `pose` | `outfit`
- `status` ∈ `planned` | `generated` | `ready` | `rejected`
- `license` ∈ `pending-review` | `approved`
  - `pending-review`：**未确认可再分发**，界面必须显示「待确认」
  - `approved`：**已确认可再分发**，界面必须显示「已确认可再分发」，且必须同时提供
    `licenseBasis`（写明依据的条款）与 `source.termsUrl`（条款链接）
  - 两者都**不等于**进入公有领域或放弃著作权，不得使用更强的表述
- `source.type` 目前恒为 `generated`（预留 `photograph` 供后续投稿）

## 9. 第一阶段交付量

脸 5 张 + 姿势 5 张 + 服装 5 张 = **15 张**。第二阶段（扩至 100 张：脸 30 / 姿势 30 / 服装 40）不在本次范围内。
