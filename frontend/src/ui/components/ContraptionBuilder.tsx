/**
 * Contraption Builder Component
 */

import { useState, useRef, useEffect } from 'react';
import Matter from 'matter-js';
import { Contraption, BlockType, createBlock, blockFromData } from '@/game/contraptions';
import { BLOCK_METADATA, BLOCKS_ORDER } from '@/game/contraptions';
import type { ContraptionSaveData } from '@/game/contraptions/Contraption';
import { PhysicsEngine } from '@/core/physics/PhysicsEngine';
import { InputController } from '@/game/input/InputSystem';
import { Renderer } from '@/rendering/Renderer';
import { BlockRenderer } from '@/rendering/BlockRenderer';
import { SpriteManager } from '@/rendering/SpriteManager';
import { getTestSpawnPosition, createMapBoundaries } from '@/game/terrain/MapLoader';
import { BUILDER_CONSTANTS } from '@shared/constants/builder';
import { WORLD_BOUNDS } from '@shared/constants/physics';
import { Camera } from '@/core/Camera';
import './ContraptionBuilder.css';

interface ContraptionBuilderProps {
  onBack: () => void;
  onTestStart: (contraption: ContraptionSaveData) => void;
}

export function ContraptionBuilder({ onBack, onTestStart }: ContraptionBuilderProps) {
  const [contraption, setContraption] = useState(() => new Contraption());
  const [selectedBlock, setSelectedBlock] = useState<BlockType>('core');
  const [showLoadModal, setShowLoadModal] = useState(false);
  const [isMouseDown, setIsMouseDown] = useState(false);
  const [mouseButton, setMouseButton] = useState<'left' | 'right' | undefined>(undefined);
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const builderCanvasRef = useRef<HTMLCanvasElement>(null);
  const physicsRef = useRef<PhysicsEngine | null>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const cameraRef = useRef<Camera | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const mouseDownInfoRef = useRef<{ x: number; y: number; time: number; gridX: number; gridY: number; button?: 'left' | 'right' } | null>(null);
  const placedOnMouseDownRef = useRef<boolean>(false);
  const suppressPlacementThisClickRef = useRef<boolean>(false);

  const [selectedCell, setSelectedCell] = useState<{ x: number; y: number } | null>(null);
  const [selectionMenuPos, setSelectionMenuPos] = useState<{ left: number; top: number } | null>(null);
  // Icon data URLs for hotbar sprites
  const [iconUrls, setIconUrls] = useState<Partial<Record<BlockType, string>>>({});

  const hasCore = contraption.hasCore();
  const isCoreDisabled = hasCore;  // Disable button if core already exists (can't place second)

  // Helpers
  const getGridCoords = (e: React.MouseEvent<HTMLCanvasElement>, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Convert screen to world coordinates using camera
    const camera = cameraRef.current;
    if (!camera) return { x, y, gridX: 0, gridY: 0, offsetX: 0, offsetY: 0, gridSize: 0, inBounds: false };
    
    const worldPos = camera.screenToWorld(x, y);
    const gridSize = BUILDER_CONSTANTS.GRID_SIZE;
    const halfSize = gridSize / 2;
    
    // Get spawn position to know where grid center is
    const spawnPos = getTestSpawnPosition();
    const gridX = Math.floor((worldPos.x - spawnPos.x + halfSize) / gridSize);
    const gridY = Math.floor((worldPos.y - spawnPos.y + halfSize) / gridSize);
    
    // Check if within build area
    const buildSize = BUILDER_CONSTANTS.BUILD_GRID_SIZE;
    const halfBuild = buildSize / 2;
    const inBounds = gridX >= -halfBuild && gridX < halfBuild && gridY >= -halfBuild && gridY < halfBuild;
    
    return { x, y, gridX, gridY, offsetX: spawnPos.x, offsetY: spawnPos.y, gridSize, inBounds };
  };

  const getBlockAt = (gx: number, gy: number) => contraption.getAllBlocks().find(b => b.gridX === gx && b.gridY === gy);

  const clearSelection = () => {
    setSelectedCell(null);
    setSelectionMenuPos(null);
  };

  // Handle grid interaction
  const handleGridMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
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
            // Convert world position to screen for menu placement
            const worldX = offsetX + gridX * gridSize;
            const worldY = offsetY + gridY * gridSize;
            const screenPos = cameraRef.current?.worldToScreen(worldX, worldY) || { x: 0, y: 0 };
            setSelectionMenuPos({ left: screenPos.x + gridSize * 0.7, top: screenPos.y - gridSize * 0.5 });
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
    const canvas = builderCanvasRef.current;
    if (!canvas) return;
    handleGridAction(e, canvas, mouseButton);
  };

  const handleGridAction = (e: React.MouseEvent<HTMLCanvasElement>, canvas: HTMLCanvasElement, button?: 'left' | 'right') => {
    const usedButton = button ?? mouseButton;
    if (!usedButton) return;

    const { gridX, gridY, inBounds } = getGridCoords(e, canvas);
    
    // Don't allow actions outside build area
    if (!inBounds) return;

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

  // Render the builder with ground and grid overlay
  const renderBuilder = () => {
    const canvas = builderCanvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Clear and draw sky
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#87CEEB';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Apply camera transform
    ctx.save();
    cameraRef.current?.applyTransform(ctx);
    
    // Create preview physics with actual ground bodies
    const previewEngine = Matter.Engine.create({ gravity: { x: 0, y: 0, scale: 0 } });
    const world = previewEngine.world;

    // Add ground bodies using the same function as the game
    const groundBodies = createMapBoundaries();
    Matter.World.add(world, groundBodies);

    // Add contraption bodies
    const spawnPos = getTestSpawnPosition();
    const previewContraption = new Contraption(contraption.id, contraption.name);
    contraption.getAllBlocks().forEach(b => previewContraption.addBlock(b));
    const { bodies, constraints } = previewContraption.buildPhysics(spawnPos.x, spawnPos.y);
    if (bodies.length) Matter.World.add(world, bodies);
    if (constraints.length) Matter.World.add(world, constraints as unknown as Matter.Constraint[]);

    // Render all bodies (ground + contraption)
    const bodiesToRender = Matter.Composite.allBodies(world);
    bodiesToRender.forEach(body => {
      const sprite = (body as unknown as { sprite?: { sheet: string; row: number; offsetX: number; offsetY: number; width?: number; height?: number } })?.sprite;
      if (sprite?.sheet) {
        BlockRenderer.renderSprite(ctx, body, sprite.sheet, sprite.row, sprite.offsetX, sprite.offsetY);
      } else {
        BlockRenderer.renderPhysicsBody(ctx, body);
      }
    });
    
    // Draw grid overlay
    const gridSize = BUILDER_CONSTANTS.GRID_SIZE;
    const buildSize = BUILDER_CONSTANTS.BUILD_GRID_SIZE;
    const halfBuild = buildSize / 2;
    const halfCell = gridSize / 2;
    
    // Draw build area bounds (thicker border)
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 3;
    ctx.strokeRect(
      spawnPos.x - halfBuild * gridSize - halfCell,
      spawnPos.y - halfBuild * gridSize - halfCell,
      buildSize * gridSize,
      buildSize * gridSize
    );
    
    // Draw grid within build area
    ctx.strokeStyle = '#ddd';
    ctx.lineWidth = 1;
    for (let i = -halfBuild; i <= halfBuild; i++) {
      // Vertical lines
      ctx.beginPath();
      ctx.moveTo(spawnPos.x + i * gridSize - halfCell, spawnPos.y - halfBuild * gridSize - halfCell);
      ctx.lineTo(spawnPos.x + i * gridSize - halfCell, spawnPos.y + halfBuild * gridSize - halfCell);
      ctx.stroke();
      
      // Horizontal lines
      ctx.beginPath();
      ctx.moveTo(spawnPos.x - halfBuild * gridSize - halfCell, spawnPos.y + i * gridSize - halfCell);
      ctx.lineTo(spawnPos.x + halfBuild * gridSize - halfCell, spawnPos.y + i * gridSize - halfCell);
      ctx.stroke();
    }
    
    // Draw center crosshair
    ctx.strokeStyle = '#999';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(spawnPos.x - 10, spawnPos.y);
    ctx.lineTo(spawnPos.x + 10, spawnPos.y);
    ctx.moveTo(spawnPos.x, spawnPos.y - 10);
    ctx.lineTo(spawnPos.x, spawnPos.y + 10);
    ctx.stroke();

    // Draw selection highlight
    if (selectedCell) {
      ctx.save();
      ctx.strokeStyle = '#00aaff';
      ctx.lineWidth = 3;
      ctx.strokeRect(
        spawnPos.x + selectedCell.x * gridSize - gridSize / 2,
        spawnPos.y + selectedCell.y * gridSize - gridSize / 2,
        gridSize,
        gridSize
      );
      ctx.restore();
    }
    
    ctx.restore();
  };

  // Test contraption with physics (trigger UI to show test canvas)
  const testContraption = () => {
    console.log('[Builder] Starting test...');
    // Save contraption to pass to test view
    const saved = contraption.save();
    sessionStorage.setItem('tested-contraption', JSON.stringify(saved));
    onTestStart(saved);
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

  // Initialize builder camera and resize handling
  useEffect(() => {
    const canvas = builderCanvasRef.current;
    if (!canvas) return;

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      cameraRef.current?.onResize();
      renderBuilder();
    };

    if (!cameraRef.current) {
      cameraRef.current = new Camera({ canvas });
      cameraRef.current.setControlsEnabled(false);
      // Center camera on spawn position
      const spawnPos = getTestSpawnPosition();
      cameraRef.current.x = spawnPos.x;
      cameraRef.current.y = spawnPos.y;
      // Set zoom to focus on build grid (10x10 grid + padding)
      const gridSize = BUILDER_CONSTANTS.GRID_SIZE;
      const buildSize = BUILDER_CONSTANTS.BUILD_GRID_SIZE;
      const gridWorldSize = buildSize * gridSize + gridSize * 2; // grid + 1 cell padding each side
      const scaleX = canvas.width / gridWorldSize;
      const scaleY = canvas.height / gridWorldSize;
      cameraRef.current.setZoom(Math.min(scaleX, scaleY) * 3.5);
      resizeCanvas();
    }

    window.addEventListener('resize', resizeCanvas);
    return () => window.removeEventListener('resize', resizeCanvas);
  }, []);

  useEffect(() => {
    if (builderCanvasRef.current && cameraRef.current) {
      renderBuilder();
    }
  }, [contraption, selectedBlock, selectedCell]);

  // Re-render builder when exiting test mode
  useEffect(() => {
    const canvas = builderCanvasRef.current;
    if (!canvas) return;

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      cameraRef.current?.onResize();
      renderBuilder();
    };

    if (!cameraRef.current) {
      cameraRef.current = new Camera({ canvas });
      cameraRef.current.setControlsEnabled(false);
      const spawnPos = getTestSpawnPosition();
      cameraRef.current.x = spawnPos.x;
      cameraRef.current.y = spawnPos.y;
      const gridSize = BUILDER_CONSTANTS.GRID_SIZE;
      const buildSize = BUILDER_CONSTANTS.BUILD_GRID_SIZE;
      const gridWorldSize = buildSize * gridSize + gridSize * 2;
      const scaleX = canvas.width / gridWorldSize;
      const scaleY = canvas.height / gridWorldSize;
      cameraRef.current.setZoom(Math.min(scaleX, scaleY) * 3.5);
      resizeCanvas();
    }
  }, []);

  // Map each block type to a sprite row/size from the blocks spritesheet
  const getIconSpriteConfig = (type: BlockType): { row: number; width?: number; height?: number } => {
    switch (type) {
      case 'simple': return { row: 0 };
      case 'core': return { row: 1 };
      case 'wheel': return { row: 7 }; // use tire row for a clear wheel icon
      case 'spike': return { row: 3 };
      case 'gray': return { row: 4 };
      case 'rocket': return { row: 5, width: 16, height: 8 }; // rocket is 16x8 on sheet
      case 'tnt': return { row: 6 };
      default: return { row: 0 };
    }
  };

  const buildIconUrls = () => {
    const manager = SpriteManager.getInstance();
    if (!manager.isSpritesheetLoaded('blocks')) return;
    const urls: Partial<Record<BlockType, string>> = {};
    (BLOCKS_ORDER as BlockType[]).forEach((type) => {
      const cfg = getIconSpriteConfig(type);
      const spriteCanvas = manager.getSprite('blocks', cfg.row, 0, cfg.width, cfg.height);
      urls[type] = spriteCanvas.toDataURL();
    });
    setIconUrls(urls);
  };

  // Pre-load sprites for builder rendering
  useEffect(() => {
    SpriteManager.loadSprites().then(() => {
      buildIconUrls();
    }).catch((err) => {
      console.warn('Failed to load sprites:', err);
    });
  }, []);

  useEffect(() => {
    // Load tested contraption if returning from test mode
    const tested = sessionStorage.getItem('tested-contraption');
    if (tested) {
      try {
        const data = JSON.parse(tested);
        loadContraption(data);
        sessionStorage.removeItem('tested-contraption');
      } catch (e) {
        console.error('Failed to load tested contraption:', e);
      }
    }
  }, []);

  useEffect(() => {
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
      for (const type of BLOCKS_ORDER) {
        if (BLOCK_METADATA[type].key.toLowerCase() === e.key.toLowerCase()) {
          newBlock = type;
          break;
        }
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
  }, [selectedCell]);  // Depend on selection for shortcuts

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
      <canvas
        ref={builderCanvasRef}
        onMouseDown={handleGridMouseDown}
        onMouseUp={handleGridMouseUp}
        onMouseMove={handleGridMouseMove}
        onContextMenu={handleGridContextMenu}
        className="builder-canvas-fullscreen"
      />
      
      <div className="builder-ui">
        <div className="builder-header">
          <h2>Contraption Builder</h2>
          <button onClick={onBack}>Back to Menu</button>
        </div>
        
        <div className="energy-display">
          Energy: {getTotalEnergy().raw.toFixed(2)} {'->'} {Math.ceil(Number(getTotalEnergy().raw.toFixed(2)))}
        </div>
        
        {/* Bottom hotbar */}
        <div className="builder-hotbar">
          {BLOCKS_ORDER.map((type) => {
            const meta = BLOCK_METADATA[type];
            const disabled = type === 'core' && isCoreDisabled;
            const isActive = selectedBlock === type;
            const count = getBlockCount(type);
            const icon = iconUrls[type];
            return (
              <button
                key={type}
                className={`hotbar-button ${isActive ? 'active' : ''} ${disabled ? 'disabled' : ''}`}
                onClick={() => { if (!disabled) { setSelectedBlock(type); clearSelection(); } }}
                disabled={disabled}
                title={`${meta.label} [${meta.key}]`}
              >
                {icon ? (
                  <img src={icon} alt={meta.label} className="hotbar-icon" />
                ) : (
                  <span className="hotbar-fallback">{meta.label[0]}</span>
                )}
                <span className="hotbar-key">{meta.key}</span>
                <span className="hotbar-count">{count}</span>
              </button>
            );
          })}
        </div>
        
        <div className="builder-actions">
          <button onClick={testContraption}>Test Contraption</button>
          <button onClick={saveContraption}>Save</button>
          <button onClick={() => setShowLoadModal(true)}>Load</button>
          <button onClick={exportContraption}>Export JSON</button>
        </div>

        {selectionMenuPos && (
          <div
            className="selection-menu"
            style={{ position: 'fixed', left: selectionMenuPos.left, top: selectionMenuPos.top, background: '#fff', border: '1px solid #ccc', borderRadius: 4, boxShadow: '0 2px 6px rgba(0,0,0,0.15)', padding: 6, zIndex: 2 }}
            onMouseDown={e => e.stopPropagation()}
          >
            <button onClick={deleteSelected} style={{ display: 'block', marginBottom: 4 }}>Delete</button>
            <button onClick={rotateSelected} style={{ display: 'block' }}>Rotate</button>
          </div>
        )}
      </div>

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

