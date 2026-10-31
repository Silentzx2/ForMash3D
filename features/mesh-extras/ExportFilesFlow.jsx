import { HugeiconsIcon } from '@hugeicons/react'
import { SparklesIcon } from '@hugeicons/core-free-icons'
import { useEffect, useMemo, useRef, useState } from 'react'
import FolderBrowserDialog from './FolderBrowserDialog'
import {
  LAST_EXPORT_FOLDER_KEY,
  browseFolders,
  fetchAssetFile,
  uniqueExportBaseNames,
  writeExportedFiles
} from '../utils/meshExport'
import './ExportFilesFlow.css'

// Export of files that need no settings (images, brushes, presets): all it asks
// is WHERE. Picking a folder starts the copy straight away, and a small card in
// the corner shows the progress and the result. The card is not modal, so the
// page stays usable while a few hundred images copy.
//
// `items` are batch export items ([{ key, name, url, filename }]); each file is
// written as it is, named after its asset.
export default function ExportFilesFlow({ items, onClose }) {
  const [savedFolder] = useState(() => {
    try {
      return localStorage.getItem(LAST_EXPORT_FOLDER_KEY) || ''
    } catch {
      return ''
    }
  })
  // undefined = still checking the remembered folder, '' = none to offer.
  const [initialFolder, setInitialFolder] = useState(savedFolder ? undefined : '')
  const [phase, setPhase] = useState('pick')
  const [progress, setProgress] = useState({ done: 0, name: '' })
  const [result, setResult] = useState(null)
  const [stopRequested, setStopRequested] = useState(false)
  const stopRef = useRef(false)
  const bases = useMemo(() => uniqueExportBaseNames(items), [items])

  // Open the picker where the last export went, unless that folder is gone —
  // a dead path would open the browser on an error instead of a listing.
  useEffect(() => {
    if (!savedFolder) return
    browseFolders(savedFolder)
      .then(() => setInitialFolder(savedFolder))
      .catch(() => setInitialFolder(''))
  }, [savedFolder])

  const run = async (folder) => {
    setPhase('running')
    stopRef.current = false
    const failed = []
    let exported = 0
    let stoppedAt = -1

    for (let index = 0; index < items.length; index += 1) {
      if (stopRef.current) {
        stoppedAt = index
        break
      }
      const item = items[index]
      setProgress({ done: index, name: item.name })
      try {
        // One file per request: a batch of several hundred images would
        // otherwise be held in memory and posted as a single huge upload.
        await writeExportedFiles(folder, [await fetchAssetFile(item, bases[index])])
        exported += 1
      } catch (err) {
        console.error(`Exporting "${item.name}" failed:`, err)
        failed.push({ name: item.name, message: err.message || 'Export failed' })
      }
    }

    if (exported > 0) {
      try {
        localStorage.setItem(LAST_EXPORT_FOLDER_KEY, folder)
      } catch {
        // Only the remembered folder is lost.
      }
    }
    setResult({ folder, exported, failed, stopped: stoppedAt >= 0 ? items.length - stoppedAt : 0 })
    setPhase('done')
  }

  const handleSelect = (path) => {
    if (!path) return
    run(path)
  }

  const requestStop = () => {
    stopRef.current = true
    setStopRequested(true)
  }

  if (phase === 'pick') {
    return initialFolder === undefined ? null : (
      <FolderBrowserDialog initialPath={initialFolder} onSelect={handleSelect} onClose={onClose} />
    )
  }

  const total = items.length
  const frac = phase === 'done' ? 1 : progress.done / Math.max(1, total)

  return (
    <div className="export-files-card" role="status">
      <div className="export-files-card__header">
        <HugeiconsIcon icon={SparklesIcon} size={18} className="export-files-card__icon" />
        <span className="export-files-card__title">
          {phase === 'running'
            ? `Exporting ${total} file${total === 1 ? '' : 's'}…`
            : `Exported ${result.exported} of ${total} file${total === 1 ? '' : 's'}`}
        </span>
        {phase === 'done' && (
          <button type="button" className="export-files-card__close" onClick={onClose} title="Close">
            <HugeiconsIcon icon={SparklesIcon} size={16} className="w-4 h-4" />
          </button>
        )}
      </div>

      <div className="export-files-card__track">
        <div className="export-files-card__bar" style={{ width: `${Math.round(frac * 100)}%` }} />
      </div>

      {phase === 'running' ? (
        <div className="export-files-card__row">
          <span className="export-files-card__message">{progress.done + 1}/{total} · {progress.name}</span>
          <button type="button" className="export-files-card__btn" onClick={requestStop} disabled={stopRequested}>
            {stopRequested ? 'Stopping…' : 'Stop'}
          </button>
        </div>
      ) : (
        <>
          <span className="export-files-card__message" title={result.folder}>to {result.folder}</span>
          {result.stopped > 0 && (
            <span className="export-files-card__message">Stopped — {result.stopped} not exported.</span>
          )}
          {result.failed.length > 0 && (
            <ul className="export-files-card__failures">
              {result.failed.map((entry, index) => (
                <li key={`${entry.name}-${index}`}><strong>{entry.name}</strong> — {entry.message}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
