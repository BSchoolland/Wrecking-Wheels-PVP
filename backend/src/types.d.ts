declare module 'express' {
  export interface Request {
    body: unknown;
    params: unknown;
  }

  export interface Response {
    json(data: unknown): Response;
    status(code: number): Response;
    sendFile(path: string): Response;
  }

  const expressModule: {
    (): unknown;
    json(): unknown;
    static(root: string): unknown;
    Router(): unknown;
  } & typeof Request & typeof Response;

  export = expressModule;
}

declare module 'cors' {
  const corsModule: unknown;
  export = corsModule;
}

declare module 'ws' {
  export class WebSocketServer {
    constructor(options: unknown);
    on(event: 'connection', listener: (ws: WebSocket) => void): this;
  }

  export class WebSocket {
    on(event: 'message', listener: (message: string | Buffer) => void): this;
    on(event: 'close', listener: () => void): this;
    send(data: string): void;
    close(): void;
  }
}
