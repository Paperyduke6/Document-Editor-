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
  const [selectAllActive, setSelectAllActive] = useState(false);

  // Repaginate whenever blocks change
  useEffect(() => {
    const newPages = engine.paginate(blocks);
    setPages(newPages);
  }, [blocks, engine]);

  // Restore cursor positions after render
  useEffect(() => {
    if (selectAllActive) return; // Don't restore cursor during select all

    cursorPositionRef.current.forEach((offset, blockId) => {
      const element = document.querySelector(`[data-block-id="${blockId}"]`) as HTMLElement;
      if (element && document.activeElement === element) {
        restoreCursorPosition(element, offset);
      }
    });
    cursorPositionRef.current.clear();
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

  const handleInput = useCallback((e: React.FormEvent<HTMLDivElement>) => {
    if (isComposingRef.current) return;

    const target = e.currentTarget;
    const blockId = target.getAttribute('data-block-id');
    if (!blockId) return;

    const cursorPosition = saveCursorPosition(target);
    const newText = target.textContent || '';

    if (cursorPosition !== null) {
      cursorPositionRef.current.set(blockId, cursorPosition);
    }

    // Update block text - blocks can now span multiple pages
    setBlocks(prev => prev.map(block =>
      block.id === blockId ? { ...block, text: newText } : block
    ));
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

    if (e.key === 'Enter') {
      e.preventDefault();
      
      const currentIndex = blocks.findIndex(b => b.id === blockId);
      if (currentIndex === -1) return;

      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return;

      const range = selection.getRangeAt(0);
      const preCaretRange = range.cloneRange();
      preCaretRange.selectNodeContents(target);
      preCaretRange.setEnd(range.endContainer, range.endOffset);
      const caretOffset = preCaretRange.toString().length;

      const currentText = target.textContent || '';
      const beforeCursor = currentText.substring(0, caretOffset);
      const afterCursor = currentText.substring(caretOffset);

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
      const caretOffset = preCaretRange.toString().length;

      if (caretOffset === 0 && blocks.length > 1) {
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
            const prevElement = document.querySelector(`[data-block-id="${prevBlock.id}"]`) as HTMLDivElement;
            if (prevElement) {
              prevElement.focus();
              restoreCursorPosition(prevElement, prevTextLength);
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

                // Calculate the offset to hide content before this segment
                const linesBefore = segment.startLine;
                const offsetY = linesBefore * PAGE_CONFIG.lineHeight;

                return (
                  <div
                    key={uniqueKey}
                    data-block-id={segment.blockId}
                    data-segment-start={segment.startOffset}
                    data-segment-end={segment.endOffset}
                    contentEditable
                    suppressContentEditableWarning
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
                    }}
                  >
                    <div
                      style={{
                        marginTop: -offsetY,
                      }}
                    >
                      {block.text}
                    </div>
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