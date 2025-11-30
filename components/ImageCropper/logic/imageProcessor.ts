
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
// Optimized to return average energy per pixel
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
    
    const height = data.length / 4 / width;
    // Ensure we don't read past the data array
    const maxY = Math.min(startY + h, height);
    const maxX = Math.min(startX + w, width);

    for (let y = Math.max(0, startY); y < maxY; y += stride) {
        for (let x = Math.max(0, startX); x < maxX; x += stride) {
            // We compare pixel x with x+1, so x+1 must be valid
            if (x + 1 >= width) continue;

            pixelsChecked++;
            const idx = (y * width + x) * 4;
            // Simple edge detection: |Current - Next|
            const r1 = data[idx], g1 = data[idx+1], b1 = data[idx+2];
            const r2 = data[idx+4], g2 = data[idx+5], b2 = data[idx+6];
            
            // Removed 'isDark' penalty which was causing flat colored backgrounds 
            // (common in table rows) to be flagged as high-energy content, 
            // leading to incorrect squishing instead of cutting.
            const diff = Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2);
            energy += diff;
        }
    }
    return pixelsChecked > 0 ? energy / pixelsChecked : 0;
};

// --- NEW CORE LOGIC: Quota-Based Mixed Strategy ---
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
    
    // Fallback: Simple physical cut
    const createStandardCuts = () => {
        const keep = invertRanges(totalSize, removeRanges);
        return keep.map(k => ({ srcStart: k.start, srcLen: k.end - k.start, destLen: k.end - k.start }));
    };

    if (!smartMode || !imgData) return createStandardCuts();

    // 0. Initialize maps
    // pixelAction: 0 = Keep, 1 = Physical Cut
    const pixelAction = new Uint8Array(totalSize).fill(0); 
    const cellSquishDebt = new Map<number, number>(); 
    const cellCutQuota = new Map<number, number>();

    const UNSAFE_ENERGY_THRESHOLD = 5.0; 

    // Helper: Identify which cells belong to this strip
    // Pre-calculating this saves performance in the pixel loop
    const stripCellsIndices = axisCells.map((c, idx) => {
        if (isVerticalCut) {
            // Vertical Cut = Removing Rows. Strip is a Column (X range).
            // Check if cell horizontally overlaps the strip.
            const inStrip = (c.x < stripEnd) && (c.x + c.w > stripStart);
            return inStrip ? idx : -1;
        } else {
            // Horizontal Cut = Removing Cols. Strip is a Row (Y range).
            // Check if cell vertically overlaps the strip.
            const inStrip = (c.y < stripEnd) && (c.y + c.h > stripStart);
            return inStrip ? idx : -1;
        }
    }).filter(i => i !== -1);

    // Helper: Analyze a cell to find which lines are safe
    const analyzeCellSafety = (cell: Rect) => {
        const safeLines: number[] = [];
        const mainStart = isVerticalCut ? cell.y : cell.x;
        const mainDim = isVerticalCut ? cell.h : cell.w;
        const blockSize = 2; 

        // CRITICAL FIX: Restrict the energy check to the intersection of the cell and the strip.
        // Even if the cell is very wide (or tall), we only care if the *current strip* contains content.
        // This prevents content in Column A from preventing cuts in empty Column B for the same Row.
        const crossStart = isVerticalCut ? cell.x : cell.y;
        const crossDim = isVerticalCut ? cell.w : cell.h;
        
        const checkStart = Math.max(crossStart, stripStart);
        const checkEnd = Math.min(crossStart + crossDim, stripEnd);
        const checkDim = Math.max(1, checkEnd - checkStart);

        for(let i = 0; i < mainDim; i += blockSize) {
            const currentPos = mainStart + i;
            if (currentPos >= totalSize) break;

            const size = Math.min(blockSize, mainDim - i);
            
            // Use the intersected bounds for energy check
            const energy = isVerticalCut 
                ? getRegionEnergy(imgData, imgW, checkStart, currentPos, checkDim, size)
                : getRegionEnergy(imgData, imgW, currentPos, checkStart, size, checkDim);
            
            if (energy < UNSAFE_ENERGY_THRESHOLD) {
                for(let k=0; k<size; k++) safeLines.push(currentPos + k);
            }
        }
        return safeLines;
    };

    // 1. Distribute Cuts: Gap vs Cell Quota
    removeRanges.forEach(range => {
        for (let i = range.start; i < range.end; i++) {
            if (i < 0 || i >= totalSize) continue;

            // Check if pixel 'i' falls into any cell in this strip
            let inCellIdx = -1;
            for (const cIdx of stripCellsIndices) {
                const c = axisCells[cIdx];
                const cStart = isVerticalCut ? c.y : c.x;
                const cEnd = isVerticalCut ? c.y + c.h : c.x + c.w;
                if (i >= cStart && i < cEnd) {
                    inCellIdx = cIdx;
                    break;
                }
            }

            if (inCellIdx !== -1) {
                // Pixel is in a cell -> Add to that cell's cut quota
                const q = cellCutQuota.get(inCellIdx) || 0;
                cellCutQuota.set(inCellIdx, q + 1);
            } else {
                // Pixel is in a gap -> Mark for immediate physical removal
                pixelAction[i] = 1;
            }
        }
    });

    // 2. Satisfy Cell Quotas (Safe Lines First -> Then Squish)
    stripCellsIndices.forEach(cellIdx => {
        const quota = cellCutQuota.get(cellIdx) || 0;
        if (quota === 0) return;

        const cell = axisCells[cellIdx];
        
        // Find safe lines in this cell (within the current strip context)
        const safeLines = analyzeCellSafety(cell);
        
        // Only use safe lines that aren't already marked for cutting
        const availableSafeLines = safeLines.filter(pos => pixelAction[pos] === 0);

        // Group into contiguous blocks to prioritize larger whitespace chunks
        const blocks: {start: number, end: number, len: number}[] = [];
        if (availableSafeLines.length > 0) {
            let currBlock = { start: availableSafeLines[0], end: availableSafeLines[0] + 1, len: 1 };
            for(let k=1; k<availableSafeLines.length; k++) {
                if (availableSafeLines[k] === currBlock.end) {
                    currBlock.end++;
                    currBlock.len++;
                } else {
                    blocks.push(currBlock);
                    currBlock = { start: availableSafeLines[k], end: availableSafeLines[k] + 1, len: 1 };
                }
            }
            blocks.push(currBlock);
        }
        
        // Sort blocks by length (largest first)
        blocks.sort((a,b) => b.len - a.len);

        let remainingQuota = quota;

        // Consume safe lines to satisfy quota
        for (const block of blocks) {
            if (remainingQuota <= 0) break;
            const cutSize = Math.min(remainingQuota, block.len);
            
            for(let p = block.start; p < block.start + cutSize; p++) {
                pixelAction[p] = 1;
            }
            remainingQuota -= cutSize;
        }

        // If quota remains, it becomes debt (squish)
        if (remainingQuota > 0) {
            const currentDebt = cellSquishDebt.get(cellIdx) || 0;
            cellSquishDebt.set(cellIdx, currentDebt + remainingQuota);
        }
    });

    // 3. Generate Operations based on pixelAction and Squish Debt
    const ops: DrawOperation[] = [];
    let currentStart = -1;
    
    // IMPORTANT: Collect cell boundaries. We MUST split segments at cell boundaries
    // to ensure that we apply the correct debt/scaling to the correct regions.
    const splitPoints = new Set<number>();
    stripCellsIndices.forEach(cIdx => {
         const c = axisCells[cIdx];
         const start = isVerticalCut ? c.y : c.x;
         const end = isVerticalCut ? c.y + c.h : c.x + c.w;
         splitPoints.add(start);
         splitPoints.add(end);
    });

    for (let i = 0; i <= totalSize; i++) {
        const isCut = i < totalSize ? pixelAction[i] === 1 : true; 
        const isSplit = splitPoints.has(i);

        // If we have a running segment and we hit a cut OR a boundary, close it.
        if (currentStart !== -1) {
            if (isCut || isSplit) {
                // End of a "Keep" segment
                const segmentStart = currentStart;
                const segmentEnd = i;
                const segmentLen = segmentEnd - segmentStart;
                
                if (segmentLen > 0) {
                    let destLen = segmentLen;
                    
                    // Check if this segment belongs to a cell with debt
                    const mid = segmentStart + segmentLen / 2;
                    
                    // Find which cell this segment belongs to
                    let inCellIdx = -1;
                    for (const cIdx of stripCellsIndices) {
                         const c = axisCells[cIdx];
                         const cStart = isVerticalCut ? c.y : c.x;
                         const cEnd = isVerticalCut ? c.y + c.h : c.x + c.w;
                         // Use strict inequality for boundaries to match split logic
                         if (mid >= cStart && mid < cEnd) {
                             inCellIdx = cIdx;
                             break;
                         }
                    }

                    if (inCellIdx !== -1 && cellSquishDebt.has(inCellIdx)) {
                        // Calculate scaling factor
                        // Scale = (TotalRemainingCellLength - Debt) / TotalRemainingCellLength
                        let totalRemainingCellLen = 0;
                        const c = axisCells[inCellIdx];
                        const cStart = isVerticalCut ? c.y : c.x;
                        const cEnd = isVerticalCut ? c.y + c.h : c.x + c.w;
                        
                        for(let k=cStart; k<cEnd; k++) {
                            if (k >= 0 && k < totalSize && pixelAction[k] === 0) {
                                totalRemainingCellLen++;
                            }
                        }

                        if (totalRemainingCellLen > 0) {
                            const debt = cellSquishDebt.get(inCellIdx)!;
                            // Prevent scale < 0
                            const scale = Math.max(0, totalRemainingCellLen - debt) / totalRemainingCellLen;
                            destLen = segmentLen * scale;
                        }
                    }

                    ops.push({
                        srcStart: segmentStart,
                        srcLen: segmentLen,
                        destLen: destLen
                    });
                }
                
                currentStart = -1;
            }
        }
        
        if (!isCut) {
            if (currentStart === -1) currentStart = i;
        }
    }

    return ops;
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

            // The remove amount equals the total selection size (Physical + Squished)
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
