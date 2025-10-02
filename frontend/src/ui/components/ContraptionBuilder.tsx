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
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const builderCanvasRef = useRef<HTMLCanvasElement>(null);
  const physicsRef = useRef<PhysicsEngine | null>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Handle grid click to place blocks
  const handleGridClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isTesting) return;
    
    const canvas = builderCanvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Convert to grid coordinates (centered on canvas)
    const gridSize = BUILDER_CONSTANTS.GRID_SIZE;
    const offsetX = canvas.width / 2;
    const offsetY = canvas.height / 2;
    
    const gridX = Math.floor((x - offsetX) / gridSize + 0.5);
    const gridY = Math.floor((y - offsetY) / gridSize + 0.5);
    
    // Check if trying to place a core when one already exists
    if (selectedBlock === 'core' && contraption.hasCore()) {
      return;
    }
    
    // Add block
    const block = createBlock(selectedBlock, gridX, gridY);
    if (contraption.addBlock(block)) {
      // Create new contraption instance to trigger re-render
      const newContraption = new Contraption(contraption.id, contraption.name);
      contraption.getAllBlocks().forEach(b => newContraption.addBlock(b));
      setContraption(newContraption);
    }
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
    
    // Draw grid
    ctx.strokeStyle = '#ddd';
    ctx.lineWidth = 1;
    const gridRange = 20;
    for (let i = -gridRange; i <= gridRange; i++) {
      // Vertical lines
      ctx.beginPath();
      ctx.moveTo(offsetX + i * gridSize, 0);
      ctx.lineTo(offsetX + i * gridSize, canvas.height);
      ctx.stroke();
      
      // Horizontal lines
      ctx.beginPath();
      ctx.moveTo(0, offsetY + i * gridSize);
      ctx.lineTo(canvas.width, offsetY + i * gridSize);
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
    const saved = contraption.save();
    localStorage.setItem(`contraption-${saved.id}`, JSON.stringify(saved));
    alert('Contraption saved!');
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
  };

  useEffect(() => {
    if (builderCanvasRef.current) {
      renderBuilder();
    }
  }, [contraption, selectedBlock]);

  // Initialize physics/rendering once the test canvas is mounted
  useEffect(() => {
    if (!isTesting) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    // Create physics and renderer (map boundaries are created automatically)
    physicsRef.current = new PhysicsEngine();
    rendererRef.current = new Renderer(canvas);
    physicsRef.current.setEffectManager(rendererRef.current.effects);
    
    // Set up camera - center between the two contraptions
    const spawnPos = getTestSpawnPosition();
    const camera = rendererRef.current.camera;
    camera.x = spawnPos.x;
    camera.y = spawnPos.y;
    camera.zoom = 1;
    
    // Build contraption physics - spawn two facing each other
    const blocks = contraption.getAllBlocks();
    if (blocks.length > 0) {
      const spacing = 300; // Distance between contraptions
      
      // Left contraption (facing right, direction = 1, team 'left')
      const leftContraption = new Contraption(contraption.id + '-left', contraption.name, 1, 'team-left');
      contraption.getAllBlocks().forEach(b => leftContraption.addBlock(blockFromData(b.toData())));
      physicsRef.current?.registerContraption(leftContraption);
      const leftPhysics = leftContraption.buildPhysics(spawnPos.x - spacing, spawnPos.y - 100);
      leftPhysics.bodies.forEach(body => physicsRef.current?.addBody(body));
      leftPhysics.constraints.forEach(constraint => physicsRef.current?.addConstraint(constraint));
      
      // Right contraption (facing left, direction = -1, team 'right')
      const rightContraption = new Contraption(contraption.id + '-right', contraption.name, -1, 'team-right');
      contraption.getAllBlocks().forEach(b => rightContraption.addBlock(blockFromData(b.toData())));
      physicsRef.current?.registerContraption(rightContraption);
      const rightPhysics = rightContraption.buildPhysics(spawnPos.x + spacing, spawnPos.y - 100);
      rightPhysics.bodies.forEach(body => physicsRef.current?.addBody(body));
      rightPhysics.constraints.forEach(constraint => physicsRef.current?.addConstraint(constraint));
      
      console.log(`[Builder] Spawned two contraptions facing each other`);
    } else {
      console.log('[Builder] No blocks placed; running empty world to show ground');
    }
    
    physicsRef.current.start();
    
    // Start render loop
    const renderLoop = () => {
      if (physicsRef.current && rendererRef.current) {
        rendererRef.current.renderPhysics(physicsRef.current.getAllBodies());
        animationFrameRef.current = requestAnimationFrame(renderLoop);
      }
    };
    renderLoop();
  }, [isTesting]);

  useEffect(() => {
    return () => {
      stopTest();
    };
  }, []);

  return (
    <div className="contraption-builder">
      <div className="builder-header">
        <h2>Contraption Builder</h2>
        <button onClick={onBack}>Back to Menu</button>
      </div>
      
      {!isTesting ? (
        <>
          <div className="builder-palette">
            <button 
              className={selectedBlock === 'core' ? 'active' : ''}
              onClick={() => setSelectedBlock('core')}
            >
              Core
            </button>
            <button 
              className={selectedBlock === 'simple' ? 'active' : ''}
              onClick={() => setSelectedBlock('simple')}
            >
              Block
            </button>
            <button 
              className={selectedBlock === 'wheel' ? 'active' : ''}
              onClick={() => setSelectedBlock('wheel')}
            >
              Wheel
            </button>
            <button 
              className={selectedBlock === 'spike' ? 'active' : ''}
              onClick={() => setSelectedBlock('spike')}
            >
              Spike
            </button>
            <button 
              className={selectedBlock === 'gray' ? 'active' : ''}
              onClick={() => setSelectedBlock('gray')}
            >
              Gray
            </button>
          </div>
          
          <canvas
            ref={builderCanvasRef}
            width={800}
            height={600}
            onClick={handleGridClick}
            className="builder-canvas"
          />
          
          <div className="builder-actions">
            <button onClick={testContraption}>Test Contraption</button>
            <button onClick={saveContraption}>Save</button>
            <button onClick={() => setShowLoadModal(true)}>Load</button>
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

