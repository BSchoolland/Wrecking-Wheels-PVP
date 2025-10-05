/**
 * Main App Component
 */

import { useState, useEffect, useRef } from 'react';
import { NetworkedGame } from '@/game/NetworkedGame';
import { ContraptionBuilder } from '@/ui/components/ContraptionBuilder';
import { DeckBuilder } from '@/ui/components/DeckBuilder';
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

    // Save deck-1 with the ids (up to 6)
    const ids = defaultData.contraptions.slice(0, 6).map((c: ContraptionSaveData) => c.id);
    localStorage.setItem('deck-1', JSON.stringify(ids));
  } catch (error) {
    console.error('Failed to load default deck:', error);
  }
};

type View = 'menu' | 'lobby' | 'game' | 'builder' | 'deck';
type Role = 'host' | 'client';

function App() {
  const [view, setView] = useState<View>('menu');
  const [role, setRole] = useState<Role>('host');
  const [lobbyId, setLobbyId] = useState('');
  const [playerId] = useState(`player-${Date.now()}`);
  const [selectedContraption, setSelectedContraption] = useState<ContraptionSaveData | null>(null);
  const [selectedDeckSlot, setSelectedDeckSlot] = useState<1 | 2 | 3>(1);
  const [deckQueue, setDeckQueue] = useState<ContraptionSaveData[]>([]); // remaining draw pile
  const [hand, setHand] = useState<ContraptionSaveData[]>([]);
  const [gameOver, setGameOver] = useState<string | null>(null);
  const [resources, setResources] = useState({ material: 0, energy: 0 });
  
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

  const calculateCost = (contraption: ContraptionSaveData): { material: number; energy: number } => {
    const totalMaterial = contraption.blocks.reduce((sum, b) => {
      if (b.materialCost !== undefined) return sum + b.materialCost;
      const block = createBlock(b.type as BlockType, 0, 0);
      return sum + block.materialCost;
    }, 0);
    const totalEnergy = contraption.blocks.reduce((sum, b) => {
      if (b.energyCost !== undefined) return sum + b.energyCost;
      const block = createBlock(b.type as BlockType, 0, 0);
      return sum + block.energyCost;
    }, 0);
    return {
      material: Math.ceil(totalMaterial),
      energy: Math.ceil(totalEnergy),
    };
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

  const loadDeckIds = (slot: 1 | 2 | 3): string[] => {
    try {
      const raw = localStorage.getItem(`deck-${slot}`);
      const ids = raw ? JSON.parse(raw) : [];
      return Array.isArray(ids) ? ids : [];
    } catch {
      return [];
    }
  };

  const initDeckForGame = (slot: 1 | 2 | 3) => {
    const ids = loadDeckIds(slot).slice(0, 6);
    const contraptions: ContraptionSaveData[] = ids
      .map(id => resolveContraptionById(id))
      .filter(Boolean) as ContraptionSaveData[];
    // If fewer than 6, allow starting but just use what exists
    const initialQueue = contraptions.slice();
    const initialHand = initialQueue.splice(0, 3);
    setDeckQueue(initialQueue);
    setHand(initialHand);
    setSelectedContraption(initialHand[0] || null);
  };

  const startGame = () => {
    initDeckForGame(selectedDeckSlot);
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
      let resourceInterval: number | null = null;
      
      // Create networked game instance only once per game start
      if (!gameRef.current) {
        gameRef.current = new NetworkedGame({
          canvas: canvasRef.current,
          role,
          lobbyId,
          playerId,
          contraption: selectedContraption,
          onContraptionSpawned: () => {
            setHand(prev => {
              const selected = selectedRef.current;
              if (!selected) return prev;
              const idx = prev.findIndex(c => c.id === selected.id);
              if (idx === -1) return prev;
              const newHand = prev.slice();
              const [played] = newHand.splice(idx, 1);
              let drawn: ContraptionSaveData | undefined;
              setDeckQueue(q => {
                if (q.length === 0) return q;
                drawn = q[0];
                const rest = q.slice(1);
                if (played) rest.push(played);
                if (drawn) newHand.push(drawn);
                setSelectedContraption(newHand[0] || null);
                return rest;
              });
              return newHand;
            });
          },
          onGameOver: (winner: 'host' | 'client') => {
            const isWin = winner === role;
            const message = isWin ? "You win!" : "You Lose :(";
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
        // Just update the selected contraption when switching cards
        gameRef.current.setSelectedContraption(selectedContraption);
      }

      // Start resource polling while in game view
      resourceInterval = setInterval(() => {
        const res = gameRef.current?.getPlayerResources(playerId);
        if (res) {
          setResources(prev => (prev.material !== res.material || prev.energy !== res.energy)
            ? { material: res.material, energy: res.energy }
            : prev);
        }
      }, 50);

      return () => {
        if (resourceInterval) clearInterval(resourceInterval);
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
          <button onClick={() => setView('deck')}>Deck Builder</button>
          <button onClick={() => setView('builder')}>Contraption Builder</button>
        </div>
      )}

      {view === 'deck' && (
        <DeckBuilder onBack={() => setView('menu')} />
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
            <h3>Select Deck Slot</h3>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <button onClick={() => setSelectedDeckSlot(1)} disabled={selectedDeckSlot === 1}>Deck 1</button>
              <button onClick={() => setSelectedDeckSlot(2)} disabled={selectedDeckSlot === 2}>Deck 2</button>
              <button onClick={() => setSelectedDeckSlot(3)} disabled={selectedDeckSlot === 3}>Deck 3</button>
            </div>
            <div>
              <h4>Preview</h4>
              <div className="contraption-list">
                {(() => {
                  try {
                    const raw = localStorage.getItem(`deck-${selectedDeckSlot}`) || '[]';
                    const ids = JSON.parse(raw);
                    const items = Array.isArray(ids) ? ids : [];
                    if (items.length === 0) return <p className="no-contraptions">Empty deck. Build one in Deck Builder.</p>;
                    return items.slice(0, 6).map((id: string) => {
                      const dataRaw = localStorage.getItem(`contraption-${id}`);
                      if (!dataRaw) return null;
                      try {
                        const data = JSON.parse(dataRaw);
                        return (
                          <div key={id} className="contraption-item">
                            <div className="contraption-name">{data.name}</div>
                            <div className="contraption-info">{data.blocks?.length || 0} blocks</div>
                          </div>
                        );
                      } catch { return null; }
                    });
                  } catch { return null; }
                })()}
              </div>
            </div>
          </div>
          
          <div className="lobby-actions">
            <button onClick={startGame}>Start Game</button>
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
              <span>Left Click: Spawn contraption</span>
              <span>Right/Middle Click + Drag: Pan camera</span>
              <span>Mouse Wheel: Zoom in/out</span>
            </div>
            <div className="resources-display">
              <span style={{ fontWeight: 'bold' }}>⚙️ Material: {resources.material.toFixed(1)}/10</span>
              <span style={{ fontWeight: 'bold' }}>⚡ Energy: {resources.energy.toFixed(1)}/10</span>
            </div>
          </div>
          <div className="contraption-cards-container">
            <div className="contraption-cards">
              {hand.map((c) => {
                const cost = calculateCost(c);
                const isSelected = selectedContraption?.id === c.id;
                const canAfford = resources.material >= cost.material && resources.energy >= cost.energy;
                
                return (
                  <div 
                    key={c.id} 
                    className={`contraption-card ${isSelected ? 'selected' : ''} ${!canAfford ? 'unaffordable' : ''}`}
                    onClick={() => {
                      setSelectedContraption(c);
                      gameRef.current?.setSelectedContraption(c);
                    }}
                  >
                    <div className="card-name">{c?.name || 'Empty'}</div>
                    <div className="card-preview">
                      {renderContraptionPreview(c)}
                    </div>
                    <div className="card-costs">
                      <span className={`cost-item ${resources.material < cost.material ? 'insufficient' : ''}`}>
                        ⚙️ {cost.material}
                      </span>
                      <span className={`cost-item ${resources.energy < cost.energy ? 'insufficient' : ''}`}>
                        ⚡ {cost.energy}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="deck-counter">Deck: {deckQueue.length}</div>
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
