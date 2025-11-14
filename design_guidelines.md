# BatchSWMM Design Guidelines

## Design Approach

**Selected Framework**: Material Design principles adapted for desktop productivity software
**Rationale**: Engineering/technical application requiring clear information hierarchy, efficient workflows, and professional aesthetics similar to Linear, Notion, or VS Code interfaces.

## Typography System

**Font Family**: 
- Primary: Inter (via Google Fonts CDN) for UI elements and body text
- Monospace: JetBrains Mono for file paths and technical output

**Hierarchy**:
- App Title: text-2xl font-semibold
- Section Headers: text-lg font-semibold  
- File Names: text-sm font-medium
- File Paths: text-xs font-mono
- Status Messages: text-sm
- Button Text: text-sm font-medium

## Layout System

**Spacing Primitives**: Tailwind units of 2, 4, 6, and 8 (p-4, gap-6, m-8, etc.)

**Primary Layout**:
- Full viewport height application (h-screen)
- Vertical split layout: Header (fixed) + Main Content Area (flex-1) + Footer (fixed)
- Maximum width: max-w-6xl centered container
- Content padding: px-8 py-6

**Grid System**:
- File list: Single column with generous spacing (gap-4)
- Progress cards: Single column, stacked for clarity
- Results summary: Two-column grid on desktop (grid-cols-2 gap-6)

## Component Library

### Header
- Application title with icon (using Heroicons CDN)
- Subtitle describing batch processing capability
- Minimal height (h-16), fixed positioning

### File Upload Zone
- Large drop zone area (min-h-48) with dashed border
- Prominent upload icon (w-12 h-12)
- Clear instruction text
- File input trigger button (primary action)
- Displays selected file count

### File List Panel
- Each file entry shows: icon, filename, full path (truncated), remove button
- List container with subtle border, rounded corners (rounded-lg)
- Individual file items with hover state
- Empty state with helpful messaging

### Progress Section
- Overall progress bar (full width, h-2, rounded-full)
- Current file indicator card with prominent styling
- Progress percentage (text-2xl font-bold)
- Status text (e.g., "Processing file 3 of 10...")
- Estimated time remaining

### Results Display
- Success/failure cards for each processed file
- Icons for status (checkmark/error from Heroicons)
- File name with path
- Error messages (if any) in monospace font
- Summary statistics card (total processed, succeeded, failed)

### Action Buttons
- Primary: "Start Batch Processing" (px-6 py-3, rounded-lg)
- Secondary: "Clear All" (px-4 py-2, rounded-md)
- Danger: "Cancel Processing" (when running)
- All buttons use clear labels with optional leading icons

### Footer
- Fixed bottom positioning (h-12)
- Version info and executable path display
- Minimal, unobtrusive design

## Interaction Patterns

**File Management**:
- Drag-and-drop support for .inp files
- Click to browse file system
- Individual file removal via icon button
- Batch clear all option

**Progress Feedback**:
- Animated progress bar during processing
- Real-time status updates
- Non-blocking UI (ability to view progress without interaction)
- Visual distinction between queued, processing, completed states

**Results Presentation**:
- Expandable/collapsible error details
- Scroll area for long file lists (max-h-96 overflow-y-auto)
- Clear visual separation between success and failure cases

## Visual Hierarchy Principles

1. **Primary Focus**: File upload zone is the entry point - most prominent when empty
2. **Active State**: Progress section becomes dominant during processing
3. **Completion State**: Results summary takes precedence after batch completion
4. **Consistent Weight**: Maintain clear section boundaries with spacing (py-8 between major sections)

## Icons

**Library**: Heroicons (outline style) via CDN
- Upload: cloud-arrow-up
- File: document-text
- Success: check-circle
- Error: x-circle
- Remove: x-mark
- Processing: arrow-path (with spin animation)

## Desktop Optimization

- Generous padding and spacing (no cramped mobile constraints)
- Wider containers (max-w-4xl to max-w-6xl)
- Larger touch targets for buttons (min-h-10)
- Fixed header/footer to maximize content area
- Scroll containers for file lists rather than pagination

## Accessibility

- Clear focus indicators on all interactive elements
- Semantic HTML structure (main, section, header tags)
- ARIA labels for icon-only buttons
- Keyboard navigation support (tab order, Enter to submit)
- Status announcements for screen readers during progress updates