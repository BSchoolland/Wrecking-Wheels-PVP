/**
 * Contraption Builder Component
 */

import { useState, useRef, useEffect } from 'react';
import Matter from 'matter-js';
import { Contraption, BlockType, createBlock, blockFromData } from '@/game/contraptions';
import type { ContraptionSaveData } from '@/game/contraptions/Contraption';
import { PhysicsEngine } from '@/core/physics/PhysicsEngine';
import { Renderer } from '@/rendering/Renderer';
import { getTestSpawnPosition } from '@/game/terrain/MapLoader';
import { BUILDER_CONSTANTS } from '@shared/constants/builder';
import './ContraptionBuilder.css';

interface ContraptionBuilderProps {
  onBack: () => void;
}

export function ContraptionBuilder({ onBack }: ContraptionBuilderProps) {
  const [contraption, setContraption] = useState(() => new Contraption());
  const [selectedBlock, setSelectedBlock] = useState<BlockType>('core');
  const [isTesting, setIsTesting] = useState(false);
  const [showLoadModal, setShowLoadModal] = useState(false);
  const [isMouseDown, setIsMouseDown] = useState(false);
  const [mouseButton, setMouseButton] = useState<'left' | 'right' | undefined>(undefined);
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const builderCanvasRef = useRef<HTMLCanvasElement>(null);
  const physicsRef = useRef<PhysicsEngine | null>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const mouseDownInfoRef = useRef<{ x: number; y: number; time: number; gridX: number; gridY: number; button?: 'left' | 'right' } | null>(null);
  const placedOnMouseDownRef = useRef<boolean>(false);
  const suppressPlacementThisClickRef = useRef<boolean>(false);

  const [selectedCell, setSelectedCell] = useState<{ x: number; y: number } | null>(null);
  const [selectionMenuPos, setSelectionMenuPos] = useState<{ left: number; top: number } | null>(null);

  const hasCore = contraption.hasCore();
  const isCoreDisabled = hasCore;  // Disable button if core already exists (can't place second)

  // Helpers
  const getGridCoords = (e: React.MouseEvent<HTMLCanvasElement>, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const gridSize = BUILDER_CONSTANTS.GRID_SIZE;
    const offsetX = canvas.width / 2;
    const offsetY = canvas.height / 2;
    const halfSize = gridSize / 2;
    const gridX = Math.floor((x - offsetX + halfSize) / gridSize);
    const gridY = Math.floor((y - offsetY + halfSize) / gridSize);
    return { x, y, gridX, gridY, offsetX, offsetY, gridSize };
  };

  const getBlockAt = (gx: number, gy: number) => contraption.getAllBlocks().find(b => b.gridX === gx && b.gridY === gy);

  const clearSelection = () => {
    setSelectedCell(null);
    setSelectionMenuPos(null);
  };

  // Handle grid interaction
  const handleGridMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isTesting) return;

    const canvas = builderCanvasRef.current;
    if (!canvas) return;

    setIsMouseDown(true);
    let buttonType: 'left' | 'right' | undefined = undefined;
    if (e.button === 0) {
      buttonType = 'left';
      setMouseButton('left');
    } else if (e.button === 2) {
      buttonType = 'right';
      setMouseButton('right');
    }

    placedOnMouseDownRef.current = false;

    // Record for click detection
    const { x, y, gridX, gridY } = getGridCoords(e, canvas);
    mouseDownInfoRef.current = { x, y, time: Date.now(), gridX, gridY, button: buttonType };

    // If a block is currently selected and user clicks empty space, suppress placement for this click
    if (buttonType === 'left' && selectedCell && !getBlockAt(gridX, gridY)) {
      suppressPlacementThisClickRef.current = true;
    } else {
      suppressPlacementThisClickRef.current = false;
    }

    // Trigger immediate action (keep existing behavior), unless suppressed
    if (buttonType && !suppressPlacementThisClickRef.current) {
      handleGridAction(e, canvas, buttonType);
    }
  };

  const handleGridMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isTesting) return;
    const canvas = builderCanvasRef.current;
    if (!canvas) {
      setIsMouseDown(false);
      setMouseButton(undefined);
      return;
    }

    // Simple-click selection on blocks
    const down = mouseDownInfoRef.current;
    if (down && down.button === 'left') {
      if (placedOnMouseDownRef.current) {
        placedOnMouseDownRef.current = false;
      } else {
        const { x, y, gridX, gridY, offsetX, offsetY, gridSize } = getGridCoords(e, canvas);
        const dist = Math.hypot(x - down.x, y - down.y);
        const isSameCell = gridX === down.gridX && gridY === down.gridY;
        const isQuick = Date.now() - down.time < 250;
        if (dist < 3 && isSameCell && isQuick) {
          const block = getBlockAt(gridX, gridY);
                  if (block) {
          setSelectedCell({ x: gridX, y: gridY });
          const centerX = offsetX + gridX * gridSize;
          const centerY = offsetY + gridY * gridSize;
          setSelectionMenuPos({ left: centerX + gridSize * 0.7, top: centerY - gridSize * 0.5 });
        } else {
          clearSelection();
        }
        }
      }
    }

    setIsMouseDown(false);
    setMouseButton(undefined);
    mouseDownInfoRef.current = null;
    suppressPlacementThisClickRef.current = false;
  };

  const handleGridMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isTesting || !isMouseDown) return;
    handleGridAction(e, builderCanvasRef.current!, mouseButton);
  };

  const handleGridAction = (e: React.MouseEvent<HTMLCanvasElement>, canvas: HTMLCanvasElement, button?: 'left' | 'right') => {
    const usedButton = button ?? mouseButton;
    if (!usedButton) return;

    const { gridX, gridY } = getGridCoords(e, canvas);

    if (usedButton === 'left') {
      if (suppressPlacementThisClickRef.current) return;
      // Place block
      if (selectedBlock === 'core' && contraption.hasCore()) {
        return;
      }
      const block = createBlock(selectedBlock, gridX, gridY);
      if (contraption.addBlock(block)) {
        const newContraption = new Contraption(contraption.id, contraption.name);
        contraption.getAllBlocks().forEach(b => newContraption.addBlock(b));
        setContraption(newContraption);
        clearSelection();
        placedOnMouseDownRef.current = true;
      }
    } else if (usedButton === 'right') {
      // Delete block at position
      contraption.removeBlockAt(gridX, gridY);
      const newContraption = new Contraption(contraption.id, contraption.name);
      contraption.getAllBlocks().forEach(b => newContraption.addBlock(b));
      setContraption(newContraption);
      if (selectedCell && selectedCell.x === gridX && selectedCell.y === gridY) clearSelection();
    }
  };

  const handleGridContextMenu = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (isTesting) return;
    // Right click handled in mouse down/up/move
  };

  // Selection actions
  const deleteSelected = () => {
    if (!selectedCell) return;
    contraption.removeBlockAt(selectedCell.x, selectedCell.y);
    const newContraption = new Contraption(contraption.id, contraption.name);
    contraption.getAllBlocks().forEach(b => newContraption.addBlock(b));
    setContraption(newContraption);
    clearSelection();
  };

  const rotateSelected = () => {
    if (!selectedCell) return;
    const block = getBlockAt(selectedCell.x, selectedCell.y);
    if (!block) return;
    block.rotation = ((block.rotation || 0) + Math.PI / 2) % (Math.PI * 2);
    const newContraption = new Contraption(contraption.id, contraption.name);
    contraption.getAllBlocks().forEach(b => newContraption.addBlock(b));
    setContraption(newContraption);
  };

  // Render the builder grid and blocks
  const renderBuilder = () => {
    const canvas = builderCanvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Clear
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#f0f0f0';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    const gridSize = BUILDER_CONSTANTS.GRID_SIZE;
    const offsetX = canvas.width / 2;
    const offsetY = canvas.height / 2;
    const halfSize = gridSize / 2;
    
    // Draw grid
    ctx.strokeStyle = '#ddd';
    ctx.lineWidth = 1;
    const gridRange = 20;
    for (let i = -gridRange; i <= gridRange; i++) {
      // Vertical lines
      ctx.beginPath();
      ctx.moveTo(offsetX + i * gridSize - halfSize, 0);
      ctx.lineTo(offsetX + i * gridSize - halfSize, canvas.height);
      ctx.stroke();
      
      // Horizontal lines
      ctx.beginPath();
      ctx.moveTo(0, offsetY + i * gridSize - halfSize);
      ctx.lineTo(canvas.width, offsetY + i * gridSize - halfSize);
      ctx.stroke();
    }
    
    // Draw center crosshair
    ctx.strokeStyle = '#999';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(offsetX - 10, offsetY);
    ctx.lineTo(offsetX + 10, offsetY);
    ctx.moveTo(offsetX, offsetY - 10);
    ctx.lineTo(offsetX, offsetY + 10);
    ctx.stroke();
    
    // Create a lightweight Matter.js engine for preview (no gravity, not running)
    const previewEngine = Matter.Engine.create({ gravity: { x: 0, y: 0, scale: 0 } });
    const world = previewEngine.world;

    // Build real bodies/constraints with block logic into this world
    contraption.getAllBlocks().forEach(block => {
      const worldX = offsetX + block.gridX * gridSize;
      const worldY = offsetY + block.gridY * gridSize;
      const { bodies, constraints } = block.createPhysicsBodies(worldX, worldY);
      const rotation = (block as unknown as { rotation?: number }).rotation || 0;
      if (rotation) {
        const cos = Math.cos(rotation);
        const sin = Math.sin(rotation);
        bodies.forEach(body => {
          const dx = body.position.x - worldX;
          const dy = body.position.y - worldY;
          const rx = dx * cos - dy * sin;
          const ry = dx * sin + dy * cos;
          Matter.Body.setPosition(body, { x: worldX + rx, y: worldY + ry });
          Matter.Body.setAngle(body, (body.angle || 0) + rotation);
        });
      }
      Matter.World.add(world, bodies);
      if (constraints.length) Matter.World.add(world, constraints as unknown as Matter.Constraint[]);
    });

    // Render only the contraption bodies (ignore boundaries; none added here)
    const bodiesToRender = Matter.Composite.allBodies(world);
    bodiesToRender.forEach(body => {
      ctx.save();

      const bodyRender = body.render as { fillStyle?: string; strokeStyle?: string; lineWidth?: number };
      const fill = bodyRender?.fillStyle || '#888';
      const stroke = bodyRender?.strokeStyle || '#000';
      const lineWidth = bodyRender?.lineWidth ?? 2;
      ctx.fillStyle = fill;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lineWidth;

      const bodyWithCircle = body as Matter.Body & { circleRadius?: number };
      if (bodyWithCircle.circleRadius) {
        const r = bodyWithCircle.circleRadius;
        ctx.beginPath();
        ctx.arc(body.position.x, body.position.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else if (body.vertices && body.vertices.length) {
        ctx.beginPath();
        ctx.moveTo(body.vertices[0].x, body.vertices[0].y);
        for (let i = 1; i < body.vertices.length; i++) {
          ctx.lineTo(body.vertices[i].x, body.vertices[i].y);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }

      ctx.restore();
    });

    // Draw selection highlight
    if (selectedCell) {
      ctx.save();
      ctx.strokeStyle = '#00aaff';
      ctx.lineWidth = 3;
      const selX = offsetX + selectedCell.x * gridSize - halfSize;
      const selY = offsetY + selectedCell.y * gridSize - halfSize;
      ctx.strokeRect(selX, selY, gridSize, gridSize);
      ctx.restore();
    }
  };

  // Test contraption with physics (trigger UI to show test canvas)
  const testContraption = () => {
    console.log('[Builder] Starting test...');
    setIsTesting(true);
  };

  // Stop testing
  const stopTest = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    physicsRef.current?.destroy();
    rendererRef.current?.destroy();
    physicsRef.current = null;
    rendererRef.current = null;
    setIsTesting(false);
  };

  // Save to localStorage
  const saveContraption = () => {
    const name = window.prompt('Enter a name for your contraption:', contraption.name) || contraption.name;
    contraption.name = name;
    const saved = contraption.save();
    localStorage.setItem(`contraption-${saved.id}`, JSON.stringify(saved));
    alert(`Contraption '${name}' saved!`);
  };

  // Get all saved contraptions
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

  // Load a contraption
  const loadContraption = (data: ContraptionSaveData) => {
    const loaded = Contraption.load(data, blockFromData);
    setContraption(loaded);
    setShowLoadModal(false);
    clearSelection();
  };

  const exportContraption = () => {
    const data = contraption.save();
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${contraption.name || 'contraption'}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    if (builderCanvasRef.current) {
      renderBuilder();
    }
  }, [contraption, selectedBlock, selectedCell]);

  // Initialize physics/rendering once the test canvas is mounted
  useEffect(() => {
    if (!isTesting) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const mirrorContraption = false;
    
    // Create physics and renderer (map boundaries are created automatically)
    physicsRef.current = new PhysicsEngine();
    rendererRef.current = new Renderer(canvas);
    physicsRef.current.setEffectManager(rendererRef.current.effects);
    
    // Identify local player for camera follow and effects
    rendererRef.current.setPlayerId('local');
    
    // Build contraption physics - spawn a single controllable contraption
    const spawnPos = getTestSpawnPosition();
    const blocks = contraption.getAllBlocks();
    if (blocks.length > 0) {
      const localContraption = new Contraption(contraption.id + '-local', contraption.name, mirrorContraption ? -1 : 1, 'local');
      contraption.getAllBlocks().forEach(b => localContraption.addBlock(blockFromData(b.toData())));
      physicsRef.current.registerContraption(localContraption);
      const { bodies, constraints } = localContraption.buildPhysics(spawnPos.x, spawnPos.y - 100);
      bodies.forEach(body => {
        (body as unknown as { ownerId?: string }).ownerId = 'local';
        physicsRef.current!.addBody(body);
      });
      constraints.forEach(constraint => physicsRef.current!.addConstraint(constraint));
    }
    
    physicsRef.current.start();

    // Simple A/D controls for wheels
    let currentInput = 0;
    const sendInput = (v: number) => {
      if (v === currentInput) return;
      currentInput = v;
      physicsRef.current?.setWheelInput('local', v);
      if (v !== 0) {
        rendererRef.current?.effects.startWheelGlow('local');
      } else {
        rendererRef.current?.effects.stopWheelGlow('local');
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.key === 'a' || e.key === 'A') sendInput(1);
      if (e.key === 'd' || e.key === 'D') sendInput(-1);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'a' || e.key === 'A' || e.key === 'd' || e.key === 'D') sendInput(0);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    
    // Start render loop
    const renderLoop = () => {
      if (physicsRef.current && rendererRef.current) {
        rendererRef.current.renderPhysics(physicsRef.current.getAllBodies());
        rendererRef.current.renderConstraints(physicsRef.current.getAllConstraints());
        animationFrameRef.current = requestAnimationFrame(renderLoop);
      }
    };
    renderLoop();

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [isTesting]);

  useEffect(() => {
    return () => {
      stopTest();
    };
  }, []);

  useEffect(() => {
    if (isTesting) return;
    
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      // Selection shortcuts
      if (selectedCell) {
        if (e.key === 'Backspace' || e.key === 'Delete') {
          e.preventDefault();
          deleteSelected();
          return;
        }
        if (e.key.toLowerCase() === 'r') {
          e.preventDefault();
          rotateSelected();
          return;
        }
      }
      
      let newBlock: BlockType | null = null;
      switch (e.key) {
        case '1': newBlock = 'core'; break;
        case '2': newBlock = 'simple'; break;
        case '3': newBlock = 'wheel'; break;
        case '4': newBlock = 'spike'; break;
        case '5': newBlock = 'gray'; break;
        case '6': newBlock = 'tnt'; break;
      }
      
      if (newBlock) {
        e.preventDefault();
        setSelectedBlock(newBlock);
        clearSelection();
        // If core selected but already has core, switch to simple
        if (newBlock === 'core' && contraption.hasCore()) {
          setSelectedBlock('simple');
        }
      }
    };
    
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isTesting, contraption, selectedCell]);  // Depend on selection for shortcuts

  useEffect(() => {
    if (hasCore && selectedBlock === 'core') {
      setSelectedBlock('simple');
    }
  }, [contraption, selectedBlock]);

  const getBlockCount = (type: BlockType): number => {
    return contraption.getAllBlocks().filter(b => b.type === type).length;
  };

  const getTotalEnergy = (): { raw: number; rounded: number } => {
    const raw = contraption.getAllBlocks().reduce((sum, b) => sum + b.energyCost, 0);
    return { raw, rounded: Math.ceil(raw) };
  };

  return (
    <div className="contraption-builder">
      <div className="builder-header">
        <h2>Contraption Builder</h2>
        <button onClick={onBack}>Back to Menu</button>
      </div>
      
      {!isTesting && (
        <div className="energy-display" style={{ textAlign: 'center', padding: '10px', fontSize: '18px', fontWeight: 'bold' }}>
          Energy: {getTotalEnergy().raw.toFixed(2)} {'->'} {Math.ceil(Number(getTotalEnergy().raw.toFixed(2)))}
        </div>
      )}
      
      {!isTesting ? (
        <>
          <div className="builder-palette">
            <button 
              className={`${selectedBlock === 'core' ? 'active' : ''} ${isCoreDisabled ? 'disabled' : ''}`}
              onClick={() => !isCoreDisabled && setSelectedBlock('core')}
              disabled={isCoreDisabled}
            >
              Core ({getBlockCount('core')})
            </button>
            <button 
              className={selectedBlock === 'simple' ? 'active' : ''}
              onClick={() => setSelectedBlock('simple')}
            >
              Simple ({getBlockCount('simple')})
            </button>
            <button 
              className={selectedBlock === 'wheel' ? 'active' : ''}
              onClick={() => setSelectedBlock('wheel')}
            >
              Wheel ({getBlockCount('wheel')})
            </button>
            <button 
              className={selectedBlock === 'spike' ? 'active' : ''}
              onClick={() => setSelectedBlock('spike')}
            >
              Spike ({getBlockCount('spike')})
            </button>
            <button 
              className={selectedBlock === 'gray' ? 'active' : ''}
              onClick={() => setSelectedBlock('gray')}
            >
              Gray ({getBlockCount('gray')})
            </button>
            <button 
              className={selectedBlock === 'tnt' ? 'active' : ''}
              onClick={() => setSelectedBlock('tnt')}
            >
              TNT ({getBlockCount('tnt')})
            </button>
          </div>
          
          <div style={{ position: 'relative', display: 'inline-block' }}>
            <canvas
              ref={builderCanvasRef}
              width={800}
              height={600}
              onMouseDown={handleGridMouseDown}
              onMouseUp={handleGridMouseUp}
              onMouseMove={handleGridMouseMove}
              onContextMenu={handleGridContextMenu}
              className="builder-canvas"
            />
            {selectionMenuPos && (
              <div
                style={{ position: 'absolute', left: selectionMenuPos.left, top: selectionMenuPos.top, background: '#fff', border: '1px solid #ccc', borderRadius: 4, boxShadow: '0 2px 6px rgba(0,0,0,0.15)', padding: 6, zIndex: 2 }}
                onMouseDown={e => e.stopPropagation()}
              >
                <button onClick={deleteSelected} style={{ display: 'block', marginBottom: 4 }}>Delete</button>
                <button onClick={rotateSelected} style={{ display: 'block' }}>Rotate</button>
              </div>
            )}
          </div>
          
          <div className="builder-actions">
            <button onClick={testContraption}>Test Contraption</button>
            <button onClick={saveContraption}>Save</button>
            <button onClick={() => setShowLoadModal(true)}>Load</button>
            <button onClick={exportContraption}>Export JSON</button>
          </div>
        </>
      ) : (
        <div className="test-container">
          <canvas ref={canvasRef} className="test-canvas" />
          <div className="test-hud">
            <div className="hud-info">
              <span>Right/Middle Click + Drag: Pan camera</span>
              <span>Mouse Wheel: Zoom in/out</span>
            </div>
            <button onClick={stopTest} className="stop-test">Stop Test</button>
          </div>
        </div>
      )}
      
      {showLoadModal && (
        <div className="load-modal-overlay" onClick={() => setShowLoadModal(false)}>
          <div className="load-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Load Contraption</h3>
            <div className="contraption-list">
              {getSavedContraptions().map((data) => (
                <div key={data.id} className="contraption-item" onClick={() => loadContraption(data)}>
                  <div className="contraption-name">{data.name}</div>
                  <div className="contraption-info">{data.blocks.length} blocks</div>
                </div>
              ))}
            </div>
            <button onClick={() => setShowLoadModal(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

