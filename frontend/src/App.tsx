/**
 * Main App Component
 */

import { useState, useEffect, useRef } from 'react';
import { NetworkedGame } from '@/game/NetworkedGame';
import { PhysicsEngine } from '@shared/physics/PhysicsEngine';
import { Renderer } from '@/rendering/Renderer';
import { WORLD_BOUNDS } from '@shared/constants/physics';
import { ContraptionBuilder } from '@/ui/components/ContraptionBuilder';
import { ContraptionTester } from '@/ui/components/ContraptionTester';
import type { ContraptionSaveData } from '@shared/contraptions/Contraption';
import type { PlayerReadyCommand } from '@shared/types/Commands';
import type { UIState } from '@shared/types/Commands';
import type { BlockType } from '@shared/contraptions';
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
type GameMode = 'normal' | 'build';

type QueueJoinResponse = { success: boolean; lobbyId: string; role: 'host' | 'client'; status: 'waiting' | 'ready'; players?: string[] };

function App() {
  const [view, setView] = useState<View>('menu');
  const [showModeSelector, setShowModeSelector] = useState<boolean>(false);
  const [selectedMode, setSelectedMode] = useState<GameMode>('normal');
  const [playerIndex, setPlayerIndex] = useState<number>(0); // 0 = first player, 1 = second
  const [lobbyId, setLobbyId] = useState('');
  const [playerId] = useState(`player-${Date.now()}`);
  const [selectedContraption, setSelectedContraption] = useState<ContraptionSaveData | null>(null);
  // Energy/health removed in arena mode
  const [isWaiting, setIsWaiting] = useState(false);
  const [contraptionToTest, setContraptionToTest] = useState<ContraptionSaveData | null>(null);
  const [gameWinState, setGameWinState] = useState<'win' | 'loss' | null>(null);
  const [latestUIState, setLatestUIState] = useState<UIState | null>(null);
  const latestBlueprintRef = useRef<ContraptionSaveData | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bgCanvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<NetworkedGame | null>(null);
  const bgRendererRef = useRef<Renderer | null>(null);
  const bgPhysicsRef = useRef<PhysicsEngine | null>(null);
  const bgAnimRef = useRef<number | null>(null);
  const selectedRef = useRef<ContraptionSaveData | null>(null);
  const pollIntervalRef = useRef<number | null>(null);
  const buildAudioRef = useRef<HTMLAudioElement | null>(null);

  // Open mode selector from Play
  const play = () => {
    setShowModeSelector(true);
  };

  // Join queue with the selected mode
  const joinQueue = async (mode: GameMode) => {
    try {
      setIsWaiting(true);
      setShowModeSelector(false);
      const res = await fetch('/api/matchmaking/queue/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId, mode }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status} ${res.statusText}${text ? `: ${text}` : ''}`);
      }
      const data = (await res.json()) as QueueJoinResponse;
      if (!data.success) throw new Error('Failed to join queue');
      setLobbyId(data.lobbyId);
      // First player (host role) is index 0, second player (client role) is index 1
      setPlayerIndex(data.role === 'host' ? 0 : 1);
      setView('lobby');
      if (data.status === 'waiting') {
        startPollingForReady(data.lobbyId, data.role === 'host' ? 0 : 1);
      } else {
        setIsWaiting(false);
        // Lobby is already ready (both players matched), create NetworkedGame immediately
        if (canvasRef.current && !gameRef.current) {
          gameRef.current = new NetworkedGame({
            canvas: canvasRef.current,
            lobbyId: data.lobbyId,
            playerId,
            playerIndex: data.role === 'host' ? 0 : 1,
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

  const startPollingForReady = (id: string, pIndex: number) => {
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
              lobbyId: id,
              playerId,
              playerIndex: pIndex,
              contraption: selectedContraption || undefined,
              onUIUpdate: (ui) => setLatestUIState(ui),
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
    if (!gameRef.current || !selectedContraption) { setView('game'); return; }

    const trySendReady = (retriesLeft: number) => {
      if (gameRef.current?.isConnected()) {
        const readyCmd: PlayerReadyCommand = {
          type: 'player-ready',
          playerId,
          contraption: selectedContraption,
        };
        gameRef.current.sendReadyCommand(readyCmd);
      } else if (retriesLeft > 0) {
        // Retry shortly; avoids dropping ready if clicked before websocket is ready
        window.setTimeout(() => trySendReady(retriesLeft - 1), 150);
      }
    };
    trySendReady(20); // ~3s total
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

  // Derived helpers for build phase UI
  const isBuildPhase = latestUIState?.phase === 'build';
  const myInventory: Partial<Record<BlockType, number>> | undefined = (latestUIState?.inventory?.[playerId] as unknown as Partial<Record<BlockType, number>>) || undefined;
  const opponentIndex = playerIndex === 0 ? 1 : 0;
  const isOpponentReady = Boolean(latestUIState?.ready ? latestUIState?.ready[opponentIndex] : false);

  useEffect(() => {
    initializeDefaults();
  }, []);

  // Initialize build/test loop audio once
  useEffect(() => {
    const audio = new Audio('/audio/build.mp3');
    audio.loop = true;
    audio.preload = 'auto';
    audio.volume = 0.5;
    buildAudioRef.current = audio;
    return () => {
      buildAudioRef.current?.pause();
      buildAudioRef.current = null;
    };
  }, []);

  // Play/pause audio depending on view without restarting between builder/test
  useEffect(() => {
    const audio = buildAudioRef.current;
    if (!audio) return;
    const shouldPlay = view === 'builder' || view === 'test';
    if (shouldPlay) {
      if (audio.paused) {
        void audio.play().catch(() => {
          // Autoplay might fail before user interaction; ignore.
        });
      }
    } else {
      if (!audio.paused) audio.pause();
    }
  }, [view]);

  useEffect(() => {
    selectedRef.current = selectedContraption;
  }, [selectedContraption]);

  // Create NetworkedGame when lobby is ready (regardless of contraption selection)
  useEffect(() => {
    if (view === 'lobby' && lobbyId && !isWaiting && canvasRef.current && !gameRef.current) {
      gameRef.current = new NetworkedGame({
        canvas: canvasRef.current,
        lobbyId,
        playerId,
        playerIndex,
        contraption: selectedContraption || undefined,
        onUIUpdate: (ui) => setLatestUIState(ui),
      });
      gameRef.current.start();
    }
  }, [view, lobbyId, isWaiting, playerIndex, playerId]);
  
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
          lobbyId,
          playerId,
          playerIndex,
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
  }, [view, playerIndex, lobbyId, playerId, selectedContraption]);

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

  // When server transitions to battle phase, show the game view
  useEffect(() => {
    if (latestUIState?.phase === 'battle' && view !== 'game') {
      setView('game');
    }
  }, [latestUIState?.phase, view]);

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

          {/* Mode selector modal */}
          {showModeSelector && view === 'menu' && (
            <div style={{
              position: 'fixed',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(0,0,0,0.45)',
              zIndex: 20,
            }}>
              <div style={{
                background: 'linear-gradient(180deg, var(--plate-800), var(--plate-900))',
                border: '1px solid rgba(0,0,0,0.6)',
                borderRadius: 12,
                padding: 24,
                minWidth: 360,
                boxShadow: '0 20px 35px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.05)',
              }}>
                <h2 style={{ marginTop: 0, marginBottom: 16, color: 'var(--accent-300)' }}>Select Mode</h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', color: '#e8e8e8' }}>
                    <input
                      type="radio"
                      name="mode"
                      checked={selectedMode === 'normal'}
                      onChange={() => setSelectedMode('normal')}
                    />
                    Normal Mode
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', color: '#e8e8e8' }}>
                    <input
                      type="radio"
                      name="mode"
                      checked={selectedMode === 'build'}
                      onChange={() => setSelectedMode('build')}
                    />
                    Build Mode (2-minute build, then fight)
                  </label>
                </div>
                <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
                  <button
                    className="btn btn-secondary"
                    onClick={() => setShowModeSelector(false)}
                    disabled={isWaiting}
                  >
                    Cancel
                  </button>
                  <button
                    className="btn btn-primary"
                    onClick={() => { void joinQueue(selectedMode); }}
                    disabled={isWaiting}
                  >
                    Continue
                  </button>
                </div>
              </div>
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
                {isWaiting ? 'Waiting for another player to join…' : (latestUIState?.phase === 'build' ? 'Build Mode: Assemble your contraption!' : 'Matched!  Waiting for both players to be ready...')}
              </p>

              {isBuildPhase ? (
                <>
                  <ContraptionBuilder
                    onBack={() => { setView('menu'); }}
                    onTestStart={(data) => { setContraptionToTest(data); setView('test'); }}
                    inventory={myInventory}
                    onChange={(data) => {
                      latestBlueprintRef.current = data;
                      gameRef.current?.sendBuildReady(data);
                    }}
                  />
                  {/* Overlay HUD for countdown and actions */}
                  <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 30 }}>
                    <div style={{ position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)', color: '#e8e8e8', fontSize: '1.25rem', fontWeight: 700 }}>
                      Time left: {latestUIState.timerSeconds ?? 0}s
                    </div>
                    <div style={{ position: 'absolute', bottom: 20, right: 20 }}>
                      <button
                        className="btn btn-primary"
                        style={{ pointerEvents: 'auto' }}
                        onClick={() => gameRef.current?.sendBuildLock(latestBlueprintRef.current)}
                      >
                        Ready to Battle
                      </button>
                    </div>
                    <div style={{ position: 'absolute', bottom: 20, left: 20, color: '#cfcfcf', fontSize: '0.95rem', pointerEvents: 'none' }}>
                      Opponent ready: {isOpponentReady ? 'Yes' : 'No'}
                    </div>
                  </div>
                </>
              ) : (
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
              )}

              <div className="lobby-actions">
                {latestUIState?.phase === 'build' ? (
                  <button className="btn btn-secondary" onClick={() => { setView('menu'); setLobbyId(''); setIsWaiting(false); if (pollIntervalRef.current) { window.clearInterval(pollIntervalRef.current); pollIntervalRef.current = null; } void leaveQueueIfWaiting(); }}>
                    Back to Menu
                  </button>
                ) : (
                  <>
                    <button className="btn btn-primary" onClick={startGame} disabled={!selectedContraption || isWaiting}>Ready</button>
                    <button className="btn btn-secondary" onClick={() => { setView('menu'); setLobbyId(''); setIsWaiting(false); if (pollIntervalRef.current) { window.clearInterval(pollIntervalRef.current); pollIntervalRef.current = null; } void leaveQueueIfWaiting(); }}>
                      Back to Menu
                    </button>
                  </>
                )}
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
