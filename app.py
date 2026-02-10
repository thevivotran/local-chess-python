from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, emit, join_room, leave_room
import chess
import uuid
import os
import json
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'your-secret-key-change-in-production')
socketio = SocketIO(app, cors_allowed_origins="*")

# Store active games: {game_id: {board, players, current_player}}
games = {}
# Store player to game mapping: {session_id: game_id}
player_games = {}
# Store player usernames: {session_id: username}
player_usernames = {}

# Leaderboard storage file
LEADERBOARD_FILE = 'leaderboard.json'

def load_leaderboard():
    """Load leaderboard from JSON file"""
    if os.path.exists(LEADERBOARD_FILE):
        with open(LEADERBOARD_FILE, 'r') as f:
            return json.load(f)
    return {}

def save_leaderboard(leaderboard):
    """Save leaderboard to JSON file"""
    with open(LEADERBOARD_FILE, 'w') as f:
        json.dump(leaderboard, f, indent=2)

def update_leaderboard(winner_name, loser_name, game_duration=None):
    """Update leaderboard with game result"""
    leaderboard = load_leaderboard()
    
    # Initialize players if not exists
    if winner_name not in leaderboard:
        leaderboard[winner_name] = {'wins': 0, 'losses': 0, 'total_games': 0}
    if loser_name not in leaderboard:
        leaderboard[loser_name] = {'wins': 0, 'losses': 0, 'total_games': 0}
    
    # Update stats
    leaderboard[winner_name]['wins'] += 1
    leaderboard[winner_name]['total_games'] += 1
    leaderboard[loser_name]['losses'] += 1
    leaderboard[loser_name]['total_games'] += 1
    
    # Track head-to-head
    h2h_key = f"{winner_name}_vs_{loser_name}"
    if h2h_key not in leaderboard[winner_name]:
        leaderboard[winner_name][h2h_key] = {'wins': 0, 'losses': 0}
    leaderboard[winner_name][h2h_key]['wins'] += 1
    
    h2h_key_reverse = f"{loser_name}_vs_{winner_name}"
    if h2h_key_reverse not in leaderboard[loser_name]:
        leaderboard[loser_name][h2h_key_reverse] = {'wins': 0, 'losses': 0}
    leaderboard[loser_name][h2h_key_reverse]['losses'] += 1
    
    save_leaderboard(leaderboard)


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/health')
def health():
    return jsonify({'status': 'ok'})


@app.route('/api/leaderboard')
def get_leaderboard():
    """Get current leaderboard data"""
    leaderboard = load_leaderboard()
    # Sort by wins (descending)
    sorted_leaderboard = dict(sorted(
        leaderboard.items(), 
        key=lambda x: x[1].get('wins', 0), 
        reverse=True
    ))
    return jsonify(sorted_leaderboard)


@app.route('/api/leaderboard/player/<player_name>')
def get_player_stats(player_name):
    """Get specific player stats"""
    leaderboard = load_leaderboard()
    if player_name in leaderboard:
        return jsonify(leaderboard[player_name])
    return jsonify({'error': 'Player not found'}), 404


@socketio.on('connect')
def handle_connect():
    print(f'Client connected: {request.sid}')
    emit('connect_response', {'data': 'Connected to chess server'})


@socketio.on('disconnect')
def handle_disconnect():
    session_id = request.sid
    print(f'Client disconnected: {session_id}')
    
    # If player was in a game, handle it
    if session_id in player_games:
        game_id = player_games[session_id]
        
        if game_id in games:
            game = games[game_id]
            
            # Notify other player if they exist
            other_player_index = 1 if game['players'][0] == session_id else 0
            other_player_id = game['players'][other_player_index]
            
            if other_player_id is not None:
                emit('opponent_left', {'message': 'Opponent disconnected'}, 
                     to=game_id, skip_sid=session_id)
                
                # Clean up other player's mapping
                if other_player_id in player_games:
                    del player_games[other_player_id]
            
            # Delete the game
            del games[game_id]
        
        # Clean up disconnected player's mapping
        del player_games[session_id]
    
    # Clean up username mapping
    if session_id in player_usernames:
        del player_usernames[session_id]


@socketio.on('create_game')
def handle_create_game(data):
    session_id = request.sid
    username = data.get('username', 'Player 1')
    
    # Check if player is already in a game
    if session_id in player_games:
        old_game_id = player_games[session_id]
        if old_game_id in games:
            # Notify other player if exists
            old_game = games[old_game_id]
            if old_game['players'][1] is not None:
                emit('opponent_left', {'message': 'Opponent left to create a new game'}, 
                     to=old_game_id, skip_sid=session_id)
            del games[old_game_id]
            print(f'Player left old game {old_game_id} to create new game')
    
    # Validate username
    username = username.strip()[:20]  # Limit username length
    if not username:
        username = 'Player 1'
    
    game_id = str(uuid.uuid4())
    
    games[game_id] = {
        'board': chess.Board(),
        'players': [session_id, None],
        'current_player': 0,
        'moves_history': [],
        'usernames': [username, None],
        'start_time': datetime.now().isoformat(),
        'last_activity': datetime.now().isoformat()
    }
    
    player_games[session_id] = game_id
    player_usernames[session_id] = username
    join_room(game_id)
    
    emit('game_created', {
        'game_id': game_id,
        'player_number': 1,
        'color': 'white',
        'username': username
    })
    
    print(f'Game created: {game_id} by {username} ({session_id})')


@socketio.on('join_game')
def handle_join_game(data):
    session_id = request.sid
    game_id = data.get('game_id', '').strip()
    username = data.get('username', 'Player 2')
    
    # Validate game_id format (should be a UUID)
    if not game_id:
        emit('error', {'message': 'Game ID is required'})
        return
    
    # Check if player is trying to join their own game
    if session_id in player_games and player_games[session_id] == game_id:
        emit('error', {'message': 'You are already in this game'})
        return
    
    if game_id not in games:
        emit('error', {'message': 'Game not found or has expired'})
        return
    
    game = games[game_id]
    
    # Check if player is already in another game
    if session_id in player_games:
        old_game_id = player_games[session_id]
        if old_game_id != game_id and old_game_id in games:
            emit('error', {'message': 'You are already in another game. Please leave it first.'})
            return
    
    if game['players'][1] is not None:
        emit('error', {'message': 'Game is full'})
        return
    
    # Validate and sanitize username
    username = username.strip()[:20] if username else 'Player 2'
    if not username:
        username = 'Player 2'
    
    # Check for duplicate username in the same game
    if username == game['usernames'][0]:
        username = username + ' (2)'
    
    game['players'][1] = session_id
    game['usernames'][1] = username
    game['last_activity'] = datetime.now().isoformat()
    player_games[session_id] = game_id
    player_usernames[session_id] = username
    join_room(game_id)
    
    # Notify both players
    emit('game_joined', {
        'game_id': game_id,
        'player_number': 2,
        'color': 'black',
        'username': username,
        'opponent_username': game['usernames'][0]
    })
    
    emit('opponent_joined', {
        'message': 'Opponent has joined',
        'board_fen': game['board'].fen(),
        'moves_history': game['moves_history'],
        'opponent_username': username
    }, to=game_id, skip_sid=session_id)
    
    print(f'Player {username} ({session_id}) joined game {game_id}')


@socketio.on('make_move')
def handle_move(data):
    session_id = request.sid
    move_uci = data.get('move')
    
    print(f'Move received: {move_uci}, type: {type(move_uci)}')
    
    if not move_uci or not isinstance(move_uci, str):
        emit('error', {'message': 'No move provided'})
        return
    
    # Validate UCI format (should be 4 or 5 characters like 'e2e4' or 'e7e8q')
    if len(move_uci) < 4 or len(move_uci) > 5:
        emit('error', {'message': 'Invalid move format'})
        return
    
    if session_id not in player_games:
        emit('error', {'message': 'Not in a game'})
        return
    
    game_id = player_games[session_id]
    game = games.get(game_id)
    
    if not game:
        emit('error', {'message': 'Game not found or expired'})
        return
    
    # Check if game has both players
    if game['players'][1] is None:
        emit('error', {'message': 'Waiting for opponent to join'})
        return
    
    # Check if it's the player's turn - handle ValueError if player not found
    try:
        player_index = game['players'].index(session_id)
    except ValueError:
        emit('error', {'message': 'You are not a player in this game'})
        return
    
    if game['current_player'] != player_index:
        emit('error', {'message': 'Not your turn'})
        return
    
    try:
        move = chess.Move.from_uci(move_uci)
        if move not in game['board'].legal_moves:
            emit('error', {'message': 'Illegal move'})
            return
        
        game['board'].push(move)
        game['moves_history'].append(move_uci)
        game['current_player'] = 1 - game['current_player']
        game['last_activity'] = datetime.now().isoformat()
        
        # Check for all draw conditions
        is_checkmate = game['board'].is_checkmate()
        is_stalemate = game['board'].is_stalemate()
        is_insufficient_material = game['board'].is_insufficient_material()
        is_fivefold_repetition = game['board'].is_fivefold_repetition()
        is_seventyfive_moves = game['board'].is_seventyfive_moves()
        
        # Handle game end and update leaderboard
        if is_checkmate and game['usernames'][0] and game['usernames'][1]:
            # Winner is the player who just moved (previous player)
            winner_index = 1 - game['current_player']
            loser_index = game['current_player']
            winner_name = game['usernames'][winner_index]
            loser_name = game['usernames'][loser_index]
            
            if winner_name and loser_name:
                update_leaderboard(winner_name, loser_name)
                print(f'Leaderboard updated: {winner_name} defeated {loser_name}')
        
        # Broadcast the move to both players
        emit('move_made', {
            'move': move_uci,
            'board_fen': game['board'].fen(),
            'is_check': game['board'].is_check(),
            'is_checkmate': is_checkmate,
            'is_stalemate': is_stalemate,
            'is_insufficient_material': is_insufficient_material,
            'is_fivefold_repetition': is_fivefold_repetition,
            'is_seventyfive_moves': is_seventyfive_moves,
            'is_draw': is_stalemate or is_insufficient_material or is_fivefold_repetition or is_seventyfive_moves,
            'current_player': game['current_player']
        }, to=game_id)
        
        print(f'Move {move_uci} made in game {game_id}')
        
    except ValueError as e:
        emit('error', {'message': f'Invalid move format: {str(e)}'})
    except Exception as e:
        emit('error', {'message': f'Error processing move: {str(e)}'})


def cleanup_expired_games():
    """Remove games that have been inactive for more than 2 hours"""
    current_time = datetime.now()
    expired_games = []
    
    for game_id, game in list(games.items()):
        last_activity = datetime.fromisoformat(game.get('last_activity', game['start_time']))
        # Game expires after 2 hours of inactivity
        if (current_time - last_activity).total_seconds() > 7200:
            expired_games.append(game_id)
            # Notify players if they're still connected
            for player_id in game['players']:
                if player_id and player_id in player_games:
                    del player_games[player_id]
    
    for game_id in expired_games:
        del games[game_id]
        print(f'Expired game {game_id} cleaned up')


@socketio.on('get_board_state')
def handle_get_board_state():
    session_id = request.sid
    
    if session_id not in player_games:
        emit('error', {'message': 'Not in a game'})
        return
    
    game_id = player_games[session_id]
    game = games.get(game_id)
    
    if not game:
        emit('error', {'message': 'Game not found or expired'})
        # Clean up stale reference
        del player_games[session_id]
        return
    
    # Update last activity
    game['last_activity'] = datetime.now().isoformat()
    
    # Check for all game end conditions
    board = game['board']
    emit('board_state', {
        'board_fen': board.fen(),
        'moves_history': game['moves_history'],
        'current_player': game['current_player'],
        'is_check': board.is_check(),
        'is_checkmate': board.is_checkmate(),
        'is_stalemate': board.is_stalemate(),
        'is_insufficient_material': board.is_insufficient_material(),
        'is_fivefold_repetition': board.is_fivefold_repetition(),
        'is_seventyfive_moves': board.is_seventyfive_moves(),
        'is_draw': board.is_stalemate() or board.is_insufficient_material() or 
                   board.is_fivefold_repetition() or board.is_seventyfive_moves()
    })


@socketio.on('reset_game')
def handle_reset_game():
    session_id = request.sid
    
    if session_id not in player_games:
        emit('error', {'message': 'Not in a game'})
        return
    
    game_id = player_games[session_id]
    game = games.get(game_id)
    
    if not game:
        emit('error', {'message': 'Game not found or expired'})
        # Clean up stale reference
        del player_games[session_id]
        return
    
    # Find the player who requested reset
    try:
        player_index = game['players'].index(session_id)
    except ValueError:
        emit('error', {'message': 'You are not a player in this game'})
        return
    
    # Reset the game state
    game['board'] = chess.Board()
    game['moves_history'] = []
    game['current_player'] = 0
    game['start_time'] = datetime.now().isoformat()
    game['last_activity'] = datetime.now().isoformat()
    
    emit('game_reset', {
        'board_fen': game['board'].fen(),
        'message': 'Game has been reset',
        'reset_by': game['usernames'][player_index]
    }, to=game_id)
    
    print(f'Game {game_id} reset by {game["usernames"][player_index]}')


def start_cleanup_task():
    """Start background task to clean up expired games every 10 minutes"""
    import threading
    def cleanup_loop():
        import time
        while True:
            time.sleep(600)  # 10 minutes
            cleanup_expired_games()
    
    thread = threading.Thread(target=cleanup_loop, daemon=True)
    thread.start()
    print("Game cleanup task started")


if __name__ == '__main__':
    print("Starting Chess Server...")
    start_cleanup_task()
    socketio.run(app, host='0.0.0.0', port=5000, debug=True)
