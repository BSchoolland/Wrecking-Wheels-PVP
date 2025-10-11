/**
 * Network Manager - High-level networking coordinator
 * Handles WebSocket signaling + WebRTC peer connection
 */

import { PeerConnection } from './PeerConnection';
import type { GameState } from '@shared/types/GameState';
import type { GameCommand, UIState, GameEvent } from '@shared/types/Commands';

export type NetworkRole = 'host' | 'client';
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'failed';

// Signaling message types
export interface ConnectedMessage {
  type: 'connected';
  clientId: string;
}

export interface PeerJoinedMessage {
  type: 'peer-joined';
  peerId: string;
  peerRole: NetworkRole;
}

export interface SignalMessage {
  type: 'signal';
  fromId: string;
  signal: WebRTCSignal;
}

export interface PeerLeftMessage {
  type: 'peer-left';
  peerId: string;
}

export type SignalingMessage = ConnectedMessage | PeerJoinedMessage | SignalMessage | PeerLeftMessage;

// WebRTC signal types
export interface OfferSignal {
  type: 'offer';
  offer: RTCSessionDescriptionInit;
}

export interface AnswerSignal {
  type: 'answer';
  answer: RTCSessionDescriptionInit;
}

export interface IceCandidateSignal {
  type: 'ice-candidate';
  candidate: RTCIceCandidate;
}

export type WebRTCSignal = OfferSignal | AnswerSignal | IceCandidateSignal;

interface NetworkManagerConfig {
  role: NetworkRole;
  lobbyId: string;
  signalingServerUrl: string;
  onStateUpdate?: (state: GameState) => void;
  onCommand?: (command: GameCommand) => void;
  onUIUpdate?: (uiState: UIState) => void;
  onEvent?: (event: GameEvent) => void;
  onConnected?: () => void;
  onDisconnected?: () => void;
}

export class NetworkManager {
  private role: NetworkRole;
  private lobbyId: string;
  private signalingWs: WebSocket | null = null;
  private peerConnection: PeerConnection | null = null;
  private myClientId: string | null = null;
  private peerId: string | null = null;
  private connectionState: ConnectionState = 'disconnected';
  
  private onStateUpdate: (state: GameState) => void;
  private onCommand: (command: GameCommand) => void;
  private onUIUpdate: (uiState: UIState) => void;
  private onEvent: (event: GameEvent) => void;
  private onConnected: () => void;
  private onDisconnected: () => void;
  private pingIntervalId: number | null = null;
  private estimatedOneWayMs: number = 0;
  private bestRttMs: number = Number.POSITIVE_INFINITY;
  private rttQueue: number[] = []; // New: Queue for recent RTTs
  private readonly MAX_RTT_SAMPLES = 5; // Average last 5 for stability

  constructor(config: NetworkManagerConfig) {
    this.role = config.role;
    this.lobbyId = config.lobbyId;
    this.onStateUpdate = config.onStateUpdate || (() => {});
    this.onCommand = config.onCommand || (() => {});
    this.onUIUpdate = config.onUIUpdate || (() => {});
    this.onEvent = config.onEvent || (() => {});
    this.onConnected = config.onConnected || (() => {});
    this.onDisconnected = config.onDisconnected || (() => {});

    this.connectToSignalingServer(config.signalingServerUrl);
  }

  /**
   * Connect to WebSocket signaling server
   */
  private connectToSignalingServer(url: string): void {
    this.connectionState = 'connecting';
    console.log(`[${this.role}] Attempting to connect to signaling server: ${url}`);
    this.signalingWs = new WebSocket(url);

    this.signalingWs.onopen = () => {
      console.log(`[${this.role}] ✓ Signaling server connected: ${url}`);
    };

    this.signalingWs.onmessage = (event) => {
      const message = JSON.parse(event.data);
      this.handleSignalingMessage(message);
    };

    this.signalingWs.onerror = (error) => {
      console.error(`[${this.role}] ✗ Signaling WebSocket error:`, error);
      this.connectionState = 'failed';
    };

    this.signalingWs.onclose = (event) => {
      console.warn(`[${this.role}] Signaling WebSocket closed: ${url} (code=${event.code} reason=${event.reason || 'n/a'})`);
      this.connectionState = 'disconnected';
    };
  }

  /**
   * Handle messages from signaling server
   */
  private async handleSignalingMessage(message: SignalingMessage): Promise<void> {

    switch (message.type) {
      case 'connected':
        // Server assigned us an ID
        this.myClientId = message.clientId;
        console.log(`[${this.role}] Assigned client ID: ${this.myClientId}`);
        
        // Join the lobby
        this.joinLobby();
        break;

      case 'peer-joined':
        // Another peer joined the lobby
        this.peerId = message.peerId;
        console.log(`[${this.role}] Peer joined: ${message.peerId} (role: ${message.peerRole})`);
        
        // If we're the host, initiate WebRTC connection
        if (this.role === 'host') {
          console.log(`[${this.role}] Initiating WebRTC connection to client...`);
          await this.initiateWebRTC();
        }
        break;

      case 'signal':
        // WebRTC signaling data from peer
        if (message.signal.type === 'ice-candidate') {
          const cand = message.signal.candidate as RTCIceCandidateInit;
          const candType = cand.candidate ? (cand.candidate.includes('typ relay') ? 'relay' : cand.candidate.includes('typ srflx') ? 'srflx' : cand.candidate.includes('typ host') ? 'host' : 'unknown') : 'null';
          console.log(`[${this.role}] Received ICE candidate from peer: ${candType}`, cand.candidate ? cand.candidate.substring(0, 100) : 'null');
        } else {
          console.log(`[${this.role}] Received WebRTC signal from ${message.fromId}: ${message.signal.type}`);
        }
        await this.handleWebRTCSignal(message.fromId, message.signal);
        break;

      case 'peer-left':
        console.log(`[${this.role}] Peer left: ${message.peerId}`);
        this.peerId = null;
        this.peerConnection?.close();
        this.peerConnection = null;
        this.onDisconnected();
        break;
    }
  }

  /**
   * Join the lobby via signaling server
   */
  private joinLobby(): void {
    if (!this.signalingWs) return;

    console.log(`[${this.role}] Joining lobby: ${this.lobbyId}`);
    this.signalingWs.send(JSON.stringify({
      type: 'join-lobby',
      lobbyId: this.lobbyId,
      role: this.role,
    }));
  }

  /**
   * Initiate WebRTC connection (called by host)
   */
  private async initiateWebRTC(): Promise<void> {

    // Create peer connection
    this.peerConnection = new PeerConnection({
      role: this.role,
      onMessage: (message) => {
        if (message.type === 'state') {
          this.onStateUpdate(message.payload as unknown as GameState);
        } else if (message.type === 'command') {
          this.onCommand(message.payload as unknown as GameCommand);
        } else if (message.type === 'ui-update') {
          this.onUIUpdate(message.payload as unknown as UIState);
        } else if (message.type === 'event') {
          this.onEvent(message.payload as unknown as GameEvent);
        } else if (message.type === 'ping') {
          // Echo back immediately
          this.peerConnection?.sendReliableInternal({ type: 'pong', payload: message.payload });
        } else if (message.type === 'pong') {
          const t0 = (message.payload as { t: number }).t;
          if (typeof t0 === 'number') {
            const rtt = performance.now() - t0;
            console.log(`Raw ping RTT sample: ${rtt.toFixed(1)}ms`); // New: Log raw RTTs
            this.rttQueue.push(rtt);
            if (this.rttQueue.length > this.MAX_RTT_SAMPLES) {
              this.rttQueue.shift();
            }
            const avgRtt = this.rttQueue.length > 0 ? this.rttQueue.reduce((a, b) => a + b, 0) / this.rttQueue.length : rtt;
            const oneWay = avgRtt / 2;
            this.estimatedOneWayMs = this.estimatedOneWayMs ? (this.estimatedOneWayMs * 0.5 + oneWay * 0.5) : oneWay; // Faster EMA
          }
        }
      },
      onConnect: () => {
        console.log(`[${this.role}] ✓ WebRTC peer connection established!`);
        this.connectionState = 'connected';
        this.onConnected();
        // Start periodic pings over reliable channel
        if (this.pingIntervalId) window.clearInterval(this.pingIntervalId);
        this.pingIntervalId = window.setInterval(() => {
          try { this.peerConnection?.sendReliableInternal({ type: 'ping', payload: { t: performance.now() } }); } catch { /* ignore send errors */ }
        }, 1000);
      },
      onDisconnect: () => {
        console.log(`[${this.role}] WebRTC peer connection closed`);
        this.connectionState = 'disconnected';
        this.onDisconnected();
        if (this.pingIntervalId) { window.clearInterval(this.pingIntervalId); this.pingIntervalId = null; }
      },
    });

    await this.peerConnection.initialize();

    // Set up ICE candidate handler
    this.peerConnection.setIceCandidateHandler((candidate) => {
      this.sendSignal({ type: 'ice-candidate', candidate });
    });

    // Create and send offer
    const offer = await this.peerConnection.createOffer();
    console.log(`[${this.role}] Sending WebRTC offer to peer`);
    this.sendSignal({ type: 'offer', offer });
  }

  /**
   * Handle WebRTC signaling from peer
   */
  private async handleWebRTCSignal(_fromId: string, signal: WebRTCSignal): Promise<void> {

    // Create peer connection if we don't have one (client receiving offer)
    if (!this.peerConnection) {
      this.peerConnection = new PeerConnection({
        role: this.role,
        onMessage: (message) => {
          if (message.type === 'state') {
            this.onStateUpdate(message.payload as unknown as GameState);
          } else if (message.type === 'command') {
            this.onCommand(message.payload as unknown as GameCommand);
          } else if (message.type === 'ui-update') {
            this.onUIUpdate(message.payload as unknown as UIState);
          } else if (message.type === 'event') {
            this.onEvent(message.payload as unknown as GameEvent);
          } else if (message.type === 'ping') {
            this.peerConnection?.sendReliableInternal({ type: 'pong', payload: message.payload });
          } else if (message.type === 'pong') {
            const t0 = (message.payload as { t: number }).t;
            if (typeof t0 === 'number') {
              const rtt = performance.now() - t0;
              console.log(`Raw ping RTT sample: ${rtt.toFixed(1)}ms`); // New: Log raw RTTs
              this.rttQueue.push(rtt);
              if (this.rttQueue.length > this.MAX_RTT_SAMPLES) {
                this.rttQueue.shift();
              }
              const avgRtt = this.rttQueue.length > 0 ? this.rttQueue.reduce((a, b) => a + b, 0) / this.rttQueue.length : rtt;
              const oneWay = avgRtt / 2;
              this.estimatedOneWayMs = this.estimatedOneWayMs ? (this.estimatedOneWayMs * 0.5 + oneWay * 0.5) : oneWay; // Faster EMA
            }
          }
        },
        onConnect: () => {
          this.connectionState = 'connected';
          this.onConnected();
          if (this.pingIntervalId) window.clearInterval(this.pingIntervalId);
          this.pingIntervalId = window.setInterval(() => {
            try { this.peerConnection?.sendReliableInternal({ type: 'ping', payload: { t: performance.now() } }); } catch { /* ignore send errors */ }
          }, 1000);
        },
        onDisconnect: () => {
          this.connectionState = 'disconnected';
          this.onDisconnected();
          if (this.pingIntervalId) { window.clearInterval(this.pingIntervalId); this.pingIntervalId = null; }
        },
      });

      await this.peerConnection.initialize();

      // Set up ICE candidate handler
      this.peerConnection.setIceCandidateHandler((candidate) => {
        this.sendSignal({ type: 'ice-candidate', candidate });
      });
    }

    if (signal.type === 'offer') {
      // Received offer, send answer
      await this.peerConnection.setRemoteDescription(signal.offer);
      const answer = await this.peerConnection.createAnswer();
      this.sendSignal({ type: 'answer', answer });
    } else if (signal.type === 'answer') {
      // Received answer
      await this.peerConnection.setRemoteDescription(signal.answer);
    } else if (signal.type === 'ice-candidate') {
      // Received ICE candidate
      await this.peerConnection.addIceCandidate(signal.candidate);
    }
  }

  /**
   * Send signaling message to peer via server
   */
  private sendSignal(signal: WebRTCSignal): void {
    if (!this.signalingWs || !this.peerId) return;

    this.signalingWs.send(JSON.stringify({
      type: 'signal',
      targetId: this.peerId,
      signal,
    }));
  }

  /**
   * Send game state (host only)
   */
  sendState(state: unknown): void {
    if (this.role !== 'host') {
      console.warn('Only host can send state');
      return;
    }
    this.peerConnection?.sendState(state as unknown as GameState);
  }

  /**
   * Send command (client to host, or host to itself)
   */
  sendCommand(command: GameCommand): void {
    this.peerConnection?.sendCommand(command);
  }

  /**
   * Send UI update (host only)
   */
  sendUIUpdate(uiState: UIState): void {
    if (this.role !== 'host') {
      console.warn('Only host can send UI updates');
      return;
    }
    this.peerConnection?.sendUIUpdate(uiState);
  }

  /**
   * Send game event (host only)
   */
  sendEvent(event: GameEvent): void {
    if (this.role !== 'host') {
      console.warn('Only host can send events');
      return;
    }
    this.peerConnection?.sendEvent(event);
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
    if (this.signalingWs) {
      try {
        if (this.signalingWs.readyState === WebSocket.OPEN) {
          this.signalingWs.send(JSON.stringify({ type: 'leave-lobby' }));
        }
      } catch (e) { /* noop */ }
      try { this.signalingWs.close(); } catch (e) { /* noop */ }
      this.signalingWs = null;
    }

    try { this.peerConnection?.close(); } catch (e) { /* noop */ }
    this.peerConnection = null;
    this.connectionState = 'disconnected';
    if (this.pingIntervalId) { window.clearInterval(this.pingIntervalId); this.pingIntervalId = null; }
  }

  getEstimatedOneWayMs(): number { return this.estimatedOneWayMs || 0; }
}
