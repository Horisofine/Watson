import { extractText } from "unpdf";
import type { File as GrammyFile } from "@grammyjs/files";
import * as path from "node:path";

export interface FileMetadata {
  userId: number;
  chatId: number;
  filename: string;
  fileType: "pdf" | "txt";
  filePath: string;
  uploadDate: number;
  fileSize: number;
}

/**
 * Downloads a file from Telegram and saves it to disk with user isolation.
 */
export async function downloadAndSaveFile(
  file: GrammyFile,
  userId: number,
  chatId: number
): Promise<FileMetadata> {
  console.log(`[FILE HANDLER] Starting download for user ${userId}`);

  const uploadDir = process.env.UPLOAD_DIR || "./uploads";
  const userDir = path.join(uploadDir, String(userId));

  // Ensure user directory exists
  console.log(`[FILE HANDLER] Ensuring directory exists: ${userDir}`);
  await Bun.write(path.join(userDir, ".keep"), "");

  // Generate safe filename with timestamp
  const timestamp = Date.now();
  const originalName = file.file_path?.split("/").pop() || "unknown";
  const ext = path.extname(originalName).toLowerCase();
  const safeFilename = `${timestamp}_${originalName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const filePath = path.join(userDir, safeFilename);

  console.log(`[FILE HANDLER] Downloading to: ${filePath}`);

  // Download file from Telegram
  await file.download(filePath);

  // Get file size
  const fileStats = await Bun.file(filePath).size;
  console.log(`[FILE HANDLER] Download complete: ${fileStats} bytes`);

  // Determine file type
  let fileType: "pdf" | "txt";
  if (ext === ".pdf") {
    fileType = "pdf";
  } else if ([".txt", ".md", ".log"].includes(ext)) {
    fileType = "txt";
  } else {
    throw new Error(`Unsupported file type: ${ext}`);
  }

  return {
    userId,
    chatId,
    filename: originalName,
    fileType,
    filePath,
    uploadDate: timestamp,
    fileSize: fileStats,
  };
}

/**
 * Extracts text content from a file based on its type.
 */
export async function extractTextFromFile(
  metadata: FileMetadata
): Promise<string> {
  console.log(`[FILE HANDLER] Extracting text from ${metadata.fileType} file: ${metadata.filename}`);

  if (metadata.fileType === "pdf") {
    return await extractTextFromPDF(metadata.filePath);
  } else if (metadata.fileType === "txt") {
    return await extractTextFromTextFile(metadata.filePath);
  }
  throw new Error(`Unsupported file type: ${metadata.fileType}`);
}

/**
 * Extracts text from a PDF file using unpdf.
 */
async function extractTextFromPDF(filePath: string): Promise<string> {
  try {
    console.log(`[FILE HANDLER] Reading PDF file: ${filePath}`);
    const file = Bun.file(filePath);
    const arrayBuffer = await file.arrayBuffer();
    console.log(`[FILE HANDLER] PDF buffer size: ${arrayBuffer.byteLength} bytes`);

    console.log(`[FILE HANDLER] Extracting text with unpdf...`);
    const { text } = await extractText(new Uint8Array(arrayBuffer), {
      mergePages: true,
    });

    if (!text || text.trim().length === 0) {
      throw new Error("No text content found in PDF");
    }

    console.log(`[FILE HANDLER] PDF text extraction successful: ${text.length} characters`);
    return text.trim();
  } catch (error) {
    console.error(`[FILE HANDLER] PDF extraction failed:`, error);
    throw new Error(
      `Failed to extract text from PDF: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Reads text from a plain text file.
 */
async function extractTextFromTextFile(filePath: string): Promise<string> {
  try {
    const file = Bun.file(filePath);
    const text = await file.text();

    if (!text || text.trim().length === 0) {
      throw new Error("Text file is empty");
    }

    return text.trim();
  } catch (error) {
    throw new Error(
      `Failed to read text file: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Lists all files uploaded by a specific user.
 */
export async function listUserFiles(userId: number): Promise<string[]> {
  const uploadDir = process.env.UPLOAD_DIR || "./uploads";
  const userDir = path.join(uploadDir, String(userId));

  try {
    const files = await Array.fromAsync(
      new Bun.Glob("*").scan({ cwd: userDir })
    );
    return files.filter((f) => f !== ".keep");
  } catch {
    return [];
  }
}

/**
 * Deletes a specific file for a user.
 */
export async function deleteUserFile(
  userId: number,
  filename: string
): Promise<boolean> {
  const uploadDir = process.env.UPLOAD_DIR || "./uploads";
  const userDir = path.join(uploadDir, String(userId));
  const filePath = path.join(userDir, filename);

  try {
    // Security: ensure the file is within the user's directory
    const realPath = path.resolve(filePath);
    const realUserDir = path.resolve(userDir);
    if (!realPath.startsWith(realUserDir)) {
      throw new Error("Invalid file path");
    }

    await Bun.$`rm ${filePath}`;
    return true;
  } catch {
    return false;
  }
}
