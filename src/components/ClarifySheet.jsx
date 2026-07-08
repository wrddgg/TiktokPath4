import React from 'react'
import './ClarifySheet.css'

export default function ClarifySheet({ options, onAnswer }) {
  return (
    <div className="clarify-sheet">
      <div className="clarify-title">没太看清你想找哪件</div>
      <div className="clarify-sub">请帮我确认一下目标类目</div>
      <div className="clarify-options">
        {options.map((opt) => (
          <button
            key={opt}
            onClick={() => onAnswer(opt)}
            className="clarify-option"
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  )
}
