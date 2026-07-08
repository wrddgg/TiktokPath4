import React, { useRef, useState } from 'react'
import './SelectionLayer.css'

/**
 * 冻结帧 + 点选层（透明覆盖在原已暂停的视频上方）
 *
 * 原视频元素仍留在 feed 容器里（已暂停在当前帧），
 * 本层做全屏透明覆盖，只负责接收点选坐标 + 绘制选区标记。
 * 不移动 DOM、不截 canvas，彻底避免黑屏/闪烁/跨域问题。
 *
 * 支持 point（点一下）和 box（拖拽框选）
 */
export default function SelectionLayer({ selection, onSelect, interactive }) {
  const wrapRef = useRef(null)
  const [mode, setMode] = useState('point')
  const [dragStart, setDragStart] = useState(null)
  const [tempBox, setTempBox] = useState(null)

  const getNorm = (e) => {
    const rect = wrapRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    const cx = e.clientX ?? e.touches?.[0]?.clientX
    const cy = e.clientY ?? e.touches?.[0]?.clientY
    return {
      x: Math.max(0, Math.min(1, (cx - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (cy - rect.top) / rect.height)),
    }
  }

  const handleDown = (e) => {
    if (!interactive) return
    e.preventDefault()
    const p = getNorm(e)
    if (mode === 'point') {
      onSelect({ type: 'point', x: p.x, y: p.y })
    } else {
      setDragStart(p)
      setTempBox({ x: p.x, y: p.y, w: 0, h: 0 })
    }
  }

  const handleMove = (e) => {
    if (!interactive || !dragStart) return
    const p = getNorm(e)
    setTempBox({
      x: Math.min(dragStart.x, p.x),
      y: Math.min(dragStart.y, p.y),
      w: Math.abs(p.x - dragStart.x),
      h: Math.abs(p.y - dragStart.y),
    })
  }

  const handleUp = () => {
    if (!interactive || !dragStart) return
    if (tempBox && tempBox.w > 0.03 && tempBox.h > 0.03) {
      onSelect({ type: 'box', ...tempBox })
    }
    setDragStart(null)
    setTempBox(null)
  }

  return (
    <div ref={wrapRef} className="selection-wrap">
      {/* 顶部模式切换 */}
      {interactive && (
        <div className="mode-switch">
          <button
            className={mode === 'point' ? 'active' : ''}
            onClick={() => setMode('point')}
          >
            点选
          </button>
          <button
            className={mode === 'box' ? 'active' : ''}
            onClick={() => setMode('box')}
          >
            框选
          </button>
        </div>
      )}

      {/* 点选覆盖层 */}
      {interactive && (
        <div
          className="select-overlay"
          onMouseDown={handleDown}
          onMouseMove={handleMove}
          onMouseUp={handleUp}
          onTouchStart={handleDown}
          onTouchMove={handleMove}
          onTouchEnd={handleUp}
        />
      )}

      {/* 临时拖拽框 */}
      {tempBox && (
        <div
          className="selection-box"
          style={{
            left: `${tempBox.x * 100}%`,
            top: `${tempBox.y * 100}%`,
            width: `${tempBox.w * 100}%`,
            height: `${tempBox.h * 100}%`,
          }}
        />
      )}

      {/* 已选标记 */}
      {selection && !tempBox && (
        selection.type === 'point' ? (
          <div
            className="selection-point"
            style={{ left: `${selection.x * 100}%`, top: `${selection.y * 100}%` }}
          />
        ) : (
          <div
            className="selection-box"
            style={{
              left: `${selection.x * 100}%`,
              top: `${selection.y * 100}%`,
              width: `${selection.w * 100}%`,
              height: `${selection.h * 100}%`,
            }}
          />
        )
      )}
    </div>
  )
}
