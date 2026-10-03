import sharp from "sharp";

export const REFERENCE_IMAGE_MAX_PIXELS = 36_000_000;

export type PreparedReferenceImage = {
  bytes: Uint8Array;
  mimeType: string;
  width?: number;
  height?: number;
  resized: boolean;
};

export async function constrainReferenceImage(
  bytes: Uint8Array,
  mimeType: string,
  maxPixels = REFERENCE_IMAGE_MAX_PIXELS,
): Promise<PreparedReferenceImage> {
  if (!mimeType.toLowerCase().startsWith("image/"))
    return { bytes, mimeType, resized: false };
  try {
    const metadata = await sharp(bytes, { failOn: "error" }).metadata();
    if (!metadata.width || !metadata.height)
      return { bytes, mimeType, resized: false };
    const swapsAxes =
      metadata.orientation !== undefined && metadata.orientation >= 5;
    const width = swapsAxes ? metadata.height : metadata.width;
    const height = swapsAxes ? metadata.width : metadata.height;
    if (width * height <= maxPixels)
      return { bytes, mimeType, width, height, resized: false };

    const scale = Math.sqrt(maxPixels / (width * height));
    const targetWidth = Math.max(1, Math.floor(width * scale));
    const targetHeight = Math.max(1, Math.floor(height * scale));
    let pipeline = sharp(bytes, { failOn: "error" })
      .autoOrient()
      .resize(targetWidth, targetHeight, {
        fit: "inside",
        withoutEnlargement: true,
      });
    let outputMimeType = mimeType;
    if (metadata.format === "jpeg") {
      pipeline = pipeline.jpeg({ quality: 92, chromaSubsampling: "4:4:4" });
      outputMimeType = "image/jpeg";
    } else if (metadata.format === "png") {
      pipeline = pipeline.png({ compressionLevel: 6 });
      outputMimeType = "image/png";
    } else if (metadata.format === "webp") {
      pipeline = pipeline.webp({ quality: 92 });
      outputMimeType = "image/webp";
    } else if (metadata.hasAlpha) {
      pipeline = pipeline.png({ compressionLevel: 6 });
      outputMimeType = "image/png";
    } else {
      pipeline = pipeline.jpeg({ quality: 92, chromaSubsampling: "4:4:4" });
      outputMimeType = "image/jpeg";
    }
    return {
      bytes: new Uint8Array(await pipeline.toBuffer()),
      mimeType: outputMimeType,
      width: targetWidth,
      height: targetHeight,
      resized: true,
    };
  } catch {
    return { bytes, mimeType, resized: false };
  }
}
