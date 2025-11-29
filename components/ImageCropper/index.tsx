
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Rect, HistoryItem, CropMode, Grid } from '../../types';
import { detectGrid } from './logic/gridDetection';
import { performErase, getActualCells } from './logic/gridManipulation';
import { processImageCrop } from './logic/imageProcessor';
import { CanvasView } from './ui/CanvasView';
import { ControlPanel } from './ui/ControlPanel';
import { FloatingControls } from './ui/FloatingControls';
import { EraserHover } from './types';

interface ImageCropperProps {
  initialImage: string;
}

export const ImageCropper: React.FC<ImageCropperProps> = ({ initialImage }) => {
  // --- State ---
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [scale, setScale] = useState(1);
  
  const [selections, setSelections] = useState<Rect[]>([]);
  const [currentDrag, setCurrentDrag] = useState<Rect | null>(null);
  const [grid, setGrid] = useState<Grid | null>(null);
  const [isEditingGrid, setIsEditingGrid] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [showToast, setShowToast] = useState(true);
  const [smartMode, setSmartMode] = useState(true); // Default to Smart Mode
  
  // UI interaction states
  const [hoveredCell, setHoveredCell] = useState<Rect | null>(null);
  const [hoveredSegment, setHoveredSegment] = useState<EraserHover | null>(null);
  
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);

  // Logic Refs
  const gridSnapshotRef = useRef<Grid | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // --- Init ---
  useEffect(() => {
    const img = new Image();
    img.src = initialImage;
    img.onload = () => {
      const initialItem: HistoryItem = {
        dataUrl: initialImage,
        width: img.width,
        height: img.height
      };
      setHistory([initialItem]);
      setHistoryIndex(0);
      setSelections([]);
      setGrid(null);
      setIsEditingGrid(false);
      handleFitScreen(img.width, img.height);
    };
    const timer = setTimeout(() => setShowToast(false), 5000);
    return () => clearTimeout(timer);
  }, [initialImage]);

  // --- Grid Management ---
  useEffect(() => {
    if (historyIndex >= 0 && history[historyIndex]) {
        const item = history[historyIndex];
        if (item.grid) {
            setGrid(item.grid);
            setIsScanning(false);
        } else {
            setGrid(null); 
            setIsScanning(true);
            // Delay grid detection to allow render
            setTimeout(() => {
                detectGrid(item, (newGrid) => {
                    setGrid(newGrid);
                    setIsScanning(false);
                });
            }, 100);
        }
    }
  }, [historyIndex, history]);

  const handleFitScreen = useCallback((imgW?: number, imgH?: number) => {
    if (containerRef.current) {
        const { clientWidth, clientHeight } = containerRef.current;
        const currentW = imgW || (history[historyIndex]?.width ?? 1000);
        const currentH = imgH || (history[historyIndex]?.height ?? 1000);
        const padding = 32; 
        const scaleX = (clientWidth - padding) / currentW;
        const scaleY = (clientHeight - padding) / currentH;
        setScale(Math.min(scaleX, scaleY, 1.0)); 
    }
  }, [history, historyIndex]);

  // --- Helpers ---
  const getPointerCoords = (e: React.MouseEvent | React.TouchEvent) => {
    if (!containerRef.current || historyIndex < 0) return { x: 0, y: 0 };
    
    const item = history[historyIndex];
    if (!item) return {x:0, y:0};

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    
    let clientX, clientY;
    if ('touches' in e && e.touches.length > 0) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
    } else if ('clientX' in e) {
        clientX = (e as React.MouseEvent).clientX;
        clientY = (e as React.MouseEvent).clientY;
    } else {
        return { x: 0, y: 0 };
    }

    const visualW = item.width * scale;
    const visualH = item.height * scale;
    
    const offsetX = (rect.width - visualW) / 2;
    const offsetY = (rect.height - visualH) / 2;

    const relX = clientX - rect.left - offsetX;
    const relY = clientY - rect.top - offsetY;

    return {
        x: relX / scale,
        y: relY / scale
    };
  };

  const getCellAt = (x: number, y: number): Rect | null => {
    if (!grid) return null;
    const item = history[historyIndex];
    const cells = getActualCells(grid, item.width, item.height);
    return cells.find(c => x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h) || null;
  };

  const toggleSelection = (cell: Rect) => {
    const existsIndex = selections.findIndex(s => 
        Math.abs(s.x - cell.x) < 1 && 
        Math.abs(s.y - cell.y) < 1 && 
        Math.abs(s.w - cell.w) < 1 && 
        Math.abs(s.h - cell.h) < 1
    );

    if (existsIndex >= 0) {
        setSelections(prev => prev.filter((_, i) => i !== existsIndex));
    } else {
        setSelections(prev => [...prev, cell]);
    }
  };

  // --- Interaction Handlers ---
  const handlePointerDown = (e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    if ('touches' in e && e.touches.length > 1) return;
    const coords = getPointerCoords(e);

    if (isEditingGrid && grid) {
        setIsDragging(true);
        gridSnapshotRef.current = JSON.parse(JSON.stringify(grid));
        const newGrid = performErase(grid, coords, e.altKey || e.metaKey, scale);
        if (newGrid) setGrid(newGrid);
        return;
    }

    setDragStart(coords);
    setIsDragging(true);
    setCurrentDrag({ x: coords.x, y: coords.y, w: 0, h: 0 });
  };

  const handlePointerMove = (e: React.MouseEvent | React.TouchEvent) => {
    const coords = getPointerCoords(e);

    if (isEditingGrid && isDragging && grid) {
        const newGrid = performErase(grid, coords, e.altKey || e.metaKey, scale);
        if (newGrid) setGrid(newGrid);
        return;
    }

    if (isEditingGrid && grid) {
        // MATCHED THRESHOLD: 6/scale to match performErase.
        const threshold = 6 / scale;
        let bestSeg: EraserHover | null = null;
        let minDest = threshold;
        const isWholeLine = e.altKey || e.metaKey;

        const check = (type: 'horizontal'|'vertical') => {
            const lines = type === 'horizontal' ? grid.horizontal : grid.vertical;
            const perps = type === 'horizontal' ? grid.vertical : grid.horizontal;
            const main = type === 'horizontal' ? coords.y : coords.x;
            const cross = type === 'horizontal' ? coords.x : coords.y;

            lines.forEach((l, i) => {
                if (cross < l.start || cross > l.end) return;
                const dist = Math.abs(main - l.pos);
                if (dist < minDest) {
                    let s = l.start, e = l.end;
                    const crossings = perps.filter(p => p.start <= l.pos && p.end >= l.pos).map(p=>p.pos).sort((a,b)=>a-b);
                    for(const p of crossings) {
                        if(p <= cross) s = Math.max(s, p);
                        else if(p > cross) { e = Math.min(e, p); break; }
                    }
                    minDest = dist;
                    bestSeg = { type, lineIndex: i, start: s, end: e, isWholeLine };
                }
            });
        }
        check('horizontal');
        check('vertical');
        setHoveredSegment(bestSeg);
        setHoveredCell(null);
        return;
    } else {
        setHoveredSegment(null);
    }

    if (!isDragging && grid) {
        setHoveredCell(getCellAt(coords.x, coords.y));
    } else {
        setHoveredCell(null);
    }

    if (!isDragging || !dragStart) return;
    setCurrentDrag({
      x: dragStart.x,
      y: dragStart.y,
      w: coords.x - dragStart.x,
      h: coords.y - dragStart.y
    });
  };

  const handlePointerUp = (e: React.MouseEvent | React.TouchEvent) => {
    setIsDragging(false);
    
    if (isEditingGrid) {
        if (grid && gridSnapshotRef.current) {
            const prevStr = JSON.stringify(gridSnapshotRef.current);
            const currStr = JSON.stringify(grid);
            if (prevStr !== currStr) {
                const newItem = { ...history[historyIndex], grid: grid };
                const newHist = history.slice(0, historyIndex + 1);
                newHist.push(newItem);
                setHistory(newHist);
                setHistoryIndex(newHist.length - 1);
            }
        }
        gridSnapshotRef.current = null;
        setHoveredSegment(null); 
        return;
    }

    if (currentDrag) {
        if (Math.abs(currentDrag.w) < 5 && Math.abs(currentDrag.h) < 5) {
             const cell = getCellAt(currentDrag.x, currentDrag.y);
             if (cell) toggleSelection(cell);
        } else {
            let { x, y, w, h } = currentDrag;
            if (w < 0) { x += w; w = Math.abs(w); }
            if (h < 0) { y += h; h = Math.abs(h); }
            if (w > 2 && h > 2) setSelections(prev => [...prev, { x, y, w, h }]);
        }
    }
    setCurrentDrag(null);
  };

  // --- Actions ---
  const handleCrop = async (mode: CropMode) => {
      if (selections.length === 0 || historyIndex < 0) return;
      
      // Use the external processor
      const res = await processImageCrop(history[historyIndex], selections, grid, mode, smartMode);
      
      if (res) {
          const newHistory = history.slice(0, historyIndex + 1);
          newHistory.push(res);
          setHistory(newHistory);
          setHistoryIndex(newHistory.length - 1);
          setSelections([]);
      }
  };

  const handleDownload = () => {
    if (historyIndex < 0) return;
    const link = document.createElement('a');
    link.download = `smart-slice-${Date.now()}.png`;
    link.href = history[historyIndex].dataUrl;
    link.click();
  };

  const currentItem = history[historyIndex];

  return (
    <div className="flex flex-col md:flex-row h-full w-full relative">
      <div 
        ref={containerRef}
        className="flex-1 relative overflow-hidden flex flex-col w-full min-h-0" 
        style={{ touchAction: 'none' }}
      >
        {currentItem && (
            <CanvasView 
                imageSrc={currentItem.dataUrl}
                width={currentItem.width}
                height={currentItem.height}
                scale={scale}
                grid={grid}
                selections={selections}
                currentDrag={currentDrag}
                isScanning={isScanning}
                isEditingGrid={isEditingGrid}
                hoveredCell={hoveredCell}
                hoveredSegment={hoveredSegment}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
            />
        )}
        
        <FloatingControls 
            scale={scale} 
            setScale={setScale} 
            onFit={handleFitScreen} 
            hasSelection={selections.length > 0} 
            onClearSelection={() => setSelections([])}
            selectionCount={selections.length}
            isEditingGrid={isEditingGrid}
            showToast={showToast}
        />
      </div>

      <ControlPanel 
          historyIndex={historyIndex}
          historyLength={history.length}
          hasSelection={selections.length > 0}
          isEditingGrid={isEditingGrid}
          smartMode={smartMode}
          onToggleSmartMode={() => setSmartMode(!smartMode)}
          onToggleEraser={() => { setIsEditingGrid(!isEditingGrid); setSelections([]); }}
          onCrop={handleCrop}
          onUndo={() => { setHistoryIndex(i => i - 1); setSelections([]); }}
          onRedo={() => { setHistoryIndex(i => i + 1); setSelections([]); }}
          onDownload={handleDownload}
      />
    </div>
  );
};
