const bcrypt = require('bcrypt');
bcrypt.hash('admin123', 10, (err, hash) => {
  if (err) console.error(err);
  else console.log('NEW HASH:', hash);
  process.exit();
});