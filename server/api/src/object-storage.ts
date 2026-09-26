import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import type { ObjectStorageConfig } from "./config.js";
import { DomainError } from "./domain.js";

export type StoredObject = { bytes: number; mimeType: string; sha256?: string };
export type StoredObjectDownload = {
  body: ReadableStream<Uint8Array>;
  status: 200 | 206;
  bytes: number;
  mimeType: string;
  contentRange?: string;
  acceptRanges?: string;
  etag?: string;
  lastModified?: string;
};

const DOWNLOAD_URL_TTL_SECONDS = 15 * 60;
const DOWNLOAD_CACHE_MAX_AGE_SECONDS = DOWNLOAD_URL_TTL_SECONDS - 60;

export interface ObjectStorage {
  ensureReady(): Promise<void>;
  createUploadUrl(
    storageKey: string,
    mimeType: string,
    sha256: string,
  ): Promise<{ url: string; headers: Record<string, string> }>;
  createDownloadUrl(storageKey: string, fileName?: string): Promise<string>;
  openDownload(
    storageKey: string,
    range?: string,
  ): Promise<StoredObjectDownload>;
  stat(storageKey: string): Promise<StoredObject | null>;
  get(storageKey: string): Promise<Uint8Array>;
  delete(storageKey: string): Promise<void>;
  put(
    storageKey: string,
    body: Uint8Array,
    mimeType: string,
    sha256: string,
  ): Promise<StoredObject>;
}

export class S3ObjectStorage implements ObjectStorage {
  private readonly internalClient: S3Client;
  private readonly publicClient: S3Client;

  constructor(private readonly config: ObjectStorageConfig) {
    const shared = {
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: config.forcePathStyle,
    };
    this.internalClient = new S3Client({
      ...shared,
      endpoint: config.endpoint,
    });
    this.publicClient =
      config.publicEndpoint === config.endpoint
        ? this.internalClient
        : new S3Client({ ...shared, endpoint: config.publicEndpoint });
  }

  async ensureReady() {
    try {
      await this.internalClient.send(
        new HeadBucketCommand({ Bucket: this.config.bucket }),
      );
    } catch (error) {
      if (!this.config.autoCreateBucket)
        throw new DomainError(
          "OBJECT_STORAGE_UNAVAILABLE",
          "素材存储暂时不可用",
          503,
          true,
          { cause: error },
        );
      await this.internalClient.send(
        new CreateBucketCommand({ Bucket: this.config.bucket }),
      );
    }
  }

  async createUploadUrl(storageKey: string, mimeType: string, sha256: string) {
    const command = new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: storageKey,
      ContentType: mimeType,
      Metadata: { sha256 },
    });
    return {
      url: await getSignedUrl(this.publicClient, command, {
        unhoistableHeaders: new Set(["x-amz-meta-sha256"]),
        signableHeaders: new Set(["content-type"]),
      }),
      headers: { "content-type": mimeType, "x-amz-meta-sha256": sha256 },
    };
  }

  async createDownloadUrl(storageKey: string, fileName?: string) {
    const disposition = fileName
      ? `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`
      : undefined;
    return getSignedUrl(
      this.publicClient,
      new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: storageKey,
        ResponseContentDisposition: disposition,
        ResponseCacheControl: `private, max-age=${DOWNLOAD_CACHE_MAX_AGE_SECONDS}`,
      }),
      { expiresIn: DOWNLOAD_URL_TTL_SECONDS },
    );
  }

  async openDownload(storageKey: string, range?: string) {
    try {
      const result = await this.internalClient.send(
        new GetObjectCommand({
          Bucket: this.config.bucket,
          Key: storageKey,
          ...(range ? { Range: range } : {}),
        }),
      );
      if (!result.Body)
        throw new DomainError("OBJECT_NOT_FOUND", "素材文件不存在", 404);
      return {
        body: result.Body.transformToWebStream() as ReadableStream<Uint8Array>,
        status: result.ContentRange ? 206 : 200,
        bytes: result.ContentLength ?? 0,
        mimeType: result.ContentType || "application/octet-stream",
        ...(result.ContentRange ? { contentRange: result.ContentRange } : {}),
        ...(result.AcceptRanges ? { acceptRanges: result.AcceptRanges } : {}),
        ...(result.ETag ? { etag: result.ETag } : {}),
        ...(result.LastModified
          ? { lastModified: result.LastModified.toUTCString() }
          : {}),
      } satisfies StoredObjectDownload;
    } catch (error) {
      if (error instanceof DomainError) throw error;
      const status =
        typeof error === "object" && error && "$metadata" in error
          ? (error as { $metadata?: { httpStatusCode?: number } }).$metadata
              ?.httpStatusCode
          : undefined;
      if (status === 404)
        throw new DomainError("OBJECT_NOT_FOUND", "素材文件不存在", 404);
      if (status === 416)
        throw new DomainError("INVALID_MEDIA_RANGE", "请求的素材范围无效", 416);
      throw error;
    }
  }

  async stat(storageKey: string): Promise<StoredObject | null> {
    try {
      const result = await this.internalClient.send(
        new HeadObjectCommand({ Bucket: this.config.bucket, Key: storageKey }),
      );
      return {
        bytes: result.ContentLength ?? 0,
        mimeType: result.ContentType || "application/octet-stream",
        sha256: result.Metadata?.sha256,
      };
    } catch (error) {
      const status =
        typeof error === "object" && error && "$metadata" in error
          ? (error as { $metadata?: { httpStatusCode?: number } }).$metadata
              ?.httpStatusCode
          : undefined;
      if (status === 404) return null;
      throw error;
    }
  }

  async get(storageKey: string) {
    const result = await this.internalClient.send(
      new GetObjectCommand({ Bucket: this.config.bucket, Key: storageKey }),
    );
    if (!result.Body)
      throw new DomainError("OBJECT_NOT_FOUND", "素材文件不存在", 404);
    return result.Body.transformToByteArray();
  }

  async delete(storageKey: string) {
    await this.internalClient.send(
      new DeleteObjectCommand({ Bucket: this.config.bucket, Key: storageKey }),
    );
  }

  async put(
    storageKey: string,
    body: Uint8Array,
    mimeType: string,
    sha256: string,
  ) {
    await this.internalClient.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: storageKey,
        Body: body,
        ContentType: mimeType,
        Metadata: { sha256 },
      }),
    );
    return { bytes: body.byteLength, mimeType, sha256 };
  }
}
