// Helper: restituisce il percorso reale della cartella gestionale
// (risolve symlink/junction che Cowork crea tra D:\ e C:\Users\...)
const fs = require('fs');
const path = require('path');
const sub = process.argv[2] || '';
try {
  const real = fs.realpathSync(path.join(__dirname, sub));
  process.stdout.write(real);
} catch (e) {
  process.stdout.write(path.resolve(__dirname, sub));
}
