const socket = io();

let gameId = null;
let playerNumber = null;
let playerColor = null;
let board = null;
let playerIndex = null; // 0 = white, 1 = black
let currentPlayerTurn = 0; // server current_player: 0 = white, 1 = black

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

function onDrop(source, target) {
  // Block moves if not player's turn
  if (!isPlayersTurn()) {
    return 'snapback';
  }
  // Create a chess instance to validate
  const chessBoard = new Chess(currentFEN);
  const moveObj = chessBoard.move({
    from: source,
    to: target,
    promotion: 'q'
  });
  
  if (moveObj === null) {
    return 'snapback';
  }
  
  // Move is valid, update current FEN
  currentFEN = chessBoard.fen();
  
  // Construct UCI move from source and target (e.g., 'd2d3')
  const uciMove = source + target;
  console.log('Sending move:', uciMove, 'moveObj:', moveObj);
  socket.emit('make_move', { move: uciMove });
  
  return 'trash'; // Remove from board, we'll update via socket
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
  
  console.log('Game created:', gameId);
  console.log('You are player', playerNumber, 'playing as', playerColor);
  
  document.getElementById('gameId').textContent = gameId;
  document.getElementById('playerColor').textContent = playerColor.toUpperCase();
  document.getElementById('status').textContent = 'Waiting for opponent...';
  
  updateUI('waiting');
});

socket.on('game_joined', function(data) {
  gameId = data.game_id;
  playerNumber = data.player_number;
  playerColor = data.color;
  playerIndex = playerNumber - 1;
  
  console.log('Game joined:', gameId);
  console.log('You are player', playerNumber, 'playing as', playerColor);
  
  document.getElementById('gameId').textContent = gameId;
  document.getElementById('playerColor').textContent = playerColor.toUpperCase();
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
  } else if (data.is_stalemate) {
    status = 'Stalemate! Draw.';
    document.getElementById('resetBtn').style.display = 'block';
  } else if (data.is_check) {
    status = 'Check! ' + (data.current_player === 0 ? 'White' : 'Black') + ' to move.';
  } else {
    status = (data.current_player === 0 ? 'White' : 'Black') + ' to move.';
  }

  document.getElementById('status').textContent = status;
  document.getElementById('moveHistory').innerHTML += `<div>${data.move}</div>`;
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
  } else if (data.is_stalemate) {
    status = 'Stalemate! Draw.';
    document.getElementById('resetBtn').style.display = 'block';
  } else if (data.is_check) {
    status = 'Check! ' + (data.current_player === 0 ? 'White' : 'Black') + ' to move.';
  } else {
    status = (data.current_player === 0 ? 'White' : 'Black') + ' to move.';
  }

  document.getElementById('status').textContent = status;
  
  // Display move history
  const moveHistoryDiv = document.getElementById('moveHistory');
  moveHistoryDiv.innerHTML = '';
  data.moves_history.forEach(move => {
    moveHistoryDiv.innerHTML += `<div>${move}</div>`;
  });
});

socket.on('game_reset', function(data) {
  console.log('Game reset');
  updateBoard(data.board_fen);
  document.getElementById('moveHistory').innerHTML = '';
  document.getElementById('status').textContent = data.message;
});

socket.on('opponent_left', function(data) {
  console.log('Opponent left');
  document.getElementById('status').textContent = data.message;
  updateUI('opponent-left');
});

socket.on('error', function(data) {
  console.error('Error:', data.message);
  alert('Error: ' + data.message);
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
  console.log('Creating game...');
  socket.emit('create_game');
}

function joinGame() {
  const gameId = document.getElementById('joinGameId').value;
  if (!gameId) {
    alert('Please enter a game ID');
    return;
  }
  
  console.log('Joining game:', gameId);
  socket.emit('join_game', { game_id: gameId });
}

function resetGame() {
  console.log('Resetting game...');
  socket.emit('reset_game');
  document.getElementById('resetBtn').style.display = 'none';
  updateUI('menu');
}

// Initialize UI on load
document.addEventListener('DOMContentLoaded', function() {
  console.log('DOM loaded, checking for required libraries');
  
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
