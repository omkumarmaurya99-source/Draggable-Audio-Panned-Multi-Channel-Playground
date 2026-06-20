import React, { useRef, useEffect } from 'react';
import { Play, Pause, VolumeX, Volume2, Trash2 } from 'lucide-react';
import engine from '../audio/audioEngine';

/**
 * WaveformVisualizer Component
 * Renders the live waveform of a single audio channel using requestAnimationFrame.
 */
const WaveformVisualizer = ({ sourceId, isPlaying, isMuted, type }) => {
  const canvasRef = useRef(null);
  const animFrameId = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    // Set fixed pixel buffer size for sharp high-DPI rendering
    canvas.width = 140;
    canvas.height = 70;

    const drawWave = () => {
      animFrameId.current = requestAnimationFrame(drawWave);

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = 'rgba(7, 10, 20, 0.5)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const color = type === 'oscillator' ? 'hsl(145, 85%, 50%)' : 'hsl(270, 95%, 65%)';
      ctx.strokeStyle = isMuted || !isPlaying ? 'rgba(100, 116, 139, 0.4)' : color;
      ctx.lineWidth = 2;
      ctx.beginPath();

      // The buffer contains time-domain data (the actual wave shape) from the Web Audio API AnalyserNode
      const buffer = engine.getWaveform(sourceId);
      
      if (!buffer || !isPlaying || isMuted) {
        // Draw centered idle line
        ctx.moveTo(0, canvas.height / 2);
        ctx.lineTo(canvas.width, canvas.height / 2);
        ctx.stroke();
        return;
      }

      const sliceWidth = canvas.width / buffer.length;
      let x = 0;

      for (let i = 0; i < buffer.length; i++) {
        const v = buffer[i] / 128.0; // Normalized centered around 128
        const y = (v * canvas.height) / 2;

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }

        x += sliceWidth;
      }

      ctx.lineTo(canvas.width, canvas.height / 2);
      ctx.stroke();
    };

    // Start the animation loop when the component mounts
    drawWave();

    // Cleanup function: stop the animation when the component unmounts
    // This prevents memory leaks and performance issues.
    return () => {
      if (animFrameId.current) {
        cancelAnimationFrame(animFrameId.current);
      }
    };
  }, [sourceId, isPlaying, isMuted, type]);

  return (
    <canvas 
      ref={canvasRef} 
      className="channel-visualizer"
      title="Live Waveform Monitor"
    />
  );
};

/**
 * Mixer Component
 * Lists channels, provides slider adjustments, and handles Web Audio syncing.
 */
export default function Mixer({
  sources,
  selectedSourceId,
  onSelectSource,
  onUpdateSource,
  onRemoveSource
}) {
  const handleVolumeChange = (id, volume) => {
    onUpdateSource(id, { volume: parseFloat(volume) });
  };

  const handlePanChange = (id, panVal) => {
    const pan = parseFloat(panVal);
    // Bidirectional sync: Panning updates horizontal X position on the stage
    // x = (pan + 1) * 50
    const x = (pan + 1) * 50;
    onUpdateSource(id, { pan, x });
  };

  const handleTogglePlay = (id, playing) => {
    onUpdateSource(id, { playing: !playing });
  };

  const handleToggleMute = (id, muted) => {
    onUpdateSource(id, { muted: !muted });
  };

  return (
    <div className="glass-panel" style={{ flex: '1 1 0%', display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header">
        <h2>
          <span>🎚️</span> Channel Mixer
        </h2>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          Syncs position on stage • Live per-channel waveforms
        </div>
      </div>
      <div className="panel-content" style={{ overflowY: 'auto', padding: '1rem' }}>
        <div className="mixer-grid">
          {sources.length === 0 ? (
            <div className="mixer-empty-state">
              <p style={{ fontWeight: 600, color: 'var(--text-main)' }}>No Sound Channels Connected</p>
              <p>Use the action strip below or double-click the 2D stage to add sound sources.</p>
            </div>
          ) : (
            sources.map((src) => {
              const isSelected = selectedSourceId === src.id;
              return (
                <div
                  key={src.id}
                  className={`mixer-channel-card ${isSelected ? 'selected' : ''}`}
                  onClick={() => onSelectSource(src.id)}
                >
                  {/* Left Side Indicator */}
                  <div className={`channel-indicator ${src.type}`} />

                  {/* Channel Details */}
                  <div className="channel-info">
                    <span className="channel-name">{src.name}</span>
                    <span className="channel-type-label">
                      {src.type === 'oscillator' ? `${src.oscType} synth` : 'audio file'}
                    </span>
                  </div>

                  {/* Sliders Area */}
                  <div className="channel-sliders">
                    {/* Volume Slider */}
                    <div className="slider-container">
                      <div className="slider-header">
                        <span>Gain</span>
                        <span className="slider-value">{Math.round(src.volume * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.01"
                        value={src.volume}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => handleVolumeChange(src.id, e.target.value)}
                      />
                    </div>

                    {/* Panning Slider */}
                    <div className="slider-container">
                      <div className="slider-header">
                        <span>Pan</span>
                        <span className="slider-value">
                          {src.pan === 0 ? 'C' : src.pan > 0 ? `R${Math.round(src.pan * 10)}` : `L${Math.round(Math.abs(src.pan) * 10)}`}
                        </span>
                      </div>
                      <input
                        type="range"
                        min="-1"
                        max="1"
                        step="0.02"
                        value={src.pan}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => handlePanChange(src.id, e.target.value)}
                      />
                    </div>
                  </div>

                  {/* Waveform Monitor */}
                  <WaveformVisualizer
                    sourceId={src.id}
                    isPlaying={src.playing}
                    isMuted={src.muted}
                    type={src.type}
                  />

                  {/* Channel Control Actions */}
                  <div className="channel-actions" onClick={(e) => e.stopPropagation()}>
                    {/* Play/Pause */}
                    <button
                      className={`btn btn-icon ${src.playing ? 'active' : ''}`}
                      onClick={() => handleTogglePlay(src.id, src.playing)}
                      title={src.playing ? 'Pause' : 'Play'}
                    >
                      {src.playing ? <Pause size={14} /> : <Play size={14} />}
                    </button>

                    {/* Mute */}
                    <button
                      className={`btn btn-icon ${src.muted ? 'active muted' : ''}`}
                      onClick={() => handleToggleMute(src.id, src.muted)}
                      title={src.muted ? 'Unmute' : 'Mute'}
                    >
                      {src.muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
                    </button>

                    {/* Remove */}
                    <button
                      className="btn btn-icon btn-danger"
                      onClick={() => onRemoveSource(src.id)}
                      title="Remove channel"
                      style={{ height: '32px', width: '32px' }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
