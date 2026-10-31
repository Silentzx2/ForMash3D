// Blur / Sharpen tool control panel. Presentational.
export default function FilterControls({
  filterValues,
  setFilterValues,
  setFilterPreviewDirty,
  onReset,
  onApply
}) {
  const handleChange = key => event => {
    const value = Number(event.target.value)
    setFilterValues(prev => ({ ...prev, [key]: value }))
    setFilterPreviewDirty(true)
  }

  return (
    <div className="image-editor-controls">
      <label className="image-editor-label">
        Blur
        <input
          className="image-editor-input"
          type="range"
          min="0"
          max="30"
          value={filterValues.blur}
          onChange={handleChange('blur')}
        />
      </label>
      <label className="image-editor-label">
        Sharpen
        <input
          className="image-editor-input"
          type="range"
          min="0"
          max="100"
          value={filterValues.sharpen}
          onChange={handleChange('sharpen')}
        />
      </label>
      <div className="image-editor-toggle-row">
        <button type="button" className="image-editor-btn" onClick={onReset}>
          Reset
        </button>
        <button type="button" className="image-editor-btn image-editor-btn--primary" onClick={onApply}>
          Apply Filters
        </button>
      </div>
    </div>
  )
}
