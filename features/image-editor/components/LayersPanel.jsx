// Right-hand Layers panel: header with add button and the stack of layer cards
// (rendered top-to-bottom in reverse order). Presentational.
import LayerCard from './LayerCard'

export default function LayersPanel({
  layers,
  selectedLayerId,
  setSelectedLayerId,
  loading,
  onAddLayer,
  onUpdateLayer,
  onMoveLayer,
  onDeleteLayer
}) {
  return (
    <aside className="image-editor-layers-panel">
      <div className="image-editor-layers-panel__header">
        <span className="image-editor-layers-panel__title">Layers</span>
        <div className="image-editor-layers-panel__actions">
          <button type="button" className="image-editor-layer-btn" onClick={onAddLayer} disabled={loading}>
            <span className="material-symbols-outlined">add</span>
          </button>
        </div>
      </div>

      <div className="image-editor-layers-panel__list">
        {layers.length === 0 ? (
          <div className="image-editor-layers-panel__empty">No layers loaded.</div>
        ) : (
          [...layers].slice().reverse().map((layer, reverseIndex) => {
            const index = layers.length - 1 - reverseIndex
            return (
              <LayerCard
                key={layer.id}
                layer={layer}
                isSelected={selectedLayerId === layer.id}
                isFirst={index === layers.length - 1}
                isLast={index === 0}
                setSelectedLayerId={setSelectedLayerId}
                onUpdateLayer={onUpdateLayer}
                onMoveLayer={onMoveLayer}
                onDeleteLayer={onDeleteLayer}
              />
            )
          })
        )}
      </div>
    </aside>
  )
}
