# Swipe-to-Own · 短视频购买意图压缩器

> 从"我想要"到"可买候选"——把短视频里的模糊购买冲动，压缩成可点击、可比较、可购买的候选。

基于 [s-shemmee/TikTok-UI-Clone](https://github.com/s-shemmee/TikTok-UI-Clone) (MIT) 改造，嫁接 Swipe-to-Own 购买意图压缩功能。

## 快速开始

### 1. 前端（http://localhost:5173）

```bash
cd c:\Users\HIT\Desktop\大区赛
npm install
npm run dev
```

### 2. 后端（http://localhost:8000）

```bash
cd c:\Users\HIT\Desktop\大区赛\backend
pip install -r requirements.txt
python main.py
```

> 1688 AK 已通过 `.vendor/1688-product-find` 配置好，后端自动调用真实以图搜货 API。
> AK 未配置或调用失败时，后端降级返回 mock 数据，原型仍可完整演示。

## 核心交互路径

```
刷视频（抖音式竖屏全屏 + scroll-snap 滑切 + IntersectionObserver 自动播放）
  → 点右侧栏「我也要」红色按钮
  → 帧冻结
  → point 点选 / box 框选目标服饰
  → 后端调 1688 image_search（以图搜货）
  → Top-3 候选卡（商品图/价格/来源/相似点/未满足点/置信度/CTA）
  → 查看商品（外跳 1688 详情）/ 收藏 / 换一批 / 一次 refine
```

## 项目结构

```
大区赛/
├── src/                           # React + Vite 前端
│   ├── App.jsx                    # 主应用：Feed + 冻结 + 点选 + 候选 状态机
│   ├── api.js                     # 后端 API 客户端
│   ├── videos/                    # 4 个真实 mp4 视频（来自 clone）
│   ├── components/
│   │   ├── VideoCard.jsx          # 视频卡（IntersectionObserver 自动播放）
│   │   ├── FooterLeft.jsx         # 左下：用户名/描述/音乐滚动（原 clone）
│   │   ├── FooterRight.jsx        # 右侧栏：头像/关注/我也要/点赞/评论/收藏/分享/唱片
│   │   ├── TopNavbar.jsx          # 顶部导航（原 clone）
│   │   ├── BottomNavbar.jsx       # 底部导航（原 clone）
│   │   ├── SelectionLayer.jsx     # 冻结帧 + point/box 点选
│   │   ├── CandidatePanel.jsx     # Top-3 候选卡 + refine + 换一批
│   │   └── ClarifySheet.jsx       # 低置信度澄清弹层
│   └── *.css                      # 各组件样式
├── backend/                       # FastAPI 后端
│   ├── main.py                    # search/refine/clarify/feedback 接口
│   └── requirements.txt
├── .vendor/1688-product-find/     # 1688 SDK（已配 AK）
├── 创意.md
└── package.json
```

## API 契约（对齐创意文档 5.2）

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/search` | POST | 冻结帧图片 + query → 1688 image_search → Top-3 |
| `/api/refine` | POST | 一次 refine：更便宜/同风格/更日常/换颜色 |
| `/api/clarify` | POST | 低置信度澄清后重新检索 |
| `/api/feedback` | POST | 行为埋点（北极星指标） |
| `/api/health` | GET | 健康检查 |

## 致谢

- 抖音 UI 基底：[TikTok-UI-Clone](https://github.com/s-shemmee/TikTok-UI-Clone) by s-shemmee (MIT)
- 商品检索：1688 开放平台以图搜货 API
