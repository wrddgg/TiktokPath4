// 生产环境（Nginx 代理 /api/ → 后端）用相对路径，开发环境用 localhost:8000
const API_BASE = import.meta.env.VITE_API_BASE || ''

/**
 * 发起相似商品搜索
 * @param {Blob|null} imageBlob - 冻结帧图片（跨域抓帧失败时为 null，后端降级 mock）
 * @param {object} query - SearchRequest 查询参数
 */
export async function searchSimilar(imageBlob, query) {
  const form = new FormData()
  if (imageBlob) {
    form.append('file', imageBlob, 'frame.jpg')
  } else {
    // 跨域抓帧失败，发一个空 blob，后端会用 mock 降级
    form.append('file', new Blob([], { type: 'image/jpeg' }), 'frame.jpg')
  }
  form.append('request_json', JSON.stringify(query))

  const res = await fetch(`${API_BASE}/api/search`, {
    method: 'POST',
    body: form,
  })
  if (!res.ok) throw new Error(`search failed: ${res.status}`)
  return res.json()
}

/**
 * refine：更便宜/同风格/更日常/换颜色
 */
export async function refineSearch(query) {
  const res = await fetch(`${API_BASE}/api/refine`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(query),
  })
  if (!res.ok) throw new Error(`refine failed: ${res.status}`)
  return res.json()
}

/**
 * 低置信度澄清
 */
export async function clarifyCategory(requestId, answer) {
  const res = await fetch(`${API_BASE}/api/clarify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ request_id: requestId, answer }),
  })
  if (!res.ok) throw new Error(`clarify failed: ${res.status}`)
  return res.json()
}

/**
 * 行为埋点（对齐创意文档 6.2 北极星指标）
 */
export async function reportFeedback(payload) {
  try {
    await fetch(`${API_BASE}/api/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch {
    // 埋点失败不影响体验
  }
}
