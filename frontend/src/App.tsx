/**
 * Main App Component
 */

import { useState, useEffect, useRef } from 'react';
import { NetworkedGame } from '@/game/NetworkedGame';
import { ContraptionBuilder } from '@/ui/components/ContraptionBuilder';
import { DeckBuilder } from '@/ui/components/DeckBuilder';
import type { ContraptionSaveData } from '@/game/contraptions/Contraption';
import './App.css';

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
    }

    return () => {
      if (view !== 'game' && gameRef.current) {
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
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              {hand.map((c) => (
                <button key={c.id} onClick={() => {
                  setSelectedContraption(c);
                  gameRef.current?.setSelectedContraption(c);
                }} disabled={!c || selectedContraption?.id === c.id}>
                  {c?.name || 'Empty'}
                </button>
              ))}
              <span style={{ marginLeft: 8, alignSelf: 'center' }}>Deck: {deckQueue.length}</span>
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
