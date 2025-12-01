/**
 * Network Manager - WebSocket-based communication with game server
 * No longer uses WebRTC - all communication goes through the server
 */

import type { GameState } from '@shared/types/GameState';
import type { GameCommand, UIState, GameEvent } from '@shared/types/Commands';

export type NetworkRole = 'host' | 'client'; // Kept for API compatibility, but no longer meaningful
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'failed';

interface NetworkManagerConfig {
  lobbyId: string;
  playerId: string;
  signalingServerUrl: string;
  onStateUpdate?: (state: GameState) => void;
  onCommand?: (command: GameCommand) => void;
  onUIUpdate?: (uiState: UIState) => void;
  onEvent?: (event: GameEvent) => void;
  onConnected?: () => void;
  onDisconnected?: () => void;
}

export class NetworkManager {
  private lobbyId: string;
  private playerId: string;
  private ws: WebSocket | null = null;
  private myClientId: string | null = null;
  private connectionState: ConnectionState = 'disconnected';
  
  private onStateUpdate: (state: GameState) => void;
  private onCommand: (command: GameCommand) => void;
  private onUIUpdate: (uiState: UIState) => void;
  private onEvent: (event: GameEvent) => void;
  private onConnected: () => void;
  private onDisconnected: () => void;
  
  private pingIntervalId: number | null = null;
  private estimatedOneWayMs: number = 0;
  private rttQueue: number[] = [];
  private readonly MAX_RTT_SAMPLES = 5;

  constructor(config: NetworkManagerConfig) {
    this.lobbyId = config.lobbyId;
    this.playerId = config.playerId;
    this.onStateUpdate = config.onStateUpdate || (() => {});
    this.onCommand = config.onCommand || (() => {});
    this.onUIUpdate = config.onUIUpdate || (() => {});
    this.onEvent = config.onEvent || (() => {});
    this.onConnected = config.onConnected || (() => {});
    this.onDisconnected = config.onDisconnected || (() => {});

    this.connectToServer(config.signalingServerUrl);
  }

  private connectToServer(url: string): void {
    this.connectionState = 'connecting';
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      // Connection opened, wait for server to send our client ID
    };

    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        this.handleMessage(message);
      } catch (error) {
        console.error('Error parsing message:', error);
      }
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      this.connectionState = 'failed';
    };

    this.ws.onclose = () => {
      this.connectionState = 'disconnected';
      this.onDisconnected();
      if (this.pingIntervalId) {
        window.clearInterval(this.pingIntervalId);
        this.pingIntervalId = null;
      }
    };
  }

  private handleMessage(message: { type: string; [key: string]: unknown }): void {
    switch (message.type) {
      case 'connected':
        // Server assigned us an ID
        this.myClientId = message.clientId as string;
        this.joinLobby();
        break;

      case 'lobby-joined':
        // We joined the lobby
        break;

      case 'game-ready':
        // Both players are connected, game session is created on server
        this.connectionState = 'connected';
        this.onConnected();
        this.startPing();
        break;

      case 'peer-joined':
        // Another player joined
        break;

      case 'peer-left':
        // Other player left
        this.onDisconnected();
        break;

      case 'state':
        // Game state from server
        this.onStateUpdate(message.payload as unknown as GameState);
        break;

      case 'ui-update':
        // UI state from server
        this.onUIUpdate(message.payload as unknown as UIState);
        break;

      case 'event':
        // Game event from server
        this.onEvent(message.payload as unknown as GameEvent);
        break;

      case 'pong':
        // RTT measurement response
        const t0 = (message.payload as { t: number })?.t;
        if (typeof t0 === 'number') {
          const rtt = performance.now() - t0;
          this.rttQueue.push(rtt);
          if (this.rttQueue.length > this.MAX_RTT_SAMPLES) {
            this.rttQueue.shift();
          }
          const avgRtt = this.rttQueue.reduce((a, b) => a + b, 0) / this.rttQueue.length;
          const oneWay = avgRtt / 2;
          this.estimatedOneWayMs = this.estimatedOneWayMs 
            ? (this.estimatedOneWayMs * 0.5 + oneWay * 0.5) 
            : oneWay;
        }
        break;
    }
  }

  private joinLobby(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    this.ws.send(JSON.stringify({
      type: 'join-lobby',
      lobbyId: this.lobbyId,
      playerId: this.playerId,
    }));
  }

  private startPing(): void {
    if (this.pingIntervalId) {
      window.clearInterval(this.pingIntervalId);
    }
    this.pingIntervalId = window.setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify({ 
            type: 'ping', 
            payload: { t: performance.now() } 
          }));
        } catch { /* ignore */ }
      }
    }, 1000);
  }

  /**
   * Send command to server
   */
  sendCommand(command: GameCommand): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    
    this.ws.send(JSON.stringify({
      type: 'command',
      payload: command,
    }));
  }

  /**
   * Get current connection state
   */
  getState(): ConnectionState {
    return this.connectionState;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connectionState === 'connected';
  }

  /**
   * Disconnect and cleanup
   */
  disconnect(): void {
    if (this.ws) {
      try {
        if (this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'leave-lobby' }));
        }
      } catch { /* noop */ }
      try { 
        this.ws.close(); 
      } catch { /* noop */ }
      this.ws = null;
    }

    this.connectionState = 'disconnected';
    if (this.pingIntervalId) { 
      window.clearInterval(this.pingIntervalId); 
      this.pingIntervalId = null; 
    }
  }

  getEstimatedOneWayMs(): number { 
    return this.estimatedOneWayMs || 0; 
  }
}
