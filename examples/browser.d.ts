declare global {
  interface Window {
    galleryReady: Promise<void>;
  }
}
export {};
