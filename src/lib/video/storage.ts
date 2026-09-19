import { put } from "@vercel/blob";

export async function saveVideo(
  file: File,
  fileName: string
): Promise<{
  url: string;
  size: number;
  mimeType: string;
}> {
  if (process.env.VERCEL === "1") {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      throw new Error(
        "BLOB_READ_WRITE_TOKEN is not configured"
      );
    }

    const blob = await put(
      `signalguard/videos/${fileName}`,
      file,
      {
        access: "public",
        addRandomSuffix: false,
        token: process.env.BLOB_READ_WRITE_TOKEN,
      }
    );

    return {
      url: blob.url,
      size: file.size,
      mimeType: file.type || "video/mp4",
    };
  }

  throw new Error(
    "Local video storage will continue using the existing local upload system."
  );
}