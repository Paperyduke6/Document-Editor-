import { PAGE_CONFIG, ContentBlock, Page, Line, BlockSegment } from './types';
import { TextMeasurer } from './textMeasurer';

export class PaginationEngine {
  private measurer: TextMeasurer;

  constructor() {
    this.measurer = new TextMeasurer();
  }

  private getContentWidth(): number {
    return PAGE_CONFIG.width - PAGE_CONFIG.marginLeft - PAGE_CONFIG.marginRight;
  }

  private getContentHeight(): number {
    return PAGE_CONFIG.height - PAGE_CONFIG.marginTop - PAGE_CONFIG.marginBottom;
  }

  paginate(blocks: ContentBlock[]): Page[] {
    const pages: Page[] = [];
    let currentPage: Page = { pageNumber: 1, lines: [], segments: [] };
    let currentY = PAGE_CONFIG.marginTop;

    for (const block of blocks) {
      // Handle completely empty blocks
      if (block.text.length === 0) {
        const lineHeight = PAGE_CONFIG.lineHeight;

        if (currentY + lineHeight > PAGE_CONFIG.height - PAGE_CONFIG.marginBottom) {
          pages.push(currentPage);
          currentPage = { pageNumber: pages.length + 1, lines: [], segments: [] };
          currentY = PAGE_CONFIG.marginTop;
        }

        // Add to lines (backwards compatibility)
        currentPage.lines.push({
          text: '',
          y: currentY,
          blockId: block.id
        });

        // Add as a segment
        currentPage.segments.push({
          blockId: block.id,
          startOffset: 0,
          endOffset: 0,
          startLine: 0,
          endLine: 0,
          y: currentY,
          height: lineHeight,
          lines: ['']
        });

        currentY += lineHeight;
        continue;
      }

      // Break text into lines (preserving whitespace)
      const allLines = this.measurer.breakIntoLines(
        block.text,
        this.getContentWidth()
      );

      // Track character offset for each line
      let charOffset = 0;
      const lineOffsets: { start: number; end: number; text: string }[] = [];

      for (const lineText of allLines) {
        const lineLength = lineText.length;
        lineOffsets.push({
          start: charOffset,
          end: charOffset + lineLength,
          text: lineText
        });
        // Add 1 for newline character (except for last line)
        charOffset += lineLength + 1;
      }

      // Now place lines on pages, creating segments
      let lineIndex = 0;
      let segmentStartLine = 0;
      let segmentStartY = currentY;
      let segmentLines: string[] = [];

      for (const lineInfo of lineOffsets) {
        const lineHeight = PAGE_CONFIG.lineHeight;

        // Check if line fits on current page
        if (currentY + lineHeight > PAGE_CONFIG.height - PAGE_CONFIG.marginBottom) {
          // Finalize current segment if any
          if (segmentLines.length > 0) {
            currentPage.segments.push({
              blockId: block.id,
              startOffset: lineOffsets[segmentStartLine].start,
              endOffset: lineOffsets[lineIndex - 1].end,
              startLine: segmentStartLine,
              endLine: lineIndex - 1,
              y: segmentStartY,
              height: (lineIndex - segmentStartLine) * lineHeight,
              lines: segmentLines
            });
          }

          // Start new page
          pages.push(currentPage);
          currentPage = { pageNumber: pages.length + 1, lines: [], segments: [] };
          currentY = PAGE_CONFIG.marginTop;
          segmentStartY = currentY;
          segmentStartLine = lineIndex;
          segmentLines = [];
        }

        // Add to lines (backwards compatibility)
        currentPage.lines.push({
          text: lineInfo.text,
          y: currentY,
          blockId: block.id
        });

        // Add to current segment
        segmentLines.push(lineInfo.text);

        currentY += lineHeight;
        lineIndex++;
      }

      // Finalize last segment of this block
      if (segmentLines.length > 0) {
        currentPage.segments.push({
          blockId: block.id,
          startOffset: lineOffsets[segmentStartLine].start,
          endOffset: lineOffsets[lineIndex - 1].end,
          startLine: segmentStartLine,
          endLine: lineIndex - 1,
          y: segmentStartY,
          height: (lineIndex - segmentStartLine) * PAGE_CONFIG.lineHeight,
          lines: segmentLines
        });
      }
    }

    // Push last page
    if (currentPage.lines.length > 0 || currentPage.segments.length > 0) {
      pages.push(currentPage);
    }

    return pages;
  }
}