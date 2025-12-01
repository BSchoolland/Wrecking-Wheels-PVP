/// <reference types="vite/client" />

declare module 'react-dom/client';

interface ImportMetaEnv {
  readonly VITE_SIGNALING_SERVER?: string;
  readonly VITE_SIGNALING_URL?: string;
  readonly DEV: boolean;
  // add other env vars used in the app as needed
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
