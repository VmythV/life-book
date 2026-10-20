/**
 * 生成 v4 UUID。
 *
 * `crypto.randomUUID` 只在安全上下文（HTTPS 或 localhost）里有，手机等设备通过局域网 IP 用 http
 * 访问时是 undefined；`crypto.getRandomValues` 没有这个限制。
 */
export function newId(): string {
  // 第 7 个字节的高 4 位是版本号 4，第 9 个字节的高 2 位是变体 10。
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte, index) => {
    const value =
      index === 6 ? (byte & 0x0f) | 0x40 : index === 8 ? (byte & 0x3f) | 0x80 : byte;
    return value.toString(16).padStart(2, '0');
  }).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
