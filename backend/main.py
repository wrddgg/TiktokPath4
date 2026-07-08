"""
Swipe-to-Own 后端服务
- 通过 subprocess 调用 .vendor/1688-product-find/cli.py 做以图搜货
- AK 未配置或调用失败时降级返回 mock 数据，保证原型随时可演示
"""
import json
import os
import subprocess
import sys
import uuid
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, UploadFile, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel
import urllib.parse
import urllib.request

# ── 路径 ──
ROOT = Path(__file__).resolve().parent.parent
VENDOR_CLI = ROOT / ".vendor" / "1688-product-find" / "cli.py"
TEMP_DIR = ROOT / "backend" / "tmp"
TEMP_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Swipe-to-Own API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ────────────────────────────────────────────────────────────
# 数据模型（对齐创意文档 5.2 query schema）
# ────────────────────────────────────────────────────────────
class Region(BaseModel):
    type: str  # "point" | "box"
    x: float
    y: float
    w: float | None = None
    h: float | None = None


class SearchRequest(BaseModel):
    video_id: str
    timestamp_ms: int
    region: Region
    category: dict | None = None  # {primary, alternatives, confidence}
    explicit_constraints: dict | None = None  # {budget, color, style, scene}
    visual_attributes: dict | None = None  # {color, length, silhouette, ...}
    normalized_tags: list[str] | None = None
    uncertainty: dict | None = None
    parent_request_id: str | None = None  # refine 时关联原请求


class ClarifyAnswer(BaseModel):
    request_id: str
    answer: str  # 用户选择的类目


# ────────────────────────────────────────────────────────────
# 1688 CLI 调用
# ────────────────────────────────────────────────────────────
# Windows 默认 GBK 编码，1688 CLI 输出含 emoji（✅❌）会崩溃，
# 必须强制子进程用 UTF-8 IO 编码。
_SUBPROCESS_ENV = {**os.environ, "PYTHONIOENCODING": "utf-8"}


def _crop_by_region(image_path: str, region: Region, out_path: str) -> str:
    """按用户选区裁剪图片，返回裁剪后路径"""
    try:
        from PIL import Image
    except ImportError:
        return image_path

    img = Image.open(image_path)
    w, h = img.size
    if region.type == "box" and region.w and region.h:
        left = int(max(0, region.x - region.w / 2) * w)
        top = int(max(0, region.y - region.h / 2) * h)
        right = int(min(1, region.x + region.w / 2) * w)
        bottom = int(min(1, region.y + region.h / 2) * h)
    else:
        # point：以点为中心，取 30% 宽高区域
        cx, cy = region.x, region.y
        box_w = int(w * 0.30)
        box_h = int(h * 0.30)
        left = int(max(0, cx * w - box_w / 2))
        top = int(max(0, cy * h - box_h / 2))
        right = int(min(w, cx * w + box_w / 2))
        bottom = int(min(h, cy * h + box_h / 2))

    if right <= left or bottom <= top:
        return image_path
    cropped = img.crop((left, top, right, bottom))
    cropped.save(out_path, "JPEG", quality=85)
    return out_path


def call_1688_image_search(image_path: str, limit: int = 10, category: str = "") -> dict:
    """调用 1688 CLI 的 image_search，返回 {success, data}"""
    if not VENDOR_CLI.exists():
        return {"success": False, "error": "vendor cli not found"}

    cmd = [
        sys.executable, str(VENDOR_CLI),
        "image_search",
        "--image", image_path,
        "--limit", str(limit),
    ]
    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=60,
            encoding="utf-8", errors="replace",
            env=_SUBPROCESS_ENV,
        )
        if result.returncode != 0 or not result.stdout.strip():
            return {"success": False, "error": result.stderr[:500] or "empty output"}

        # CLI 输出可能带 CLIXML 包装，提取第一个 JSON
        out = result.stdout.strip()
        # 找第一个 { 到最后一个 }
        start = out.find("{")
        end = out.rfind("}")
        if start == -1 or end == -1:
            return {"success": False, "error": "no json in output"}
        payload = json.loads(out[start:end + 1])
        return {"success": payload.get("success", False), "data": payload}
    except subprocess.TimeoutExpired:
        return {"success": False, "error": "timeout"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def call_1688_text_search(query: str, limit: int = 10, sort: str | None = None) -> dict:
    """调用 1688 CLI 的 text_search，用于 refine（更便宜/同风格等）"""
    if not VENDOR_CLI.exists():
        return {"success": False, "error": "vendor cli not found"}

    cmd = [sys.executable, str(VENDOR_CLI), "text_search", "--query", query, "--limit", str(limit)]
    if sort:
        cmd += ["--sort", sort]

    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=60,
            encoding="utf-8", errors="replace",
            env=_SUBPROCESS_ENV,
        )
        if result.returncode != 0 or not result.stdout.strip():
            return {"success": False, "error": result.stderr[:500] or "empty output"}
        out = result.stdout.strip()
        start = out.find("{")
        end = out.rfind("}")
        if start == -1 or end == -1:
            return {"success": False, "error": "no json in output"}
        payload = json.loads(out[start:end + 1])
        return {"success": payload.get("success", False), "data": payload}
    except Exception as e:
        return {"success": False, "error": str(e)}


# ────────────────────────────────────────────────────────────
# 1688 结果 → 候选卡格式转换（对齐创意文档 4.3）
# ────────────────────────────────────────────────────────────
def _extract_products(payload: dict) -> list[dict]:
    """
    从 1688 CLI 返回的嵌套 JSON 中提取 similar_products 列表。
    CLI 输出结构：{success, markdown, data: {data: {success, similar_products: [...]}}}
    兼容不同层级。
    """
    if not isinstance(payload, dict):
        return []
    # 尝试多层 data 嵌套
    d = payload
    for _ in range(4):
        if "similar_products" in d and isinstance(d["similar_products"], list):
            return d["similar_products"]
        if "data" in d and isinstance(d["data"], dict):
            d = d["data"]
        else:
            break
    return []


def _fix_url(url: str) -> str:
    """补全 1688 返回的无协议头 URL（如 //cbu01.alicdn.com/...）"""
    if not url:
        return ""
    url = str(url).strip()
    if url.startswith("//"):
        return "https:" + url
    if url.startswith("/"):
        return "https://cbu01.alicdn.com" + url
    return url


def _proxy_image_url(original_url: str) -> str:
    """把外部图片 URL 转成本地代理地址，避免浏览器 Referer 防盗链"""
    if not original_url:
        return ""
    fixed = _fix_url(original_url)
    encoded = urllib.parse.quote(fixed, safe="")
    return f"/api/proxy-image?url={encoded}"


def products_to_candidates(products: list[dict], query_attrs: dict | None = None) -> list[dict]:
    """把 1688 返回的商品转成候选卡 schema"""
    candidates = []
    for i, p in enumerate(products[:3]):
        # 相似点 / 未满足点：从 selling_points 和 service_infos 提炼
        selling = [sp.get("value", "") for sp in p.get("selling_points", []) if sp.get("value")]
        services = [s.get("value", "") for s in p.get("service_infos", []) if s.get("value")]

        score = p.get("similarity_score") or p.get("score", 0)
        try:
            score = float(score)
        except (TypeError, ValueError):
            score = 0.0

        # 置信度档位
        if score >= 0.9:
            confidence = "疑似同款"
        elif score >= 0.7:
            confidence = "风格近似"
        else:
            confidence = "条件不明"

        # 图片 URL：兼容多种字段名，补全协议头，并走本地代理避免防盗链
        image_url = _proxy_image_url(
            p.get("image_url") or p.get("imageUrl") or p.get("img_url") or ""
        )
        detail_url = p.get("detail_url") or p.get("detailUrl") or ""
        if not detail_url and p.get("product_id"):
            detail_url = f"https://detail.1688.com/offer/{p['product_id']}.html"

        candidates.append({
            "rank": i + 1,
            "product_id": str(p.get("product_id") or p.get("itemId", "")),
            "title": p.get("title", "未知商品"),
            "image_url": image_url,
            "detail_url": detail_url,
            "price": p.get("price") or p.get("currentPrice", 0),
            "supplier": p.get("supplier") or p.get("company", "未知供应商"),
            "similarity_score": round(score, 4),
            "confidence": confidence,
            "similar_points": selling[:3] if selling else ["款式相近"],
            "unmet_points": _infer_unmet(p, query_attrs),
            "service_tags": services[:3],
            "sold_count": p.get("sold_count") or p.get("soldOut", 0),
            "source": "1688",
        })
    return candidates


def _infer_unmet(p: dict, query_attrs: dict | None) -> list[str]:
    """根据查询属性推断未满足点"""
    unmet = []
    if not query_attrs:
        return ["材质未知", "实物色差需确认"]
    color = query_attrs.get("color")
    if color and color not in (p.get("title", "") + str(p.get("sku_title", ""))):
        unmet.append(f"颜色可能不完全一致（目标{color}）")
    budget = query_attrs.get("budget")
    price = p.get("price") or p.get("currentPrice", 0)
    try:
        if budget and float(price) > float(budget):
            unmet.append(f"价格略高于预算（预算{budget}元）")
    except (TypeError, ValueError):
        pass
    if not unmet:
        unmet.append("材质与实物需进一步确认")
    return unmet


# ────────────────────────────────────────────────────────────
# Mock 降级数据（AK 不可用时）
# ────────────────────────────────────────────────────────────
MOCK_CANDIDATES = [
    {
        "rank": 1,
        "product_id": "mock_001",
        "title": "米色长款通勤风衣外套女春秋双排扣显瘦",
        "image_url": "https://images.unsplash.com/photo-1591047139829-d91aecb6caea?w=400",
        "detail_url": "https://detail.1688.com/offer/mock_001.html",
        "price": 168.0,
        "supplier": "杭州某服饰有限公司",
        "similarity_score": 0.94,
        "confidence": "疑似同款",
        "similar_points": ["米色长款", "双排扣通勤版型", "翻领设计"],
        "unmet_points": ["面料为聚酯纤维（原视频疑似羊毛）", "无腰带配件"],
        "service_tags": ["48小时发货", "7天无理由"],
        "sold_count": 3200,
        "source": "1688(mock)",
    },
    {
        "rank": 2,
        "product_id": "mock_002",
        "title": "卡其色中长款风衣女宽松显瘦腰带外套",
        "image_url": "https://images.unsplash.com/photo-1539109136881-3be0616acf4b?w=400",
        "detail_url": "https://detail.1688.com/offer/mock_002.html",
        "price": 98.0,
        "supplier": "广州某服装厂",
        "similarity_score": 0.81,
        "confidence": "风格近似",
        "similar_points": ["卡其色系接近", "中长款通勤风", "含腰带"],
        "unmet_points": ["颜色偏深偏卡其", "长度略短于视频款"],
        "service_tags": ["包邮", "48小时发货"],
        "sold_count": 8600,
        "source": "1688(mock)",
    },
    {
        "rank": 3,
        "product_id": "mock_003",
        "title": "浅杏色长款风衣外套女春秋简约百搭",
        "image_url": "https://images.unsplash.com/photo-1485518882345-15568b007407?w=400",
        "detail_url": "https://detail.1688.com/offer/mock_003.html",
        "price": 258.0,
        "supplier": "嘉兴某品牌代工厂",
        "similarity_score": 0.73,
        "confidence": "风格近似",
        "similar_points": ["浅杏色接近米色", "长款简约设计", "版型宽松"],
        "unmet_points": ["价格略高", "无双排扣细节"],
        "service_tags": ["7天无理由", "品质保障"],
        "sold_count": 1200,
        "source": "1688(mock)",
    },
]


def _mock_by_category(category: str | None, visual_attrs: dict | None) -> list[dict]:
    """根据 category 和视觉属性生成更合理的 mock 候选"""
    cat = (category or "服饰").strip()
    color = (visual_attrs or {}).get("color", "")
    style = (visual_attrs or {}).get("style", "")
    length = (visual_attrs or {}).get("length", "")
    silhouette = (visual_attrs or {}).get("silhouette", "")

    title_parts = [p for p in [color, length, silhouette, style, cat] if p]
    if not title_parts:
        title_parts = ["时尚", "服饰"]

    base = [
        {
            "rank": 1,
            "product_id": "mock_001",
            "title": f"{' '.join(title_parts[:3])} 女款",
            "image_url": "https://images.unsplash.com/photo-1591047139829-d91aecb6caea?w=400",
            "detail_url": "https://detail.1688.com/offer/mock_001.html",
            "price": 168.0,
            "supplier": "杭州某服饰有限公司",
            "similarity_score": 0.94,
            "confidence": "疑似同款",
            "similar_points": [f"{color}系" if color else "颜色相近", f"{style}风格" if style else "风格近似"],
            "unmet_points": ["材质与实物需进一步确认"],
            "service_tags": ["48小时发货", "7天无理由"],
            "sold_count": 3200,
            "source": "1688(mock)",
        },
        {
            "rank": 2,
            "product_id": "mock_002",
            "title": f"{' '.join(title_parts[:2])} 简约版",
            "image_url": "https://images.unsplash.com/photo-1539109136881-3be0616acf4b?w=400",
            "detail_url": "https://detail.1688.com/offer/mock_002.html",
            "price": 98.0,
            "supplier": "广州某服装厂",
            "similarity_score": 0.81,
            "confidence": "风格近似",
            "similar_points": [f"{style}风格" if style else "风格近似", "性价比高"],
            "unmet_points": ["细节可能与原款有差异"],
            "service_tags": ["包邮", "48小时发货"],
            "sold_count": 8600,
            "source": "1688(mock)",
        },
        {
            "rank": 3,
            "product_id": "mock_003",
            "title": f"{' '.join(title_parts[:3])} 经典款",
            "image_url": "https://images.unsplash.com/photo-1485518882345-15568b007407?w=400",
            "detail_url": "https://detail.1688.com/offer/mock_003.html",
            "price": 258.0,
            "supplier": "嘉兴某品牌代工厂",
            "similarity_score": 0.73,
            "confidence": "风格近似",
            "similar_points": ["经典版型", "品质保障"],
            "unmet_points": ["价格略高", "材质需确认"],
            "service_tags": ["7天无理由", "品质保障"],
            "sold_count": 1200,
            "source": "1688(mock)",
        },
    ]
    return base


# 类目同义词映射：用于判断 1688 图片搜结果是否与用户选区类目相关
_CATEGORY_SYNONYMS = {
    "上衣": ["上衣", "T恤", "t恤", "衬衫", "卫衣", "针织", "毛衣", "打底"],
    "外套": ["外套", "风衣", "大衣", "夹克", "棉衣", "羽绒服", "西装", "开衫"],
    "裤子": ["裤子", "长裤", "牛仔裤", "休闲裤", "阔腿裤", "西裤", "短裤", "工装裤"],
    "裙装": ["裙", "连衣裙", "半身裙", "长裙", "短裙", "包臀裙", "a字裙", "百褶"],
    "鞋子": ["鞋", "运动鞋", "板鞋", "高跟鞋", "靴", "凉鞋", "拖鞋", "帆布鞋"],
    "包": ["包", "背包", "手提", "单肩", "双肩", "钱包", "挎包", "斜挎"],
    "眼镜": ["眼镜", "墨镜", "太阳镜", "镜框"],
    "帽子": ["帽", "棒球帽", "渔夫帽", "遮阳帽", "贝雷帽"],
    "配饰": ["项链", "耳环", "戒指", "手链", "围巾", "腰带", "领带", "胸针"],
}


def _is_category_relevant(title: str, category: str) -> bool:
    """判断商品标题是否与用户选区类目相关"""
    if not category or not title:
        return False
    cat = category.strip()
    # 精确匹配类目
    if cat in title:
        return True
    # 同义词匹配
    for key, synonyms in _CATEGORY_SYNONYMS.items():
        if cat == key or cat in synonyms:
            if any(syn in title for syn in synonyms):
                return True
    return False


def _should_image_fallback(products: list[dict], category: str) -> bool:
    """
    判断图片搜结果质量是否需要 fallback 到文本搜：
    1. 结果为空
    2. 最高相似度 < 0.55
    3. top-3 商品标题与类目完全无关
    """
    if not products:
        return True
    best = 0.0
    relevant_count = 0
    for p in products[:3]:
        score = p.get("similarity_score") or p.get("score", 0)
        try:
            score = float(score)
        except (TypeError, ValueError):
            score = 0.0
        best = max(best, score)
        title = p.get("title", "")
        if _is_category_relevant(title, category):
            relevant_count += 1
    # 相似度过低
    if best < 0.55:
        return True
    # top-3 无一与类目相关
    if category and relevant_count == 0:
        return True
    return False


def _build_text_query(req: SearchRequest) -> str:
    """根据 request 中的 category 和视觉属性构造文本搜索词"""
    parts = []
    if req.category:
        parts.append(req.category.get("primary", ""))
    if req.visual_attributes:
        attrs = req.visual_attributes
        for key in ["color", "length", "silhouette", "style"]:
            v = attrs.get(key)
            if v:
                parts.append(v)
    if req.normalized_tags:
        parts.extend(req.normalized_tags)
    return " ".join(p for p in parts if p) or "服饰"


def mock_search_response(request: SearchRequest, request_id: str) -> dict:
    """构造 mock 降级响应（AK 不可用或图片搜失败时）"""
    cat = request.category.get("primary", "服饰") if request.category else "服饰"
    attrs = request.visual_attributes or {}
    return {
        "request_id": request_id,
        "status": "ok",
        "source": "mock",
        "object_recognition": {
            "category": request.category or {"primary": cat, "alternatives": ["上衣", "外套", "连衣裙"], "confidence": 0.86},
            "visual_attributes": request.visual_attributes or {
                "color": attrs.get("color", "米色"),
                "length": attrs.get("length", "长款"),
                "silhouette": attrs.get("silhouette", "宽松"),
                "style": attrs.get("style", "通勤"),
            },
        },
        "candidates": _mock_by_category(cat, attrs),
        "need_clarify": False,
    }


# ────────────────────────────────────────────────────────────
# API 路由
# ────────────────────────────────────────────────────────────
@app.get("/api/health")
async def health():
    return {"status": "ok", "vendor_cli_exists": VENDOR_CLI.exists()}


@app.get("/api/proxy-image")
async def proxy_image(url: str = Query(..., description="要代理的外部图片 URL")):
    """代理外部商品图片，解决浏览器 Referer 防盗链问题"""
    if not url:
        raise HTTPException(status_code=400, detail="missing url")
    target = _fix_url(url)
    try:
        req = urllib.request.Request(
            target,
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/120.0.0.0 Safari/537.36"
                ),
                "Referer": "https://detail.1688.com/",
                "Accept": "image/webp,image/apng,image/*,*/*;q=0.8",
            },
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            content_type = resp.headers.get("Content-Type", "image/jpeg")
            return StreamingResponse(resp, media_type=content_type)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"proxy failed: {e}")


@app.post("/api/search")
async def search(file: UploadFile = File(...), request_json: str = ""):
    """
    核心接口：接收冻结帧图片 + 查询参数，返回 Top-3 候选。
    前端把 SearchRequest 作为 JSON 字符串放进 request_json 表单字段。
    """
    request_id = str(uuid.uuid4())
    try:
        req = SearchRequest.model_validate_json(request_json) if request_json else None
    except Exception:
        req = None

    # 保存上传图片到临时文件
    img_bytes = await file.read()
    if not img_bytes:
        raise HTTPException(status_code=400, detail="empty image")
    suffix = ".jpg"
    if file.content_type and "png" in file.content_type:
        suffix = ".png"
    tmp_path = TEMP_DIR / f"{request_id}{suffix}"
    with open(tmp_path, "wb") as f:
        f.write(img_bytes)

    # 前端已经按选区裁剪了图片（考虑了 object-fit: cover 偏移），
    # 后端直接用前端传来的裁剪后图片，不再二次裁剪
    crop_path = tmp_path

    # 调用 1688 image_search
    category = req.category.get("primary", "") if req and req.category else ""
    result = call_1688_image_search(str(crop_path), limit=10, category=category)

    # 清理临时文件
    try:
        Path(tmp_path).unlink(missing_ok=True)
    except Exception:
        pass

    if not result["success"]:
        # 降级 mock
        if req:
            return mock_search_response(req, request_id)
        return {
            "request_id": request_id,
            "status": "degraded",
            "source": "mock",
            "error": result.get("error", "unknown"),
            "candidates": MOCK_CANDIDATES,
            "need_clarify": False,
        }

    data = result["data"]
    products = _extract_products(data)
    query_attrs = req.explicit_constraints if req else None

    # 如果图片搜结果质量差（空、低相似度、或与类目无关），fallback 到文本搜
    if _should_image_fallback(products, category) and req:
        text_query = _build_text_query(req)
        text_result = call_1688_text_search(text_query, limit=10)
        if text_result["success"]:
            text_products = _extract_products(text_result["data"])
            if text_products:
                products = text_products
                # 标记 source 为 text_search，但仍是 1688 真实数据
                return {
                    "request_id": request_id,
                    "status": "ok",
                    "source": "1688(text)",
                    "object_recognition": {
                        "category": req.category if req else {"primary": "外套", "confidence": 0.86},
                        "visual_attributes": req.visual_attributes if req else {"color": "米色", "length": "长款"},
                    },
                    "candidates": products_to_candidates(products, query_attrs),
                    "need_clarify": False,
                    "total_results": len(products),
                    "fallback_reason": "image_search_low_match",
                }

    candidates = products_to_candidates(products, query_attrs)

    if not candidates:
        # 1688 成功但无结果 → 也降级 mock，但按 category 生成
        if req:
            return mock_search_response(req, request_id)
        candidates = MOCK_CANDIDATES

    return {
        "request_id": request_id,
        "status": "ok",
        "source": "1688",
        "object_recognition": {
            "category": req.category if req else {"primary": "外套", "confidence": 0.86},
            "visual_attributes": req.visual_attributes if req else {"color": "米色", "length": "长款"},
        },
        "candidates": candidates,
        "need_clarify": False,
        "total_results": len(products),
    }



@app.post("/api/refine")
async def refine(request: SearchRequest):
    """refine：更便宜/同风格/更日常/换颜色，生成新 request_id"""
    request_id = str(uuid.uuid4())
    parent = request.parent_request_id

    # 根据 explicit_constraints 构造 query
    constraints = request.explicit_constraints or {}
    tags = request.normalized_tags or []
    query_parts = []
    if request.category:
        query_parts.append(request.category.get("primary", "外套"))
    query_parts.extend(tags)
    color = constraints.get("color")
    if color:
        query_parts.append(color)
    style = constraints.get("style")
    if style:
        query_parts.append(style)
    query = " ".join(query_parts) if query_parts else "米色长款外套"

    sort = None
    if constraints.get("budget"):
        sort = "price_asc"

    result = call_1688_text_search(query, limit=10, sort=sort)

    if not result["success"]:
        return {
            "request_id": request_id,
            "parent_request_id": parent,
            "status": "degraded",
            "source": "mock",
            "error": result.get("error"),
            "candidates": MOCK_CANDIDATES,
        }

    data = result["data"]
    products = _extract_products(data)
    candidates = products_to_candidates(products, request.explicit_constraints)

    if not candidates:
        candidates = MOCK_CANDIDATES

    return {
        "request_id": request_id,
        "parent_request_id": parent,
        "status": "ok",
        "source": "1688",
        "candidates": candidates,
        "total_results": len(products),
    }


@app.post("/api/clarify")
async def clarify(answer: ClarifyAnswer):
    """低置信度澄清：用户选定类目后重新检索"""
    request_id = str(uuid.uuid4())
    result = call_1688_text_search(answer.answer, limit=10)

    if not result["success"]:
        return {
            "request_id": request_id,
            "parent_request_id": answer.request_id,
            "status": "degraded",
            "source": "mock",
            "candidates": MOCK_CANDIDATES,
        }

    data = result["data"]
    products = _extract_products(data)
    candidates = products_to_candidates(products)

    if not candidates:
        candidates = MOCK_CANDIDATES

    return {
        "request_id": request_id,
        "parent_request_id": answer.request_id,
        "status": "ok",
        "source": "1688",
        "candidates": candidates,
    }


@app.post("/api/feedback")
async def feedback(payload: dict):
    """用户行为埋点：查看商品/收藏/外跳/像可接受（对齐创意文档 6.2 北极星指标）"""
    # 原型阶段只记录日志
    print(f"[FEEDBACK] {json.dumps(payload, ensure_ascii=False)}")
    return {"status": "recorded"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
