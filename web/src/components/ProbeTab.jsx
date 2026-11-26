import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ExternalLink,
  RefreshCw,
  Server,
  Settings,
} from 'lucide-react';
import { apiRequest, formatBytes, formatSpeed, formatUptime } from '../lib/api.js';
import { openExternalUrl } from '../lib/telegram.js';

function meterTone(pct) {
  if (pct >= 90) return 'danger';
  if (pct >= 75) return 'warn';
  return '';
}

export default function ProbeTab({ probeConfig, isAdmin, onOpenSettings, onToast }) {
  const [probe, setProbe] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState('全部');
  const [expandedId, setExpandedId] = useState(null);

  const loadProbe = async (force = false) => {
    try {
      if (force) setRefreshing(true);
      else setLoading(true);
      const res = await apiRequest(`/api/probe${force ? '?force=1' : ''}`);
      setProbe(res);
    } catch (err) {
      onToast(err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadProbe(false);
  }, [probeConfig?.configured, probeConfig?.demoMode, probeConfig?.publicUrl, probeConfig?.provider]);

  const nodes = probe?.nodes || [];
  const summary = probe?.summary || {
    total: 0,
    online: 0,
    avgCpu: 0,
    ramUsage: 0,
    totalNetUp: 0,
    totalNetDown: 0,
  };

  const groups = useMemo(() => {
    const set = new Set();
    nodes.forEach((n) => {
      if (n.group) set.add(n.group);
    });
    return ['全部', ...Array.from(set)];
  }, [nodes]);

  const filteredNodes = useMemo(() => {
    if (selectedGroup === '全部') return nodes;
    return nodes.filter((n) => n.group === selectedGroup);
  }, [nodes, selectedGroup]);

  const filledSegments =
    summary.total > 0 ? Math.round((summary.online / summary.total) * 10) : 0;

  if (loading) {
    return (
      <div className="card empty-state">
        <RefreshCw size={22} className="spin" color="var(--accent)" />
        <div style={{ marginTop: 10 }}>正在拉取探针节点状态…</div>
      </div>
    );
  }

  if (!probe?.configured) {
    return (
      <div className="card empty-state">
        <div style={{ fontSize: 30, marginBottom: 8 }}>📡</div>
        <div style={{ fontWeight: 700, color: 'var(--text)', fontSize: 15 }}>
          尚未配置节点探针
        </div>
        <div style={{ marginTop: 6, lineHeight: 1.5 }}>
          支持 Komari、哪吒探针 (v1/v0)、NodeGet (NodeSeek 探针)，以及极简 / CF 等通用 JSON 探针。
        </div>
        {isAdmin && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 14 }}>
            <button className="btn btn-primary btn-sm" onClick={() => onOpenSettings('probe')}>
              <Settings size={14} /> 立即配置探针
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      {/* Hero Summary Card (RoseveilBot 10-segment pill bar style) */}
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ flexShrink: 0 }}>
            <span style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.03em' }}>
              {summary.online}
            </span>
            <span style={{ fontSize: 13, color: 'var(--text-muted)', marginLeft: 3 }}>
              / {summary.total} 台
            </span>
          </div>

          <div className="segment-bar" aria-label="在线节点比例">
            {Array.from({ length: 10 }, (_, idx) => (
              <span key={idx} className={`segment-pill ${idx < filledSegments ? 'filled' : ''}`} />
            ))}
          </div>

          <button
            className="icon-btn accent"
            title="刷新探针"
            disabled={refreshing}
            onClick={() => loadProbe(true)}
          >
            <RefreshCw size={15} className={refreshing ? 'spin' : ''} />
          </button>
        </div>

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
            marginTop: 14,
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <span className="pill">平均 CPU {summary.avgCpu}%</span>
            <span className="pill">内存 {summary.ramUsage}%</span>
            <span className="pill rose">
              <ArrowUp size={11} /> {formatSpeed(summary.totalNetUp)}
              <span style={{ opacity: 0.45 }}>·</span>
              <ArrowDown size={11} /> {formatSpeed(summary.totalNetDown)}
            </span>
          </div>

          {probe.publicUrl && (
            <button
              className="btn btn-soft btn-sm"
              onClick={() => openExternalUrl(probe.publicUrl)}
            >
              完整探针 <ExternalLink size={12} />
            </button>
          )}
        </div>

        {probe.demo && (
          <div
            style={{
              marginTop: 10,
              fontSize: 12,
              color: 'var(--amber)',
              background: 'var(--amber-soft)',
              padding: '7px 11px',
              borderRadius: 12,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span>当前为演示节点数据</span>
            {isAdmin && (
              <button
                className="btn btn-sm"
                style={{ background: 'transparent', color: 'var(--amber)', padding: '2px 6px' }}
                onClick={() => onOpenSettings('probe')}
              >
                去配置真实地址 →
              </button>
            )}
          </div>
        )}

        {probe.error && (
          <div
            style={{
              marginTop: 10,
              fontSize: 12,
              color: 'var(--red)',
              background: 'var(--red-soft)',
              padding: '8px 12px',
              borderRadius: 12,
            }}
          >
            ⚠️ {probe.error}
          </div>
        )}
      </div>

      {/* Group Chips */}
      {groups.length > 2 && (
        <div className="chip-row">
          {groups.map((g) => (
            <button
              key={g}
              className={`chip ${selectedGroup === g ? 'active' : ''}`}
              onClick={() => setSelectedGroup(g)}
            >
              {g}
            </button>
          ))}
        </div>
      )}

      {/* Server Nodes */}
      {filteredNodes.length === 0 ? (
        <div className="card empty-state">
          <Server size={24} style={{ opacity: 0.5 }} />
          <div style={{ marginTop: 8 }}>暂无可展示的节点数据</div>
        </div>
      ) : (
        filteredNodes.map((node) => {
          const isOpen = expandedId === node.uuid;
          return (
            <div
              className="card"
              key={node.uuid}
              style={{ cursor: 'pointer', padding: 14 }}
              onClick={() => setExpandedId(isOpen ? null : node.uuid)}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <div className="row-icon-box" style={{ fontSize: 19 }}>
                    {node.region || '🖥️'}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div className="row-title" style={{ fontSize: 15 }}>
                      <span
                        style={{
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {node.name}
                      </span>
                    </div>
                    <div className="row-desc" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ color: node.online ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>
                        ● {node.online ? '在线' : '离线'}
                      </span>
                      {node.online && <span>· {formatUptime(node.uptime)}</span>}
                      {node.os && <span>· {node.os}</span>}
                    </div>
                  </div>
                </div>

                <ChevronDown
                  size={16}
                  color="var(--text-muted)"
                  style={{
                    flexShrink: 0,
                    transform: isOpen ? 'rotate(180deg)' : 'none',
                    transition: 'transform 0.16s ease',
                  }}
                />
              </div>

              <div className="metric-grid">
                <div className="metric-box">
                  <div className="metric-top">
                    <span>CPU</span>
                    <span className="metric-val">{node.cpuUsage}%</span>
                  </div>
                  <div className="progress-track">
                    <div
                      className={`progress-fill ${meterTone(node.cpuUsage)}`}
                      style={{ width: `${node.cpuUsage}%` }}
                    />
                  </div>
                </div>

                <div className="metric-box">
                  <div className="metric-top">
                    <span>内存</span>
                    <span className="metric-val">{node.ramUsage}%</span>
                  </div>
                  <div className="progress-track">
                    <div
                      className={`progress-fill ${meterTone(node.ramUsage)}`}
                      style={{ width: `${node.ramUsage}%` }}
                    />
                  </div>
                </div>

                <div className="metric-box">
                  <div className="metric-top">
                    <span>硬盘</span>
                    <span className="metric-val">{node.diskUsage}%</span>
                  </div>
                  <div className="progress-track">
                    <div
                      className={`progress-fill ${meterTone(node.diskUsage)}`}
                      style={{ width: `${node.diskUsage}%` }}
                    />
                  </div>
                </div>
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginTop: 10,
                  fontSize: 12,
                  color: 'var(--text-secondary)',
                }}
              >
                <span>
                  ↑ {formatSpeed(node.netUp)} · ↓ {formatSpeed(node.netDown)}
                </span>
                <span style={{ color: 'var(--text-muted)' }}>
                  总计 ↑{formatBytes(node.totalUp)} / ↓{formatBytes(node.totalDown)}
                </span>
              </div>

              {isOpen && (
                <div
                  style={{
                    marginTop: 12,
                    paddingTop: 10,
                    borderTop: '1px solid var(--border)',
                    fontSize: 12,
                    color: 'var(--text-secondary)',
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 8,
                  }}
                >
                  <div>处理器：{node.cpuName || `${node.cpuCores || '?'} Cores`}</div>
                  <div>架构：{node.arch || '未知'} {node.virtualization ? `(${node.virtualization})` : ''}</div>
                  <div>内存：{formatBytes(node.ramUsed)} / {formatBytes(node.ramTotal)}</div>
                  <div>硬盘：{formatBytes(node.diskUsed)} / {formatBytes(node.diskTotal)}</div>
                  <div>Load1：{node.load1}</div>
                  <div>
                    标签：{node.tags?.length ? node.tags.join(' · ') : '无'}
                  </div>
                </div>
              )}
            </div>
          );
        })
      )}
    </>
  );
}
