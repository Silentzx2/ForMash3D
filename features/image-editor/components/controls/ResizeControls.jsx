// Resize tool control panel. Presentational.
export default function ResizeControls({ resizeValues, setResizeValues, onApply }) {
  return (
    <div className="image-editor-controls">
      <label className="image-editor-label">
        Width
        <input
          className="image-editor-input"
          type="number"
          value={resizeValues.width}
          onChange={event => setResizeValues(prev => ({ ...prev, width: Number(event.target.value) }))}
        />
      </label>
      <label className="image-editor-label">
        Height
        <input
          className="image-editor-input"
          type="number"
          value={resizeValues.height}
          onChange={event => setResizeValues(prev => ({ ...prev, height: Number(event.target.value) }))}
        />
      </label>
      <button type="button" className="image-editor-btn image-editor-btn--primary" onClick={onApply}>
        Apply Resize
      </button>
    </div>
  )
}
