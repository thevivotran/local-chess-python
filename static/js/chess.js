const socket = io();

let gameId = null;
let playerNumber = null;
let playerColor = null;
let board = null;
let playerIndex = null; // 0 = white, 1 = black
let currentPlayerTurn = 0; // server current_player: 0 = white, 1 = black
let username = null;
let opponentUsername = null;

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
  
  // Check if board element exists
  const boardElement = document.getElementById('board');
  if (!boardElement) {
    console.error('Board element not found in DOM');
    return;
  }
  
  // Check if Chessboard is available
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
    pieceTheme: '/static/img/chesspieces/wikipedia/{piece}.png'
  };
  
  try {
    board = Chessboard('board', config);
    console.log('Board initialized successfully:', board);
  } catch (e) {
    console.error('Error initializing board:', e);
  }

  // Prevent native touch gestures from interfering with piece drag on mobile/iOS
  if (boardElement) {
    // Allow touchstart/end to propagate; only prevent touchmove to avoid page scroll during drag
    boardElement.addEventListener('touchmove', function(e) { e.preventDefault(); }, { passive: false });
  }
  // Resize board after initialization (Chessboard.js sometimes measures while hidden)
  setTimeout(() => {
    try {
      if (board && typeof board.resize === 'function') {
        board.resize();
      }
    } catch (e) {
      console.warn('Board resize failed', e);
    }
  }, 50);

  // Keep board sized on window resize
  window.addEventListener('resize', function() {
    try {
      if (board && typeof board.resize === 'function') board.resize();
    } catch (e) {
      console.warn('Board resize on window failed', e);
    }
  });
}

function isPlayersTurn() {
  return (playerIndex !== null && currentPlayerTurn === playerIndex);
}

function onDragStart(source, piece, position, orientation) {
  // Prevent dragging when it's not the player's turn
  if (!isPlayersTurn()) {
    return false;
  }

  // Only allow dragging of player's own pieces
  if (!playerColor || !piece) return false;
  const pieceColorChar = piece.charAt(0); // 'w' or 'b'
  const expected = playerColor === 'white' ? 'w' : 'b';
  if (pieceColorChar !== expected) return false;

  return true;
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
  const dialog = document.createElement('div');
  dialog.id = 'promotion-dialog';
  dialog.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);display:flex;justify-content:center;align-items:center;z-index:1000;';
  
  const pieces = ['q', 'r', 'b', 'n'];
  const pieceNames = { q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight' };
  
  dialog.innerHTML = `
    <div style="background:white;padding:30px;border-radius:12px;text-align:center;box-shadow:0 10px 40px rgba(0,0,0,0.3);">
      <h3 style="margin-bottom:20px;color:#333;">Choose Promotion Piece</h3>
      <div style="display:flex;gap:15px;justify-content:center;">
        ${pieces.map(piece => `
          <button onclick="selectPromotion('${piece}')" style="width:80px;height:80px;font-size:50px;background:#f5f5f5;border:2px solid #ddd;border-radius:8px;cursor:pointer;transition:all 0.3s;" onmouseover="this.style.background='#e0e0e0'" onmouseout="this.style.background='#f5f5f5'">
            ${color === 'w' ? piece.toUpperCase() : piece.toLowerCase()}
          </button>
        `).join('')}
      </div>
      <p style="margin-top:15px;color:#666;font-size:0.9em;">${pieces.map(piece => pieceNames[piece]).join(', ')}</p>
    </div>
  `;
  
  document.body.appendChild(dialog);
}

function selectPromotion(piece) {
  const dialog = document.getElementById('promotion-dialog');
  if (dialog) dialog.remove();
  
  if (pendingPromotionMove) {
    const { source, target } = pendingPromotionMove;
    const chessBoard = new Chess(currentFEN);
    
    const moveObj = chessBoard.move({
      from: source,
      to: target,
      promotion: piece
    });
    
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
  // Cancel any pending promotion if user makes a different move
  cancelPendingPromotion();
  
  if (!isPlayersTurn()) {
    return 'snapback';
  }
  
  // Check if source and target are the same (piece dropped on same square)
  if (source === target) {
    return 'snapback';
  }
  
  const chessBoard = new Chess(currentFEN);
  
  // Check if there's a piece at source
  const piece = chessBoard.get(source);
  if (!piece) {
    return 'snapback';
  }
  
  // Check if it's the player's own piece
  const pieceColorChar = piece.color;
  const expected = playerColor === 'white' ? 'w' : 'b';
  if (pieceColorChar !== expected) {
    return 'snapback';
  }
  
  // Check if move is legal first
  const testMove = chessBoard.move({
    from: source,
    to: target,
    promotion: 'q' // Test with queen promotion
  });
  
  if (testMove === null) {
    return 'snapback';
  }
  
  // Undo the test move
  chessBoard.undo();
  
  // Check for pawn promotion
  if (isPawnPromotion(source, target)) {
    pendingPromotionMove = { source, target };
    showPromotionDialog(piece.color);
    return 'snapback';
  }
  
  // Execute the actual move
  const moveObj = chessBoard.move({
    from: source,
    to: target
  });
  
  if (moveObj === null) {
    return 'snapback';
  }
  
  currentFEN = chessBoard.fen();
  const uciMove = source + target;
  console.log('Sending move:', uciMove, 'moveObj:', moveObj);
  socket.emit('make_move', { move: uciMove });
  
  return 'trash';
}

function getFEN() {
  return currentFEN;
}

function updateBoard(fen) {
  console.log('Updating board with FEN:', fen);
  currentFEN = fen;
  if (board) {
    board.position(fen, false); // false = don't animate
    console.log('Board position updated');
  } else {
    console.warn('Board not initialized when trying to update position');
  }
}

// Socket.io event handlers
socket.on('connect', function() {
  console.log('Connected to server');
  updateUI('connected');
});

socket.on('game_created', function(data) {
  gameId = data.game_id;
  playerNumber = data.player_number;
  playerColor = data.color;
  playerIndex = playerNumber - 1;
  username = data.username;
  
  console.log('Game created:', gameId);
  console.log('You are player', playerNumber, 'playing as', playerColor);
  
  document.getElementById('gameId').textContent = gameId;
  document.getElementById('playerColor').textContent = playerColor.toUpperCase();
  document.getElementById('status').textContent = 'Waiting for opponent...';
  
  // Generate shareable link
  const shareableLink = window.location.origin + window.location.pathname + '?game=' + gameId;
  
  updateUI('waiting');
  
  // Show shareable link dialog
  showShareableLink(shareableLink);
});

socket.on('game_joined', function(data) {
  gameId = data.game_id;
  playerNumber = data.player_number;
  playerColor = data.color;
  playerIndex = playerNumber - 1;
  opponentUsername = data.opponent_username;
  
  console.log('Game joined:', gameId);
  console.log('You are player', playerNumber, 'playing as', playerColor);
  
  document.getElementById('gameId').textContent = gameId;
  document.getElementById('playerColor').textContent = playerColor.toUpperCase();
  document.getElementById('opponentName').textContent = opponentUsername || 'Waiting...';
  document.getElementById('status').textContent = 'Opponent joining...';
  
  updateUI('playing');
  // Initialize board after UI is visible
  setTimeout(function() {
    initializeBoard();
    socket.emit('get_board_state');
  }, 100);
});

socket.on('opponent_joined', function(data) {
  console.log('Opponent joined');
  opponentUsername = data.opponent_username;
  document.getElementById('opponentName').textContent = opponentUsername || 'Unknown';
  document.getElementById('status').textContent = 'Game Started! White to move.';
  // Set current player to white (0) when opponent joins
  currentPlayerTurn = 0;
  
  if (!board) {
    setTimeout(function() {
      initializeBoard();
      updateBoard(data.board_fen);
    }, 100);
  } else {
    updateBoard(data.board_fen);
  }
});

socket.on('move_made', function(data) {
  console.log('Move made:', data.move);
  updateBoard(data.board_fen);

  // Update who is to move
  currentPlayerTurn = data.current_player;

  let status = '';
  if (data.is_checkmate) {
    const winnerIndex = 1 - data.current_player;
    const winnerColor = winnerIndex === 0 ? 'White' : 'Black';
    if (playerIndex === winnerIndex) {
      status = `Checkmate! You won as ${winnerColor}.`;
    } else {
      status = `Checkmate! You lost — ${winnerColor} wins.`;
    }
    document.getElementById('resetBtn').style.display = 'block';
  } else if (data.is_draw) {
    // Handle all draw conditions
    if (data.is_stalemate) {
      status = 'Stalemate! Draw.';
    } else if (data.is_insufficient_material) {
      status = 'Draw by insufficient material.';
    } else if (data.is_fivefold_repetition) {
      status = 'Draw by fivefold repetition.';
    } else if (data.is_seventyfive_moves) {
      status = 'Draw by 75-move rule.';
    } else {
      status = 'Draw!';
    }
    document.getElementById('resetBtn').style.display = 'block';
  } else if (data.is_check) {
    status = 'Check! ' + (data.current_player === 0 ? 'White' : 'Black') + ' to move.';
  } else {
    status = (data.current_player === 0 ? 'White' : 'Black') + ' to move.';
  }

  document.getElementById('status').textContent = status;
  
  // Better move history display with move numbers
  const moveHistoryDiv = document.getElementById('moveHistory');
  const moveCount = moveHistoryDiv.children.length;
  const moveNumber = Math.floor(moveCount / 2) + 1;
  const isWhiteMove = moveCount % 2 === 0;
  
  if (isWhiteMove) {
    moveHistoryDiv.innerHTML += `<div><strong>${moveNumber}.</strong> ${data.move}</div>`;
  } else {
    // Append to last move entry for black's move
    const lastDiv = moveHistoryDiv.lastElementChild;
    if (lastDiv) {
      lastDiv.innerHTML += ` ${data.move}`;
    } else {
      moveHistoryDiv.innerHTML += `<div>${data.move}</div>`;
    }
  }
});

socket.on('board_state', function(data) {
  console.log('Board state received');
  
  if (!board) {
    setTimeout(function() {
      initializeBoard();
      updateBoard(data.board_fen);
    }, 100);
  } else {
    updateBoard(data.board_fen);
  }
  // Update who is to move
  currentPlayerTurn = data.current_player;

  let status = '';
  if (data.is_checkmate) {
    const winnerIndex = 1 - data.current_player;
    const winnerColor = winnerIndex === 0 ? 'White' : 'Black';
    if (playerIndex === winnerIndex) {
      status = `Checkmate! You won as ${winnerColor}.`;
    } else {
      status = `Checkmate! You lost — ${winnerColor} wins.`;
    }
    document.getElementById('resetBtn').style.display = 'block';
  } else if (data.is_draw) {
    // Handle all draw conditions
    if (data.is_stalemate) {
      status = 'Stalemate! Draw.';
    } else if (data.is_insufficient_material) {
      status = 'Draw by insufficient material.';
    } else if (data.is_fivefold_repetition) {
      status = 'Draw by fivefold repetition.';
    } else if (data.is_seventyfive_moves) {
      status = 'Draw by 75-move rule.';
    } else {
      status = 'Draw!';
    }
    document.getElementById('resetBtn').style.display = 'block';
  } else if (data.is_check) {
    status = 'Check! ' + (data.current_player === 0 ? 'White' : 'Black') + ' to move.';
  } else {
    status = (data.current_player === 0 ? 'White' : 'Black') + ' to move.';
  }

  document.getElementById('status').textContent = status;
  
  // Display move history with proper formatting
  const moveHistoryDiv = document.getElementById('moveHistory');
  moveHistoryDiv.innerHTML = '';
  data.moves_history.forEach(function(move, index) {
    const moveNumber = Math.floor(index / 2) + 1;
    const isWhiteMove = index % 2 === 0;
    
    if (isWhiteMove) {
      moveHistoryDiv.innerHTML += '<div><strong>' + moveNumber + '.</strong> ' + move;
    } else {
      // Close the div for black's move
      moveHistoryDiv.lastElementChild.innerHTML += ' ' + move + '</div>';
    }
  });
  
  // Close any unclosed div (if odd number of moves)
  if (data.moves_history.length % 2 !== 0 && moveHistoryDiv.lastElementChild) {
    moveHistoryDiv.lastElementChild.innerHTML += '</div>';
  }
});

socket.on('game_reset', function(data) {
  console.log('Game reset');
  // Cancel any pending promotion dialog
  cancelPendingPromotion();
  // Reset local state
  currentFEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  currentPlayerTurn = 0;
  pendingPromotionMove = null;
  
  updateBoard(data.board_fen);
  document.getElementById('moveHistory').innerHTML = '';
  document.getElementById('status').textContent = data.message + (data.reset_by ? ' (by ' + data.reset_by + ')' : '');
  document.getElementById('resetBtn').style.display = 'none';
});

socket.on('opponent_left', function(data) {
  console.log('Opponent left');
  document.getElementById('status').textContent = data.message;
  updateUI('opponent-left');
});

socket.on('error', function(data) {
  console.error('Error:', data.message);
  // Don't use alert for game not found errors if we're in the middle of reconnecting
  if (data.message && data.message.includes('expired')) {
    // Game expired, show option to go back to menu
    if (confirm('Game expired or not found. Return to main menu?')) {
      resetGame();
    }
  } else {
    // Show non-blocking error message
    const status = document.getElementById('status');
    if (status) {
      const originalText = status.textContent;
      status.textContent = 'Error: ' + data.message;
      status.style.color = '#e74c3c';
      setTimeout(function() {
        status.textContent = originalText;
        status.style.color = '';
      }, 3000);
    } else {
      alert('Error: ' + data.message);
    }
  }
});

// Handle reconnection
socket.on('reconnect', function(attemptNumber) {
  console.log('Reconnected to server after', attemptNumber, 'attempts');
  
  // If we were in a game, try to rejoin
  if (gameId) {
    console.log('Attempting to rejoin game:', gameId);
    socket.emit('get_board_state');
  }
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
    // Show game but disable interactions
    menuContainer.style.display = 'none';
    gameContainer.style.display = 'flex';
    document.getElementById('resetBtn').style.display = 'block';
  } else {
    menuContainer.style.display = 'flex';
    gameContainer.style.display = 'none';
  }
}

function createGame() {
  const usernameInput = document.getElementById('createUsername');
  username = usernameInput.value.trim() || 'Player 1';
  console.log('Creating game with username:', username);
  socket.emit('create_game', { username: username });
}

function joinGame() {
  const usernameInput = document.getElementById('joinUsername');
  const gameIdInput = document.getElementById('joinGameId');
  username = usernameInput.value.trim() || 'Player 2';
  const gameId = gameIdInput.value.trim();
  
  if (!gameId) {
    alert('Please enter a game ID');
    return;
  }
  
  console.log('Joining game:', gameId, 'as', username);
  socket.emit('join_game', { game_id: gameId, username: username });
}

function resetGame() {
  console.log('Resetting game...');
  socket.emit('reset_game');
  document.getElementById('resetBtn').style.display = 'none';
  // Clear URL params
  window.history.replaceState({}, document.title, window.location.pathname);
  updateUI('menu');
}

function showShareableLink(link) {
  const dialog = document.createElement('div');
  dialog.id = 'shareDialog';
  dialog.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);display:flex;justify-content:center;align-items:center;z-index:2000;';
  
  dialog.innerHTML = '<div style="background:white;padding:30px;border-radius:12px;text-align:center;box-shadow:0 10px 40px rgba(0,0,0,0.3);max-width:500px;width:90%;"><h3 style="margin-bottom:20px;color:#333;">Share Game Link</h3><p style="margin-bottom:15px;color:#666;">Send this link to your friend to invite them:</p><div style="display:flex;gap:10px;margin-bottom:20px;"><input type="text" id="shareLinkInput" value="' + link + '" readonly style="flex:1;padding:12px;border:2px solid #ddd;border-radius:6px;font-family:monospace;font-size:0.9em;"><button onclick="copyShareLink()" style="padding:12px 24px;background:#667eea;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:600;">Copy</button></div><p style="margin-bottom:20px;color:#999;font-size:0.85em;">Or share the Game ID: <strong>' + gameId + '</strong></p><button onclick="closeShareDialog()" style="padding:10px 30px;background:#764ba2;color:white;border:none;border-radius:6px;cursor:pointer;">Close</button></div>';
  
  document.body.appendChild(dialog);
}

function copyShareLink() {
  const input = document.getElementById('shareLinkInput');
  input.select();
  input.setSelectionRange(0, 99999);
  navigator.clipboard.writeText(input.value).then(function() {
    const btn = event.target;
    const originalText = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(function() { btn.textContent = originalText; }, 2000);
  });
}

function closeShareDialog() {
  const dialog = document.getElementById('shareDialog');
  if (dialog) dialog.remove();
}

async function showLeaderboard() {
  try {
    const response = await fetch('/api/leaderboard');
    const leaderboard = await response.json();
    displayLeaderboardModal(leaderboard);
  } catch (error) {
    console.error('Failed to load leaderboard:', error);
    alert('Failed to load leaderboard. Please try again.');
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
    leaderboardHTML = '<p style="color:#666;text-align:center;padding:20px;">No games played yet. Be the first to play!</p>';
  } else {
    let rowsHTML = '';
    players.forEach(function(player, index) {
      const name = player[0];
      const stats = player[1];
      const totalGames = stats.total_games || (stats.wins + stats.losses) || 1;
      const winRate = ((stats.wins / totalGames) * 100).toFixed(1);
      const bgColor = index % 2 === 0 ? '#f8f8f8' : 'white';
      rowsHTML += '<tr style="background:' + bgColor + ';"><td style="padding:10px;border-bottom:1px solid #ddd;font-weight:bold;color:#667eea;">#' + (index + 1) + '</td><td style="padding:10px;border-bottom:1px solid #ddd;">' + name + '</td><td style="padding:10px;border-bottom:1px solid #ddd;text-align:center;color:#27ae60;font-weight:600;">' + (stats.wins || 0) + '</td><td style="padding:10px;border-bottom:1px solid #ddd;text-align:center;color:#e74c3c;">' + (stats.losses || 0) + '</td><td style="padding:10px;border-bottom:1px solid #ddd;text-align:center;font-weight:600;">' + winRate + '%</td></tr>';
    });
    leaderboardHTML = '<table style="width:100%;border-collapse:collapse;"><thead><tr style="background:#667eea;color:white;"><th style="padding:12px;text-align:left;border-radius:8px 0 0 0;">Rank</th><th style="padding:12px;text-align:left;">Player</th><th style="padding:12px;text-align:center;">Wins</th><th style="padding:12px;text-align:center;">Losses</th><th style="padding:12px;text-align:center;border-radius:0 8px 0 0;">Win Rate</th></tr></thead><tbody>' + rowsHTML + '</tbody></table>';
  }
  
  dialog.innerHTML = '<div style="background:white;padding:30px;border-radius:12px;box-shadow:0 10px 40px rgba(0,0,0,0.3);max-width:600px;width:90%;max-height:80vh;overflow-y:auto;"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;"><h2 style="color:#333;margin:0;">Leaderboard</h2><button onclick="closeLeaderboardDialog()" style="background:none;border:none;font-size:24px;cursor:pointer;color:#999;">&times;</button></div>' + leaderboardHTML + '<p style="margin-top:20px;text-align:center;color:#999;font-size:0.85em;">Updated in real-time after each game</p></div>';
  
  document.body.appendChild(dialog);
}

function closeLeaderboardDialog() {
  const dialog = document.getElementById('leaderboardDialog');
  if (dialog) dialog.remove();
}

// Initialize UI on load
document.addEventListener('DOMContentLoaded', function() {
  console.log('DOM loaded, checking for required libraries');
  
  // Check for invite in URL
  checkUrlForInvite();
  
  // Wait for libraries to load
  let checks = 0;
  const maxChecks = 100; // 10 seconds max wait
  
  const checkLibraries = setInterval(() => {
    checks++;
    
    const hasChessBoard = typeof Chessboard !== 'undefined';
    const hasChess = typeof Chess !== 'undefined';
    
    console.log('Library check', checks, '- Chessboard:', typeof Chessboard, '- Chess:', typeof Chess);
    
    if (hasChessBoard && hasChess) {
      console.log('All libraries loaded successfully');
      clearInterval(checkLibraries);
      updateUI('menu');
    } else if (checks >= maxChecks) {
      console.error('Libraries failed to load after', maxChecks * 100, 'ms');
      console.error('Chessboard:', typeof Chessboard);
      console.error('Chess:', typeof Chess);
      clearInterval(checkLibraries);
      
      // Show detailed error message
      const menuContainer = document.getElementById('menuContainer');
      menuContainer.innerHTML = `
        <div class="error-container">
          <h2>⚠️ Library Loading Error</h2>
          <p>Failed to load required chess libraries from CDN.</p>
          <p>Please try:</p>
          <ul>
            <li>Refreshing the page (Ctrl+F5 or Cmd+Shift+R)</li>
            <li>Clearing your browser cache</li>
            <li>Checking your internet connection</li>
          </ul>
          <button onclick="location.reload()" class="btn btn-primary" style="margin-top: 20px;">Reload Page</button>
        </div>
      `;
    }
  }, 100);
});
