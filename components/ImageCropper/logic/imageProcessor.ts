
import { CropMode, Grid, GridLine, HistoryItem, Rect } from '../../../types';
import { getActualCells } from './gridManipulation';

export interface CropResult {
  dataUrl: string;
  width: number;
  height: number;
  grid?: Grid;
}

export const processImageCrop = async (
    item: HistoryItem,
    selections: Rect[],
    grid: Grid | null,
    mode: CropMode
): Promise<CropResult | null> => {
    
    const img = new Image();
    img.src = item.dataUrl;
    
    return new Promise((resolve) => {
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (!ctx) { resolve(null); return; }

            ctx.drawImage(img, 0, 0);
            const fullImageData = ctx.getImageData(0, 0, img.width, img.height);
            
            // 1. Calculate Ranges
            let xRanges: {start: number, end: number}[] = [];
            let yRanges: {start: number, end: number}[] = [];

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
            
            const newW = Math.max(1, item.width - removeW);
            const newH = Math.max(1, item.height - removeH);

            canvas.width = newW;
            canvas.height = newH;
            const resCtx = canvas.getContext('2d', { willReadFrequently: true });
            if(!resCtx) { resolve(null); return; }

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

            const keepX = getKeepRanges(item.width, finalXRanges);
            const keepY = getKeepRanges(item.height, finalYRanges);

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

            // 3. Grid Persistence
            let nextGrid: Grid | undefined = undefined;
            if (grid) {
                const nextH = grid.horizontal.map(l => {
                     let removed = false;
                     for (const r of finalYRanges) { if (l.pos > r.start && l.pos < r.end) removed = true; }
                     if (removed) return null;
                     return { pos: mapY(l.pos), thickness: l.thickness, start: mapX(l.start), end: mapX(l.end) };
                }).filter(Boolean) as GridLine[];

                const nextV = grid.vertical.map(l => {
                     let removed = false;
                     for (const r of finalXRanges) { if (l.pos > r.start && l.pos < r.end) removed = true; }
                     if (removed) return null;
                     return { pos: mapX(l.pos), thickness: l.thickness, start: mapY(l.start), end: mapY(l.end) };
                }).filter(Boolean) as GridLine[];
                nextGrid = { horizontal: nextH, vertical: nextV };
            }

            // 4. Smart Content Restoration (Merged Cell Logic)
            if (grid) {
                 const actualCells = getActualCells(grid, item.width, item.height);
                 
                 for (const cell of actualCells) {
                     const nx1 = mapX(cell.x);
                     const nx2 = mapX(cell.x + cell.w);
                     const ny1 = mapY(cell.y);
                     const ny2 = mapY(cell.y + cell.h);
                     const targetW = nx2 - nx1;
                     const targetH = ny2 - ny1;

                     // Only process if cell significantly shrunk or is small enough to care
                     if (Math.abs(targetW - cell.w) < 2 && Math.abs(targetH - cell.h) < 2) continue;
                     if (targetW < 4 || targetH < 4) continue;

                     // A. Detect BG Color
                     const samples: string[] = [];
                     const sampleStep = Math.max(1, Math.floor((cell.w + cell.h) / 50));
                     const addSample = (x: number, y: number) => {
                         const idx = (Math.floor(y) * img.width + Math.floor(x)) * 4;
                         samples.push(`${fullImageData.data[idx]},${fullImageData.data[idx+1]},${fullImageData.data[idx+2]}`);
                     };
                     // Sample perimeter
                     for(let x=cell.x; x<cell.x+cell.w; x+=sampleStep) { addSample(x, cell.y+2); addSample(x, cell.y+cell.h-2); }
                     for(let y=cell.y; y<cell.y+cell.h; y+=sampleStep) { addSample(cell.x+2, y); addSample(cell.x+cell.w-2, y); }
                     
                     const colorCounts: {[k: string]: number} = {};
                     let maxCount = 0; 
                     let bgStr = "255,255,255";
                     for(const c of samples) {
                         colorCounts[c] = (colorCounts[c] || 0) + 1;
                         if(colorCounts[c] > maxCount) { maxCount = colorCounts[c]; bgStr = c; }
                     }
                     const [bgR, bgG, bgB] = bgStr.split(',').map(Number);

                     // B. Extract Content
                     const cellCanvas = document.createElement('canvas');
                     cellCanvas.width = cell.w;
                     cellCanvas.height = cell.h;
                     const cCtx = cellCanvas.getContext('2d');
                     if(!cCtx) continue;
                     cCtx.drawImage(img, cell.x, cell.y, cell.w, cell.h, 0, 0, cell.w, cell.h);
                     const d = cCtx.getImageData(0,0,cell.w, cell.h).data;

                     let minCx = cell.w, minCy = cell.h, maxCx = 0, maxCy = 0;
                     let hasContent = false;
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
                             }
                         }
                     }

                     if (!hasContent) {
                         resCtx.fillStyle = `rgb(${bgR}, ${bgG}, ${bgB})`;
                         resCtx.fillRect(nx1, ny1, targetW, targetH);
                         continue;
                     }

                     // C. Calculate Relative Position & Margin
                     const dL = minCx;
                     const dR = cell.w - maxCx;
                     const dT = minCy;
                     const dB = cell.h - maxCy;
                     const k = Math.min(dL, dR, dT, dB);
                     
                     // Dimensions of "Content + Min Margin"
                     const cmW = (maxCx - minCx) + 2 * k; 
                     const cmH = (maxCy - minCy) + 2 * k;

                     const contentCenterX = minCx + (maxCx - minCx) / 2;
                     const contentCenterY = minCy + (maxCy - minCy) / 2;
                     const pctX = contentCenterX / cell.w;
                     const pctY = contentCenterY / cell.h;

                     // D. Draw Background
                     resCtx.fillStyle = `rgb(${bgR}, ${bgG}, ${bgB})`;
                     resCtx.fillRect(nx1, ny1, targetW, targetH);

                     // E. Draw Content Scaled & Positioned
                     const targetCenterX = targetW * pctX;
                     const targetCenterY = targetH * pctY;

                     // Adaptive Scale (Contain)
                     const scale = Math.min(1, targetW / cmW, targetH / cmH);
                     
                     const finalBoxW = cmW * scale;
                     const finalBoxH = cmH * scale;

                     // Box Position
                     const boxDrawX = nx1 + targetCenterX - finalBoxW / 2;
                     const boxDrawY = ny1 + targetCenterY - finalBoxH / 2;

                     // Inner Image Position
                     const imgDrawX = boxDrawX + k * scale;
                     const imgDrawY = boxDrawY + k * scale;
                     const imgDrawW = (maxCx - minCx) * scale;
                     const imgDrawH = (maxCy - minCy) * scale;

                     resCtx.drawImage(cellCanvas, minCx, minCy, maxCx - minCx, maxCy - minCy, imgDrawX, imgDrawY, imgDrawW, imgDrawH);
                 }
            }

            resolve({
                dataUrl: canvas.toDataURL(),
                width: newW,
                height: newH,
                grid: nextGrid
            });
        };
    });
};
