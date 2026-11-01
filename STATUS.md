# 项目状态（STATUS）

**最后更新：2026-11-01** · 阶段：**第一阶段（15 张样图）已完成**

本文件供后续接手的 agent 快速了解进度，避免重读完整对话。

---

## 1. 当前状态：已完成，可审查

| 阶段 | 状态 | 产物 |
|---|---|---|
| A 最小规范 | ✅ 完成 | `docs/SPEC.md` |
| B 生成任务与队列 | ✅ 完成 | `docs/GENERATION.md`、`docs/GENERATION_QUEUE.json`（15 个任务） |
| C 样图生成与质检 | ✅ 完成 | 15 张图片全部生成、全部通过人工可检查质检，无 `rejected` |
| D 网页实现 | ✅ 完成 | `index.html`、`assets/app.js`、`assets/style.css` |
| E 验证 | ✅ 完成 | `scripts/validate.mjs`、`scripts/browser_test.mjs`、`scripts/check_order.py`、`docs/QA.md` |
| F 开源准备 | ✅ 完成（授权项待补） | `LICENSE`、`ASSET_LICENSE.md`、`docs/PROVENANCE.md`、`CONTRIBUTING.md`、`README.md`、`docs/OPEN_SOURCE_CHECKLIST.md` |

**实际可用图片数量：15 张**（脸 5 / 姿势 5 / 服装 5）。这是样图版本，**不是完整素材库**。

## 2. 关键实现决策（接续时需知道）

1. **图片角标**：生成平台在每张图右下角压印 `AI生成 / WORKBUDDY`，工具接口无法关闭
   （`footnote` 传空值无效）。经模板匹配验证角标位置在 15 张原图中**完全一致**
   （1024×1024 → x=898/y=954；1024×1536 → x=898/y=1466），因此**只裁掉右侧 128 列**，
   不裁底部，避免切掉鞋尖与裤脚。交付尺寸：脸 896×1024，姿势/服装 896×1536。
2. **授权已核实为可再分发**：服务条款 <https://www.workbuddy.cn/document/term> 第 9.2(d) 条
   确认 Output 归使用者所有（*"you … own the Output"*），可再分发。
   `license` 全部为 `approved`，每条素材记录 `licenseBasis` 与 `source.termsUrl`。
   残留风险（底层模型条款、Output 非独家、第三方权利）见 `ASSET_LICENSE.md` 第 4 节。
3. **图片带「AI生成」标识**：平台角标含第三方品牌词 `WORKBUDDY`，裁掉后**必须补打**
   等价的无品牌「AI生成」标识——服务协议 §6.4(i)/(j) 禁止移除或规避 AI 生成标识。
   裁剪参数只裁右侧 128 列（不裁底部，避免切掉鞋尖裤脚）。
   `scripts/check_label.py` 用「参考渲染 vs 交付件」差异图比对验证，15/15 通过。
4. **数据由脚本生成**：`work/build_data.py` 从 `docs/GENERATION_QUEUE.json` 生成
   `data/references.json`，提示词与生成时间不会与队列脱节。改标签请改脚本里的 `TAGS` 映射后重跑。
5. **无框架、无构建、无 CDN、无外部字体**；统计数字全部从实际数据计算。
6. **浏览器端不存储任何 API 密钥**。

## 3. 运行与验证

```bash
cd male-ai-reference-library
python3 -m http.server 8080          # 然后打开 http://localhost:8080
node scripts/validate.mjs            # 静态校验
node scripts/browser_test.mjs        # 真实浏览器验收（需先启动本地服务）
python3 scripts/check_label.py       # AI 标识与「无其他改动」核验
```

> 环境注意：本机设置了 `HTTP_PROXY`，Chrome 访问 localhost 需要加
> `--no-proxy-server`（已内置在 `scripts/browser_test.mjs`）。
> 本地 HTTP 服务需用后台任务常驻，否则会随 shell 退出而被回收。

## 4. 尚未完成 / 阻塞项

| 项 | 状态 | 说明 |
|---|---|---|
| 生成方服务条款链接 | ✅ 已补 | `source.termsUrl` = <https://www.workbuddy.cn/document/term> |
| `license` 从 `pending-review` 升级为 `approved` | ✅ 已完成 | 依据 §9.2(d)，附 `licenseBasis` |
| 底层模型名称 | ⬜ 待补 | 工具接口未暴露；**保持留空**，不填占位值 |
| LICENSE 署名主体 | ⬜ **待补（唯一硬性项）** | 当前为占位写法「male-ai-reference-library contributors」 |
| 图片元数据中的 AI 标识（隐式标识） | ⬜ 可选 | 当前只有可见标识 |
| outfit-003 背景色统一 | ⬜ 可选 | 该图为暖灰背景，其余四张为白底；形式仍统一为 ghost mannequin |
| 远程仓库创建与推送 | ⬜ 未执行 | 需仓库所有者确认账号、仓库名与可见性后手动执行 |

## 5. 扩到 100 张的下一步

目标：脸 30 / 姿势 30 / 服装 40。

1. **扩词表**：先在 `docs/SPEC.md` 的固定词表中补齐新维度（发型、脸型、体型、季节、
   服装细节等），再生成图片——**顺序不能反**，否则会出现标签不在词表内的素材。
2. **扩生成队列**：在 `docs/GENERATION_QUEUE.json` 中追加任务，每条含完整提示词、
   负面提示词、尺寸与质检检查点。建议**按批次推进**（每类 10 张一批），
   每批先生成 1 张验证构图，再补齐其余，避免一次性浪费额度。
3. **跑处理管线**：`work/process_images.py` 会自动裁角标并导出 WebP；新增任务后重跑即可。
4. **重建数据**：`python3 work/build_data.py`，并在 `work/build_data.py` 的 `TAGS` 映射中
   补上新素材的标签。
5. **重跑验证**：`node scripts/validate.mjs` + `node scripts/browser_test.mjs`。
6. **更新文档**：`README.md` 的数量表与已知限制、`docs/QA.md` 的实测结果、
   `docs/OPEN_SOURCE_CHECKLIST.md` 的勾选状态。

### 建议的下一批内容（尚未生成）

- 脸：戴眼镜 / 络腮胡+中长发 / 光头 / 深肤色 / 精瘦脸 / 方腮 / 中年白发 / 微笑表情
- 姿势：双臂交叉 / 手插口袋 / 靠墙 / 蹲姿 / 俯身 / 转身回头 / 慢跑 / 撑墙 / 坐姿变体（盘腿/椅子侧坐）
- 服装：POLO 衫 / 连帽卫衣 / 风衣 / 背心 / 衬衫外穿针织衫 / 工装裤 / 牛仔裤 / 乐福鞋搭配 /
  皮带与手表细节 / 冬大衣

## 6. 明确不做

- 不创建 GitHub 仓库、不推送远程、不发布、不部署
- 不购买服务或额度
- 不做账号、支付、后台、数据库、在线生图
- 不在无授权确认的情况下声称素材可自由再分发
