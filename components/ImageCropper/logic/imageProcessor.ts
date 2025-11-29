import { CropMode, Grid, GridLine, HistoryItem, Rect } from '../../../types';
import { getActualCells } from './gridManipulation';

export interface CropResult {
  dataUrl: string;
  width: number;
  height: number;
  grid?: Grid;
}

// Helper: Calculate "Energy" (contrast/detail) in a specific rectangular region
const getRegionEnergy = (
    data: Uint8ClampedArray, 
    width: number, 
    startX: number, 
    startY: number, 
    w: number, 
    h: number
) => {
    let energy = 0;
    const stride = 2; // Optimization: Skip pixels
    
    // Bounds check
    const maxY = Math.min(startY + h, data.length / 4 / width);
    const maxX = Math.min(startX + w, width);

    for (let y = Math.max(0, startY); y < maxY; y += stride) {
        for (let x = Math.max(0, startX); x < maxX - 1; x += stride) {
            const idx = (y * width + x) * 4;
            // Simple edge detection: |Current - Next|
            const r1 = data[idx], g1 = data[idx+1], b1 = data[idx+2];
            const r2 = data[idx+4], g2 = data[idx+5], b2 = data[idx+6];
            
            // Weight brightness (prefer white backgrounds for cuts)
            const brightness = (r1 + g1 + b1) / 3;
            // Heavily penalize dark pixels (text)
            const whitePenalty = brightness > 230 ? 0 : (255 - brightness) * 2;

            energy += Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2) + whitePenalty;
        }
    }
    return energy;
};

// Find the best 'safe' zone of size `targetSize` within a specific `cell`
const findSafeZone = (
    data: Uint8ClampedArray, 
    imgW: number, 
    imgH: number,
    cell: Rect, 
    targetSize: number, 
    defaultStart: number,
    axis: 'vertical' | 'horizontal' // 'vertical' = finding a Y range to cut (for removing rows)
): number => {
    let minEnergy = Infinity;
    let bestPos = defaultStart;
    
    // Safety padding
    const padding = 2;

    if (axis === 'vertical') {
        // We are removing a Row. Slide this window vertically inside the cell.
        const searchStart = cell.y + padding;
        const searchEnd = (cell.y + cell.h) - targetSize - padding;
        
        // If cell is smaller than the cut, check if we can just align it with the cell edge?
        // Fallback: If cut is larger than cell, we can't hide it inside. 
        // We just return default behavior.
        if (searchEnd <= searchStart) return defaultStart;

        // Step size for search
        const step = 2;

        for (let y = searchStart; y <= searchEnd; y += step) {
            const energy = getRegionEnergy(data, imgW, cell.x, y, cell.w, targetSize);
            if (energy < minEnergy) {
                minEnergy = energy;
                bestPos = y;
            }
        }
    } else {
        // Horizontal axis search (removing column). Slide window horizontally.
        const searchStart = cell.x + padding;
        const searchEnd = (cell.x + cell.w) - targetSize - padding;

        if (searchEnd <= searchStart) return defaultStart;

        const step = 2;
        for (let x = searchStart; x <= searchEnd; x += step) {
             const energy = getRegionEnergy(data, imgW, x, cell.y, targetSize, cell.h);
             if (energy < minEnergy) {
                 minEnergy = energy;
                 bestPos = x;
             }
        }
    }

    return bestPos;
};

// Helper: Generate "Keep Ranges" for a single strip (row or column)
const getLocalKeepRanges = (
    totalSize: number, 
    removeRanges: {start: number, end: number}[], 
    axisCells: Rect[], 
    stripStart: number, 
    stripEnd: number,   
    smartMode: boolean,
    imgData: Uint8ClampedArray | null,
    imgW: number,
    imgH: number,
    isVerticalCut: boolean 
) => {
    if (!smartMode || !imgData) {
         return invertRanges(totalSize, removeRanges);
    }

    const adjustedRemoves = removeRanges.map(r => {
        const rSize = r.end - r.start;
        
        // Find a cell that conflicts with this cut in this strip.
        // We look for cells that physically overlap the strip AND the cut region.
        const conflictingCell = axisCells.find(c => {
            if (isVerticalCut) {
                // Processing a vertical strip (Column). Check if cell covers this X-range.
                const cellCoversStrip = (c.x < stripEnd) && (c.x + c.w > stripStart);
                if (!cellCoversStrip) return false;
                
                // Check if the global Y-cut hits this cell.
                // Looser check: If the cut overlaps the cell significantly (intersection > 0)
                const overlapStart = Math.max(c.y, r.start);
                const overlapEnd = Math.min(c.y + c.h, r.end);
                
                // Only consider it a "Smart Avoidance" scenario if the cut is essentially 
                // passing THROUGH the cell (i.e., the cell is bigger than the cut).
                // If the cut swallows the cell, we just delete the cell.
                
                // FIX: Use c.h (height) for Y-axis check, not c.w
                const isThroughCut = (c.y <= r.start + 5) && (c.y + c.h >= r.end - 5);
                return isThroughCut;

            } else {
                // Processing a horizontal strip (Row). Check if cell covers this Y-range.
                const cellCoversStrip = (c.y < stripEnd) && (c.y + c.h > stripStart);
                if (!cellCoversStrip) return false;

                // Check if global X-cut hits this cell
                const isThroughCut = (c.x <= r.start + 5) && (c.x + c.w >= r.end - 5);
                return isThroughCut;
            }
        });

        if (conflictingCell) {
            const bestStart = findSafeZone(
                imgData, 
                imgW, 
                imgH,
                conflictingCell, 
                rSize, 
                r.start, 
                isVerticalCut ? 'vertical' : 'horizontal'
            );
            return { start: bestStart, end: bestStart + rSize };
        }
        return r;
    });

    return invertRanges(totalSize, adjustedRemoves);
};

const invertRanges = (totalSize: number, removeRanges: {start: number, end: number}[]) => {
    const keep = [];
    let cursor = 0;
    const sorted = [...removeRanges].sort((a,b) => a.start - b.start);
    
    sorted.forEach(r => {
        if (r.start > cursor) keep.push({ start: cursor, end: r.start });
        cursor = Math.max(cursor, r.end);
    });
    if (cursor < totalSize) keep.push({ start: cursor, end: totalSize });
    return keep;
};

export const processImageCrop = async (
    item: HistoryItem,
    selections: Rect[],
    grid: Grid | null,
    mode: CropMode,
    smartMode: boolean = true
): Promise<CropResult | null> => {
    
    const img = new Image();
    img.src = item.dataUrl;
    
    return new Promise((resolve) => {
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (!ctx) { resolve(null); return; }

            canvas.width = item.width;
            canvas.height = item.height;
            ctx.drawImage(img, 0, 0);

            const originalData = ctx.getImageData(0, 0, item.width, item.height).data;
            
            let xRanges: {start: number, end: number}[] = [];
            let yRanges: {start: number, end: number}[] = [];

            selections.forEach(s => {
                let rx = Math.floor(s.x), ry = Math.floor(s.y);
                let rw = Math.ceil(Math.abs(s.w)), rh = Math.ceil(Math.abs(s.h));
                if (s.w < 0) rx -= rw;
                if (s.h < 0) ry -= rh;
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

            const globalXRanges = (mode === 'vertical' || mode === 'both') ? mergeRanges(xRanges) : [];
            const globalYRanges = (mode === 'horizontal' || mode === 'both') ? mergeRanges(yRanges) : [];

            const removeW = globalXRanges.reduce((acc, r) => acc + (r.end - r.start), 0);
            const removeH = globalYRanges.reduce((acc, r) => acc + (r.end - r.start), 0);
            const finalW = Math.max(1, item.width - removeW);
            const finalH = Math.max(1, item.height - removeH);

            let cells: Rect[] = [];
            if (grid && smartMode) {
                cells = getActualCells(grid, item.width, item.height);
            }

            // --- PASS 1: Vertical Fold (Removing Rows) ---
            const pass1Canvas = document.createElement('canvas');
            pass1Canvas.width = item.width;
            pass1Canvas.height = finalH;
            const pass1Ctx = pass1Canvas.getContext('2d', { willReadFrequently: true });
            if (!pass1Ctx) { resolve(null); return; }

            if (globalYRanges.length > 0) {
                const vLines = grid ? grid.vertical.map(l => l.pos).concat([0, item.width]).sort((a,b)=>a-b) : [0, item.width];
                const vStrips: {start: number, end: number}[] = [];
                const uniqueV = vLines.filter((v, i) => i === 0 || v > vLines[i-1] + 1);
                for(let i=0; i<uniqueV.length-1; i++) {
                    vStrips.push({start: uniqueV[i], end: uniqueV[i+1]});
                }

                vStrips.forEach(strip => {
                    const keepRanges = getLocalKeepRanges(
                        item.height, globalYRanges, cells, 
                        strip.start, strip.end, 
                        smartMode, originalData, item.width, item.height, true
                    );
                    
                    let destY = 0;
                    keepRanges.forEach(k => {
                        const h = k.end - k.start;
                        if (h > 0) {
                            pass1Ctx.drawImage(
                                canvas, 
                                strip.start, k.start, strip.end - strip.start, h,
                                strip.start, destY, strip.end - strip.start, h
                            );
                        }
                        destY += h;
                    });
                });
            } else {
                pass1Ctx.drawImage(canvas, 0, 0);
            }

            // --- PASS 2: Horizontal Fold (Removing Columns) ---
            const finalCanvas = document.createElement('canvas');
            finalCanvas.width = finalW;
            finalCanvas.height = finalH;
            const finalCtx = finalCanvas.getContext('2d', { willReadFrequently: true });
            if (!finalCtx) { resolve(null); return; }

            if (globalXRanges.length > 0) {
                const pass1Raw = pass1Ctx.getImageData(0, 0, pass1Canvas.width, pass1Canvas.height).data;

                const mapYGlobal = (y: number) => {
                    let shift = 0;
                    for(const r of globalYRanges) {
                        if (y >= r.end) shift += (r.end - r.start);
                        else if (y > r.start) shift += (y - r.start);
                    }
                    return y - shift;
                };
                
                const mappedCells = cells.map(c => ({
                    ...c,
                    y: mapYGlobal(c.y),
                    h: mapYGlobal(c.y + c.h) - mapYGlobal(c.y)
                }));

                const hLinesOriginal = grid ? grid.horizontal.map(l => l.pos) : [];
                const hLinesMapped = hLinesOriginal.map(mapYGlobal).concat([0, finalH]).sort((a,b)=>a-b);
                const uniqueH = hLinesMapped.filter((v, i) => i === 0 || v > hLinesMapped[i-1] + 1);
                
                const hStrips: {start: number, end: number}[] = [];
                for(let i=0; i<uniqueH.length-1; i++) {
                    hStrips.push({start: uniqueH[i], end: uniqueH[i+1]});
                }

                hStrips.forEach(strip => {
                    const keepRanges = getLocalKeepRanges(
                        item.width, globalXRanges, mappedCells, 
                        strip.start, strip.end, 
                        smartMode, pass1Raw, pass1Canvas.width, pass1Canvas.height, false
                    );
                    
                    let destX = 0;
                    keepRanges.forEach(k => {
                        const w = k.end - k.start;
                        if (w > 0) {
                            finalCtx.drawImage(
                                pass1Canvas, 
                                k.start, strip.start, w, strip.end - strip.start,
                                destX, strip.start, w, strip.end - strip.start
                            );
                        }
                        destX += w;
                    });
                });
            } else {
                finalCtx.drawImage(pass1Canvas, 0, 0);
            }

            // Grid Persistence (Mapped to GLOBAL changes to maintain structure)
            const mapX = (x: number) => {
                let shift = 0;
                for(const r of globalXRanges) {
                    if (x >= r.end) shift += (r.end - r.start);
                    else if (x > r.start) shift += (x - r.start);
                }
                return x - shift;
            };
            const mapY = (y: number) => {
                let shift = 0;
                for(const r of globalYRanges) {
                    if (y >= r.end) shift += (r.end - r.start);
                    else if (y > r.start) shift += (y - r.start);
                }
                return y - shift;
            };

            let nextGrid: Grid | undefined = undefined;
            if (grid) {
                const nextH = grid.horizontal.map(l => {
                    let removed = false;
                    for (const r of globalYRanges) { if (l.pos > r.start && l.pos < r.end) removed = true; }
                    if (removed) return null;
                    return { pos: mapY(l.pos), thickness: l.thickness, start: mapX(l.start), end: mapX(l.end) };
                }).filter(Boolean) as GridLine[];

                const nextV = grid.vertical.map(l => {
                    let removed = false;
                    for (const r of globalXRanges) { if (l.pos > r.start && l.pos < r.end) removed = true; }
                    if (removed) return null;
                    return { pos: mapX(l.pos), thickness: l.thickness, start: mapY(l.start), end: mapY(l.end) };
                }).filter(Boolean) as GridLine[];
                nextGrid = { horizontal: nextH, vertical: nextV };
            }

            resolve({
                dataUrl: finalCanvas.toDataURL(),
                width: finalW,
                height: finalH,
                grid: nextGrid
            });
        };
    });
};