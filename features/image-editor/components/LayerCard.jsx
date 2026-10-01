// A single layer row in the Layers panel. Presentational.
import { PAINT_BLEND_MODES } from './constants'

export default function LayerCard({
  layer,
  isSelected,
  isFirst,
  isLast,
  setSelectedLayerId,
  onUpdateLayer,
  onMoveLayer,
  onDeleteLayer
}) {
  return (
    <div
      className={`image-editor-layer-card ${isSelected ? 'image-editor-layer-card--selected' : ''}`}
      onClick={() => setSelectedLayerId(prev => (prev === layer.id ? null : layer.id))}
    >
      <div className="image-editor-layer-card__header">
        <input
          type="radio"
          className="image-editor-layer-card__radio"
          checked={isSelected}
          onChange={() => setSelectedLayerId(layer.id)}
          onClick={event => {
            event.stopPropagation()
            if (isSelected) {
              event.preventDefault()
              setSelectedLayerId(null)
            }
          }}
        />

        <button
          type="button"
          className="image-editor-layer-card__icon-btn"
          onClick={event => {
            event.stopPropagation()
            onUpdateLayer(layer.id, { visible: !layer.visible })
          }}
          title={layer.visible ? 'Hide layer' : 'Show layer'}
        >
          <span className="material-symbols-outlined">{layer.visible ? 'visibility' : 'visibility_off'}</span>
        </button>

        <input
          className="image-editor-layer-card__name"
          value={layer.name}
          onChange={event => onUpdateLayer(layer.id, { name: event.target.value })}
          onClick={event => event.stopPropagation()}
        />

        <button
          type="button"
          className="image-editor-layer-card__icon-btn"
          title="Move up"
          disabled={isFirst}
          onClick={event => {
            event.stopPropagation()
            onMoveLayer(layer.id, 'up')
          }}
        >
          <span className="material-symbols-outlined">keyboard_arrow_up</span>
        </button>

        <button
          type="button"
          className="image-editor-layer-card__icon-btn"
          title="Move down"
          disabled={isLast}
          onClick={event => {
            event.stopPropagation()
            onMoveLayer(layer.id, 'down')
          }}
        >
          <span className="material-symbols-outlined">keyboard_arrow_down</span>
        </button>

        <button
          type="button"
          className="image-editor-layer-card__icon-btn"
          title={layer.id === 'base-layer' ? 'Base layer cannot be deleted' : 'Delete layer'}
          disabled={layer.id === 'base-layer'}
          onClick={event => {
            event.stopPropagation()
            onDeleteLayer(layer.id)
          }}
        >
          <span className="material-symbols-outlined">delete</span>
        </button>
      </div>

      <div className="image-editor-layer-card__row">
        <span>Opacity</span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={layer.opacity}
          onChange={event => onUpdateLayer(layer.id, { opacity: Number(event.target.value) })}
          onClick={event => event.stopPropagation()}
        />
      </div>

      <div className="image-editor-layer-card__row">
        <span>Blend</span>
        <select
          value={layer.blendMode}
          onChange={event => onUpdateLayer(layer.id, { blendMode: event.target.value })}
          onClick={event => event.stopPropagation()}
        >
          {PAINT_BLEND_MODES.map(mode => (
            <option key={mode.value} value={mode.value}>{mode.label}</option>
          ))}
        </select>
      </div>
    </div>
  )
}
