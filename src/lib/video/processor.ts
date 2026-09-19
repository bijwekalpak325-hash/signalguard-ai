import {
  startVideoProcessing as startExistingVideoProcessing,
} from "@/lib/video-processor";

/**
 * Dedicated video-processing entry point.
 *
 * The actual FFmpeg/video-analysis implementation remains
 * in the existing working processor for now.
 */
export async function processVideo(sessionId: number): Promise<void> {
  await startExistingVideoProcessing(sessionId);
}