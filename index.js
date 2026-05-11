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

    if (target.length === 0) {
      // Prevent no-op column swaps: a root King stack moved to an empty column is equivalent state.
      if (card.rank === 13 && fromIndex === 0) return false;
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
      this.pointer = this.getCanvasPos(event);
      this.updateHover();
      if (this.dragging) this.updateDropTarget();
      this.draw();
    });

    this.canvas.addEventListener('pointerdown', (event) => {
      const pos = this.getCanvasPos(event);
      this.pointer = pos;
      this.activePointerId = event.pointerId;
      this.canvas.setPointerCapture(event.pointerId);
      if (this.tryStockClick(pos)) return;
      this.startDrag(pos);
      this.draw();
    });

    this.canvas.addEventListener('pointerup', (event) => {
      this.finishDrag();
      if (this.activePointerId !== null) {
        this.canvas.releasePointerCapture(this.activePointerId);
        this.activePointerId = null;
      }
      this.draw();
    });

    this.canvas.addEventListener('pointerleave', () => {
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
      'C-1',
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

        const isTop = index === cards.length - 1;
        const cRect = this.getCardRect(col, index);
        let border = null;

        if (!this.dragging && this.hovered && this.hovered.col === col && this.hovered.index === index) {
          border = 'rgba(255,255,255,0.95)';
        }

        this.drawCard(card, cRect.x, cRect.y, isTop, border);
      });
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
    this.drawStateBadge();
  }
}

class App {
  constructor() {
    this.campaignScore = 0;
    this.lastScoreAtEnd = 0;
    this.notifiedState = 'playing';

    this.engine = new GameEngine();
    const resumed = this.restoreProgress();
    if (!resumed) {
      this.engine.startSingle();
    }

    this.canvas = document.getElementById('gameCanvas');
    this.board = new CanvasBoard(this.canvas, this.engine, () => this.renderAll());

    this.movesLabel = document.getElementById('movesLabel');
    this.timeLabel = document.getElementById('timeLabel');
    this.scoreLabel = document.getElementById('scoreLabel');

    this.hintDialog = document.getElementById('hintDialog');
    this.hintList = document.getElementById('hintList');

    this.welcomeDialog = document.getElementById('welcomeDialog');
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

    this.hasSavedCurrentGame = false;

    this.bindButtons();
    this.registerServiceWorker();
    this.showWelcome();
    this.renderHighScores();
    this.renderAll();

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

  bindButtons() {
    document.getElementById('newGameBtn').addEventListener('click', () => {
      this.engine.startSingle();
      this.campaignScore = 0;
      this.notifiedState = 'playing';
      this.hasSavedCurrentGame = false;
      this.renderAll();
    });

    document.getElementById('resetBtn').addEventListener('click', () => {
      this.engine.resetBoard();
      this.notifiedState = 'playing';
      this.hasSavedCurrentGame = false;
      this.renderAll();
    });

    document.getElementById('undoBtn').addEventListener('click', () => {
      this.engine.undo();
      this.notifiedState = 'playing';
      this.renderAll();
    });

    document.getElementById('hintBtn').addEventListener('click', () => {
      const moves = ScorpionRules.listMoves(this.engine.state.columns);
      if (moves.length === 0) {
        this.hintList.textContent = 'No legal moves right now.';
      } else {
        this.hintList.textContent = moves
          .slice(0, 180)
          .map((m, i) => {
            const target = this.engine.state.columns[m.toCol][this.engine.state.columns[m.toCol].length - 1];
            const targetText = target ? ScorpionRules.cardText(target) : 'Empty';
            return `${i + 1}. C${m.fromCol + 1} ${ScorpionRules.cardText(m.card)} -> C${m.toCol + 1} ${targetText}`;
          })
          .join('\n');
      }
      this.hintDialog.showModal();
    });

    document.getElementById('playNewDeckBtn').addEventListener('click', () => {
      this.engine.startSingle();
      this.notifiedState = 'playing';
      this.hasSavedCurrentGame = false;
      this.renderAll();
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
      this.campaignScore = 0;
      this.engine.startSingle();
      this.notifiedState = 'playing';
      this.hasSavedCurrentGame = false;
      this.gameOverDialog.close();
      this.renderAll();
    });

    this.playSeedBtn.addEventListener('click', () => {
      const seed = Number(this.seedInput.value.trim());
      if (!Number.isFinite(seed)) return;

      this.engine.startSingle(seed);
      this.campaignScore = 0;
      this.notifiedState = 'playing';
      this.hasSavedCurrentGame = false;
      this.gameOverDialog.close();
      this.renderAll();
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

      this.engine.startSingle(seed);
      this.campaignScore = 0;
      this.notifiedState = 'playing';
      this.hasSavedCurrentGame = false;
      this.gameOverDialog.close();
      this.renderAll();
    });

  }

  showWelcome() {
    if (this.welcomeDialog) {
      this.welcomeDialog.showModal();
    }
  }

  registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('./sw.js').catch(() => {
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
      this.winSummary.textContent = `Deck score: ${currentScore} pts. Total score: ${this.campaignScore} pts.`;
      this.winDialog.showModal();
      return;
    }

    if (this.engine.gameState === 'stuck') {
      this.gameOverSummary.textContent = `Final score: ${this.lastScoreAtEnd}. Save your high score!`;
      this.seedInput.value = String(this.engine.currentSeed);
      this.saveScoreBtn.disabled = this.hasSavedCurrentGame;
      this.renderHighScores();
      this.gameOverDialog.showModal();
    }
  }

  renderStatus() {
    this.engine.syncGameState();

    const gameScore = this.engine.calculateSequentialScore();
    this.scoreLabel.textContent = `${gameScore}`;
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
