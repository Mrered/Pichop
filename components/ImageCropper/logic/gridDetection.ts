
import { HistoryItem, Grid, GridLine } from '../../../types';
import { Segment } from '../types';

export const detectGrid = (
  item: HistoryItem, 
  onComplete: (grid: Grid) => void
) => {
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

    // --- Horizontal Scan ---
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

    // --- Vertical Scan ---
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

    // --- Cluster Segments ---
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

    // Create Initial Grid (Full Lines)
    const uniqueY = new Set<number>();
    hSegments.forEach(s => uniqueY.add(s.pos));
    const uniqueX = new Set<number>();
    vSegments.forEach(s => uniqueX.add(s.pos));

    const finalH: GridLine[] = Array.from(uniqueY).sort((a,b)=>a-b).map(y => ({
        pos: y, thickness: 1, start: 0, end: width 
    }));
    const finalV: GridLine[] = Array.from(uniqueX).sort((a,b)=>a-b).map(x => ({
        pos: x, thickness: 1, start: 0, end: height
    }));
    
    // Add Borders
    if (finalH.length === 0 || finalH[0].pos > 5) finalH.unshift({ pos: 0, thickness: 0, start: 0, end: width });
    if (finalH.length > 0 && finalH[finalH.length-1].pos < height - 5) finalH.push({ pos: height, thickness: 0, start: 0, end: width });

    if (finalV.length === 0 || finalV[0].pos > 5) finalV.unshift({ pos: 0, thickness: 0, start: 0, end: height });
    if (finalV.length > 0 && finalV[finalV.length-1].pos < width - 5) finalV.push({ pos: width, thickness: 0, start: 0, end: height });

    onComplete({ horizontal: finalH, vertical: finalV });
  };
};
