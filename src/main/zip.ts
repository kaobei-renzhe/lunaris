import { closeSync, openSync, readSync, statSync, writeSync } from 'node:fs'
import { deflateRawSync, inflateRawSync } from 'node:zlib'

interface CentralEntry {
  name: string
  method: number
  crc: number
  compressedSize: number
  uncompressedSize: number
  offset: number
  time: number
  date: number
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[i] = c >>> 0
  }
  return table
})()

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff
  for (let i = 0; i < buffer.length; i++) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function dosDateTime(date: Date): { time: number; date: number } {
  const time = ((date.getHours() & 31) << 11) | ((date.getMinutes() & 63) << 5) | ((date.getSeconds() / 2) & 31)
  const day =
    (((date.getFullYear() - 1980) & 127) << 9) | (((date.getMonth() + 1) & 15) << 5) | (date.getDate() & 31)
  return { time, date: day }
}

export class ZipWriter {
  private fd: number
  private offset = 0
  private entries: CentralEntry[] = []

  constructor(private readonly filePath: string) {
    this.fd = openSync(filePath, 'w')
  }

  addFile(name: string, data: Buffer, compress = true): void {
    const crc = crc32(data)
    const compressed = compress ? deflateRawSync(data, { level: 6 }) : data
    const useDeflate = compress && compressed.length < data.length
    const payload = useDeflate ? compressed : data
    const method = useDeflate ? 8 : 0
    const nameBuf = Buffer.from(name, 'utf8')
    const { time, date } = dosDateTime(new Date())

    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50, 0)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(0x0800, 6)
    header.writeUInt16LE(method, 8)
    header.writeUInt16LE(time, 10)
    header.writeUInt16LE(date, 12)
    header.writeUInt32LE(crc, 14)
    header.writeUInt32LE(payload.length, 18)
    header.writeUInt32LE(data.length, 22)
    header.writeUInt16LE(nameBuf.length, 26)
    header.writeUInt16LE(0, 28)

    this.entries.push({
      name,
      method,
      crc,
      compressedSize: payload.length,
      uncompressedSize: data.length,
      offset: this.offset,
      time,
      date
    })

    writeSync(this.fd, header, 0, header.length)
    writeSync(this.fd, nameBuf, 0, nameBuf.length)
    writeSync(this.fd, payload, 0, payload.length)
    this.offset += header.length + nameBuf.length + payload.length
  }

  finish(): void {
    const cdStart = this.offset
    for (const entry of this.entries) {
      const nameBuf = Buffer.from(entry.name, 'utf8')
      const header = Buffer.alloc(46)
      header.writeUInt32LE(0x02014b50, 0)
      header.writeUInt16LE(20, 4)
      header.writeUInt16LE(20, 6)
      header.writeUInt16LE(0x0800, 8)
      header.writeUInt16LE(entry.method, 10)
      header.writeUInt16LE(entry.time, 12)
      header.writeUInt16LE(entry.date, 14)
      header.writeUInt32LE(entry.crc, 16)
      header.writeUInt32LE(entry.compressedSize, 20)
      header.writeUInt32LE(entry.uncompressedSize, 24)
      header.writeUInt16LE(nameBuf.length, 28)
      header.writeUInt16LE(0, 30)
      header.writeUInt16LE(0, 32)
      header.writeUInt16LE(0, 34)
      header.writeUInt16LE(0, 36)
      header.writeUInt32LE(0, 38)
      header.writeUInt32LE(entry.offset, 42)
      writeSync(this.fd, header, 0, header.length)
      writeSync(this.fd, nameBuf, 0, nameBuf.length)
      this.offset += header.length + nameBuf.length
    }

    const cdSize = this.offset - cdStart
    const eocd = Buffer.alloc(22)
    eocd.writeUInt32LE(0x06054b50, 0)
    eocd.writeUInt16LE(0, 4)
    eocd.writeUInt16LE(0, 6)
    eocd.writeUInt16LE(this.entries.length, 8)
    eocd.writeUInt16LE(this.entries.length, 10)
    eocd.writeUInt32LE(cdSize, 12)
    eocd.writeUInt32LE(cdStart, 16)
    eocd.writeUInt16LE(0, 20)

    writeSync(this.fd, eocd, 0, eocd.length)
    this.offset += eocd.length
    closeSync(this.fd)
  }
}

export interface ZipEntry {
  name: string
  method: number
  compressedSize: number
  uncompressedSize: number
  offset: number
}

export function listZipEntries(filePath: string): ZipEntry[] {
  const size = statSync(filePath).size
  const tailSize = Math.min(size, 65557)
  const fd = openSync(filePath, 'r')
  try {
    const tail = Buffer.alloc(tailSize)
    readSync(fd, tail, 0, tailSize, size - tailSize)

    let eocd = -1
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === 0x06054b50) {
        eocd = i
        break
      }
    }
    if (eocd < 0) throw new Error('不是有效的 zip 文件')

    const entryCount = tail.readUInt16LE(eocd + 10)
    const cdSize = tail.readUInt32LE(eocd + 12)
    const cdOffset = tail.readUInt32LE(eocd + 16)
    if (entryCount === 0xffff || cdOffset === 0xffffffff) {
      throw new Error('暂不支持超大备份包（zip64）')
    }

    const cd = Buffer.alloc(cdSize)
    readSync(fd, cd, 0, cdSize, cdOffset)

    const entries: ZipEntry[] = []
    let cursor = 0
    for (let i = 0; i < entryCount; i++) {
      if (cd.readUInt32LE(cursor) !== 0x02014b50) break
      const method = cd.readUInt16LE(cursor + 10)
      const compressedSize = cd.readUInt32LE(cursor + 20)
      const uncompressedSize = cd.readUInt32LE(cursor + 24)
      const nameLen = cd.readUInt16LE(cursor + 28)
      const extraLen = cd.readUInt16LE(cursor + 30)
      const commentLen = cd.readUInt16LE(cursor + 32)
      const offset = cd.readUInt32LE(cursor + 42)
      const name = cd.subarray(cursor + 46, cursor + 46 + nameLen).toString('utf8')
      entries.push({ name, method, compressedSize, uncompressedSize, offset })
      cursor += 46 + nameLen + extraLen + commentLen
    }
    return entries
  } finally {
    closeSync(fd)
  }
}

export function readZipEntry(filePath: string, entry: ZipEntry): Buffer {
  const fd = openSync(filePath, 'r')
  try {
    const header = Buffer.alloc(30)
    readSync(fd, header, 0, 30, entry.offset)
    if (header.readUInt32LE(0) !== 0x04034b50) throw new Error('zip 条目损坏')
    const nameLen = header.readUInt16LE(26)
    const extraLen = header.readUInt16LE(28)
    const dataStart = entry.offset + 30 + nameLen + extraLen

    const raw = Buffer.alloc(entry.compressedSize)
    readSync(fd, raw, 0, entry.compressedSize, dataStart)
    return entry.method === 8 ? inflateRawSync(raw) : raw
  } finally {
    closeSync(fd)
  }
}
