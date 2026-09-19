export interface VideoUploadResult {
  id: number;
  fileName: string;
  filePath: string;
  fileSize: number;
  mimeType: string;
}

export interface VideoFrameDetection {
  frameNumber: number;
  timestamp: number;
  className: string;
  confidence: number;
  bbox: [number, number, number, number];
  trackId: number;
}

export interface VideoTrack {
  id: number;
  className: string;
  firstFrame: number;
  lastFrame: number;
  framesSeen: number;
  trajectory: Array<{
    x: number;
    y: number;
  }>;
}