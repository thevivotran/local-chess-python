from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, emit, join_room, leave_room
import chess
import uuid
import os
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'your-secret-key-change-in-production')
socketio = SocketIO(app, cors_allowed_origins="*")

# Store active games: {game_id: {board, players, current_player}}
games = {}
# Store player to game mapping: {session_id: game_id}
player_games = {}


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/health')
def health():
    return jsonify({'status': 'ok'})


@socketio.on('connect')
def handle_connect():
    print(f'Client connected: {request.sid}')
    emit('connect_response', {'data': 'Connected to chess server'})


@socketio.on('disconnect')
def handle_disconnect():
    session_id = request.sid
    print(f'Client disconnected: {session_id}')
    
    # If player was in a game, remove the game
    if session_id in player_games:
        game_id = player_games[session_id]
        if game_id in games:
            del games[game_id]
            # Notify other player
            emit('opponent_left', {'message': 'Opponent left the game'}, 
                 to=game_id, skip_sid=session_id)


@socketio.on('create_game')
def handle_create_game():
    session_id = request.sid
    game_id = str(uuid.uuid4())
    
    games[game_id] = {
        'board': chess.Board(),
        'players': [session_id, None],
        'current_player': 0,
        'moves_history': []
    }
    
    player_games[session_id] = game_id
    join_room(game_id)
    
    emit('game_created', {
        'game_id': game_id,
        'player_number': 1,
        'color': 'white'
    })
    
    print(f'Game created: {game_id} by {session_id}')


@socketio.on('join_game')
def handle_join_game(data):
    session_id = request.sid
    game_id = data.get('game_id')
    
    if game_id not in games:
        emit('error', {'message': 'Game not found'})
        return
    
    game = games[game_id]
    
    if game['players'][1] is not None:
        emit('error', {'message': 'Game is full'})
        return
    
    game['players'][1] = session_id
    player_games[session_id] = game_id
    join_room(game_id)
    
    # Notify both players
    emit('game_joined', {
        'game_id': game_id,
        'player_number': 2,
        'color': 'black'
    })
    
    emit('opponent_joined', {
        'message': 'Opponent has joined',
        'board_fen': game['board'].fen(),
        'moves_history': game['moves_history']
    }, to=game_id, skip_sid=session_id)
    
    print(f'Player {session_id} joined game {game_id}')


@socketio.on('make_move')
def handle_move(data):
    session_id = request.sid
    move_uci = data.get('move')
    
    print(f'Move received: {move_uci}, type: {type(move_uci)}')
    
    if not move_uci:
        emit('error', {'message': 'No move provided'})
        return
    
    if session_id not in player_games:
        emit('error', {'message': 'Not in a game'})
        return
    
    game_id = player_games[session_id]
    game = games.get(game_id)
    
    if not game:
        emit('error', {'message': 'Game not found'})
        return
    
    # Check if it's the player's turn
    player_index = game['players'].index(session_id)
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
        
        # Broadcast the move to both players
        emit('move_made', {
            'move': move_uci,
            'board_fen': game['board'].fen(),
            'is_check': game['board'].is_check(),
            'is_checkmate': game['board'].is_checkmate(),
            'is_stalemate': game['board'].is_stalemate(),
            'current_player': game['current_player']
        }, to=game_id)
        
        print(f'Move {move_uci} made in game {game_id}')
        
    except Exception as e:
        emit('error', {'message': f'Invalid move: {str(e)}'})


@socketio.on('get_board_state')
def handle_get_board_state():
    session_id = request.sid
    
    if session_id not in player_games:
        emit('error', {'message': 'Not in a game'})
        return
    
    game_id = player_games[session_id]
    game = games.get(game_id)
    
    if not game:
        emit('error', {'message': 'Game not found'})
        return
    
    emit('board_state', {
        'board_fen': game['board'].fen(),
        'moves_history': game['moves_history'],
        'current_player': game['current_player'],
        'is_check': game['board'].is_check(),
        'is_checkmate': game['board'].is_checkmate(),
        'is_stalemate': game['board'].is_stalemate()
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
        emit('error', {'message': 'Game not found'})
        return
    
    # Only allow reset if both players agree or if it's a new game
    game['board'] = chess.Board()
    game['moves_history'] = []
    game['current_player'] = 0
    
    emit('game_reset', {
        'board_fen': game['board'].fen(),
        'message': 'Game has been reset'
    }, to=game_id)
    
    print(f'Game {game_id} reset')


if __name__ == '__main__':
    print("Starting Chess Server...")
    socketio.run(app, host='0.0.0.0', port=5000, debug=True)
