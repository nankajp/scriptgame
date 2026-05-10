// Simple grid-rail rotate puzzle
// Representation: each cell has up to 4 connectors N,E,S,W (bitmask 1,2,4,8)
// Rotating a cell rotates the bitmask by shifting bits.

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let rows = 5, cols = 10; // default (rows x cols)
let cellSize = 64;
let topMargin = cellSize; // space for outside power A (top)
let bottomMargin = cellSize; // space for outside power B (bottom)
let grid = []; // array of cells {conns:int, rot:int}
let powerA = {r:0,c:0}, powerB = {r:4,c:4};
let dragging = false;

// gameplay state
let timerId = null; let elapsed = 0; // seconds
let moves = 0; let running = false;

function init(newRows=5,newCols=5){
  rows=newRows; cols=newCols;
  // compute responsive cellSize to fit the container (#gameWrapper)
  const wrapper = document.getElementById('gameWrapper') || document.body;
  const availWidth = Math.max(200, wrapper.clientWidth - 20);
  const availHeight = Math.max(200, window.innerHeight - 200); // leave space for UI
  // update margins based on cell size later; for now compute candidate cellSize
  let maxCellByWidth = Math.floor(availWidth / cols);
  let maxCellByHeight = Math.floor((availHeight - topMargin - bottomMargin) / rows);
  cellSize = Math.max(40, Math.min(64, Math.min(maxCellByWidth, maxCellByHeight)));
  topMargin = cellSize; bottomMargin = cellSize;
  canvas.width = cols*cellSize + 2;
  canvas.height = topMargin + rows*cellSize + bottomMargin + 2;
  grid = [];
  // For demo, generate a random spanning-path between two nodes then add noise
  // We'll create a path first (simple DFS path) then for other cells random pieces
  let path = generatePath();
  const allCells = rows*cols;
  let maxSpecial = Math.floor(allCells * 0.01); // may be 0 for small grids
  // 1) assign path cells first - connect only to sequence neighbors (prev/next) to avoid extra adjacency
  for(let i=0;i<path.length;i++){
    const p = path[i]; const r=p.r, c=p.c; const idx = r*cols + c;
    let conns = 0;
    if(i>0){ const prev = path[i-1]; if(prev.r===r-1) conns|=1; if(prev.c===c+1) conns|=2; if(prev.r===r+1) conns|=4; if(prev.c===c-1) conns|=8; }
    if(i<path.length-1){ const next = path[i+1]; if(next.r===r-1) conns|=1; if(next.c===c+1) conns|=2; if(next.r===r+1) conns|=4; if(next.c===c-1) conns|=8; }
    grid[idx] = { conns: conns, rot: Math.floor(Math.random()*4), solutionRot: 0 };
  }
  // set endpoints to connect outside (may alter conns)
  const startCell = path[0];
  const endCell = path[path.length-1];
  if(startCell.r === 0){ grid[startCell.r*cols + startCell.c].conns |= 1; }
  if(endCell.r === rows-1){ grid[endCell.r*cols + endCell.c].conns |= 4; }
  // count specials among path cells
  let currentSpecial = 0;
  for(let i=0;i<rows*cols;i++){ const cell = grid[i]; if(!cell) continue; const bits = cell.conns; if(bits===15 || [7,11,13,14].includes(bits)) currentSpecial++; }
  // 2) prepare non-path indices
  const nonPathIndices = [];
  for(let r=0;r<rows;r++) for(let c=0;c<cols;c++){ let idx=r*cols+c; if(!grid[idx]) nonPathIndices.push(idx); }
  // determine how many special tiles we can still place
  const remainingSpecial = Math.max(0, maxSpecial - currentSpecial);
  // choose random indices to host special tiles (T or cross)
  const specialTiles = [1|2|4,2|4|8,4|8|1,8|1|2,1|2|4|8];
  // simple straight/elbow tiles. Removed vertical-only short piece (1|4) to avoid short one-segment drawings
  const simpleTiles = [1|2,2|4,4|8,8|1];
  const chosenSpecialIndices = new Set();
  if(remainingSpecial>0){
    // shuffle nonPathIndices and pick up to remainingSpecial
    const shuffled = nonPathIndices.slice();
    for(let i=shuffled.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]] }
    for(let k=0;k<Math.min(remainingSpecial, shuffled.length); k++){ chosenSpecialIndices.add(shuffled[k]); }
  }
  // fill non-path cells
  for(const idx of nonPathIndices){
    if(chosenSpecialIndices.has(idx)){
      const t = specialTiles[Math.floor(Math.random()*specialTiles.length)];
      grid[idx] = { conns: t, rot: Math.floor(Math.random()*4) };
    } else {
      const t = simpleTiles[Math.floor(Math.random()*simpleTiles.length)];
      grid[idx] = { conns: t, rot: Math.floor(Math.random()*4) };
    }
  }
  // set powers at ends of path: power nodes are outside the grid, A on top, B on bottom
  powerA = { c: path[0].c };
  powerB = { c: path[path.length-1].c };

  // Ensure starting position is NOT already solved: guarantee at least one path tile is not at its solution rotation
  const pathCells = path.map(p=>({r:p.r,c:p.c}));
  let allAtSolution = true;
  for(const p of pathCells){ if(grid[p.r*cols+p.c].rot !== grid[p.r*cols+p.c].solutionRot) { allAtSolution = false; break; } }
  if(allAtSolution){
    // pick a random path cell (prefer not endpoints) and scramble it
    let candidates = pathCells.filter(p=>!(p.r===path[0].r && p.c===path[0].c) && !(p.r===path[path.length-1].r && p.c===path[path.length-1].c));
    if(candidates.length===0) candidates = pathCells;
    const pick = candidates[Math.floor(Math.random()*candidates.length)];
    let idx2 = pick.r*cols+pick.c;
    grid[idx2].rot = (grid[idx2].solutionRot + 1) % 4;
  }
  // Remove any single-connector tiles (bitcount == 1) by converting them to an elbow
  // This avoids visually short one-segment tiles appearing.
  const elbows = [1|2,2|4,4|8,8|1];
  function bitCount(x){ let c=0; for(let i=0;i<4;i++) if(x&(1<<i)) c++; return c; }
  for(let i=0;i<rows*cols;i++){
    const cell = grid[i]; if(!cell) continue;
    const bits = cell.conns;
    if(bitCount(bits)===1){
      // prefer an elbow that keeps the existing direction
      let chosen = elbows.find(e => (e & bits) !== 0) || elbows[Math.floor(Math.random()*elbows.length)];
      grid[i].conns = chosen;
      grid[i].rot = Math.floor(Math.random()*4);
    }
  }
  draw();
}

// handle window resize to recalc sizes and redraw
let resizeTimeout = null;
function handleResize(){
  if(resizeTimeout) clearTimeout(resizeTimeout);
  // On mobile browsers the viewport height changes while scrolling (address bar show/hide).
  // Avoid regenerating the grid (which scrambles state) on such height-only changes.
  resizeTimeout = setTimeout(()=>{ resizeCanvasPreserveGrid(); if(running) updateHUD(); },120);
}
window.addEventListener('resize', handleResize);

// Resize the canvas and recompute cellSize but keep current grid/rotations intact.
function resizeCanvasPreserveGrid(){
  const wrapper = document.getElementById('gameWrapper') || document.body;
  const availWidth = Math.max(200, wrapper.clientWidth - 20);
  const availHeight = Math.max(200, window.innerHeight - 200);
  let maxCellByWidth = Math.floor(availWidth / cols);
  let maxCellByHeight = Math.floor((availHeight - topMargin - bottomMargin) / rows);
  const newCellSize = Math.max(40, Math.min(64, Math.min(maxCellByWidth, maxCellByHeight)));
  // if cellSize didn't change, only redraw
  if(newCellSize === cellSize){ draw(); return; }
  cellSize = newCellSize; topMargin = cellSize; bottomMargin = cellSize;
  canvas.width = cols*cellSize + 2;
  canvas.height = topMargin + rows*cellSize + bottomMargin + 2;
  draw();
}

function generatePath(){
  // generate a path that starts from top row (r=0) and reaches bottom row (r=rows-1)
  let visited = Array(rows).fill(0).map(()=>Array(cols).fill(false));
  let path = [];
  // start at random column on top edge
  let r = 0;
  let c = Math.floor(Math.random()*cols);
  path.push({r,c}); visited[r][c]=true;
  // simple randomized DFS/walk until we reach bottom edge or hit length
  let attempts = 0; let maxSteps = rows*cols*2;
  while((r !== rows-1) && attempts++ < maxSteps){
    let dirs = shuffle([[0,-1],[1,0],[0,1],[-1,0]]); // left, down, right, up (favor down maybe)
    let moved=false;
    for(let d of dirs){
      let nr=r+d[0], nc=c+d[1];
      if(nr>=0 && nr<rows && nc>=0 && nc<cols && !visited[nr][nc]){
        visited[nr][nc]=true; path.push({r:nr,c:nc}); r=nr; c=nc; moved=true; break;
      }
    }
    if(!moved){
      // backtrack to a previous cell that has unvisited neighbors
      let found=false;
      for(let i=path.length-1;i>=0;i--){
        let pr=path[i].r, pc=path[i].c;
        let nbrs = [[0,-1],[1,0],[0,1],[-1,0]];
        for(let d of nbrs){ let nr=pr+d[0], nc=pc+d[1]; if(nr>=0&&nr<rows&&nc>=0&&nc<cols&&!visited[nr][nc]){ r=pr; c=pc; found=true; break; } }
        if(found) break;
      }
      if(!found) break;
    }
  }
  // if we didn't reach bottom edge, force a terminal at bottom row by carving a path vertically from last column
  if(path[path.length-1].r !== rows-1){
    let pc = path[path.length-1].c;
    for(let rr=path[path.length-1].r+1; rr<rows; rr++){
      if(!visited[rr][pc]){ visited[rr][pc]=true; path.push({r:rr,c:pc}); }
    }
  }
  return path;
}

function pathNeighbors(r,c,path){
  let res=[];
  for(let p of path){
    if(Math.abs(p.r-r)+Math.abs(p.c-c)===1) res.push(p);
  }
  return res;
}

function shuffle(a){
  for(let i=a.length-1;i>0;i--){let j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]}
  return a;
}

function draw(){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle='#071126'; ctx.fillRect(0,0,canvas.width,canvas.height);
  // draw grid cells
  for(let r=0;r<rows;r++){
    for(let c=0;c<cols;c++){
      let idx=r*cols+c; let cell=grid[idx];
  let x = c*cellSize+1, y = topMargin + r*cellSize+1;
      // background
      ctx.fillStyle='rgba(255,255,255,0.02)'; ctx.fillRect(x,y,cellSize-2,cellSize-2);
      // draw connectors
      drawCell(x,y,cell);
      // draw power nodes
      // power nodes themselves are outside; draw connectors to them by drawing the power outside after the grid loop
    }
  }
  // draw power A on the top outside
  if(powerA && typeof powerA.c === 'number'){
    const x = powerA.c*cellSize + cellSize/2; const y = topMargin/2;
    drawPower(x,y-1,'A');
  }
  // draw power B on the bottom outside
  if(powerB && typeof powerB.c === 'number'){
    const x = powerB.c*cellSize + cellSize/2; const y = topMargin + rows*cellSize + bottomMargin/2;
    drawPower(x,y-1,'B');
  }
}

function drawPower(x,y,label){
  const pr = Math.max(8, Math.floor(cellSize * 0.14));
  ctx.beginPath(); ctx.fillStyle='#ffcc33'; ctx.arc(x,y,pr,0,Math.PI*2); ctx.fill();
  ctx.fillStyle='#111'; ctx.font = Math.max(10, Math.floor(cellSize * 0.18)) + 'px sans-serif'; ctx.fillText(label,x - (pr/2), y + (pr/2));
}

function drawCell(x,y,cell){
  // compute rotated connectors
  let conns = rotateMask(cell.conns, cell.rot);
  let cx=x+cellSize/2, cy=y+cellSize/2;
  let lw = Math.max(4, Math.floor(cellSize * 0.12));
  let half = Math.max(12, Math.floor(cellSize * 0.45));
  ctx.strokeStyle='#ddd'; ctx.lineWidth=lw; ctx.lineCap='round';
  // highlight connected path during win show - we'll handle later
  // N
  if(conns & 1){ ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(cx,cy-half); ctx.stroke(); }
  // E
  if(conns & 2){ ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(cx+half,cy); ctx.stroke(); }
  // S
  if(conns & 4){ ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(cx,cy+half); ctx.stroke(); }
  // W
  if(conns & 8){ ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(cx-half,cy); ctx.stroke(); }
}

function rotateMask(mask,rot){
  // rot in 0..3  rotate 90deg clockwise per step
  rot = ((rot%4)+4)%4;
  for(let i=0;i<rot;i++) mask = ((mask<<1)&0xF) | ((mask>>3)&1);
  return mask;
}

// Helpers to correctly map pointer/touch events to canvas coordinates even when CSS scaled
function getCanvasPoint(clientX, clientY){
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const x = (clientX - rect.left) * scaleX;
  const y = (clientY - rect.top) * scaleY;
  return { x, y };
}

let touchScrolling = false; // set true briefly while a touchmove happens to prevent accidental taps
let lastTouchTime = 0; // timestamp (ms) of last touch interaction to suppress the synthetic click

function handlePointerActivation(clientX, clientY){
  const p = getCanvasPoint(clientX, clientY);
  const c = Math.floor(p.x / cellSize);
  const r = Math.floor((p.y - topMargin) / cellSize);
  if(r<0||r>=rows||c<0||c>=cols) return;
  if(!running) return; // ignore until started
  // If a touch scroll just happened, ignore the tap (prevents misfires after scrolling)
  if(touchScrolling && (Date.now() - lastTouchTime) < 350) return;
  let idx=r*cols+c; grid[idx].rot = (grid[idx].rot+1)%4; moves++; updateHUD(); draw();
  if(checkWin()){
    stopGame();
    setTimeout(()=>{ alert('Cleared! Time: '+formatTime(elapsed)+" Moves: "+moves); },50);
  }
}

canvas.addEventListener('click', e => {
  // Ignore the synthetic click generated after a real touchend if it happens soon after.
  if(Date.now() - lastTouchTime < 400) { return; }
  handlePointerActivation(e.clientX, e.clientY);
});

// touch support: use touchend to detect taps, touchmove to mark scrolling activity
canvas.addEventListener('touchstart', e=>{ touchScrolling=false; }, { passive:true });
canvas.addEventListener('touchmove', e=>{ touchScrolling = true; lastTouchTime = Date.now(); }, { passive:true });
canvas.addEventListener('touchend', e=>{
  // Prevent the browser from synthesizing a following click event and mark touch time
  if(e && typeof e.preventDefault === 'function') e.preventDefault();
  if(e.changedTouches && e.changedTouches.length>0){
    const t = e.changedTouches[0];
    handlePointerActivation(t.clientX, t.clientY);
  }
  lastTouchTime = Date.now();
}, { passive:false });

function checkWin(){
  // Connect from the top-side external power A into cell (0, powerA.c) via North connector,
  // and expect to reach cell (rows-1, powerB.c) which connects south to external power B.
  if(!powerA || !powerB) return false;
  const startR = 0, startC = powerA.c;
  const endR = rows-1, endC = powerB.c;
  // quick bounds
  if(startR<0||startR>=rows||endR<0||endR>=rows) return false;
  const visited = Array(rows).fill(0).map(()=>Array(cols).fill(false));
  function dfs(r,c,fromDir){
    if(r<0||r>=rows||c<0||c>=cols) return false;
    if(visited[r][c]) return false; visited[r][c]=true;
    let cell = grid[r*cols+c]; let conns = rotateMask(cell.conns,cell.rot);
    // if we came from a direction, ensure there's a connector back
    if(fromDir!==null){
      const need = (1<<fromDir);
      if((conns & need)===0) return false;
    }
    // if at required end cell, ensure it has connector to south (to external B)
    if(r===endR && c===endC){
      if((conns & (1<<2))!==0) return true; // south
      return false;
    }
    // explore outgoing directions
    const dirs = [ [-1,0,0],[0,1,1],[1,0,2],[0,-1,3] ];
    for(let [dr,dc,dir] of dirs){
      if(conns & (1<<dir)){
        let nr=r+dr,nc=c+dc;
        // neighbor must have matching connector
        if(nr<0||nr>=rows||nc<0||nc>=cols) continue;
        let ncell = grid[nr*cols+nc];
        let ncon = rotateMask(ncell.conns,ncell.rot);
        const opposite = 1<<((dir+2)%4);
        if((ncon & opposite)===0) continue;
        if(dfs(nr,nc,(dir+2)%4)) return true;
      }
    }
    return false;
  }
  // Starting cell must have connector to north to receive power from outside A
  let startCellCon = rotateMask(grid[startR*cols+startC].conns, grid[startR*cols+startC].rot);
  if((startCellCon & (1<<0))===0) return false; // north
  return dfs(startR,startC,null);
}

function updateHUD(){
  try{
    if(window.game && window.game.hud){
      window.game.hud.movesEl.textContent = String(moves);
      window.game.hud.timerEl.textContent = formatTime(elapsed);
    }
  }catch(e){ }
}

function formatTime(sec){
  sec = Math.max(0, Math.floor(sec));
  const m = Math.floor(sec/60); const s = sec%60; return m+':'+(s<10?('0'+s):s);
}

function startTimer(){
  if(timerId) clearInterval(timerId);
  timerId = setInterval(()=>{ elapsed++; updateHUD(); },1000);
}

function stopTimer(){ if(timerId){ clearInterval(timerId); timerId=null; } }

function startGame(){
  // reset counters and start
  elapsed = 0; moves = 0; running = true; updateHUD(); startTimer();
}

function stopGame(){ running = false; stopTimer(); updateHUD(); }

// Controls
function reset(){ stopGame(); init(rows,cols); }
function setSize(r,c){ rows=r; cols=c; init(r,c); }

// expose for HTML (include start/stop and HUD placeholder)
window.game = { init, reset, setSize, startGame, stopGame, updateHUD, hud: null };

// initialize default (generate but don't start)
// initialize default (generate but don't start)
init(5,10);
