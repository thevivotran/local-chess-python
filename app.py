from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, emit, join_room, leave_room
import chess
import random
import os
import json
from datetime import datetime, timedelta
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
app.config["SECRET_KEY"] = os.getenv(
    "SECRET_KEY", "your-secret-key-change-in-production"
)
socketio = SocketIO(app, cors_allowed_origins="*")

# Room code generation — short, human-readable, avoids confusable chars
ROOM_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def generate_room_code():
    while True:
        code = "".join(random.choices(ROOM_CODE_CHARS, k=6))
        if code not in games:
            return code


# Store active games: {game_id: {board, players, current_player}}
games = {}
# Store player to game mapping: {session_id: game_id}
player_games = {}
# Store player usernames: {session_id: username}
player_usernames = {}

# Leaderboard storage file
LEADERBOARD_FILE = "leaderboard.json"


def load_leaderboard():
    """Load leaderboard from JSON file"""
    if os.path.exists(LEADERBOARD_FILE):
        with open(LEADERBOARD_FILE, "r") as f:
            return json.load(f)
    return {}


def save_leaderboard(leaderboard):
    """Save leaderboard to JSON file"""
    with open(LEADERBOARD_FILE, "w") as f:
        json.dump(leaderboard, f, indent=2)


def update_leaderboard(winner_name, loser_name, game_duration=None):
    """Update leaderboard with game result"""
    leaderboard = load_leaderboard()

    # Initialize players if not exists
    if winner_name not in leaderboard:
        leaderboard[winner_name] = {"wins": 0, "losses": 0, "total_games": 0}
    if loser_name not in leaderboard:
        leaderboard[loser_name] = {"wins": 0, "losses": 0, "total_games": 0}

    # Update stats
    leaderboard[winner_name]["wins"] += 1
    leaderboard[winner_name]["total_games"] += 1
    leaderboard[loser_name]["losses"] += 1
    leaderboard[loser_name]["total_games"] += 1

    # Track head-to-head
    h2h_key = f"{winner_name}_vs_{loser_name}"
    if h2h_key not in leaderboard[winner_name]:
        leaderboard[winner_name][h2h_key] = {"wins": 0, "losses": 0}
    leaderboard[winner_name][h2h_key]["wins"] += 1

    h2h_key_reverse = f"{loser_name}_vs_{winner_name}"
    if h2h_key_reverse not in leaderboard[loser_name]:
        leaderboard[loser_name][h2h_key_reverse] = {"wins": 0, "losses": 0}
    leaderboard[loser_name][h2h_key_reverse]["losses"] += 1

    save_leaderboard(leaderboard)


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/health")
def health():
    return jsonify({"status": "ok"})


@app.route("/api/leaderboard")
def get_leaderboard():
    """Get current leaderboard data"""
    leaderboard = load_leaderboard()
    # Sort by wins (descending)
    sorted_leaderboard = dict(
        sorted(leaderboard.items(), key=lambda x: x[1].get("wins", 0), reverse=True)
    )
    return jsonify(sorted_leaderboard)


@app.route("/api/leaderboard/player/<player_name>")
def get_player_stats(player_name):
    """Get specific player stats"""
    leaderboard = load_leaderboard()
    if player_name in leaderboard:
        return jsonify(leaderboard[player_name])
    return jsonify({"error": "Player not found"}), 404


@app.route("/api/leaderboard/top/<int:n>")
def get_top_players(n=10):
    """Get top N players by wins"""
    leaderboard = load_leaderboard()
    sorted_leaderboard = sorted(
        leaderboard.items(), key=lambda x: x[1].get("wins", 0), reverse=True
    )[:n]
    return jsonify(dict(sorted_leaderboard))


@app.route("/api/games/active")
def get_active_games():
    """Get count of active games (for admin/debug)"""
    return jsonify({"active_games": len(games), "connected_players": len(player_games)})


@socketio.on("ping_server")
def handle_ping():
    """Respond to client ping for connection health check"""
    emit("pong_server", {"timestamp": datetime.now().isoformat()})


@socketio.on("request_draw")
def handle_request_draw(data):
    """Handle draw offer from a player"""
    session_id = request.sid
    reason = data.get("reason", "offer")

    if session_id not in player_games:
        emit("error", {"message": "You are not in a game", "code": "NOT_IN_GAME"})
        return

    game_id = player_games[session_id]
    game = games.get(game_id)

    if not game:
        emit("error", {"message": "Game not found", "code": "GAME_NOT_FOUND"})
        return

    try:
        player_index = game["players"].index(session_id)
    except ValueError:
        emit("error", {"message": "Not a player in this game", "code": "NOT_PLAYER"})
        return

    # Offer draw to opponent
    emit(
        "draw_offered",
        {"offered_by": game["usernames"][player_index], "reason": reason},
        to=game_id,
        skip_sid=session_id,
    )

    print(f"Draw offered by {game['usernames'][player_index]} in game {game_id}")


@socketio.on("accept_draw")
def handle_accept_draw():
    """Handle draw acceptance"""
    session_id = request.sid

    if session_id not in player_games:
        emit("error", {"message": "You are not in a game", "code": "NOT_IN_GAME"})
        return

    game_id = player_games[session_id]
    game = games.get(game_id)

    if not game:
        emit("error", {"message": "Game not found", "code": "GAME_NOT_FOUND"})
        return

    try:
        player_index = game["players"].index(session_id)
    except ValueError:
        emit("error", {"message": "Not a player in this game", "code": "NOT_PLAYER"})
        return

    # Record draw in leaderboard for both players
    if game["usernames"][0] and game["usernames"][1]:
        leaderboard = load_leaderboard()
        for username in game["usernames"]:
            if username:
                if username not in leaderboard:
                    leaderboard[username] = {
                        "wins": 0,
                        "losses": 0,
                        "draws": 0,
                        "total_games": 0,
                    }
                if "draws" not in leaderboard[username]:
                    leaderboard[username]["draws"] = 0
                leaderboard[username]["draws"] += 1
                leaderboard[username]["total_games"] += 1
        save_leaderboard(leaderboard)

    # Notify both players
    emit(
        "game_ended",
        {
            "result": "draw",
            "reason": "agreed_draw",
            "message": "Draw agreed by both players",
        },
        to=game_id,
    )

    print(f"Draw agreed in game {game_id}")


@socketio.on("resign")
def handle_resign():
    """Handle player resignation"""
    session_id = request.sid

    if session_id not in player_games:
        emit("error", {"message": "You are not in a game", "code": "NOT_IN_GAME"})
        return

    game_id = player_games[session_id]
    game = games.get(game_id)

    if not game:
        emit("error", {"message": "Game not found", "code": "GAME_NOT_FOUND"})
        return

    try:
        player_index = game["players"].index(session_id)
    except ValueError:
        emit("error", {"message": "Not a player in this game", "code": "NOT_PLAYER"})
        return

    # Determine winner
    winner_index = 1 - player_index
    winner_name = game["usernames"][winner_index]
    loser_name = game["usernames"][player_index]

    # Update leaderboard
    if winner_name and loser_name:
        leaderboard = load_leaderboard()

        for name in [winner_name, loser_name]:
            if name not in leaderboard:
                leaderboard[name] = {"wins": 0, "losses": 0, "total_games": 0}

        leaderboard[winner_name]["wins"] += 1
        leaderboard[winner_name]["total_games"] += 1
        leaderboard[loser_name]["losses"] += 1
        leaderboard[loser_name]["total_games"] += 1
        save_leaderboard(leaderboard)

        print(f"Leaderboard updated: {winner_name} won by resignation")

    # Notify both players
    emit(
        "game_ended",
        {
            "result": "resignation",
            "winner": winner_name,
            "loser": loser_name,
            "message": f"{loser_name} resigned. {winner_name} wins!",
        },
        to=game_id,
    )

    print(f"Game {game_id} ended: {loser_name} resigned")


@socketio.on("decline_draw")
def handle_decline_draw():
    """Handle draw decline — notify the offerer so they can offer again"""
    session_id = request.sid

    if session_id not in player_games:
        return

    game_id = player_games[session_id]
    game = games.get(game_id)

    if not game:
        return

    try:
        player_index = game["players"].index(session_id)
    except ValueError:
        return

    emit(
        "draw_declined",
        {"declined_by": game["usernames"][player_index]},
        to=game_id,
        skip_sid=session_id,
    )

    print(f"Draw declined by {game['usernames'][player_index]} in game {game_id}")


@socketio.on("connect")
def handle_connect():
    print(f"Client connected: {request.sid}")
    emit("connect_response", {"data": "Connected to chess server"})


@socketio.on("disconnect")
def handle_disconnect():
    session_id = request.sid
    print(f"Client disconnected: {session_id}")

    if session_id not in player_games:
        if session_id in player_usernames:
            del player_usernames[session_id]
        return

    game_id = player_games.pop(session_id)
    username_disconnected = player_usernames.pop(session_id, "Unknown")

    if game_id not in games:
        return

    game = games[game_id]

    try:
        player_index = game["players"].index(session_id)
    except ValueError:
        return

    other_index = 1 - player_index
    other_player_id = game["players"][other_index]
    other_disconnected = game.get("disconnected_players", [None, None])[other_index]

    # No opponent ever joined and none is waiting to reconnect — delete game
    if other_player_id is None and other_disconnected is None:
        del games[game_id]
        return

    # Opponent is present (or waiting to reconnect) — pause and give reconnect window
    if game.get("clock_started_at"):
        elapsed = (
            datetime.now() - datetime.fromisoformat(game["clock_started_at"])
        ).total_seconds()
        game["clock"][player_index] = max(0, game["clock"][player_index] - elapsed)
        game["clock_started_at"] = None

    game["players"][player_index] = None
    reconnect_deadline = (datetime.now() + timedelta(seconds=60)).isoformat()
    if "disconnected_players" not in game:
        game["disconnected_players"] = [None, None]
    game["disconnected_players"][player_index] = {
        "username": username_disconnected,
        "disconnected_at": datetime.now().isoformat(),
        "reconnect_deadline": reconnect_deadline,
    }

    if other_player_id:
        emit(
            "opponent_disconnected",
            {
                "username": username_disconnected,
                "reconnect_timeout": 60,
                "game_id": game_id,
            },
            to=other_player_id,
        )

    print(
        f"Player {username_disconnected} disconnected from game {game_id}, 60s reconnect window open"
    )


@socketio.on("reconnect_game")
def handle_reconnect_game(data):
    session_id = request.sid
    game_id = data.get("game_id", "").strip()
    reconnect_username = data.get("username", "").strip()

    if not game_id or not reconnect_username:
        emit("reconnect_failed", {"message": "Missing game_id or username"})
        return

    if game_id not in games:
        emit("reconnect_failed", {"message": "Game not found or expired"})
        return

    game = games[game_id]
    disconnected = game.get("disconnected_players", [None, None])

    # Find the disconnected player slot matching this username
    player_index = None
    for i, dc in enumerate(disconnected):
        if dc and dc["username"] == reconnect_username:
            if datetime.now() > datetime.fromisoformat(dc["reconnect_deadline"]):
                emit("reconnect_failed", {"message": "Reconnect window has expired"})
                return
            player_index = i
            break

    if player_index is None:
        emit(
            "reconnect_failed",
            {"message": "No pending reconnect found for this username"},
        )
        return

    # Restore player slot
    game["players"][player_index] = session_id
    game["disconnected_players"][player_index] = None
    game["clock_started_at"] = datetime.now().isoformat()
    player_games[session_id] = game_id
    player_usernames[session_id] = reconnect_username
    join_room(game_id)

    color = "white" if player_index == 0 else "black"
    other_index = 1 - player_index
    other_username = game["usernames"][other_index]

    emit(
        "reconnected",
        {
            "game_id": game_id,
            "color": color,
            "player_index": player_index,
            "username": reconnect_username,
            "opponent_username": other_username,
            "board_fen": game["board"].fen(),
            "moves_history": game["moves_history"],
            "captured_pieces": game["captured_pieces"],
            "clock": game["clock"],
            "current_player": game["current_player"],
        },
    )

    emit(
        "opponent_reconnected",
        {
            "username": reconnect_username,
        },
        to=game_id,
        skip_sid=session_id,
    )

    print(f"Player {reconnect_username} reconnected to game {game_id}")


@socketio.on("claim_win")
def handle_claim_win():
    session_id = request.sid

    if session_id not in player_games:
        emit("error", {"message": "You are not in a game", "code": "NOT_IN_GAME"})
        return

    game_id = player_games[session_id]
    game = games.get(game_id)

    if not game:
        emit("error", {"message": "Game not found", "code": "GAME_NOT_FOUND"})
        return

    try:
        player_index = game["players"].index(session_id)
    except ValueError:
        emit("error", {"message": "Not a player in this game", "code": "NOT_PLAYER"})
        return

    other_index = 1 - player_index
    disconnected = game.get("disconnected_players", [None, None])

    if game["players"][other_index] is not None or disconnected[other_index] is None:
        emit(
            "error",
            {"message": "Opponent is still connected", "code": "OPPONENT_CONNECTED"},
        )
        return

    winner_name = game["usernames"][player_index]
    loser_name = game["usernames"][other_index]

    if winner_name and loser_name:
        update_leaderboard(winner_name, loser_name)

    emit(
        "game_ended",
        {
            "result": "forfeit",
            "winner": winner_name,
            "loser": loser_name,
            "message": f"{loser_name} disconnected. {winner_name} wins!",
        },
        to=game_id,
    )

    print(f"Game {game_id}: {winner_name} claimed win by forfeit over {loser_name}")


@socketio.on("create_game")
def handle_create_game(data):
    session_id = request.sid
    username = data.get("username", "Player 1")

    # Check if player is already in a game
    if session_id in player_games:
        old_game_id = player_games[session_id]
        if old_game_id in games:
            # Notify other player if exists
            old_game = games[old_game_id]
            if old_game["players"][1] is not None:
                emit(
                    "opponent_left",
                    {"message": "Opponent left to create a new game"},
                    to=old_game_id,
                    skip_sid=session_id,
                )
            del games[old_game_id]
            print(f"Player left old game {old_game_id} to create new game")

    # Validate username
    username = username.strip()[:20]  # Limit username length
    if not username:
        username = "Player 1"

    game_id = generate_room_code()

    games[game_id] = {
        "board": chess.Board(),
        "players": [session_id, None],
        "current_player": 0,
        "moves_history": [],
        "usernames": [username, None],
        "captured_pieces": {"white": [], "black": []},
        "start_time": datetime.now().isoformat(),
        "last_activity": datetime.now().isoformat(),
        "clock": [1200, 1200],
        "clock_started_at": None,
        "disconnected_players": [None, None],
    }

    player_games[session_id] = game_id
    player_usernames[session_id] = username
    join_room(game_id)

    emit(
        "game_created",
        {
            "game_id": game_id,
            "player_number": 1,
            "color": "white",
            "username": username,
        },
    )

    print(f"Game created: {game_id} by {username} ({session_id})")


@socketio.on("join_game")
def handle_join_game(data):
    session_id = request.sid
    game_id = data.get("game_id", "").strip()
    username = data.get("username", "Player 2")

    # Validate game_id format (should be a UUID)
    if not game_id:
        emit("error", {"message": "Game ID is required"})
        return

    # Check if player is trying to join their own game
    if session_id in player_games and player_games[session_id] == game_id:
        emit("error", {"message": "You are already in this game"})
        return

    if game_id not in games:
        emit("error", {"message": "Game not found or has expired"})
        return

    game = games[game_id]

    # Check if player is already in another game
    if session_id in player_games:
        old_game_id = player_games[session_id]
        if old_game_id != game_id and old_game_id in games:
            emit(
                "error",
                {"message": "You are already in another game. Please leave it first."},
            )
            return

    disconnected = game.get("disconnected_players", [None, None])
    if game["players"][1] is not None or disconnected[1] is not None:
        emit("error", {"message": "Game is full"})
        return

    # Validate and sanitize username
    username = username.strip()[:20] if username else "Player 2"
    if not username:
        username = "Player 2"

    # Check for duplicate username in the same game
    if username == game["usernames"][0]:
        username = username + " (2)"

    game["players"][1] = session_id
    game["usernames"][1] = username
    game["last_activity"] = datetime.now().isoformat()
    game["clock_started_at"] = datetime.now().isoformat()
    player_games[session_id] = game_id
    player_usernames[session_id] = username
    join_room(game_id)

    # Notify both players
    emit(
        "game_joined",
        {
            "game_id": game_id,
            "player_number": 2,
            "color": "black",
            "username": username,
            "opponent_username": game["usernames"][0],
            "clock": game["clock"],
        },
    )

    emit(
        "opponent_joined",
        {
            "message": "Opponent has joined",
            "board_fen": game["board"].fen(),
            "moves_history": game["moves_history"],
            "captured_pieces": game["captured_pieces"],
            "opponent_username": username,
            "clock": game["clock"],
        },
        to=game_id,
        skip_sid=session_id,
    )

    print(f"Player {username} ({session_id}) joined game {game_id}")


@socketio.on("make_move")
def handle_move(data):
    session_id = request.sid
    move_uci = data.get("move")

    print(f"Move received: {move_uci}, type: {type(move_uci)}")

    # Validate move exists and is a string
    if not move_uci or not isinstance(move_uci, str):
        emit("error", {"message": "No move provided", "code": "NO_MOVE"})
        return

    # Validate UCI format strictly (must be 4 or 5 characters like 'e2e4' or 'e7e8q')
    move_uci = move_uci.strip()
    if len(move_uci) < 4 or len(move_uci) > 5:
        emit(
            "error",
            {
                "message": "Invalid move format. Use UCI format (e.g., e2e4)",
                "code": "INVALID_FORMAT",
            },
        )
        return

    # Additional validation: check UCI format more strictly
    # UCI format: e2e4 means from e2 to e4
    # Files (a-h): move_uci[0] and move_uci[2]
    # Ranks (1-8): move_uci[1] and move_uci[3]
    if move_uci[0] not in "abcdefgh" or move_uci[2] not in "abcdefgh":
        emit(
            "error",
            {
                "message": "Invalid file in square coordinates",
                "code": "INVALID_SQUARES",
            },
        )
        return
    if move_uci[1] not in "12345678" or move_uci[3] not in "12345678":
        emit(
            "error",
            {"message": "Invalid rank in square coordinates", "code": "INVALID_RANK"},
        )
        return

    # Validate promotion piece if present
    if len(move_uci) == 5 and move_uci[4].lower() not in "qrbn":
        emit(
            "error",
            {
                "message": "Invalid promotion piece. Use Q, R, B, or N",
                "code": "INVALID_PROMOTION",
            },
        )
        return

    if session_id not in player_games:
        emit(
            "error",
            {
                "message": "You are not in a game. Create or join a game first.",
                "code": "NOT_IN_GAME",
            },
        )
        return

    game_id = player_games[session_id]
    game = games.get(game_id)

    if not game:
        emit(
            "error",
            {"message": "Game not found or has expired", "code": "GAME_NOT_FOUND"},
        )
        # Clean up stale reference
        del player_games[session_id]
        return

    # Check if game has both players
    if game["players"][1] is None:
        emit(
            "error",
            {"message": "Waiting for opponent to join", "code": "WAITING_FOR_OPPONENT"},
        )
        return

    # Check if it's the player's turn - handle ValueError if player not found
    try:
        player_index = game["players"].index(session_id)
    except ValueError:
        emit(
            "error",
            {"message": "You are not a player in this game", "code": "NOT_PLAYER"},
        )
        return

    if game["current_player"] != player_index:
        emit(
            "error",
            {
                "message": "Not your turn. Wait for opponent to move.",
                "code": "NOT_YOUR_TURN",
            },
        )
        return

    try:
        move = chess.Move.from_uci(move_uci)

        # Additional validation: check if move is legal
        if move not in game["board"].legal_moves:
            # Provide more specific error messages
            board = game["board"]

            # Check if it's a promotion move without specifying piece
            if (
                len(move_uci) == 4
                and board.piece_type_at(
                    chess.square_rank(chess.parse_square(move_uci[:2]))
                )
                == chess.PAWN
            ):
                source_rank = chess.square_rank(chess.parse_square(move_uci[:2]))
                target_rank = chess.square_rank(chess.parse_square(move_uci[2:4]))
                if (board.turn == chess.WHITE and target_rank == 7) or (
                    board.turn == chess.BLACK and target_rank == 0
                ):
                    emit(
                        "error",
                        {
                            "message": "Pawn promotion requires specifying piece (e.g., e7e8q)",
                            "code": "PROMOTION_REQUIRED",
                        },
                    )
                    return

            # Check if move is pseudo-legal (exists but not legal due to leaving king in check)
            try:
                pseudo_move = chess.Move.from_uci(move_uci)
                if pseudo_move in board.pseudo_legal_moves:
                    emit(
                        "error",
                        {
                            "message": "Illegal move: would leave king in check",
                            "code": "KING_IN_CHECK",
                        },
                    )
                else:
                    emit(
                        "error",
                        {
                            "message": "Illegal move for this piece",
                            "code": "ILLEGAL_MOVE",
                        },
                    )
            except:
                emit("error", {"message": "Illegal move", "code": "ILLEGAL_MOVE"})
            return

        # Deduct time for the moving player and check for timeout
        if game.get("clock_started_at"):
            elapsed = (
                datetime.now() - datetime.fromisoformat(game["clock_started_at"])
            ).total_seconds()
            game["clock"][player_index] = max(0, game["clock"][player_index] - elapsed)
            if game["clock"][player_index] == 0:
                winner_index = 1 - player_index
                winner_name = game["usernames"][winner_index]
                loser_name = game["usernames"][player_index]
                if winner_name and loser_name:
                    update_leaderboard(winner_name, loser_name)
                emit(
                    "game_ended",
                    {
                        "result": "timeout",
                        "winner": winner_name,
                        "loser": loser_name,
                        "message": f"{loser_name} ran out of time. {winner_name} wins!",
                    },
                    to=game_id,
                )
                return
        game["clock_started_at"] = datetime.now().isoformat()

        # Get move details before pushing
        is_capture = game["board"].is_capture(move)
        # Check for en passant: it's a capture but the target square doesn't have a piece
        is_en_passant = (
            game["board"].is_capture(move)
            and game["board"].piece_at(move.to_square) is None
        )
        is_castle = game["board"].is_castling(move)

        # Track captured piece
        captured_piece = None
        if is_capture:
            # Get the piece at the destination square before move is pushed
            if is_en_passant:
                # En passant: captured pawn is one rank behind the target square
                # White moves up the board (increasing rank), so captured pawn is below target
                # Black moves down (decreasing rank), so captured pawn is above target
                captured_square = (
                    move.to_square - 8
                    if game["board"].turn == chess.WHITE
                    else move.to_square + 8
                )
                captured_piece = game["board"].piece_at(captured_square)
            else:
                captured_piece = game["board"].piece_at(move.to_square)

            if captured_piece:
                # Current player captured - add to their captured pieces
                capturing_player = 0 if game["current_player"] == 0 else 1
                capturing_color = "white" if game["current_player"] == 0 else "black"
                game["captured_pieces"][capturing_color].append(
                    {
                        "type": captured_piece.symbol(),
                        "color": "white"
                        if captured_piece.color == chess.WHITE
                        else "black",
                    }
                )

        # Push the move
        game["board"].push(move)
        game["moves_history"].append(move_uci)
        game["current_player"] = 1 - game["current_player"]
        game["last_activity"] = datetime.now().isoformat()

        # Check for all draw conditions
        is_checkmate = game["board"].is_checkmate()
        is_stalemate = game["board"].is_stalemate()
        is_insufficient_material = game["board"].is_insufficient_material()
        is_repetition = game["board"].is_repetition()
        is_fivefold_repetition = game["board"].is_fivefold_repetition()
        is_seventyfive_moves = game["board"].is_seventyfive_moves()
        is_fifty_moves = game["board"].is_fifty_moves()

        # Determine game end reason
        game_end_reason = None
        if is_checkmate:
            game_end_reason = "checkmate"
        elif is_stalemate:
            game_end_reason = "stalemate"
        elif is_insufficient_material:
            game_end_reason = "insufficient_material"
        elif is_repetition:
            game_end_reason = "threefold_repetition"
        elif is_fivefold_repetition:
            game_end_reason = "fivefold_repetition"
        elif is_seventyfive_moves:
            game_end_reason = "seventyfive_moves"
        elif is_fifty_moves:
            game_end_reason = "fifty_moves"

        # Handle game end and update leaderboard
        if is_checkmate and game["usernames"][0] and game["usernames"][1]:
            # Winner is the player who just moved (previous player)
            winner_index = 1 - game["current_player"]
            loser_index = game["current_player"]
            winner_name = game["usernames"][winner_index]
            loser_name = game["usernames"][loser_index]

            if winner_name and loser_name:
                update_leaderboard(winner_name, loser_name)
                print(f"Leaderboard updated: {winner_name} defeated {loser_name}")

        # Broadcast the move to both players
        emit(
            "move_made",
            {
                "move": move_uci,
                "from": move_uci[:2],
                "to": move_uci[2:4],
                "promotion": move_uci[4] if len(move_uci) == 5 else None,
                "board_fen": game["board"].fen(),
                "is_check": game["board"].is_check(),
                "is_checkmate": is_checkmate,
                "is_stalemate": is_stalemate,
                "is_insufficient_material": is_insufficient_material,
                "is_repetition": is_repetition,
                "is_fivefold_repetition": is_fivefold_repetition,
                "is_seventyfive_moves": is_seventyfive_moves,
                "is_fifty_moves": is_fifty_moves,
                "is_draw": is_stalemate
                or is_insufficient_material
                or is_fivefold_repetition
                or is_seventyfive_moves
                or is_repetition
                or is_fifty_moves,
                "is_capture": is_capture,
                "is_en_passant": is_en_passant,
                "is_castle": is_castle,
                "captured_piece": captured_piece.symbol() if captured_piece else None,
                "captured_pieces": game["captured_pieces"],
                "game_end_reason": game_end_reason,
                "current_player": game["current_player"],
                "clock": game["clock"],
            },
            to=game_id,
        )

        print(f"Move {move_uci} made in game {game_id}")

    except ValueError as e:
        emit(
            "error",
            {"message": f"Invalid move format: {str(e)}", "code": "MOVE_PARSE_ERROR"},
        )
    except Exception as e:
        emit(
            "error",
            {"message": f"Error processing move: {str(e)}", "code": "MOVE_ERROR"},
        )
        print(f"Error processing move: {e}")


def cleanup_expired_games():
    """Remove games that have been inactive for more than 2 hours"""
    current_time = datetime.now()
    expired_games = []

    for game_id, game in list(games.items()):
        last_activity = datetime.fromisoformat(
            game.get("last_activity", game["start_time"])
        )
        # Game expires after 2 hours of inactivity
        if (current_time - last_activity).total_seconds() > 7200:
            expired_games.append(game_id)
            # Notify players if they're still connected
            for player_id in game["players"]:
                if player_id and player_id in player_games:
                    del player_games[player_id]

    for game_id in expired_games:
        del games[game_id]
        print(f"Expired game {game_id} cleaned up")


@socketio.on("get_board_state")
def handle_get_board_state():
    session_id = request.sid

    if session_id not in player_games:
        emit("error", {"message": "Not in a game", "code": "NOT_IN_GAME"})
        return

    game_id = player_games[session_id]
    game = games.get(game_id)

    if not game:
        emit(
            "error", {"message": "Game not found or expired", "code": "GAME_NOT_FOUND"}
        )
        # Clean up stale reference
        del player_games[session_id]
        return

    # Update last activity
    game["last_activity"] = datetime.now().isoformat()

    # Check for all game end conditions
    board = game["board"]

    # Get castling rights
    castling = {
        "K": board.has_kingside_castling_rights(chess.WHITE),
        "Q": board.has_queenside_castling_rights(chess.WHITE),
        "k": board.has_kingside_castling_rights(chess.BLACK),
        "q": board.has_queenside_castling_rights(chess.BLACK),
    }

    # Get en passant target
    ep_square = board.ep_square
    en_passant = chess.square_name(ep_square) if ep_square else None

    # Calculate half move clock (for 50-move rule)
    half_moves = board.halfmove_clock

    # Calculate live-adjusted clock for the current player
    live_clock = list(game.get("clock", [1200, 1200]))
    if game.get("clock_started_at") and game["players"][1] is not None:
        elapsed = (
            datetime.now() - datetime.fromisoformat(game["clock_started_at"])
        ).total_seconds()
        current = game["current_player"]
        live_clock[current] = max(0, live_clock[current] - elapsed)

    emit(
        "board_state",
        {
            "board_fen": board.fen(),
            "moves_history": game["moves_history"],
            "current_player": game["current_player"],
            "is_check": board.is_check(),
            "is_checkmate": board.is_checkmate(),
            "is_stalemate": board.is_stalemate(),
            "is_insufficient_material": board.is_insufficient_material(),
            "is_repetition": board.is_repetition(),
            "is_fivefold_repetition": board.is_fivefold_repetition(),
            "is_seventyfive_moves": board.is_seventyfive_moves(),
            "is_fifty_moves": board.is_fifty_moves(),
            "is_draw": (
                board.is_stalemate()
                or board.is_insufficient_material()
                or board.is_fivefold_repetition()
                or board.is_seventyfive_moves()
                or board.is_repetition()
                or board.is_fifty_moves()
            ),
            "castling": castling,
            "en_passant": en_passant,
            "half_moves": half_moves,
            "full_moves": board.fullmove_number,
            "usernames": game["usernames"],
            "captured_pieces": game["captured_pieces"],
            "player_index": game["players"].index(session_id)
            if session_id in game["players"]
            else None,
            "clock": live_clock,
        },
    )


@socketio.on("leave_game")
def handle_leave_game():
    """Allow player to cleanly leave a game"""
    session_id = request.sid

    if session_id not in player_games:
        # Not in a game, nothing to do
        return

    game_id = player_games[session_id]

    if game_id in games:
        game = games[game_id]
        username = player_usernames.get(session_id, "Unknown")

        # Determine if player index
        try:
            player_index = game["players"].index(session_id)
        except ValueError:
            player_index = -1

        # Notify opponent
        other_player_index = 1 if player_index == 0 else 0
        other_player_id = (
            game["players"][other_player_index]
            if other_player_index in [0, 1]
            else None
        )

        if other_player_id:
            emit(
                "opponent_left",
                {"message": f"{username} left the game", "reason": "player_left"},
                to=game_id,
                skip_sid=session_id,
            )

        # Remove game if no players left
        remaining_players = [
            p for p in game["players"] if p is not None and p != session_id
        ]
        if not remaining_players:
            del games[game_id]
            print(f"Game {game_id} removed (all players left)")

    # Clean up player mappings
    del player_games[session_id]
    if session_id in player_usernames:
        del player_usernames[session_id]

    leave_room(game_id)
    emit("left_game", {"message": "You left the game successfully"})


@socketio.on("reset_game")
def handle_reset_game():
    session_id = request.sid

    if session_id not in player_games:
        emit("error", {"message": "Not in a game"})
        return

    game_id = player_games[session_id]
    game = games.get(game_id)

    if not game:
        emit("error", {"message": "Game not found or expired"})
        # Clean up stale reference
        del player_games[session_id]
        return

    # Find the player who requested reset
    try:
        player_index = game["players"].index(session_id)
    except ValueError:
        emit("error", {"message": "You are not a player in this game"})
        return

    # Reset the game state
    game["board"] = chess.Board()
    game["moves_history"] = []
    game["current_player"] = 0
    game["captured_pieces"] = {"white": [], "black": []}
    game["start_time"] = datetime.now().isoformat()
    game["last_activity"] = datetime.now().isoformat()
    game["clock"] = [1200, 1200]
    game["clock_started_at"] = datetime.now().isoformat()

    emit(
        "game_reset",
        {
            "board_fen": game["board"].fen(),
            "captured_pieces": game["captured_pieces"],
            "message": "Game has been reset",
            "reset_by": game["usernames"][player_index],
            "clock": game["clock"],
        },
        to=game_id,
    )

    print(f"Game {game_id} reset by {game['usernames'][player_index]}")


@socketio.on("timeout")
def handle_timeout():
    """Client-side clock timeout fallback — validate server-side before accepting"""
    session_id = request.sid

    if session_id not in player_games:
        return

    game_id = player_games[session_id]
    game = games.get(game_id)

    if not game:
        return

    try:
        player_index = game["players"].index(session_id)
    except ValueError:
        return

    # Validate: reject if server thinks more than 5s remain
    if game.get("clock_started_at"):
        elapsed = (
            datetime.now() - datetime.fromisoformat(game["clock_started_at"])
        ).total_seconds()
        server_remaining = game["clock"][player_index] - elapsed
        if server_remaining > 5:
            return

    winner_index = 1 - player_index
    winner_name = game["usernames"][winner_index]
    loser_name = game["usernames"][player_index]

    if winner_name and loser_name:
        update_leaderboard(winner_name, loser_name)

    emit(
        "game_ended",
        {
            "result": "timeout",
            "winner": winner_name,
            "loser": loser_name,
            "message": f"{loser_name} ran out of time. {winner_name} wins!",
        },
        to=game_id,
    )

    print(f"Timeout in game {game_id}: {loser_name} lost on time")


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


if __name__ == "__main__":
    print("Starting Chess Server...")
    start_cleanup_task()
    socketio.run(app, host="0.0.0.0", port=5050, debug=True, allow_unsafe_werkzeug=True)
