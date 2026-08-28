import { CreateBucketCommand, DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const globalForStorage = globalThis as unknown as { s3?: S3Client; bucketReady?: Promise<void> };
const endpoint = process.env.S3_ENDPOINT ?? "http://localhost:9000";
const bucket = process.env.S3_BUCKET ?? "jingjie-assets";
const client = globalForStorage.s3 ?? new S3Client({ region: "us-east-1", endpoint, forcePathStyle: true, credentials: { accessKeyId: process.env.S3_ACCESS_KEY ?? "minio", secretAccessKey: process.env.S3_SECRET_KEY ?? "minio123" } });
if (process.env.NODE_ENV !== "production") globalForStorage.s3 = client;

async function ensureBucket() {
  if (!globalForStorage.bucketReady) globalForStorage.bucketReady = client.send(new HeadBucketCommand({ Bucket: bucket })).then(() => undefined).catch(async () => {
    try { await client.send(new CreateBucketCommand({ Bucket: bucket })); } catch (error) {
      const code = (error as { name?: string }).name;
      if (code !== "BucketAlreadyOwnedByYou" && code !== "BucketAlreadyExists") throw error;
    }
  });
  return globalForStorage.bucketReady;
}

export async function putAsset(objectKey: string, body: Uint8Array, contentType: string) { await ensureBucket(); await client.send(new PutObjectCommand({ Bucket: bucket, Key: objectKey, Body: body, ContentType: contentType })); }
export async function deleteAsset(objectKey: string) { await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey })); }
export async function getAsset(objectKey: string) { return client.send(new GetObjectCommand({ Bucket: bucket, Key: objectKey })); }
