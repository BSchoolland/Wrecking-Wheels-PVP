/**
 * Peer-to-Peer WebRTC Connection Manager
 * Handles host-client communication
 */

import type { GameState } from '@shared/types/GameState';
import type { GameCommand, NetworkMessage } from '@shared/types/Commands';

export type ConnectionRole = 'host' | 'client';

export interface PeerConnectionConfig {
  role: ConnectionRole;
  onMessage: (message: NetworkMessage) => void;
  onConnect: () => void;
  onDisconnect: () => void;
}

export class PeerConnection {
  private role: ConnectionRole;
  private connection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private onMessage: (message: NetworkMessage) => void;
  private onConnect: () => void;
  private onDisconnect: () => void;
  private messageSequence = 0;

  constructor(config: PeerConnectionConfig) {
    this.role = config.role;
    this.onMessage = config.onMessage;
    this.onConnect = config.onConnect;
    this.onDisconnect = config.onDisconnect;
  }

  /**
   * Initialize WebRTC connection
   */
  async initialize(iceServers?: RTCIceServer[]): Promise<void> {
    this.connection = new RTCPeerConnection({
      iceServers: iceServers || [
        { urls: 'stun:stun.l.google.com:19302' } // Free STUN server
      ],
    });

    this.setupConnectionHandlers();
  }

  private iceCandidateHandler: ((candidate: RTCIceCandidate) => void) | null = null;

  /**
   * Set ICE candidate handler (called by NetworkManager)
   */
  setIceCandidateHandler(handler: (candidate: RTCIceCandidate) => void): void {
    this.iceCandidateHandler = handler;
  }

  private setupConnectionHandlers(): void {
    if (!this.connection) return;

    this.connection.onicecandidate = (event) => {
      if (event.candidate && this.iceCandidateHandler) {
        this.iceCandidateHandler(event.candidate);
      }
    };

    this.connection.onconnectionstatechange = () => {
      const state = this.connection?.connectionState;
      console.log('Connection state:', state);
      
      if (state === 'connected') {
        this.onConnect();
      } else if (state === 'disconnected' || state === 'failed' || state === 'closed') {
        this.onDisconnect();
      }
    };

    // Host creates data channel
    if (this.role === 'host') {
      this.createDataChannel();
    } else {
      // Client waits for data channel from host
      this.connection.ondatachannel = (event) => {
        this.dataChannel = event.channel;
        this.setupDataChannelHandlers();
      };
    }
  }

  private createDataChannel(): void {
    if (!this.connection) return;

    this.dataChannel = this.connection.createDataChannel('game-state', {
      ordered: false, // Allow out-of-order delivery for lower latency
      maxRetransmits: 0, // Don't retransmit old state
    });

    this.setupDataChannelHandlers();
  }

  private setupDataChannelHandlers(): void {
    if (!this.dataChannel) return;

    this.dataChannel.onopen = () => {
      console.log('Data channel opened');
    };

    this.dataChannel.onclose = () => {
      console.log('Data channel closed');
    };

    this.dataChannel.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as NetworkMessage;
        this.onMessage(message);
      } catch (error) {
        console.error('Failed to parse message:', error);
      }
    };
  }

  /**
   * Send game state (host -> client)
   */
  sendState(state: GameState): void {
    if (this.role !== 'host') {
      console.warn('Only host can send state');
      return;
    }

    this.send({
      type: 'state',
      payload: state,
      sequence: this.messageSequence++,
    });
  }

  /**
   * Send command (client -> host or host -> host for local commands)
   */
  sendCommand(command: GameCommand): void {
    this.send({
      type: 'command',
      payload: command,
      sequence: this.messageSequence++,
    });
  }

  /**
   * Send any message
   */
  private send(message: NetworkMessage): void {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      console.warn('Data channel not ready');
      return;
    }

    try {
      this.dataChannel.send(JSON.stringify(message));
    } catch (error) {
      console.error('Failed to send message:', error);
    }
  }

  /**
   * Create offer (for initiating connection)
   */
  async createOffer(): Promise<RTCSessionDescriptionInit> {
    if (!this.connection) throw new Error('Connection not initialized');
    
    const offer = await this.connection.createOffer();
    await this.connection.setLocalDescription(offer);
    return offer;
  }

  /**
   * Create answer (for accepting connection)
   */
  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    if (!this.connection) throw new Error('Connection not initialized');
    
    const answer = await this.connection.createAnswer();
    await this.connection.setLocalDescription(answer);
    return answer;
  }

  /**
   * Set remote description
   */
  async setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> {
    if (!this.connection) throw new Error('Connection not initialized');
    await this.connection.setRemoteDescription(description);
  }

  /**
   * Add ICE candidate
   */
  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.connection) throw new Error('Connection not initialized');
    await this.connection.addIceCandidate(candidate);
  }

  /**
   * Close connection
   */
  close(): void {
    this.dataChannel?.close();
    this.connection?.close();
    this.dataChannel = null;
    this.connection = null;
  }
}
