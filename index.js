/**
 * @typedef {'R'|'G'|'B'|'Y'} SuitCode
 */

/**
 * @typedef {{ id: string; suit: SuitCode; rank: number; faceUp: boolean }} CardLike
 */

/**
 * @typedef {{ fromCol: number; fromIndex: number; toCol: number; card: CardLike; kind: 'move'|'deal' }} MoveInfo
 */

const SAVE_KEY = 'scorpionProgressV1';
const LEVEL_RECORDS_KEY = 'scorpionLevelRecordsV1';
const PLAYED_GAMES_KEY = 'scorpionPlayedGamesV1';
const PLAYABLE_LEVELS_KEY = 'scorpionPlayableLevelsV1';
const LEVEL_PROGRESS_KEY = 'scorpionLevelProgressV1';
const BUILD_VERSION_KEY = 'scorpionBuildVersionV1';
const NEW_LEVEL_SOLVER_ATTEMPTS = 10000;

// Playable levels are stored as seed numbers. Start empty and build progression per player.
const CURATED_LEVELS = [1779527854470, 1779835606928, 1779008718619, 1779049532341, 1779455479256, 1779766978104, 1779140770030, 1779569185155, 1779271112712, 1779121176396];

// Seeds confirmed impossible.
// Auto-play will never pick these seeds for new games.
const BLACKLISTED_SEEDS = [];

class Card {
  /** @param {string} id @param {SuitCode} suit @param {number} rank @param {boolean} faceUp */
  constructor(id, suit, rank, faceUp = true) {
    this.id = id;
    this.suit = suit;
    this.rank = rank;
    this.faceUp = faceUp;
  }

  clone() {
    return new Card(this.id, this.suit, this.rank, this.faceUp);
  }
}

class RNG {
  /** @param {number} seed */
  constructor(seed) {
    this.state = seed >>> 0;
  }

  next() {
    this.state = (1664525 * this.state + 1013904223) >>> 0;
    return this.state / 4294967296;
  }

  /** @template T @param {T[]} arr */
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }
}

class BoardState {
  constructor() {
    /** @type {Card[][]} */
    this.columns = [[], [], [], [], [], [], []];
    /** @type {Card[]} */
    this.stock = [];
    this.completed = 0;
  }

  clone() {
    const copy = new BoardState();
    copy.columns = this.columns.map((col) => col.map((c) => c.clone()));
    copy.stock = this.stock.map((c) => c.clone());
    copy.completed = this.completed;
    return copy;
  }
}

class ScorpionRules {
  static SUITS = {
    R: { emoji: '🐞', base: '#e57b7b', accent: '#b93b3b' },
    G: { emoji: '🐸', base: '#78c88b', accent: '#2f8548' },
    B: { emoji: '🐟', base: '#6ab0e2', accent: '#2f6eb2' },
    Y: { emoji: '🐝', base: '#e5cb6c', accent: '#9f7e1d' },
  };

  /** @param {Card} card */
  static cardText(card) {
    return `${card.rank}${this.SUITS[card.suit].emoji}`;
  }

  /** @param {Card[][]} columns @param {number} fromCol @param {number} fromIndex @param {number} toCol */
  static canMove(columns, fromCol, fromIndex, toCol) {
    if (fromCol === toCol) return false;
    const source = columns[fromCol];
    const target = columns[toCol];
    if (!source || !target || fromIndex < 0 || fromIndex >= source.length) return false;

    const card = source[fromIndex];
    if (!card.faceUp) return false;

    // Disallow moving a King from the top of a root column to any other root column
    if (card.rank === 13 && fromIndex === 0) {
      // Only allow moving to an empty column if it's not a root-to-root move
      // (i.e., only if either fromCol or toCol is not a root column)
      // In Scorpion, all columns are root columns, so block all root-to-root King moves
      return false;
    }

    if (target.length === 0) {
      return card.rank === 13;
    }

    const top = target[target.length - 1];
    return top.faceUp && top.suit === card.suit && top.rank === card.rank + 1;
  }

  /** @param {Card[][]} columns @returns {MoveInfo[]} */
  static listMoves(columns) {
    /** @type {MoveInfo[]} */
    const moves = [];
    for (let fromCol = 0; fromCol < columns.length; fromCol += 1) {
      const source = columns[fromCol];
      for (let fromIndex = 0; fromIndex < source.length; fromIndex += 1) {
        if (!source[fromIndex].faceUp) continue;
        for (let toCol = 0; toCol < columns.length; toCol += 1) {
          if (this.canMove(columns, fromCol, fromIndex, toCol)) {
            moves.push({ fromCol, fromIndex, toCol, card: source[fromIndex], kind: 'move' });
          }
        }
      }
    }
    return moves;
  }

  /** @param {BoardState} state */
  static removeCompletedRuns(state) {
    let removed = 0;
    for (let col = 0; col < state.columns.length; col += 1) {
      const pile = state.columns[col];
      if (pile.length < 13) continue;

      const start = pile.length - 13;
      const run = pile.slice(start);
      const suit = run[0].suit;
      let ok = run[0].rank === 13;
      for (let i = 1; i < 13 && ok; i += 1) {
        ok = run[i].suit === suit && run[i].rank === 13 - i;
      }

      if (ok) {
        pile.splice(start, 13);
        state.completed += 1;
        removed += 1;
        if (pile.length > 0 && !pile[pile.length - 1].faceUp) {
          pile[pile.length - 1].faceUp = true;
        }
      }
    }

    return removed;
  }
}

class GameEngine {
  constructor() {
    /** @type {BoardState} */
    this.state = new BoardState();
    /** @type {BoardState} */
    this.initialState = new BoardState();
    /** @type {BoardState[]} */
    this.history = [];
    this.moves = 0;
    this.score = 0;
    this.currentSeed = Date.now();
    this.startedAt = Date.now();
    this.gameState = 'playing';
  }

  countFaceDownTableau() {
    let hidden = 0;
    for (const col of this.state.columns) {
      for (const card of col) {
        if (!card.faceUp) hidden += 1;
      }
    }
    return hidden;
  }

  countEmptyColumns() {
    return this.state.columns.filter((col) => col.length === 0).length;
  }

  createShuffledDeck(seed = Date.now()) {
    const deck = [];
    const suits = /** @type {SuitCode[]} */ (['R', 'G', 'B', 'Y']);
    for (const suit of suits) {
      for (let rank = 1; rank <= 13; rank += 1) {
        deck.push(new Card(`${suit}${rank}`, suit, rank, true));
      }
    }
    const rng = new RNG(seed);
    rng.shuffle(deck);
    return deck;
  }

  /** @param {number} seed */
  createClassicState(seed) {
    const deck = this.createShuffledDeck(seed);
    const state = new BoardState();

    for (let col = 0; col < 7; col += 1) {
      for (let i = 0; i < 7; i += 1) {
        const card = deck.shift();
        if (!card) continue;
        if (col < 4 && i < 3) card.faceUp = false;
        state.columns[col].push(card);
      }
    }

    state.stock = deck.slice(0, 3).map((card) => {
      card.faceUp = false;
      return card;
    });

    return state;
  }

  syncGameState() {
    if (this.state.completed >= 4) {
      this.gameState = 'won';
      return;
    }
    const hasMoves = ScorpionRules.listMoves(this.state.columns).length > 0;
    const canDeal = this.state.stock.length >= 3;
    this.gameState = hasMoves || canDeal ? 'playing' : 'stuck';
  }

  startSingle(seed = Date.now()) {
    const numericSeed = Number(seed);
    this.currentSeed = Number.isFinite(numericSeed) ? numericSeed : Date.now();
    this.state = this.createClassicState(this.currentSeed);
    this.initialState = this.state.clone();
    this.history = [];
    this.moves = 0;
    this.score = 0;
    this.startedAt = Date.now();
    this.gameState = 'playing';
  }

  resetBoard() {
    this.state = this.initialState.clone();
    this.history = [];
    this.moves = 0;
    this.score = 0;
    this.startedAt = Date.now();
    this.gameState = 'playing';
  }

  pushHistory() {
    this.history.push({
      state: this.state.clone(),
      score: this.score,
    });
  }

  /** @param {number} fromCol @param {number} fromIndex @param {number} toCol */
  moveStack(fromCol, fromIndex, toCol) {
    if (!ScorpionRules.canMove(this.state.columns, fromCol, fromIndex, toCol)) return false;

    const beforeHidden = this.countFaceDownTableau();
    const beforeEmpty = this.countEmptyColumns();

    this.pushHistory();
    const source = this.state.columns[fromCol];
    const moved = source.splice(fromIndex);
    this.state.columns[toCol].push(...moved);

    if (source.length > 0 && !source[source.length - 1].faceUp) {
      source[source.length - 1].faceUp = true;
    }

    this.moves += 1;
    const removedRuns = ScorpionRules.removeCompletedRuns(this.state);
    const revealed = Math.max(0, beforeHidden - this.countFaceDownTableau());
    const emptiesMade = Math.max(0, this.countEmptyColumns() - beforeEmpty);

    this.score += 12;
    this.score += revealed * 55;
    this.score += emptiesMade * 35;
    this.score += removedRuns * 300;

    this.syncGameState();
    return true;
  }

  dealStock() {
    if (this.state.stock.length < 3) return false;

    const beforeHidden = this.countFaceDownTableau();

    this.pushHistory();
    for (let i = 0; i < 3; i += 1) {
      const card = this.state.stock.shift();
      if (card) {
        card.faceUp = true;
        this.state.columns[i].push(card);
      }
    }

    this.moves += 1;
    const removedRuns = ScorpionRules.removeCompletedRuns(this.state);
    const revealed = Math.max(0, beforeHidden - this.countFaceDownTableau());

    this.score += 5;
    this.score += revealed * 55;
    this.score += removedRuns * 300;

    this.syncGameState();
    return true;
  }

  undo() {
    if (this.history.length === 0) return false;
    const snap = this.history.pop();
    this.state = snap.state;
    this.score = Math.max(0, snap.score - 12);
    this.moves += 1;
    this.syncGameState();
    return true;
  }

  elapsedSeconds() {
    return Math.floor((Date.now() - this.startedAt) / 1000);
  }

  calculateSequentialScore() {
    return this.score;
  }
}

class CanvasBoard {
  /** @param {HTMLCanvasElement} canvas @param {GameEngine} engine @param {() => void} onStateChange */
  constructor(canvas, engine, onStateChange) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.engine = engine;
    this.onStateChange = onStateChange;

    this.dpr = window.devicePixelRatio || 1;
    this.width = 0;
    this.height = 0;

    this.cardW = 120;
    this.cardH = 180;
    this.stackStep = 32;
    this.baseStackStep = 32;
    this.stockW = 56;
    this.isPortraitMobile = false;
    this.topMargin = 24;
    this.bottomReserved = 90;
    this.colGap = 12;
    this.leftPad = 12;

    /** @type {{x:number,y:number,w:number,h:number}[]} */
    this.columnRects = [];
    this.stockRect = { x: 0, y: 0, w: 0, h: 0 };

    this.cardPattern = this.createMattePattern();
    this.hiddenPattern = this.createHiddenPattern();

    this.hovered = null;
    this.dragging = null;
    this.pointer = { x: 0, y: 0 };
    this.dropCol = null;
    this.activePointerId = null;
    this.autoLocked = false;
    this.autoAnim = null;

    this.attach();
    this.resize();
  }

  createMattePattern() {
    const c = document.createElement('canvas');
    c.width = 26;
    c.height = 26;
    const p = c.getContext('2d');
    p.fillStyle = 'rgba(255,255,255,0.18)';
    p.fillRect(0, 0, 26, 26);
    p.fillStyle = 'rgba(255,255,255,0.1)';
    p.fillRect(0, 0, 13, 13);
    p.fillRect(13, 13, 13, 13);
    p.strokeStyle = 'rgba(255,255,255,0.14)';
    p.lineWidth = 1;
    p.beginPath();
    p.moveTo(0, 13);
    p.lineTo(26, 13);
    p.moveTo(13, 0);
    p.lineTo(13, 26);
    p.stroke();
    return this.ctx.createPattern(c, 'repeat');
  }

  createHiddenPattern() {
    const c = document.createElement('canvas');
    c.width = 32;
    c.height = 32;
    const p = c.getContext('2d');
    p.fillStyle = '#c6e9ef';
    p.fillRect(0, 0, 32, 32);
    p.fillStyle = 'rgba(255,255,255,0.32)';
    p.beginPath();
    p.arc(8, 8, 6, 0, Math.PI * 2);
    p.arc(24, 24, 6, 0, Math.PI * 2);
    p.fill();
    p.strokeStyle = 'rgba(114, 170, 180, 0.28)';
    p.beginPath();
    p.moveTo(0, 0);
    p.lineTo(32, 32);
    p.moveTo(32, 0);
    p.lineTo(0, 32);
    p.stroke();
    return this.ctx.createPattern(c, 'repeat');
  }

  attach() {
    window.addEventListener('resize', () => this.resize());

    this.canvas.addEventListener('pointermove', (event) => {
      if (this.autoLocked) return;
      this.pointer = this.getCanvasPos(event);
      this.updateHover();
      if (this.dragging) this.updateDropTarget();
      this.draw();
    });

    this.canvas.addEventListener('pointerdown', (event) => {
      if (this.autoLocked) return;
      const pos = this.getCanvasPos(event);
      this.pointer = pos;
      this.activePointerId = event.pointerId;
      this.canvas.setPointerCapture(event.pointerId);
      if (this.tryStockClick(pos)) return;
      this.startDrag(pos);
      this.draw();
    });

    this.canvas.addEventListener('pointerup', (event) => {
      if (this.autoLocked) return;
      this.finishDrag();
      if (this.activePointerId !== null) {
        this.canvas.releasePointerCapture(this.activePointerId);
        this.activePointerId = null;
      }
      this.draw();
    });

    this.canvas.addEventListener('pointerleave', () => {
      if (this.autoLocked) return;
      this.hovered = null;
      if (this.dragging) {
        this.finishDrag();
      }
      if (this.activePointerId !== null) {
        this.canvas.releasePointerCapture(this.activePointerId);
        this.activePointerId = null;
      }
      this.draw();
    });
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.width = Math.max(320, Math.floor(rect.width));
    this.height = Math.max(460, Math.floor(rect.height));

    this.canvas.width = Math.floor(this.width * this.dpr);
    this.canvas.height = Math.floor(this.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const totalCols = 8;
    this.isPortraitMobile = this.height > this.width && this.width <= 760;

    this.leftPad = Math.max(6, Math.floor(this.width * 0.015));
    this.colGap = Math.max(4, Math.floor(this.width * 0.012));
    this.bottomReserved = Math.max(this.isPortraitMobile ? 92 : 82, Math.floor(this.height * 0.14));
    this.topMargin = this.isPortraitMobile ? 14 : 24;

    const free = this.width - this.leftPad * 2;
    this.stockW = Math.max(28, Math.floor(free * (this.isPortraitMobile ? 0.075 : 0.09)));
    const w = Math.min(
      128,
      Math.max(36, Math.floor((free - this.stockW - this.colGap * (totalCols - 1)) / 7)),
    );
    this.cardW = w;
    this.cardH = w * (this.isPortraitMobile ? 1.42 : 1.5);
    this.baseStackStep = Math.max(this.isPortraitMobile ? 16 : 8, Math.floor(this.cardH * 0.2));
    this.stackStep = this.baseStackStep;

    this.computeRects();
    this.draw();
  }

  computeRects() {
    this.columnRects = [];
    let x = this.leftPad;

    this.stockRect = { x, y: this.topMargin, w: this.stockW, h: this.cardH };
    x += this.stockW + this.colGap;

    for (let i = 0; i < 7; i += 1) {
      this.columnRects.push({
        x,
        y: this.topMargin,
        w: this.cardW,
        h: this.height - this.topMargin - this.bottomReserved,
      });
      x += this.cardW + this.colGap;
    }
  }

  getDynamicStackStep() {
    const maxLen = Math.max(...this.engine.state.columns.map((c) => c.length), 1);
    if (maxLen <= 1) return this.baseStackStep;

    const available = Math.max(40, this.height - this.topMargin - this.bottomReserved - this.cardH - 6);
    const fitted = Math.floor(available / (maxLen - 1));
    const minStep = this.isPortraitMobile ? 16 : 8;
    return Math.max(minStep, Math.min(this.baseStackStep, fitted));
  }

  /** @param {PointerEvent} event */
  getCanvasPos(event) {
    const r = this.canvas.getBoundingClientRect();
    return { x: event.clientX - r.left, y: event.clientY - r.top };
  }

  /** @param {{x:number,y:number}} pos */
  tryStockClick(pos) {
    if (!this.pointInRect(pos, this.stockRect)) return false;
    if (this.engine.dealStock()) {
      this.dragging = null;
      this.dropCol = null;
      this.onStateChange();
      this.updateHover();
      this.draw();
    }
    return true;
  }

  updateHover() {
    this.hovered = this.pickCardAt(this.pointer);
  }

  updateDropTarget() {
    this.dropCol = null;
    if (!this.dragging) return;

    for (let col = 0; col < this.columnRects.length; col += 1) {
      if (this.pointInRect(this.pointer, this.columnRects[col])) {
        if (
          ScorpionRules.canMove(
            this.engine.state.columns,
            this.dragging.fromCol,
            this.dragging.fromIndex,
            col,
          )
        ) {
          this.dropCol = col;
        }
        return;
      }
    }
  }

  /** @param {{x:number,y:number}} pos */
  pickCardAt(pos) {
    for (let col = 0; col < this.engine.state.columns.length; col += 1) {
      const cards = this.engine.state.columns[col];
      for (let i = cards.length - 1; i >= 0; i -= 1) {
        const rect = this.getCardRect(col, i);
        if (this.pointInRect(pos, rect)) {
          return { col, index: i };
        }
      }
    }
    return null;
  }

  /** @param {{x:number,y:number}} pos */
  startDrag(pos) {
    const hit = this.pickCardAt(pos);
    if (!hit) {
      this.dragging = null;
      return;
    }

    const cards = this.engine.state.columns[hit.col];
    const card = cards[hit.index];
    if (!card || !card.faceUp) {
      this.dragging = null;
      return;
    }

    const rect = this.getCardRect(hit.col, hit.index);
    const stack = cards.slice(hit.index).map((c) => c.clone());
    this.dragging = {
      fromCol: hit.col,
      fromIndex: hit.index,
      stack,
      offsetX: pos.x - rect.x,
      offsetY: pos.y - rect.y,
    };

    this.updateDropTarget();
  }

  finishDrag() {
    if (!this.dragging) return;

    if (this.dropCol !== null) {
      this.engine.moveStack(this.dragging.fromCol, this.dragging.fromIndex, this.dropCol);
      this.onStateChange();
    }

    this.dragging = null;
    this.dropCol = null;
    this.updateHover();
  }

  /** @param {{x:number,y:number}} point @param {{x:number,y:number,w:number,h:number}} rect */
  pointInRect(point, rect) {
    return (
      point.x >= rect.x &&
      point.x <= rect.x + rect.w &&
      point.y >= rect.y &&
      point.y <= rect.y + rect.h
    );
  }

  /** @param {number} col @param {number} index */
  getCardRect(col, index) {
    const step = this.getDynamicStackStep();
    const base = this.columnRects[col];
    const y = base.y + index * step;
    return { x: base.x, y, w: this.cardW, h: this.cardH };
  }

  drawTable() {
    const g = this.ctx.createLinearGradient(0, 0, 0, this.height);
    g.addColorStop(0, '#95d2cf');
    g.addColorStop(0.55, '#79c5a5');
    g.addColorStop(1, '#67b690');
    this.ctx.fillStyle = g;
    this.ctx.fillRect(0, 0, this.width, this.height);

    this.ctx.fillStyle = 'rgba(255,255,255,0.12)';
    for (let i = 0; i < 6; i += 1) {
      this.ctx.beginPath();
      this.ctx.ellipse(90 + i * 170, 60 + (i % 2) * 45, 78, 36, 0.2, 0, Math.PI * 2);
      this.ctx.fill();
    }
  }

  /** @param {Card} card @param {number} x @param {number} y @param {boolean} isTop @param {string | null} borderColor */
  drawCard(card, x, y, isTop, borderColor = null) {
    const suitStyle = ScorpionRules.SUITS[card.suit];
    const r = 14;

    this.ctx.save();
    this.roundRect(x, y, this.cardW, this.cardH, r);
    this.ctx.clip();

    if (!card.faceUp) {
      this.ctx.fillStyle = this.hiddenPattern;
      this.ctx.fillRect(x, y, this.cardW, this.cardH);
    } else {
      const bg = this.ctx.createRadialGradient(
        x + this.cardW * 0.35,
        y + this.cardH * 0.25,
        20,
        x + this.cardW * 0.5,
        y + this.cardH * 0.9,
        this.cardH,
      );
      bg.addColorStop(0, '#fff7ef');
      bg.addColorStop(1, suitStyle.base);
      this.ctx.fillStyle = bg;
      this.ctx.fillRect(x, y, this.cardW, this.cardH);

      this.ctx.fillStyle = this.cardPattern;
      this.ctx.fillRect(x, y, this.cardW, this.cardH);

      const fontSize = Math.max(this.isPortraitMobile ? 10 : 12, Math.floor(this.cardW * 0.24));
      this.ctx.font = `${fontSize}px "Baloo 2"`;
      this.ctx.fillStyle = '#000000';
      this.ctx.shadowColor = 'rgba(255,255,255,0.92)';
      this.ctx.shadowBlur = 6;
      this.ctx.textAlign = 'left';
      this.ctx.textBaseline = 'top';
      this.ctx.fillText(ScorpionRules.cardText(card), x + 6, y + 6);
      this.ctx.shadowBlur = 0;

      if (isTop) {
        this.drawEmojiBody(card, x, y);
      }
    }

    this.ctx.restore();

    this.ctx.lineWidth = borderColor ? 4 : 2;
    this.ctx.strokeStyle = borderColor || 'rgba(255,255,255,0.88)';
    this.roundRect(x, y, this.cardW, this.cardH, r);
    this.ctx.stroke();
  }

  /** @param {Card} card @param {number} x @param {number} y */
  drawEmojiBody(card, x, y) {
    const emoji = ScorpionRules.SUITS[card.suit].emoji;
    const count = card.rank;

    if (this.isPortraitMobile) {
      const size = Math.max(18, Math.floor(this.cardW * 0.56));
      this.ctx.font = `${size}px "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'middle';
      this.ctx.fillText(emoji, x + this.cardW / 2, y + this.cardH * 0.58);
      return;
    }

    const rows = Math.ceil(Math.sqrt(count));
    const cols = Math.ceil(count / rows);
    const areaTop = y + 44;
    const areaH = this.cardH - 54;
    const cellW = this.cardW / cols;
    const cellH = areaH / rows;
    const size = Math.max(14, Math.min(22, Math.floor(Math.min(cellW, cellH) * 0.68)));

    this.ctx.font = `${size}px "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';

    for (let i = 0; i < count; i += 1) {
      const row = Math.floor(i / cols);
      const col = i % cols;
      const px = x + col * cellW + cellW / 2;
      const py = areaTop + row * cellH + cellH / 2;
      this.ctx.fillText(emoji, px, py);
    }
  }

  /** @param {number} x @param {number} y @param {number} w @param {number} h @param {number} r */
  roundRect(x, y, w, h, r) {
    this.ctx.beginPath();
    this.ctx.moveTo(x + r, y);
    this.ctx.arcTo(x + w, y, x + w, y + h, r);
    this.ctx.arcTo(x + w, y + h, x, y + h, r);
    this.ctx.arcTo(x, y + h, x, y, r);
    this.ctx.arcTo(x, y, x + w, y, r);
    this.ctx.closePath();
  }

  drawStockArea() {
    this.ctx.save();
    this.roundRect(
      this.stockRect.x,
      this.stockRect.y,
      this.stockRect.w,
      this.stockRect.h,
      14,
    );
    this.ctx.fillStyle = 'rgba(255,255,255,0.16)';
    this.ctx.fill();
    this.ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    this.ctx.stroke();

    if (this.engine.state.stock.length > 0) {
      this.ctx.fillStyle = 'rgba(255,255,255,0.88)';
      this.ctx.font = `${Math.max(14, Math.floor(this.cardW * 0.16))}px "Baloo 2"`;
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'middle';
      this.ctx.fillText(
        `${this.engine.state.stock.length} left`,
        this.stockRect.x + this.stockRect.w / 2,
        this.stockRect.y + this.stockRect.h / 2,
      );
    }

    this.ctx.fillStyle = 'rgba(255,255,255,0.86)';
    this.ctx.font = `${Math.max(12, Math.floor(this.cardW * 0.13))}px "Baloo 2"`;
    this.ctx.textAlign = 'center';
    this.ctx.fillText(
      'C0',
      this.stockRect.x + this.stockRect.w / 2,
      this.stockRect.y + this.stockRect.h + 16,
    );
    this.ctx.restore();
  }

  drawColumns() {
    for (let col = 0; col < this.engine.state.columns.length; col += 1) {
      const rect = this.columnRects[col];

      this.ctx.save();
      this.roundRect(rect.x, rect.y, rect.w, rect.h, 14);
      this.ctx.fillStyle =
        this.dropCol === col ? 'rgba(76, 187, 109, 0.3)' : 'rgba(255,255,255,0.08)';
      this.ctx.fill();
      this.ctx.restore();

      const cards = this.engine.state.columns[col];
      cards.forEach((card, index) => {
        if (this.dragging && this.dragging.fromCol === col && index >= this.dragging.fromIndex) {
          return;
        }

        if (
          !this.dragging &&
          this.hovered &&
          this.hovered.col === col &&
          index >= this.hovered.index
        ) {
          return;
        }

        const isTop = index === cards.length - 1;
        const cRect = this.getCardRect(col, index);
        let border = null;

        if (!this.dragging && this.hovered && this.hovered.col === col && this.hovered.index === index) {
          border = 'rgba(255,255,255,0.95)';
        }

        this.drawCard(card, cRect.x, cRect.y, isTop, border);
      });

      if (!this.dragging && this.hovered && this.hovered.col === col) {
        this.drawHoveredStackOverlay(col, this.hovered.index);
      }
    }
  }

  /** @param {number} col @param {number} fromIndex */
  drawHoveredStackOverlay(col, fromIndex) {
    const cards = this.engine.state.columns[col];
    if (!cards || fromIndex < 0 || fromIndex >= cards.length) return;

    const baseRect = this.getCardRect(col, fromIndex);
    const step = this.getDynamicStackStep();
    const previewStep = Math.max(step, this.isPortraitMobile ? 22 : 26);
    const liftY = Math.max(8, Math.floor(this.cardH * 0.08));
    const nudgeX = Math.max(6, Math.floor(this.cardW * 0.06));

    for (let idx = fromIndex; idx < cards.length; idx += 1) {
      const card = cards[idx];
      const y = baseRect.y - liftY + (idx - fromIndex) * previewStep;
      const x = baseRect.x + nudgeX;
      const isTop = idx === cards.length - 1;
      const border = idx === fromIndex ? 'rgba(255,255,255,0.98)' : null;
      this.drawCard(card, x, y, isTop, border);
    }
  }

  drawDraggingStack() {
    if (!this.dragging) return;

    const step = this.getDynamicStackStep();

    const startX = this.pointer.x - this.dragging.offsetX;
    const startY = this.pointer.y - this.dragging.offsetY;

    this.dragging.stack.forEach((card, idx) => {
      const y = startY + idx * step;
      const isTop = idx === this.dragging.stack.length - 1;
      const border = idx === 0 ? 'rgba(223, 75, 75, 0.95)' : null;
      this.drawCard(card, startX, y, isTop, border);
    });
  }

  drawAutoAnimation() {
    if (!this.autoAnim) return;
    const step = this.getDynamicStackStep();
    this.autoAnim.stack.forEach((card, idx) => {
      const y = this.autoAnim.y + idx * step;
      const isTop = idx === this.autoAnim.stack.length - 1;
      this.drawCard(card, this.autoAnim.x, y, isTop, 'rgba(70, 120, 240, 0.9)');
    });
  }

  animateAutoMove(fromCol, fromIndex, toCol, done) {
    const source = this.engine.state.columns[fromCol];
    if (!source || fromIndex < 0 || fromIndex >= source.length) {
      done();
      return;
    }

    const stack = source.slice(fromIndex).map((card) => card.clone());
    const start = this.getCardRect(fromCol, fromIndex);
    const targetY = this.engine.state.columns[toCol].length;
    const end = this.getCardRect(toCol, targetY);
    const duration = 260;
    const t0 = performance.now();
    this.autoLocked = true;

    const frame = (now) => {
      const t = Math.min(1, (now - t0) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      this.autoAnim = {
        x: start.x + (end.x - start.x) * eased,
        y: start.y + (end.y - start.y) * eased,
        stack,
      };
      this.draw();

      if (t < 1) {
        requestAnimationFrame(frame);
        return;
      }

      this.autoAnim = null;
      this.autoLocked = false;
      done();
    };

    requestAnimationFrame(frame);
  }

  drawStateBadge() {
    if (this.engine.gameState === 'playing') return;

    const text = this.engine.gameState === 'won' ? 'You Win!' : 'No More Moves';
    const sub = this.engine.gameState === 'won' ? 'Great job!' : 'Try Undo or Reset';

    const w = Math.min(380, this.width - 40);
    const h = 120;
    const x = (this.width - w) / 2;
    const y = 26;

    this.ctx.save();
    this.roundRect(x, y, w, h, 16);
    this.ctx.fillStyle = 'rgba(255,255,255,0.82)';
    this.ctx.fill();
    this.ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    this.ctx.stroke();

    this.ctx.textAlign = 'center';
    this.ctx.fillStyle = '#22515b';
    this.ctx.font = '700 34px "Baloo 2"';
    this.ctx.fillText(text, x + w / 2, y + 50);
    this.ctx.font = '700 21px "Baloo 2"';
    this.ctx.fillText(sub, x + w / 2, y + 85);
    this.ctx.restore();
  }

  draw() {
    this.drawTable();
    this.drawStockArea();
    this.drawColumns();
    this.drawDraggingStack();
    this.drawAutoAnimation();
    this.drawStateBadge();
  }
}

class App {
  constructor() {
    this.campaignScore = 0;
    this.lastScoreAtEnd = 0;
    this.notifiedState = 'playing';
    this.didBuildReset = false;

    this.engine = new GameEngine();
    this.didBuildReset = this.resetForBuildVersionChange();
    const resumed = !this.didBuildReset && this.restoreProgress();
    if (!resumed) {
      this.ensurePlayableLevelsInitialized();
      const levels = this.getPlayableLevels();
      const firstSeed = levels[0] ?? this.pickNonBlacklistedSeed();
      this.engine.startSingle(firstSeed);
    }

    this.canvas = document.getElementById('gameCanvas');
    this.board = new CanvasBoard(this.canvas, this.engine, () => this.renderAll());

    this.movesLabel = document.getElementById('movesLabel');
    this.timeLabel = document.getElementById('timeLabel');
    this.scoreLabel = document.getElementById('scoreLabel');

    this.hintDialog = document.getElementById('hintDialog');
    this.hintList = document.getElementById('hintList');
    this.levelsBtn = document.getElementById('levelsBtn');
    this.levelsDialog = document.getElementById('levelsDialog');
    this.levelTabs = document.getElementById('levelsTabs');
    this.levelTabCuratedBtn = document.getElementById('levelTabCurated');
    this.levelTabPlayedBtn = document.getElementById('levelTabPlayed');
    this.levelsList = document.getElementById('levelsList');

    this.welcomeDialog = document.getElementById('welcomeDialog');
    this.welcomeLevelsBtn = document.getElementById('welcomeLevelsBtn');
    this.winDialog = document.getElementById('winDialog');
    this.winSummary = document.getElementById('winSummary');
    this.gameOverDialog = document.getElementById('gameOverDialog');
    this.gameOverSummary = document.getElementById('gameOverSummary');
    this.playerNameInput = document.getElementById('playerNameInput');
    this.seedInput = document.getElementById('seedInput');
    this.highScoreList = document.getElementById('highScoreList');
    this.saveScoreBtn = document.getElementById('saveScoreBtn');
    this.playSeedBtn = document.getElementById('playSeedBtn');
    this.clearScoresBtn = document.getElementById('clearScoresBtn');

    this.logoTrigger = document.getElementById('logoTrigger');
    this.scorpionHelperIndicator = document.getElementById('scorpionHelperIndicator');
    this.zenPanel = document.getElementById('zenPanel');
    this.zenAutoBtn = document.getElementById('zenAutoBtn');
    this.zenPauseBtn = document.getElementById('zenPauseBtn');
    this.zenStepBtn = document.getElementById('zenStepBtn');
    this.zenInitialBtn = document.getElementById('zenInitialBtn');
    this.zenStateBtn = document.getElementById('zenStateBtn');
    this.zenLogToggleBtn = document.getElementById('zenLogToggleBtn');
    this.zenLogClearBtn = document.getElementById('zenLogClearBtn');
    this.zenCloseBtn = document.getElementById('zenCloseBtn');
    this.zenAutoNewGameChk = document.getElementById('zenAutoNewGameChk');
    this.zenDragHandle = document.getElementById('zenDragHandle');
    this.zenOutput = document.getElementById('zenOutput');
    this.zenLog = document.getElementById('zenLog');

    this.hasSavedCurrentGame = false;
    this.logoClicks = 0;
    this.lastLogoClickAt = 0;
    this.activeLevelTab = 'curated';
    this.levelRun = {
      mode: 'curated',
    };

    this.zen = {
      unlocked: false,
      running: false,
      timer: null,
      undoBudget: 50,
      forbiddenMoves: new Map(),
      exhaustedStates: new Set(),
      minBranchOptions: 3,
      pathDecisions: [],
      plannedSeed: null,
      plannedSteps: [],
      plannedIndex: 0,
      logs: [],
      lastWinByAuto: false,
    };

    this.zenLogHidden = false;
    this.zenDrag = {
      active: false,
      dx: 0,
      dy: 0,
    };
    this.helperSolveCacheSig = null;
    this.helperHasStarMove = false;
    this.helperBestSuit = null;
    this.helperBestCard = null;

    this.bindButtons();
    this.ensurePlayableLevelsInitialized();
    this.registerServiceWorker();
    if (this.didBuildReset) {
      // After a build migration reset, open Levels directly as the main entry point.
      this.activeLevelTab = 'curated';
      this.openLevelsDialog();
    } else if (!resumed) {
      this.showWelcome();
    }
    this.renderLevels();
    this.renderHighScores();
    this.renderAll();
    this.exposeSeedListsToConsole();

    window.addEventListener('beforeunload', () => this.persistProgress());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this.persistProgress();
      }
    });

    this.timer = setInterval(() => {
      this.renderStatus();
      this.board.draw();
    }, 1000);
  }

  /**
   * Score a move heuristically without applying it.
   * Higher scores indicate better moves.
   * @param {MoveInfo} move
   * @returns {number}
   */
  scoreMoveHeuristic(move) {
    const beforeScore = this.engine.score;
    const beforeMoves = this.engine.moves;

    // Prevent moves from incrementing during hint calculation
    const originalMoves = this.engine.moves;
    const moved = this.engine.moveStack(move.fromCol, move.fromIndex, move.toCol);
    if (!moved) return 0;

    const scoreDelta = this.engine.score - beforeScore;
    this.engine.undo();
    this.engine.moves = originalMoves;

    return scoreDelta;
  }

  bindButtons() {
    this.levelsBtn.addEventListener('click', () => {
      this.openLevelsDialog();
    });

    this.welcomeLevelsBtn?.addEventListener('click', () => {
      if (this.welcomeDialog?.open) {
        this.welcomeDialog.close();
      }
      this.openLevelsDialog();
    });

    document.getElementById('resetBtn').addEventListener('click', () => {
      this.stopZenAuto();
      this.engine.resetBoard();
      this.notifiedState = 'playing';
      this.hasSavedCurrentGame = false;
      this.zen.undoBudget = 50;
      this.zen.forbiddenMoves.clear();
      this.zen.exhaustedStates.clear();
      this.zen.pathDecisions = [];
      this.zen.lastWinByAuto = false;
      this.renderAll();
    });

    document.getElementById('undoBtn').addEventListener('click', () => {
      this.engine.undo();
      this.zen.pathDecisions = [];
      this.notifiedState = 'playing';
      this.renderAll();
    });

    document.getElementById('hintBtn').addEventListener('click', () => {
      // Always add exactly 10 moves for using the hint button (but only once per click)
      this.engine.moves += 10;

      const moves = ScorpionRules.listMoves(this.engine.state.columns);
      const hasExtraSet = this.engine.state.stock.length >= 3;
      if (moves.length === 0 && !hasExtraSet) {
        this.hintList.innerHTML = '<div style="padding: 1rem; text-align: center; color: #999;">No legal moves right now.</div>';
      } else {
        this.hintList.innerHTML = '';
        const currentSolve = this.buildSolutionFromState(this.engine.state);
        const recommendedStep = currentSolve.solved && Array.isArray(currentSolve.steps) && currentSolve.steps.length > 0
          ? currentSolve.steps[0]
          : null;
        const scoredMoves = moves.slice(0, 180).map((m) => ({
          move: m,
          score: this.scoreMoveHeuristic(m),
          isZenOptimal:
            Boolean(recommendedStep)
            && recommendedStep.type === 'move'
            && recommendedStep.fromCol === m.fromCol
            && recommendedStep.fromIndex === m.fromIndex
            && recommendedStep.toCol === m.toCol,
        }));
        
        // Sort by score descending
        scoredMoves.sort((a, b) => b.score - a.score);
        
        scoredMoves.forEach((item, i) => {
          const m = item.move;
          const target = this.engine.state.columns[m.toCol][this.engine.state.columns[m.toCol].length - 1];
          const targetText = target ? ScorpionRules.cardText(target) : 'Empty';
          
          const moveRow = document.createElement('div');
          moveRow.style.cssText = 'display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem; border-bottom: 1px solid #eee; justify-content: space-between;';
          
          const moveInfo = document.createElement('div');
          moveInfo.style.cssText = 'flex: 1;';
          moveInfo.textContent = `${i + 1}. C${m.fromCol + 1} ${ScorpionRules.cardText(m.card)} → C${m.toCol + 1} ${targetText}`;
          
          const scoreLabel = document.createElement('div');
          scoreLabel.style.cssText = item.isZenOptimal
            ? 'background: #f0f0f0; color: #444; opacity: 0.45; padding: 0.25rem 0.75rem; border-radius: 4px; font-size: 0.9rem; font-weight: bold; min-width: 50px; text-align: center;'
            : 'background: #f0f0f0; opacity: 0.2; padding: 0.25rem 0.75rem; border-radius: 4px; font-size: 0.9rem; font-weight: bold; min-width: 50px; text-align: center;';
          scoreLabel.textContent = item.isZenOptimal ? '★' : '';
          
          const applyBtn = document.createElement('button');
          applyBtn.textContent = 'Apply';
          applyBtn.style.cssText = 'padding: 0.25rem 0.75rem; background: #2196F3; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.9rem;';
          applyBtn.addEventListener('click', () => {
            this.engine.moveStack(m.fromCol, m.fromIndex, m.toCol);
            // Only add 1 move for using a suggested move (moveStack already adds 1)
            this.notifiedState = 'playing';
            this.hintDialog.close();
            this.renderAll();
          });
          applyBtn.addEventListener('mouseenter', () => {
            applyBtn.style.background = '#1976D2';
          });
          applyBtn.addEventListener('mouseleave', () => {
            applyBtn.style.background = '#2196F3';
          });
          
          moveRow.appendChild(moveInfo);
          moveRow.appendChild(scoreLabel);
          moveRow.appendChild(applyBtn);
          this.hintList.appendChild(moveRow);
        });

        if (hasExtraSet) {
          const isRecommendedDeal = Boolean(recommendedStep) && recommendedStep.type === 'deal';
          const extraRow = document.createElement('div');
          extraRow.style.cssText = 'display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem; border-bottom: 1px solid #eee; justify-content: space-between; background: #fafcff;';

          const extraInfo = document.createElement('div');
          extraInfo.style.cssText = 'flex: 1;';
          extraInfo.textContent = 'Use Extra Set: DEAL C0 -> C1,C2,C3';

          const extraScoreLabel = document.createElement('div');
          extraScoreLabel.style.cssText = isRecommendedDeal
            ? 'background: #f0f0f0; color: #444; opacity: 0.45; padding: 0.25rem 0.75rem; border-radius: 4px; font-size: 0.9rem; font-weight: bold; min-width: 50px; text-align: center;'
            : 'background: #f0f0f0; opacity: 0.2; padding: 0.25rem 0.75rem; border-radius: 4px; font-size: 0.9rem; font-weight: bold; min-width: 50px; text-align: center;';
          extraScoreLabel.textContent = isRecommendedDeal ? '★' : '';

          const extraApplyBtn = document.createElement('button');
          extraApplyBtn.textContent = 'Apply';
          extraApplyBtn.style.cssText = 'padding: 0.25rem 0.75rem; background: #2196F3; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.9rem;';
          extraApplyBtn.addEventListener('click', () => {
            this.engine.dealStock();
            this.notifiedState = 'playing';
            this.hintDialog.close();
            this.renderAll();
          });
          extraApplyBtn.addEventListener('mouseenter', () => {
            extraApplyBtn.style.background = '#1976D2';
          });
          extraApplyBtn.addEventListener('mouseleave', () => {
            extraApplyBtn.style.background = '#2196F3';
          });

          extraRow.appendChild(extraInfo);
          extraRow.appendChild(extraScoreLabel);
          extraRow.appendChild(extraApplyBtn);
          this.hintList.appendChild(extraRow);
        }
      }
      this.hintDialog.showModal();
    });

    document.getElementById('playNewDeckBtn').addEventListener('click', () => {
      if (this.levelRun?.mode === 'curated') {
        const nextSeed = this.getNextPlayableSeedFromCurrent();
        if (Number.isFinite(nextSeed)) {
          this.startFreshGame(nextSeed, this.winDialog, { mode: 'curated' });
          return;
        }
      }

      if (this.winDialog?.open) {
        this.winDialog.close();
      }
      this.openLevelsDialog();
    });

    document.getElementById('replayLevelBtn')?.addEventListener('click', () => {
      const currentSeed = Number(this.engine.currentSeed);
      if (!Number.isFinite(currentSeed)) return;

      const replayMode = this.levelRun?.mode === 'curated' || this.levelRun?.mode === 'played'
        ? this.levelRun.mode
        : 'custom';
      this.startFreshGame(currentSeed, this.winDialog, { mode: replayMode });
    });

    document.getElementById('winMenuBtn')?.addEventListener('click', () => {
      if (this.winDialog?.open) {
        this.winDialog.close();
      }
      this.openLevelsDialog();
    });

    this.saveScoreBtn.addEventListener('click', () => {
      const saved = this.saveHighScore();
      if (saved) {
        this.hasSavedCurrentGame = true;
        this.saveScoreBtn.disabled = true;
        this.renderHighScores();
      }
    });

    document.getElementById('newAfterGameOverBtn').addEventListener('click', () => {
      if (this.gameOverDialog?.open) {
        this.gameOverDialog.close();
      }
      this.openLevelsDialog();
    });

    this.playSeedBtn.addEventListener('click', () => {
      const seed = Number(this.seedInput.value.trim());
      if (!Number.isFinite(seed)) return;

      this.startFreshGame(seed, this.gameOverDialog);
    });

    this.clearScoresBtn.addEventListener('click', () => {
      localStorage.removeItem('scorpionHighScores');
      this.renderHighScores();
    });

    this.highScoreList.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const button = target.closest('[data-seed]');
      if (!(button instanceof HTMLElement)) return;

      const seed = Number(button.dataset.seed);
      if (!Number.isFinite(seed)) return;

      this.startFreshGame(seed, this.gameOverDialog);
    });

    this.levelsList.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const button = target.closest('[data-level-seed], [data-level-mode]');
      if (!(button instanceof HTMLElement)) return;

      if (button.dataset.levelMode === 'played') {
        const playedSeed = Number(button.dataset.levelSeed);
        if (!Number.isFinite(playedSeed)) return;
        this.startFreshGame(playedSeed, this.levelsDialog, { mode: 'played' });
        return;
      }

      const seed = Number(button.dataset.levelSeed);
      if (!Number.isFinite(seed)) return;
      if (!this.isPlayableLevelUnlockedBySeed(seed)) return;

      this.startFreshGame(seed, this.levelsDialog, { mode: 'curated' });
    });

    this.levelTabs?.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const button = target.closest('[data-level-tab]');
      if (!(button instanceof HTMLElement)) return;
      const tab = button.dataset.levelTab;
      if (tab !== 'curated' && tab !== 'played') return;
      this.activeLevelTab = tab;
      this.renderLevels();
    });

    this.logoTrigger.addEventListener('click', () => {
      const now = Date.now();
      if (now - this.lastLogoClickAt > 1300) {
        this.logoClicks = 0;
      }
      this.lastLogoClickAt = now;
      this.logoClicks += 1;
      if (this.logoClicks >= 5) {
        this.toggleZenPanel();
        this.logoClicks = 0;
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === '`') {
        this.toggleZenPanel();
      }
    });

    this.zenAutoBtn.addEventListener('click', () => {
      if (this.zen.running) {
        this.stopZenAuto();
      } else {
        this.startZenAuto();
      }
    });

    this.zenPauseBtn.addEventListener('click', () => {
      if (this.zen.running) {
        this.stopZenAuto();
      } else {
        this.startZenAuto();
      }
      this.syncZenButtons();
    });

    this.zenStepBtn.addEventListener('click', async () => {
      await this.runZenSingleStep();
    });

    this.zenInitialBtn.addEventListener('click', () => {
      this.zenOutput.value = `seed:${this.engine.currentSeed}\n${this.getInitialDeckString(this.engine.currentSeed)}`;
    });

    this.zenStateBtn.addEventListener('click', () => {
      this.zenOutput.value = this.getCurrentStateText();
    });

    this.zenCloseBtn.addEventListener('click', () => {
      this.zenPanel.hidden = true;
    });

    this.zenLogClearBtn.addEventListener('click', () => {
      this.zen.logs = [];
      this.zenLog.textContent = 'Zen log';
    });

    this.zenLogToggleBtn.addEventListener('click', () => {
      this.zenLogHidden = !this.zenLogHidden;
      this.zenLog.hidden = this.zenLogHidden;
      this.zenLogToggleBtn.textContent = this.zenLogHidden ? 'Show Log' : 'Hide Log';
    });

    this.zenDragHandle.addEventListener('pointerdown', (event) => {
      this.zenDrag.active = true;
      const rect = this.zenPanel.getBoundingClientRect();
      this.zenPanel.style.left = `${rect.left}px`;
      this.zenPanel.style.top = `${rect.top}px`;
      this.zenPanel.style.right = 'auto';
      this.zenPanel.style.position = 'fixed';
      this.zenDrag.dx = event.clientX - rect.left;
      this.zenDrag.dy = event.clientY - rect.top;
      this.zenDragHandle.setPointerCapture(event.pointerId);
    });

    this.zenDragHandle.addEventListener('pointermove', (event) => {
      if (!this.zenDrag.active) return;
      const left = Math.max(0, Math.min(window.innerWidth - this.zenPanel.offsetWidth, event.clientX - this.zenDrag.dx));
      const top = Math.max(0, Math.min(window.innerHeight - this.zenPanel.offsetHeight, event.clientY - this.zenDrag.dy));
      this.zenPanel.style.left = `${left}px`;
      this.zenPanel.style.top = `${top}px`;
    });

    this.zenDragHandle.addEventListener('pointerup', (event) => {
      this.zenDrag.active = false;
      this.zenDragHandle.releasePointerCapture(event.pointerId);
    });

    this.syncZenButtons();
    this.updateScorpionHelperIndicator();

  }

  updateScorpionHelperIndicator() {
    if (!this.scorpionHelperIndicator) return;

    const moveCount = ScorpionRules.listMoves(this.engine.state.columns).length;
    const canUseExtraDeck = this.engine.state.stock.length >= 3;
    const totalValidActions = moveCount + (canUseExtraDeck ? 1 : 0);

    const stateSig = this.stateSignature(this.engine.state);
    if (this.helperSolveCacheSig !== stateSig) {
      const currentSolve = this.buildSolutionFromState(this.engine.state);
      const recommendedStep = currentSolve.solved && Array.isArray(currentSolve.steps) && currentSolve.steps.length > 0
        ? currentSolve.steps[0]
        : null;

      let bestSuit = null;
      let bestCard = null;
      if (recommendedStep?.type === 'move') {
        bestCard = this.engine.state.columns[recommendedStep.fromCol]?.[recommendedStep.fromIndex] || null;
        bestSuit = bestCard?.suit || null;
      } else if (recommendedStep?.type === 'deal') {
        bestSuit = 'EXTRA';
      }

      this.helperSolveCacheSig = stateSig;
      this.helperHasStarMove = Boolean(recommendedStep);
      this.helperBestSuit = bestSuit;
      this.helperBestCard = bestCard;
    }

    const hasWinningPath = this.engine.gameState === 'won' || this.helperHasStarMove;
    const indicatorClasses = ['is-unstable', 'is-stable', 'suit-r', 'suit-g', 'suit-b', 'suit-y', 'suit-extra', 'no-win-path'];
    this.scorpionHelperIndicator.classList.remove(...indicatorClasses);

    if (!hasWinningPath) {
      this.scorpionHelperIndicator.classList.add('no-win-path');
    } else {
      const suit = this.helperBestSuit;
      if (suit === 'R') {
        this.scorpionHelperIndicator.classList.add('suit-r');
      } else if (suit === 'G') {
        this.scorpionHelperIndicator.classList.add('suit-g');
      } else if (suit === 'B') {
        this.scorpionHelperIndicator.classList.add('suit-b');
      } else if (suit === 'Y') {
        this.scorpionHelperIndicator.classList.add('suit-y');
      } else if (suit === 'EXTRA') {
        this.scorpionHelperIndicator.classList.add('suit-extra');
      } else {
        this.scorpionHelperIndicator.classList.add('suit-g');
      }
    }

    // Determine badge text: card text, or "1" for game over / extra deck
    let badgeText = '1';
    if (this.engine.gameState === 'won' || this.engine.gameState === 'stuck') {
      badgeText = '1';
    } else if (this.helperBestSuit === 'EXTRA') {
      badgeText = '1';
    } else if (this.helperBestCard) {
      badgeText = ScorpionRules.cardText(this.helperBestCard);
    }
    this.scorpionHelperIndicator.textContent = badgeText;

    this.scorpionHelperIndicator.title = `${hasWinningPath ? `Best move suit: ${this.helperBestSuit || 'N/A'}` : 'No known winning path'} | Valid actions: ${totalValidActions} (${moveCount} moves${canUseExtraDeck ? ' + extra deck' : ''})`;
  }

  toggleZenPanel() {
    if (!this.zen.unlocked) {
      const input = window.prompt('Enter Zen password');
      if (input !== 'critters') {
        return;
      }
      this.zen.unlocked = true;
    }
    this.zenPanel.hidden = !this.zenPanel.hidden;
  }

  resetZenRunState() {
    this.zen.undoBudget = 50;
    this.zen.forbiddenMoves.clear();
    this.zen.exhaustedStates.clear();
    this.zen.pathDecisions = [];
    this.zen.plannedSeed = null;
    this.zen.plannedSteps = [];
    this.zen.plannedIndex = 0;
    this.zen.lastWinByAuto = false;
  }

  pickNonBlacklistedSeed(maxSolveAttempts = NEW_LEVEL_SOLVER_ATTEMPTS) {
    const tried = new Set();
    let checked = 0;

    while (checked < maxSolveAttempts) {
      const seed = Date.now() + Math.floor(Math.random() * 1e9);
      if (BLACKLISTED_SEEDS.includes(seed) || tried.has(seed)) continue;

      tried.add(seed);
      checked += 1;

      const result = this.buildSeedSolution(seed);
      if (result.solved) {
        return seed;
      } else {
        // Add unsolvable seed to BLACKLISTED_SEEDS
        this.appendBlacklistedSeed(seed);
      }
    }

    let fallback;
    do {
      fallback = Date.now() + Math.floor(Math.random() * 1e9);
    } while (BLACKLISTED_SEEDS.includes(fallback));
    return fallback;
  }

  startFreshGame(seed = null, dialogToClose = null, runMeta = null) {
    this.stopZenAuto();
    const carryForwardTotal = this.engine.gameState === 'won'
      ? this.campaignScore
      : this.campaignScore + this.engine.calculateSequentialScore();

    if (seed === null || seed === undefined) {
      this.engine.startSingle(this.pickNonBlacklistedSeed());
    } else {
      this.engine.startSingle(seed);
    }

    const mode = runMeta?.mode || (seed === null || seed === undefined ? 'infinity' : 'custom');

    this.levelRun = {
      mode,
    };

    this.campaignScore = carryForwardTotal;
    this.notifiedState = 'playing';
    this.hasSavedCurrentGame = false;
    this.resetZenRunState();
    if (dialogToClose?.open) {
      dialogToClose.close();
    }
    this.renderAll();
  }

  getNextPlayableSeedFromCurrent() {
    const levels = this.getPlayableLevels();
    const current = Number(this.engine.currentSeed);
    const currentIndex = levels.findIndex((seed) => Number(seed) === current);
    if (currentIndex === -1) return null;

    const nextSeed = levels[currentIndex + 1];
    return Number.isFinite(Number(nextSeed)) ? Number(nextSeed) : null;
  }

  resetForBuildVersionChange() {
    try {
      const currentBuild =
        document.querySelector('meta[name="app-build-version"]')?.getAttribute('content') || 'dev';
      const storedBuild = localStorage.getItem(BUILD_VERSION_KEY);
      if (storedBuild === currentBuild) {
        return false;
      }

      const toDelete = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (!key) continue;
        if (key.startsWith('scorpion')) {
          toDelete.push(key);
        }
      }
      toDelete.forEach((key) => localStorage.removeItem(key));
      localStorage.setItem(BUILD_VERSION_KEY, currentBuild);
      return true;
    } catch {
      return false;
    }
  }

  getLevelRecords() {
    try {
      const raw = localStorage.getItem(LEVEL_RECORDS_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  saveLevelRecords(records) {
    localStorage.setItem(LEVEL_RECORDS_KEY, JSON.stringify(records));
  }

  getPlayableLevels() {
    try {
      const raw = localStorage.getItem(PLAYABLE_LEVELS_KEY);
      if (!raw) return CURATED_LEVELS.slice();
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return CURATED_LEVELS.slice();
      return parsed.map((seed) => Number(seed)).filter((seed) => Number.isFinite(seed));
    } catch {
      return CURATED_LEVELS.slice();
    }
  }

  savePlayableLevels(levels) {
    localStorage.setItem(PLAYABLE_LEVELS_KEY, JSON.stringify(levels));
  }

  getLevelProgress() {
    try {
      const raw = localStorage.getItem(LEVEL_PROGRESS_KEY);
      if (!raw) return { unlockedCount: 1 };
      const parsed = JSON.parse(raw);
      const unlockedCount = Number(parsed?.unlockedCount || 1);
      return { unlockedCount: Math.max(1, unlockedCount) };
    } catch {
      return { unlockedCount: 1 };
    }
  }

  saveLevelProgress(progress) {
    localStorage.setItem(LEVEL_PROGRESS_KEY, JSON.stringify(progress));
  }

  isPlayableLevelUnlockedBySeed(seed) {
    const levels = this.getPlayableLevels();
    const index = levels.findIndex((levelSeed) => levelSeed === Number(seed));
    if (index === -1) return false;
    const progress = this.getLevelProgress();
    return index < Math.max(1, progress.unlockedCount);
  }

  getPlayableSeeds(count = 1) {
    const requested = Math.max(1, Math.min(50, Number(count) || 1));
    const levels = this.getPlayableLevels();
    const created = [];

    for (let i = 0; i < requested; i += 1) {
      const seed = this.pickNonBlacklistedSeed();
      if (!levels.includes(seed)) {
        levels.push(seed);
        created.push(seed);
      }
    }

    this.savePlayableLevels(levels);
    this.syncCuratedFromStore();
    this.renderLevels();
    return created;
  }

  ensurePlayableLevelsInitialized() {
    const levels = this.getPlayableLevels();
    const baseSeeds = CURATED_LEVELS.slice();

    if (levels.length === 0) {
      this.savePlayableLevels(baseSeeds);
      const progress = { unlockedCount: 1 };
      this.saveLevelProgress(progress);
      this.syncCuratedFromStore();
      return;
    }

    let changed = false;
    for (const seed of baseSeeds) {
      if (!levels.includes(seed)) {
        levels.push(seed);
        changed = true;
      }
    }
    if (changed) {
      this.savePlayableLevels(levels);
    }

    const progress = this.getLevelProgress();
    progress.unlockedCount = Math.max(1, Number(progress.unlockedCount || 1));
    this.saveLevelProgress(progress);
    this.syncCuratedFromStore();
  }

  syncCuratedFromStore() {
    const levels = this.getPlayableLevels();
    CURATED_LEVELS.length = 0;
    CURATED_LEVELS.push(...levels);
  }

  getPlayedGames() {
    try {
      const raw = localStorage.getItem(PLAYED_GAMES_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  savePlayedGames(items) {
    localStorage.setItem(PLAYED_GAMES_KEY, JSON.stringify(items.slice(0, 200)));
  }

  recordPlayedGame(status) {
    const seed = Number(this.engine.currentSeed);
    if (!Number.isFinite(seed)) return;

    const elapsed = this.engine.elapsedSeconds();
    const played = this.getPlayedGames();
    const existing = played.find((entry) => Number(entry.seed) === seed);

    if (!existing) {
      played.push({
        seed,
        bestTime: elapsed,
        bestMoves: this.engine.moves,
        plays: 1,
        lastStatus: status,
        updatedAt: Date.now(),
      });
      this.savePlayedGames(played.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)));
      return;
    }

    existing.bestTime = Math.min(Number(existing.bestTime || elapsed), elapsed);
    existing.bestMoves = Math.min(Number(existing.bestMoves || this.engine.moves), this.engine.moves);
    existing.plays = Number(existing.plays || 0) + 1;
    existing.lastStatus = status;
    existing.updatedAt = Date.now();
    this.savePlayedGames(played.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)));
  }

  appendBlacklistedSeed(seed) {
    const numericSeed = Number(seed);
    if (!Number.isFinite(numericSeed)) return false;
    if (BLACKLISTED_SEEDS.includes(numericSeed)) return false;
    BLACKLISTED_SEEDS.push(numericSeed);
    return true;
  }

  appendCuratedLevel(seed) {
    const numericSeed = Number(seed);
    if (!Number.isFinite(numericSeed)) return false;
    const levels = this.getPlayableLevels();
    if (levels.includes(numericSeed)) return false;
    levels.push(numericSeed);
    this.savePlayableLevels(levels);
    this.syncCuratedFromStore();
    return true;
  }

  exposeSeedListsToConsole() {
    window.scorpionSeedLists = {
      getBlacklisted: () => [...BLACKLISTED_SEEDS],
      getCurated: () => this.getPlayableLevels(),
      getPlayableSeeds: (count = 1) => this.getPlayableSeeds(count),
      exportJs: () => ({
        blacklisted: `const BLACKLISTED_SEEDS = [\n${BLACKLISTED_SEEDS.map((seed) => `  ${seed},`).join('\n')}\n];`,
        curated: `const CURATED_LEVELS = [\n${this.getPlayableLevels().map((seed) => `  ${seed},`).join('\n')}\n];`,
      }),
    };
    window.getPlayableSeeds = (count = 1) => this.getPlayableSeeds(count);
    window.solveSeed = (seed) => this.solveSeed(seed);
    window.getCurrentDeckSet = () => this.stateToRaw(this.engine.state);
    window.solveCurrentDeckSet = () => this.solveCurrentDeckSet();
    window.solveDeckSet = (deckSet) => this.solveDeckSet(deckSet);
  }

  recordCuratedLevelWin() {
    const levels = this.getPlayableLevels();
    const index = levels.findIndex((seed) => seed === this.engine.currentSeed);
    if (index === -1) return;

    const records = this.getLevelRecords();
    const key = String(this.engine.currentSeed);
    const elapsedSeconds = this.engine.elapsedSeconds();
    const score = this.engine.calculateSequentialScore();
    const existing = records[key] || { bestScore: 0, bestTime: null, bestMoves: null, wins: 0 };

    records[key] = {
      bestScore: Math.max(existing.bestScore || 0, score),
      bestTime:
        typeof existing.bestTime === 'number'
          ? Math.min(existing.bestTime, elapsedSeconds)
          : elapsedSeconds,
      bestMoves:
        typeof existing.bestMoves === 'number'
          ? Math.min(existing.bestMoves, this.engine.moves)
          : this.engine.moves,
      wins: (existing.wins || 0) + 1,
      levelNumber: index + 1,
    };

    this.saveLevelRecords(records);

    const progress = this.getLevelProgress();
    progress.unlockedCount = Math.max(progress.unlockedCount, index + 2);
    this.saveLevelProgress(progress);

    if (index === levels.length - 1) {
      const nextSeed = this.pickNonBlacklistedSeed();
      const appended = this.appendCuratedLevel(nextSeed);
      if (appended) {
        console.log(`[Playable] appended next seed:${nextSeed}`);
      }
    }
  }

  formatLevelTime(totalSeconds) {
    if (typeof totalSeconds !== 'number' || !Number.isFinite(totalSeconds)) {
      return 'No clear yet';
    }
    const mm = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
    const ss = String(totalSeconds % 60).padStart(2, '0');
    return `${mm}:${ss}`;
  }

  renderLevels() {
    if (!this.levelsList) return;
    this.syncCuratedFromStore();

    if (this.levelTabCuratedBtn) {
      this.levelTabCuratedBtn.classList.toggle('active', this.activeLevelTab === 'curated');
      this.levelTabCuratedBtn.setAttribute('aria-selected', this.activeLevelTab === 'curated' ? 'true' : 'false');
    }
    if (this.levelTabPlayedBtn) {
      this.levelTabPlayedBtn.classList.toggle('active', this.activeLevelTab === 'played');
      this.levelTabPlayedBtn.setAttribute('aria-selected', this.activeLevelTab === 'played' ? 'true' : 'false');
    }

    this.levelsList.innerHTML = '';

    if (this.activeLevelTab === 'played') {
      const played = this.getPlayedGames();
      if (played.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'level-empty';
        empty.textContent = 'No played games yet. Finish a game to populate this list.';
        this.levelsList.appendChild(empty);
        return;
      }

      played.forEach((entry, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'level-tile played';
        button.dataset.levelMode = 'played';
        button.dataset.levelSeed = String(entry.seed);

        const number = document.createElement('span');
        number.className = 'level-number';
        number.textContent = `P${index + 1}`;

        const time = document.createElement('span');
        time.className = 'level-time';
        time.textContent = `Best ${this.formatLevelTime(Number(entry.bestTime || 0))}`;

        const moves = document.createElement('span');
        moves.className = 'level-time';
        moves.textContent = `${Number(entry.bestMoves || 0)} moves`;

        const seedLabel = document.createElement('span');
        seedLabel.className = 'level-time';
        seedLabel.textContent = `seed ${entry.seed}`;

        button.append(number, time, moves, seedLabel);
        this.levelsList.appendChild(button);
      });

      return;
    }

    if (CURATED_LEVELS.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'level-empty';
      empty.textContent = 'No playable levels yet. Use window.getPlayableSeeds(n) to create some.';
      this.levelsList.appendChild(empty);
      return;
    }

    const records = this.getLevelRecords();
    const progress = this.getLevelProgress();
    const unlockedCount = Math.max(1, progress.unlockedCount);

    CURATED_LEVELS.forEach((seed, index) => {
      const record = records[String(seed)] || null;
      const unlocked = index < unlockedCount;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'level-tile';
      if (!unlocked) {
        button.classList.add('played');
        button.disabled = true;
      }
      button.dataset.levelSeed = String(seed);

      const number = document.createElement('span');
      number.className = 'level-number';
      number.textContent = String(index + 1);

      const state = document.createElement('span');
      state.className = 'level-time';
      state.textContent = unlocked ? 'Unlocked' : 'Locked';

      const moves = document.createElement('span');
      moves.className = 'level-time';
      moves.textContent =
        typeof record?.bestMoves === 'number' ? `${record.bestMoves} moves` : 'No record';

      const time = document.createElement('span');
      time.className = 'level-time';
      time.textContent =
        typeof record?.bestTime === 'number' ? this.formatLevelTime(record.bestTime) : 'No time';

      if (record?.bestTime) {
        button.title = `Your best: ${this.formatLevelTime(record.bestTime)}`;
      }

      button.append(number, state, moves, time);
      this.levelsList.appendChild(button);
    });
  }

  logZen(message) {
    const stamp = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    const moveNum = this.engine.moves ?? 0;
    this.zen.logs.push(`${stamp} #${String(moveNum).padStart(3, '0')} ${message}`);
    this.zen.logs = this.zen.logs.slice(-140);
    this.zenLog.textContent = this.zen.logs.join('\n');
    this.zenLog.scrollTop = this.zenLog.scrollHeight;
  }

  stateSignature(state) {
    const cols = state.columns
      .map((col) => col.map((c) => `${c.suit}${c.rank}${c.faceUp ? 'U' : 'D'}`).join('.'))
      .join('|');
    const stock = state.stock.map((c) => `${c.suit}${c.rank}${c.faceUp ? 'U' : 'D'}`).join('.');
    return `${cols}#${stock}#${state.completed}`;
  }

  cloneState(state) {
    return state.clone();
  }

  applyVirtualMove(state, move) {
    if (move.type === 'deal') {
      for (let i = 0; i < 3; i += 1) {
        const card = state.stock.shift();
        if (card) {
          card.faceUp = true;
          state.columns[i].push(card);
        }
      }
    } else {
      const source = state.columns[move.fromCol];
      const moved = source.splice(move.fromIndex);
      state.columns[move.toCol].push(...moved);
      if (source.length > 0 && !source[source.length - 1].faceUp) {
        source[source.length - 1].faceUp = true;
      }
    }
    return ScorpionRules.removeCompletedRuns(state);
  }

  hasPotentialFuture(state) {
    if (state.completed >= 4) return true;
    const moves = ScorpionRules.listMoves(state.columns);
    if (moves.length > 0) return true;
    return state.stock.length >= 3;
  }

  countHidden(state) {
    let hidden = 0;
    for (const col of state.columns) {
      for (const card of col) {
        if (!card.faceUp) hidden += 1;
      }
    }
    return hidden;
  }

  countEmpty(state) {
    return state.columns.filter((col) => col.length === 0).length;
  }

  moveKey(move) {
    if (move.type === 'deal') return 'deal';
    return `${move.fromCol}:${move.fromIndex}->${move.toCol}`;
  }

  getForbiddenSet(stateSig) {
    const existing = this.zen.forbiddenMoves.get(stateSig);
    if (existing) return existing;
    const created = new Set();
    this.zen.forbiddenMoves.set(stateSig, created);
    return created;
  }

  forbidMove(stateSig, moveKey) {
    this.getForbiddenSet(stateSig).add(moveKey);
  }

  backtrackToBranch(deadStateSig = null) {
    if (deadStateSig) {
      this.zen.exhaustedStates.add(deadStateSig);
    }

    while (this.zen.undoBudget > 0 && this.engine.history.length > 0) {
      this.engine.undo();
      this.zen.undoBudget -= 1;

      const sig = this.stateSignature(this.engine.state);

      const undone = this.zen.pathDecisions.pop();
      if (undone && undone.stateSig === sig) {
        this.forbidMove(undone.stateSig, undone.moveKey);
      }

      const candidates = this.getAutoCandidates();
      const viable = candidates.filter((c) => !c.dead);

      this.logZen(`undo used, budget ${this.zen.undoBudget}`);

      if (viable.length >= this.zen.minBranchOptions) {
        return true;
      }

      // This node is still too constrained; treat it as part of the dead path.
      this.zen.exhaustedStates.add(sig);
    }

    return false;
  }

  getAutoCandidates() {
    const candidates = [];
    const stateSig = this.stateSignature(this.engine.state);
    const forbidden = this.getForbiddenSet(stateSig);
    const moves = ScorpionRules.listMoves(this.engine.state.columns);

    for (const move of moves) {
      const key = this.moveKey({ type: 'move', fromCol: move.fromCol, fromIndex: move.fromIndex, toCol: move.toCol });
      if (forbidden.has(key)) continue;

      const virtual = this.cloneState(this.engine.state);
      const beforeHidden = this.countHidden(virtual);
      const beforeEmpty = this.countEmpty(virtual);
      const removed = this.applyVirtualMove(virtual, {
        type: 'move',
        fromCol: move.fromCol,
        fromIndex: move.fromIndex,
        toCol: move.toCol,
      });
      const revealed = Math.max(0, beforeHidden - this.countHidden(virtual));
      const empties = Math.max(0, this.countEmpty(virtual) - beforeEmpty);
      const dead = !this.hasPotentialFuture(virtual);

      let score = 8 + revealed * 90 + empties * 45 + removed * 420;
      if (dead) score -= 8000;

      candidates.push({
        type: 'move',
        fromCol: move.fromCol,
        fromIndex: move.fromIndex,
        toCol: move.toCol,
        score,
        dead,
        key,
      });
    }

    if (this.engine.state.stock.length >= 3) {
      const key = this.moveKey({ type: 'deal' });
      if (!forbidden.has(key)) {
      const virtual = this.cloneState(this.engine.state);
      const beforeHidden = this.countHidden(virtual);
      const removed = this.applyVirtualMove(virtual, { type: 'deal' });
      const revealed = Math.max(0, beforeHidden - this.countHidden(virtual));
      const dead = !this.hasPotentialFuture(virtual);

      let score = 3 + revealed * 80 + removed * 420;
      if (dead) score -= 8000;

      candidates.push({ type: 'deal', score, dead, key });
      }
    }

    candidates.sort((a, b) => b.score - a.score);
    return candidates;
  }

  /** @param {BoardState} state */
  getAutoCandidatesForState(state) {
    const candidates = [];
    const moves = ScorpionRules.listMoves(state.columns);

    for (const move of moves) {
      const virtual = this.cloneState(state);
      const beforeHidden = this.countHidden(virtual);
      const beforeEmpty = this.countEmpty(virtual);
      const removed = this.applyVirtualMove(virtual, {
        type: 'move',
        fromCol: move.fromCol,
        fromIndex: move.fromIndex,
        toCol: move.toCol,
      });
      const revealed = Math.max(0, beforeHidden - this.countHidden(virtual));
      const empties = Math.max(0, this.countEmpty(virtual) - beforeEmpty);
      const dead = !this.hasPotentialFuture(virtual);

      let score = 8 + revealed * 90 + empties * 45 + removed * 420;
      if (dead) score -= 8000;

      candidates.push({
        type: 'move',
        fromCol: move.fromCol,
        fromIndex: move.fromIndex,
        toCol: move.toCol,
        score,
        dead,
      });
    }

    if (state.stock.length >= 3) {
      const virtual = this.cloneState(state);
      const beforeHidden = this.countHidden(virtual);
      const removed = this.applyVirtualMove(virtual, { type: 'deal' });
      const revealed = Math.max(0, beforeHidden - this.countHidden(virtual));
      const dead = !this.hasPotentialFuture(virtual);

      let score = 3 + revealed * 80 + removed * 420;
      if (dead) score -= 8000;

      candidates.push({ type: 'deal', score, dead });
    }

    candidates.sort((a, b) => b.score - a.score);
    return candidates;
  }

  /** @param {{type:'move'|'deal', fromCol?:number, fromIndex?:number, toCol?:number, score:number}} step @param {BoardState} state */
  formatSolveQueueStep(step, state) {
    if (step.type === 'deal') {
      return `DEAL C0 -> C1,C2,C3 | score:${Math.round(step.score)}`;
    }
    const headCard = state.columns[step.fromCol]?.[step.fromIndex];
    const headText = headCard ? ScorpionRules.cardText(headCard) : '?';
    return `${headText} C${step.fromCol + 1} -> C${step.toCol + 1} | score:${Math.round(step.score)}`;
  }

  /** @param {BoardState} inputState */
  buildSolutionFromState(inputState) {
    const state = this.cloneState(inputState);
    const queue = [];
    const steps = [];
    const seen = new Set();
    const maxSteps = 1500;

    for (let i = 0; i < maxSteps; i += 1) {
      if (state.completed >= 4) {
        return { solved: true, queue, steps };
      }

      const sig = this.stateSignature(state);
      if (seen.has(sig)) {
        return { solved: false, queue, steps };
      }
      seen.add(sig);

      const candidates = this.getAutoCandidatesForState(state);
      const best = candidates.find((c) => !c.dead);
      if (!best) {
        return { solved: false, queue, steps };
      }

      queue.push(this.formatSolveQueueStep(best, state));
      steps.push({
        type: best.type,
        fromCol: best.fromCol,
        fromIndex: best.fromIndex,
        toCol: best.toCol,
        score: best.score,
      });
      this.applyVirtualMove(state, best);
    }

    return { solved: state.completed >= 4, queue, steps };
  }

  /** @param {number} seed */
  buildSeedSolution(seed) {
    const state = this.engine.createClassicState(seed);
    return this.buildSolutionFromState(state);
  }

  /** @param {BoardState} state @param {string} label */
  buildStateSolutionText(state, label) {
    const result = this.buildSolutionFromState(state);
    const queueText = result.solved && result.queue.length > 0
      ? result.queue.map((line, i) => `${i + 1}. ${line}`).join('\n')
      : 'No full solution path found with no-undo greedy search.';

    const stateText = this.getStateText(state);
    const content = [
      `source: ${label}`,
      stateText,
      'solution queue',
      queueText,
    ].join('\n');

    return { result, content };
  }

  /** @param {BoardState} state */
  getStateText(state) {
    const cols = state.columns
      .map((col, i) => {
        const text = col.map((card) => `${card.rank}${card.suit}${card.faceUp ? '' : '*'}`).join(' ');
        return `C${i + 1}: ${text}`;
      })
      .join('\n');
    const stock = state.stock.map((card) => `${card.rank}${card.suit}`).join(' ');
    return `${cols}\nC0: ${stock}`;
  }

  solveCurrentDeckSet() {
    const state = this.cloneState(this.engine.state);
    const label = `current-seed-${this.engine.currentSeed}`;
    const { result, content } = this.buildStateSolutionText(state, label);
    const fileName = `${this.engine.currentSeed}-current-state.txt`;

    this.downloadTextFile(fileName, content);
    this.zenOutput.value = content;
    console.log(content);

    return {
      source: label,
      solved: result.solved,
      steps: result.queue.length,
      fileName,
      content,
    };
  }

  /** @param {string|{columns:Array<Array<{id:string,suit:SuitCode,rank:number,faceUp:boolean}>>,stock:Array<{id:string,suit:SuitCode,rank:number,faceUp:boolean}>,completed:number}} deckSetInput */
  solveDeckSet(deckSetInput) {
    const raw = typeof deckSetInput === 'string' ? JSON.parse(deckSetInput) : deckSetInput;
    if (!raw || !Array.isArray(raw.columns) || !Array.isArray(raw.stock)) {
      throw new Error('solveDeckSet(deckSet) expects a raw state object (columns, stock, completed) or JSON string.');
    }

    const state = this.rawToState(raw);
    const { result, content } = this.buildStateSolutionText(state, 'custom-deck-set');
    const fileName = `custom-deck-set-${Date.now()}.txt`;

    this.downloadTextFile(fileName, content);
    this.zenOutput.value = content;
    console.log(content);

    return {
      source: 'custom-deck-set',
      solved: result.solved,
      steps: result.queue.length,
      fileName,
      content,
    };
  }

  ensureZenPlanFromCurrentState() {
    const seed = this.engine.currentSeed;
    if (this.zen.plannedSeed === seed && this.zen.plannedSteps.length > 0) {
      return true;
    }

    const result = this.buildSolutionFromState(this.engine.state);
    const steps = Array.isArray(result.steps) ? result.steps : [];
    if (!result.solved || steps.length === 0) {
      this.zen.plannedSeed = seed;
      this.zen.plannedSteps = [];
      this.zen.plannedIndex = 0;
      return false;
    }

    this.zen.plannedSeed = seed;
    this.zen.plannedSteps = steps;
    this.zen.plannedIndex = 0;
    this.logZen(`Plan ready: ${steps.length} steps.`);
    return true;
  }

  /** @param {string} fileName @param {string} content */
  downloadTextFile(fileName, content) {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  /** @param {number|string} seedInput */
  solveSeed(seedInput) {
    const seed = Number(seedInput);
    if (!Number.isFinite(seed)) {
      throw new Error('solveSeed(seed) expects a numeric seed.');
    }

    const deck = this.getInitialDeckString(seed);
    const result = this.buildSeedSolution(seed);

    const queueText = result.solved && result.queue.length > 0
      ? result.queue.map((line, i) => `${i + 1}. ${line}`).join('\n')
      : 'No full solution path found with no-undo greedy search.';

    const content = [
      `seed: ${seed}`,
      `deck: ${deck}`,
      'solution queue',
      queueText,
    ].join('\n');

    this.downloadTextFile(`${seed}.txt`, content);
    this.zenOutput.value = content;
    console.log(content);

    return {
      seed,
      solved: result.solved,
      steps: result.queue.length,
      fileName: `${seed}.txt`,
      content,
    };
  }

  updateZenAutoButton() {
    this.zenAutoBtn.textContent = this.zen.running ? 'Pause' : 'Auto Play';
  }

  syncZenButtons() {
    this.zenPauseBtn.textContent = this.zen.running ? 'Pause' : 'Resume';
    this.zenAutoBtn.textContent = this.zen.running ? 'Stop Auto' : 'Auto Play';
  }

  startZenAuto() {
    this.zen.running = true;
    this.syncZenButtons();
    this.logZen('Auto pilot started.');

    const tick = async () => {
      if (!this.zen.running) return;
      const progressed = await this.runZenSingleStep();
      if (!progressed) {
        this.stopZenAuto();
        return;
      }
      this.zen.timer = setTimeout(tick, 280);
    };

    tick();
  }

  stopZenAuto() {
    this.zen.running = false;
    if (this.zen.timer) {
      clearTimeout(this.zen.timer);
      this.zen.timer = null;
    }
    this.syncZenButtons();
  }

  async runZenSingleStep() {
    this.engine.syncGameState();
    if (this.engine.gameState !== 'playing') {
      this.logZen('No step executed: game is not in playing state.');
      return false;
    }

    if (!this.ensureZenPlanFromCurrentState()) {
      const appendedBlacklisted = this.appendBlacklistedSeed(this.engine.currentSeed);
      this.logZen('No full no-undo plan for this run.');
      console.log(`[Zen dead end] seed:${this.engine.currentSeed} moves:${this.engine.moves} time:${this.engine.elapsedSeconds()}s`);
      if (appendedBlacklisted) {
        console.log(`[Zen list] appended BLACKLISTED_SEEDS seed:${this.engine.currentSeed}`);
      }
      if (this.zenAutoNewGameChk?.checked) {
        const nextSeed = this.pickNonBlacklistedSeed();
        console.log(`[Zen next] from:${this.engine.currentSeed} next:${nextSeed}`);
        this.logZen('Auto new game …');
        this.zen.logs = [];
        this.zenLog.textContent = 'Zen log';
        this.startFreshGame(nextSeed, null, { mode: 'infinity' });
        this.zen.running = true;
        this.syncZenButtons();
        this.logZen('Auto pilot continued on new game.');
        return true;
      }
      return false;
    }

    const step = this.zen.plannedSteps[this.zen.plannedIndex];
    if (!step) {
      this.logZen('Plan fully consumed.');
      return false;
    }

    if (step.type === 'deal') {
      const ok = this.engine.dealStock();
      if (!ok) return false;
      this.zen.plannedIndex += 1;
      this.logZen(`DEAL C0 -> C1,C2,C3 | score:${Math.round(step.score)}`);
      this.renderAll();
      return true;
    }

    return new Promise((resolve) => {
      const headCard = this.engine.state.columns[step.fromCol]?.[step.fromIndex];
      const headText = headCard ? ScorpionRules.cardText(headCard) : '?';
      this.board.animateAutoMove(step.fromCol, step.fromIndex, step.toCol, () => {
        const moved = this.engine.moveStack(step.fromCol, step.fromIndex, step.toCol);
        if (moved) {
          this.zen.plannedIndex += 1;
          this.logZen(`${headText}C${step.fromCol + 1} -> C${step.toCol + 1} | score:${Math.round(step.score)}`);
        }
        this.renderAll();
        resolve(moved);
      });
    });
  }

  getInitialDeckString(seed) {
    const deck = this.engine.createShuffledDeck(seed);
    return deck.map((card) => `${card.rank}${card.suit}`).join(' ');
  }

  getCurrentStateText() {
    const cols = this.engine.state.columns
      .map((col, i) => {
        const text = col.map((card) => `${card.rank}${card.suit}${card.faceUp ? '' : '*'}`).join(' ');
        return `C${i + 1}: ${text}`;
      })
      .join('\n');
    const stock = this.engine.state.stock.map((card) => `${card.rank}${card.suit}`).join(' ');
    return `seed:${this.engine.currentSeed}\n${cols}\nC0: ${stock}`;
  }

  downloadDeckAnalysis() {
    const seed = this.engine.currentSeed;
    const content = [
      `seed:${seed}`,
      `deck:${this.getInitialDeckString(seed)}`,
      `pilotWin:${this.zen.lastWinByAuto ? 'yes' : 'no'}`,
      `playerWin:${this.zen.lastWinByAuto ? 'no' : 'yes'}`,
      `noHungerHidden:${this.engine.countFaceDownTableau() === 0 ? 'yes' : 'partial'}`,
    ].join('\n');

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${seed}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  showWelcome() {
    if (this.welcomeDialog) {
      this.welcomeDialog.showModal();
    }
  }

  openLevelsDialog() {
    this.renderLevels();
    if (this.levelsDialog && !this.levelsDialog.open) {
      this.levelsDialog.showModal();
    }
  }

  registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    const buildVersion = document.querySelector('meta[name="app-build-version"]')?.getAttribute('content') || 'dev';
    navigator.serviceWorker.register(`./sw.js?build=${encodeURIComponent(buildVersion)}`).catch(() => {
      // Ignore SW registration failures.
    });
  }

  cardToRaw(card) {
    return {
      id: card.id,
      suit: card.suit,
      rank: card.rank,
      faceUp: card.faceUp,
    };
  }

  stateToRaw(state) {
    return {
      columns: state.columns.map((col) => col.map((card) => this.cardToRaw(card))),
      stock: state.stock.map((card) => this.cardToRaw(card)),
      completed: state.completed,
    };
  }

  rawToState(rawState) {
    const state = new BoardState();
    state.columns = rawState.columns.map((col) =>
      col.map((card) => new Card(card.id, card.suit, Number(card.rank), Boolean(card.faceUp))),
    );
    while (state.columns.length < 7) state.columns.push([]);
    state.columns = state.columns.slice(0, 7);
    state.stock = rawState.stock.map(
      (card) => new Card(card.id, card.suit, Number(card.rank), Boolean(card.faceUp)),
    );
    state.completed = Number(rawState.completed || 0);
    return state;
  }

  buildProgressSnapshot() {
    return {
      version: 1,
      state: this.stateToRaw(this.engine.state),
      initialState: this.stateToRaw(this.engine.initialState),
      history: this.engine.history.map((entry) => ({
        state: this.stateToRaw(entry.state),
        score: entry.score,
      })),
      moves: this.engine.moves,
      score: this.engine.score,
      currentSeed: this.engine.currentSeed,
      gameState: this.engine.gameState,
      elapsedSeconds: this.engine.elapsedSeconds(),
      campaignScore: this.campaignScore,
      lastScoreAtEnd: this.lastScoreAtEnd,
      notifiedState: this.notifiedState,
      hasSavedCurrentGame: this.hasSavedCurrentGame,
    };
  }

  persistProgress() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.buildProgressSnapshot()));
    } catch {
      // Ignore persistence errors.
    }
  }

  restoreProgress() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;

      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== 1 || !parsed.state || !parsed.initialState) {
        return false;
      }

      this.engine.state = this.rawToState(parsed.state);
      this.engine.initialState = this.rawToState(parsed.initialState);
      this.engine.history = Array.isArray(parsed.history)
        ? parsed.history.map((entry) => ({
            state: this.rawToState(entry.state),
            score: Number(entry.score || 0),
          }))
        : [];

      this.engine.moves = Number(parsed.moves || 0);
      this.engine.score = Number(parsed.score || 0);
      this.engine.currentSeed = Number(parsed.currentSeed || Date.now());
      this.engine.gameState = parsed.gameState || 'playing';

      const elapsed = Number(parsed.elapsedSeconds || 0);
      this.engine.startedAt = Date.now() - Math.max(0, elapsed) * 1000;

      this.campaignScore = Number(parsed.campaignScore || 0);
      this.lastScoreAtEnd = Number(parsed.lastScoreAtEnd || 0);
      this.notifiedState = parsed.notifiedState || 'playing';
      this.hasSavedCurrentGame = Boolean(parsed.hasSavedCurrentGame);
      return true;
    } catch {
      return false;
    }
  }

  getHighScores() {
    try {
      const raw = localStorage.getItem('scorpionHighScores');
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  renderHighScores() {
    const scores = this.getHighScores();
    this.highScoreList.innerHTML = '';

    if (scores.length === 0) {
      const empty = document.createElement('li');
      empty.textContent = 'No saved scores yet.';
      this.highScoreList.appendChild(empty);
      return;
    }

    scores.slice(0, 12).forEach((entry) => {
      const item = document.createElement('li');

      const row = document.createElement('div');
      row.className = 'score-row';

      const text = document.createElement('span');
      const seedText = entry.seed !== undefined ? entry.seed : 'n/a';
      text.textContent = `${entry.name} - ${entry.score} pts (${entry.time}) seed:${seedText}`;

      const replay = document.createElement('button');
      replay.type = 'button';
      replay.className = 'seed-btn';
      replay.dataset.seed = String(seedText);
      replay.textContent = 'Play Seed';

      row.appendChild(text);
      row.appendChild(replay);
      item.appendChild(row);
      this.highScoreList.appendChild(item);
    });
  }

  saveHighScore() {
    if (this.hasSavedCurrentGame) {
      return false;
    }

    const name = this.playerNameInput.value.trim() || 'Brave Player';
    const sec = this.engine.elapsedSeconds();
    const mm = String(Math.floor(sec / 60)).padStart(2, '0');
    const ss = String(sec % 60).padStart(2, '0');
    const time = `${mm}:${ss}`;

    const scores = this.getHighScores();
    scores.push({
      name,
      score: this.lastScoreAtEnd,
      time,
      seed: this.engine.currentSeed,
      at: new Date().toISOString(),
    });

    scores.sort((a, b) => b.score - a.score);
    localStorage.setItem('scorpionHighScores', JSON.stringify(scores.slice(0, 50)));
    return true;
  }

  maybeOpenEndDialogs(currentScore) {
    if (this.engine.gameState === this.notifiedState) return;

    this.notifiedState = this.engine.gameState;
    this.lastScoreAtEnd = this.campaignScore + currentScore;

    if (this.engine.gameState === 'won') {
      this.campaignScore += currentScore;
      this.recordPlayedGame('won');
      if (this.zen.running) {
        this.zen.lastWinByAuto = true;
      }
      this.recordCuratedLevelWin();
      if (this.zen.lastWinByAuto) {
        const appendedCurated = this.appendCuratedLevel(this.engine.currentSeed);
        if (appendedCurated) {
          console.log(`[Zen list] appended CURATED_LEVELS seed:${this.engine.currentSeed}`);
        }
      }
      this.renderLevels();
      this.winSummary.textContent = `Status: Won. Current score: ${this.campaignScore} pts.`;

      if (this.zen.running && this.zenAutoNewGameChk?.checked) {
        const nextSeed = this.pickNonBlacklistedSeed();
        console.log(`[Zen success] seed:${this.engine.currentSeed} moves:${this.engine.moves} time:${this.engine.elapsedSeconds()}s score:${currentScore}`);
        console.log(`[Zen next] from:${this.engine.currentSeed} next:${nextSeed}`);
        this.logZen('Solved. Auto new game …');
        this.zen.logs = [];
        this.zenLog.textContent = 'Zen log';
        this.startFreshGame(nextSeed, null, { mode: 'infinity' });
        this.zen.running = true;
        this.syncZenButtons();
        this.logZen('Auto pilot continued on new game after success.');
        return;
      }

      this.stopZenAuto();
      this.winDialog.showModal();
      return;
    }

    if (this.engine.gameState === 'stuck') {
      this.recordPlayedGame('stuck');
      this.renderLevels();
      this.gameOverSummary.textContent = `Final score: ${this.lastScoreAtEnd}. Save your high score!`;
      this.seedInput.value = String(this.engine.currentSeed);
      this.saveScoreBtn.disabled = this.hasSavedCurrentGame;
      this.stopZenAuto();
      this.renderHighScores();
      this.gameOverDialog.showModal();
    }
  }

  renderStatus() {
    this.engine.syncGameState();
    this.updateScorpionHelperIndicator();

    const gameScore = this.engine.calculateSequentialScore();
    this.scoreLabel.textContent = `${this.campaignScore + gameScore}`;
    this.movesLabel.textContent = String(this.engine.moves);

    const sec = this.engine.elapsedSeconds();
    const mm = String(Math.floor(sec / 60)).padStart(2, '0');
    const ss = String(sec % 60).padStart(2, '0');
    this.timeLabel.textContent = `${mm}:${ss}`;

    this.maybeOpenEndDialogs(gameScore);
  }

  renderAll() {
    this.renderStatus();
    this.board.draw();
    this.persistProgress();
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new App();
});
