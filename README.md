# Local Chess - Multiplayer Chess Web App

A Python-based web application for playing chess between 2 players on the same local network.

## Features

- 🎮 Real-time multiplayer chess using WebSockets
- 🌐 Play with friends on the same home network
- ♟️ Full chess rule implementation using `python-chess`
- 🎨 Beautiful, responsive UI using Chessboard.js
- 🔗 Game ID sharing for easy connection
- 📝 Move history tracking
- ✅ Check, checkmate, and stalemate detection

## Requirements

- Python 3.7+
- See `requirements.txt` for dependencies

## Installation

1. Clone or navigate to the project directory:
```bash
cd /home/thevix/Documents/personal/project/local-chess-python
```

2. Create a virtual environment (optional but recommended):
```bash
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

3. Install Python dependencies:
```bash
pip install -r requirements.txt
```

4. Download and set up the chess libraries locally:
```bash
python3 setup_libs.py
```
This script downloads Chessboard.js, Chess.js, jQuery, and chess piece images into the `static` folder so the app works without CDN dependencies.

## Running the Application

1. Start the server:
```bash
python app.py
```

2. The server will start on `http://0.0.0.0:5000` and be accessible from:
   - Local machine: `http://localhost:5000`
   - Other machines on the network: `http://<your-machine-ip>:5000`

3. Find your machine's local IP:
   - **Linux/Mac**: Run `ifconfig` and look for `inet` address (usually `192.168.x.x`)
   - **Windows**: Run `ipconfig` and look for IPv4 Address

4. One player creates a game and shares the Game ID with the other player
5. The second player joins using the Game ID
6. Play! White moves first.

## Project Structure

```
local-chess-python/
├── app.py                 # Flask backend with SocketIO
├── requirements.txt       # Python dependencies
├── templates/
│   └── index.html        # Main game page
└── static/
    ├── css/
    │   └── style.css     # Game styling
    └── js/
        └── chess.js      # Client-side logic
```

## How to Play

1. **Create Game**: Click "Create Game" to start a new game and get a Game ID
2. **Join Game**: Share the Game ID with your friend, who can click "Join Game" and enter it
3. **Play**: Once both players are connected, the game starts with white to move
4. **Moves**: Click and drag pieces to move (or enter moves in algebraic notation)
5. **Game End**: Game ends automatically on checkmate or stalemate

## Technical Details

- **Backend**: Flask + Flask-SocketIO for real-time communication
- **Chess Logic**: python-chess library for move validation and game rules
- **Frontend**: Chessboard.js for the interactive board, Chess.js for validation
- **Communication**: WebSockets for real-time move updates between players

## Troubleshooting

- **Can't connect from other devices?**: Make sure both devices are on the same network and use the correct IP address
- **Moves not working?**: Refresh the page and rejoin the game
- **Port 5000 already in use?**: Change the port in `app.py` last line: `socketio.run(app, host='0.0.0.0', port=YOUR_PORT)`

## License

MIT License
