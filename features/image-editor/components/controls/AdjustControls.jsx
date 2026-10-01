// Levels / Contrast / Saturation tool control panel. Presentational.
export default function AdjustControls({
  adjustValues,
  setAdjustValues,
  setAdjustPreviewDirty,
  onReset,
  onApply
}) {
  const handleChange = key => event => {
    const value = Number(event.target.value)
    setAdjustValues(prev => ({ ...prev, [key]: value }))
    setAdjustPreviewDirty(true)
  }

  return (
    <div className="image-editor-controls">
      <label className="image-editor-label">
        Black Point
        <input
          className="image-editor-input"
          type="range"
          min="0"
          max="254"
          value={adjustValues.blackPoint}
          onChange={handleChange('blackPoint')}
        />
      </label>
      <label className="image-editor-label">
        White Point
        <input
          className="image-editor-input"
          type="range"
          min="1"
          max="255"
          value={adjustValues.whitePoint}
          onChange={handleChange('whitePoint')}
        />
      </label>
      <label className="image-editor-label">
        Contrast
        <input
          className="image-editor-input"
          type="range"
          min="-80"
          max="80"
          value={adjustValues.contrast}
          onChange={handleChange('contrast')}
        />
      </label>
      <label className="image-editor-label">
        Saturation
        <input
          className="image-editor-input"
          type="range"
          min="-100"
          max="100"
          value={adjustValues.saturation}
          onChange={handleChange('saturation')}
        />
      </label>
      <div className="image-editor-toggle-row">
        <button type="button" className="image-editor-btn" onClick={onReset}>
          Reset
        </button>
        <button type="button" className="image-editor-btn image-editor-btn--primary" onClick={onApply}>
          Apply Adjustments
        </button>
      </div>
    </div>
  )
}
