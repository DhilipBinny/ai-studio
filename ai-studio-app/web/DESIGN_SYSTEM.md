# Echol AI Studio — Design System & Coding Standards

**Date:** 2026-05-12
**Status:** ACTIVE — All code in this project MUST follow these standards
**Stack:** Next.js 16 + shadcn/ui + Tailwind CSS v4 + TypeScript

---

## 1. Typography Scale

All text in the app follows this hierarchy. No custom font sizes.

| Role | Tailwind Class | Size | Weight | Tracking | Use |
|---|---|---|---|---|---|
| Page title | `text-2xl` | 24px | `font-semibold` | `tracking-tight` | Top of each page |
| Section heading | `text-lg` | 18px | `font-semibold` | `tracking-tight` | Card groups, content sections |
| Card title | `text-base` | 16px | `font-medium` | default | Card headers, dialog titles |
| Body text | `text-sm` | 14px | `font-normal` | default | All body content, table cells, descriptions |
| Label / Caption | `text-xs` | 12px | `font-medium` | `tracking-wide` | Form labels, sidebar groups, badge text, tooltip content |
| Metric number | `text-3xl` | 30px | `font-semibold` | `tracking-tight` | Dashboard KPI values |
| Muted helper | `text-sm` | 14px | `font-normal` | default | Applied with `text-muted-foreground` |

### Rules
- `text-sm` (14px) is the base — all body content, table cells, form inputs
- Never use `text-base` (16px) for body text in the dashboard — it's only for card titles
- Page descriptions always: `text-muted-foreground` (no extra class needed)
- Headings never exceed `text-2xl` (24px) inside the studio layout
- Monospace for code/IDs: `font-mono text-xs`

---

## 2. Spacing System

8px grid. All spacing uses Tailwind's scale. Preferred values:

| Token | Tailwind | Value | Use |
|---|---|---|---|
| Micro | `gap-1` / `p-1` | 4px | Icon gaps inside buttons, badge padding |
| Tight | `gap-1.5` / `p-1.5` | 6px | Label-to-input gap, compact inner spacing |
| Small | `gap-2` / `p-2` | 8px | Table cell padding, nav item padding, compact cards |
| Medium | `gap-3` / `p-3` | 12px | Input horizontal padding, dropdown items |
| Standard | `gap-4` / `p-4` | 16px | Card padding (compact), gap between cards |
| Comfortable | `gap-6` / `p-6` | 24px | Page content padding, section spacing, dialog padding |
| Large | `gap-8` / `p-8` | 32px | Major section breaks |

### Page Layout Spacing
```
Page outer padding:        p-6 (24px)
Gap between page sections: space-y-6 (24px)
Card grid gap:             gap-4 (16px) on md:grid-cols-2, lg:grid-cols-3
Card inner padding:        p-4 (16px) — shadcn card default
Table cell padding:        p-2 (8px) — shadcn table default
Form field vertical gap:   space-y-4 (16px) between fields
Label to input gap:        space-y-1.5 (6px)
Dialog body padding:       p-4 (16px)
```

---

## 3. Color System

### Brand Colors (Echol)
```
Primary:        oklch(0.35 0.12 20)    ~#811a1b (dark maroon)
Primary light:  oklch(0.94 0.02 20)    ~#c08c8d
```

### Semantic Status Colors (add to globals.css)

| Status | CSS Variable | Light Approx | Use |
|---|---|---|---|
| Success | `--success` | `#22c55e` | Active, completed, healthy, online |
| Warning | `--warning` | `#f59e0b` | Pending, needs attention, in-progress |
| Error | `--destructive` (built-in) | `#ef4444` | Failed, critical, errors |
| Info | `--info` | `#3b82f6` | Informational, neutral status |
| Muted | `--muted` (built-in) | `#6b7280` | Disabled, archived, inactive |

### Usage Rules
- Never rely on color alone — always combine with text label and/or icon
- Status badges: dot indicator (`size-1.5 rounded-full`) + text label
- Destructive actions: `text-destructive` color + confirmation dialog
- Links: `text-primary` with `hover:underline`

---

## 4. Component Standards

### 4.1 Buttons

**Hierarchy (one primary per view):**

| Variant | When to Use | Example |
|---|---|---|
| `default` (primary) | Main CTA — one per view | "Create Agent", "Save" |
| `secondary` | Supporting action | "Cancel", "Save Draft" |
| `outline` | Tertiary / optional | "Export", "Filter" |
| `ghost` | Toolbar actions, table row actions | Icon buttons in toolbars |
| `destructive` | Delete/remove — always with confirmation | "Delete Agent" |
| `link` | Inline text navigation only | "View documentation" |

**Size usage:**
- Default (`h-8`): Standard everywhere
- `sm` (`h-7`): Table row actions, compact toolbars
- `lg` (`h-9`): Prominent CTAs (rare)
- `icon` (`size-8`): Icon-only buttons — always add `aria-label` + tooltip

**Icon placement:**
- Leading icon (left): standard for actions — `<Plus className="mr-2 size-4" />`
- Trailing icon (right): directional only — `Next <ChevronRight />`
- Icon size: always `size-4` (16px)

**Loading state:**
```tsx
<Button disabled={isPending}>
  {isPending ? (
    <>
      <Loader2 className="size-4 animate-spin" />
      Saving...
    </>
  ) : (
    <>
      <Save className="size-4" />
      Save Changes
    </>
  )}
</Button>
```

### 4.2 Tables

**Structure:**
```tsx
<Table>
  <TableHeader>
    <TableRow>
      <TableHead className="w-[50px]">  {/* checkbox column */}
      <TableHead>Name</TableHead>
      <TableHead>Status</TableHead>
      <TableHead className="text-right">Actions</TableHead>
    </TableRow>
  </TableHeader>
  <TableBody>
    <TableRow>
      <TableCell>...</TableCell>
    </TableRow>
  </TableBody>
</Table>
```

**Specifications:**
```
Header height:        h-10 (40px)
Row height:           h-10 (40px) default, h-12 (48px) comfortable
Cell padding:         p-2 (8px) — shadcn default
Font:                 text-sm (14px) for all cells
Header font:          text-sm font-medium text-muted-foreground
Checkbox column:      w-[50px]
Actions column:       text-right, ghost icon buttons (size-7)
Selected row:         bg-muted
Hover row:            hover:bg-muted/50
```

**Sorting indicators:**
- Neutral: no icon
- Active ascending: `<ArrowUp className="ml-1 size-3" />`
- Active descending: `<ArrowDown className="ml-1 size-3" />`
- Sortable header: `cursor-pointer select-none`

**Pagination:**
- Number-based (not infinite scroll) for all data tables
- Show: "Page X of Y" + Previous/Next buttons + page size selector
- Default page size: 10 rows (options: 10, 20, 50)
- Position: below table, right-aligned
- Pattern:
```tsx
<div className="flex items-center justify-between py-4">
  <p className="text-sm text-muted-foreground">
    Showing {from}-{to} of {total} results
  </p>
  <div className="flex items-center gap-2">
    <Button variant="outline" size="sm" disabled={!hasPrev}>Previous</Button>
    <Button variant="outline" size="sm" disabled={!hasNext}>Next</Button>
  </div>
</div>
```

### 4.3 Forms

**Label placement:** Always top-aligned (above input).

**Field layout:**
```tsx
<div className="space-y-4">
  <div className="space-y-1.5">
    <Label htmlFor="name">
      Agent Name <span className="text-destructive">*</span>
    </Label>
    <Input id="name" placeholder="e.g., Document Reviewer" />
  </div>

  <div className="space-y-1.5">
    <Label htmlFor="desc">Description</Label>
    <Textarea id="desc" placeholder="What does this agent do?" />
  </div>
</div>
```

**Validation:**
- Trigger: on blur (when user leaves field), NOT on keystroke
- Error message: directly below input, `text-xs text-destructive`
- Required fields: asterisk `*` in `text-destructive` after label text
- Invalid input: `aria-invalid="true"` triggers built-in destructive border

**Input widths by content:**
| Content | Max Width |
|---|---|
| Short codes (prefix, ID) | `max-w-[150px]` |
| Names, emails | `max-w-[350px]` |
| URLs, addresses | `max-w-[500px]` |
| Full-width | `max-w-full` (default) |

### 4.4 Dialogs / Modals

**Size system:**
| Size | Class | Width | Use |
|---|---|---|---|
| Small | `sm:max-w-sm` | 384px | Confirmations, simple alerts |
| Medium | `sm:max-w-lg` | 512px | Standard forms, detail views |
| Large | `sm:max-w-2xl` | 672px | Complex forms, multi-step |
| XL | `sm:max-w-4xl` | 896px | Data-heavy content, wide tables |

**Structure:**
```tsx
<Dialog>
  <DialogContent className="sm:max-w-lg">
    <DialogHeader>
      <DialogTitle>Create Agent</DialogTitle>
      <DialogDescription>Configure a new AI agent.</DialogDescription>
    </DialogHeader>
    <div className="space-y-4 py-4">
      {/* form fields */}
    </div>
    <DialogFooter>
      <Button variant="outline">Cancel</Button>
      <Button>Create</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

**Behavior:**
- `Escape`: always closes
- Overlay click: closes for non-destructive dialogs; prevented for forms with unsaved changes
- Focus trap: always active
- Close button (X): always present

### 4.5 Tooltips

**Configuration (set once in root layout):**
```tsx
<TooltipProvider delayDuration={400} skipDelayDuration={200}>
  {children}
</TooltipProvider>
```

**Specifications:**
```
Delay:          400ms before showing
Skip delay:     200ms when moving between tooltips
Max width:      max-w-xs (240px)
Font:           text-xs (12px)
Padding:        px-3 py-1.5
Position:       top (default), auto-flips at viewport edges
Max content:    Under 150 characters / 3 lines
```

**When to use:**
- Icon-only buttons (mandatory)
- Truncated text
- Abbreviations or technical terms
- Additional context that doesn't fit in the UI

**When NOT to use:**
- Information the user needs to complete a task (use inline help)
- Long content (use popover or inline description)
- Mobile-primary interfaces (no hover on touch)

### 4.6 Dropdowns / Select

**Which component:**
| Scenario | Component |
|---|---|
| 5 or fewer options | Radio group or simple `<Select>` |
| 6-15 options | Standard `<Select>` |
| 15+ options | Searchable Combobox |
| Multi-select | Checkbox group (< 10) or multi-select Combobox (10+) |

**Specifications:**
```
Max visible items:     8-10 before scrolling
Dropdown max height:   max-h-[300px]
Search input:          sticky at top of dropdown
Group header:          text-xs font-medium text-muted-foreground
Item height:           h-8 (32px)
```

### 4.7 Badges / Status Indicators

**Status badge pattern (dot + label):**
```tsx
<Badge variant="outline" className="gap-1.5">
  <span className={cn("size-1.5 rounded-full", colorClass)} />
  {label}
</Badge>
```

**Color mapping:**

| Status | Dot Color | Badge Variant |
|---|---|---|
| Active / Online / Healthy | `bg-green-500` | `outline` |
| Running / In Progress | `bg-blue-500` | `outline` |
| Pending / Warning | `bg-amber-500` | `outline` |
| Failed / Error | `bg-red-500` | `outline` |
| Inactive / Archived | `bg-gray-400` | `outline` |
| Draft | `bg-gray-400` | `secondary` |

**Specifications:**
```
Height:          h-5 (20px) — shadcn default
Padding:         px-2 (8px)
Font:            text-xs (12px) font-medium
Border radius:   rounded-full (pill shape) for status badges
Dot size:        size-1.5 (6px)
```

### 4.8 Toasts / Notifications

**Library:** Sonner (shadcn/ui default)

**Configuration:**
```tsx
<Toaster
  position="bottom-right"
  duration={4000}
  closeButton
  richColors
/>
```

**Duration by type:**
| Type | Duration | Auto-dismiss |
|---|---|---|
| Success | 4000ms | Yes |
| Info | 5000ms | Yes |
| Warning | 6000ms | Yes |
| Error | 8000ms | No — user must dismiss |

**Rules:**
- Max 3 visible toasts at a time
- Under 140 characters per toast
- Max 1 action button per toast (e.g., "Undo", "View")
- Position: always bottom-right

### 4.9 Empty States

**Consistent pattern for all empty list/table views:**
```tsx
<Card className="border-dashed">
  <CardContent className="flex flex-col items-center justify-center py-12">
    <div className="rounded-full bg-muted p-3 mb-4">
      <Icon className="size-6 text-muted-foreground" />
    </div>
    <h3 className="text-lg font-semibold mb-1">{title}</h3>
    <p className="text-sm text-muted-foreground mb-4 max-w-[300px] text-center">
      {description}
    </p>
    <Button>
      <Plus className="size-4" />
      {actionLabel}
    </Button>
  </CardContent>
</Card>
```

**Rules:**
- Always use `border-dashed` on the container card
- Icon in `rounded-full bg-muted p-3` container
- Single CTA button (max 2)
- Description: 1-2 sentences, max 300px wide
- Min height: `py-12` (96px padding)

### 4.10 Loading States

| Pattern | When | Implementation |
|---|---|---|
| Skeleton | Initial page/card load | `<Skeleton className="h-4 w-[120px]" />` |
| Spinner in button | Form submission | `<Loader2 className="size-4 animate-spin" />` |
| Progress bar | File upload, long operations | shadcn Progress component |
| Full-page skeleton | Route transitions | Suspense + skeleton fallback |

**Skeleton rules:**
- Match the approximate shape and size of the loaded content
- Use `animate-pulse` (shadcn default)
- Group skeletons with `space-y-2` for text blocks
- Dashboard cards: skeleton title (h-4 w-[120px]) + skeleton value (h-8 w-[80px])

---

## 5. Layout Standards

### Page Template

Every studio page follows this structure:
```tsx
export default function PageName() {
  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Page Title</h2>
          <p className="text-sm text-muted-foreground">
            Brief description of what this page does.
          </p>
        </div>
        {/* Optional primary action */}
        <Button>
          <Plus className="size-4" />
          Create Item
        </Button>
      </div>

      {/* Page content */}
      {/* Cards, tables, forms, etc. */}
    </div>
  );
}
```

### Dashboard Card Grid
```tsx
<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
  {/* Stat cards */}
</div>
```

### Sidebar
```
Expanded:      16rem (256px) — var(--sidebar-width)
Collapsed:     3rem (48px) — var(--sidebar-width-icon)
Mobile:        18rem (288px) overlay with backdrop
Item height:   h-8 (32px)
Active state:  bg-sidebar-accent text-sidebar-accent-foreground
Group label:   text-xs font-medium text-muted-foreground
```

### Responsive Breakpoints
```
sm:    640px    Large phones
md:    768px    Tablets — sidebar collapses to rail
lg:    1024px   Laptops — sidebar expanded, 2-3 col grids
xl:    1280px   Desktops — full layout, 3-4 col grids
2xl:   1536px   Large monitors
```

### Header Bar
```
Height:        h-14 (56px)
Content:       SidebarTrigger + Separator + Breadcrumbs (optional)
Border:        border-b
Padding:       px-4
```

---

## 6. Dark Mode

**Implementation:** `next-themes` with `attribute="class"`

**Rules:**
- All colors use CSS variables (never hardcode hex in components)
- Test every component in both light and dark mode
- Surface depth in dark mode: background → card → popover (progressively lighter)
- Use `dark:` prefix only when CSS variables don't automatically adapt

---

## 7. Breadcrumbs

**When to use:** Pages with 3+ levels of depth (e.g., Agents > Agent Detail > Edit)
**Position:** Inside header bar, after SidebarTrigger + Separator
**Current page:** `font-medium text-foreground` (not a link)
**Separator:** `/` character or `ChevronRight` at `size-3.5`

---

## 8. Icons

**Library:** Lucide React (already installed)
**Default size:** `size-4` (16px) — inside buttons, nav items, table actions
**Large icons:** `size-6` (24px) — empty states, feature icons
**Muted icons:** Apply `text-muted-foreground`

---

## 9. Coding Conventions

### File Naming
- Components: `PascalCase.tsx` (e.g., `AgentCard.tsx`)
- Pages: `page.tsx` (Next.js convention)
- Layouts: `layout.tsx`
- Utilities: `camelCase.ts` (e.g., `formatDate.ts`)
- Types: `types.ts` or inline

### Component Structure
```tsx
// 1. Imports
import { ... } from "@/components/ui/...";

// 2. Types (if needed)
interface AgentCardProps { ... }

// 3. Component
export function AgentCard({ ... }: AgentCardProps) {
  return ( ... );
}
```

### Import Aliases
```
@/components/*    → src/components/*
@/lib/*           → src/lib/*
@/app/*           → src/app/*
```

### Rules
- No inline styles — use Tailwind classes only
- No custom CSS files per component — globals.css + Tailwind only
- Use `cn()` from `@/lib/utils` for conditional classes
- Server Components by default; add `"use client"` only when needed
- Extract reusable patterns into `src/components/` (not copy-paste)
- All interactive elements must be keyboard accessible
- All images must have `alt` text
- All icon-only buttons must have `aria-label`
