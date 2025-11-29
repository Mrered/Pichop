
import { Grid, Rect, GridLine } from '../../../types';

export const performErase = (
    grid: Grid | null, 
    coords: {x: number, y: number}, 
    isLineMode: boolean,
    scale: number
): Grid | null => {
    if (!grid) return null;
    const newGrid = { ...grid };
    const threshold = 20 / scale; // User friendly threshold

    const processLines = (lines: GridLine[], type: 'h'|'v') => {
        const res: GridLine[] = [];
        let changed = false;

        for (const line of lines) {
            const main = type === 'h' ? coords.y : coords.x;
            const cross = type === 'h' ? coords.x : coords.y;

            // Check if cursor is near the line and within its span
            if (Math.abs(line.pos - main) < threshold && cross >= line.start && cross <= line.end) {
                if (isLineMode) {
                    // Delete whole line
                    changed = true;
                } else {
                    // Segment Delete: Need to find the nearest perpendicular lines that intersect this one
                    // to define the "segment" boundaries.
                    const perpLines = type === 'h' ? newGrid.vertical : newGrid.horizontal;
                    const crossings = perpLines
                        .filter(p => p.start <= line.pos && p.end >= line.pos)
                        .map(p => p.pos)
                        .sort((a,b)=>a-b);
                    
                    let segStart = line.start;
                    let segEnd = line.end;
                    
                    // Find the bracket around the cursor
                    for(const p of crossings) {
                        if (p <= cross) segStart = Math.max(segStart, p);
                        else if (p > cross) { segEnd = Math.min(segEnd, p); break; }
                    }

                    // Split the line into two parts (creating a gap)
                    if (segStart > line.start + 1) {
                        res.push({ ...line, end: segStart });
                    }
                    if (segEnd < line.end - 1) {
                        res.push({ ...line, start: segEnd });
                    }
                    changed = true;
                }
            } else {
                res.push(line);
            }
        }
        return changed ? res : lines;
    };

    const newH = processLines(newGrid.horizontal, 'h');
    const newV = processLines(newGrid.vertical, 'v');
    
    if (newH === newGrid.horizontal && newV === newGrid.vertical) return null; // No changes
    return { horizontal: newH, vertical: newV };
};

// Graph Traversal (Flood Fill) to find merged cells
export const getActualCells = (grid: Grid, w: number, h: number): Rect[] => {
    // 1. Build lattice points from all line positions
    const ys = Array.from(new Set(grid.horizontal.map(l => l.pos).concat([0, h]))).sort((a,b)=>a-b);
    const xs = Array.from(new Set(grid.vertical.map(l => l.pos).concat([0, w]))).sort((a,b)=>a-b);
    
    // De-dupe close lines
    const u_ys = ys.filter((v, i) => i === 0 || v > ys[i-1] + 1);
    const u_xs = xs.filter((v, i) => i === 0 || v > xs[i-1] + 1);

    const visited = new Set<string>();
    const cells: Rect[] = [];

    // 2. Iterate every "atomic" block in the lattice
    for (let r = 0; r < u_ys.length - 1; r++) {
        for (let c = 0; c < u_xs.length - 1; c++) {
            const key = `${c}-${r}`;
            if (visited.has(key)) continue;

            // 3. Start Flood Fill
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

                // Define 4 neighbors
                const neighbors = [
                    { dc: 1, dr: 0, type: 'v', pos: cx2, s: cy1, e: cy2 }, // Right
                    { dc: -1, dr: 0, type: 'v', pos: cx1, s: cy1, e: cy2 }, // Left
                    { dc: 0, dr: 1, type: 'h', pos: cy2, s: cx1, e: cx2 }, // Down
                    { dc: 0, dr: -1, type: 'h', pos: cy1, s: cx1, e: cx2 } // Up
                ];

                for (const n of neighbors) {
                    const nc = curr.c + n.dc;
                    const nr = curr.r + n.dr;
                    
                    if (nc < 0 || nc >= u_xs.length - 1 || nr < 0 || nr >= u_ys.length - 1) continue;
                    
                    const nKey = `${nc}-${nr}`;
                    if (visited.has(nKey)) continue;

                    // Check if there is a wall between current and neighbor
                    let hasWall = false;
                    const lines = n.type === 'v' ? grid.vertical : grid.horizontal;
                    
                    for(const line of lines) {
                        if (Math.abs(line.pos - n.pos) < 2) {
                            // Check if the wall segment actually covers the boundary
                            const overlapStart = Math.max(line.start, n.s);
                            const overlapEnd = Math.min(line.end, n.e);
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
