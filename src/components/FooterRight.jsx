import React, { useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCirclePlus, faCircleCheck, faHeart, faCommentDots, faBookmark, faShare, faBagShopping } from '@fortawesome/free-solid-svg-icons'
import './FooterRight.css'

function FooterRight({ likes, comments, saves, shares, profilePic, onBuyEntry }) {
  const [liked, setLiked] = useState(false)
  const [saved, setSaved] = useState(false)
  const [followed, setFollowed] = useState(false)

  const parseLikesCount = (count) => {
    if (typeof count === 'string') {
      if (count.endsWith('K')) return parseFloat(count) * 1000
      return parseInt(count)
    }
    return count
  }

  const formatLikesCount = (count) => {
    if (count >= 10000) return (count / 1000).toFixed(1) + 'K'
    return count
  }

  return (
    <div className="footer-right">
      {/* 头像 + 关注 */}
      <div className="sidebar-icon">
        {profilePic ? (
          <img src={profilePic} className='userprofile' alt='Profile' />
        ) : null}
        <FontAwesomeIcon
          icon={followed ? faCircleCheck : faCirclePlus}
          className='useradd'
          onClick={() => setFollowed(true)}
        />
      </div>

      {/* 「我也要」购买入口 - Swipe-to-Own 核心 */}
      <div className="sidebar-icon buy-entry-wrap" onClick={onBuyEntry}>
        <div className="buy-entry-btn">
          <FontAwesomeIcon icon={faBagShopping} />
        </div>
        <p className="buy-entry-label">我也要</p>
      </div>

      {/* 点赞 */}
      <div className="sidebar-icon">
        <FontAwesomeIcon
          icon={faHeart}
          style={{ color: liked ? '#FF0000' : 'white' }}
          onClick={() => setLiked(p => !p)}
        />
        <p>{formatLikesCount(parseLikesCount(likes) + (liked ? 1 : 0))}</p>
      </div>

      {/* 评论 */}
      <div className="sidebar-icon">
        <FontAwesomeIcon icon={faCommentDots} style={{ color: 'white' }} />
        <p>{comments}</p>
      </div>

      {/* 收藏 */}
      <div className="sidebar-icon">
        <FontAwesomeIcon
          icon={faBookmark}
          style={{ color: saved ? '#ffc107' : 'white' }}
          onClick={() => setSaved(p => !p)}
        />
        <p>{saved ? saves + 1 : saves}</p>
      </div>

      {/* 分享 */}
      <div className="sidebar-icon">
        <FontAwesomeIcon icon={faShare} style={{ color: 'white' }} />
        <p>{shares}</p>
      </div>

      {/* 旋转唱片 */}
      <div className="sidebar-icon record">
        <img src="https://static.thenounproject.com/png/934821-200.png" alt='Record' />
      </div>
    </div>
  )
}

export default FooterRight
