// Renders the "Image Inputs" block for ComfyUI workflows: a source selector per
// image-type parameter plus asset/file pickers. Shared by the AI control panels.
// `allowMask` toggles the mask-source option (mask mode) vs full-image labels.
export default function WorkflowImageInputs({
  parameters,
  imageParamSources,
  allowMask,
  onChangeSource,
  onBrowseAsset,
  onChooseFile
}) {
  return (
    <div className="image-editor-controls image-editor-controls--nested">
      <span className="image-editor-label">Image Inputs</span>
      {parameters.map(parameter => {
        const config = imageParamSources[parameter.id] || { type: 'none' }
        const selectValue = allowMask ? config.type : (config.type === 'mask' ? 'none' : config.type)
        return (
          <div key={parameter.id} className="image-editor-label image-editor-ai-input">
            <span>{parameter.name}</span>
            <select
              className="image-editor-input"
              value={selectValue}
              onChange={event => onChangeSource(parameter.id, event.target.value)}
            >
              <option value="none">- Not used -</option>
              <option value="source">
                {allowMask ? 'Use as source image (painted image view)' : 'Use as source image (full image)'}
              </option>
              {allowMask && <option value="mask">Use as mask image (painted mask)</option>}
              <option value="asset">From assets</option>
              <option value="file">From computer</option>
            </select>

            {config.type === 'asset' && (
              <div className="image-editor-ai-row">
                <span className="image-editor-help">{config.asset?.name || 'No asset selected'}</span>
                <button type="button" className="image-editor-btn" onClick={() => onBrowseAsset(parameter.id)}>
                  Browse
                </button>
              </div>
            )}

            {config.type === 'file' && (
              <div className="image-editor-ai-row">
                <span className="image-editor-help">{config.fileName || 'No file chosen'}</span>
                <label className="image-editor-btn" style={{ cursor: 'pointer' }}>
                  Choose file
                  <input
                    type="file"
                    accept="image/*"
                    className="image-editor-hidden-file"
                    onChange={event => {
                      const file = event.target.files?.[0]
                      if (file) {
                        onChooseFile(parameter.id, file)
                      }
                      event.target.value = ''
                    }}
                  />
                </label>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
