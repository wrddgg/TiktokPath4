import React, { useEffect, useState, useRef, useCallback } from 'react'
import './App.css'
import VideoCard from './components/VideoCard.jsx'
import BottomNavbar from './components/BottomNavbar.jsx'
import TopNavbar from './components/TopNavbar.jsx'
import SelectionLayer from './components/SelectionLayer.jsx'
import CandidatePanel from './components/CandidatePanel.jsx'
import ClarifySheet from './components/ClarifySheet.jsx'
import { searchSimilar, refineSearch, clarifyCategory, reportFeedback } from './api.js'

// 视频数据（从 clone 原始数据改造，mp4 用 import 加载适配 Vite）
import video1 from './videos/video1.mp4'
import video2 from './videos/video2.mp4'
import video3 from './videos/video3.mp4'
import video4 from './videos/video4.mp4'

const videoData = [
  {
    url: video1,
    profilePic: 'https://p16-sign-useast2a.tiktokcdn.com/tos-useast2a-avt-0068-giso/9d429ac49d6d18de6ebd2a3fb1f39269~c5_100x100.jpeg',
    username: 'csjackie',
    description: 'Lol nvm #compsci #chatgpt #ai #openai #techtok',
    song: 'Original sound - Famed Flames',
    likes: 430, comments: 13, saves: 23, shares: 1,
    // Swipe-to-Own 预设点选目标（演示用）
    presetTarget: { category: '上衣', x: 0.5, y: 0.4, w: 0.3, h: 0.35, confidence: 0.87,
      attrs: { color: '黑色', length: '短款', silhouette: '修身', style: '休闲' } },
  },
  {
    url: video2,
    profilePic: 'https://p16-sign-va.tiktokcdn.com/tos-maliva-avt-0068/eace3ee69abac57c39178451800db9d5~c5_100x100.jpeg',
    username: 'dailydotdev',
    description: 'Every developer brain @francesco.ciulla #developerjokes #programming',
    song: 'tarawarolin wants you to know this isnt my sound - Chaplain J Rob',
    likes: '13.4K', comments: 3121, saves: 254, shares: 420,
    presetTarget: { category: '外套', x: 0.5, y: 0.45, w: 0.35, h: 0.4, confidence: 0.85,
      attrs: { color: '深色', length: '常规', silhouette: '宽松', style: '休闲' } },
  },
  {
    url: video3,
    profilePic: 'https://p77-sign-va.tiktokcdn.com/tos-maliva-avt-0068/4e6698b235eadcd5d989a665704daf68~c5_100x100.jpeg',
    username: 'wojciechtrefon',
    description: '#programming #softwareengineer #vscode #programmerhumor',
    song: 'help so many people are using my sound - Ezra',
    likes: 5438, comments: 238, saves: 12, shares: 117,
    presetTarget: { category: '上衣', x: 0.5, y: 0.42, w: 0.32, h: 0.32, confidence: 0.90,
      attrs: { color: '灰色', length: '常规', silhouette: '修身', style: '简约' } },
  },
  {
    url: video4,
    profilePic: 'https://p16-sign-va.tiktokcdn.com/tos-maliva-avt-0068/4bda52cf3ad31c728153859262c329db~c5_100x100.jpeg',
    username: 'faruktutkus',
    description: 'Wait for the end | Im RTX 4090 TI | #softwareengineer #codinglife',
    song: 'orijinal ses - Computer Science',
    likes: 9689, comments: 230, saves: 1037, shares: 967,
    presetTarget: { category: '上衣', x: 0.5, y: 0.4, w: 0.3, h: 0.3, confidence: 0.84,
      attrs: { color: '黑色', length: '短款', silhouette: '修身', style: '极客' } },
  },
]

function App() {
  const [videos] = useState(videoData)
  // Swipe-to-Own 状态：feed | frozen | loading | results | clarify
  const [mode, setMode] = useState('feed')
  const [activeIndex, setActiveIndex] = useState(0)
  const [selection, setSelection] = useState(null)
  const [candidates, setCandidates] = useState([])
  const [currentRequestId, setCurrentRequestId] = useState(null)
  const [clarifyOptions, setClarifyOptions] = useState(null)
  const [refineUsed, setRefineUsed] = useState(false)
  const [error, setError] = useState(null)

  const videoRefs = useRef([])

  // IntersectionObserver 自动播放（保留 clone 原逻辑）
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const el = entry.target
          if (entry.isIntersecting) {
            el.play().catch(() => {})
          } else {
            el.pause()
          }
        })
      },
      { root: null, rootMargin: '0px', threshold: 0.6 }
    )
    videoRefs.current.forEach((ref) => ref && observer.observe(ref))
    return () => observer.disconnect()
  }, [videos])

  // ── 点击「我也要」→ 冻结当前视频 ──
  const handleBuyEntry = useCallback((index) => {
    const v = videoRefs.current[index]
    if (v) {
      v.pause()
      // 尝试 seek 到当前帧用于截图（canvas 抓帧）
    }
    setActiveIndex(index)
    setMode('frozen')
    setSelection(null)
    setCandidates([])
    setRefineUsed(false)
    setError(null)
  }, [])

  // ── 抓取当前视频帧（可选：按选区裁剪） ──
  const captureFrame = useCallback(async (index, selection = null) => {
    const v = videoRefs.current[index]
    if (!v) return null
    const canvas = document.createElement('canvas')
    const vw = v.videoWidth || 720
    const vh = v.videoHeight || 1280

    // 计算 object-fit: cover 的裁剪偏移
    // 容器（显示区域）的尺寸用 getBoundingClientRect 获取
    const containerEl = v.parentElement // .video 元素
    const rect = containerEl?.getBoundingClientRect()
    const dispW = rect?.width || vw
    const dispH = rect?.height || vh

    // 视频原始宽高比 vs 显示区域宽高比
    const videoAspect = vw / vh
    const dispAspect = dispW / dispH

    let scale, offsetX, offsetY, visibleW, visibleH
    if (videoAspect > dispAspect) {
      // 视频更宽 → 左右被裁剪
      scale = dispH / vh
      visibleW = vw * scale // 视频在显示区域的实际宽度（缩放后）
      visibleH = dispH
      offsetX = (visibleW - dispW) / 2 // 视频左边超出显示区域的部分（缩放后像素）
      offsetY = 0
    } else {
      // 视频更高 → 上下被裁剪
      scale = dispW / vw
      visibleW = dispW
      visibleH = vh * scale
      offsetX = 0
      offsetY = (visibleH - dispH) / 2
    }

    // 将显示区域归一化坐标 (0~1) 映射到视频原始帧坐标
    // normCoord * dispSize → 显示像素 → +offset → 缩放后视频像素 → /scale → 原始帧像素
    const toFrameX = (nx) => (nx * dispW + offsetX) / scale
    const toFrameY = (ny) => (ny * dispH + offsetY) / scale

    let sx = 0, sy = 0, sw = vw, sh = vh

    if (selection) {
      const { type, x, y, w: selW, h: selH } = selection
      if (type === 'box' && selW && selH) {
        // box 模式：SelectionLayer 里的 x,y 是左上角归一化坐标
        const left = toFrameX(x)
        const top = toFrameY(y)
        const bw = (selW * dispW) / scale
        const bh = (selH * dispH) / scale
        sx = Math.max(0, Math.round(left))
        sy = Math.max(0, Math.round(top))
        sw = Math.min(vw - sx, Math.round(bw))
        sh = Math.min(vh - sy, Math.round(bh))
      } else {
        // point 模式：以点为中心取 30% 区域
        const cx = toFrameX(x)
        const cy = toFrameY(y)
        const bw = (dispW * 0.30) / scale
        const bh = (dispH * 0.30) / scale
        sx = Math.max(0, Math.round(cx - bw / 2))
        sy = Math.max(0, Math.round(cy - bh / 2))
        sw = Math.min(vw - sx, Math.round(bw))
        sh = Math.min(vh - sy, Math.round(bh))
      }
    }

    // 确保裁剪区域有效
    sw = Math.max(50, sw)
    sh = Math.max(50, sh)

    canvas.width = Math.max(sw, 200)
    canvas.height = Math.max(sh, 400)

    const ctx = canvas.getContext('2d')
    try {
      ctx.drawImage(v, sx, sy, sw, sh,
                     0, 0, canvas.width, canvas.height)
      return await new Promise((resolve) => {
        canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.85)
      })
    } catch {
      return null
    }
  }, [])

  // ── 冻结帧上点选 ──
  const handleSelect = useCallback(async (sel) => {
    setSelection(sel)
    setMode('loading')

    const video = videos[activeIndex]
    const preset = video.presetTarget
    const query = {
      video_id: `v${activeIndex + 1}`,
      timestamp_ms: Math.floor(videoRefs.current[activeIndex]?.currentTime * 1000 || 0),
      region: { type: sel.type, x: sel.x, y: sel.y, w: sel.w, h: sel.h },
      category: preset ? {
        primary: preset.category,
        alternatives: ['上衣', '外套', '连衣裙'].filter(c => c !== preset.category),
        confidence: preset.confidence,
      } : null,
      visual_attributes: preset?.attrs || null,
      normalized_tags: preset ? Object.values(preset.attrs) : [],
    }

    try {
      const blob = await captureFrame(activeIndex, sel)
      const res = await searchSimilar(blob, query)
      setCurrentRequestId(res.request_id)

      if (res.need_clarify) {
        setClarifyOptions(res.clarify_options || ['外套', '上衣', '连衣裙'])
        setMode('clarify')
      } else {
        setCandidates(res.candidates || [])
        setMode('results')
      }
    } catch (e) {
      setError(e.message)
      setMode('frozen')
    }
  }, [activeIndex, videos, captureFrame])

  // ── 澄清回答 ──
  const handleClarify = useCallback(async (answer) => {
    setMode('loading')
    try {
      const res = await clarifyCategory(currentRequestId, answer)
      setCurrentRequestId(res.request_id)
      setCandidates(res.candidates || [])
      setMode('results')
    } catch (e) {
      setError(e.message)
      setMode('frozen')
    }
  }, [currentRequestId])

  // ── refine ──
  const handleRefine = useCallback(async (type) => {
    if (refineUsed) return
    setMode('loading')
    const video = videos[activeIndex]
    const preset = video.presetTarget
    const constraints = {}
    const tags = []
    if (type === 'cheaper') constraints.budget = 150
    if (type === 'sameStyle') constraints.style = preset?.attrs?.style || '休闲'
    if (type === 'casual') { constraints.style = '休闲'; tags.push('日常') }
    if (type === 'color') { constraints.color = '黑色'; tags.push('黑色') }

    const query = {
      video_id: `v${activeIndex + 1}`,
      timestamp_ms: 0,
      region: selection,
      category: { primary: preset?.category || '上衣', confidence: 0.8 },
      explicit_constraints: constraints,
      visual_attributes: preset?.attrs || null,
      normalized_tags: tags,
      parent_request_id: currentRequestId,
    }

    try {
      const res = await refineSearch(query)
      setCurrentRequestId(res.request_id)
      setCandidates(res.candidates || [])
      setRefineUsed(true)
      setMode('results')
    } catch (e) {
      setError(e.message)
      setMode('results')
    }
  }, [refineUsed, activeIndex, videos, selection, currentRequestId])

  // ── 换一批 ──
  const handleShuffle = useCallback(() => {
    setCandidates(prev => [...prev].reverse())
  }, [])

  // ── 关闭，回浏览 ──
  const handleClose = useCallback(() => {
    setMode('feed')
    setSelection(null)
    setCandidates([])
    setError(null)
    setRefineUsed(false)
    // 恢复播放
    const v = videoRefs.current[activeIndex]
    v?.play().catch(() => {})
  }, [activeIndex])

  // ── 候选卡行为埋点 ──
  const handleCandidateAction = useCallback((candidate, action) => {
    reportFeedback({
      request_id: currentRequestId,
      candidate_id: candidate.product_id,
      action,
      video_id: `v${activeIndex + 1}`,
    })
    if (action === 'view_detail' || action === 'external_link') {
      window.open(candidate.detail_url, '_blank')
    }
  }, [currentRequestId, activeIndex])

  const isFeedMode = mode === 'feed'

  return (
    <div className="app">
      <div className="container" id="video-container">
        {isFeedMode && <TopNavbar />}

        {videos.map((video, index) => (
          <VideoCard
            key={index}
            index={index}
            username={video.username}
            description={video.description}
            song={video.song}
            likes={video.likes}
            saves={video.saves}
            comments={video.comments}
            shares={video.shares}
            url={video.url}
            profilePic={video.profilePic}
            setVideoRef={(ref) => { videoRefs.current[index] = ref }}
            autoplay={index === 0}
            isActive={isFeedMode}
            onBuyEntry={() => handleBuyEntry(index)}
          />
        ))}

        {isFeedMode && <BottomNavbar />}

        {/* ── Swipe-to-Own 覆盖层（在 container 内部，坐标系与视频一致） ── */}

        {/* 冻结模式下：点选层覆盖在已暂停的视频上方 */}
        {(mode === 'frozen' || mode === 'loading' || mode === 'results' || mode === 'clarify') && (
          <SelectionLayer
            selection={selection}
            onSelect={handleSelect}
            interactive={mode === 'frozen'}
          />
        )}

        {/* 冻结 badge */}
        {mode === 'frozen' && (
          <div className="freeze-badge">已冻结 · 点选你想找的服饰</div>
        )}

        {/* Loading */}
        {mode === 'loading' && (
          <div className="loading-overlay">
            <div className="spinner" />
            <div className="loading-text">
              {selection ? '正在找相似可买款…' : '正在识别…'}
            </div>
          </div>
        )}

        {/* 候选卡 */}
        {mode === 'results' && candidates.length > 0 && (
          <CandidatePanel
            candidates={candidates}
            onRefine={handleRefine}
            onShuffle={handleShuffle}
            onClose={handleClose}
            onAction={handleCandidateAction}
            refineUsed={refineUsed}
          />
        )}

        {/* 澄清弹层 */}
        {mode === 'clarify' && (
          <ClarifySheet
            options={clarifyOptions}
            onAnswer={handleClarify}
          />
        )}

        {/* 错误提示 */}
        {error && mode !== 'loading' && (
          <div className="error-toast">{error}（已用本地数据演示）</div>
        )}
      </div>
    </div>
  )
}

export default App
