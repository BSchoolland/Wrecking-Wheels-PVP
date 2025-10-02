/**
 * Main App Component
 */

import { useState, useEffect, useRef } from 'react';
import { NetworkedGame } from '@/game/NetworkedGame';
import { ContraptionBuilder } from '@/ui/components/ContraptionBuilder';
import type { ContraptionSaveData } from '@/game/contraptions/Contraption';
import './App.css';

type View = 'menu' | 'lobby' | 'game' | 'builder';
type Role = 'host' | 'client';

function App() {
  const [view, setView] = useState<View>('menu');
  const [role, setRole] = useState<Role>('host');
  const [lobbyId, setLobbyId] = useState('');
  const [playerId] = useState(`player-${Date.now()}`);
  const [selectedContraption, setSelectedContraption] = useState<ContraptionSaveData | null>(null);
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<NetworkedGame | null>(null);

  const getSavedContraptions = () => {
    const saved = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith('contraption-')) {
        try {
          const data = JSON.parse(localStorage.getItem(key)!);
          saved.push(data);
        } catch (e) {
          console.error('Failed to parse contraption:', key);
        }
      }
    }
    return saved;
  };

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
    if (view === 'game' && canvasRef.current && lobbyId && selectedContraption) {
      // Create networked game instance
      gameRef.current = new NetworkedGame({
        canvas: canvasRef.current,
        role,
        lobbyId,
        playerId,
        contraption: selectedContraption,
      });

      gameRef.current.start();
    }

    return () => {
      if (gameRef.current) {
        gameRef.current.destroy();
        gameRef.current = null;
      }
    };
  }, [view, role, lobbyId, playerId, selectedContraption]);

  return (
    <div className="app">
      <h1>Wrecking Wheels PVP</h1>
      
      {view === 'menu' && (
        <div className="menu">
          <button onClick={createLobby}>Create Lobby (Host)</button>
          <button onClick={joinLobby}>Join Lobby (Client)</button>
          <button onClick={() => setView('builder')}>Contraption Builder</button>
        </div>
      )}

      {view === 'builder' && (
        <ContraptionBuilder onBack={() => setView('menu')} />
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
          
          <div className="contraption-selection">
            <h3>Select Your Contraption</h3>
            <div className="contraption-list">
              {getSavedContraptions().map((data) => (
                <div 
                  key={data.id} 
                  className={`contraption-item ${selectedContraption?.id === data.id ? 'selected' : ''}`}
                  onClick={() => setSelectedContraption(data)}
                >
                  <div className="contraption-name">{data.name}</div>
                  <div className="contraption-info">{data.blocks.length} blocks</div>
                </div>
              ))}
              {getSavedContraptions().length === 0 && (
                <p className="no-contraptions">No saved contraptions. Create one in the builder first!</p>
              )}
            </div>
          </div>
          
          <div className="lobby-actions">
            <button onClick={startGame} disabled={!selectedContraption}>Start Game</button>
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
              <span>Left Click: Spawn contraption</span>
              <span>Right/Middle Click + Drag: Pan camera</span>
              <span>Mouse Wheel: Zoom in/out</span>
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
