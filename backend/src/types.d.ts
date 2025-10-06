declare module 'express' {
  export interface Request {
    body: any;
    params: any;
  }

  export interface Response {
    json(data: any): Response;
    status(code: number): Response;
    sendFile(path: string): Response;
  }

  const expressModule: {
    (): any;
    json(): any;
    static(root: string): any;
    Router(): any;
  } & typeof Request & typeof Response;

  export = expressModule;
}

declare module 'cors' {
  const corsModule: any;
  export = corsModule;
}

declare module 'ws' {
  export class WebSocketServer {
    constructor(options: any);
    on(event: 'connection', listener: (ws: WebSocket) => void): this;
  }

  export class WebSocket {
    on(event: 'message', listener: (message: string | Buffer) => void): this;
    on(event: 'close', listener: () => void): this;
    send(data: string): void;
    close(): void;
  }
}
