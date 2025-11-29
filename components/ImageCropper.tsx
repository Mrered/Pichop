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
  Grid3X3
} from 'lucide-react';
import { Rect, HistoryItem, CropMode, Grid, GridLine } from '../types';

interface ImageCropperProps {
  initialImage: string;
}

// Internal types for the algorithm
interface Segment {
  id: number;
  pos: number; // y for horiz, x for vert
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
      
      handleFitScreen(img.width, img.height);
    };

    const timer = setTimeout(() => setShowToast(false), 5000);
    return () => clearTimeout(timer);
  }, [initialImage]);

  // --- History Change Effect (Re-scan) ---
  useEffect(() => {
    if (historyIndex >= 0 && history[historyIndex]) {
        setGrid(null); 
        startScanning(history[historyIndex]);
    }
  }, [historyIndex, history]);

  // --- Smart Grid Detection ---
  const startScanning = (item: HistoryItem) => {
    setIsScanning(true);
    scanProgressRef.current = 0;
    
    // Slight delay to allow UI to render the "scanning" state before the heavy lifting
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

      // --- ALGORITHM: Connected Component Grid Detection ---
      
      const getLum = (idx: number) => (data[idx] + data[idx+1] + data[idx+2]); // Sum (0-765)
      
      const CONTRAST_THRESH = 40; // Detection sensitivity
      const MIN_SEG_LEN = Math.max(16, Math.min(width, height) * 0.01); // 1% or 16px min length
      const GAP_TOLERANCE = 4; // px
      const POS_TOLERANCE = 3; // px (fuzzy alignment)

      // 1. Extract Raw Segments
      // We scan for continuous runs of "edges".
      
      const rawH: Segment[] = [];
      let hId = 0;
      
      // Horizontal Scan
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
      
      // Vertical Scan
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

      // 2. Cluster & Merge Segments (Fuzzy Grouping)
      const clusterSegments = (items: Segment[], posKey: 'pos', startKey: 'start', endKey: 'end') => {
          items.sort((a, b) => a[posKey] - b[posKey]);
          const merged: Segment[] = [];
          
          let currentGroup: Segment[] = [];
          if (items.length > 0) currentGroup.push(items[0]);

          const processGroup = (group: Segment[]) => {
               // Average position
               const avgPos = Math.round(group.reduce((acc, i) => acc + i[posKey], 0) / group.length);
               // Sort by start
               group.sort((a, b) => a[startKey] - b[startKey]);
               
               let curr = { ...group[0], pos: avgPos };
               for (let i = 1; i < group.length; i++) {
                   const next = group[i];
                   if (next[startKey] <= curr[endKey] + GAP_TOLERANCE) {
                       // Overlap or close -> Merge
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
          
          // Re-assign IDs uniquely
          return merged.map((m, i) => ({ ...m, id: i }));
      };

      const hSegments = clusterSegments(rawH, 'pos', 'start', 'end');
      const vSegments = clusterSegments(rawV, 'pos', 'start', 'end');

      // 3. Build Connectivity Graph
      // Intersect every H with every V
      const adj = new Map<string, string[]>(); // Key: "h-1", Val: ["v-2", "v-5"]
      
      const getNodeKey = (type: 'h'|'v', id: number) => `${type}-${id}`;

      hSegments.forEach(h => {
          vSegments.forEach(v => {
              // Intersection Check
              // H is at y=h.pos, spans x[h.start, h.end]
              // V is at x=v.pos, spans y[v.start, v.end]
              
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

      // 4. Find Connected Components
      const visited = new Set<string>();
      const components: { totalLength: number, hSegs: Segment[], vSegs: Segment[] }[] = [];

      const allNodes = [
          ...hSegments.map(s => ({ key: getNodeKey('h', s.id), seg: s, type: 'h' })),
          ...vSegments.map(s => ({ key: getNodeKey('v', s.id), seg: s, type: 'v' }))
      ];

      allNodes.forEach(node => {
          if (!visited.has(node.key) && adj.has(node.key)) {
              // Start BFS/DFS
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

      // 5. Select Best Component (Largest Table)
      if (components.length === 0) {
          setGrid(null);
          setIsScanning(false);
          return;
      }

      // Sort by mass (total length of connected lines)
      components.sort((a, b) => b.totalLength - a.totalLength);
      const best = components[0];

      // If the best component is too small (e.g. noise), discard
      if (best.totalLength < (width + height) * 0.5) {
           setGrid(null);
           setIsScanning(false);
           return;
      }

      // 6. Project to Infinite Cuts
      // We extract unique positions from the best component.
      // This enforces "Infinite Cutting Plane": if a segment exists in the table structure, it cuts the whole image.
      const uniqueY = new Set<number>();
      best.hSegs.forEach(s => uniqueY.add(s.pos));
      
      const uniqueX = new Set<number>();
      best.vSegs.forEach(s => uniqueX.add(s.pos));

      // Final Grid Lines
      const finalH: GridLine[] = Array.from(uniqueY).sort((a,b)=>a-b).map(y => ({
          pos: y, thickness: 1, start: 0, end: 0
      }));
      const finalV: GridLine[] = Array.from(uniqueX).sort((a,b)=>a-b).map(x => ({
          pos: x, thickness: 1, start: 0, end: 0
      }));
      
      // Ensure edges are present if close
      // (Optional: sometimes user wants to crop edges, sometimes not. Let's leave strict detection).

      setGrid({ horizontal: finalH, vertical: finalV });
      
      // Animation cleanup
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

  // --- Interaction Logic ---
  
  const getCellAt = (x: number, y: number): Rect | null => {
    if (!grid) return null;
    
    // Find closest lines surrounding the point
    let y1 = -Infinity, y2 = Infinity;
    for (const line of grid.horizontal) {
        if (line.pos <= y && line.pos > y1) y1 = line.pos;
        if (line.pos > y && line.pos < y2) y2 = line.pos;
    }

    let x1 = -Infinity, x2 = Infinity;
    for (const line of grid.vertical) {
        if (line.pos <= x && line.pos > x1) x1 = line.pos;
        if (line.pos > x && line.pos < x2) x2 = line.pos;
    }

    if (y1 === -Infinity || y2 === Infinity || x1 === -Infinity || x2 === Infinity) return null;

    const w = x2 - x1;
    const h = y2 - y1;

    if (w < 4 || h < 4) return null;

    return { x: x1, y: y1, w, h };
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
    if ('touches' in e && e.touches.length > 1) return; 
    const coords = getPointerCoords(e);
    setDragStart(coords);
    setIsDragging(true);
    setCurrentDrag({ x: coords.x, y: coords.y, w: 0, h: 0 });
  };

  const handlePointerMove = (e: React.MouseEvent | React.TouchEvent) => {
    const coords = getPointerCoords(e);

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
    
    if (currentDrag) {
        // Distinguish click from drag
        if (Math.abs(currentDrag.w) < 5 && Math.abs(currentDrag.h) < 5) {
             const cell = getCellAt(currentDrag.x, currentDrag.y);
             if (cell) {
                 toggleSelection(cell);
             } 
        } else {
            // Drag selection
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

        // 1. Draw Image
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);

        // 2. Draw Grid Lines
        if (grid) {
            ctx.save();
            ctx.lineWidth = 1 / scale;
            const alpha = isScanning ? 0.6 : 0.2; 
            ctx.strokeStyle = `rgba(56, 189, 248, ${alpha})`;
            
            ctx.beginPath();
            grid.horizontal.forEach(l => {
                if(l.pos > 0 && l.pos < canvas.height) {
                    ctx.moveTo(0, l.pos);
                    ctx.lineTo(canvas.width, l.pos);
                }
            });
            grid.vertical.forEach(l => {
                 if(l.pos > 0 && l.pos < canvas.width) {
                    ctx.moveTo(l.pos, 0);
                    ctx.lineTo(l.pos, canvas.height);
                 }
            });
            ctx.stroke();
            ctx.restore();
        }

        // 3. Scan Animation (Cyberpunk / Sci-fi Style)
        if (isScanning) {
            ctx.save();
            scanProgressRef.current = (scanProgressRef.current + 25) % (canvas.height + 300);
            const scanY = scanProgressRef.current - 150;
            
            if (scanY < canvas.height + 50) {
                // Gradient trail
                const gradient = ctx.createLinearGradient(0, scanY - 100, 0, scanY);
                gradient.addColorStop(0, 'rgba(14, 165, 233, 0)');
                gradient.addColorStop(1, 'rgba(56, 189, 248, 0.25)');
                
                ctx.fillStyle = gradient;
                ctx.fillRect(0, scanY - 100, canvas.width, 100);
                
                // Bright Scan Line
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

        // 4. Hover Effect
        if (hoveredCell && !isDragging) {
            ctx.fillStyle = 'rgba(56, 189, 248, 0.15)';
            ctx.strokeStyle = 'rgba(14, 165, 233, 0.9)';
            ctx.lineWidth = 2 / scale;
            ctx.fillRect(hoveredCell.x, hoveredCell.y, hoveredCell.w, hoveredCell.h);
            ctx.strokeRect(hoveredCell.x, hoveredCell.y, hoveredCell.w, hoveredCell.h);
        }

        // 5. Selections
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
            
            // X mark for deletion
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

        // 6. Manual Drag Box
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
  }, [history, historyIndex, selections, currentDrag, grid, isScanning, scale, hoveredCell]);


  // --- Stitching Logic (Unchanged) ---
  const performCrop = (mode: CropMode) => {
    if (selections.length === 0 || historyIndex < 0) return;
    
    const currentItem = history[historyIndex];
    const img = new Image();
    img.src = currentItem.dataUrl;
    
    img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        let xRanges: {start: number, end: number}[] = [];
        let yRanges: {start: number, end: number}[] = [];

        selections.forEach(s => {
            let rx = s.x, ry = s.y, rw = s.w, rh = s.h;
            if (rw < 0) { rx += rw; rw = Math.abs(rw); }
            if (rh < 0) { ry += rh; rh = Math.abs(rh); }
            
            if (grid) {
                const snap = (val: number, lines: GridLine[]) => {
                    let nearest = val;
                    let minDist = 6; // Snapping tolerance
                    lines.forEach(l => {
                        const dist = Math.abs(l.pos - val);
                        if (dist < minDist) {
                            minDist = dist;
                            nearest = l.pos;
                        }
                    });
                    return nearest;
                };

                const startY = snap(ry, grid.horizontal);
                const endY = snap(ry + rh, grid.horizontal);
                const startX = snap(rx, grid.vertical);
                const endX = snap(rx + rw, grid.vertical);
                
                yRanges.push({ start: startY, end: endY });
                xRanges.push({ start: startX, end: endX });
            } else {
                yRanges.push({ start: ry, end: ry + rh });
                xRanges.push({ start: rx, end: rx + rw });
            }
        });

        const mergeRanges = (ranges: {start: number, end: number}[]) => {
            if (ranges.length === 0) return [];
            ranges.sort((a, b) => a.start - b.start);
            const merged = [ranges[0]];
            for (let i = 1; i < ranges.length; i++) {
                const prev = merged[merged.length - 1];
                const curr = ranges[i];
                if (curr.start < prev.end + 1) { 
                    prev.end = Math.max(prev.end, curr.end);
                } else {
                    merged.push(curr);
                }
            }
            return merged;
        };

        const finalXRanges = (mode === 'vertical' || mode === 'both') ? mergeRanges(xRanges) : [];
        const finalYRanges = (mode === 'horizontal' || mode === 'both') ? mergeRanges(yRanges) : [];

        let removeW = finalXRanges.reduce((acc, r) => acc + (r.end - r.start), 0);
        let removeH = finalYRanges.reduce((acc, r) => acc + (r.end - r.start), 0);
        
        const newW = Math.max(1, currentItem.width - removeW);
        const newH = Math.max(1, currentItem.height - removeH);

        canvas.width = newW;
        canvas.height = newH;

        const getKeepRanges = (totalSize: number, removeRanges: {start: number, end: number}[]) => {
            const keep = [];
            let cursor = 0;
            removeRanges.forEach(r => {
                if (r.start > cursor) {
                    keep.push({ start: cursor, end: r.start });
                }
                cursor = Math.max(cursor, r.end);
            });
            if (cursor < totalSize) {
                keep.push({ start: cursor, end: totalSize });
            }
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
                   ctx.drawImage(img, kx.start, ky.start, w, h, destX, destY, w, h);
                }
                destX += w;
            });
            destY += h;
        });

        const newDataUrl = canvas.toDataURL();
        const newHistory = history.slice(0, historyIndex + 1);
        newHistory.push({
            dataUrl: newDataUrl,
            width: newW,
            height: newH
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
        className="flex-1 bg-slate-100 dark:bg-slate-950 overflow-hidden flex items-center justify-center p-4 md:p-8 relative cursor-crosshair select-none touch-none"
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
        
        <div className={`absolute top-4 left-1/2 -translate-x-1/2 px-4 py-2 bg-slate-900/80 text-white text-xs rounded-full pointer-events-none backdrop-blur-sm shadow-lg border border-white/10 z-10 flex items-center gap-2 transition-opacity duration-500 ${showToast ? 'opacity-100' : 'opacity-0'}`}>
            <Grid3X3 size={14} className="text-brand-400 animate-pulse" />
            <span>点按单元格自动选中，拖拽手动框选</span>
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
            <h2 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3 md:mb-4">操作</h2>
            
            <div className="grid grid-cols-3 md:grid-cols-1 gap-2 md:gap-3">
                <button 
                    disabled={!hasSelection}
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
                    disabled={!hasSelection}
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
                    disabled={!hasSelection}
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

        {/* History & Download */}
        <div className="p-4 md:p-6 bg-slate-50 dark:bg-slate-900/50 flex flex-row md:flex-col gap-4 items-center md:items-stretch">
            <div className="flex-1">
                <div className="hidden md:block text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-4">历史记录</div>
                <div className="flex gap-2">
                    <button 
                        disabled={historyIndex <= 0}
                        onClick={handleUndo}
                        className="flex-1 flex items-center justify-center gap-2 p-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 disabled:opacity-40 disabled:hover:bg-white dark:disabled:hover:bg-slate-800 transition-colors"
                        title="撤销"
                    >
                        <Undo2 size={16} /> <span className="hidden md:inline">撤销</span>
                    </button>
                    <button 
                        disabled={historyIndex >= history.length - 1}
                        onClick={handleRedo}
                        className="flex-1 flex items-center justify-center gap-2 p-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 disabled:opacity-40 disabled:hover:bg-white dark:disabled:hover:bg-slate-800 transition-colors"
                        title="重做"
                    >
                        <span className="hidden md:inline">重做</span> <Redo2 size={16} />
                    </button>
                </div>
            </div>

            <button 
                onClick={handleDownload}
                className="flex-1 md:flex-none py-3 md:py-4 bg-brand-600 hover:bg-brand-500 active:bg-brand-700 text-white font-bold rounded-xl shadow-lg shadow-brand-500/20 flex items-center justify-center gap-2 transition-all md:mt-4 whitespace-nowrap"
            >
                <Download size={20} />
                <span className="md:inline">下载图片</span>
            </button>
        </div>
      </div>
    </div>
  );
};