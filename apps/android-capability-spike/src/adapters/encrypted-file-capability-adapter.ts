import {
  AESSealedData,
  AESEncryptionKey,
  aesDecryptAsync,
  aesEncryptAsync,
} from 'expo-crypto';
import { Directory, File, FileMode, Paths } from 'expo-file-system';

import {
  CapabilityProbeError,
  type CapabilityProbeResult,
} from '../domain/capability-probe';

const chunkBytes = 1024 * 1024;
const chunkCount = 50;
const plaintextBytes = chunkBytes * chunkCount;

interface CancellationToken {
  readonly cancelled: boolean;
}

function uint32Bytes(value: number): Uint8Array {
  return new Uint8Array([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ]);
}

function readUint32(bytes: Uint8Array): number {
  if (bytes.length !== 4) {
    throw new CapabilityProbeError('file_round_trip_failed');
  }
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
}

function assertSyntheticChunk(bytes: Uint8Array, index: number): void {
  const expected = index % 251;
  if (
    bytes.length !== chunkBytes ||
    bytes[0] !== expected ||
    bytes[Math.floor(bytes.length / 2)] !== expected ||
    bytes[bytes.length - 1] !== expected
  ) {
    throw new CapabilityProbeError('file_round_trip_failed');
  }
}

function deleteIfPresent(file: File): void {
  if (file.exists) {
    file.delete();
  }
}

function prepareDirectory(): Directory {
  const directory = new Directory(Paths.cache, 'life-book-capability-spike');
  if (directory.exists) {
    directory.delete();
  }
  directory.create({ idempotent: true, intermediates: true });
  return directory;
}

function createSyntheticPlaintext(file: File): void {
  file.create({ overwrite: true });
  const handle = file.open(FileMode.WriteOnly);
  try {
    for (let index = 0; index < chunkCount; index += 1) {
      const chunk = new Uint8Array(chunkBytes);
      chunk.fill(index % 251);
      handle.writeBytes(chunk);
    }
  } finally {
    handle.close();
  }
  if (file.size !== plaintextBytes) {
    throw new CapabilityProbeError('file_round_trip_failed');
  }
}

async function encryptFile(
  input: File,
  output: File,
  key: AESEncryptionKey,
  cancellation: CancellationToken,
  cancelAfterChunks?: number,
): Promise<void> {
  output.create({ overwrite: true });
  const inputHandle = input.open(FileMode.ReadOnly);
  const outputHandle = output.open(FileMode.WriteOnly);
  try {
    for (let index = 0; index < chunkCount; index += 1) {
      if (cancellation.cancelled || index === cancelAfterChunks) {
        throw new CapabilityProbeError('cancel_cleanup_failed');
      }
      const plaintext = inputHandle.readBytes(chunkBytes);
      assertSyntheticChunk(plaintext, index);
      const sealed = await aesEncryptAsync(plaintext, key, {
        additionalData: uint32Bytes(index),
      });
      const combined = await sealed.combined();
      outputHandle.writeBytes(uint32Bytes(combined.length));
      outputHandle.writeBytes(combined);
    }
  } catch (error) {
    inputHandle.close();
    outputHandle.close();
    deleteIfPresent(output);
    throw error;
  }
  inputHandle.close();
  outputHandle.close();
}

async function verifyEncryptedFile(
  encrypted: File,
  key: AESEncryptionKey,
): Promise<void> {
  const handle = encrypted.open(FileMode.ReadOnly);
  let authenticationFailureObserved = false;
  try {
    for (let index = 0; index < chunkCount; index += 1) {
      const combinedLength = readUint32(handle.readBytes(4));
      if (combinedLength !== chunkBytes + 28) {
        throw new CapabilityProbeError('file_round_trip_failed');
      }
      const combined = handle.readBytes(combinedLength);
      const sealed = AESSealedData.fromCombined(combined);
      const plaintext = await aesDecryptAsync(sealed, key, {
        additionalData: uint32Bytes(index),
      });
      assertSyntheticChunk(plaintext, index);

      if (index === 0) {
        const tampered = combined.slice();
        const finalIndex = tampered.length - 1;
        const finalByte = tampered[finalIndex];
        if (finalByte === undefined) {
          throw new CapabilityProbeError('file_round_trip_failed');
        }
        tampered[finalIndex] = finalByte ^ 0x01;
        try {
          await aesDecryptAsync(AESSealedData.fromCombined(tampered), key, {
            additionalData: uint32Bytes(index),
          });
        } catch {
          authenticationFailureObserved = true;
        }
      }
    }
    if (handle.offset !== handle.size) {
      throw new CapabilityProbeError('file_round_trip_failed');
    }
  } finally {
    handle.close();
  }
  if (!authenticationFailureObserved) {
    throw new CapabilityProbeError('ciphertext_authentication_failed');
  }
}

export async function runEncryptedFileCapabilityProbe(): Promise<CapabilityProbeResult> {
  const directory = prepareDirectory();
  const plaintext = new File(directory, 'synthetic-50mb.plain');
  const cancelledOutput = new File(directory, 'cancelled.partial');
  const encrypted = new File(directory, 'synthetic-50mb.encrypted');

  try {
    createSyntheticPlaintext(plaintext);
    const key = await AESEncryptionKey.generate();

    try {
      await encryptFile(plaintext, cancelledOutput, key, { cancelled: false }, 3);
      throw new CapabilityProbeError('cancel_cleanup_failed');
    } catch (error) {
      if (
        !(error instanceof CapabilityProbeError) ||
        error.code !== 'cancel_cleanup_failed'
      ) {
        throw error;
      }
    }
    if (cancelledOutput.exists) {
      throw new CapabilityProbeError('cancel_cleanup_failed');
    }

    await encryptFile(plaintext, encrypted, key, { cancelled: false });
    await verifyEncryptedFile(encrypted, key);

    plaintext.delete();
    encrypted.delete();
    if (directory.list().length !== 0) {
      throw new CapabilityProbeError('file_cleanup_failed');
    }
    directory.delete();

    return {
      detail:
        '50 MiB / 1 MiB chunks; AES-256-GCM authentication, cancellation, and zero residual files',
    };
  } finally {
    if (directory.exists) {
      directory.delete();
    }
  }
}
