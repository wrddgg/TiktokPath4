import React, { useState } from 'react'
import './CandidatePanel.css'

/**
 * Top-3 候选卡面板（对齐创意文档 4.3）
 */
export default function CandidatePanel({ candidates, onRefine, onShuffle, onClose, onAction, refineUsed }) {
  const [favorites, setFavorites] = useState(new Set())

  const toggleFav = (pid) => {
    setFavorites(prev => {
      const next = new Set(prev)
      if (next.has(pid)) {
        next.delete(pid)
      } else {
        next.add(pid)
        const c = candidates.find(c => c.product_id === pid)
        if (c) onAction(c, 'favorite')
      }
      return next
    })
  }

  return (
    <div className="candidate-panel">
      <div className="panel-header">
        <span className="panel-title">
          相似可买候选 <span className="panel-count">Top {candidates.length}</span>
        </span>
        <div className="panel-actions">
          <button onClick={onShuffle} className="panel-btn">换一批</button>
          <button onClick={onClose} className="panel-btn">关闭</button>
        </div>
      </div>

      <div className="candidate-scroll">
        {candidates.map((c) => (
          <CandidateCard
            key={c.product_id + c.rank}
            candidate={c}
            isFav={favorites.has(c.product_id)}
            onFav={() => toggleFav(c.product_id)}
            onView={() => onAction(c, 'view_detail')}
            onAccept={() => onAction(c, 'accept')}
          />
        ))}
      </div>

      <div className="refine-bar">
        <span className="refine-label">调整：</span>
        <RefineChip label="更便宜" disabled={refineUsed} onClick={() => onRefine('cheaper')} />
        <RefineChip label="同风格" disabled={refineUsed} onClick={() => onRefine('sameStyle')} />
        <RefineChip label="更日常" disabled={refineUsed} onClick={() => onRefine('casual')} />
        <RefineChip label="换颜色" disabled={refineUsed} onClick={() => onRefine('color')} />
      </div>

      {refineUsed && (
        <div className="refine-hint">已使用一次调整，可「换一批」刷新</div>
      )}
    </div>
  )
}

function RefineChip({ label, onClick, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled} className={`refine-chip ${disabled ? 'disabled' : ''}`}>
      {label}
    </button>
  )
}

function CandidateCard({ candidate: c, isFav, onFav, onView, onAccept }) {
  const confClass = {
    '疑似同款': 'conf-high',
    '风格近似': 'conf-mid',
    '条件不明': 'conf-low',
  }[c.confidence] || 'conf-low'

  return (
    <div className="candidate-card">
      <div className="card-img-wrap">
        <img src={c.image_url} alt={c.title} loading="lazy" />
        <span className={`conf-badge ${confClass}`}>{c.confidence}</span>
        <span className="score-badge">{(c.similarity_score * 100).toFixed(0)}%相似</span>
        <button onClick={onFav} className="fav-btn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill={isFav ? '#FE2C55' : 'none'} stroke="white" strokeWidth="2">
            <path d="M12 21s-7-4.5-9.5-9C1 9 2.5 5 6 5c2 0 3.5 1 4.5 2.5C11.5 6 13 5 15 5c3.5 0 5 4 3.5 7-2.5 4.5-9.5 9-9.5 9z"/>
          </svg>
        </button>
      </div>

      <div className="card-body">
        <div className="card-title">{c.title}</div>
        <div className="card-price">
          <span className="price">¥{c.price}</span>
          <span className="price-unit">起批价</span>
        </div>
        <div className="card-source">来源：{c.source}</div>

        {c.similar_points?.length > 0 && (
          <div className="card-section">
            <div className="section-label good">✓ 相似点</div>
            <div className="tag-row">
              {c.similar_points.slice(0, 3).map((s, i) => (
                <span key={i} className="tag good">{s}</span>
              ))}
            </div>
          </div>
        )}

        {c.unmet_points?.length > 0 && (
          <div className="card-section">
            <div className="section-label warn">! 不完全满足</div>
            <div className="unmet-text">{c.unmet_points.slice(0, 2).join('；')}</div>
          </div>
        )}

        <div className="card-cta">
          <button onClick={onView} className="cta-primary">查看商品</button>
          <button onClick={onAccept} className="cta-secondary">像这个</button>
        </div>
      </div>
    </div>
  )
}
