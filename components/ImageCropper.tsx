import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  Undo2, 
  Redo2, 
  Download, 
  ZoomIn, 
  ZoomOut, 
  Maximize2,
  FoldVertical,
  FoldHorizontal,
  Shrink,
  Scan,
  Smartphone,
  Trash2,
  Grid3X3,
  Eraser
} from 'lucide-react';
import { Rect, HistoryItem, CropMode, Grid, GridLine } from '../types';

interface ImageCropperProps {
  initialImage: string;
}

interface Segment {
  id: number;
  pos: number;
  start: number;
  end: number;
  length: number;
}

export const ImageCropper: React.FC<ImageCropperProps> = ({ initialImage }) => {
  // --- State ---
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [scale, setScale] = useState(1);
  
  // Selection & Grid
  const [selections, setSelections] = useState<Rect[]>([]);
  const [currentDrag, setCurrentDrag] = useState<Rect | null>(null);
  const [grid, setGrid] = useState<Grid | null>(null);
  const [isEditingGrid, setIsEditingGrid] = useState(false);
  
  // Eraser State
  const [hoveredSegment, setHoveredSegment] = useState<{ 
    type: 'horizontal' | 'vertical', 
    lineIndex: number, 
    start: number, 
    end: number,
    isWholeLine: boolean 
  } | null>(null);
  
  // UI States
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [showToast, setShowToast] = useState(true);
  const [hoveredCell, setHoveredCell] = useState<Rect | null>(null);

  // --- Refs ---
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number>(0);
  const scanProgressRef = useRef(0);

  // --- Helpers ---
  const stopPropagation = (e: React.MouseEvent | React.TouchEvent | React.PointerEvent) => {
    e.stopPropagation();
  };

  // --- Initialization ---
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

  // --- History Change Effect ---
  useEffect(() => {
    if (historyIndex >= 0 && history[historyIndex]) {
        const item = history[historyIndex];
        // If the history item already has a grid (calculated from previous step), use it.
        // Otherwise, scan for a new one.
        if (item.grid) {
            setGrid(item.grid);
            setIsScanning(false);
        } else {
            setGrid(null); 
            startScanning(item);
        }
        setIsEditingGrid(false);
    }
  }, [historyIndex, history]);

  const startScanning = (item: HistoryItem) => {
    setIsScanning(true);
    scanProgressRef.current = 0;
    setTimeout(() => {
      detectGrid(item);
    }, 100);
  };

  const detectGrid = (item: HistoryItem) => {
    const canvas = document.createElement('canvas');
    canvas.width = item.width;
    canvas.height = item.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.src = item.dataUrl;
    img.onload = () => {
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const { data, width, height } = imageData;

      const getLum = (idx: number) => (data[idx] + data[idx+1] + data[idx+2]);
      
      const CONTRAST_THRESH = 40;
      const MIN_SEG_LEN = Math.max(16, Math.min(width, height) * 0.01);
      const GAP_TOLERANCE = 4;
      const POS_TOLERANCE = 3;

      const rawH: Segment[] = [];
      let hId = 0;
      for (let y = 1; y < height - 1; y++) {
          let startX = -1;
          for (let x = 0; x < width; x++) {
              const idx = (y * width + x) * 4;
              const idxUp = ((y - 1) * width + x) * 4;
              const idxDown = ((y + 1) * width + x) * 4;
              const lum = getLum(idx);
              const isEdge = Math.abs(lum - getLum(idxUp)) > CONTRAST_THRESH || 
                             Math.abs(lum - getLum(idxDown)) > CONTRAST_THRESH;

              if (isEdge) {
                  if (startX === -1) startX = x;
              } else {
                  if (startX !== -1) {
                      if (x - startX > MIN_SEG_LEN) {
                          rawH.push({ id: hId++, pos: y, start: startX, end: x, length: x - startX });
                      }
                      startX = -1;
                  }
              }
          }
          if (startX !== -1 && width - startX > MIN_SEG_LEN) {
             rawH.push({ id: hId++, pos: y, start: startX, end: width, length: width - startX });
          }
      }

      const rawV: Segment[] = [];
      let vId = 0;
      for (let x = 1; x < width - 1; x++) {
          let startY = -1;
          for (let y = 0; y < height; y++) {
              const idx = (y * width + x) * 4;
              const idxLeft = (y * width + (x - 1)) * 4;
              const idxRight = (y * width + (x + 1)) * 4;
              const lum = getLum(idx);
              const isEdge = Math.abs(lum - getLum(idxLeft)) > CONTRAST_THRESH || 
                             Math.abs(lum - getLum(idxRight)) > CONTRAST_THRESH;

              if (isEdge) {
                  if (startY === -1) startY = y;
              } else {
                  if (startY !== -1) {
                      if (y - startY > MIN_SEG_LEN) {
                          rawV.push({ id: vId++, pos: x, start: startY, end: y, length: y - startY });
                      }
                      startY = -1;
                  }
              }
          }
          if (startY !== -1 && height - startY > MIN_SEG_LEN) {
              rawV.push({ id: vId++, pos: x, start: startY, end: height, length: height - startY });
          }
      }

      const clusterSegments = (items: Segment[], posKey: 'pos', startKey: 'start', endKey: 'end') => {
          items.sort((a, b) => a[posKey] - b[posKey]);
          const merged: Segment[] = [];
          
          let currentGroup: Segment[] = [];
          if (items.length > 0) currentGroup.push(items[0]);

          const processGroup = (group: Segment[]) => {
               const avgPos = Math.round(group.reduce((acc, i) => acc + i[posKey], 0) / group.length);
               group.sort((a, b) => a[startKey] - b[startKey]);
               
               let curr = { ...group[0], pos: avgPos };
               for (let i = 1; i < group.length; i++) {
                   const next = group[i];
                   if (next[startKey] <= curr[endKey] + GAP_TOLERANCE) {
                       curr[endKey] = Math.max(curr[endKey], next[endKey]);
                       curr.length = curr[endKey] - curr[startKey];
                   } else {
                       merged.push(curr);
                       curr = { ...next, pos: avgPos };
                   }
               }
               merged.push(curr);
          };

          for (let i = 1; i < items.length; i++) {
              const item = items[i];
              const prev = currentGroup[0];
              if (Math.abs(item.pos - prev.pos) <= POS_TOLERANCE) {
                  currentGroup.push(item);
              } else {
                  processGroup(currentGroup);
                  currentGroup = [item];
              }
          }
          if (currentGroup.length > 0) processGroup(currentGroup);
          return merged.map((m, i) => ({ ...m, id: i }));
      };

      const hSegments = clusterSegments(rawH, 'pos', 'start', 'end');
      const vSegments = clusterSegments(rawV, 'pos', 'start', 'end');

      const adj = new Map<string, string[]>(); 
      const getNodeKey = (type: 'h'|'v', id: number) => `${type}-${id}`;

      hSegments.forEach(h => {
          vSegments.forEach(v => {
              const h_intersects_v_x = v.pos >= h.start - POS_TOLERANCE && v.pos <= h.end + POS_TOLERANCE;
              const v_intersects_h_y = h.pos >= v.start - POS_TOLERANCE && h.pos <= v.end + POS_TOLERANCE;

              if (h_intersects_v_x && v_intersects_h_y) {
                  const hKey = getNodeKey('h', h.id);
                  const vKey = getNodeKey('v', v.id);
                  if (!adj.has(hKey)) adj.set(hKey, []);
                  if (!adj.has(vKey)) adj.set(vKey, []);
                  adj.get(hKey)!.push(vKey);
                  adj.get(vKey)!.push(hKey);
              }
          });
      });

      const visited = new Set<string>();
      const components: { totalLength: number, hSegs: Segment[], vSegs: Segment[] }[] = [];

      const allNodes = [
          ...hSegments.map(s => ({ key: getNodeKey('h', s.id), seg: s, type: 'h' })),
          ...vSegments.map(s => ({ key: getNodeKey('v', s.id), seg: s, type: 'v' }))
      ];

      allNodes.forEach(node => {
          if (!visited.has(node.key) && adj.has(node.key)) {
              const componentHSegs: Segment[] = [];
              const componentVSegs: Segment[] = [];
              let componentLength = 0;

              const queue = [node.key];
              visited.add(node.key);

              while (queue.length > 0) {
                  const currKey = queue.shift()!;
                  const isH = currKey.startsWith('h');
                  const id = parseInt(currKey.split('-')[1]);
                  const seg = isH ? hSegments[id] : vSegments[id];
                  if (isH) componentHSegs.push(seg);
                  else componentVSegs.push(seg);
                  componentLength += seg.length;

                  const neighbors = adj.get(currKey) || [];
                  neighbors.forEach(nKey => {
                      if (!visited.has(nKey)) {
                          visited.add(nKey);
                          queue.push(nKey);
                      }
                  });
              }

              components.push({
                  totalLength: componentLength,
                  hSegs: componentHSegs,
                  vSegs: componentVSegs
              });
          }
      });

      if (components.length === 0) {
          setGrid(null);
          setIsScanning(false);
          return;
      }

      components.sort((a, b) => b.totalLength - a.totalLength);
      const best = components[0];

      if (best.totalLength < (width + height) * 0.5) {
           setGrid(null);
           setIsScanning(false);
           return;
      }

      const uniqueY = new Set<number>();
      best.hSegs.forEach(s => uniqueY.add(s.pos));
      const uniqueX = new Set<number>();
      best.vSegs.forEach(s => uniqueX.add(s.pos));

      // Initially, detection creates full lines. User will split them.
      const finalH: GridLine[] = Array.from(uniqueY).sort((a,b)=>a-b).map(y => ({
          pos: y, thickness: 1, start: 0, end: width // Full width initially
      }));
      const finalV: GridLine[] = Array.from(uniqueX).sort((a,b)=>a-b).map(x => ({
          pos: x, thickness: 1, start: 0, end: height // Full height initially
      }));
      
      // Boundaries
      if (finalH.length === 0 || finalH[0].pos > 5) finalH.unshift({ pos: 0, thickness: 0, start: 0, end: width });
      if (finalH.length > 0 && finalH[finalH.length-1].pos < height - 5) finalH.push({ pos: height, thickness: 0, start: 0, end: width });

      if (finalV.length === 0 || finalV[0].pos > 5) finalV.unshift({ pos: 0, thickness: 0, start: 0, end: height });
      if (finalV.length > 0 && finalV[finalV.length-1].pos < width - 5) finalV.push({ pos: width, thickness: 0, start: 0, end: height });

      setGrid({ horizontal: finalH, vertical: finalV });
      
      setTimeout(() => setIsScanning(false), 600);
    };
  };

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

  // --- Graph Traversal for "Merged Cell" Logic ---
  // Returns list of Rects representing actual cells (merged or not)
  const getActualCells = (grid: Grid, w: number, h: number): Rect[] => {
      // 1. Build atomic blocks (Lattice)
      const ys = Array.from(new Set(grid.horizontal.map(l => l.pos).concat([0, h]))).sort((a,b)=>a-b);
      const xs = Array.from(new Set(grid.vertical.map(l => l.pos).concat([0, w]))).sort((a,b)=>a-b);

      // Unique deduplication
      const u_ys = ys.filter((v, i) => i === 0 || v > ys[i-1] + 1);
      const u_xs = xs.filter((v, i) => i === 0 || v > xs[i-1] + 1);

      const visited = new Set<string>();
      const cells: Rect[] = [];

      for (let r = 0; r < u_ys.length - 1; r++) {
          for (let c = 0; c < u_xs.length - 1; c++) {
              const key = `${c}-${r}`;
              if (visited.has(key)) continue;

              // BFS to find connected component (Flood Fill)
              let minX = u_xs[c], maxX = u_xs[c+1];
              let minY = u_ys[r], maxY = u_ys[r+1];
              
              const queue = [{c, r}];
              visited.add(key);

              while(queue.length > 0) {
                  const curr = queue.shift()!;
                  
                  const cx1 = u_xs[curr.c], cx2 = u_xs[curr.c+1];
                  const cy1 = u_ys[curr.r], cy2 = u_ys[curr.r+1];
                  
                  minX = Math.min(minX, cx1); maxX = Math.max(maxX, cx2);
                  minY = Math.min(minY, cy1); maxY = Math.max(maxY, cy2);

                  // Check neighbors
                  const neighbors = [
                      { dc: 1, dr: 0, wallType: 'v', wallPos: cx2, wallStart: cy1, wallEnd: cy2 }, // Right
                      { dc: -1, dr: 0, wallType: 'v', wallPos: cx1, wallStart: cy1, wallEnd: cy2 }, // Left
                      { dc: 0, dr: 1, wallType: 'h', wallPos: cy2, wallStart: cx1, wallEnd: cx2 }, // Down
                      { dc: 0, dr: -1, wallType: 'h', wallPos: cy1, wallStart: cx1, wallEnd: cx2 } // Up
                  ];

                  for (const n of neighbors) {
                      const nc = curr.c + n.dc;
                      const nr = curr.r + n.dr;
                      
                      // Bounds check
                      if (nc < 0 || nc >= u_xs.length - 1 || nr < 0 || nr >= u_ys.length - 1) continue;
                      
                      const nKey = `${nc}-${nr}`;
                      if (visited.has(nKey)) continue;

                      // Check for wall
                      let hasWall = false;
                      const lines = n.wallType === 'v' ? grid.vertical : grid.horizontal;
                      
                      // Find if ANY segment of the line blocks this transition
                      for(const line of lines) {
                          if (Math.abs(line.pos - n.wallPos) < 2) {
                              // Check segment overlap
                              const overlapStart = Math.max(line.start, n.wallStart);
                              const overlapEnd = Math.min(line.end, n.wallEnd);
                              if (overlapStart < overlapEnd - 1) { // 1px tolerance
                                  hasWall = true;
                                  break;
                              }
                          }
                      }

                      if (!hasWall) {
                          visited.add(nKey);
                          queue.push({c: nc, r: nr});
                      }
                  }
              }

              cells.push({ x: minX, y: minY, w: maxX - minX, h: maxY - minY });
          }
      }
      return cells;
  };

  const getCellAt = (x: number, y: number): Rect | null => {
    if (!grid) return null;
    const item = history[historyIndex];
    const cells = getActualCells(grid, item.width, item.height);
    return cells.find(c => 
        x >= c.x && x <= c.x + c.w && 
        y >= c.y && y <= c.y + c.h
    ) || null;
  };

  const getPointerCoords = (e: React.MouseEvent | React.TouchEvent | MouseEvent | TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
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
    const rect = canvas.getBoundingClientRect();
    const x = (clientX - rect.left) / (rect.width / canvas.width);
    const y = (clientY - rect.top) / (rect.height / canvas.height);
    return { x, y };
  };

  const handlePointerDown = (e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    if ('touches' in e && e.touches.length > 1) return; 

    // --- Eraser Mode Logic ---
    if (isEditingGrid && grid && hoveredSegment) {
        setGrid(prev => {
            if (!prev) return null;
            const newGrid = { ...prev };
            
            const targetArray = hoveredSegment.type === 'horizontal' ? newGrid.horizontal : newGrid.vertical;
            const originalLine = targetArray[hoveredSegment.lineIndex];
            
            // Remove the original line
            targetArray.splice(hoveredSegment.lineIndex, 1);

            if (hoveredSegment.isWholeLine) {
                 // Deleting whole line: Do nothing (just splice above)
            } else {
                 // Deleting segment: Split into two lines (gaps)
                 // Part 1: Start to SegmentStart
                 if (hoveredSegment.start > originalLine.start + 1) {
                     targetArray.push({ 
                         pos: originalLine.pos, 
                         thickness: originalLine.thickness, 
                         start: originalLine.start, 
                         end: hoveredSegment.start 
                     });
                 }
                 // Part 2: SegmentEnd to End
                 if (hoveredSegment.end < originalLine.end - 1) {
                     targetArray.push({ 
                         pos: originalLine.pos, 
                         thickness: originalLine.thickness, 
                         start: hoveredSegment.end, 
                         end: originalLine.end 
                     });
                 }
            }
            return newGrid;
        });
        setHoveredSegment(null); 
        return;
    }

    if (isEditingGrid) return;

    const coords = getPointerCoords(e);
    setDragStart(coords);
    setIsDragging(true);
    setCurrentDrag({ x: coords.x, y: coords.y, w: 0, h: 0 });
  };

  const handlePointerMove = (e: React.MouseEvent | React.TouchEvent) => {
    const coords = getPointerCoords(e);

    // --- Eraser Mode Highlight ---
    if (isEditingGrid && grid) {
        const threshold = 20 / scale;
        let bestSeg = null;
        let minDest = threshold;
        const isWholeLine = e.altKey || e.metaKey; // Modifier key for whole line

        const checkLines = (type: 'horizontal' | 'vertical') => {
            const lines = type === 'horizontal' ? grid.horizontal : grid.vertical;
            const perpLines = type === 'horizontal' ? grid.vertical : grid.horizontal;
            
            const coordMain = type === 'horizontal' ? coords.y : coords.x;
            const coordCross = type === 'horizontal' ? coords.x : coords.y;

            lines.forEach((l, i) => {
                // Check if cursor is within line range
                if (coordCross < l.start || coordCross > l.end) return;

                const dist = Math.abs(coordMain - l.pos);
                if (dist < minDest) {
                    // Find segment
                    let segStart = l.start;
                    let segEnd = l.end;

                    // Find closest perpendiculars
                    // Filter perps that actually cross this line
                    const crossings = perpLines
                        .filter(p => p.start <= l.pos && p.end >= l.pos)
                        .map(p => p.pos)
                        .sort((a,b) => a-b);
                    
                    // Find bracket around cursor
                    for (const cp of crossings) {
                        if (cp <= coordCross) segStart = Math.max(segStart, cp);
                        else if (cp > coordCross) {
                            segEnd = Math.min(segEnd, cp);
                            break;
                        }
                    }

                    minDest = dist;
                    bestSeg = { 
                        type, 
                        lineIndex: i, 
                        start: segStart, 
                        end: segEnd,
                        isWholeLine: isWholeLine 
                    };
                }
            });
        };

        checkLines('horizontal');
        checkLines('vertical');
        
        setHoveredSegment(bestSeg);
        setHoveredCell(null);
        return;
    } else {
        setHoveredSegment(null);
    }

    if (!isDragging && grid) {
        const cell = getCellAt(coords.x, coords.y);
        setHoveredCell(cell);
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
    
    if (isEditingGrid) return;
    
    if (currentDrag) {
        if (Math.abs(currentDrag.w) < 5 && Math.abs(currentDrag.h) < 5) {
             const cell = getCellAt(currentDrag.x, currentDrag.y);
             if (cell) {
                 toggleSelection(cell);
             } 
        } else {
            let { x, y, w, h } = currentDrag;
            if (w < 0) { x += w; w = Math.abs(w); }
            if (h < 0) { y += h; h = Math.abs(h); }
            
            if (w > 2 && h > 2) {
                setSelections(prev => [...prev, { x, y, w, h }]);
            }
        }
    }
    setCurrentDrag(null);
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

  // --- Rendering ---
  useEffect(() => {
    const render = () => {
        const canvas = canvasRef.current;
        if (!canvas || historyIndex < 0) return;

        const currentItem = history[historyIndex];
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        if (canvas.width !== currentItem.width || canvas.height !== currentItem.height) {
            canvas.width = currentItem.width;
            canvas.height = currentItem.height;
        }

        const img = new Image();
        img.src = currentItem.dataUrl;

        if (!img.complete) {
            img.onload = () => requestAnimationFrame(render);
            return;
        }

        // Draw Image
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);

        // Draw Grid Lines
        if (grid) {
            ctx.save();
            ctx.lineWidth = 1 / scale;
            const alpha = isScanning ? 0.6 : (isEditingGrid ? 0.4 : 0.2); 
            ctx.strokeStyle = `rgba(56, 189, 248, ${alpha})`;
            
            // Function to draw lines
            const drawLines = (lines: GridLine[], type: 'h' | 'v') => {
                 lines.forEach((l, i) => {
                    // Skip if currently hovering this segment (we'll draw it red)
                    if (isEditingGrid && hoveredSegment && hoveredSegment.type === (type==='h'?'horizontal':'vertical') && hoveredSegment.lineIndex === i && hoveredSegment.isWholeLine) {
                         return; 
                    }
                    
                    ctx.beginPath();
                    if (type === 'h') {
                        ctx.moveTo(l.start, l.pos);
                        ctx.lineTo(l.end, l.pos);
                    } else {
                        ctx.moveTo(l.pos, l.start);
                        ctx.lineTo(l.pos, l.end);
                    }
                    ctx.stroke();
                 });
            };

            drawLines(grid.horizontal, 'h');
            drawLines(grid.vertical, 'v');

            // Highlight Hovered Segment (Eraser Mode)
            if (isEditingGrid && hoveredSegment) {
                ctx.beginPath();
                ctx.strokeStyle = '#ef4444';
                ctx.lineWidth = 3 / scale;
                ctx.shadowColor = '#ef4444';
                ctx.shadowBlur = 5;
                
                if (hoveredSegment.type === 'horizontal') {
                    const y = grid.horizontal[hoveredSegment.lineIndex].pos;
                    if (hoveredSegment.isWholeLine) {
                         ctx.moveTo(grid.horizontal[hoveredSegment.lineIndex].start, y);
                         ctx.lineTo(grid.horizontal[hoveredSegment.lineIndex].end, y);
                    } else {
                         ctx.moveTo(hoveredSegment.start, y);
                         ctx.lineTo(hoveredSegment.end, y);
                    }
                } else {
                    const x = grid.vertical[hoveredSegment.lineIndex].pos;
                     if (hoveredSegment.isWholeLine) {
                         ctx.moveTo(x, grid.vertical[hoveredSegment.lineIndex].start);
                         ctx.lineTo(x, grid.vertical[hoveredSegment.lineIndex].end);
                    } else {
                        ctx.moveTo(x, hoveredSegment.start);
                        ctx.lineTo(x, hoveredSegment.end);
                    }
                }
                ctx.stroke();
            }

            ctx.restore();
        }

        // Scan Animation
        if (isScanning) {
            ctx.save();
            scanProgressRef.current = (scanProgressRef.current + 25) % (canvas.height + 300);
            const scanY = scanProgressRef.current - 150;
            
            if (scanY < canvas.height + 50) {
                const gradient = ctx.createLinearGradient(0, scanY - 100, 0, scanY);
                gradient.addColorStop(0, 'rgba(14, 165, 233, 0)');
                gradient.addColorStop(1, 'rgba(56, 189, 248, 0.25)');
                
                ctx.fillStyle = gradient;
                ctx.fillRect(0, scanY - 100, canvas.width, 100);
                
                ctx.beginPath();
                ctx.moveTo(0, scanY);
                ctx.lineTo(canvas.width, scanY);
                ctx.strokeStyle = '#38bdf8';
                ctx.lineWidth = 2;
                ctx.shadowColor = '#0ea5e9';
                ctx.shadowBlur = 15;
                ctx.stroke();
            }
            ctx.restore();
            animationFrameRef.current = requestAnimationFrame(render);
        }

        // Hover Effect (Normal Mode)
        if (hoveredCell && !isDragging && !isEditingGrid) {
            ctx.fillStyle = 'rgba(56, 189, 248, 0.15)';
            ctx.strokeStyle = 'rgba(14, 165, 233, 0.9)';
            ctx.lineWidth = 2 / scale;
            ctx.fillRect(hoveredCell.x, hoveredCell.y, hoveredCell.w, hoveredCell.h);
            ctx.strokeRect(hoveredCell.x, hoveredCell.y, hoveredCell.w, hoveredCell.h);
        }

        // Selections
        selections.forEach(s => {
            let rx = s.x;
            let ry = s.y;
            let rw = s.w;
            let rh = s.h;
            if (rw < 0) { rx += rw; rw = Math.abs(rw); }
            if (rh < 0) { ry += rh; rh = Math.abs(rh); }

            ctx.fillStyle = 'rgba(239, 68, 68, 0.25)';
            ctx.fillRect(rx, ry, rw, rh);
            ctx.strokeStyle = '#ef4444';
            ctx.lineWidth = 2 / scale;
            ctx.strokeRect(rx, ry, rw, rh);
            
            if (rw > 12 && rh > 12) {
                ctx.beginPath();
                ctx.moveTo(rx, ry);
                ctx.lineTo(rx + rw, ry + rh);
                ctx.moveTo(rx + rw, ry);
                ctx.lineTo(rx, ry + rh);
                ctx.strokeStyle = 'rgba(239, 68, 68, 0.5)';
                ctx.lineWidth = 1 / scale;
                ctx.stroke();
            }
        });

        // Manual Drag Box
        if (currentDrag && (Math.abs(currentDrag.w) > 2 || Math.abs(currentDrag.h) > 2)) {
            let rx = currentDrag.x;
            let ry = currentDrag.y;
            let rw = currentDrag.w;
            let rh = currentDrag.h;
            if (rw < 0) { rx += rw; rw = Math.abs(rw); }
            if (rh < 0) { ry += rh; rh = Math.abs(rh); }

            ctx.fillStyle = 'rgba(14, 165, 233, 0.2)';
            ctx.strokeStyle = '#0ea5e9';
            ctx.lineWidth = 2 / scale;
            ctx.setLineDash([4, 4]);
            ctx.fillRect(rx, ry, rw, rh);
            ctx.strokeRect(rx, ry, rw, rh);
            ctx.setLineDash([]);
        }
    };

    render();
    return () => cancelAnimationFrame(animationFrameRef.current);
  }, [history, historyIndex, selections, currentDrag, grid, isScanning, scale, hoveredCell, isEditingGrid, hoveredSegment]);


  // --- Stitching Logic ---
  const performCrop = (mode: CropMode) => {
    if (selections.length === 0 || historyIndex < 0) return;
    
    const currentItem = history[historyIndex];
    const img = new Image();
    img.src = currentItem.dataUrl;
    
    img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;

        ctx.drawImage(img, 0, 0);
        const fullImageData = ctx.getImageData(0, 0, img.width, img.height);
        
        // 1. Calculate Ranges
        let xRanges: {start: number, end: number}[] = [];
        let yRanges: {start: number, end: number}[] = [];

        // Simple unsnapped ranges for initial calculation
        selections.forEach(s => {
            let rx = s.x, ry = s.y, rw = s.w, rh = s.h;
            if (rw < 0) { rx += rw; rw = Math.abs(rw); }
            if (rh < 0) { ry += rh; rh = Math.abs(rh); }
            yRanges.push({ start: ry, end: ry + rh });
            xRanges.push({ start: rx, end: rx + rw });
        });

        const mergeRanges = (ranges: {start: number, end: number}[]) => {
            if (ranges.length === 0) return [];
            ranges.sort((a, b) => a.start - b.start);
            const merged = [ranges[0]];
            for (let i = 1; i < ranges.length; i++) {
                const prev = merged[merged.length - 1];
                const curr = ranges[i];
                if (curr.start < prev.end + 1) prev.end = Math.max(prev.end, curr.end);
                else merged.push(curr);
            }
            return merged;
        };

        const finalXRanges = (mode === 'vertical' || mode === 'both') ? mergeRanges(xRanges) : [];
        const finalYRanges = (mode === 'horizontal' || mode === 'both') ? mergeRanges(yRanges) : [];

        // 2. Stitch Background
        let removeW = finalXRanges.reduce((acc, r) => acc + (r.end - r.start), 0);
        let removeH = finalYRanges.reduce((acc, r) => acc + (r.end - r.start), 0);
        
        const newW = Math.max(1, currentItem.width - removeW);
        const newH = Math.max(1, currentItem.height - removeH);

        canvas.width = newW;
        canvas.height = newH;
        const resCtx = canvas.getContext('2d', { willReadFrequently: true });
        if(!resCtx) return;

        const mapX = (x: number) => {
            let shift = 0;
            for(const r of finalXRanges) {
                if (x >= r.end) shift += (r.end - r.start);
                else if (x > r.start) shift += (x - r.start);
            }
            return x - shift;
        };
        const mapY = (y: number) => {
            let shift = 0;
            for(const r of finalYRanges) {
                if (y >= r.end) shift += (r.end - r.start);
                else if (y > r.start) shift += (y - r.start);
            }
            return y - shift;
        };

        const getKeepRanges = (totalSize: number, removeRanges: {start: number, end: number}[]) => {
            const keep = [];
            let cursor = 0;
            removeRanges.forEach(r => {
                if (r.start > cursor) keep.push({ start: cursor, end: r.start });
                cursor = Math.max(cursor, r.end);
            });
            if (cursor < totalSize) keep.push({ start: cursor, end: totalSize });
            return keep;
        };

        const keepX = getKeepRanges(currentItem.width, finalXRanges);
        const keepY = getKeepRanges(currentItem.height, finalYRanges);

        let destY = 0;
        keepY.forEach(ky => {
            let destX = 0;
            const h = ky.end - ky.start;
            keepX.forEach(kx => {
                const w = kx.end - kx.start;
                if (w > 0 && h > 0) {
                   resCtx.drawImage(img, kx.start, ky.start, w, h, destX, destY, w, h);
                }
                destX += w;
            });
            destY += h;
        });

        // 3. Grid Persistence Logic
        // Transform the current grid to the new coordinate system to avoid re-erasing
        let nextGrid: Grid | undefined = undefined;
        if (grid) {
            
            // To properly persist "Gaps", we need to map start/end coordinates.
            const nextH = grid.horizontal.map(l => {
                 const newPos = mapY(l.pos);
                 const newStart = mapX(l.start);
                 const newEnd = mapX(l.end);
                 
                 // Check if pos is inside a removed range
                 let removed = false;
                 for (const r of finalYRanges) { if (l.pos > r.start && l.pos < r.end) removed = true; }
                 
                 if (removed) return null;
                 return { pos: newPos, thickness: l.thickness, start: newStart, end: newEnd };
            }).filter(Boolean) as GridLine[];

            const nextV = grid.vertical.map(l => {
                 const newPos = mapX(l.pos);
                 const newStart = mapY(l.start);
                 const newEnd = mapY(l.end);
                 let removed = false;
                 for (const r of finalXRanges) { if (l.pos > r.start && l.pos < r.end) removed = true; }
                 if (removed) return null;
                 return { pos: newPos, thickness: l.thickness, start: newStart, end: newEnd };
            }).filter(Boolean) as GridLine[];
            
            nextGrid = { horizontal: nextH, vertical: nextV };
        }

        // 4. Smart Content Restoration (Using Flood Fill Cells)
        if (grid) {
             const actualCells = getActualCells(grid, currentItem.width, currentItem.height);
             
             for (const cell of actualCells) {
                 // Calculate Target Geometry
                 const nx1 = mapX(cell.x);
                 const nx2 = mapX(cell.x + cell.w);
                 const ny1 = mapY(cell.y);
                 const ny2 = mapY(cell.y + cell.h);
                 const targetW = nx2 - nx1;
                 const targetH = ny2 - ny1;

                 // Check impact
                 if (Math.abs(targetW - cell.w) < 2 && Math.abs(targetH - cell.h) < 2) continue;
                 if (targetW < 4 || targetH < 4) continue;

                 // Restore Content
                 // Sample BG
                 const sX = Math.min(img.width - 1, Math.floor(cell.x + 4));
                 const sY = Math.min(img.height - 1, Math.floor(cell.y + 4));
                 const sIdx = (sY * img.width + sX) * 4;
                 const bgR = fullImageData.data[sIdx];
                 const bgG = fullImageData.data[sIdx+1];
                 const bgB = fullImageData.data[sIdx+2];

                 // Extract
                 const cellCanvas = document.createElement('canvas');
                 cellCanvas.width = cell.w;
                 cellCanvas.height = cell.h;
                 const cCtx = cellCanvas.getContext('2d');
                 if(!cCtx) continue;
                 cCtx.drawImage(img, cell.x, cell.y, cell.w, cell.h, 0, 0, cell.w, cell.h);
                 const d = cCtx.getImageData(0,0,cell.w, cell.h).data;

                 let minCx = cell.w, minCy = cell.h, maxCx = 0, maxCy = 0;
                 let hasContent = false;
                 let sumX = 0; let pixelCount = 0;
                 const tolerance = 30;

                 for(let y=0; y<cell.h; y++) {
                     for(let x=0; x<cell.w; x++) {
                         const ii = (y * cell.w + x) * 4;
                         if (Math.abs(d[ii] - bgR) > tolerance ||
                             Math.abs(d[ii+1] - bgG) > tolerance ||
                             Math.abs(d[ii+2] - bgB) > tolerance) {
                             hasContent = true;
                             if(x<minCx) minCx=x; if(x>maxCx) maxCx=x;
                             if(y<minCy) minCy=y; if(y>maxCy) maxCy=y;
                             sumX += x; pixelCount++;
                         }
                     }
                 }

                 if (!hasContent) continue;
                 const contentW = maxCx - minCx + 1;
                 const contentH = maxCy - minCy + 1;

                 // Draw BG
                 resCtx.fillStyle = `rgb(${bgR}, ${bgG}, ${bgB})`;
                 resCtx.fillRect(nx1, ny1, targetW, targetH);

                 // Draw Content
                 const contentCanvas = document.createElement('canvas');
                 contentCanvas.width = contentW;
                 contentCanvas.height = contentH;
                 const ccCtx = contentCanvas.getContext('2d');
                 ccCtx?.drawImage(cellCanvas, minCx, minCy, contentW, contentH, 0, 0, contentW, contentH);

                 const centerMass = sumX / pixelCount;
                 const geoCenter = cell.w / 2;
                 let align = 'center';
                 if (centerMass < geoCenter - cell.w * 0.1) align = 'left';
                 else if (centerMass > geoCenter + cell.w * 0.1) align = 'right';

                 const padding = 2;
                 const availW = Math.max(1, targetW - padding*2);
                 const availH = Math.max(1, targetH - padding*2);
                 const scale = Math.min(1, availW / contentW, availH / contentH);
                 const finalW = contentW * scale;
                 const finalH = contentH * scale;

                 let drawX = nx1 + padding;
                 if (align === 'center') drawX = nx1 + (targetW - finalW) / 2;
                 else if (align === 'right') drawX = nx2 - finalW - padding;
                 const drawY = ny1 + (targetH - finalH) / 2;

                 resCtx.drawImage(contentCanvas, drawX, drawY, finalW, finalH);
             }
        }

        const newDataUrl = canvas.toDataURL();
        const newHistory = history.slice(0, historyIndex + 1);
        newHistory.push({
            dataUrl: newDataUrl,
            width: newW,
            height: newH,
            grid: nextGrid // Pass the processed grid to the next state
        });

        setHistory(newHistory);
        setHistoryIndex(newHistory.length - 1);
        setSelections([]);
    };
  };

  const handleDownload = () => {
    if (historyIndex < 0) return;
    const link = document.createElement('a');
    link.download = `smart-slice-${Date.now()}.png`;
    link.href = history[historyIndex].dataUrl;
    link.click();
  };

  const handleUndo = () => {
    if (historyIndex > 0) {
        setHistoryIndex(historyIndex - 1);
        setSelections([]);
    }
  };

  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
        setHistoryIndex(historyIndex + 1);
        setSelections([]);
    }
  };

  const clearSelections = () => setSelections([]);

  const currentItem = history[historyIndex];
  const hasSelection = selections.length > 0;

  return (
    <div className="flex flex-col md:flex-row h-full w-full relative">
      {/* Canvas Area */}
      <div 
        ref={containerRef}
        className={`flex-1 bg-slate-100 dark:bg-slate-950 overflow-hidden flex items-center justify-center p-4 md:p-8 relative select-none touch-none ${isEditingGrid ? 'cursor-cell' : 'cursor-crosshair'}`}
        onMouseDown={handlePointerDown}
        onMouseMove={handlePointerMove}
        onMouseUp={handlePointerUp}
        onMouseLeave={handlePointerUp}
        onTouchStart={handlePointerDown}
        onTouchMove={handlePointerMove}
        onTouchEnd={handlePointerUp}
      >
        {currentItem && (
            <div 
                style={{ 
                    transform: `scale(${scale})`, 
                    transformOrigin: 'center',
                    transition: isDragging ? 'none' : 'transform 0.2s cubic-bezier(0.2, 0, 0, 1)'
                }}
                className={`shadow-2xl shadow-black/20 dark:shadow-black/50 transition-opacity duration-500 ${isScanning ? 'opacity-90' : 'opacity-100'}`}
            >
                <canvas ref={canvasRef} className="block bg-white dark:bg-slate-800" />
            </div>
        )}
        
        {/* Floating Controls */}
        <div 
            onMouseDown={stopPropagation}
            onTouchStart={stopPropagation}
            onClick={stopPropagation}
            className="absolute bottom-4 left-4 md:bottom-6 md:left-6 flex gap-2 bg-white/90 dark:bg-slate-900/90 backdrop-blur border border-slate-200 dark:border-slate-700 p-1.5 md:p-2 rounded-xl shadow-xl z-20 pointer-events-auto items-center"
        >
          <button onClick={() => setScale(s => Math.max(0.1, s - 0.1))} className="p-1.5 md:p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg text-slate-600 dark:text-slate-300">
              <ZoomOut size={18} />
          </button>
          <div className="w-10 md:w-12 flex items-center justify-center text-xs md:text-sm font-mono text-slate-500 dark:text-slate-400 select-none">
              {Math.round(scale * 100)}%
          </div>
          <button onClick={() => setScale(s => Math.min(5, s + 0.1))} className="p-1.5 md:p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg text-slate-600 dark:text-slate-300">
              <ZoomIn size={18} />
          </button>
          <div className="w-px h-6 md:h-8 bg-slate-200 dark:bg-slate-700 mx-1"></div>
          
          <button onClick={() => setScale(1)} className="p-1.5 md:p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg text-slate-600 dark:text-slate-300" title="实际大小 (1:1)">
              <Scan size={18} />
          </button>
          <button onClick={() => handleFitScreen()} className="p-1.5 md:p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg text-slate-600 dark:text-slate-300" title="适应屏幕">
              <Maximize2 size={18} />
          </button>
           <button onClick={() => handleFitScreen(window.innerWidth, window.innerHeight)} className="p-1.5 md:p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg text-slate-600 dark:text-slate-300 md:hidden" title="适应设备">
              <Smartphone size={18} />
          </button>
        </div>

        {hasSelection && (
            <button 
                onMouseDown={stopPropagation}
                onTouchStart={stopPropagation}
                onClick={(e) => { stopPropagation(e); clearSelections(); }}
                className="absolute top-4 right-4 bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 z-20 text-sm font-medium transition-transform active:scale-95 pointer-events-auto"
            >
                <Trash2 size={16} /> 清除选区 ({selections.length})
            </button>
        )}
        
        <div className={`absolute top-4 left-1/2 -translate-x-1/2 px-4 py-2 bg-slate-900/80 text-white text-xs rounded-full pointer-events-none backdrop-blur-sm shadow-lg border border-white/10 z-10 flex items-center gap-2 transition-opacity duration-500 ${(showToast || isEditingGrid) ? 'opacity-100' : 'opacity-0'}`}>
            {isEditingGrid ? (
                <>
                    <Eraser size={14} className="text-red-400 animate-pulse" />
                    <span>点击擦除线段 (按住 Alt 删除整行)</span>
                </>
            ) : (
                <>
                    <Grid3X3 size={14} className="text-brand-400 animate-pulse" />
                    <span>点按单元格自动选中，拖拽手动框选</span>
                </>
            )}
        </div>
      </div>

      {/* Control Panel */}
      <div 
        onMouseDown={stopPropagation}
        onTouchStart={stopPropagation}
        className="
        w-full md:w-80 
        bg-white dark:bg-slate-900 
        border-t md:border-t-0 md:border-l border-slate-200 dark:border-slate-800 
        flex flex-col z-30 shadow-xl
        max-h-[40vh] md:max-h-full overflow-y-auto md:overflow-visible
        safe-bottom pointer-events-auto
      ">
        {/* Operations */}
        <div className="p-4 md:p-6 border-b border-slate-200 dark:border-slate-800 flex-1 md:flex-none">
            <h2 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3 md:mb-4">工具</h2>
             <div className="mb-4">
                <button 
                    onClick={() => { setIsEditingGrid(!isEditingGrid); setSelections([]); }}
                    className={`w-full flex items-center justify-center gap-2 p-3 rounded-xl border transition-all ${isEditingGrid 
                        ? 'bg-red-50 dark:bg-red-900/20 border-red-500 text-red-600 dark:text-red-400' 
                        : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'}`}
                >
                    <Eraser size={18} />
                    <span className="font-medium">{isEditingGrid ? '完成编辑' : '手动擦除表格线'}</span>
                </button>
                <p className="text-[10px] text-slate-400 mt-1.5 px-1">
                    点击擦除多余线条来合并单元格。<br/>按住 Alt 键可删除整行/整列。
                </p>
             </div>

            <h2 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3 md:mb-4">裁切操作</h2>
            <div className="grid grid-cols-3 md:grid-cols-1 gap-2 md:gap-3">
                <button 
                    disabled={!hasSelection || isEditingGrid}
                    onClick={() => performCrop('horizontal')}
                    className="group flex flex-col md:flex-row items-center p-2 md:p-3 gap-2 md:gap-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 hover:border-brand-500/50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <div className="p-1.5 md:p-2 bg-slate-200 dark:bg-slate-700 rounded-lg group-hover:bg-brand-500/20 group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors text-slate-600 dark:text-slate-300">
                        <FoldVertical size={20} />
                    </div>
                    <div className="text-center md:text-left">
                        <div className="text-xs md:text-sm font-medium text-slate-900 dark:text-slate-200">删除行</div>
                        <div className="hidden md:block text-xs text-slate-500">消除垂直高度 (缝合)</div>
                    </div>
                </button>

                <button 
                    disabled={!hasSelection || isEditingGrid}
                    onClick={() => performCrop('vertical')}
                    className="group flex flex-col md:flex-row items-center p-2 md:p-3 gap-2 md:gap-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 hover:border-brand-500/50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <div className="p-1.5 md:p-2 bg-slate-200 dark:bg-slate-700 rounded-lg group-hover:bg-brand-500/20 group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors text-slate-600 dark:text-slate-300">
                        <FoldHorizontal size={20} />
                    </div>
                    <div className="text-center md:text-left">
                        <div className="text-xs md:text-sm font-medium text-slate-900 dark:text-slate-200">删除列</div>
                        <div className="hidden md:block text-xs text-slate-500">消除水平宽度 (缝合)</div>
                    </div>
                </button>

                <button 
                    disabled={!hasSelection || isEditingGrid}
                    onClick={() => performCrop('both')}
                    className="group flex flex-col md:flex-row items-center p-2 md:p-3 gap-2 md:gap-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 hover:border-brand-500/50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <div className="p-1.5 md:p-2 bg-slate-200 dark:bg-slate-700 rounded-lg group-hover:bg-brand-500/20 group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors text-slate-600 dark:text-slate-300">
                        <Shrink size={20} />
                    </div>
                    <div className="text-center md:text-left">
                        <div className="text-xs md:text-sm font-medium text-slate-900 dark:text-slate-200">同时删除</div>
                        <div className="hidden md:block text-xs text-slate-500">删除横纵空白</div>
                    </div>
                </button>
            </div>
        </div>
      </div>
    </div>
  );
};