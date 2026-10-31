// Shadow Remover tool control panel. Presentational.
export default function ShadowRemoverControls({
  shadowRemoverValues,
  setShadowRemoverValues,
  setShadowRemoverPreviewDirty,
  onReset,
  onApply
}) {
  const handleChange = key => event => {
    const value = Number(event.target.value)
    setShadowRemoverValues(prev => ({ ...prev, [key]: value }))
    setShadowRemoverPreviewDirty(true)
  }

  return (
    <div className="image-editor-controls">
      <label className="image-editor-label">
        Strength ({shadowRemoverValues.strength}%)
        <input
          className="image-editor-input"
          type="range"
          min="0"
          max="100"
          value={shadowRemoverValues.strength}
          onChange={handleChange('strength')}
        />
      </label>

      <label className="image-editor-label">
        Shadow Threshold ({shadowRemoverValues.threshold}%)
        <input
          className="image-editor-input"
          type="range"
          min="0"
          max="100"
          value={shadowRemoverValues.threshold}
          onChange={handleChange('threshold')}
        />
      </label>

      <label className="image-editor-label">
        Edge Softness ({shadowRemoverValues.softness}%)
        <input
          className="image-editor-input"
          type="range"
          min="1"
          max="100"
          value={shadowRemoverValues.softness}
          onChange={handleChange('softness')}
        />
      </label>

      <label className="image-editor-label">
        Midtone Protection ({shadowRemoverValues.midtoneProtection}%)
        <input
          className="image-editor-input"
          type="range"
          min="0"
          max="100"
          value={shadowRemoverValues.midtoneProtection}
          onChange={handleChange('midtoneProtection')}
        />
      </label>

      <label className="image-editor-label">
        Shadow Warmth ({shadowRemoverValues.warmth > 0 ? '+' : ''}{shadowRemoverValues.warmth}%)
        <input
          className="image-editor-input"
          type="range"
          min="-100"
          max="100"
          value={shadowRemoverValues.warmth}
          onChange={handleChange('warmth')}
        />
      </label>

      <div className="image-editor-toggle-row">
        <button type="button" className="image-editor-btn" onClick={onReset}>
          Reset
        </button>
        <button type="button" className="image-editor-btn image-editor-btn--primary" onClick={onApply}>
          Apply Shadow Remover
        </button>
      </div>

      <p className="image-editor-help">Lifts shadows using a gamma curve (like Lightroom&apos;s Shadows slider). Warmth corrects the cool blue cast common in outdoor shadows. GPU-accelerated with CPU fallback.</p>
    </div>
  )
}
