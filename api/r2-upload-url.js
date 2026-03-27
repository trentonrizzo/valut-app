import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
  forcePathStyle: true,
});

function sanitizeFileName(input) {
  const base = String(input ?? "").trim().split(/[\\/]/).pop() || "file";
  const sanitized = base
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return sanitized || "file";
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    let body = req.body;

    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        body = null;
      }
    }

    if (!body || typeof body !== "object") {
      return res.status(200).json({ ok: false, error: "Invalid JSON body" });
    }

    const fileName = body.fileName;
    if (!fileName) {
      return res.status(200).json({ ok: false, error: "fileName is required" });
    }

    const bucket =
      process.env.R2_BUCKET || process.env.R2_BUCKET_NAME || "vault-storage";

    if (!bucket) {
      return res.status(200).json({ ok: false, error: "R2 is not configured" });
    }

    const sanitizedFileName = sanitizeFileName(fileName);
    const key = `uploads/${Date.now()}-${sanitizedFileName}`;

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: "application/octet-stream",
    });

    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 60 });
    /** DB stores object key only; reads use signed GET URLs. */
    const fileUrl = key;

    return res.status(200).json({ ok: true, uploadUrl, fileUrl, key });
  } catch (err) {
    console.error(err);
    return res.status(200).json({
      ok: false,
      error: err instanceof Error ? err.message : "Failed to create upload URL",
    });
  }
}
