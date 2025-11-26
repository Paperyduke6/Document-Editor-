export const PAGE_CONFIG = {
  width: 794,
  height: 1123,
  marginTop: 72,
  marginBottom: 72,
  marginLeft: 72,
  marginRight: 72,
  lineHeight: 24,
  fontSize: 16,
  fontFamily: 'Arial, sans-serif'
};

export interface ContentBlock {
  id: string;
  text: string;
}

export interface Document {
  id?: string;
  title: string;
  content: ContentBlock[];
  created_at?: string;
  updated_at?: string;
}

export interface Line {
  text: string;
  y: number;
  blockId: string;
}

// New: Block segment that appears on a page
export interface BlockSegment {
  blockId: string;
  startOffset: number;  // Character offset in the block where this segment starts
  endOffset: number;    // Character offset in the block where this segment ends
  startLine: number;    // First line index of this segment
  endLine: number;      // Last line index of this segment
  y: number;            // Y position on the page
  height: number;       // Height of this segment
  lines: string[];      // The actual text lines for this segment
}

export interface Page {
  pageNumber: number;
  lines: Line[];  // Keep for backwards compatibility during migration
  segments: BlockSegment[];  // New: segments of blocks that appear on this page
}