# Architecture Documentation

## Editor State Model

### State Hierarchy

```
App Component (Root)
  ├─ blocks: ContentBlock[]           // Source of truth for content
  ├─ pages: Page[]                    // Derived state from pagination
  ├─ docId: string                    // Current document ID
  ├─ cursorPositionRef: Map<blockId, absoluteOffset>  // Cursor tracking
  └─ isRestoringCursorRef: boolean    // Race condition guard
```

### State Flow

```
User Input → handleInput() → Update blocks[] → Trigger Pagination
                                                       ↓
                                              pages[] calculated
                                                       ↓
                                              React re-renders
                                                       ↓
                                              Cursor restoration
```

### ContentBlock (Data Model)

**Philosophy**: Blocks represent *semantic* content units (paragraphs), not visual layout.

```typescript
interface ContentBlock {
  id: string;    // "block-1701234567890-0.123456"
  text: string;  // Full paragraph text (unbounded length)
}
```

**Lifecycle**:
- Created: User presses Enter (splits current block)
- Modified: User types (text updates)
- Deleted: User backspaces at block start (merges with previous)
- **Never split due to pagination**

### BlockSegment (Rendering Model)

**Philosophy**: Segments are *ephemeral* views of block data for rendering.

```typescript
interface BlockSegment {
  blockId: string;      // References ContentBlock
  startOffset: number;  // Character position in block.text
  endOffset: number;    // Character position in block.text
  startLine: number;    // Line index within block
  endLine: number;      // Line index within block
  y: number;           // Absolute Y on page
  height: number;      // Pixel height
  lines: string[];     // Actual visible text
}
```

**Properties**:
- Calculated during pagination (not stored)
- Multiple segments can reference same block
- Each segment renders only its portion of block text
- Segments on different pages have different offsets

## Pagination Algorithm

### Input & Output

**Input**: `ContentBlock[]` (array of paragraphs)
**Output**: `Page[]` (array of pages with segments)

### Algorithm Steps

#### Phase 1: Text Measurement

```javascript
class TextMeasurer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  measureText(text: string): number {
    return this.ctx.measureText(text).width;
  }

  breakIntoLines(text: string, maxWidth: number): string[] {
    // Word-wrapping algorithm
    // Preserves whitespace and newlines
    // Returns array of line strings
  }
}
```

**Complexity**: O(n) where n = total characters

#### Phase 2: Line Breaking

For each block:
1. Split text by explicit newlines (`\n`)
2. For each paragraph:
   - Split into words (preserving spaces)
   - Build lines until width exceeds `maxWidth`
   - Track character offsets for each line

```javascript
// Example: "Hello world this is a long paragraph"
lineOffsets = [
  { start: 0, end: 11, text: "Hello world" },
  { start: 12, end: 27, text: "this is a long" },
  { start: 28, end: 37, text: "paragraph" }
]
```

#### Phase 3: Page Layout

```javascript
let currentY = PAGE_CONFIG.marginTop;
let currentPage = { pageNumber: 1, segments: [] };

for (const block of blocks) {
  const lines = measurer.breakIntoLines(block.text, contentWidth);

  let segmentLines = [];
  let segmentStartLine = 0;

  for (let i = 0; i < lines.length; i++) {
    if (currentY + lineHeight > pageBottom) {
      // Finalize segment
      currentPage.segments.push({
        blockId: block.id,
        startOffset: lineOffsets[segmentStartLine].start,
        endOffset: lineOffsets[i-1].end,
        lines: segmentLines,
        y: segmentStartY,
        height: (i - segmentStartLine) * lineHeight
      });

      // New page
      pages.push(currentPage);
      currentPage = { pageNumber: pages.length + 1, segments: [] };
      currentY = PAGE_CONFIG.marginTop;

      // Reset segment tracking
      segmentLines = [];
      segmentStartLine = i;
    }

    segmentLines.push(lines[i]);
    currentY += lineHeight;
  }

  // Finalize last segment of block
  currentPage.segments.push({ /* ... */ });
}
```

**Complexity**: O(n) where n = total lines

### Edge Cases Handled

1. **Empty blocks**: Rendered as single blank line
2. **Very long words**: Break at character boundary if no spaces
3. **Whitespace preservation**: Tabs → 4 spaces, newlines preserved
4. **Multi-page blocks**: Single block can span 10+ pages

## Rendering Strategy

### React Component Structure

```jsx
<App>
  └─ <div className="document-container">
      {pages.map(page =>
        <div className="page">
          {page.segments.map(segment =>
            <div
              contentEditable
              data-block-id={segment.blockId}
              data-segment-start={segment.startOffset}
              data-segment-end={segment.endOffset}>
              {segment.lines.join('\n')}
            </div>
          )}
        </div>
      )}
  </div>
</App>
```

### Segment Rendering

Each segment is an independent `contentEditable` div:

```javascript
<div
  key={`page-${pageNum}-segment-${blockId}-${index}`}
  style={{
    position: 'absolute',
    top: segment.y - PAGE_CONFIG.marginTop,
    height: segment.height,
    overflow: 'hidden'  // Clips content to segment bounds
  }}>
  {segment.lines.join('\n')}  // ONLY visible lines
</div>
```

**Critical**: Render `segment.lines`, NOT full `block.text`

### Input Handling

When user types in a segment:

```javascript
handleInput(e) {
  const blockId = e.target.dataset.blockId;
  const segmentStart = parseInt(e.target.dataset.segmentStart);
  const segmentEnd = parseInt(e.target.dataset.segmentEnd);
  const newSegmentText = e.target.textContent;

  // Reconstruct full block text
  const block = blocks.find(b => b.id === blockId);
  const before = block.text.substring(0, segmentStart);
  const after = block.text.substring(segmentEnd);
  const newBlockText = before + newSegmentText + after;

  // Update block
  setBlocks(blocks.map(b =>
    b.id === blockId ? { ...b, text: newBlockText } : b
  ));
}
```

### Cursor Persistence

**Challenge**: React re-renders destroy DOM elements, losing cursor position.

**Solution**: Three-phase restoration

```javascript
// Phase 1: Save (during input)
const cursorOffset = getCursorOffset(element);
const absoluteOffset = segmentStart + cursorOffset;
cursorPositionRef.current.set(blockId, absoluteOffset);

// Phase 2: Re-render
// React updates DOM, cursor position lost

// Phase 3: Restore (after render)
useEffect(() => {
  requestAnimationFrame(() => {
    const elements = document.querySelectorAll(`[data-block-id="${blockId}"]`);
    for (const element of elements) {
      const segStart = element.dataset.segmentStart;
      const segEnd = element.dataset.segmentEnd;

      if (absoluteOffset >= segStart && absoluteOffset <= segEnd) {
        const relativeOffset = absoluteOffset - segStart;
        element.focus();
        setCursorPosition(element, relativeOffset);
        break;
      }
    }
  });
});
```

**Race Condition Prevention**:
- `isRestoringCursorRef`: Guards against concurrent restorations
- Input blocking during restoration
- Cleared cursor map after each restoration

## Persistence Flow

### Save Flow

```
User clicks "Save"
  ↓
POST /documents { title, content: blocks[] }
  ↓
Server generates UUID
  ↓
Server writes JSON file: data/{uuid}.json
  ↓
Server returns { id: uuid }
  ↓
Client displays document ID
```

### Load Flow

```
User enters document ID
  ↓
GET /documents/{id}
  ↓
Server reads data/{id}.json
  ↓
Server returns { id, title, content, created_at, updated_at }
  ↓
Client: setBlocks(response.content)
  ↓
Pagination recalculates
  ↓
Editor displays loaded content
```

### Storage Format

File: `server/data/71b8d791-d7b2-44e3-bf5b-bfa4ca3a34de.json`

```json
{
  "id": "71b8d791-d7b2-44e3-bf5b-bfa4ca3a34de",
  "title": "My Document",
  "content": [
    {
      "id": "block-1701234567890-0.123",
      "text": "First paragraph with potentially very long text..."
    },
    {
      "id": "block-1701234567891-0.456",
      "text": "Second paragraph..."
    }
  ],
  "created_at": "2024-11-26T10:30:00.000Z",
  "updated_at": "2024-11-26T10:30:00.000Z"
}
```

**Benefits**:
- Human-readable
- Version control friendly
- Easy debugging
- Simple backup/restore

**Trade-offs**:
- Not suitable for large-scale production
- No concurrent write protection
- File I/O overhead

## Performance Characteristics

### Time Complexity

| Operation | Complexity | Notes |
|-----------|------------|-------|
| Pagination | O(n) | n = total characters |
| Text measurement | O(n) | Canvas API calls |
| Rendering | O(s) | s = total segments |
| Input handling | O(1) | Single block update |
| Cursor restoration | O(s_b) | s_b = segments per block (usually 1-3) |

### Space Complexity

| Data Structure | Size | Notes |
|----------------|------|-------|
| blocks[] | O(b) | b = number of blocks |
| pages[] | O(p) | p = number of pages |
| segments | O(b) | Each block → 1-N segments |

### Optimization Opportunities

1. **Virtualization**: Only render visible pages (not implemented)
2. **Incremental pagination**: Only repaginate changed blocks (not implemented)
3. **Web Workers**: Offload text measurement (not implemented)
4. **Memoization**: Cache line breaks for unchanged blocks (not implemented)

**Current Status**: Optimized for documents up to ~100 pages. Beyond that, consider implementing above optimizations.

## Design Decisions

### Why Segments Instead of Block Splitting?

**Rejected Approach**: Split blocks at page boundaries
- ❌ Complex merge logic on backspace
- ❌ Data model couples with presentation
- ❌ Version history polluted with layout changes
- ❌ Text selection breaks across split blocks

**Chosen Approach**: Keep blocks intact, use segments for rendering
- ✅ Clean separation of concerns
- ✅ Intuitive editing behavior
- ✅ Text selection works seamlessly
- ✅ Data model reflects user intent

### Why Canvas for Text Measurement?

**Alternatives Considered**:
- CSS with hidden div: Slower, causes reflow
- Fixed-width font: Inaccurate for proportional fonts
- Estimated averages: Breaks on edge cases

**Canvas API Benefits**:
- Pixel-perfect accuracy
- No DOM manipulation
- Fast (native code)
- Matches actual rendering

### Why File-Based Storage?

**Decision**: Simplicity for prototype/demo
- Fast to implement
- Zero configuration
- Easy to inspect
- Human-readable

**Production Alternative**: PostgreSQL with JSONB columns for block content
