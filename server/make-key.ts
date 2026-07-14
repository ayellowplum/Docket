import { decodeDocketKey, encodeDocketKey } from './keycipher.ts';

const realKey = process.argv[2];
if (!realKey) {
  console.error('Usage: npm run make-key -- <real-deepseek-key>');
  process.exit(1);
}

const docketKey = encodeDocketKey(realKey);
if (decodeDocketKey(docketKey) !== realKey) {
  console.error('Round-trip check failed — key not generated.');
  process.exit(1);
}

console.log(docketKey);
