import React, { useState, useCallback, useEffect, useRef } from 'react';
import { ContentBlock, Page, PAGE_CONFIG } from './types';
import { PaginationEngine } from './paginationEngine';
import './App.css';

const App: React.FC = () => {
  const [blocks, setBlocks] = useState<ContentBlock[]>([
    { id: Date.now().toString(), text: '' }
  ]);
  const [pages, setPages] = useState<Page[]>([]);
  const [docId, setDocId] = useState<string>('');
  const [loadId, setLoadId] = useState<string>('');
  const [engine] = useState(() => new PaginationEngine());
  const editorRef = useRef<HTMLDivElement>(null);
  const cursorPositionRef = useRef<Map<string, number>>(new Map());
  const isComposingRef = useRef(false);
  const isRestoringCursorRef = useRef(false);
  const [selectAllActive, setSelectAllActive] = useState(false);

  // Repaginate whenever blocks change
  useEffect(() => {
    const newPages = engine.paginate(blocks);
    setPages(newPages);
  }, [blocks, engine]);

  // Restore cursor positions after render
  useEffect(() => {
    if (selectAllActive) return; // Don't restore cursor during select all
    if (cursorPositionRef.current.size === 0) return; // Nothing to restore
    if (isRestoringCursorRef.current) return; // Already restoring, skip

    // Use requestAnimationFrame to ensure DOM is ready
    requestAnimationFrame(() => {
      // Double-check we still have something to restore
      if (cursorPositionRef.current.size === 0) return;

      isRestoringCursorRef.current = true;

      cursorPositionRef.current.forEach((absoluteOffset, blockId) => {
        // Find all segments for this block
        const elements = document.querySelectorAll(`[data-block-id="${blockId}"]`);

        // Find which segment contains this cursor position
        for (const el of Array.from(elements)) {
          const element = el as HTMLElement;
          const segmentStart = parseInt(element.getAttribute('data-segment-start') || '0');
          const segmentEnd = parseInt(element.getAttribute('data-segment-end') || '0');

          // Check if cursor position falls within this segment's range
          if (absoluteOffset >= segmentStart && absoluteOffset <= segmentEnd) {
            // Calculate relative offset within this segment
            const relativeOffset = absoluteOffset - segmentStart;

            // Focus and restore cursor after a brief delay
            setTimeout(() => {
              element.focus();
              restoreCursorPosition(element, relativeOffset);
              isRestoringCursorRef.current = false;
            }, 0);
            break;
          }
        }
      });
      cursorPositionRef.current.clear();
    });
  });

  const handleSave = async () => {
    try {
      const response = await fetch('http://localhost:3001/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'My Document',
          content: blocks
        })
      });
      const data = await response.json();
      setDocId(data.id);
      alert(`Document saved! ID: ${data.id}`);
    } catch (err) {
      alert('Save failed: ' + err);
    }
  };

  const handleLoad = async () => {
    if (!loadId.trim()) {
      alert('Enter a document ID');
      return;
    }
    try {
      const response = await fetch(`http://localhost:3001/documents/${loadId}`);
      const data = await response.json();
      setBlocks(data.content);
      setDocId(data.id);
      alert('Document loaded!');
    } catch (err) {
      alert('Load failed: ' + err);
    }
  };

  const handleClear = () => {
    if (window.confirm('Are you sure you want to clear the entire document? This cannot be undone.')) {
      setBlocks([{ id: Date.now().toString(), text: '' }]);
      setDocId('');
    }
  };

  const saveCursorPosition = (element: HTMLElement): number | null => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;

    const range = selection.getRangeAt(0);
    const preCaretRange = range.cloneRange();
    preCaretRange.selectNodeContents(element);
    preCaretRange.setEnd(range.endContainer, range.endOffset);
    const caretOffset = preCaretRange.toString().length;

    return caretOffset;
  };

  const restoreCursorPosition = (element: HTMLElement, offset: number) => {
    const selection = window.getSelection();
    if (!selection) return;

    if (!element.textContent) {
      const range = document.createRange();
      range.setStart(element, 0);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }

    let charCount = 0;

    const traverseNodes = (node: Node): boolean => {
      if (node.nodeType === Node.TEXT_NODE) {
        const textLength = node.textContent?.length || 0;
        if (charCount + textLength >= offset) {
          const range = document.createRange();
          const nodeOffset = Math.min(offset - charCount, textLength);
          range.setStart(node, nodeOffset);
          range.collapse(true);
          selection.removeAllRanges();
          selection.addRange(range);
          return true;
        }
        charCount += textLength;
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        for (let i = 0; i < node.childNodes.length; i++) {
          if (traverseNodes(node.childNodes[i])) {
            return true;
          }
        }
      }
      return false;
    };

    traverseNodes(element);
  };

  const handleCompositionStart = useCallback(() => {
    isComposingRef.current = true;
  }, []);

  const handleCompositionEnd = useCallback(() => {
    isComposingRef.current = false;
  }, []);

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();

    const target = e.currentTarget;
    const blockId = target.getAttribute('data-block-id');
    if (!blockId) return;

    // Get plain text from clipboard (preserves newlines)
    const pastedText = e.clipboardData.getData('text/plain');
    if (!pastedText) return;

    // Get segment offsets
    const segmentStart = parseInt(target.getAttribute('data-segment-start') || '0');

    // Get current cursor position within the segment
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    const preCaretRange = range.cloneRange();
    preCaretRange.selectNodeContents(target);
    preCaretRange.setEnd(range.endContainer, range.endOffset);
    const caretOffsetInSegment = preCaretRange.toString().length;

    // Calculate absolute position in the full block
    const absoluteCaretOffset = segmentStart + caretOffsetInSegment;

    // Get the length of any selected text (to replace it)
    const selectedText = selection.toString();
    const selectedLength = selectedText.length;

    // Update the block state directly
    setBlocks(prev => prev.map(block => {
      if (block.id !== blockId) return block;

      // Insert pasted text at cursor position, replacing any selection
      const before = block.text.substring(0, absoluteCaretOffset);
      const after = block.text.substring(absoluteCaretOffset + selectedLength);
      const newText = before + pastedText + after;

      return { ...block, text: newText };
    }));

    // Save cursor position for restoration (after the pasted text)
    const newCursorPosition = absoluteCaretOffset + pastedText.length;
    cursorPositionRef.current.clear();
    cursorPositionRef.current.set(blockId, newCursorPosition);
  }, []);

  const handleInput = useCallback((e: React.FormEvent<HTMLDivElement>) => {
    if (isComposingRef.current) return;
    if (isRestoringCursorRef.current) return; // Don't process input during cursor restoration

    const target = e.currentTarget;
    const blockId = target.getAttribute('data-block-id');
    if (!blockId) return;

    // Get segment offsets
    const segmentStart = parseInt(target.getAttribute('data-segment-start') || '0');
    const segmentEnd = parseInt(target.getAttribute('data-segment-end') || '0');

    const cursorPosition = saveCursorPosition(target);
    const segmentText = target.textContent || '';

    if (cursorPosition !== null) {
      // Adjust cursor position to account for segment offset
      const absolutePosition = segmentStart + cursorPosition;
      // Clear any previous cursor position for this block
      cursorPositionRef.current.clear();
      cursorPositionRef.current.set(blockId, absolutePosition);
    }

    // Reconstruct full block text
    setBlocks(prev => prev.map(block => {
      if (block.id !== blockId) return block;

      // Replace the segment portion with the new text
      const before = block.text.substring(0, segmentStart);
      const after = block.text.substring(segmentEnd);
      const newFullText = before + segmentText + after;

      return { ...block, text: newFullText };
    }));
  }, []);

  // Handle Ctrl+A to select all content
  const handleSelectAll = useCallback((e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
      e.preventDefault();
      setSelectAllActive(true);

      // Select all contentEditable elements
      const allEditables = document.querySelectorAll('[contenteditable="true"]');
      const selection = window.getSelection();
      
      if (selection && allEditables.length > 0) {
        const range = document.createRange();
        const firstElement = allEditables[0];
        const lastElement = allEditables[allEditables.length - 1];
        
        range.setStartBefore(firstElement);
        range.setEndAfter(lastElement);
        
        selection.removeAllRanges();
        selection.addRange(range);
      }

      // Reset select all state after a moment
      setTimeout(() => {
        setSelectAllActive(false);
      }, 100);
    }
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    // Handle Ctrl+A first
    if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
      handleSelectAll(e);
      return;
    }

    const target = e.currentTarget;
    const blockId = target.getAttribute('data-block-id');
    if (!blockId) return;

    // Handle multi-block deletion (Delete or Backspace)
    if (e.key === 'Delete' || e.key === 'Backspace') {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return;

      const range = selection.getRangeAt(0);

      // Check if selection spans multiple elements
      if (!range.collapsed && range.startContainer !== range.endContainer) {
        // Find all selected segments
        const allSegments = document.querySelectorAll('[data-block-id]');
        const selectedBlocks = new Map<string, {
          element: HTMLElement,
          segmentStart: number,
          segmentEnd: number,
          isFirst: boolean,
          isLast: boolean,
          selectionStart?: number,
          selectionEnd?: number
        }>();

        // Determine which segments are in the selection
        for (const segEl of Array.from(allSegments)) {
          const element = segEl as HTMLElement;
          if (selection.containsNode(element, true)) {
            const segBlockId = element.getAttribute('data-block-id');
            if (!segBlockId) continue;

            const segmentStart = parseInt(element.getAttribute('data-segment-start') || '0');
            const segmentEnd = parseInt(element.getAttribute('data-segment-end') || '0');

            if (!selectedBlocks.has(segBlockId)) {
              selectedBlocks.set(segBlockId, {
                element,
                segmentStart,
                segmentEnd,
                isFirst: false,
                isLast: false
              });
            }
          }
        }

        // If multiple blocks are selected, handle multi-block deletion
        if (selectedBlocks.size > 1) {
          e.preventDefault();

          // Get selection start and end positions
          const startElement = range.startContainer.nodeType === Node.TEXT_NODE
            ? range.startContainer.parentElement
            : range.startContainer as HTMLElement;
          const endElement = range.endContainer.nodeType === Node.TEXT_NODE
            ? range.endContainer.parentElement
            : range.endContainer as HTMLElement;

          const startSegment = startElement?.closest('[data-block-id]') as HTMLElement;
          const endSegment = endElement?.closest('[data-block-id]') as HTMLElement;

          if (!startSegment || !endSegment) return;

          const startBlockId = startSegment.getAttribute('data-block-id');
          const endBlockId = endSegment.getAttribute('data-block-id');

          if (!startBlockId || !endBlockId) return;

          // Calculate selection offsets within segments
          const startRange = range.cloneRange();
          startRange.selectNodeContents(startSegment);
          startRange.setEnd(range.startContainer, range.startOffset);
          const startOffsetInSegment = startRange.toString().length;

          const endRange = range.cloneRange();
          endRange.selectNodeContents(endSegment);
          endRange.setEnd(range.endContainer, range.endOffset);
          const endOffsetInSegment = endRange.toString().length;

          const startSegmentOffset = parseInt(startSegment.getAttribute('data-segment-start') || '0');
          const endSegmentOffset = parseInt(endSegment.getAttribute('data-segment-start') || '0');

          const absoluteStartOffset = startSegmentOffset + startOffsetInSegment;
          const absoluteEndOffset = endSegmentOffset + endOffsetInSegment;

          // Find block indices
          const startBlockIndex = blocks.findIndex(b => b.id === startBlockId);
          const endBlockIndex = blocks.findIndex(b => b.id === endBlockId);

          if (startBlockIndex === -1 || endBlockIndex === -1) return;

          // Get text before selection in first block and after selection in last block
          const firstBlock = blocks[startBlockIndex];
          const lastBlock = blocks[endBlockIndex];

          const textBefore = firstBlock.text.substring(0, absoluteStartOffset);
          const textAfter = lastBlock.text.substring(absoluteEndOffset);

          // Create merged block
          const mergedText = textBefore + textAfter;

          // Update blocks - remove all selected blocks and replace with merged one
          setBlocks(prev => {
            const newBlocks = [...prev];
            // Replace first block with merged text
            newBlocks[startBlockIndex] = { ...firstBlock, text: mergedText };
            // Remove all blocks from start+1 to end (inclusive)
            newBlocks.splice(startBlockIndex + 1, endBlockIndex - startBlockIndex);
            return newBlocks;
          });

          // Set cursor position
          setTimeout(() => {
            const elements = document.querySelectorAll(`[data-block-id="${startBlockId}"]`);
            for (const el of Array.from(elements)) {
              const element = el as HTMLElement;
              const segStart = parseInt(element.getAttribute('data-segment-start') || '0');
              const segEnd = parseInt(element.getAttribute('data-segment-end') || '0');

              if (absoluteStartOffset >= segStart && absoluteStartOffset <= segEnd) {
                element.focus();
                restoreCursorPosition(element, absoluteStartOffset - segStart);
                break;
              }
            }
          }, 10);

          return;
        }
      }
    }

    if (e.key === 'Enter') {
      e.preventDefault();

      const currentIndex = blocks.findIndex(b => b.id === blockId);
      if (currentIndex === -1) return;

      // Get segment offsets
      const segmentStart = parseInt(target.getAttribute('data-segment-start') || '0');

      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return;

      const range = selection.getRangeAt(0);
      const preCaretRange = range.cloneRange();
      preCaretRange.selectNodeContents(target);
      preCaretRange.setEnd(range.endContainer, range.endOffset);
      const caretOffsetInSegment = preCaretRange.toString().length;

      // Calculate absolute position in the full block
      const absoluteCaretOffset = segmentStart + caretOffsetInSegment;

      // Split the full block at the absolute position
      const currentBlock = blocks[currentIndex];
      const beforeCursor = currentBlock.text.substring(0, absoluteCaretOffset);
      const afterCursor = currentBlock.text.substring(absoluteCaretOffset);

      const newBlock: ContentBlock = {
        id: `block-${Date.now()}-${Math.random()}`,
        text: afterCursor
      };

      setBlocks(prev => {
        const newBlocks = [...prev];
        newBlocks[currentIndex] = { ...newBlocks[currentIndex], text: beforeCursor };
        newBlocks.splice(currentIndex + 1, 0, newBlock);
        return newBlocks;
      });

      setTimeout(() => {
        const newElement = document.querySelector(`[data-block-id="${newBlock.id}"]`) as HTMLDivElement;
        if (newElement) {
          newElement.focus();
          const range = document.createRange();
          const sel = window.getSelection();
          if (newElement.childNodes.length > 0) {
            range.setStart(newElement.childNodes[0], 0);
          } else {
            range.setStart(newElement, 0);
          }
          range.collapse(true);
          sel?.removeAllRanges();
          sel?.addRange(range);
        }
      }, 10);
    } else if (e.key === 'Backspace') {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return;

      const range = selection.getRangeAt(0);
      const preCaretRange = range.cloneRange();
      preCaretRange.selectNodeContents(target);
      preCaretRange.setEnd(range.endContainer, range.endOffset);
      const caretOffsetInSegment = preCaretRange.toString().length;

      // Get segment offsets
      const segmentStart = parseInt(target.getAttribute('data-segment-start') || '0');

      // Only merge blocks if we're at the very start of the block (first segment, position 0)
      if (caretOffsetInSegment === 0 && segmentStart === 0 && blocks.length > 1) {
        e.preventDefault();
        const currentIndex = blocks.findIndex(b => b.id === blockId);
        if (currentIndex > 0) {
          const prevBlock = blocks[currentIndex - 1];
          const currentBlock = blocks[currentIndex];
          const prevTextLength = prevBlock.text.length;

          setBlocks(prev => {
            const newBlocks = [...prev];
            newBlocks[currentIndex - 1] = {
              ...prevBlock,
              text: prevBlock.text + currentBlock.text
            };
            newBlocks.splice(currentIndex, 1);
            return newBlocks;
          });

          setTimeout(() => {
            // Find the segment in the previous block that contains the cursor position
            const prevElements = document.querySelectorAll(`[data-block-id="${prevBlock.id}"]`);
            let targetElement: HTMLElement | null = null;

            for (const el of Array.from(prevElements)) {
              const element = el as HTMLElement;
              const start = parseInt(element.getAttribute('data-segment-start') || '0');
              const end = parseInt(element.getAttribute('data-segment-end') || '0');

              if (prevTextLength >= start && prevTextLength <= end) {
                targetElement = element;
                break;
              }
            }

            // If not found, use the last segment
            if (!targetElement && prevElements.length > 0) {
              targetElement = prevElements[prevElements.length - 1] as HTMLElement;
            }

            if (targetElement) {
              targetElement.focus();
              const segStart = parseInt(targetElement.getAttribute('data-segment-start') || '0');
              restoreCursorPosition(targetElement, prevTextLength - segStart);
            }
          }, 10);
        }
      }
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const currentIndex = blocks.findIndex(b => b.id === blockId);
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return;

      const range = selection.getRangeAt(0);
      const preCaretRange = range.cloneRange();
      preCaretRange.selectNodeContents(target);
      preCaretRange.setEnd(range.endContainer, range.endOffset);
      const caretOffset = preCaretRange.toString().length;

      if (e.key === 'ArrowUp' && caretOffset === 0 && currentIndex > 0) {
        e.preventDefault();
        const prevBlock = blocks[currentIndex - 1];
        const prevElement = document.querySelector(`[data-block-id="${prevBlock.id}"]`) as HTMLDivElement;
        if (prevElement) {
          prevElement.focus();
          restoreCursorPosition(prevElement, prevBlock.text.length);
        }
      } else if (e.key === 'ArrowDown' && caretOffset === target.textContent?.length && currentIndex < blocks.length - 1) {
        e.preventDefault();
        const nextBlock = blocks[currentIndex + 1];
        const nextElement = document.querySelector(`[data-block-id="${nextBlock.id}"]`) as HTMLDivElement;
        if (nextElement) {
          nextElement.focus();
          restoreCursorPosition(nextElement, 0);
        }
      }
    }
  }, [blocks, handleSelectAll]);

  // Global keyboard event listener for Ctrl+A
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        // Check if focus is inside document container
        const activeElement = document.activeElement;
        const isInEditor = activeElement?.closest('.document-container');
        
        if (isInEditor) {
          e.preventDefault();
          setSelectAllActive(true);

          const allEditables = document.querySelectorAll('[contenteditable="true"]');
          const selection = window.getSelection();
          
          if (selection && allEditables.length > 0) {
            const range = document.createRange();
            const firstElement = allEditables[0];
            const lastElement = allEditables[allEditables.length - 1];
            
            range.setStartBefore(firstElement);
            range.setEndAfter(lastElement);
            
            selection.removeAllRanges();
            selection.addRange(range);
          }

          setTimeout(() => {
            setSelectAllActive(false);
          }, 100);
        }
      }
    };

    document.addEventListener('keydown', handleGlobalKeyDown);
    return () => document.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  return (
    <div className="App">
      <div className="controls">
        <button onClick={handleSave}>💾 Save</button>
        <input
          type="text"
          placeholder="Enter Document ID to load"
          value={loadId}
          onChange={e => setLoadId(e.target.value)}
        />
        <button onClick={handleLoad}>📂 Load</button>
        <button onClick={handleClear} style={{ backgroundColor: '#e74c3c', color: 'white' }}>🗑️ Clear</button>
        {docId && <span className="doc-id">ID: {docId}</span>}
        <span className="page-count">📄 {pages.length} {pages.length === 1 ? 'Page' : 'Pages'}</span>
      </div>

      <div className="document-container" ref={editorRef}>
        {pages.length === 0 ? (
          <div className="empty-state">
            <p>Click on the page below to start typing...</p>
            <p className="hint">Press <kbd>Ctrl+A</kbd> (or <kbd>Cmd+A</kbd>) to select all content</p>
          </div>
        ) : null}
        
        {pages.map(page => (
          <div
            key={page.pageNumber}
            className="page"
            style={{
              width: PAGE_CONFIG.width,
              height: PAGE_CONFIG.height,
              padding: `${PAGE_CONFIG.marginTop}px ${PAGE_CONFIG.marginRight}px ${PAGE_CONFIG.marginBottom}px ${PAGE_CONFIG.marginLeft}px`,
            }}
          >
            <div className="page-content">
              {page.segments.map((segment, segmentIndex) => {
                const block = blocks.find(b => b.id === segment.blockId);
                if (!block) return null;

                // Generate unique key for this segment
                const uniqueKey = `page-${page.pageNumber}-segment-${segment.blockId}-${segmentIndex}`;

                // Render ONLY the visible text for this segment
                const visibleText = segment.lines.join('\n');

                return (
                  <div
                    key={uniqueKey}
                    data-block-id={segment.blockId}
                    data-segment-start={segment.startOffset}
                    data-segment-end={segment.endOffset}
                    contentEditable
                    suppressContentEditableWarning
                    onPaste={handlePaste}
                    onInput={handleInput}
                    onKeyDown={handleKeyDown}
                    onCompositionStart={handleCompositionStart}
                    onCompositionEnd={handleCompositionEnd}
                    className="editable-block"
                    style={{
                      position: 'absolute',
                      left: 0,
                      top: segment.y - PAGE_CONFIG.marginTop,
                      width: '100%',
                      height: segment.height,
                      lineHeight: `${PAGE_CONFIG.lineHeight}px`,
                      fontSize: PAGE_CONFIG.fontSize,
                      fontFamily: PAGE_CONFIG.fontFamily,
                      outline: 'none',
                      whiteSpace: 'pre-wrap',
                      wordWrap: 'break-word',
                      direction: 'ltr',
                      textAlign: 'left',
                      unicodeBidi: 'embed',
                      overflow: 'hidden',
                      userSelect: 'text',
                      WebkitUserSelect: 'text',
                      MozUserSelect: 'text',
                      msUserSelect: 'text',
                    }}
                  >
                    {visibleText}
                  </div>
                );
              })}
            </div>
            
            <div className="page-number">
              Page {page.pageNumber} of {pages.length}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default App;