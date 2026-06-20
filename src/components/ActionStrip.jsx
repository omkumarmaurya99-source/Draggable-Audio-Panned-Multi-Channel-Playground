import React, { useRef } from 'react';
import { PlusCircle, Upload, RotateCcw, Trash2, Download, ToggleLeft, ToggleRight, FileInput, VolumeX, Volume2 } from 'lucide-react';

/**
 * ActionStrip Component
 * A toolbar containing control triggers for the canvas stage and engine actions.
 * Includes: Initialize Audio Context (header), Upload Local Audio File,
 * Mute Master Soundstage, Grid Snapping, Export/Import JSON, Reset/Clear.
 */
export default function ActionStrip({
  onAddOscillator,
  onAddAudioFile,
  onResetToDefault,
  onClearStage,
  onExportConfig,
  onImportConfig,
  snapping,
  setSnapping,
  masterMuted,
  onToggleMasterMute
}) {
  const fileInputRef = useRef(null);
  const configInputRef = useRef(null);

  // Trigger file dialogs
  const handleUploadClick = () => {
    if (fileInputRef.current) fileInputRef.current.click();
  };

  const handleConfigClick = () => {
    if (configInputRef.current) configInputRef.current.click();
  };

  // Process uploaded audio file
  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      onAddAudioFile(file);
      // Reset input value so same file can be uploaded again if removed
      e.target.value = '';
    }
  };

  // Process imported JSON configuration
  const handleConfigChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target.result);
        onImportConfig(json);
      } catch (err) {
        alert('Invalid JSON configuration file: ' + err.message);
      }
      e.target.value = '';
    };
    reader.readAsText(file);
  };

  return (
    <div className="action-strip">
      {/* Node Creation Tools */}
      <div className="action-group">
        <button 
          className="btn btn-primary"
          onClick={onAddOscillator}
          title="Add a new synthesizer oscillator source"
        >
          <PlusCircle size={16} />
          Add Oscillator Node
        </button>

        <div className="file-upload-wrapper">
          <button 
            className="btn btn-accent"
            onClick={handleUploadClick}
            title="Upload and load a custom local audio file"
          >
            <Upload size={16} />
            Upload Audio File
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            onChange={handleFileChange}
          />
        </div>

        {/* Mute Master Soundstage */}
        <button
          className={`btn ${masterMuted ? 'btn-danger' : ''}`}
          onClick={onToggleMasterMute}
          title={masterMuted ? 'Unmute master soundstage output' : 'Mute entire soundstage output'}
          style={masterMuted ? {} : { background: 'hsla(145, 85%, 50%, 0.1)', borderColor: 'hsla(145, 85%, 50%, 0.3)', color: 'var(--accent-green)' }}
        >
          {masterMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          {masterMuted ? 'Master MUTED' : 'Mute Master'}
        </button>
      </div>

      {/* Grid Snapping Utility */}
      <div className="action-group">
        <button
          className={`btn ${snapping ? 'btn-primary' : ''}`}
          onClick={() => setSnapping(!snapping)}
          title="Snap drag movements to 5% intervals"
          style={snapping ? { background: 'hsla(186, 100%, 48%, 0.15)', borderColor: 'var(--accent-cyan)', color: 'var(--accent-cyan)' } : {}}
        >
          {snapping ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
          Grid Snapping: {snapping ? 'ON' : 'OFF'}
        </button>
      </div>

      {/* System Configurations and resets */}
      <div className="action-group">
        {/* Export JSON */}
        <button
          className="btn"
          onClick={onExportConfig}
          title="Download the current stage coordinates and properties as a JSON file"
        >
          <Download size={16} />
          Export JSON
        </button>

        {/* Import JSON */}
        <div className="file-upload-wrapper">
          <button
            className="btn"
            onClick={handleConfigClick}
            title="Upload a previously saved JSON configuration file to restore stage"
          >
            <FileInput size={16} />
            Import JSON
          </button>
          <input
            ref={configInputRef}
            type="file"
            accept=".json"
            onChange={handleConfigChange}
          />
        </div>

        {/* Reset Default */}
        <button
          className="btn"
          onClick={onResetToDefault}
          title="Restore stage to default starting setup"
        >
          <RotateCcw size={16} />
          Reset Default
        </button>

        {/* Clear Stage */}
        <button
          className="btn btn-danger"
          onClick={onClearStage}
          title="Remove all channels and clear the soundstage"
        >
          <Trash2 size={16} />
          Clear Stage
        </button>
      </div>
    </div>
  );
}
