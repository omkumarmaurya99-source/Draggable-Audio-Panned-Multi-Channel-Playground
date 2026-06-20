/**
 * Spatial Audio Engine
 * Manages the Web Audio API context, audio graphs for each channel,
 * uploads, play/pause states, volume, panning, visualizers, and proximity effects.
 */
class SpatialAudioEngine {
  constructor() {
    this.ctx = null;
    this.sources = new Map(); // Map<id, SourceGraph>
    this.buffers = new Map(); // Map<fileName, AudioBuffer>
    this.masterGain = null;
    this.masterAnalyser = null;
    this.isMasterMuted = false;
    this._savedMasterVolume = 0.8;
  }

  /**
   * Initializes the AudioContext on user interaction to comply with autoplay policies.
   */
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
      return this.ctx;
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      console.error('Web Audio API is not supported in this browser.');
      return null;
    }

    this.ctx = new AudioContextClass();
    
    // Master routing
    this.masterAnalyser = this.ctx.createAnalyser();
    this.masterAnalyser.fftSize = 256;
    
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.setValueAtTime(0.8, this.ctx.currentTime); // Master volume default
    
    this.masterAnalyser.connect(this.masterGain);
    this.masterGain.connect(this.ctx.destination);

    console.log('Audio Engine initialized in state:', this.ctx.state);
    return this.ctx;
  }

  /**
   * Returns the current status of the audio context
   */
  getStatus() {
    if (!this.ctx) return 'uninitialized';
    return this.ctx.state;
  }

  /**
   * Resume suspended context
   */
  async resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
    return this.getStatus();
  }

  /**
   * Suspend context
   */
  async suspend() {
    if (this.ctx && this.ctx.state === 'running') {
      await this.ctx.suspend();
    }
    return this.getStatus();
  }

  /**
   * Decodes and caches audio file buffers
   */
  async decodeAudioFile(file) {
    this.init(); // Make sure context is up
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const arrayBuffer = e.target.result;
          const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);
          this.buffers.set(file.name, audioBuffer);
          resolve({ name: file.name, buffer: audioBuffer });
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = (error) => reject(error);
      reader.readAsArrayBuffer(file);
    });
  }

  /**
   * Adds a new sound channel to the audio engine
   * @param {string} id - Unique source ID
   * @param {Object} config - Initial configurations (type, volume, pan, etc.)
   */
  addSource(id, config) {
    this.init(); // Ensure context is running

    // If source already exists, clean it up first
    if (this.sources.has(id)) {
      this.removeSource(id);
    }

    const audioCtx = this.ctx;

    // Create the static parts of the channel graph
    const gainNode = audioCtx.createGain();
    const filterNode = audioCtx.createBiquadFilter();
    const pannerNode = audioCtx.createStereoPanner ? audioCtx.createStereoPanner() : null;
    const analyserNode = audioCtx.createAnalyser();
    
    // Configure nodes
    analyserNode.fftSize = 128;
    
    // Proximity Lowpass Filter: default fully open (20kHz)
    filterNode.type = 'lowpass';
    filterNode.frequency.setValueAtTime(20000, audioCtx.currentTime);
    filterNode.Q.setValueAtTime(1, audioCtx.currentTime);

    // Proximity Tremolo (LFO) setup
    const lfoNode = audioCtx.createOscillator();
    lfoNode.type = 'sine';
    lfoNode.frequency.setValueAtTime(6, audioCtx.currentTime); // 6Hz wobble
    
    const lfoGainNode = audioCtx.createGain();
    lfoGainNode.gain.setValueAtTime(0, audioCtx.currentTime); // Start with 0 tremolo depth

    // Connect LFO to modulate gain parameter
    lfoNode.connect(lfoGainNode);
    lfoGainNode.connect(gainNode.gain);
    lfoNode.start();

    // Set initial values
    const initialVol = config.muted ? 0 : (config.volume !== undefined ? config.volume : 0.5);
    gainNode.gain.setValueAtTime(initialVol, audioCtx.currentTime);
    
    if (pannerNode) {
      pannerNode.pan.setValueAtTime(config.pan || 0, audioCtx.currentTime);
    }

    // Connect the static chain
    // Source (dynamic) -> filterNode -> gainNode -> pannerNode -> analyserNode -> Master
    if (pannerNode) {
      gainNode.connect(pannerNode);
      pannerNode.connect(analyserNode);
    } else {
      // Fallback if StereoPanner is not supported
      gainNode.connect(analyserNode);
    }
    
    analyserNode.connect(this.masterAnalyser);

    const sourceGraph = {
      type: config.type, // 'oscillator' | 'file'
      oscType: config.oscType || 'sine',
      frequency: config.frequency || 440,
      fileName: config.fileName || null,
      volume: config.volume !== undefined ? config.volume : 0.5,
      muted: !!config.muted,
      playing: !!config.playing,
      pan: config.pan || 0,
      
      // Web Audio Nodes
      sourceNode: null,
      gainNode,
      filterNode,
      pannerNode,
      analyserNode,
      lfoNode,
      lfoGainNode,
      
      // Proximity states
      proximityIntensity: 0 // 0 to 1
    };

    this.sources.set(id, sourceGraph);

    // If it is set to play, start it
    if (config.playing) {
      this.playSource(id);
    }
  }

  /**
   * Starts playback for a source node
   */
  playSource(id) {
    const graph = this.sources.get(id);
    if (!graph) return;

    this.init();

    // Stop existing source node if running
    if (graph.sourceNode) {
      try {
        graph.sourceNode.stop();
      } catch (e) {}
      graph.sourceNode.disconnect();
    }

    const audioCtx = this.ctx;
    let sourceNode;

    if (graph.type === 'oscillator') {
      sourceNode = audioCtx.createOscillator();
      sourceNode.type = graph.oscType;
      sourceNode.frequency.setValueAtTime(graph.frequency, audioCtx.currentTime);
    } else if (graph.type === 'file') {
      if (!graph.fileName) return;
      const buffer = this.buffers.get(graph.fileName);
      if (!buffer) {
        console.warn(`Buffer not found for file: ${graph.fileName}`);
        return;
      }
      sourceNode = audioCtx.createBufferSource();
      sourceNode.buffer = buffer;
      sourceNode.loop = true; // Loop audio files by default for spatial stage
    }

    if (!sourceNode) return;

    // Connect source to filter
    sourceNode.connect(graph.filterNode);
    graph.filterNode.connect(graph.gainNode);
    
    sourceNode.start(0);
    graph.sourceNode = sourceNode;
    graph.playing = true;
  }

  /**
   * Stops playback for a source node (Web Audio source nodes cannot be paused/resumed, they must be recreated)
   */
  pauseSource(id) {
    const graph = this.sources.get(id);
    if (!graph) return;

    if (graph.sourceNode) {
      try {
        graph.sourceNode.stop();
      } catch (e) {}
      graph.sourceNode.disconnect();
      graph.sourceNode = null;
    }
    graph.playing = false;
  }

  /**
   * Updates audio parameters for a source
   */
  updateSource(id, params) {
    const graph = this.sources.get(id);
    if (!graph) return;

    const audioCtx = this.ctx;
    const time = audioCtx ? audioCtx.currentTime : 0;

    // Volume & Mute Updates
    if (params.volume !== undefined) graph.volume = params.volume;
    if (params.muted !== undefined) graph.muted = params.muted;

    if (graph.gainNode && audioCtx) {
      const targetGain = graph.muted ? 0 : graph.volume;
      // Smooth ramp to avoid pops (50ms transition)
      graph.gainNode.gain.setTargetAtTime(targetGain, time, 0.03);
    }

    // Panning Updates (Horizontal offset calculation results)
    if (params.pan !== undefined && graph.pannerNode && audioCtx) {
      graph.pan = params.pan;
      graph.pannerNode.pan.setTargetAtTime(params.pan, time, 0.03);
    }

    // Frequency Updates (Synth source only)
    if (params.frequency !== undefined) {
      graph.frequency = params.frequency;
      if (graph.sourceNode && graph.type === 'oscillator' && audioCtx) {
        graph.sourceNode.frequency.setTargetAtTime(params.frequency, time, 0.03);
      }
    }

    // Oscillator Type Updates
    if (params.oscType !== undefined) {
      graph.oscType = params.oscType;
      if (graph.sourceNode && graph.type === 'oscillator') {
        graph.sourceNode.type = params.oscType;
      }
    }

    // Handle Play / Pause state changes
    if (params.playing !== undefined && params.playing !== graph.playing) {
      if (params.playing) {
        this.playSource(id);
      } else {
        this.pauseSource(id);
      }
    }
  }

  /**
   * Applies continuous proximity effects (lowpass filter sweep + LFO tremolo)
   * @param {string} id - Source ID
   * @param {number} intensity - 0 (no proximity) to 1 (overlapping/maximum collision)
   */
  setProximityEffect(id, intensity) {
    const graph = this.sources.get(id);
    if (!graph || !this.ctx) return;

    graph.proximityIntensity = intensity;
    const time = this.ctx.currentTime;

    // 1. Modulate Lowpass Filter frequency (cutoff frequency goes down as proximity increases)
    // Curved transition for dramatic effect (from 20,000Hz down to 250Hz)
    const baseFreq = 20000;
    const minFreq = 250;
    // Exponential curve: drops faster as it gets closer
    const targetFreq = baseFreq - Math.pow(intensity, 1.8) * (baseFreq - minFreq);
    graph.filterNode.frequency.setTargetAtTime(targetFreq, time, 0.05);

    // 2. Modulate LFO Tremolo depth (amplitude wobble increases as proximity increases)
    // Max modulation depth is 0.45 (so if volume is 0.5, it oscillates between 0.05 and 0.95)
    const targetLfoGain = intensity * 0.45;
    graph.lfoGainNode.gain.setTargetAtTime(targetLfoGain, time, 0.05);
  }

  /**
   * Disconnects and removes a sound channel
   */
  removeSource(id) {
    const graph = this.sources.get(id);
    if (!graph) return;

    this.pauseSource(id);

    // Clean up nodes
    if (graph.lfoNode) {
      try { graph.lfoNode.stop(); } catch (e) {}
      graph.lfoNode.disconnect();
    }
    if (graph.lfoGainNode) graph.lfoGainNode.disconnect();
    if (graph.gainNode) graph.gainNode.disconnect();
    if (graph.pannerNode) graph.pannerNode.disconnect();
    if (graph.filterNode) graph.filterNode.disconnect();
    if (graph.analyserNode) graph.analyserNode.disconnect();

    this.sources.delete(id);

    // Auto-suspend the audio context if no sources are left to save CPU/battery
    if (this.sources.size === 0 && this.ctx && this.ctx.state === 'running') {
      this.suspend();
    }
  }

  /**
   * Returns live frequency data for a channel visualizer
   */
  getWaveform(id) {
    const graph = this.sources.get(id);
    if (!graph || !graph.analyserNode) return null;

    const dataArray = new Uint8Array(graph.analyserNode.frequencyBinCount);
    graph.analyserNode.getByteTimeDomainData(dataArray);
    return dataArray;
  }

  /**
   * Resets/clears the entire mixer engine
   */
  clearAll() {
    const ids = Array.from(this.sources.keys());
    ids.forEach(id => this.removeSource(id));
    this.sources.clear();
  }

  /**
   * Change Master volume
   */
  setMasterVolume(volume) {
    if (this.masterGain && this.ctx) {
      this._savedMasterVolume = volume;
      this.masterGain.gain.setTargetAtTime(volume, this.ctx.currentTime, 0.05);
    }
  }

  /**
   * Toggle master mute on/off. Returns new muted state.
   */
  toggleMasterMute() {
    this.isMasterMuted = !this.isMasterMuted;
    if (this.masterGain && this.ctx) {
      const targetVol = this.isMasterMuted ? 0 : this._savedMasterVolume;
      this.masterGain.gain.setTargetAtTime(targetVol, this.ctx.currentTime, 0.03);
    }
    return this.isMasterMuted;
  }

  /**
   * Returns the audio processing latency in milliseconds.
   * Uses AudioContext.baseLatency and outputLatency where available.
   */
  getLatencyMs() {
    if (!this.ctx) return { base: 0, output: 0, total: 0 };

    // baseLatency: processing delay inherent to the AudioContext (seconds)
    const baseLatency = this.ctx.baseLatency || 0;
    // outputLatency: delay of the audio output device (seconds)
    const outputLatency = this.ctx.outputLatency || 0;
    const totalLatency = baseLatency + outputLatency;

    return {
      base: parseFloat((baseLatency * 1000).toFixed(2)),
      output: parseFloat((outputLatency * 1000).toFixed(2)),
      total: parseFloat((totalLatency * 1000).toFixed(2))
    };
  }
}

// Export a singleton instance of the engine
const engine = new SpatialAudioEngine();
export default engine;
