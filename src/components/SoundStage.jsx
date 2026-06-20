import React, { useRef, useEffect } from 'react';
import { Headphones, Radio, Volume2 } from 'lucide-react';

/**
 * SoundNode Component
 * Represents a draggable sound source node on the 2D stage.
 */
export const SoundNode = ({
  source,
  isSelected,
  isColliding,
  onPointerDown,
  onClick
}) => {
  const nodeClass = `stage-node ${source.type === 'oscillator' ? 'node-synth' : 'node-file'} ${
    isSelected ? 'selected' : ''
  } ${isColliding ? 'node-colliding' : ''}`;

  return (
    <div
      className={nodeClass}
      style={{ left: `${source.x}%`, top: `${source.y}%` }}
      onPointerDown={(e) => onPointerDown(e, source.id)}
      onClick={(e) => {
        e.stopPropagation();
        onClick(source.id);
      }}
      title={`${source.name} (${source.type}) — ${source.frequency} Hz`}
    >
      <div className="node-ring">
        {source.type === 'oscillator' ? (
          <Radio size={18} className="node-icon" style={{ color: 'var(--accent-green)' }} />
        ) : (
          <Volume2 size={18} className="node-icon" style={{ color: 'var(--accent-purple)' }} />
        )}
      </div>
      <div className="node-label">
        {source.name}
      </div>
    </div>
  );
};

/**
 * ListenerNode Component
 * Represents the static central listener node.
 */
export const ListenerNode = ({ position }) => {
  return (
    <div
      className="stage-node node-listener"
      style={{ left: `${position.x}%`, top: `${position.y}%` }}
    >
      <div className="node-ring">
        <Headphones size={20} style={{ color: 'var(--accent-cyan)' }} />
      </div>
      <div className="node-label" style={{ border: '1px solid var(--accent-cyan)' }}>
        LISTENER
      </div>
    </div>
  );
};

/**
 * SoundStage Component
 * Orchestrates the drag interaction and canvas overlays for proximity connections
 * AND distance vector lines from every source to the central listener.
 */
export default function SoundStage({
  sources,
  selectedSourceId,
  onSelectSource,
  onNodeDrag,
  snapping,
  collisions,
  listenerPos
}) {
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const dragInfoRef = useRef({ isDragging: false, nodeId: null });

  // Handle Canvas Resizing and Drawing
  // useEffect runs this code after the component mounts. It sets up an observer
  // to keep the canvas resolution matching its physical size on the screen.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (let entry of entries) {
        canvas.width = entry.contentRect.width;
        canvas.height = entry.contentRect.height;
        drawCanvasOverlays();
      }
    });

    if (stageRef.current) {
      resizeObserver.observe(stageRef.current);
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, [collisions, sources]);

  // Redraw when collisions or sources update
  useEffect(() => {
    drawCanvasOverlays();
  }, [collisions, sources]);

  /**
   * Draws all canvas overlays:
   * 1) Dashed distance vector lines from each source → listener (with distance label)
   * 2) Glowing proximity collision bridges between colliding sources
   */
  const drawCanvasOverlays = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Listener pixel coordinates (center of stage)
    const lx = (listenerPos.x / 100) * canvas.width;
    const ly = (listenerPos.y / 100) * canvas.height;

    // ── 1. Distance vector lines from each source to listener ──
    sources.forEach((src) => {
      const sx = (src.x / 100) * canvas.width;
      const sy = (src.y / 100) * canvas.height;

      // Calculate Euclidean distance in percent-space for the label
      const dx = src.x - listenerPos.x;
      const dy = src.y - listenerPos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Draw dashed line
      ctx.save();
      ctx.setLineDash([5, 5]);
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)'; // subtle slate
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(lx, ly);
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw distance label at midpoint
      const mx = (sx + lx) / 2;
      const my = (sy + ly) / 2;
      const label = `${dist.toFixed(1)}u`;

      ctx.font = '10px monospace';
      ctx.fillStyle = 'rgba(148, 163, 184, 0.6)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Small background pill behind text for readability
      const textWidth = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(7, 10, 20, 0.7)';
      ctx.fillRect(mx - textWidth / 2 - 3, my - 7, textWidth + 6, 14);
      ctx.fillStyle = 'rgba(148, 163, 184, 0.75)';
      ctx.fillText(label, mx, my);
      ctx.restore();
    });

    // ── 2. Proximity collision bridges ──
    collisions.forEach((collision) => {
      const sourceA = sources.find((s) => s.id === collision.nodeA);
      const sourceB = sources.find((s) => s.id === collision.nodeB);
      if (!sourceA || !sourceB) return;

      // Convert percentage coordinates to canvas pixel coordinates
      const xA = (sourceA.x / 100) * canvas.width;
      const yA = (sourceA.y / 100) * canvas.height;
      const xB = (sourceB.x / 100) * canvas.width;
      const yB = (sourceB.y / 100) * canvas.height;

      // Drawing a glowing proximity line
      ctx.shadowBlur = 10 + collision.intensity * 10;
      ctx.shadowColor = 'rgba(245, 158, 11, 0.8)'; // Warning Amber
      ctx.strokeStyle = `rgba(245, 158, 11, ${0.3 + collision.intensity * 0.7})`;
      ctx.lineWidth = 2 + collision.intensity * 3;

      ctx.beginPath();
      ctx.moveTo(xA, yA);
      ctx.lineTo(xB, yB);
      ctx.stroke();

      // Draw minor electrical-arc jitter nodes along the line to make it feel "active"
      if (collision.intensity > 0.3) {
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#fff';
        const segments = 3;
        for (let i = 1; i < segments; i++) {
          const t = i / segments;
          // Interpolate with a tiny random jitter offset
          const jitterX = (Math.random() - 0.5) * 8 * collision.intensity;
          const jitterY = (Math.random() - 0.5) * 8 * collision.intensity;
          const px = xA + (xB - xA) * t + jitterX;
          const py = yA + (yB - yA) * t + jitterY;
          
          ctx.beginPath();
          ctx.arc(px, py, 2, 0, 2 * Math.PI);
          ctx.fill();
        }
      }
    });
    // Reset shadow for subsequent draws
    ctx.shadowBlur = 0;
  };

  // Drag Event Handlers
  // pointerdown, pointermove, pointerup are used instead of standard mouse events
  // because pointer events support both mouse and touch interfaces seamlessly.
  const handlePointerDown = (e, id) => {
    e.preventDefault();
    if (id === 'listener') return; // Fixed node
    
    dragInfoRef.current = { isDragging: true, nodeId: id };
    onSelectSource(id);
    
    // Attach window level listeners so dragging is smooth if cursor leaves container
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  const handlePointerMove = (e) => {
    const dragInfo = dragInfoRef.current;
    if (!dragInfo.isDragging || !dragInfo.nodeId || !stageRef.current) return;

    const rect = stageRef.current.getBoundingClientRect();
    
    // Calculate raw percentage positions relative to stage boundaries
    let pctX = ((e.clientX - rect.left) / rect.width) * 100;
    let pctY = ((e.clientY - rect.top) / rect.height) * 100;

    // Apply grid snapping if active (snap to increments of 5)
    if (snapping) {
      pctX = Math.round(pctX / 5) * 5;
      pctY = Math.round(pctY / 5) * 5;
    }

    // Constrain position within stage walls [0, 100]
    pctX = Math.max(0, Math.min(100, pctX));
    pctY = Math.max(0, Math.min(100, pctY));

    // Callback triggers continuous spatial math and audio engine updates
    onNodeDrag(dragInfo.nodeId, pctX, pctY);
  };

  const handlePointerUp = () => {
    dragInfoRef.current = { isDragging: false, nodeId: null };
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', handlePointerUp);
  };

  // Stage click triggers deselecting and double-click triggers adding
  const handleStageClick = () => {
    onSelectSource(null);
  };

  const handleStageDoubleClick = (e) => {
    if (e.target !== stageRef.current && e.target !== canvasRef.current) return;
    const rect = stageRef.current.getBoundingClientRect();
    
    let pctX = ((e.clientX - rect.left) / rect.width) * 100;
    let pctY = ((e.clientY - rect.top) / rect.height) * 100;

    if (snapping) {
      pctX = Math.round(pctX / 5) * 5;
      pctY = Math.round(pctY / 5) * 5;
    }

    pctX = Math.max(0, Math.min(100, pctX));
    pctY = Math.max(0, Math.min(100, pctY));

    // Emit a double-click stage event to add a node at clicked spot
    const event = new CustomEvent('stageDoubleClick', { detail: { x: pctX, y: pctY } });
    window.dispatchEvent(event);
  };

  return (
    <div className="glass-panel" style={{ flex: '1 0 auto' }}>
      <div className="panel-header">
        <h2>
          <span>🎛️</span> 2D Soundstage
        </h2>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          X-axis = Pan • Y-axis = Pitch • Double-click to create • Drag to position
        </div>
      </div>
      <div className="panel-content" style={{ padding: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div
          ref={stageRef}
          className={`stage-container ${snapping ? 'snapping' : ''}`}
          onClick={handleStageClick}
          onDoubleClick={handleStageDoubleClick}
        >
          {/* Ambient waves visualizer decoration */}
          <div className="stage-ambient-waves"></div>

          {/* Canvas for distance vector lines and proximity bridges */}
          <canvas ref={canvasRef} className="stage-canvas"></canvas>

          {/* Static Listener Node */}
          <ListenerNode position={listenerPos} />

          {/* Dynamic Audio Source Nodes */}
          {sources.map((src) => {
            const isColliding = collisions.some(
              (c) => c.nodeA === src.id || c.nodeB === src.id
            );
            return (
              <SoundNode
                key={src.id}
                source={src}
                isSelected={selectedSourceId === src.id}
                isColliding={isColliding}
                onPointerDown={handlePointerDown}
                onClick={onSelectSource}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
