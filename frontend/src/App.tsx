/**
 * Main App Component
 */

import { useState, useEffect, useRef } from 'react';
import { NetworkedGame } from '@/game/NetworkedGame';
import './App.css';

type View = 'menu' | 'lobby' | 'game';
type Role = 'host' | 'client';

function App() {
  const [view, setView] = useState<View>('menu');
  const [role, setRole] = useState<Role>('host');
  const [lobbyId, setLobbyId] = useState('');
  const [playerId] = useState(`player-${Date.now()}`);
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<NetworkedGame | null>(null);

  const createLobby = () => {
    const newLobbyId = `lobby-${Date.now()}`;
    setLobbyId(newLobbyId);
    setRole('host');
    setView('lobby');
  };

  const joinLobby = () => {
    const inputLobbyId = prompt('Enter lobby ID:');
    if (inputLobbyId) {
      setLobbyId(inputLobbyId);
      setRole('client');
      setView('lobby');
    }
  };

  const startGame = () => {
    setView('game');
  };

  const stopGame = () => {
    if (gameRef.current) {
      gameRef.current.destroy();
      gameRef.current = null;
    }
    setView('menu');
    setLobbyId('');
  };

  useEffect(() => {
    if (view === 'game' && canvasRef.current && lobbyId) {
      // Create networked game instance
      gameRef.current = new NetworkedGame({
        canvas: canvasRef.current,
        role,
        lobbyId,
        playerId,
      });

      gameRef.current.start();
    }

    return () => {
      if (gameRef.current) {
        gameRef.current.destroy();
        gameRef.current = null;
      }
    };
  }, [view, role, lobbyId, playerId]);

  return (
    <div className="app">
      <h1>Wrecking Wheels PVP</h1>
      
      {view === 'menu' && (
        <div className="menu">
          <button onClick={createLobby}>Create Lobby (Host)</button>
          <button onClick={joinLobby}>Join Lobby (Client)</button>
          <button>Contraption Builder (Coming Soon)</button>
        </div>
      )}

      {view === 'lobby' && (
        <div className="lobby">
          <h2>Lobby: {lobbyId}</h2>
          <p>Role: <strong>{role === 'host' ? 'Host' : 'Client'}</strong></p>
          <p className="info">
            {role === 'host' 
              ? 'Share this lobby ID with another player. They can join in a new tab/window.'
              : 'Connecting to host...'}
          </p>
          <div className="lobby-actions">
            <button onClick={startGame}>Start Game</button>
            <button onClick={() => { setView('menu'); setLobbyId(''); }}>
              Back to Menu
            </button>
          </div>
        </div>
      )}

      {view === 'game' && (
        <div className="game-container">
          <canvas ref={canvasRef}></canvas>
          <div className="game-hud">
            <div className="hud-info">
              <span>Lobby: {lobbyId}</span>
              <span>Role: {role}</span>
              <span>Click to spawn boxes!</span>
            </div>
            <button className="back-button" onClick={stopGame}>
              Leave Game
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
