
import { CropMode, Grid, GridLine, HistoryItem, Rect } from '../../../types';

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
            
            // 1. Calculate Ranges to Remove
            let xRanges: {start: number, end: number}[] = [];
            let yRanges: {start: number, end: number}[] = [];

            selections.forEach(s => {
                let rx = s.x, ry = s.y, rw = s.w, rh = s.h;
                if (rw < 0) { rx += rw; rw = Math.abs(rw); }
                if (rh < 0) { ry += rh; rh = Math.abs(rh); }
                // Rounding to avoid sub-pixel artifacts in range calc
                rx = Math.floor(rx); ry = Math.floor(ry);
                rw = Math.ceil(rw); rh = Math.ceil(rh);
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

            // 2. Prepare Destination Canvas
            let removeW = finalXRanges.reduce((acc, r) => acc + (r.end - r.start), 0);
            let removeH = finalYRanges.reduce((acc, r) => acc + (r.end - r.start), 0);
            
            const newW = Math.max(1, item.width - removeW);
            const newH = Math.max(1, item.height - removeH);

            canvas.width = newW;
            canvas.height = newH;
            const resCtx = canvas.getContext('2d', { willReadFrequently: true });
            if(!resCtx) { resolve(null); return; }

            // Coordinate Mapping Functions
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

            // 3. Render Background (Stitching)
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

            // 4. Grid Persistence
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

            resolve({
                dataUrl: canvas.toDataURL(),
                width: newW,
                height: newH,
                grid: nextGrid
            });
        };
    });
};
