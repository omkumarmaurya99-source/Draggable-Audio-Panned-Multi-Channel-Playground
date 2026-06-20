import React from 'react';
import { ShieldAlert, Download, Trash2 } from 'lucide-react';

/**
 * TelemetryPanel Component
 * Displays system diagnostics, per-channel audio mathematical variables,
 * buffer processing latency, and provides Export/Clear Cache utility buttons.
 */
export default function TelemetryPanel({
  sources,
  ctxState,
  sampleRate,
  collisions,
  listenerPos,
  attenuationModel,
  setAttenuationModel,
  onResumeContext,
  latencyMs,
  onExportConfig,
  onClearCache
}) {
  
  // Calculate Euclidean Distance and details
  const getSourceStats = (src) => {
    const dx = src.x - listenerPos.x;
    const dy = src.y - listenerPos.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    // Attenuation calculation details based on selected model
    const maxDist = Math.sqrt(50 * 50 + 50 * 50); // Center to corner
    let attenuation = 0;
    if (attenuationModel === 'linear') {
      attenuation = Math.max(0, 1 - distance / maxDist);
    } else {
      // Exponential
      attenuation = Math.max(0, Math.pow(1 - distance / maxDist, 2));
    }
    
    const isColliding = collisions.some(
      (c) => c.nodeA === src.id || c.nodeB === src.id
    );

    return {
      distance: distance.toFixed(2),
      pan: src.pan.toFixed(2),
      attenuation: attenuation.toFixed(2),
      collisionStatus: isColliding ? 'COLLIDING' : 'STABLE'
    };
  };

  return (
    <div className="glass-panel" style={{ flex: '0 0 auto' }}>
      <div className="panel-header">
        <h2>
          <span>📊</span> Telemetry & Diagnostics
        </h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Attenuation Mode:</span>
          <select
            value={attenuationModel}
            onChange={(e) => setAttenuationModel(e.target.value)}
            style={{
              background: 'hsla(222, 40%, 8%, 0.7)',
              border: '1px solid var(--border-color)',
              color: 'var(--text-main)',
              fontSize: '0.75rem',
              borderRadius: '4px',
              padding: '2px 8px',
              fontWeight: 600,
              outline: 'none',
              cursor: 'pointer'
            }}
          >
            <option value="linear">Linear (1 - d/d_max)</option>
            <option value="exponential">Exponential (1 - d/d_max)²</option>
          </select>
        </div>
      </div>
      <div className="panel-content" style={{ padding: '1rem' }}>
        <div className="telemetry-grid">
          {/* Audio Engine Status */}
          <div className="telemetry-card">
            <div className="telemetry-label">Audio Context</div>
            <div className="telemetry-value" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span 
                className={`audio-context-badge ${ctxState === 'running' ? 'active' : 'suspended'}`}
                onClick={onResumeContext}
                style={{ padding: '2px 8px', fontSize: '0.7rem', cursor: 'pointer' }}
              >
                {ctxState.toUpperCase()}
              </span>
            </div>
          </div>

          {/* Sample Rate */}
          <div className="telemetry-card">
            <div className="telemetry-label">Sample Rate</div>
            <div className="telemetry-value">
              {sampleRate ? `${(sampleRate / 1000).toFixed(1)} kHz` : 'N/A'}
            </div>
          </div>

          {/* Source Count */}
          <div className="telemetry-card">
            <div className="telemetry-label">Active Channels</div>
            <div className="telemetry-value">
              {sources.length} <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>sources</span>
            </div>
          </div>

          {/* Active Collisions */}
          <div className="telemetry-card">
            <div className="telemetry-label">Active Collisions</div>
            <div className="telemetry-value" style={{ color: collisions.length > 0 ? 'var(--accent-warning)' : 'var(--text-main)' }}>
              {collisions.length} <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>bridges</span>
            </div>
          </div>

          {/* Buffer Processing Latency */}
          <div className="telemetry-card">
            <div className="telemetry-label">Base Latency</div>
            <div className="telemetry-value">
              {latencyMs && latencyMs.base > 0 ? `${latencyMs.base} ms` : 'N/A'}
            </div>
          </div>

          <div className="telemetry-card">
            <div className="telemetry-label">Output Latency</div>
            <div className="telemetry-value">
              {latencyMs && latencyMs.output > 0 ? `${latencyMs.output} ms` : 'N/A'}
            </div>
          </div>
        </div>

        {/* Live Raw Channel Parameters List */}
        <div className="telemetry-list">
          <div className="telemetry-list-item header">
            <span>Channel Name</span>
            <span>Coord (X,Y)</span>
            <span>Distance</span>
            <span>Stereo Pan</span>
            <span>Atten. Factor</span>
          </div>
          {sources.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '1rem 0' }}>
              No channel telemetry available. Add a source node to inspect variables.
            </div>
          ) : (
            sources.map((src) => {
              const stats = getSourceStats(src);
              const isColliding = stats.collisionStatus === 'COLLIDING';
              return (
                <div
                  key={src.id}
                  className={`telemetry-list-item ${isColliding ? 'colliding' : 'active'}`}
                >
                  <span style={{ fontWeight: 600 }}>{src.name}</span>
                  <span>{`(${Math.round(src.x)}, ${Math.round(src.y)})`}</span>
                  <span>{stats.distance} u</span>
                  <span>{stats.pan}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    {stats.attenuation}
                    {isColliding && (
                      <ShieldAlert size={10} style={{ color: 'var(--accent-warning)', display: 'inline' }} />
                    )}
                  </span>
                </div>
              );
            })
          )}
        </div>

        {/* Utility buttons: Export Stage Layout to JSON & Clear Local Cache */}
        <div style={{
          display: 'flex',
          gap: '0.75rem',
          marginTop: '1rem',
          paddingTop: '0.75rem',
          borderTop: '1px solid var(--border-color)'
        }}>
          <button
            className="btn"
            onClick={onExportConfig}
            style={{ flex: 1, fontSize: '0.8rem' }}
            title="Export Stage Layout to JSON"
          >
            <Download size={14} />
            Export Stage Layout to JSON
          </button>
          <button
            className="btn btn-danger"
            onClick={onClearCache}
            style={{ flex: 1, fontSize: '0.8rem' }}
            title="Clear Local Cache Configurations (localStorage)"
          >
            <Trash2 size={14} />
            Clear Local Cache Configurations
          </button>
        </div>
      </div>
    </div>
  );
}
