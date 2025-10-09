/**
 * Main App Component
 */

import { useState, useEffect, useRef } from 'react';
import { NetworkedGame } from '@/game/NetworkedGame';
import { ContraptionBuilder } from '@/ui/components/ContraptionBuilder';
// Decks removed in arena mode
import type { ContraptionSaveData } from '@/game/contraptions/Contraption';
import { createBlock } from '@/game/contraptions';
import type { BlockType } from '@/game/contraptions';
import './App.css';

const initializeDefaults = async () => {
  // Check if any contraptions are saved
  let hasContraptions = false;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith('contraption-')) {
      hasContraptions = true;
      break;
    }
  }
  if (hasContraptions) return;

  try {
    const defaultDeckModule = await import('./assets/default-deck.json', { assert: { type: 'json' } });
    const defaultData = defaultDeckModule.default as { contraptions: ContraptionSaveData[] };

    // Save each contraption
    defaultData.contraptions.forEach((c: ContraptionSaveData) => {
      localStorage.setItem(`contraption-${c.id}`, JSON.stringify(c));
    });
  } catch (error) {
    console.error('Failed to load default deck:', error);
  }
};

type View = 'menu' | 'lobby' | 'game' | 'builder';
type Role = 'host' | 'client';

function App() {
  const [view, setView] = useState<View>('menu');
  const [role, setRole] = useState<Role>('host');
  const [lobbyId, setLobbyId] = useState('');
  const [playerId] = useState(`player-${Date.now()}`);
  const [selectedContraption, setSelectedContraption] = useState<ContraptionSaveData | null>(null);
  // Energy/health removed in arena mode
  const [gameOver, setGameOver] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<NetworkedGame | null>(null);
  const selectedRef = useRef<ContraptionSaveData | null>(null);


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

  const resolveContraptionById = (id: string): ContraptionSaveData | null => {
    try {
      const raw = localStorage.getItem(`contraption-${id}`);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  };

  const calculateCost = (contraption: ContraptionSaveData): { energy: number } => {
    const totalEnergy = contraption.blocks.reduce((sum, b) => {
      if (b.energyCost !== undefined) return sum + b.energyCost;
      const block = createBlock(b.type as BlockType, 0, 0);
      return sum + block.energyCost;
    }, 0);
    return {
      energy: Math.ceil(Number(totalEnergy.toFixed(2))),
    };
  };

  const calculatePlacementTime = (contraption: ContraptionSaveData): number => {
    const blockCount = contraption.blocks.length;
    return (500 + blockCount * 50) / 1000; // Convert to seconds
  };

  const renderContraptionPreview = (contraption: ContraptionSaveData): JSX.Element => {
    if (!contraption.blocks || contraption.blocks.length === 0) {
      return <div className="preview-empty">No blocks</div>;
    }

    const blocks = contraption.blocks;
    const minX = Math.min(...blocks.map(b => b.gridX));
    const maxX = Math.max(...blocks.map(b => b.gridX));
    const minY = Math.min(...blocks.map(b => b.gridY));
    const maxY = Math.max(...blocks.map(b => b.gridY));
    
    const width = maxX - minX + 1;
    const height = maxY - minY + 1;
    const cellSize = 12;

    return (
      <svg width={width * cellSize} height={height * cellSize} className="contraption-preview-svg">
        {blocks.map((block, idx) => {
          const x = (block.gridX - minX) * cellSize;
          const y = (block.gridY - minY) * cellSize;
          const colors: Record<string, string> = {
            core: '#f39c12',
            simple: '#2196f3',
            gray: '#7f8c8d',
            wheel: '#34495e',
            spike: '#e74c3c',
            tnt: '#e67e22',
          };
          const color = colors[block.type] || '#bdc3c7';
          
          return block.type === 'wheel' ? (
            <circle key={idx} cx={x + cellSize/2} cy={y + cellSize/2} r={cellSize/2 - 1} fill={color} />
          ) : (
            <rect key={idx} x={x + 1} y={y + 1} width={cellSize - 2} height={cellSize - 2} fill={color} />
          );
        })}
      </svg>
    );
  };

  const startGame = () => {
    setView('game');
  };

  const stopGame = () => {
    setGameOver(null);
    if (gameRef.current) {
      gameRef.current.destroy();
      gameRef.current = null;
    }
    setView('menu');
    setLobbyId('');
  };

  useEffect(() => {
    initializeDefaults();
  }, []);

  useEffect(() => {
    selectedRef.current = selectedContraption;
  }, [selectedContraption]);

  useEffect(() => {
    if (view === 'game' && canvasRef.current && lobbyId && selectedContraption) {
      // Create networked game instance only once per game start
      if (!gameRef.current) {
        gameRef.current = new NetworkedGame({
          canvas: canvasRef.current,
          role,
          lobbyId,
          playerId,
          contraption: selectedContraption,
          onGameOver: (winner: 'host' | 'client' | 'tie') => {
            const isWin = winner !== 'tie' && winner === role;
            const message = winner === 'tie' ? "It's a tie!" : (isWin ? "You win!" : "You Lose :(");
            setGameOver(message);
            gameRef.current?.stop();
            setTimeout(() => {
              setGameOver(null);
              stopGame();
            }, 3000);
          },
        });

        gameRef.current.start();
      } else {
        // Update selected contraption
        gameRef.current.setSelectedContraption(selectedContraption);
      }
      return () => {
        if (view !== 'game' && gameRef.current) {
          gameRef.current.destroy();
          gameRef.current = null;
        }
      };
    }
  }, [view, role, lobbyId, playerId, selectedContraption]);

  return (
    <div className="app">
      <h1>Wrecking Wheels PVP</h1>
      
      {view === 'menu' && (
        <div className="menu">
          <button onClick={createLobby}>Create Lobby (Host)</button>
          <button onClick={joinLobby}>Join Lobby (Client)</button>
          {/* Decks removed */}
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
              {(() => {
                const items: ContraptionSaveData[] = [];
                for (let i = 0; i < localStorage.length; i++) {
                  const key = localStorage.key(i);
                  if (!key || !key.startsWith('contraption-')) continue;
                  const raw = localStorage.getItem(key);
                  if (!raw) continue;
                  try { items.push(JSON.parse(raw)); } catch {}
                }
                if (items.length === 0) return <p className="no-contraptions">No saved contraptions. Create one in the builder.</p>;
                return items.map((data) => (
                  <div 
                    key={data.id} 
                    className={`contraption-item ${selectedContraption?.id === data.id ? 'selected' : ''}`}
                    onClick={() => setSelectedContraption(data)}
                  >
                    <div className="contraption-name">{data.name}</div>
                    <div className="contraption-info">{data.blocks?.length || 0} blocks</div>
                  </div>
                ));
              })()}
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
        <div className="game-container" style={{ position: 'relative' }}>
          <canvas ref={canvasRef}></canvas>
          {gameOver && (
            <div 
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                backgroundColor: 'rgba(0, 0, 0, 0.7)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                alignItems: 'center',
                color: 'white',
                fontSize: '2em',
                zIndex: 10
              }}
            >
              <h2>{gameOver}</h2>
              <p>Returning to menu in 3 seconds...</p>
            </div>
          )}
          <div className="game-hud">
            <div className="hud-info">
              <span>Lobby: {lobbyId}</span>
              <span>Role: {role}</span>
              <span>Controls: A drive forward, D reverse</span>
              <span>Right/Middle Click + Drag: Pan camera</span>
              <span>Mouse Wheel: Zoom in/out</span>
            </div>
          </div>
          <button className="back-button" onClick={stopGame} style={{ position: 'absolute', bottom: 12, right: 12 }}>
            Leave Game
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
