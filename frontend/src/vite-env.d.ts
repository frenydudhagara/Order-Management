/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Origin of the API in production, e.g. https://forkful-api.onrender.com */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
