# Inspection Panel Design — 2026-06-24

## Problem
The current inspection form opens inline below the clicked row inside the DataTable. This creates a cramped 4-column grid layout, the action buttons are off-screen, and the employee loses context of the table while filling out the form.

## Solution
Replace the inline expand with a **side panel** (`InspectionPanel`) rendered alongside the DataTable. The employee can switch the panel between right and bottom positions, and the preference is persisted in their browse preset JSON.

---

## Layout

- **No row selected** → DataTable fills full width (existing behavior)
- **Row selected** → CSS grid/flex split: DataTable + InspectionPanel side by side
- **Right mode** (default): `grid-template-columns: minmax(0, 1fr) 480px` — panel on the right (RTL start side)
- **Bottom mode**: flex column — table on top, panel below (max-height ~45vh, form body scrolls)
- The DataTable row shows a `.selected` highlight via `expandedKey` (no `renderExpanded`)

---

## Component Structure

```
src/components/InspectionPanel/
  index.tsx           ← main panel, owns phase state + answer state
  PhaseStepper.tsx    ← visual phase navigator
  PanelHeader.tsx     ← metadata strip + controls
  InspectionPanel.css
```

---

## PanelHeader

- **X-ray ID** always first (monospace, large), + status badge (updates in place)
- **Metadata chips**: iterates `visibleColumns` prop (same columns the user configured in the DataTable); each chip shows `label · value`; skips `__select__` and `xrayImageId`; dates use `colConfig.dateFmt`
- **Controls (top-left in RTL)**:
  - Toggle button: flips `panelPosition` between `"right"` and `"bottom"`, saves to preset immediately
  - Close button: sets `selEntryId(null)` in XrayReferrals

---

## PhaseStepper

- Shown only when template has ≥ 2 phases
- Each phase = clickable card: circle number (filled+dark = active, green checkmark = complete, outlined = upcoming) + phase title
- Clicking any phase navigates directly (no forced linear order)
- Phase is "complete" when all **required** visible fields in it have a non-empty value
- Hidden when only 1 phase

---

## Form Content

- Single-column layout (replaces current 4-column grid)
- Only the **active phase** fields are shown at a time
- Conditional fields cascade: if a source field is hidden, dependent fields are hidden too (already implemented via `isFieldVisible` cascade)
- Read-only view (submitted or readonly prop): label+value rows per phase, all phases visible
- Edit view: `FormField` components, single column, textarea gets more vertical space

---

## Footer (sticky)

- Always visible at the bottom of the panel, does not scroll
- `استبدال العينة` — warning style, only shown for admin when `onReplace` is provided
- `حفظ مسودة` — secondary style
- `تقديم` — primary style
- Hidden entirely when `isSubmitted` or `readonly`

---

## Preset Persistence

`UserBrowsePresetFile` gains `inspectionPanelPosition?: "right" | "bottom"`.

Loaded on mount in XrayReferrals alongside the column preset. Saved immediately on toggle via `saveInspectionPanelPosition(dir, username, position)` (new helper in `browsePresetStorage.ts`).

Default: `"right"` if not set.

---

## Data Flow

```
XrayReferrals
  ↓ panelPosition (from preset, state)
  ↓ selEntryId   → derives selEntry from entries[]
  ↓
  ├── DataTable
  │     expandedKey={selEntryId}   ← highlights selected row
  │     onRowClick → setSelEntryId
  │
  └── InspectionPanel  key={selEntry.xrayImageId}  ← resets state on row change
        entry, template, savedAnswer
        visibleColumns, colConfig
        panelPosition, onTogglePosition
        onClose → setSelEntryId(null)
        onSave(ans, submit) → wraps XrayReferrals.handleSave
        onReplace → openReplacementDialog (admin only)
```

`ItemFormCard` and `FormField` are removed from `XrayReferrals.tsx` (superseded by `InspectionPanel`).

---

## Files Changed

| File | Change |
|---|---|
| `src/components/InspectionPanel/index.tsx` | new |
| `src/components/InspectionPanel/PhaseStepper.tsx` | new |
| `src/components/InspectionPanel/PanelHeader.tsx` | new |
| `src/components/InspectionPanel/InspectionPanel.css` | new |
| `src/data/preferences/browsePresetStorage.ts` | add `inspectionPanelPosition` + helper |
| `src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx` | wire split layout, remove ItemFormCard |
| `src/components/Sidebar/Tabs/EmployeeWorkspace/EmployeeWorkspace.css` | add split layout classes |
| `docs/EDIT_LOG.md` | v4.8 entry |
