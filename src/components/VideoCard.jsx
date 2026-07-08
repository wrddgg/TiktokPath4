import React, { useRef, useEffect } from 'react'
import FooterLeft from './FooterLeft.jsx'
import FooterRight from './FooterRight.jsx'
import './VideoCard.css'

const VideoCard = (props) => {
  const {
    index, url, username, description, song,
    likes, shares, comments, saves, profilePic,
    setVideoRef, autoplay, isActive, onBuyEntry
  } = props
  const localRef = useRef(null)

  useEffect(() => {
    if (autoplay && localRef.current) {
      localRef.current.play().catch(() => {})
    }
  }, [autoplay])

  const onVideoPress = () => {
    if (!isActive) return // 冻结模式下不响应点击
    const v = localRef.current
    if (!v) return
    if (v.paused) { v.play().catch(() => {}) } else { v.pause() }
  }

  return (
    <div className="video">
      <video
        className="player"
        onClick={onVideoPress}
        ref={(ref) => {
          localRef.current = ref
          setVideoRef(ref)
        }}
        loop
        muted
        playsInline
        src={url}
      />
      {isActive && (
        <div className="bottom-controls">
          <div className="footer-left">
            <FooterLeft username={username} description={description} song={song} />
          </div>
          <div className="footer-right">
            <FooterRight
              likes={likes}
              shares={shares}
              comments={comments}
              saves={saves}
              profilePic={profilePic}
              onBuyEntry={onBuyEntry}
            />
          </div>
        </div>
      )}
    </div>
  )
}

export default VideoCard
