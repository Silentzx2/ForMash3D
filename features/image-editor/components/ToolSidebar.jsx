// Left tool sidebar: Edit / Paint / AI tool groups plus the active tool's
// control panel (passed as children). Presentational.
import { TOOLS } from './constants'

const GROUPS = [
  { title: 'Edit', key: 'edit' },
  { title: 'Paint', key: 'paint' },
  { title: 'AI', key: 'ai' }
]

export default function ToolSidebar({ toolGroup, toolId, onSelectTool, children }) {
  return (
    <aside className="image-editor-tools">
      {GROUPS.map(group => (
        <div className="image-editor-tools__group" key={group.key}>
          <h3 className="image-editor-tools__group-title">{group.title}</h3>
          {TOOLS[group.key].map(item => (
            <button
              key={item.id}
              type="button"
              className={`image-editor-tools__item ${toolGroup === group.key && toolId === item.id ? 'image-editor-tools__item--active' : ''}`}
              onClick={() => onSelectTool(group.key, item.id)}
            >
              <span className="material-symbols-outlined">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      ))}

      {children}
    </aside>
  )
}
