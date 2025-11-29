import { CropMode, Grid, GridLine, HistoryItem, Rect } from '../../../types';
import { getActualCells } from './gridManipulation';

export interface CropResult {
  dataUrl: string;
  width: number;
  height: number;
  grid?: Grid;
}

// Instruction for the renderer
interface DrawOperation {
    srcStart: number;
    srcLen: number;
    destLen: number; // If destLen < srcLen, content is squished
}

// Calculate "Energy" (contrast/detail) in a specific rectangular region
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
    let pixelsChecked = 0;
    
    // Bounds check
    const maxY = Math.min(startY + h, data.length / 4 / width);
    const maxX = Math.min(startX + w, width);

    for (let y = Math.max(0, startY); y < maxY; y += stride) {
        for (let x = Math.max(0, startX); x < maxX - 1; x += stride) {
            pixelsChecked++;
            const idx = (y * width + x) * 4;
            // Simple edge detection: |Current - Next|
            const r1 = data[idx], g1 = data[idx+1], b1 = data[idx+2];
            const r2 = data[idx+4], g2 = data[idx+5], b2 = data[idx+6];
            
            // Weight brightness (prefer white backgrounds for cuts)
            const brightness = (r1 + g1 + b1) / 3;
            // Heavily penalize dark pixels (text usually)
            // If pixel is not white/light grey, add penalty
            const isDark = brightness < 230; 
            const diff = Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2);
            
            if (isDark) energy += (diff + 20); // Base penalty for just being dark
            else energy += diff;
        }
    }
    // Return Average Energy per pixel to be size-invariant
    return pixelsChecked > 0 ? energy / pixelsChecked : 0;
};

// Find the best 'safe' zone
const findSafeZone = (
    data: Uint8ClampedArray, 
    imgW: number, 
    imgH: number,
    cell: Rect, 
    targetSize: number, 
    defaultStart: number,
    axis: 'vertical' | 'horizontal' 
): { pos: number, energy: number } => {
    let minEnergy = Infinity;
    let bestPos = defaultStart;
    
    const padding = 2;

    if (axis === 'vertical') {
        const searchStart = cell.y + padding;
        const searchEnd = (cell.y + cell.h) - targetSize - padding;
        
        if (searchEnd <= searchStart) return { pos: defaultStart, energy: Infinity };

        const step = 2;
        for (let y = searchStart; y <= searchEnd; y += step) {
            const energy = getRegionEnergy(data, imgW, cell.x, y, cell.w, targetSize);
            if (energy < minEnergy) {
                minEnergy = energy;
                bestPos = y;
            }
        }
    } else {
        const searchStart = cell.x + padding;
        const searchEnd = (cell.x + cell.w) - targetSize - padding;

        if (searchEnd <= searchStart) return { pos: defaultStart, energy: Infinity };

        const step = 2;
        for (let x = searchStart; x <= searchEnd; x += step) {
             const energy = getRegionEnergy(data, imgW, x, cell.y, targetSize, cell.h);
             if (energy < minEnergy) {
                 minEnergy = energy;
                 bestPos = x;
             }
        }
    }

    return { pos: bestPos, energy: minEnergy };
};

// --- CORE LOGIC: Generate Draw Operations ---
const getStripOperations = (
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
): DrawOperation[] => {
    
    // Helper to fallback to standard cutting
    const createStandardCuts = () => {
        const keep = invertRanges(totalSize, removeRanges);
        return keep.map(k => ({ srcStart: k.start, srcLen: k.end - k.start, destLen: k.end - k.start }));
    };

    if (!smartMode || !imgData) return createStandardCuts();

    // 1. Determine Strategy for each Cut (Physical Cut vs Squish)
    const physicalCuts: {start: number, end: number}[] = [];
    const cellSquishMap = new Map<number, number>(); // cellIndex -> total pixels to squish

    // Average Energy Threshold. 
    // Pure noise is usually < 1.0. Text lines are usually > 10.0.
    const UNSAFE_ENERGY_THRESHOLD = 5.0; 

    removeRanges.forEach(r => {
        const rSize = r.end - r.start;

        // Find intersecting cell (Must cover the strip width to be relevant)
        const cellIdx = axisCells.findIndex(c => {
            if (isVerticalCut) {
                const cellCoversStrip = (c.x < stripEnd) && (c.x + c.w > stripStart);
                const cutInCell = (c.y <= r.start + 5) && (c.y + c.h >= r.end - 5);
                return cellCoversStrip && cutInCell;
            } else {
                const cellCoversStrip = (c.y < stripEnd) && (c.y + c.h > stripStart);
                const cutInCell = (c.x <= r.start + 5) && (c.x + c.w >= r.end - 5);
                return cellCoversStrip && cutInCell;
            }
        });

        if (cellIdx !== -1) {
            const cell = axisCells[cellIdx];
            const best = findSafeZone(
                imgData, imgW, imgH, cell, rSize, r.start, 
                isVerticalCut ? 'vertical' : 'horizontal'
            );

            if (best.energy < UNSAFE_ENERGY_THRESHOLD) {
                physicalCuts.push({ start: best.pos, end: best.pos + rSize });
            } else {
                const currentSquish = cellSquishMap.get(cellIdx) || 0;
                cellSquishMap.set(cellIdx, currentSquish + rSize);
            }
        } else {
            // Not in a cell (gap), just cut it
            physicalCuts.push(r);
        }
    });

    // 2. Generate Breakpoints (Micro-Segments)
    const boundaries = new Set<number>();
    boundaries.add(0);
    boundaries.add(totalSize);
    
    physicalCuts.forEach(r => {
        boundaries.add(r.start);
        boundaries.add(r.end);
    });

    cellSquishMap.forEach((_, cellIdx) => {
        const c = axisCells[cellIdx];
        if (isVerticalCut) {
            boundaries.add(Math.max(0, c.y));
            boundaries.add(Math.min(totalSize, c.y + c.h));
        } else {
            boundaries.add(Math.max(0, c.x));
            boundaries.add(Math.min(totalSize, c.x + c.w));
        }
    });

    const sortedPoints = Array.from(boundaries).sort((a,b) => a - b);
    const finalOps: DrawOperation[] = [];

    // 3. Iterate Segments
    for (let i = 0; i < sortedPoints.length - 1; i++) {
        const start = sortedPoints[i];
        const end = sortedPoints[i+1];
        const len = end - start;
        const mid = start + len / 2;

        if (len <= 0) continue;

        // Is this segment inside a physical cut? -> Skip it
        const isCut = physicalCuts.some(cut => mid >= cut.start && mid <= cut.end);
        if (isCut) continue;

        // Is this segment inside a Squish Cell? -> Apply Scale
        const cellIdx = axisCells.findIndex(c => {
             // CRITICAL FIX: Must ensure the cell is actually in the current strip
             // otherwise we might match a cell from a different column/row with same coords.
             if (isVerticalCut) {
                 const inStrip = (c.x < stripEnd) && (c.x + c.w > stripStart);
                 return inStrip && mid >= c.y && mid <= c.y + c.h;
             } else {
                 const inStrip = (c.y < stripEnd) && (c.y + c.h > stripStart);
                 return inStrip && mid >= c.x && mid <= c.x + c.w;
             }
        });

        let scale = 1.0;
        if (cellIdx !== -1 && cellSquishMap.has(cellIdx)) {
            const squishAmount = cellSquishMap.get(cellIdx)!;
            const c = axisCells[cellIdx];
            const originalDim = isVerticalCut ? c.h : c.w;
            const safeDim = Math.max(originalDim, 1);
            const targetDim = Math.max(1, safeDim - squishAmount);
            scale = targetDim / safeDim;
        }

        finalOps.push({
            srcStart: start,
            srcLen: len,
            destLen: len * scale
        });
    }

    return finalOps;
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
                    const ops = getStripOperations(
                        item.height, globalYRanges, cells, 
                        strip.start, strip.end, 
                        smartMode, originalData, item.width, item.height, true
                    );
                    
                    let destY = 0;
                    ops.forEach(op => {
                        if (op.destLen > 0.01) {
                            pass1Ctx.drawImage(
                                canvas, 
                                strip.start, op.srcStart, strip.end - strip.start, op.srcLen, // Source
                                strip.start, destY, strip.end - strip.start, op.destLen   // Dest
                            );
                        }
                        destY += op.destLen;
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
                    const ops = getStripOperations(
                        item.width, globalXRanges, mappedCells, 
                        strip.start, strip.end, 
                        smartMode, pass1Raw, pass1Canvas.width, pass1Canvas.height, false
                    );
                    
                    let destX = 0;
                    ops.forEach(op => {
                        if (op.destLen > 0.01) {
                            finalCtx.drawImage(
                                pass1Canvas, 
                                op.srcStart, strip.start, op.srcLen, strip.end - strip.start,
                                destX, strip.start, op.destLen, strip.end - strip.start
                            );
                        }
                        destX += op.destLen;
                    });
                });
            } else {
                finalCtx.drawImage(pass1Canvas, 0, 0);
            }

            // --- Grid Persistence ---
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