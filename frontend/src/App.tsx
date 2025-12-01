/**
 * Main App Component
 */

import { useState, useEffect, useRef } from 'react';
import { NetworkedGame } from '@/game/NetworkedGame';
import { PhysicsEngine } from '@/core/physics/PhysicsEngine';
import { Renderer } from '@/rendering/Renderer';
import { WORLD_BOUNDS } from '@shared/constants/physics';
import { ContraptionBuilder } from '@/ui/components/ContraptionBuilder';
import { ContraptionTester } from '@/ui/components/ContraptionTester';
import type { ContraptionSaveData } from '@/game/contraptions/Contraption';
import type { PlayerReadyCommand } from '@shared/types/Commands';
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

type View = 'menu' | 'lobby' | 'game' | 'builder' | 'test';
type Role = 'host' | 'client';

type QueueJoinResponse = { success: boolean; lobbyId: string; role: Role; status: 'waiting' | 'ready'; players?: string[] };

function App() {
  const [view, setView] = useState<View>('menu');
  const [role, setRole] = useState<Role>('host');
  const [lobbyId, setLobbyId] = useState('');
  const [playerId] = useState(`player-${Date.now()}`);
  const [selectedContraption, setSelectedContraption] = useState<ContraptionSaveData | null>(null);
  // Energy/health removed in arena mode
  const [isWaiting, setIsWaiting] = useState(false);
  const [contraptionToTest, setContraptionToTest] = useState<ContraptionSaveData | null>(null);
  const [gameWinState, setGameWinState] = useState<'win' | 'loss' | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bgCanvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<NetworkedGame | null>(null);
  const bgRendererRef = useRef<Renderer | null>(null);
  const bgPhysicsRef = useRef<PhysicsEngine | null>(null);
  const bgAnimRef = useRef<number | null>(null);
  const selectedRef = useRef<ContraptionSaveData | null>(null);
  const pollIntervalRef = useRef<number | null>(null);

  // Single Play action -> queue join
  const play = async () => {
    try {
      setIsWaiting(true);
      const res = await fetch('/api/matchmaking/queue/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status} ${res.statusText}${text ? `: ${text}` : ''}`);
      }
      const data = (await res.json()) as QueueJoinResponse;
      if (!data.success) throw new Error('Failed to join queue');
      setLobbyId(data.lobbyId);
      setRole(data.role);
      setView('lobby');
      if (data.status === 'waiting') {
        startPollingForReady(data.lobbyId);
      } else {
        setIsWaiting(false);
        // Lobby is already ready (both players matched), create NetworkedGame immediately
        if (canvasRef.current && !gameRef.current) {
          gameRef.current = new NetworkedGame({
            canvas: canvasRef.current,
            role: data.role,
            lobbyId: data.lobbyId,
            playerId,
            contraption: selectedContraption || undefined,
            onReturnToMenu: () => {
              gameRef.current?.destroy();
              gameRef.current = null;
              setView('menu');
            },
          });
          gameRef.current.start();
        }
      }
    } catch (e) {
      console.error('Queue join failed', e);
      setIsWaiting(false);
      alert('Failed to join matchmaking. Is the backend running on port 3001?');
    }
  };

  const startPollingForReady = (id: string) => {
    if (pollIntervalRef.current) window.clearInterval(pollIntervalRef.current);
    pollIntervalRef.current = window.setInterval(async () => {
      try {
        const res = await fetch(`/api/matchmaking/lobby/${id}`);
        if (!res.ok) return;
        const { lobby } = await res.json();
        if (lobby?.status === 'ready') {
          setIsWaiting(false);
          // Create NetworkedGame instance when both players are matched (regardless of contraption selection)
          if (!gameRef.current && canvasRef.current) {
            gameRef.current = new NetworkedGame({
              canvas: canvasRef.current,
              role,
              lobbyId: id,
              playerId,
              contraption: selectedContraption || undefined,
              onReturnToMenu: () => {
                gameRef.current?.destroy();
                gameRef.current = null;
                setView('menu');
              },
            });
            gameRef.current.start();
          }
          if (pollIntervalRef.current) { window.clearInterval(pollIntervalRef.current); pollIntervalRef.current = null; }
        }
      } catch {
        void 0; // ignore transient errors
      }
    }, 1000);
  };

  const leaveQueueIfWaiting = async () => {
    if (!isWaiting) return;
    try {
      await fetch('/api/matchmaking/queue/leave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId }),
      });
    } catch {
      void 0; // ignore errors on best-effort leave
    }
  };

  const startGame = () => {
    // Send player-ready command when Ready button is clicked
    if (gameRef.current && selectedContraption) {
      const readyCmd: PlayerReadyCommand = {
        type: 'player-ready',
        playerId,
        contraption: selectedContraption,
      };
      gameRef.current.sendReadyCommand(readyCmd);
    }
    setView('game');
  };

  const stopGame = () => {
    if (gameRef.current) {
      gameRef.current.destroy();
      gameRef.current = null;
    }
    setView('menu');
    setLobbyId('');
    setIsWaiting(false);
    if (pollIntervalRef.current) { window.clearInterval(pollIntervalRef.current); pollIntervalRef.current = null; }
  };

  useEffect(() => {
    initializeDefaults();
  }, []);

  useEffect(() => {
    selectedRef.current = selectedContraption;
  }, [selectedContraption]);

  // Create NetworkedGame when lobby is ready (regardless of contraption selection)
  useEffect(() => {
    if (view === 'lobby' && lobbyId && !isWaiting && canvasRef.current && !gameRef.current) {
      gameRef.current = new NetworkedGame({
        canvas: canvasRef.current,
        role,
        lobbyId,
        playerId,
        contraption: selectedContraption || undefined,
      });
      gameRef.current.start();
    }
  }, [view, lobbyId, isWaiting, role, playerId]);
  
  // Update contraption when selected (if NetworkedGame already exists)
  useEffect(() => {
    if (gameRef.current && selectedContraption) {
      gameRef.current.setSelectedContraption(selectedContraption);
    }
  }, [selectedContraption]);

  useEffect(() => {
    if (view === 'game' && canvasRef.current && lobbyId && selectedContraption) {
      // Game view: NetworkedGame should already be created in lobby
      // Just ensure it's started if it wasn't already
      if (gameRef.current) {
        // Update selected contraption if changed
        gameRef.current.setSelectedContraption(selectedContraption);
      } else {
        // Fallback: create if somehow not created in lobby
        gameRef.current = new NetworkedGame({
          canvas: canvasRef.current,
          role,
          lobbyId,
          playerId,
          contraption: selectedContraption,
          onReturnToMenu: () => {
            gameRef.current?.destroy();
            gameRef.current = null;
            setView('menu');
          },
        });
        gameRef.current.start();
      }
      return () => {
        if (view !== 'game' && gameRef.current) {
          gameRef.current.destroy();
          gameRef.current = null;
        }
      };
    }
  }, [view, role, lobbyId, playerId, selectedContraption]);

  // Background physics + render loop for non-game views
  useEffect(() => {
    if (view !== 'game' && bgCanvasRef.current) {
      // Initialize once per entry into non-game view
      if (!bgRendererRef.current) {
        bgRendererRef.current = new Renderer(bgCanvasRef.current);
        bgRendererRef.current.camera.setControlsEnabled(false);
        bgRendererRef.current.camera.y = WORLD_BOUNDS.HEIGHT * 0.3;
        bgRendererRef.current.camera.setZoom(bgRendererRef.current.camera.zoom * 1.25);
      }
      if (!bgPhysicsRef.current) {
        bgPhysicsRef.current = new PhysicsEngine();
        bgPhysicsRef.current.start();
      }
      const loop = () => {
        if (bgRendererRef.current && bgPhysicsRef.current) {
          bgRendererRef.current.renderPhysics(bgPhysicsRef.current.getAllBodies());
        }
        bgAnimRef.current = requestAnimationFrame(loop);
      };
      if (!bgAnimRef.current) bgAnimRef.current = requestAnimationFrame(loop);
      return () => {
        if (bgAnimRef.current) { cancelAnimationFrame(bgAnimRef.current); bgAnimRef.current = null; }
      };
    } else {
      // Tear down when entering game view
      if (bgAnimRef.current) { cancelAnimationFrame(bgAnimRef.current); bgAnimRef.current = null; }
      bgRendererRef.current?.destroy();
      bgRendererRef.current = null;
      bgPhysicsRef.current?.destroy();
      bgPhysicsRef.current = null;
    }
  }, [view]);

  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) window.clearInterval(pollIntervalRef.current);
      void leaveQueueIfWaiting();
    };
  }, []);

  // Poll for game win state
  useEffect(() => {
    if (view === 'game' && gameRef.current) {
      const interval = setInterval(() => {
        const winState = gameRef.current?.getWinState();
        if (winState) {
          setGameWinState(winState.winner === playerId ? 'win' : 'loss');
        }
      }, 100);
      return () => clearInterval(interval);
    }
  }, [view, playerId]);

  return (
    <div className="app">
      {(view !== 'game' && view !== 'lobby') && (
        <canvas
          ref={bgCanvasRef}
          className="bg-canvas"
        />
      )}
      {(view === 'lobby' || view === 'game') && (
        <canvas
          ref={canvasRef}
          style={{ display: view === 'lobby' ? 'none' : 'block' }}
        />
      )}
      {view === 'game' && gameWinState && (
        <div style={{
          position: 'fixed',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10,
          pointerEvents: 'none'
        }}>
          <button
            className="btn btn-primary"
            onClick={() => {
              gameRef.current?.destroy();
              gameRef.current = null;
              setGameWinState(null);
              setView('menu');
            }}
            style={{ pointerEvents: 'auto', marginTop: '80px' }}
          >
            Return to Menu
          </button>
        </div>
      )}
      {view !== 'game' && (
        <div className="overlay">
          <h1 className="title">Wrecking Wheels PVP</h1>
          {view === 'menu' && (
            <div className="menu">
              <button className="btn btn-primary" onClick={play} disabled={isWaiting}>Play</button>
              <button className="btn btn-secondary" onClick={() => setView('builder')}>Contraption Builder</button>
            </div>
          )}

          {view === 'builder' && (
            <ContraptionBuilder onBack={() => setView('menu')} onTestStart={(data) => { setContraptionToTest(data); setView('test'); }} />
          )}

          {view === 'test' && contraptionToTest && (
            <ContraptionTester contraption={contraptionToTest} onBack={() => setView('builder')} />
          )}

          {view === 'lobby' && (
            <div className="lobby">
              <p className="info">
                {isWaiting ? 'Waiting for another player to join…' : 'Matched!  Waiting for both players to be ready...'}
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
                      try { items.push(JSON.parse(raw)); } catch { /* ignore parse errors */ }
                    }
                    if (items.length === 0) return <p className="no-contraptions">No saved contraptions. Create one in the builder.</p>;
                    return items.map((data) => (
                      <div 
                        key={data.id} 
                        className={`contraption-item ${selectedContraption?.id === data.id ? 'selected' : ''}`}
                        onClick={() => setSelectedContraption(data)}
                      >
                        <div className="contraption-name">{data.name}</div>
                        <div className="contraption-info">{data.blocks?.length || 0} blocks{data.vehicleClass ? ` • ${data.vehicleClass}` : ''}</div>
                      </div>
                    ));
                  })()}
                </div>
              </div>

              <div className="lobby-actions">
                <button className="btn btn-primary" onClick={startGame} disabled={!selectedContraption || isWaiting}>Ready</button>
                <button className="btn btn-secondary" onClick={() => { setView('menu'); setLobbyId(''); setIsWaiting(false); if (pollIntervalRef.current) { window.clearInterval(pollIntervalRef.current); pollIntervalRef.current = null; } void leaveQueueIfWaiting(); }}>
                  Back to Menu
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {view === 'game' && (
        <div className="game-container" style={{ position: 'relative' }}>
          <canvas ref={canvasRef}></canvas>
          <button className="back-button" onClick={stopGame} style={{ position: 'absolute', bottom: 12, right: 12 }}>
            Leave Game
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
