import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { DownloadTarget, StorageDriver, UploadTarget } from './storage';

/** S3-compatible driver (AWS S3, Azure Blob through an S3 gateway, MinIO). Credentials come from the default provider chain. */
export class S3Storage implements StorageDriver {
  readonly name = 's3' as const;
  private readonly client: S3Client;

  constructor(
    readonly bucket: string,
    region: string,
    private readonly ttlSeconds: number,
    endpoint?: string,
    forcePathStyle?: boolean,
  ) {
    this.client = new S3Client({
      region,
      ...(endpoint ? { endpoint } : {}),
      ...(forcePathStyle ? { forcePathStyle: true } : {}),
    });
  }

  async createUploadUrl(
    objectKey: string,
    contentType: string,
    sizeBytes: number,
  ): Promise<UploadTarget> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
      ContentType: contentType,
      ContentLength: sizeBytes,
    });
    const url = await getSignedUrl(this.client, command, { expiresIn: this.ttlSeconds });
    return {
      url,
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      expiresAt: new Date(Date.now() + this.ttlSeconds * 1000).toISOString(),
    };
  }

  async createDownloadUrl(
    objectKey: string,
    fileName: string,
    contentType: string,
  ): Promise<DownloadTarget> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
      ResponseContentType: contentType,
      ResponseContentDisposition: `attachment; filename="${fileName.replace(/[^\w.-]+/g, '_')}"`,
    });
    const url = await getSignedUrl(this.client, command, { expiresIn: this.ttlSeconds });
    return { url, expiresAt: new Date(Date.now() + this.ttlSeconds * 1000).toISOString() };
  }

  async write(objectKey: string, bytes: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        Body: bytes,
        ContentType: contentType,
        ContentLength: bytes.length,
      }),
    );
  }

  async read(objectKey: string): Promise<Buffer> {
    const r = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }));
    const bytes = await r.Body?.transformToByteArray();
    return Buffer.from(bytes ?? new Uint8Array());
  }

  async head(objectKey: string): Promise<{ sizeBytes: number } | null> {
    try {
      const r = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: objectKey }),
      );
      return { sizeBytes: r.ContentLength ?? 0 };
    } catch {
      return null;
    }
  }

  async remove(objectKey: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: objectKey }));
  }
}
