const bcrypt = require('bcryptjs');

const password = 'Ormazabal1';
const saltRounds = 10;

// Encriptar la contraseña
bcrypt.hash(password, saltRounds, (err, hashedPassword) => {
  if (err) {
    return console.error('Error en la encriptación de la contraseña:', err);
  }
  console.log('Contraseña encriptada:', hashedPassword);

  // Comparar la contraseña encriptada
  bcrypt.compare(password, hashedPassword, (err, result) => {
    if (err) {
      return console.error('Error en la comparación de contraseñas:', err);
    }
    console.log('Resultado de bcrypt.compare:', result); // Debería ser true
  });
});