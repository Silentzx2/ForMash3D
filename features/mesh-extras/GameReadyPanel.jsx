// Game-Ready check mode left panel. Runs the read-only inspection on the Python
// mesh-tools service and renders the report as a grouped red/amber/green
// checklist. Unlike every other tool panel there is no Keep/Revert — nothing is
// modified — but findings that the editor can fix carry a button that switches to
// the mode that fixes them.
// Presentational: option state + handlers come from MeshEditorPage.
import { NumberField, ToggleField } from './MeshToolField'
import { HugeiconsIcon } from '@hugeicons/react'
import { ActivityIcon, AlertCircle, CheckmarkCircle02Icon, SparklesIcon } from '@hugeicons/core-free-icons'

const STATUS_META = {
  pass: { icon: CheckmarkCircle02Icon, tone: 'text-emerald-400', label: 'Pass' },
  warn: { icon: AlertCircle, tone: 'text-amber-400', label: 'Warning' },
  fail: { icon: AlertCircle, tone: 'text-rose-400', label: 'Fail' },
  info: { icon: ActivityIcon, tone: 'text-zinc-400', label: 'Info' },
}

// What a finding's fix button does. `mode` hands the user off to the tool that
// resolves it; `action` applies the correction there and then, for findings whose
// fix is a single unambiguous operation with no parameters to choose.
const FIXES = {
  optimize: { kind: 'mode', label: 'Optimize', icon: SparklesIcon },
  autouv: { kind: 'mode', label: 'Auto UV', icon: SparklesIcon },
  autoretopo: { kind: 'mode', label: 'Auto Retopo', icon: SparklesIcon },
  repair: { kind: 'mode', label: 'Repair', icon: SparklesIcon },
  ground_pivot: { kind: 'action', label: 'Set pivot on the ground', icon: ActivityIcon },
  centre_pivot: { kind: 'action', label: 'Centre the pivot', icon: ActivityIcon },
}

function CheckRow({ check, onFix, disabled }) {
  const meta = STATUS_META[check.status] || STATUS_META.info
  const fix = check.fix ? FIXES[check.fix] : null

  return (
    <div className="mesh-editor-check-row">
      <span
        className="mesh-editor-check-row__icon text-zinc-400"
        style={{ color: meta.color }}
        title={meta.label}
      >
        {meta.icon}
      </span>
      <div className="mesh-editor-check-row__body">
        <div className="mesh-editor-check-row__head">
          <span className="mesh-editor-check-row__label">{check.label}</span>
          <strong className="mesh-editor-check-row__value">{check.value}</strong>
        </div>
        {check.detail && <span className="mesh-editor-check-row__detail">{check.detail}</span>}
        {fix && (
          <button
            type="button"
            className="mesh-editor-check-row__fix"
            onClick={() => onFix(check.fix)}
            disabled={disabled}
            title={fix.kind === 'action'
              ? `${fix.label} — applies straight away, undoable`
              : `Switch to ${fix.label} to fix this`}
          >
            <HugeiconsIcon icon={SparklesIcon} size={18} className="w-[1em] h-[1em]" />
            <span>{fix.kind === 'action' ? fix.label : `Fix in ${fix.label}`}</span>
          </button>
        )}
      </div>
    </div>
  )
}

// The standalone pivot button offers whichever move actually changes something,
// so it reads as a toggle: a grounded mesh gets "Center Pivot", a centred one
// gets "Set Pivot on the Ground". A mesh sitting at neither defaults to the
// ground — that is what a prop dropped into a level needs — and a second press
// then centres it.
const PIVOT_ACTIONS = {
  ground: { fix: 'centre_pivot', label: 'Center Pivot', icon: ActivityIcon, state: 'The pivot is on the ground at the origin.' },
  centre: { fix: 'ground_pivot', label: 'Set Pivot on the Ground', icon: ActivityIcon, state: 'The pivot is at the centre of the mesh.' },
  off: { fix: 'ground_pivot', label: 'Set Pivot on the Ground', icon: ActivityIcon, state: 'The pivot is off the mesh — neither grounded nor centred.' },
}

export default function GameReadyPanel({
  options,
  setOption,
  running,
  report,
  onRun,
  onFix,
  pivotPlacement,
  onMovePivot,
  disabled,
}) {
  const o = options
  const fieldsDisabled = disabled || running

  // Preserve the order the service emitted the checks in — it runs cheap
  // structural checks before expensive ones, which happens to also be the order
  // they matter in.
  const groups = []
  for (const check of report?.checks || []) {
    const existing = groups.find(group => group.name === check.group)
    if (existing) existing.checks.push(check)
    else groups.push({ name: check.group, checks: [check] })
  }

  const summary = report?.summary
  const blocking = summary ? summary.fail : 0
  const warnings = summary ? summary.warn : 0

  const pivot = PIVOT_ACTIONS[pivotPlacement] || null

  return (
    <>{/* GAME-READY CHECK */}
      <div className="mesh-editor-panel__section">
        <span className="mesh-editor-panel__section-title">Game-Ready Check</span>
        <button
          type="button"
          className="mesh-editor-btn mesh-editor-btn--primary"
          onClick={onRun}
          disabled={disabled || running}
          title="Analyze the mesh against the budgets below — nothing is modified"
        >
          <HugeiconsIcon icon={SparklesIcon} size={18} className="w-[1em] h-[1em]" />
          <span>{running ? 'Checking…' : 'Run Check'}</span>
        </button>

        {report && !running && (
          <div
            className="mesh-editor-check-summary"
            className={`mesh-editor-check-summary ${blocking ? 'border-rose-500/50' : warnings ? 'border-amber-500/50' : 'border-emerald-500/50'}`}
          >
            <span
              <HugeiconsIcon icon={blocking ? AlertCircle : warnings ? AlertCircle : CheckmarkCircle02Icon} size={18} className={blocking ? 'text-rose-400' : warnings ? 'text-amber-400' : 'text-emerald-400'} />
            <span>
              {blocking
                ? `${blocking} blocking issue${blocking === 1 ? '' : 's'}`
                : warnings
                  ? `Ready, with ${warnings} warning${warnings === 1 ? '' : 's'}`
                  : 'Game-ready — everything passed.'}
            </span>
          </div>
        )}
      </div>

      <div className="mesh-editor-panel__section">
        <span className="mesh-editor-panel__section-title">Pivot</span>
        <button
          type="button"
          className="mesh-editor-btn mesh-editor-btn--secondary"
          onClick={() => pivot && onMovePivot(pivot.fix)}
          disabled={fieldsDisabled || !pivot}
          title={pivot
            ? `${pivot.label} — applies straight away, undoable with Ctrl+Z`
            : 'Load a mesh to move its pivot'}
        >
          <HugeiconsIcon icon={SparklesIcon} size={18} className="w-[1em] h-[1em]" />
          <span>{pivot ? pivot.label : 'Center Pivot'}</span>
        </button>
        {pivot && <span className="mesh-editor-panel__hint">{pivot.state}</span>}
      </div>

      {groups.map(group => (
        <div className="mesh-editor-panel__section" key={group.name}>
          <span className="mesh-editor-panel__section-title">{group.name}</span>
          {group.checks.map(check => (
            <CheckRow key={check.id} check={check} onFix={onFix} disabled={running} />
          ))}
        </div>
      ))}

      <div className="mesh-editor-panel__section">
        <span className="mesh-editor-panel__section-title">Budgets</span>
        <NumberField label="Triangle budget" min={1} max={100000000} step={1000}
          value={o.tri_budget} onChange={v => setOption('tri_budget', v)} disabled={fieldsDisabled}
          hint="Warns above this, fails at double it" />
        <NumberField label="Texture resolution" min={16} max={16384} step={256}
          value={o.texture_resolution} onChange={v => setOption('texture_resolution', v)} disabled={fieldsDisabled}
          hint="Atlas size texel density is measured against" />
        <NumberField label="Max materials" min={1} max={1000} step={1}
          value={o.max_material_count} onChange={v => setOption('max_material_count', v)} disabled={fieldsDisabled}
          hint="Each material costs a draw call" />
        <ToggleField label="Expect pivot on the ground" value={o.expect_ground_pivot}
          onChange={v => setOption('expect_ground_pivot', v)} disabled={fieldsDisabled}
          hint="For props and characters that must snap to the floor when placed in a level" />
      </div>

      <div className="mesh-editor-panel__notes">
        <span className="mesh-editor-panel__hint">The check runs on the Python mesh-tools service (Settings → Mesh Tools).</span>
        <span className="mesh-editor-panel__hint">Nothing is modified — this only reports.</span>
      </div>
    </>
  )
}
