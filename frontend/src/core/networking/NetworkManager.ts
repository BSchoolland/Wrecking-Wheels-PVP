/**
 * Network Manager - High-level networking coordinator
 * Handles WebSocket signaling + WebRTC peer connection
 */

import { PeerConnection } from './PeerConnection';

export type NetworkRole = 'host' | 'client';
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'failed';

interface NetworkManagerConfig {
  role: NetworkRole;
  lobbyId: string;
  signalingServerUrl: string;
  onStateUpdate?: (state: any) => void;
  onCommand?: (command: any) => void;
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
  
  private onStateUpdate: (state: any) => void;
  private onCommand: (command: any) => void;
  private onConnected: () => void;
  private onDisconnected: () => void;

  constructor(config: NetworkManagerConfig) {
    this.role = config.role;
    this.lobbyId = config.lobbyId;
    this.onStateUpdate = config.onStateUpdate || (() => {});
    this.onCommand = config.onCommand || (() => {});
    this.onConnected = config.onConnected || (() => {});
    this.onDisconnected = config.onDisconnected || (() => {});

    this.connectToSignalingServer(config.signalingServerUrl);
  }

  /**
   * Connect to WebSocket signaling server
   */
  private connectToSignalingServer(url: string): void {
    this.connectionState = 'connecting';
    this.signalingWs = new WebSocket(url);

    this.signalingWs.onopen = () => {
      if (import.meta.env.DEV) console.log('Connected to signaling server');
    };

    this.signalingWs.onmessage = (event) => {
      const message = JSON.parse(event.data);
      this.handleSignalingMessage(message);
    };

    this.signalingWs.onerror = (error) => {
      console.error('Signaling WebSocket error:', error);
      this.connectionState = 'failed';
    };

    this.signalingWs.onclose = () => {
      if (import.meta.env.DEV) console.log('Disconnected from signaling server');
      this.connectionState = 'disconnected';
    };
  }

  /**
   * Handle messages from signaling server
   */
  private async handleSignalingMessage(message: any): Promise<void> {
    if (import.meta.env.DEV) console.log('Signaling message:', message.type);

    switch (message.type) {
      case 'connected':
        // Server assigned us an ID
        this.myClientId = message.clientId;
        if (import.meta.env.DEV) console.log('My client ID:', this.myClientId);
        
        // Join the lobby
        this.joinLobby();
        break;

      case 'peer-joined':
        // Another peer joined the lobby
        if (import.meta.env.DEV) console.log('Peer joined:', message.peerId, 'as', message.peerRole);
        this.peerId = message.peerId;
        
        // If we're the host, initiate WebRTC connection
        if (this.role === 'host') {
          await this.initiateWebRTC();
        }
        break;

      case 'signal':
        // WebRTC signaling data from peer
        await this.handleWebRTCSignal(message.fromId, message.signal);
        break;

      case 'peer-left':
        if (import.meta.env.DEV) console.log('Peer left:', message.peerId);
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
    if (import.meta.env.DEV) console.log('Initiating WebRTC connection...');

    // Create peer connection
    this.peerConnection = new PeerConnection({
      role: this.role,
      onMessage: (message) => {
        if (message.type === 'state') {
          this.onStateUpdate(message.payload);
        } else if (message.type === 'command') {
          this.onCommand(message.payload);
        }
      },
      onConnect: () => {
        if (import.meta.env.DEV) console.log('WebRTC connected!');
        this.connectionState = 'connected';
        this.onConnected();
      },
      onDisconnect: () => {
        if (import.meta.env.DEV) console.log('WebRTC disconnected');
        this.connectionState = 'disconnected';
        this.onDisconnected();
      },
    });

    await this.peerConnection.initialize();

    // Set up ICE candidate handler
    this.peerConnection.setIceCandidateHandler((candidate) => {
      this.sendSignal({ type: 'ice-candidate', candidate });
    });

    // Create and send offer
    const offer = await this.peerConnection.createOffer();
    this.sendSignal({ type: 'offer', offer });
  }

  /**
   * Handle WebRTC signaling from peer
   */
  private async handleWebRTCSignal(_fromId: string, signal: any): Promise<void> {
    if (import.meta.env.DEV) console.log('Received WebRTC signal:', signal.type);

    // Create peer connection if we don't have one (client receiving offer)
    if (!this.peerConnection) {
      this.peerConnection = new PeerConnection({
        role: this.role,
        onMessage: (message) => {
          if (message.type === 'state') {
            this.onStateUpdate(message.payload);
          } else if (message.type === 'command') {
            this.onCommand(message.payload);
          }
        },
        onConnect: () => {
          if (import.meta.env.DEV) console.log('WebRTC connected!');
          this.connectionState = 'connected';
          this.onConnected();
        },
        onDisconnect: () => {
          if (import.meta.env.DEV) console.log('WebRTC disconnected');
          this.connectionState = 'disconnected';
          this.onDisconnected();
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
  private sendSignal(signal: any): void {
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
  sendState(state: any): void {
    if (this.role !== 'host') {
      console.warn('Only host can send state');
      return;
    }
    this.peerConnection?.sendState(state);
  }

  /**
   * Send command (client to host, or host to itself)
   */
  sendCommand(command: any): void {
    this.peerConnection?.sendCommand(command);
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
      this.signalingWs.send(JSON.stringify({ type: 'leave-lobby' }));
      this.signalingWs.close();
      this.signalingWs = null;
    }

    this.peerConnection?.close();
    this.peerConnection = null;
    this.connectionState = 'disconnected';
  }
}
