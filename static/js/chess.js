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

// Initialize Chessboard.js
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
  
  const config = {
    position: 'start',
    orientation: playerColor === 'white' ? 'white' : 'black',
    draggable: true,
    dropOffBoard: 'snapback',
    onDragStart: onDragStart,
    onDrop: onDrop,
    onMouseoverSquare: onMouseoverSquare,
    onMouseoutSquare: onMouseoutSquare,
    pieceTheme: '/static/img/chesspieces/wikipedia/{piece}.png'
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
  
  setTimeout(() => {
    try {
      if (board && typeof board.resize === 'function') board.resize();
    } catch (e) {}
  }, 50);

  window.addEventListener('resize', function() {
    try {
      if (board && typeof board.resize === 'function') board.resize();
    } catch (e) {}
  });
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
  if (isGameOver) return 'snapback';
  if (!isPlayersTurn()) return 'snapback';
  if (source === target) return 'snapback';
  
  const chessBoard = new Chess(currentFEN);
  const piece = chessBoard.get(source);
  if (!piece) return 'snapback';
  
  const pieceColorChar = piece.color;
  const expected = playerColor === 'white' ? 'w' : 'b';
  if (pieceColorChar !== expected) return 'snapback';
  
  const testMove = chessBoard.move({ from: source, to: target, promotion: 'q' });
  if (testMove === null) return 'snapback';
  chessBoard.undo();
  
  if (isPawnPromotion(source, target)) {
    pendingPromotionMove = { source, target };
    showPromotionDialog(piece.color);
    return 'snapback';
  }
  
  const moveObj = chessBoard.move({ from: source, to: target });
  if (moveObj === null) return 'snapback';
  
  currentFEN = chessBoard.fen();
  const uciMove = source + target;
  console.log('Sending move:', uciMove);
  socket.emit('make_move', { move: uciMove });
  
  return 'trash';
}

function updateBoard(fen, animated = true) {
  console.log('Updating board with FEN:', fen);
  currentFEN = fen;
  if (board) board.position(fen, !animated);
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
  
  dialog.innerHTML = `
    <div style="background:white;padding:35px;border-radius:16px;text-align:center;max-width:480px;width:90%;">
      <h3 style="margin-bottom:20px;color:#333;">Invite a Friend!</h3>
      <p style="margin-bottom:15px;color:#666;">Share this link:</p>
      <div style="display:flex;gap:10px;margin-bottom:20px;">
        <input type="text" id="shareLinkInput" value="${link}" readonly style="flex:1;padding:14px;border:2px solid #ddd;border-radius:8px;font-family:monospace;font-size:0.85em;">
        <button onclick="copyShareLink()" style="padding:14px 24px;background:#667eea;color:white;border:none;border-radius:8px;cursor:pointer;font-weight:600;">Copy</button>
      </div>
      <button onclick="closeShareDialog()" style="padding:12px 40px;background:#764ba2;color:white;border:none;border-radius:8px;cursor:pointer;">Got it!</button>
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
    btn.textContent = '✓ Copied!';
    setTimeout(() => btn.textContent = 'Copy', 2000);
  });
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
});

socket.on('move_made', function(data) {
  console.log('Move made:', data.move);
  
  if (data.is_capture) playSound('capture');
  else if (data.is_check) playSound('check');
  else playSound('move');
  
  if (data.from && data.to) highlightLastMove(data.from, data.to);
  
  updateBoard(data.board_fen);
  currentPlayerTurn = data.current_player;

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
  
  const moveHistoryDiv = document.getElementById('moveHistory');
  const moveCount = moveHistoryDiv.children.length;
  const moveNumber = Math.floor(moveCount / 2) + 1;
  const isWhiteMove = moveCount % 2 === 0;
  
  if (isWhiteMove) {
    moveHistoryDiv.innerHTML += `<div class="move-pair"><span class="move-num">${moveNumber}.</span> <span class="move-white">${data.move}</span>`;
  } else {
    const lastDiv = moveHistoryDiv.lastElementChild;
    if (lastDiv) lastDiv.innerHTML += ` <span class="move-black">${data.move}</span></div>`;
  }
  
  moveHistoryDiv.scrollTop = moveHistoryDiv.scrollHeight;
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
  
  document.querySelectorAll('.highlight-last-move').forEach(el => el.classList.remove('highlight-last-move'));
  
  updateBoard(data.board_fen, false);
  document.getElementById('moveHistory').innerHTML = '';
  document.getElementById('status').innerHTML = data.message;
  document.getElementById('resetBtn').style.display = 'none';
});

socket.on('opponent_left', function(data) {
  console.log('Opponent left:', data.message);
  showToast(data.message || 'Opponent left the game', 'warning');
  document.getElementById('status').innerHTML = data.message || 'Opponent left';
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
  showToast(`${data.offered_by} offered a draw. Accept?`, 'warning', 10000);
});

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
  
  if (board) board.position('start');
  window.history.replaceState({}, document.title, window.location.pathname);
  
  document.getElementById('gameId').textContent = '-';
  document.getElementById('playerColor').textContent = '-';
  document.getElementById('opponentName').textContent = 'Waiting...';
  document.getElementById('moveHistory').innerHTML = '';
  document.getElementById('status').innerHTML = 'Connecting...';
  document.getElementById('resetBtn').style.display = 'none';
  document.getElementById('gameTimer').textContent = '00:00';
  
  updateUI('menu');
}

function offerDraw() {
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
