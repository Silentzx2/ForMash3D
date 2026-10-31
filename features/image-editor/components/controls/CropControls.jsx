// Crop tool control panel. Presentational.
export default function CropControls({
  cropValues,
  cropLimits,
  onChangeX,
  onChangeY,
  onChangeWidth,
  onChangeHeight,
  onApply
}) {
  return (
    <div className="image-editor-controls">
      <label className="image-editor-label">
        X
        <input
          className="image-editor-input"
          type="number"
          value={cropValues.x}
          min={cropLimits.xMin}
          max={cropLimits.xMax}
          step="1"
          onChange={event => onChangeX(event.target.value)}
        />
        <input
          className="image-editor-input"
          type="range"
          min={cropLimits.xMin}
          max={cropLimits.xMax}
          step="1"
          value={cropValues.x}
          onChange={event => onChangeX(event.target.value)}
        />
      </label>
      <label className="image-editor-label">
        Y
        <input
          className="image-editor-input"
          type="number"
          value={cropValues.y}
          min={cropLimits.yMin}
          max={cropLimits.yMax}
          step="1"
          onChange={event => onChangeY(event.target.value)}
        />
        <input
          className="image-editor-input"
          type="range"
          min={cropLimits.yMin}
          max={cropLimits.yMax}
          step="1"
          value={cropValues.y}
          onChange={event => onChangeY(event.target.value)}
        />
      </label>
      <label className="image-editor-label">
        Width
        <input
          className="image-editor-input"
          type="number"
          value={cropValues.width}
          min={cropLimits.widthMin}
          max={cropLimits.widthMax}
          step="1"
          onChange={event => onChangeWidth(event.target.value)}
        />
        <input
          className="image-editor-input"
          type="range"
          min={cropLimits.widthMin}
          max={cropLimits.widthMax}
          step="1"
          value={cropValues.width}
          onChange={event => onChangeWidth(event.target.value)}
        />
      </label>
      <label className="image-editor-label">
        Height
        <input
          className="image-editor-input"
          type="number"
          value={cropValues.height}
          min={cropLimits.heightMin}
          max={cropLimits.heightMax}
          step="1"
          onChange={event => onChangeHeight(event.target.value)}
        />
        <input
          className="image-editor-input"
          type="range"
          min={cropLimits.heightMin}
          max={cropLimits.heightMax}
          step="1"
          value={cropValues.height}
          onChange={event => onChangeHeight(event.target.value)}
        />
      </label>
      <button type="button" className="image-editor-btn image-editor-btn--primary" onClick={onApply}>
        Apply Crop
      </button>
    </div>
  )
}
