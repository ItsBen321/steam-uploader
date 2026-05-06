import type { SteamUploaderApi } from "../electron/preload";

declare global {
  interface Window {
    steamUploader: SteamUploaderApi;
  }
}

export {};
