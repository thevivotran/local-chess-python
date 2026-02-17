const socket = io();

let gameId = null;
let playerNumber = null;
let playerColor = null;
let board = null;
let playerIndex = null;
let currentPlayerTurn = 0;
let username = null;
let opponentUsername = null;
let isGameOver = false;
let lastMove = null;
let connectionStatus = 'connecting';
let soundEnabled = localStorage.getItem('chessSoundEnabled') !== 'false';

// Captured pieces tracking
let capturedPieces = { 'white': [], 'black': [] };

// Update captured pieces display using custom DOM elements
function updateCapturedPiecesDisplay() {
    const leftCapturesEl = document.getElementById('captured-by-white');
    const rightCapturesEl = document.getElementById('captured-by-black');
    
    // capturedPieces.white = white pieces captured by black
    // capturedPieces.black = black pieces captured by white
    const whitePiecesCaptured = capturedPieces.white || [];
    const blackPiecesCaptured = capturedPieces.black || [];
    
    // Determine pieces based on current player's color
    const isWhitePlayer = playerColor === 'white';
    
    // LEFT side: What YOU captured (opponent's pieces)
    // If you play white, you captured black pieces -> show as black
    // If you play black, you captured white pieces -> show as white
    const yourCaptured = isWhitePlayer ? blackPiecesCaptured : whitePiecesCaptured;
    const yourPieceColor = isWhitePlayer ? 'b' : 'w';
    
    // RIGHT side: What OPPONENT captured (your pieces)
    // If you play white, opponent captured white pieces -> show as white
    // If you play black, opponent captured black pieces -> show as black
    const opponentCaptured = isWhitePlayer ? whitePiecesCaptured : blackPiecesCaptured;
    const opponentPieceColor = isWhitePlayer ? 'w' : 'b';
    
    // Left: your captures
    if (leftCapturesEl) {
        leftCapturesEl.innerHTML = yourCaptured.map(p => 
            `<img src="/static/img/chesspieces/wikipedia/${yourPieceColor}${p.type.toUpperCase()}.png" class="captured-piece-img" alt="${p.type}">`
        ).join('');
    }
    
    // Right: opponent's captures
    if (rightCapturesEl) {
        rightCapturesEl.innerHTML = opponentCaptured.map(p => 
            `<img src="/static/img/chesspieces/wikipedia/${opponentPieceColor}${p.type.toUpperCase()}.png" class="captured-piece-img" alt="${p.type}">`
        ).join('');
    }
    
    console.log('Updated captured pieces - you are:', playerColor, 'your captured:', yourCaptured, 'opponent captured:', opponentCaptured);
}

// Clear captured pieces display
function clearCapturedPieces() {
    const whiteCapturesEl = document.getElementById('captured-by-white');
    const blackCapturesEl = document.getElementById('captured-by-black');
    
    if (whiteCapturesEl) whiteCapturesEl.innerHTML = '';
    if (blackCapturesEl) blackCapturesEl.innerHTML = '';
}

// Toast notification system
function showToast(message, type = 'info', duration = 4000) {
  const existing = document.querySelector('.toast-container');
  if (existing) existing.remove();

  const container = document.createElement('div');
  container.className = 'toast-container';
  
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${type === 'success' ? '✓' : type === 'error' ? '✗' : type === 'warning' ? '⚠' : 'ℹ'}</span>
    <span class="toast-message">${message}</span>
    <button class="toast-close" onclick="this.parentElement.remove()">×</button>
  `;
  
  container.appendChild(toast);
  document.body.appendChild(container);
  
  setTimeout(() => {
    if (toast.parentElement) toast.remove();
  }, duration);
}

// Connection status indicator
function updateConnectionStatus(status) {
  connectionStatus = status;
  const indicator = document.getElementById('connectionIndicator');
  if (indicator) {
    indicator.className = `connection-indicator connection-${status}`;
  }
}

// Play sound
function playSound(type) {
  if (!soundEnabled) return;
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    if (type === 'move') {
      oscillator.frequency.value = 800;
      gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
    } else if (type === 'capture') {
      oscillator.frequency.value = 400;
      gainNode.gain.setValueAtTime(0.15, audioCtx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.15);
    } else if (type === 'check') {
      oscillator.frequency.value = 1000;
      gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
      oscillator.frequency.setValueAtTime(1200, audioCtx.currentTime + 0.1);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
    }
    
    oscillator.start();
    oscillator.stop(audioCtx.currentTime + 0.3);
  } catch (e) {}
}

// Check URL for game invite
function checkUrlForInvite() {
  const urlParams = new URLSearchParams(window.location.search);
  const inviteGameId = urlParams.get('game');
  if (inviteGameId) {
    document.getElementById('joinGameId').value = inviteGameId;
    return true;
  }
  return false;
}

// Initialize Chessboard.js with best practices from chessboard.js docs
function initializeBoard() {
  console.log('Initializing board with color:', playerColor);
  
  const boardElement = document.getElementById('board');
  if (!boardElement) {
    console.error('Board element not found in DOM');
    return;
  }
  
  if (typeof Chessboard === 'undefined') {
    console.error('Chessboard library not loaded');
    return;
  }
  
  // Chessboard.js best practice: use animation speeds for smoother UX
  const config = {
    position: 'start',
    orientation: playerColor === 'white' ? 'white' : 'black',
    draggable: true,
    dropOffBoard: 'snapback',
    showNotation: true,  // Show file/rank notation
    appearSpeed: 200,    // Piece appear animation speed
    moveSpeed: 200,      // Piece move animation speed  
    snapSpeed: 25,        // Piece snap to square speed
    snapbackSpeed: 50,   // Snapback animation speed
    trashSpeed: 100,     // Piece removal speed
    
    // Event handlers - chessboard.js best practice
    onDragStart: onDragStart,
    onDragMove: onDragMove,
    onDrop: onDrop,
    onSnapbackEnd: onSnapbackEnd,
    onSnapEnd: onSnapEnd,
    onMouseoverSquare: onMouseoverSquare,
    onMouseoutSquare: onMouseoutSquare,
    onChange: onChange,
    
    // Custom piece theme
    pieceTheme: '/static/img/chesspieces/wikipedia/{piece}.png',
    
    // Error handling best practice
    showErrors: 'console'
  };
  
  try {
    board = Chessboard('board', config);
    console.log('Board initialized successfully:', board);
  } catch (e) {
    console.error('Error initializing board:', e);
  }

  if (boardElement) {
    boardElement.addEventListener('touchmove', function(e) { e.preventDefault(); }, { passive: false });
  }
  
  // Best practice: use resize() to recalculate board size
  setTimeout(() => {
    try {
      if (board && typeof board.resize === 'function') board.resize();
    } catch (e) {}
  }, 50);

  // Best practice: handle window resize
  window.addEventListener('resize', debounce(function() {
    try {
      if (board && typeof board.resize === 'function') board.resize();
    } catch (e) {}
  }, 250));
}

// Utility: debounce function for resize handler
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

function isPlayersTurn() {
  return (playerIndex !== null && currentPlayerTurn === playerIndex);
}

function onDragStart(source, piece, position, orientation) {
  if (isGameOver) return false;
  if (!isPlayersTurn()) return false;
  if (!playerColor || !piece) return false;
  
  const pieceColorChar = piece.charAt(0);
  const expected = playerColor === 'white' ? 'w' : 'b';
  if (pieceColorChar !== expected) return false;

  return true;
}

// Best practice: onDragMove - fires while piece is being dragged
function onDragMove(newLocation, oldLocation, source, piece, position, orientation) {
  // Could add visual feedback during drag (like ghost piece)
  // For now, we just log for debugging
  // console.log('Drag move:', source, '->', newLocation);
}

// Best practice: onSnapbackEnd - fires when snapback animation completes
function onSnapbackEnd(piece, square, position, orientation) {
  // Reset any visual feedback
  // console.log('Snapback ended for piece:', piece, 'at', square);
}

// Best practice: onSnapEnd - fires when piece snap animation completes (important for move sync!)
function onSnapEnd(source, target, piece) {
  // This is the official move completion event from chessboard.js
  // The move has been animated to the target square
  // We can use this to sync with server or update game state
  console.log('Snap ended:', source, '->', target, 'piece:', piece);
}

// Best practice: flip board orientation (common chessboard.js feature)
function flipBoard() {
  if (board && typeof board.flip === 'function') {
    board.flip();
  }
}

// Share current game link
function shareCurrentGame() {
  if (!gameId) {
    showToast('No active game to share', 'warning');
    return;
  }
  
  const shareableLink = window.location.origin + window.location.pathname + '?game=' + gameId;
  showShareableLink(shareableLink);
}

// Highlight valid moves
function onMouseoverSquare(square, piece) {
  if (!board || isGameOver) return;
  
  const chess = new Chess(board.position());
  const moves = chess.moves({ square: square, verbose: true });
  
  moves.forEach(move => {
    const squareEl = document.querySelector(`.square-${move.to}`);
    if (squareEl) squareEl.classList.add('highlight-valid');
  });
}

function onMouseoutSquare(square, piece) {
  document.querySelectorAll('.highlight-valid').forEach(el => {
    el.classList.remove('highlight-valid');
  });
}

// Best practice: onChange - fires when board position changes (via animation or API)
function onChange(oldPosition, newPosition) {
  // Note: Don't call position-changing methods here (clear, move, position, start)
  // as it will cause an infinite loop
  // console.log('Position changed from', oldPosition, 'to', newPosition);
}

let currentFEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
let pendingPromotionMove = null;

function isPawnPromotion(source, target) {
  const chessBoard = new Chess(currentFEN);
  const piece = chessBoard.get(source);
  if (!piece || piece.type !== 'p') return false;
  
  const targetRank = target.charAt(1);
  if (piece.color === 'w' && targetRank === '8') return true;
  if (piece.color === 'b' && targetRank === '1') return true;
  return false;
}

function cancelPendingPromotion() {
  if (pendingPromotionMove) {
    pendingPromotionMove = null;
    const dialog = document.getElementById('promotion-dialog');
    if (dialog) dialog.remove();
  }
}

function showPromotionDialog(color) {
  const existing = document.getElementById('promotion-dialog');
  if (existing) existing.remove();
  
  const dialog = document.createElement('div');
  dialog.id = 'promotion-dialog';
  dialog.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);display:flex;justify-content:center;align-items:center;z-index:1000;';
  
  const pieces = ['q', 'r', 'b', 'n'];
  
  dialog.innerHTML = `
    <div style="background:linear-gradient(135deg,#667eea,#764ba2);padding:30px;border-radius:16px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.4);max-width:350px;">
      <h3 style="margin-bottom:20px;color:white;">Choose Promotion Piece</h3>
      <div style="display:flex;gap:12px;justify-content:center;">
        ${pieces.map(p => `
          <button onclick="selectPromotion('${p}')" style="width:70px;height:70px;font-size:40px;background:white;border:3px solid rgba(255,255,255,0.3);border-radius:12px;cursor:pointer;color:#333;">
            ${color === 'w' ? p.toUpperCase() : p}
          </button>
        `).join('')}
      </div>
    </div>
  `;
  
  document.body.appendChild(dialog);
  dialog.onclick = (e) => { if (e.target === dialog) cancelPendingPromotion(); };
}

function selectPromotion(piece) {
  const dialog = document.getElementById('promotion-dialog');
  if (dialog) dialog.remove();
  
  if (pendingPromotionMove) {
    const { source, target } = pendingPromotionMove;
    const chessBoard = new Chess(currentFEN);
    
    const moveObj = chessBoard.move({ from: source, to: target, promotion: piece });
    if (moveObj !== null) {
      currentFEN = chessBoard.fen();
      const uciMove = source + target + piece;
      console.log('Sending promotion move:', uciMove);
      socket.emit('make_move', { move: uciMove });
    }
    pendingPromotionMove = null;
  }
}

function onDrop(source, target) {
  cancelPendingPromotion();
  
  // Game over or not your turn - return piece to source
  if (isGameOver) return 'snapback';
  if (!isPlayersTurn()) return 'snapback';
  if (source === target) return 'snapback';
  
  // Get piece at source
  const chessBoard = new Chess(currentFEN);
  const piece = chessBoard.get(source);
  if (!piece) return 'snapback';
  
  // Check if piece belongs to current player
  const pieceColorChar = piece.color;
  const expected = playerColor === 'white' ? 'w' : 'b';
  if (pieceColorChar !== expected) return 'snapback';
  
  // Check if move is legal using chess.js (best practice: validate before sending to server)
  const testMove = chessBoard.move({ from: source, to: target, promotion: 'q' });
  if (testMove === null) return 'snapback';
  chessBoard.undo();
  
  // Handle pawn promotion - show dialog and return piece to source temporarily
  if (isPawnPromotion(source, target)) {
    pendingPromotionMove = { source, target };
    showPromotionDialog(piece.color);
    return 'snapback';
  }
  
  // Make the move locally
  const moveObj = chessBoard.move({ from: source, to: target });
  if (moveObj === null) return 'snapback';
  
  // Update local state
  currentFEN = chessBoard.fen();
  const uciMove = source + target;
  console.log('Sending move:', uciMove);
  
  // Send to server - return 'trash' to let chessboard.js animate the piece to target
  // The server will confirm and we update from there
  socket.emit('make_move', { move: uciMove });
  
  // Best practice: return 'trash' to allow animation, 'snapback' to return piece
  return 'trash';
}

// Best practice: update board with proper error handling
function updateBoard(fen, animated = true) {
  // console.log('Updating board with FEN:', fen);
  currentFEN = fen;
  try {
    if (board) {
      // Use the position() method - this is the chessboard.js best practice
      board.position(fen, animated);
    }
  } catch (e) {
    console.error('Error updating board position:', e);
  }
}

// Best practice: get current board position as FEN
function getBoardPosition() {
  try {
    if (board && typeof board.fen === 'function') {
      return board.fen();
    } else if (board && typeof board.position === 'function') {
      return board.position('fen');
    }
  } catch (e) {
    console.error('Error getting board position:', e);
  }
  return currentFEN;
}

// Highlight last move
function highlightLastMove(from, to) {
  document.querySelectorAll('.highlight-last-move').forEach(el => el.classList.remove('highlight-last-move'));
  if (!from || !to) return;
  [from, to].forEach(sq => {
    const el = document.querySelector(`.square-${sq}`);
    if (el) el.classList.add('highlight-last-move');
  });
}

// Game timer
let gameStartTime = null;
function updateGameTimer() {
  if (!gameStartTime || isGameOver) return;
  const elapsed = Math.floor((Date.now() - gameStartTime) / 1000);
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  const timerEl = document.getElementById('gameTimer');
  if (timerEl) timerEl.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

// Socket.io event handlers
socket.on('connect', function() {
  console.log('Connected to server');
  updateConnectionStatus('connected');
  showToast('Connected to server', 'success', 2000);
});

socket.on('disconnect', function() {
  console.log('Disconnected from server');
  updateConnectionStatus('disconnected');
  showToast('Disconnected from server', 'error');
});

socket.on('reconnecting', function(attempt) {
  updateConnectionStatus('reconnecting');
});

socket.on('connect_response', function(data) {
  console.log('Server response:', data);
});

// Show shareable link dialog
function showShareableLink(link) {
  const existing = document.getElementById('shareDialog');
  if (existing) existing.remove();
  
  const dialog = document.createElement('div');
  dialog.id = 'shareDialog';
  dialog.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);display:flex;justify-content:center;align-items:center;z-index:2000;';
  
  // Check if Web Share API is available (mobile)
  const canShare = navigator.share && navigator.canShare && navigator.canShare({
    title: 'Join my Chess Game!',
    text: 'Play chess with me!',
    url: link
  });
  
  const shareButtonHtml = canShare ? `
    <button onclick="shareLink('${link}')" style="padding:14px 24px;background:#10b981;color:white;border:none;border-radius:8px;cursor:pointer;font-weight:600;font-size:1em;width:100%;margin-bottom:12px;">
      📤 Share Link
    </button>
  ` : '';
  
  dialog.innerHTML = `
    <div style="background:white;padding:35px;border-radius:16px;text-align:center;max-width:400px;width:90%;">
      <h3 style="margin-bottom:20px;color:#333;">Invite a Friend! 👋</h3>
      <p style="margin-bottom:15px;color:#666;">Share this link to invite your friend:</p>
      <div style="display:flex;gap:10px;margin-bottom:15px;">
        <input type="text" id="shareLinkInput" value="${link}" readonly style="flex:1;padding:12px;border:2px solid #ddd;border-radius:8px;font-family:monospace;font-size:0.8em;">
        <button onclick="copyShareLink()" style="padding:12px 16px;background:#667eea;color:white;border:none;border-radius:8px;cursor:pointer;font-weight:600;">📋</button>
      </div>
      ${shareButtonHtml}
      <button onclick="closeShareDialog()" style="padding:12px 40px;background:#764ba2;color:white;border:none;border-radius:8px;cursor:pointer;width:100%;">Got it!</button>
    </div>
  `;
  
  document.body.appendChild(dialog);
  dialog.onclick = (e) => { if (e.target === dialog) closeShareDialog(); };
}

function copyShareLink() {
  const input = document.getElementById('shareLinkInput');
  input.select();
  navigator.clipboard.writeText(input.value).then(function() {
    const btn = event.target;
    btn.textContent = '✓';
    setTimeout(() => btn.textContent = '📋', 2000);
    showToast('Link copied to clipboard!', 'success', 2000);
  });
}

function shareLink(link) {
  if (navigator.share) {
    navigator.share({
      title: 'Join my Chess Game!',
      text: 'Let\'s play chess! Click to join:',
      url: link
    }).then(() => {
      console.log('Link shared successfully');
    }).catch((error) => {
      console.log('Error sharing:', error);
      // Fallback to copy
      copyShareLink();
    });
  } else {
    // Fallback for desktop
    copyShareLink();
  }
}

function closeShareDialog() {
  const dialog = document.getElementById('shareDialog');
  if (dialog) dialog.remove();
}

socket.on('game_created', function(data) {
  gameId = data.game_id;
  playerNumber = data.player_number;
  playerColor = data.color;
  playerIndex = playerNumber - 1;
  username = data.username;
  isGameOver = false;
  lastMove = null;
  gameStartTime = Date.now();
  
  console.log('Game created:', gameId);
  
  document.getElementById('gameId').textContent = gameId.substring(0, 8) + '...';
  document.getElementById('playerColor').textContent = playerColor.toUpperCase();
  document.getElementById('status').innerHTML = '<span class="status-waiting">Waiting for opponent...</span>';
  
  const shareableLink = window.location.origin + window.location.pathname + '?game=' + gameId;
  updateUI('waiting');
  showShareableLink(shareableLink);
  
  setInterval(updateGameTimer, 1000);
});

socket.on('game_joined', function(data) {
  gameId = data.game_id;
  playerNumber = data.player_number;
  playerColor = data.color;
  playerIndex = playerNumber - 1;
  opponentUsername = data.opponent_username;
  isGameOver = false;
  lastMove = null;
  gameStartTime = Date.now();
  
  console.log('Game joined:', gameId);
  
  document.getElementById('gameId').textContent = gameId.substring(0, 8) + '...';
  document.getElementById('playerColor').textContent = playerColor.toUpperCase();
  document.getElementById('opponentName').textContent = opponentUsername || 'Waiting...';
  document.getElementById('status').innerHTML = 'Opponent joining...';
  
  updateUI('playing');
  setTimeout(() => { initializeBoard(); socket.emit('get_board_state'); }, 100);
  setInterval(updateGameTimer, 1000);
});

socket.on('opponent_joined', function(data) {
  console.log('Opponent joined');
  opponentUsername = data.opponent_username;
  document.getElementById('opponentName').textContent = opponentUsername || 'Unknown';
  document.getElementById('status').innerHTML = 'Game Started! White to move.';
  currentPlayerTurn = 0;
  
  if (!board) setTimeout(() => { initializeBoard(); updateBoard(data.board_fen, false); }, 100);
  else updateBoard(data.board_fen, false);
  
  // Update captured pieces display if any
  if (data.captured_pieces) {
    capturedPieces = data.captured_pieces;
    updateCapturedPiecesDisplay();
  }
});

socket.on('move_made', function(data) {
  console.log('Move made:', data.move);
  
  if (data.is_capture) playSound('capture');
  else if (data.is_check) playSound('check');
  else playSound('move');
  
  if (data.from && data.to) highlightLastMove(data.from, data.to);
  
  updateBoard(data.board_fen);
  currentPlayerTurn = data.current_player;
  
  // Update captured pieces display using chessboard.js spare pieces
  if (data.captured_pieces) {
    capturedPieces = data.captured_pieces;
    updateCapturedPiecesDisplay();
  }

  let status = '';
  let statusClass = 'status-playing';
  
  if (data.is_checkmate) {
    isGameOver = true;
    const winnerIndex = 1 - data.current_player;
    const winnerColor = winnerIndex === 0 ? 'White' : 'Black';
    if (playerIndex === winnerIndex) {
      status = `🏆 Checkmate! You won as ${winnerColor}!`;
      statusClass = 'status-win';
      showToast('Congratulations! You won!', 'success');
    } else {
      status = `💔 Checkmate! You lost — ${winnerColor} wins.`;
      statusClass = 'status-lose';
    }
    document.getElementById('resetBtn').style.display = 'block';
  } else if (data.is_draw) {
    isGameOver = true;
    if (data.is_stalemate) status = 'Stalemate! Draw.';
    else if (data.is_insufficient_material) status = 'Draw by insufficient material.';
    else if (data.is_repetition) status = 'Draw by threefold repetition.';
    else if (data.is_fivefold_repetition) status = 'Draw by fivefold repetition.';
    else if (data.is_seventyfive_moves) status = 'Draw by 75-move rule.';
    else if (data.is_fifty_moves) status = 'Draw by 50-move rule.';
    else status = 'Draw!';
    statusClass = 'status-draw';
    showToast('Draw!', 'info');
    document.getElementById('resetBtn').style.display = 'block';
  } else if (data.is_check) {
    status = 'Check! ' + (data.current_player === 0 ? 'White' : 'Black') + ' to move.';
    statusClass = 'status-check';
  } else {
    status = (data.current_player === 0 ? 'White' : 'Black') + ' to move.';
  }

  document.getElementById('status').innerHTML = `<span class="${statusClass}">${status}</span>`;
  
  // Update move history with proper DOM manipulation
  const moveHistoryDiv = document.getElementById('moveHistory');
  const moveCount = moveHistoryDiv.children.length;
  const moveNumber = Math.floor(moveCount / 2) + 1;
  const isWhiteMove = moveCount % 2 === 0;
  
  if (isWhiteMove) {
    // Create new row for white's move
    const newRow = document.createElement('div');
    newRow.className = 'move-pair';
    newRow.innerHTML = `
      <span class="move-num">${moveNumber}.</span>
      <span class="move-white">${data.move}</span>
      <span class="move-black">-</span>
    `;
    moveHistoryDiv.appendChild(newRow);
  } else {
    // Update existing row with black's move
    const lastRow = moveHistoryDiv.lastElementChild;
    if (lastRow) {
      const blackMove = lastRow.querySelector('.move-black');
      if (blackMove) {
        blackMove.textContent = data.move;
        blackMove.classList.remove('move-black');
        blackMove.classList.add('move-black', 'filled');
      }
    }
  }
  
  // Auto-scroll to bottom after adding move
  requestAnimationFrame(() => {
    moveHistoryDiv.scrollTop = moveHistoryDiv.scrollHeight;
  });
});

socket.on('board_state', function(data) {
  console.log('Board state received');
  if (!board) setTimeout(() => { initializeBoard(); updateBoard(data.board_fen, false); }, 100);
  else updateBoard(data.board_fen, false);
  
  currentPlayerTurn = data.current_player;
  if (data.usernames) {
    opponentUsername = data.usernames[1 - data.player_index];
    document.getElementById('opponentName').textContent = opponentUsername || 'Waiting...';
  }
  
  // Update captured pieces display
  if (data.captured_pieces) {
    capturedPieces = data.captured_pieces;
    updateCapturedPiecesDisplay();
  }
});

socket.on('game_reset', function(data) {
  console.log('Game reset');
  cancelPendingPromotion();
  currentFEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  currentPlayerTurn = 0;
  pendingPromotionMove = null;
  isGameOver = false;
  lastMove = null;
  gameStartTime = Date.now();
  capturedPieces = { 'white': [], 'black': [] };
  drawOfferSent = false;
  closeDrawOfferDialog();
  
  document.querySelectorAll('.highlight-last-move').forEach(el => el.classList.remove('highlight-last-move'));
  
  updateBoard(data.board_fen, false);
  clearCapturedPieces();
  // Clear move history efficiently
  const moveHistoryDiv = document.getElementById('moveHistory');
  if (moveHistoryDiv) moveHistoryDiv.innerHTML = '';
  document.getElementById('status').innerHTML = data.message;
  document.getElementById('resetBtn').style.display = 'none';
});

socket.on('opponent_left', function(data) {
  console.log('Opponent left:', data.message);
  showToast(data.message || 'Opponent left the game', 'warning');
  document.getElementById('status').innerHTML = data.message || 'Opponent left';
  drawOfferSent = false;
  closeDrawOfferDialog();
  updateUI('opponent-left');
});

socket.on('error', function(data) {
  console.error('Error:', data.message);
  
  const errorMessages = {
    'NOT_IN_GAME': 'You are not in a game',
    'GAME_NOT_FOUND': 'Game not found or expired',
    'NOT_YOUR_TURN': 'Not your turn',
    'ILLEGAL_MOVE': 'That move is not legal',
    'KING_IN_CHECK': 'Move would leave your king in check',
    'PROMOTION_REQUIRED': 'Pawn must be promoted',
    'WAITING_FOR_OPPONENT': 'Waiting for opponent to join'
  };
  
  showToast(errorMessages[data.code] || data.message, 'error');
  
  if (data.code === 'GAME_NOT_FOUND') {
    if (confirm('Game expired or not found. Return to main menu?')) resetGame();
  }
});

socket.on('game_ended', function(data) {
  isGameOver = true;
  drawOfferSent = false;
  closeDrawOfferDialog();
  
  if (data.result === 'draw') {
    showToast('Game ended in a draw!', 'info');
    document.getElementById('status').innerHTML = `<span class="status-draw">${data.message}</span>`;
  } else if (data.result === 'resignation') {
    if (data.winner === username) {
      showToast('You won! Opponent resigned.', 'success');
      document.getElementById('status').innerHTML = `<span class="status-win">You won! ${data.loser} resigned.</span>`;
    } else {
      showToast('You resigned.', 'info');
      document.getElementById('status').innerHTML = `<span class="status-lose">You resigned. ${data.winner} wins!</span>`;
    }
  }
  document.getElementById('resetBtn').style.display = 'block';
});

socket.on('draw_offered', function(data) {
  // Show draw offer dialog with accept/decline buttons
  const existingDialog = document.getElementById('drawOfferDialog');
  if (existingDialog) existingDialog.remove();
  
  // Don't show dialog if we already have one
  if (document.getElementById('drawOfferDialog')) return;
  
  const dialog = document.createElement('div');
  dialog.id = 'drawOfferDialog';
  dialog.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);display:flex;justify-content:center;align-items:center;z-index:3000;';
  
  const isOurOffer = data.offered_by === username;
  
  dialog.innerHTML = `
    <div style="background:white;padding:30px;border-radius:16px;text-align:center;max-width:400px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.4);">
      <h3 style="margin-bottom:15px;color:#333;">${isOurOffer ? 'Draw Offer Sent' : 'Draw Offer Received'}</h3>
      <p style="margin-bottom:25px;color:#666;">${isOurOffer ? 'Waiting for opponent to accept...' : `${data.offered_by} offered a draw. Do you accept?`}</p>
      ${!isOurOffer ? `
        <div style="display:flex;gap:15px;justify-content:center;">
          <button id="acceptDrawBtn" style="padding:12px 30px;background:#10b981;color:white;border:none;border-radius:8px;cursor:pointer;font-weight:600;font-size:1em;">✓ Accept</button>
          <button id="declineDrawBtn" style="padding:12px 30px;background:#ef4444;color:white;border:none;border-radius:8px;cursor:pointer;font-weight:600;font-size:1em;">✗ Decline</button>
        </div>
      ` : `
        <button onclick="closeDrawOfferDialog()" style="padding:12px 30px;background:#6b7280;color:white;border:none;border-radius:8px;cursor:pointer;font-weight:600;font-size:1em;">Cancel Offer</button>
      `}
    </div>
  `;
  
  document.body.appendChild(dialog);
  
  // Add event listeners
  if (!isOurOffer) {
    document.getElementById('acceptDrawBtn').addEventListener('click', function() {
      socket.emit('accept_draw');
      closeDrawOfferDialog();
      showToast('Draw accepted!', 'success');
    });
    
    document.getElementById('declineDrawBtn').addEventListener('click', function() {
      closeDrawOfferDialog();
      showToast('Draw declined', 'info');
      // Optionally notify the offerer that their offer was declined
    });
  }
});

function closeDrawOfferDialog() {
  const dialog = document.getElementById('drawOfferDialog');
  if (dialog) dialog.remove();
}

socket.on('left_game', function(data) {
  showToast(data.message, 'info');
});

// UI Functions
function updateUI(state) {
  const menuContainer = document.getElementById('menuContainer');
  const gameContainer = document.getElementById('gameContainer');
  
  if (state === 'menu') {
    menuContainer.style.display = 'flex';
    gameContainer.style.display = 'none';
  } else if (state === 'waiting' || state === 'playing') {
    menuContainer.style.display = 'none';
    gameContainer.style.display = 'flex';
  } else if (state === 'opponent-left') {
    menuContainer.style.display = 'none';
    gameContainer.style.display = 'flex';
    document.getElementById('resetBtn').style.display = 'block';
  }
}

function createGame() {
  const usernameInput = document.getElementById('createUsername');
  let name = usernameInput.value.trim();
  
  if (!name) {
    showToast('Please enter a username', 'warning');
    return;
  }
  if (name.length > 20) name = name.substring(0, 20);
  
  username = name;
  console.log('Creating game with username:', username);
  socket.emit('create_game', { username: username });
}

function joinGame() {
  const usernameInput = document.getElementById('joinUsername');
  const gameIdInput = document.getElementById('joinGameId');
  let name = usernameInput.value.trim() || 'Player 2';
  const gameIdVal = gameIdInput.value.trim();
  
  if (!gameIdVal) {
    showToast('Please enter a game ID', 'warning');
    return;
  }
  if (name.length > 20) name = name.substring(0, 20);
  
  username = name;
  console.log('Joining game:', gameIdVal, 'as', username);
  socket.emit('join_game', { game_id: gameIdVal, username: username });
}

// Best practice: destroy board properly to prevent memory leaks
function destroyBoard() {
  try {
    if (board && typeof board.destroy === 'function') {
      board.destroy();
      board = null;
      console.log('Board destroyed');
    }
  } catch (e) {
    console.error('Error destroying board:', e);
  }
}

function resetGame() {
  console.log('Resetting game...');
  if (gameId) socket.emit('leave_game');
  
  gameId = null;
  playerNumber = null;
  playerColor = null;
  playerIndex = null;
  currentPlayerTurn = 0;
  opponentUsername = null;
  isGameOver = false;
  lastMove = null;
  gameStartTime = null;
  currentFEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  
  // Best practice: reset board to start position
  if (board) {
    try {
      board.position('start');
    } catch (e) {
      console.error('Error resetting board:', e);
    }
  }
  
  window.history.replaceState({}, document.title, window.location.pathname);
  
  document.getElementById('gameId').textContent = '-';
  document.getElementById('playerColor').textContent = '-';
  document.getElementById('opponentName').textContent = 'Waiting...';
  // Clear move history efficiently
  const moveHistoryDiv = document.getElementById('moveHistory');
  if (moveHistoryDiv) moveHistoryDiv.innerHTML = '';
  document.getElementById('status').innerHTML = 'Connecting...';
  document.getElementById('resetBtn').style.display = 'none';
  document.getElementById('gameTimer').textContent = '00:00';
  
  // Clear captured pieces display
  clearCapturedPieces();
  capturedPieces = { 'white': [], 'black': [] };
  drawOfferSent = false;
  closeDrawOfferDialog();
  
  updateUI('menu');
}

// Track draw offer state
let drawOfferSent = false;

function offerDraw() {
  if (drawOfferSent) {
    showToast('You already have a pending draw offer', 'warning');
    return;
  }
  drawOfferSent = true;
  socket.emit('request_draw', { reason: 'offer' });
  showToast('Draw offer sent', 'info');
}

function acceptDraw() {
  socket.emit('accept_draw');
}

function resign() {
  if (confirm('Are you sure you want to resign?')) {
    socket.emit('resign');
  }
}

function toggleSound() {
  soundEnabled = !soundEnabled;
  localStorage.setItem('chessSoundEnabled', soundEnabled);
  showToast(soundEnabled ? 'Sound enabled' : 'Sound disabled', 'info', 2000);
}

async function showLeaderboard() {
  try {
    const response = await fetch('/api/leaderboard');
    const leaderboard = await response.json();
    displayLeaderboardModal(leaderboard);
  } catch (error) {
    console.error('Failed to load leaderboard:', error);
    showToast('Failed to load leaderboard', 'error');
  }
}

function displayLeaderboardModal(leaderboard) {
  const existingDialog = document.getElementById('leaderboardDialog');
  if (existingDialog) existingDialog.remove();
  
  const dialog = document.createElement('div');
  dialog.id = 'leaderboardDialog';
  dialog.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);display:flex;justify-content:center;align-items:center;z-index:2000;';
  
  const players = Object.entries(leaderboard);
  let leaderboardHTML = '';
  
  if (players.length === 0) {
    leaderboardHTML = '<p style="color:#666;text-align:center;padding:20px;">No games played yet.</p>';
  } else {
    let rowsHTML = '';
    players.forEach(function(player, index) {
      const name = player[0];
      const stats = player[1];
      const totalGames = stats.total_games || (stats.wins + stats.losses) || 1;
      const winRate = totalGames > 0 ? ((stats.wins / totalGames) * 100).toFixed(1) : 0;
      const bgColor = index % 2 === 0 ? '#f8f8f8' : 'white';
      const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '#' + (index + 1);
      rowsHTML += `<tr style="background:${bgColor};"><td style="padding:12px;border-bottom:1px solid #ddd;font-weight:bold;color:#667eea;">${medal}</td><td style="padding:12px;border-bottom:1px solid #ddd;">${name}</td><td style="padding:12px;border-bottom:1px solid #ddd;text-align:center;color:#27ae60;font-weight:600;">${stats.wins || 0}</td><td style="padding:12px;border-bottom:1px solid #ddd;text-align:center;color:#e74c3c;">${stats.losses || 0}</td><td style="padding:12px;border-bottom:1px solid #ddd;text-align:center;font-weight:600;">${winRate}%</td></tr>`;
    });
    leaderboardHTML = '<table style="width:100%;border-collapse:collapse;"><thead><tr style="background:#667eea;color:white;"><th style="padding:12px;text-align:left;border-radius:8px 0 0 0;">Rank</th><th style="padding:12px;text-align:left;">Player</th><th style="padding:12px;text-align:center;">Wins</th><th style="padding:12px;text-align:center;">Losses</th><th style="padding:12px;text-align:center;border-radius:0 8px 0 0;">Win Rate</th></tr></thead><tbody>' + rowsHTML + '</tbody></table>';
  }
  
  dialog.innerHTML = '<div style="background:white;padding:30px;border-radius:12px;box-shadow:0 10px 40px rgba(0,0,0,0.3);max-width:600px;width:90%;max-height:80vh;overflow-y:auto;"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;"><h2 style="color:#333;margin:0;">Leaderboard</h2><button onclick="closeLeaderboardDialog()" style="background:none;border:none;font-size:24px;cursor:pointer;color:#999;">&times;</button></div>' + leaderboardHTML + '</div>';
  
  document.body.appendChild(dialog);
}

function closeLeaderboardDialog() {
  const dialog = document.getElementById('leaderboardDialog');
  if (dialog) dialog.remove();
}

// Initialize UI on load
document.addEventListener('DOMContentLoaded', function() {
  console.log('DOM loaded');
  checkUrlForInvite();
  
  let checks = 0;
  const maxChecks = 100;
  
  const checkLibraries = setInterval(() => {
    checks++;
    const hasChessBoard = typeof Chessboard !== 'undefined';
    const hasChess = typeof Chess !== 'undefined';
    
    if (hasChessBoard && hasChess) {
      console.log('Libraries loaded');
      clearInterval(checkLibraries);
      updateUI('menu');
    } else if (checks >= maxChecks) {
      console.error('Libraries failed to load');
      clearInterval(checkLibraries);
      const menuContainer = document.getElementById('menuContainer');
      menuContainer.innerHTML = '<div class="error-container"><h2>Library Loading Error</h2><p>Failed to load chess libraries.</p><p>Please refresh the page.</p><button onclick="location.reload()" class="btn btn-primary" style="margin-top:20px;">Reload Page</button></div>';
    }
  }, 100);
});
