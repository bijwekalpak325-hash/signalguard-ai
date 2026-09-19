import { put } from "@vercel/blob";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { after } from "next/server";
import { NextRequest } from "next/server";

import { errorResponse, successResponse } from "@/lib/api-response";
import { getCurrentUser } from "@/lib/auth";
import {
  getUploadsDirectory,
  serializeSession,
  updateStore,
} from "@/lib/local-store";
import { startVideoProcessing } from "@/lib/video-processor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const allowedExtensions = new Set([".mp4", ".avi", ".mov"]);

const allowedMimeTypes = new Set([
  "video/mp4",
  "video/avi",
  "video/x-msvideo",
  "video/quicktime",
  "application/octet-stream",
]);

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return errorResponse(
        "UNAUTHORIZED",
        "Not authenticated",
        401
      );
    }

    const formData = await request.formData();
    const file = formData.get("video");

    if (!(file instanceof File)) {
      return errorResponse(
        "VALIDATION_ERROR",
        "A video file is required",
        400
      );
    }

    if (file.size > 500 * 1024 * 1024) {
      return errorResponse(
        "VALIDATION_ERROR",
        "File size must be less than 500MB",
        413
      );
    }

    const extension = path.extname(file.name).toLowerCase();

    if (
      !allowedExtensions.has(extension) ||
      (file.type && !allowedMimeTypes.has(file.type))
    ) {
      return errorResponse(
        "VALIDATION_ERROR",
        "Only MP4, AVI, and MOV files are supported",
        415
      );
    }

    const id = await updateStore(
      (store) => store.nextSessionId++
    );

    const safeName = `${id}-${file.name.replace(
      /[^a-zA-Z0-9._-]/g,
      "_"
    )}`;

    let filePath: string;
    let storedFileName = safeName;
    let processingFilePath: string | null = null;

    if (process.env.VERCEL === "1") {
      if (!process.env.BLOB_READ_WRITE_TOKEN) {
        return errorResponse(
          "STORAGE_ERROR",
          "Vercel Blob storage is not configured",
          500
        );
      }

      const blob = await put(
        `signalguard/videos/${safeName}`,
        file,
        {
          access: "public",
          addRandomSuffix: false,
          token: process.env.BLOB_READ_WRITE_TOKEN,
        }
      );

      filePath = blob.url;
      storedFileName = blob.url;

      /*
       * FFmpeg needs a filesystem path.
       * Download the Blob temporarily to /tmp so the
       * processor can analyse it after the response.
       */
      const tempDirectory = path.join(
        "/tmp",
        "signalguard"
      );

      await mkdir(tempDirectory, {
        recursive: true,
      });

      processingFilePath = path.join(
        tempDirectory,
        safeName
      );

      const blobResponse = await fetch(blob.url);

      if (!blobResponse.ok) {
        throw new Error(
          `Unable to download uploaded video from Blob: ${blobResponse.status}`
        );
      }

      const videoBuffer = Buffer.from(
        await blobResponse.arrayBuffer()
      );

      await writeFile(
        processingFilePath,
        videoBuffer
      );
    } else {
      const directory = getUploadsDirectory();

      await mkdir(directory, {
        recursive: true,
      });

      filePath = path.join(directory, safeName);

      await writeFile(
        filePath,
        Buffer.from(await file.arrayBuffer())
      );

      processingFilePath = filePath;
    }

    const session = await updateStore((store) => {
      const newSession = {
        id,
        userId: user.id,
        originalName: file.name,
        fileName: storedFileName,
        filePath,
        fileSize: file.size,
        mimeType: file.type || "video/mp4",
        status: "UPLOADED" as const,
        progress: 0,
        processedFrames: 0,
        totalFrames: 0,
        fps: 0,
        duration: 0,
        createdAt: new Date().toISOString(),
        detections: [],
        tracks: [],
        candidates: [],
        priorityEvents: [],
        decisionEvents: [
          {
            timestamp: new Date().toISOString(),
            event: "VIDEO UPLOADED",
            details: file.name,
          },
        ],
      };

      store.sessions.unshift(newSession);
      store.activeSessionIds[user.id] = id;

      return newSession;
    });

    /*
     * Localhost:
     * Keep the original background processing behaviour.
     */
    if (process.env.VERCEL !== "1") {
      startVideoProcessing(id);
    }

    /*
     * Vercel:
     * Continue processing after sending the response.
     * The session is already stored in Neon.
     */
    if (
      process.env.VERCEL === "1" &&
      processingFilePath
    ) {
      const tempPath = processingFilePath;

      after(async () => {
        try {
          await updateStore((store) => {
            const current = store.sessions.find(
              (item) => item.id === id
            );

            if (current) {
              current.filePath = tempPath;
              current.status = "UPLOADED";
            }
          });

          await startVideoProcessing(id);
        } catch (error) {
          console.error(
            "Background video processing error:",
            error
          );

          await updateStore((store) => {
            const current = store.sessions.find(
              (item) => item.id === id
            );

            if (current) {
              current.status = "FAILED";
              current.error =
                error instanceof Error
                  ? error.message
                  : "Video processing failed";
            }
          });
        }
      });
    }

    return successResponse(
      {
        session: serializeSession(session),
      },
      201
    );
  } catch (error) {
    console.error(
      "Video upload error:",
      error
    );

    return errorResponse(
      "UPLOAD_FAILED",
      "Unable to upload or process the video",
      500
    );
  }
}