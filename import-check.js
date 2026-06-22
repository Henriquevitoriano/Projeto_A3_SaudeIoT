const fs = require('fs');
const path = require('path');
const root = path.resolve('Back End');
function walk(dir) {
  let results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(walk(full));
    } else if (entry.isFile() && full.endsWith('.js')) {
      results.push(full);
    }
  }
  return results;
}
const jsFiles = walk(root);
let missing = [];
const importRegex = /import\s+[^'\"\n]+['\"](\.\.?\/[^'\"\n]+)['"]/g;
for (const file of jsFiles) {
  const content = fs.readFileSync(file, 'utf8');
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    const imp = match[1];
    const dir = path.dirname(file);
    const target = path.resolve(dir, imp);
    const candidates = [target, `${target}.js`, path.join(target, 'index.js')];
    if (!candidates.some((candidate) => fs.existsSync(candidate))) {
      missing.push({ file: path.relative(root, file), imp, candidates });
    }
  }
}
console.log('FILES SCANNED', jsFiles.length);
if (missing.length === 0) {
  console.log('NO MISSING RELATIVE IMPORTS');
  process.exit(0);
}
console.log('MISSING', missing.length);
for (const item of missing) {
  console.log(item.file, '->', item.imp);
  console.log('  candidates:', item.candidates.join(', '));
}
process.exit(1);
