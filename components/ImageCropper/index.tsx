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
  const [pan, setPan] = useState({ x: 0, y: 0 }); // Navigation pan
  
  const [selections, setSelections] = useState<Rect[]>([]);
  const [currentDrag, setCurrentDrag] = useState<Rect | null>(null);
  const [grid, setGrid] = useState<Grid | null>(null);
  const [isEditingGrid, setIsEditingGrid] = useState(false);
  const [eraserMode, setEraserMode] = useState<'segment' | 'line'>('segment'); // 'segment' | 'line'

  const [isScanning, setIsScanning] = useState(false);
  const [showToast, setShowToast] = useState(true);
  const [smartMode, setSmartMode] = useState(true); // Default to Smart Mode
  
  // UI interaction states
  const [hoveredCell, setHoveredCell] = useState<Rect | null>(null);
  const [hoveredSegment, setHoveredSegment] = useState<EraserHover | null>(null);
  
  const [isDragging, setIsDragging] = useState(false);
  const [isGesturing, setIsGesturing] = useState(false); // Track multi-touch gesture status
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);

  // Logic Refs
  const gridSnapshotRef = useRef<Grid | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Gesture Refs
  const gestureRef = useRef({
    isGesturing: false,
    startDist: 0,
    startScale: 1,
    startPan: { x: 0, y: 0 },
    startCenter: { x: 0, y: 0 }, // Center of fingers relative to viewport
    containerCenter: { x: 0, y: 0 } // Center of container relative to viewport
  });

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
        setPan({ x: 0, y: 0 }); // Reset Pan
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
    
    // Apply pan to offset
    const offsetX = (rect.width - visualW) / 2 + pan.x;
    const offsetY = (rect.height - visualH) / 2 + pan.y;

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
    // Multi-touch Gesture Start
    if ('touches' in e && e.touches.length === 2) {
       e.preventDefault();
       gestureRef.current.isGesturing = true;
       setIsGesturing(true); // Trigger re-render to disable transition
       
       const t1 = e.touches[0];
       const t2 = e.touches[1];
       
       // Calculate initial distance
       const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
       
       // Calculate initial center of fingers
       const cx = (t1.clientX + t2.clientX) / 2;
       const cy = (t1.clientY + t2.clientY) / 2;
       
       // Capture container center to perform math relative to it
       let containerCenter = { x: 0, y: 0 };
       if (containerRef.current) {
           const rect = containerRef.current.getBoundingClientRect();
           containerCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
       }
       
       gestureRef.current.startDist = dist;
       gestureRef.current.startScale = scale;
       gestureRef.current.startPan = { ...pan };
       gestureRef.current.startCenter = { x: cx, y: cy };
       gestureRef.current.containerCenter = containerCenter;
       return;
    }

    e.stopPropagation();
    const coords = getPointerCoords(e);

    const useLineEraser = eraserMode === 'line' || e.altKey || (e as React.MouseEvent).metaKey;

    if (isEditingGrid && grid) {
        setIsDragging(true);
        gridSnapshotRef.current = JSON.parse(JSON.stringify(grid));
        const newGrid = performErase(grid, coords, useLineEraser, scale);
        if (newGrid) setGrid(newGrid);
        return;
    }

    setDragStart(coords);
    setIsDragging(true);
    setCurrentDrag({ x: coords.x, y: coords.y, w: 0, h: 0 });
  };

  const handlePointerMove = (e: React.MouseEvent | React.TouchEvent) => {
    // Multi-touch Gesture Move (Zoom + Pan)
    if ('touches' in e && e.touches.length === 2 && gestureRef.current.isGesturing) {
        e.preventDefault();
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        
        // 1. Calculate New Zoom
        const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
        const newScale = Math.max(0.1, Math.min(5, gestureRef.current.startScale * (dist / gestureRef.current.startDist)));

        // 2. Calculate Pan to keep focal point stable
        const cx = (t1.clientX + t2.clientX) / 2;
        const cy = (t1.clientY + t2.clientY) / 2;
        
        const C = gestureRef.current.containerCenter;
        const F_start = gestureRef.current.startCenter;
        const Pan_start = gestureRef.current.startPan;
        const Scale_start = gestureRef.current.startScale;
        
        const scaleRatio = newScale / Scale_start;
        const newPanX = cx - C.x - (F_start.x - C.x - Pan_start.x) * scaleRatio;
        const newPanY = cy - C.y - (F_start.y - C.y - Pan_start.y) * scaleRatio;
        
        setScale(newScale);
        setPan({ x: newPanX, y: newPanY });
        return;
    }

    const coords = getPointerCoords(e);
    const useLineEraser = eraserMode === 'line' || e.altKey || (e as React.MouseEvent).metaKey;

    if (isEditingGrid && isDragging && grid) {
        const newGrid = performErase(grid, coords, useLineEraser, scale);
        if (newGrid) setGrid(newGrid);
        return;
    }

    if (isEditingGrid && grid) {
        const threshold = 6 / scale;
        let bestSeg: EraserHover | null = null;
        let minDest = threshold;
        const isWholeLine = useLineEraser;

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
    // End Gesture
    if (gestureRef.current.isGesturing) {
        if (!('touches' in e) || e.touches.length < 2) {
            gestureRef.current.isGesturing = false;
            setIsGesturing(false);
        }
    }
    
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
  
  const handleWheel = (e: React.WheelEvent) => {
      // Allow trackpad pinch-zoom or mouse wheel zoom
      if (e.ctrlKey) {
          e.preventDefault();
          const zoomFactor = -e.deltaY * 0.01;
          const newScale = Math.max(0.1, Math.min(5, scale + zoomFactor));
          setScale(newScale);
      } else {
          // Pan on normal scroll if desired, or just ignore
      }
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
        className="flex-1 relative overflow-hidden flex flex-col w-full min-h-0 bg-slate-100 dark:bg-slate-950" 
        style={{ touchAction: 'none' }}
      >
        {currentItem && (
            <CanvasView 
                imageSrc={currentItem.dataUrl}
                width={currentItem.width}
                height={currentItem.height}
                scale={scale}
                pan={pan}
                grid={grid}
                selections={selections}
                currentDrag={currentDrag}
                isScanning={isScanning}
                isEditingGrid={isEditingGrid}
                isGesturing={isGesturing}
                hoveredCell={hoveredCell}
                hoveredSegment={hoveredSegment}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onWheel={handleWheel}
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
          eraserMode={eraserMode}
          setEraserMode={setEraserMode}
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