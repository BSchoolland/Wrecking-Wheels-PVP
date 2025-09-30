/**
 * Main App Component
 */

import { useState } from 'react';
import './App.css';

function App() {
  const [view, setView] = useState<'menu' | 'game'>('menu');

  return (
    <div className="app">
      <h1>Wrecking Wheels PVP</h1>
      {view === 'menu' && (
        <div className="menu">
          <button onClick={() => setView('game')}>Start Game (Coming Soon)</button>
          <button>Join Game (Coming Soon)</button>
          <button>Contraption Builder (Coming Soon)</button>
        </div>
      )}
      {view === 'game' && (
        <div className="game-container">
          <canvas id="game-canvas"></canvas>
          <button onClick={() => setView('menu')}>Back to Menu</button>
        </div>
      )}
    </div>
  );
}

export default App;
