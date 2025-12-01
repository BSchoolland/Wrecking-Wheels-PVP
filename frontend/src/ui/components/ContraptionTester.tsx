import { useEffect, useRef } from 'react';
import { Contraption, blockFromData } from '@shared/contraptions';
import type { ContraptionSaveData } from '@shared/contraptions/Contraption';
import { PhysicsEngine } from '@shared/physics/PhysicsEngine';
import { InputController } from '@/game/input/InputSystem';
import { Renderer } from '@/rendering/Renderer';
import { SpriteManager } from '@/rendering/SpriteManager';
import { getTestSpawnPosition } from '@shared/terrain/MapLoader';
import './ContraptionTester.css';

interface ContraptionTesterProps {
  contraption: ContraptionSaveData;
  onBack: () => void;
}

export function ContraptionTester({ contraption: contraptionData, onBack }: ContraptionTesterProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const physicsRef = useRef<PhysicsEngine | null>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const mirrorContraption = false;
    
    // Create physics and renderer
    physicsRef.current = new PhysicsEngine();
    rendererRef.current = new Renderer(canvas);
    rendererRef.current.camera.setZoom(rendererRef.current.camera.zoom / 8);
    physicsRef.current.setEffectManager(rendererRef.current.effects);
    
    rendererRef.current.setPlayerId('local');
    
    // Pre-load sprites
    SpriteManager.loadSprites().catch((err) => {
    });

    // Build contraption physics
    const loaded = Contraption.load(contraptionData, blockFromData);
    const spawnPos = getTestSpawnPosition(undefined, loaded.vehicleClass);
    const blocks = loaded.getAllBlocks();
    
    if (blocks.length > 0) {
      const localContraption = new Contraption(loaded.id + '-local', loaded.name, mirrorContraption ? -1 : 1, 'local');
      loaded.getAllBlocks().forEach(b => localContraption.addBlock(blockFromData(b.toData())));
      physicsRef.current.registerContraption(localContraption);
      const { bodies, constraints } = localContraption.buildPhysics(spawnPos.x, spawnPos.y);
      bodies.forEach(body => {
        (body as unknown as { ownerId?: string }).ownerId = 'local';
        physicsRef.current!.addBody(body);
      });
      constraints.forEach(constraint => physicsRef.current!.addConstraint(constraint));
    }
    
    physicsRef.current.start();
    physicsRef.current.enableMapShrinking();

    // Use generic input controller in local mode
    const inputController = new InputController({ role: 'host', playerId: 'local', physics: physicsRef.current, effects: rendererRef.current?.effects || null });
    inputController.attach();
    
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
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      inputController.detach();
      physicsRef.current?.destroy();
      rendererRef.current?.destroy();
      physicsRef.current = null;
      rendererRef.current = null;
    };
  }, [contraptionData]);

  return (
    <div className="test-container">
      <canvas ref={canvasRef} className="test-canvas" />
      <div className="test-hud">
        <div className="hud-info">
          <span>Right/Middle Click + Drag: Pan camera</span>
          <span>Mouse Wheel: Zoom in/out</span>
        </div>
        <button onClick={onBack} className="stop-test">Back to Builder</button>
      </div>
    </div>
  );
}
