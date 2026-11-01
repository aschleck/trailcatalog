import { md5 } from './md5';

test('matches the RFC 1321 test suite', () => {
  expect(md5('')).toBe('d41d8cd98f00b204e9800998ecf8427e');
  expect(md5('a')).toBe('0cc175b9c0f1b6a831c399e269772661');
  expect(md5('abc')).toBe('900150983cd24fb0d6963f7d28e17f72');
  expect(md5('message digest')).toBe('f96b697d7cb7938d525a2f31aaf161d0');
  expect(md5('abcdefghijklmnopqrstuvwxyz')).toBe('c3fcd3d76192e4007dfb496cca67e13b');
  expect(md5('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'))
      .toBe('d174ab98d277d9f5a5611c2c9f419d9f');
  expect(md5('1234567890'.repeat(8))).toBe('57edf4a22be3c955ac49da2e2107b67a');
});

test('hashes UTF-8 bytes', () => {
  expect(md5('é')).toBe('66ddcd97cfdeabb2f6fb8a999b4bc76f');
  expect(md5('Mount_Rainier_from_west.jpg')).toBe('ebbdfe8fd332e70ae0d70f5fa7e9ad16');
});
