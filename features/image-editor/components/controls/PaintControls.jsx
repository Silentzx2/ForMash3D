// Paint (brush / image brush) tool control panel. Presentational.
// All paint state and setters are passed via the `paint` prop bundle.
import { PAINT_BLEND_MODES } from '../constants'

export default function PaintControls({ paint, canUndo, onUndo, onSelectBrushFromLibrary }) {
  const {
    paintMode,
    setPaintMode,
    paintBrushSource,
    setPaintBrushSource,
    paintBrushFileInputRef,
    setPaintBrushFile,
    setPaintBrushAsset,
    paintColor,
    setPaintColor,
    paintSize,
    setPaintSize,
    paintOpacity,
    setPaintOpacity,
    paintHardness,
    setPaintHardness,
    paintBlendMode,
    setPaintBlendMode
  } = paint

  return (
    <div className="image-editor-controls">
      <div className="image-editor-toggle-row">
        <button
          type="button"
          className={`image-editor-toggle ${paintMode === 'draw' ? 'image-editor-toggle--active' : ''}`}
          onClick={() => setPaintMode('draw')}
        >
          Draw
        </button>
        <button
          type="button"
          className={`image-editor-toggle ${paintMode === 'erase' ? 'image-editor-toggle--active' : ''}`}
          onClick={() => setPaintMode('erase')}
        >
          Erase
        </button>
      </div>

      <button type="button" className="image-editor-btn" onClick={onUndo} disabled={!canUndo}>
        Undo
      </button>

      <label className="image-editor-label">
        Brush Source
        <select
          className="image-editor-input"
          value={paintBrushSource}
          onChange={event => setPaintBrushSource(event.target.value)}
        >
          <option value="color">Color Brush</option>
          <option value="asset">Image Brush (Library)</option>
          <option value="computer">Image Brush (Computer)</option>
        </select>
      </label>

      {paintBrushSource === 'asset' && (
        <button type="button" className="image-editor-btn" onClick={onSelectBrushFromLibrary}>
          Select Brush from Library
        </button>
      )}

      {paintBrushSource === 'computer' && (
        <>
          <button type="button" className="image-editor-btn" onClick={() => paintBrushFileInputRef.current?.click()}>
            Upload Brush from Computer
          </button>
          <input
            ref={paintBrushFileInputRef}
            type="file"
            accept=".png,.jpg,.jpeg,.webp"
            className="image-editor-hidden-file"
            onChange={event => {
              const file = event.target.files?.[0]
              if (file) {
                setPaintBrushFile(file)
                setPaintBrushAsset(null)
              }
              event.target.value = ''
            }}
          />
        </>
      )}

      <label className="image-editor-label">
        Color
        <input
          className="image-editor-input image-editor-input--color"
          type="color"
          value={paintColor}
          onChange={event => setPaintColor(event.target.value)}
        />
      </label>

      <label className="image-editor-label">
        Size ({paintSize}px)
        <input
          className="image-editor-input"
          type="range"
          min="1"
          max="320"
          value={paintSize}
          onChange={event => setPaintSize(Number(event.target.value))}
        />
      </label>

      <label className="image-editor-label">
        Opacity ({Math.round(paintOpacity * 100)}%)
        <input
          className="image-editor-input"
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={paintOpacity}
          onChange={event => setPaintOpacity(Number(event.target.value))}
        />
      </label>

      <label className="image-editor-label">
        Hardness ({Math.round(paintHardness * 100)}%)
        <input
          className="image-editor-input"
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={paintHardness}
          onChange={event => setPaintHardness(Number(event.target.value))}
        />
      </label>

      <label className="image-editor-label">
        Blend Mode
        <select
          className="image-editor-input"
          value={paintBlendMode}
          onChange={event => setPaintBlendMode(event.target.value)}
        >
          {PAINT_BLEND_MODES.map(mode => (
            <option key={mode.value} value={mode.value}>{mode.label}</option>
          ))}
        </select>
      </label>

      <p className="image-editor-help">Paint directly on the canvas. If the selected layer is locked, a new layer will be created automatically.</p>
    </div>
  )
}
