import React, { useState, useEffect, useRef } from 'react';
import engine from './audio/audioEngine';
import SoundStage from './components/SoundStage';
import Mixer from './components/Mixer';
import TelemetryPanel from './components/TelemetryPanel';
import ActionStrip from './components/ActionStrip';
import { Volume2, Radio, Edit3, Settings } from 'lucide-react';

// Frequency range for Y-axis mapping (oscillator sources)
// Top of stage (y=0) → high pitch, Bottom (y=100) → low pitch
const FREQ_MAX = 2000; // Hz at top
const FREQ_MIN = 80;   // Hz at bottom

// Default stage template to load on first visit or reset
const DEFAULT_SOURCES = [
  {
    id: 'source-synth-1',
    name: 'Synth Bass',
    x: 30,
    y: 70,
    type: 'oscillator',
    oscType: 'triangle',
    frequency: 110, // Will be overridden by Y-mapping
    volume: 0.6,
    pan: -0.4,
    attenuation: 1.0,
    muted: false,
    playing: false
  },
  {
    id: 'source-synth-2',
    name: 'Sine Bell',
    x: 70,
    y: 30,
    type: 'oscillator',
    oscType: 'sine',
    frequency: 880, // Will be overridden by Y-mapping
    volume: 0.5,
    pan: 0.4,
    attenuation: 1.0,
    muted: false,
    playing: false
  }
];

const LISTENER_POSITION = { x: 50, y: 50 }; // Center coordinates
const PROXIMITY_THRESHOLD = 12; // Collision distance radius in percent units

export default function App() {
  // --- React State Management ---
  // useState hooks store application data that, when changed, triggers a UI re-render.
  const [sources, setSources] = useState([]); // Array of all audio source nodes on the stage
  const [selectedSourceId, setSelectedSourceId] = useState(null); // The currently active node for editing
  const [snapping, setSnapping] = useState(false); // Toggle for grid snapping during drag
  const [attenuationModel, setAttenuationModel] = useState('linear'); // Math model for volume drop-off
  const [ctxState, setCtxState] = useState('uninitialized'); // Web Audio API Context status
  const [sampleRate, setSampleRate] = useState(0); // Hardware sample rate (e.g., 44100Hz)
  const [collisions, setCollisions] = useState([]); // Array tracking overlapping nodes
  const [masterMuted, setMasterMuted] = useState(false); // Global mute state
  const [latencyMs, setLatencyMs] = useState({ base: 0, output: 0, total: 0 }); // Audio processing delay


  // Load configuration from localStorage on mount
  useEffect(() => {
    const savedState = localStorage.getItem('spatial_audio_state');
    if (savedState) {
      try {
        const parsed = JSON.parse(savedState);
        setSnapping(!!parsed.snapping);
        setAttenuationModel(parsed.attenuationModel || 'linear');
        
        // Initialize sources state (ensure they start paused for autoplay safety)
        const initialSources = (parsed.sources || []).map(src => ({
          ...src,
          playing: false // Standard browser policy requires gesture to start audio
        }));
        setSources(initialSources);
        
        // Load into audio engine
        initialSources.forEach(src => {
          engine.addSource(src.id, src);
        });
      } catch (err) {
        console.error('Failed to restore saved state:', err);
        loadDefaults();
      }
    } else {
      loadDefaults();
    }

    // Context status polling interval for diagnostics telemetry
    const timer = setInterval(() => {
      setCtxState(engine.getStatus());
      if (engine.ctx) {
        setSampleRate(engine.ctx.sampleRate);
        setLatencyMs(engine.getLatencyMs());
      }
    }, 250);

    return () => {
      clearInterval(timer);
    };
  }, []);

  // Use a dedicated effect for the double-click listener with proper dependencies
  // to prevent stale closures over the sources array.
  useEffect(() => {
    const handleStageDblClick = (e) => {
      const { x, y } = e.detail;
      addNewSynthSource(x, y);
    };
    window.addEventListener('stageDoubleClick', handleStageDblClick);
    return () => window.removeEventListener('stageDoubleClick', handleStageDblClick);
  }, [sources, attenuationModel]);

  // Sync state to localStorage whenever sources or settings change
  useEffect(() => {
    if (sources.length > 0) {
      const stateToSave = {
        sources: sources.map(s => ({
          id: s.id,
          name: s.name,
          x: s.x,
          y: s.y,
          type: s.type,
          oscType: s.oscType,
          frequency: s.frequency,
          volume: s.volume,
          pan: s.pan,
          attenuation: s.attenuation,
          muted: s.muted,
          fileName: s.fileName
        })),
        snapping,
        attenuationModel
      };
      localStorage.setItem('spatial_audio_state', JSON.stringify(stateToSave));
    }
  }, [sources, snapping, attenuationModel]);

  // Load defaults helper
  const loadDefaults = () => {
    engine.clearAll();
    DEFAULT_SOURCES.forEach(src => {
      engine.addSource(src.id, src);
    });
    // Calculate initial math values
    const updated = DEFAULT_SOURCES.map(src => updateSpatialMath(src, src.x, src.y, attenuationModel));
    setSources(updated);
    setSelectedSourceId(null);
  };

  /**
   * Maps Y-coordinate (0–100) to frequency using exponential scale.
   * Top (y=0) → FREQ_MAX (2000 Hz), Bottom (y=100) → FREQ_MIN (80 Hz).
   * Exponential mapping produces more musically useful pitch distribution.
   */
  const yToFrequency = (y) => {
    // Normalize y from [0,100] to [0,1], invert so top=high
    const t = 1 - (y / 100);
    // Exponential interpolation between FREQ_MIN and FREQ_MAX
    return Math.round(FREQ_MIN * Math.pow(FREQ_MAX / FREQ_MIN, t));
  };

  // Spatial math calculator: Distance, Attenuation, Stereo Panning, Y→Frequency
  const updateSpatialMath = (src, x, y, model = attenuationModel) => {
    // 1. Calculate Euclidean Distance from Listener (at LISTENER_POSITION)
    // Formula: Distance = √((x2 - x1)² + (y2 - y1)²)
    const dx = x - LISTENER_POSITION.x;
    const dy = y - LISTENER_POSITION.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    // 2. Attenuation calculation (Volume drop-off based on distance)
    // Max distance is from center to a corner: sqrt(50^2 + 50^2) ≈ 70.71
    const maxDistance = 70.71;
    let attenuation = 0;
    
    if (model === 'linear') {
      attenuation = Math.max(0, 1 - distance / maxDistance);
    } else {
      // Exponential attenuation
      attenuation = Math.max(0, Math.pow(1 - distance / maxDistance, 2));
    }

    // 3. Stereo Pan Calculation
    // Pan calculation: left ear is -1, right ear is 1. Center is 0.
    // Normalized horizontal offset: dx range [-50, 50] is mapped to [-1.0, 1.0]
    const pan = Math.max(-1, Math.min(1, dx / 50));

    // Y→Frequency mapping for oscillator sources
    const frequency = (src.type === 'oscillator' && src.yMapFreq !== false) ? yToFrequency(y) : (src.frequency || 440);

    return {
      ...src,
      x,
      y,
      pan,
      attenuation,
      frequency
    };
  };

  // Solves and applies proximity effects (tremolo & lowpass cutoff sweep)
  const runCollisionSolver = (updatedSources) => {
    const activeCollisions = [];
    const intensityMap = {}; // Map<id, maxIntensity>

    // 1. Detect pairwise overlaps
    for (let i = 0; i < updatedSources.length; i++) {
      for (let j = i + 1; j < updatedSources.length; j++) {
        const srcA = updatedSources[i];
        const srcB = updatedSources[j];

        const dx = srcA.x - srcB.x;
        const dy = srcA.y - srcB.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < PROXIMITY_THRESHOLD) {
          // Calculate intensity: 0 (just touching) to 1 (perfectly overlapping)
          const intensity = 1 - (dist / PROXIMITY_THRESHOLD);
          activeCollisions.push({
            nodeA: srcA.id,
            nodeB: srcB.id,
            distance: dist,
            intensity
          });

          // Accumulate maximum collision intensity per node
          intensityMap[srcA.id] = Math.max(intensityMap[srcA.id] || 0, intensity);
          intensityMap[srcB.id] = Math.max(intensityMap[srcB.id] || 0, intensity);
        }
      }
    }

    // 2. Push intensity results to audio engine
    updatedSources.forEach(src => {
      const nodeIntensity = intensityMap[src.id] || 0;
      engine.setProximityEffect(src.id, nodeIntensity);
    });

    setCollisions(activeCollisions);
  };

  // Re-run spatial calculations when attenuation model selection changes
  useEffect(() => {
    const updated = sources.map(s => updateSpatialMath(s, s.x, s.y, attenuationModel));
    setSources(updated);
    
    // Sync effective volumes with updated attenuation curves in engine
    updated.forEach(s => {
      const effectiveVol = s.muted ? 0 : s.volume * s.attenuation;
      engine.updateSource(s.id, { volume: effectiveVol, pan: s.pan, frequency: s.frequency });
    });
    runCollisionSolver(updated);
  }, [attenuationModel]);

  // Handler: When a node is dragged on the soundstage
  // This updates React State, which updates the UI, AND updates the Web Audio Nodes
  const handleNodeDrag = (id, x, y) => {
    let targetSrc = null;
    const updated = sources.map(s => {
      if (s.id === id) {
        targetSrc = updateSpatialMath(s, x, y);
        return targetSrc;
      }
      return s;
    });

    setSources(updated);

    // Fast-path direct updates to Audio engine to prevent render lag
    if (targetSrc) {
      const effectiveVol = targetSrc.muted ? 0 : targetSrc.volume * targetSrc.attenuation;
      engine.updateSource(id, {
        volume: effectiveVol,
        pan: targetSrc.pan,
        frequency: targetSrc.frequency
      });
      runCollisionSolver(updated);
    }
  };

  // Handler: Add a new synthesizer oscillator source
  const addNewSynthSource = (x = Math.random() * 60 + 20, y = Math.random() * 60 + 20) => {
    engine.init(); // Warm up context
    // Use a random suffix to ensure unique IDs even on rapid double-taps
    const id = `synth-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const name = `Osc Synth ${sources.filter(s => s.type === 'oscillator').length + 1}`;
    
    let newSrc = {
      id,
      name,
      x,
      y,
      type: 'oscillator',
      oscType: 'sine',
      frequency: 440,
      yMapFreq: true,
      volume: 0.5,
      pan: 0,
      attenuation: 1.0,
      muted: false,
      playing: true // Autoplay newly added synths for instant feedback
    };

    newSrc = updateSpatialMath(newSrc, x, y);
    engine.addSource(id, newSrc);
    
    const updatedSources = [...sources, newSrc];
    setSources(updatedSources);
    setSelectedSourceId(id);
    runCollisionSolver(updatedSources);
  };

  // Handler: Process uploaded custom audio file
  const handleAddAudioFile = async (file) => {
    try {
      engine.init();
      // Decode and store the raw file buffer in the engine cache
      await engine.decodeAudioFile(file);

      const id = `file-${Date.now()}`;
      const name = file.name.substring(0, 16); // Truncate long file names
      
      let newSrc = {
        id,
        name,
        x: Math.random() * 50 + 25,
        y: Math.random() * 50 + 25,
        type: 'file',
        fileName: file.name,
        volume: 0.7,
        pan: 0,
        attenuation: 1.0,
        muted: false,
        playing: true // Auto-trigger playback on selection load
      };

      newSrc = updateSpatialMath(newSrc, newSrc.x, newSrc.y);
      engine.addSource(id, newSrc);

      const updatedSources = [...sources, newSrc];
      setSources(updatedSources);
      setSelectedSourceId(id);
      runCollisionSolver(updatedSources);
    } catch (error) {
      alert('Error loading/decoding audio file: ' + error.message);
    }
  };

  // Handler: Update channel properties (volume, pan, waveform, playing state)
  const handleUpdateSource = (id, params) => {
    let targetSrc = null;
    const updated = sources.map(s => {
      if (s.id === id) {
        // Merge parameters
        let merged = { ...s, ...params };
        
        // If coordinate values or panner dials were edited directly in mixer sliders
        if (params.x !== undefined || params.y !== undefined || params.pan !== undefined) {
          const posX = params.x !== undefined ? params.x : (params.pan !== undefined ? (params.pan + 1) * 50 : s.x);
          const posY = params.y !== undefined ? params.y : s.y;
          merged = updateSpatialMath(merged, posX, posY);
        }

        targetSrc = merged;
        return merged;
      }
      return s;
    });

    setSources(updated);

    // Sync values downstream to the Web Audio engine
    if (targetSrc) {
      const effectiveVol = targetSrc.muted ? 0 : targetSrc.volume * targetSrc.attenuation;
      engine.updateSource(id, {
        volume: effectiveVol,
        pan: targetSrc.pan,
        frequency: targetSrc.frequency,
        oscType: targetSrc.oscType,
        playing: targetSrc.playing,
        muted: targetSrc.muted
      });
      runCollisionSolver(updated);
    }
  };

  // Handler: Delete a channel
  const handleRemoveSource = (id) => {
    engine.removeSource(id);
    const updated = sources.filter(s => s.id !== id);
    setSources(updated);
    if (selectedSourceId === id) {
      setSelectedSourceId(null);
    }
    runCollisionSolver(updated);
  };

  // Handler: Reset/wipe stage clean
  const handleClearStage = () => {
    engine.clearAll();
    setSources([]);
    setSelectedSourceId(null);
    setCollisions([]);
  };

  // Handler: Toggle Master Mute
  const handleToggleMasterMute = () => {
    engine.init();
    const newState = engine.toggleMasterMute();
    setMasterMuted(newState);
  };

  // Handler: Clear local cache (localStorage)
  const handleClearCache = () => {
    localStorage.removeItem('spatial_audio_state');
    handleClearStage();
    loadDefaults();
  };

  // Handler: Export current layout config to JSON
  const handleExportConfig = () => {
    const config = {
      version: '1.0',
      snapping,
      attenuationModel,
      sources: sources.map(s => ({
        name: s.name,
        x: s.x,
        y: s.y,
        type: s.type,
        oscType: s.oscType,
        frequency: s.frequency,
        volume: s.volume,
        muted: s.muted,
        fileName: s.fileName
      }))
    };

    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(config, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `spatial_audio_setup_${Date.now()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  // Handler: Restore config from uploaded JSON
  const handleImportConfig = (config) => {
    engine.clearAll();
    const parsedSources = (config.sources || []).map((src, index) => {
      const id = `${src.type}-${Date.now()}-${index}`;
      
      // Merge values into state
      let merged = {
        id,
        name: src.name || `Node ${index + 1}`,
        x: src.x !== undefined ? src.x : 50,
        y: src.y !== undefined ? src.y : 50,
        type: src.type || 'oscillator',
        oscType: src.oscType || 'sine',
        frequency: src.frequency || 440,
        volume: src.volume !== undefined ? src.volume : 0.5,
        muted: !!src.muted,
        playing: false, // Force suspended on import
        fileName: src.fileName || null
      };

      merged = updateSpatialMath(merged, merged.x, merged.y, config.attenuationModel || 'linear');
      engine.addSource(id, merged);
      return merged;
    });

    setSnapping(!!config.snapping);
    setAttenuationModel(config.attenuationModel || 'linear');
    setSources(parsedSources);
    setSelectedSourceId(null);
    runCollisionSolver(parsedSources);

    // If configuration includes custom local audio files, let user know they must upload them to cache buffers
    const hasFiles = parsedSources.some(s => s.type === 'file');
    if (hasFiles) {
      alert('Imported configuration contains audio file nodes. You must re-upload these files using the action strip to fill the cache buffers and activate playback!');
    }
  };

  // User gesture button to warm up suspended browser AudioContext
  const handleResumeContext = () => {
    engine.init();
    engine.resume();
  };

  // Selected Source details helper reference
  const selectedSource = sources.find(s => s.id === selectedSourceId);

  return (
    <div className="app-container">
      {/* App Header Bar */}
      <header className="app-header">
        <div className="header-title-section">
          <h1>Draggable Audio-Panned Multi-Channel Spatial Audio System</h1>
          <p>Interactive 2D Spatial Sound Stage with Web Audio attenuation and stereo panning</p>
        </div>

        {/* Audio Context Status controls */}
        <button
          className={`audio-context-badge ${ctxState === 'running' ? 'active' : 'suspended'}`}
          onClick={handleResumeContext}
          title="Click to manually initialize/resume Web Audio Context"
        >
          <span style={{
            display: 'inline-block',
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: ctxState === 'running' ? 'var(--accent-green)' : 'var(--accent-warning)',
            boxShadow: ctxState === 'running' ? '0 0 8px var(--accent-green)' : '0 0 8px var(--accent-warning)'
          }}></span>
          Engine: {ctxState.toUpperCase()}
        </button>
      </header>

      {/* Main Core Section */}
      <div className="dashboard-grid">
        
        {/* Left Side: 2D Stage and toolbar */}
        <div className="panel-left">
          <SoundStage
            sources={sources}
            selectedSourceId={selectedSourceId}
            onSelectSource={setSelectedSourceId}
            onNodeDrag={handleNodeDrag}
            snapping={snapping}
            collisions={collisions}
            listenerPos={LISTENER_POSITION}
          />
          <ActionStrip
            onAddOscillator={() => addNewSynthSource()}
            onAddAudioFile={handleAddAudioFile}
            onResetToDefault={loadDefaults}
            onClearStage={handleClearStage}
            onExportConfig={handleExportConfig}
            onImportConfig={handleImportConfig}
            snapping={snapping}
            setSnapping={setSnapping}
            masterMuted={masterMuted}
            onToggleMasterMute={handleToggleMasterMute}
          />
        </div>

        {/* Right Side: Mixer console & Telemetry data */}
        <div className="panel-right">
          <Mixer
            sources={sources}
            selectedSourceId={selectedSourceId}
            onSelectSource={setSelectedSourceId}
            onUpdateSource={handleUpdateSource}
            onRemoveSource={handleRemoveSource}
          />

          {/* Node Settings Editor Panel (Active on selection) */}
          {selectedSource && (
            <div className="glass-panel source-editor">
              <div className="source-editor-header">
                <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Edit3 size={14} style={{ color: 'var(--accent-cyan)' }} />
                  Configure Selected Node: <strong style={{ color: 'var(--accent-cyan)' }}>{selectedSource.name}</strong>
                </span>
                <span className="channel-type-label" style={{ fontSize: '0.65rem' }}>ID: {selectedSource.id}</span>
              </div>
              
              <div className="editor-row">
                {/* Field: Rename */}
                <div className="editor-field">
                  <label>Node Name</label>
                  <input
                    type="text"
                    value={selectedSource.name}
                    onChange={(e) => handleUpdateSource(selectedSource.id, { name: e.target.value })}
                  />
                </div>

                {/* Field: Frequency or File Info */}
                {selectedSource.type === 'oscillator' ? (
                  <>
                    <div className="editor-field">
                      <label>Oscillator Type</label>
                      <select
                        value={selectedSource.oscType}
                        onChange={(e) => handleUpdateSource(selectedSource.id, { oscType: e.target.value })}
                      >
                        <option value="sine">Sine Wave</option>
                        <option value="square">Square Wave</option>
                        <option value="sawtooth">Sawtooth Wave</option>
                        <option value="triangle">Triangle Wave</option>
                      </select>
                    </div>

                    <div className="editor-field" style={{ flex: '1.2' }}>
                      <label style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                        <span>Frequency: <span style={{ fontFamily: 'var(--font-lcd)', color: 'var(--accent-cyan)' }}>{selectedSource.frequency} Hz</span></span>
                        <label style={{display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', textTransform: 'none', color: 'var(--text-main)'}}>
                           <input 
                             type="checkbox" 
                             checked={selectedSource.yMapFreq !== false} 
                             onChange={(e) => handleUpdateSource(selectedSource.id, { yMapFreq: e.target.checked })} 
                           />
                           Map to Y-Axis
                        </label>
                      </label>
                      <input
                        type="range"
                        min="80"
                        max="2000"
                        step="1"
                        value={selectedSource.frequency}
                        disabled={selectedSource.yMapFreq !== false}
                        onChange={(e) => handleUpdateSource(selectedSource.id, { frequency: parseInt(e.target.value) })}
                        title={selectedSource.yMapFreq !== false ? "Frequency is controlled by the Y-axis position on the soundstage" : "Manual frequency control"}
                      />
                    </div>
                  </>
                ) : (
                  <div className="editor-field">
                    <label>Audio Filename</label>
                    <input
                      type="text"
                      disabled
                      value={selectedSource.fileName || 'N/A'}
                      style={{ color: 'var(--text-muted)', background: 'rgba(0,0,0,0.2)' }}
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          <TelemetryPanel
            sources={sources}
            ctxState={ctxState}
            sampleRate={sampleRate}
            collisions={collisions}
            listenerPos={LISTENER_POSITION}
            attenuationModel={attenuationModel}
            setAttenuationModel={setAttenuationModel}
            onResumeContext={handleResumeContext}
            latencyMs={latencyMs}
            onExportConfig={handleExportConfig}
            onClearCache={handleClearCache}
          />
        </div>
      </div>
    </div>
  );
}
