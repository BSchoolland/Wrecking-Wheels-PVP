/**
 * Peer-to-Peer WebRTC Connection Manager
 * Handles host-client communication
 */

import type { GameState } from '@shared/types/GameState';
import type { GameCommand, NetworkMessage, UIState, GameEvent } from '@shared/types/Commands';

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
  private dataChannel: RTCDataChannel | null = null; // Physics channel (unreliable)
  private reliableChannel: RTCDataChannel | null = null; // UI/Events channel (reliable)
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
        { urls: 'stun:stun.l.google.com:19302' },
      ],
      iceCandidatePoolSize: 10,
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
      if (event.candidate) {
        console.log(`[${this.role}] ICE candidate: ${event.candidate.candidate}`);
        if (this.iceCandidateHandler) {
          this.iceCandidateHandler(event.candidate);
        }
      } else {
        console.log(`[${this.role}] ICE gathering complete`);
      }
    };

    this.connection.oniceconnectionstatechange = () => {
      const state = this.connection?.iceConnectionState;
      console.log(`[${this.role}] ICE connection state: ${state}`);
    };

    this.connection.onicegatheringstatechange = () => {
      const state = this.connection?.iceGatheringState;
      console.log(`[${this.role}] ICE gathering state: ${state}`);
    };

    this.connection.onconnectionstatechange = () => {
      const state = this.connection?.connectionState;
      console.log(`[${this.role}] Connection state: ${state}`);
      if (state === 'disconnected' || state === 'failed' || state === 'closed') {
        this.onDisconnect();
      }
    };

    // Host creates data channels
    if (this.role === 'host') {
      this.createDataChannel();
      this.createReliableChannel();
    } else {
      // Client waits for data channels from host
      this.connection.ondatachannel = (event) => {
        if (event.channel.label === 'game-state') {
          this.dataChannel = event.channel;
          this.setupDataChannelHandlers();
        } else if (event.channel.label === 'reliable') {
          this.reliableChannel = event.channel;
          this.setupReliableChannelHandlers();
        }
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

  private createReliableChannel(): void {
    if (!this.connection) return;

    this.reliableChannel = this.connection.createDataChannel('reliable', {
      ordered: true, // Ordered delivery
      // maxRetransmits not specified = reliable delivery
    });

    this.setupReliableChannelHandlers();
  }

  private setupDataChannelHandlers(): void {
    if (!this.dataChannel) return;

    this.dataChannel.onopen = () => {
      console.log(`[${this.role}] Physics data channel opened`);
    };

    this.dataChannel.onclose = () => {
      console.log(`[${this.role}] Physics data channel closed`);
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

  private setupReliableChannelHandlers(): void {
    if (!this.reliableChannel) return;

    this.reliableChannel.onopen = () => {
      console.log(`[${this.role}] Reliable data channel opened`);
      this.onConnect();
    };

    this.reliableChannel.onclose = () => {
      console.log(`[${this.role}] Reliable data channel closed`);
    };

    this.reliableChannel.onmessage = (event) => {
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
    if (!this.reliableChannel || this.reliableChannel.readyState !== 'open') {
      console.warn('Reliable channel not ready for command');
      return;
    }
    this.sendReliable({
      type: 'command',
      payload: command,
      sequence: this.messageSequence++,
    });
  }

  /**
   * Send UI update (host -> client) - via reliable channel
   */
  sendUIUpdate(uiState: UIState): void {
    if (this.role !== 'host') {
      console.warn('Only host can send UI updates');
      return;
    }

    this.sendReliable({
      type: 'ui-update',
      payload: uiState,
      sequence: this.messageSequence++,
    });
  }

  /**
   * Send game event (host -> client) - via reliable channel
   */
  sendEvent(event: GameEvent): void {
    if (this.role !== 'host') {
      console.warn('Only host can send events');
      return;
    }

    this.sendReliable({
      type: 'event',
      payload: event,
      sequence: this.messageSequence++,
    });
  }

  /**
   * Send message via unreliable physics channel
   */
  private send(message: NetworkMessage): void {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      console.warn('Physics data channel not ready');
      return;
    }

    try {
      this.dataChannel.send(JSON.stringify(message));
    } catch (error) {
      console.error('Failed to send message:', error);
    }
  }

  /**
   * Send message via reliable channel
   */
  private sendReliable(message: NetworkMessage): void {
    if (!this.reliableChannel || this.reliableChannel.readyState !== 'open') {
      console.warn('Reliable data channel not ready');
      return;
    }

    try {
      this.reliableChannel.send(JSON.stringify(message));
    } catch (error) {
      console.error('Failed to send reliable message:', error);
    }
  }

  /**
   * Send message via reliable channel (internal utility)
   */
  public sendReliableInternal(message: NetworkMessage): void {
    this.sendReliable(message);
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
    this.reliableChannel?.close();
    this.connection?.close();
    this.dataChannel = null;
    this.reliableChannel = null;
    this.connection = null;
  }
}
