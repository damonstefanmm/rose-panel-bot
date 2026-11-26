import React, { useEffect, useState } from 'react';
import { RefreshCw, Trophy } from 'lucide-react';
import { apiRequest } from '../lib/api.js';
import { Avatar } from './Emblems.jsx';

const MEDALS = ['🥇', '🥈', '🥉'];

export default function LeaderboardTab({ currencyName = '积分', onToast }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const res = await apiRequest('/api/checkin/leaderboard');
        setItems(res.items || []);
      } catch (err) {
        onToast(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="card empty-state">
        <RefreshCw size={20} className="spin" color="var(--accent)" />
        <div style={{ marginTop: 8 }}>正在加载排行榜…</div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Trophy size={15} color="var(--accent)" /> 群成员{currencyName}榜
        </span>
        <span className="stub-label">TOP {items.length}</span>
      </div>

      {items.length === 0 ? (
        <div className="empty-state">暂时还没有成员打卡，去首页签个到占领榜首吧 🌸</div>
      ) : (
        items.map((item, idx) => (
          <div className="list-row" key={item.userId}>
            <div
              style={{
                width: 26,
                textAlign: 'center',
                fontWeight: 800,
                fontSize: idx < 3 ? 18 : 13,
                color: 'var(--text-muted)',
              }}
            >
              {MEDALS[idx] || idx + 1}
            </div>
            <Avatar userId={item.userId} name={item.displayName} size="sm" />
            <div className="row-main">
              <div className="row-title" style={{ fontSize: 14 }}>
                {item.displayName}
                <span className="pill rose" style={{ padding: '2px 7px', fontSize: 10 }}>
                  Lv.{item.level}
                </span>
              </div>
              <div className="row-desc">
                连签 {item.streak} 天 · 徽章 {item.badgeCount || 0} 枚
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontWeight: 800, color: 'var(--accent)', fontSize: 15 }}>
                {item.points}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{currencyName}</div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
