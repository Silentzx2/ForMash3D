// Top toolbar for the Image Editor: back, undo/redo, save, export.
// Presentational — all behavior comes from props.

export default function ImageEditorToolbar({
  imageName,
  onImageNameChange,
  onBack,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  showSaveButtons,
  onSaveImage,
  onSaveNewVersion,
  onExportPng,
  loading,
  saving,
  layerCount
}) {
  const saveDisabled = loading || layerCount === 0 || saving
  const exportDisabled = loading || layerCount === 0

  return (
    <div className="image-editor-toolbar">
      <div className="image-editor-toolbar__left">
        <button type="button" className="image-editor-btn" onClick={onBack}>
          <span className="material-symbols-outlined">arrow_back</span>
          Back
        </button>
        <div>
          <h1 className="image-editor-title font-headline">Image Editor</h1>
        </div>
        <div className="image-editor-toolbar__name-field">
          <label className="image-editor-toolbar__name-label">Image name</label>
          <input
            type="text"
            className="image-editor-toolbar__name-input"
            value={imageName}
            onChange={event => onImageNameChange?.(event.target.value)}
            placeholder="Image name"
          />
        </div>
      </div>

      <div className="image-editor-toolbar__right">
        <button type="button" className="image-editor-btn" onClick={onUndo} disabled={!canUndo} title="Undo (Ctrl/Cmd+Z)">
          <span className="material-symbols-outlined">undo</span>
          Undo
        </button>
        <button type="button" className="image-editor-btn" onClick={onRedo} disabled={!canRedo} title="Redo (Ctrl/Cmd+Shift+Z)">
          <span className="material-symbols-outlined">redo</span>
          Redo
        </button>
        {showSaveButtons && (
          <button type="button" className="image-editor-btn" onClick={onSaveImage} disabled={saveDisabled}>
            <span className="material-symbols-outlined">save</span>
            Save Image
          </button>
        )}
        {showSaveButtons && (
          <button type="button" className="image-editor-btn" onClick={onSaveNewVersion} disabled={saveDisabled}>
            <span className="material-symbols-outlined">save_as</span>
            Save New Version
          </button>
        )}
        <button type="button" className="image-editor-btn image-editor-btn--primary" onClick={onExportPng} disabled={exportDisabled}>
          Export PNG
        </button>
      </div>
    </div>
  )
}
