const bcrypt = require('bcryptjs');
const Usuario = require('../models/User'); // Asegúrate de que la ruta sea la correcta
const jwt = require('jsonwebtoken')

// controlador para crear un usuario
const registerUser = async (req, res) => {
  try {
    const { nombre, email, password, rol } = req.body;

    // // Encripta la contraseña LO ESTA HACIENDO EN EL MIDDLEWARE DEL SCHEMA DE LA TABLA USUARIO
    // const saltRounds = 10;
    // const hashedPassword = await bcrypt.hash(password, saltRounds);
    // console.log('Hashed Password:', hashedPassword)

    // Crea el usuario
    const nuevoUsuario = new Usuario({
      nombre,
      email,
      password,
      rol
    });

    // Guarda el usuario en la base de datos
    await nuevoUsuario.save();

    const usuarioGuardado = await Usuario.findOne({ email });
    // console.log('Usuario guardado:', usuarioGuardado);
    // console.log('Hash de la contraseña guardada:', usuarioGuardado.password);

    res.status(201).json({ message: 'Usuario creado correctamente', usuario: nuevoUsuario });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error al crear usuario', error: error.message });
  }
};




// controlador para el login
const login = async (req, res) => {
  console.log('Solicitud de login recibida');
  const { email, password } = req.body;

  try {
    // Buscar al usuario por email
    console.log(`Buscando usuario con email: ${email}`);
    const usuario = await Usuario.findOne({ email });

    if (!usuario) {
      console.log('Usuario no encontrado');
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    // Verificar la contraseña con bcrypt
    // console.log('Contraseña ingresada:', password.trim());
    // console.log('Contraseña almacenada:', usuario.password);
    console.log('Comparando contraseñas');
    const isPasswordValid = await bcrypt.compare(password.trim(), usuario.password);
    //console.log('Resultado de bcrypt.compare:', isPasswordValid);

    if (!isPasswordValid) {
      console.log('Contraseña incorrecta');
      return res.status(401).json({ message: 'Contraseña incorrecta' });
    }


    // Generar un token JWT si la contraseña es correcta
    console.log('Generando token JWT');
    const token = jwt.sign(
      { id: usuario.id, role: usuario.role },
      process.env.JWT_SECRET, // Define JWT_SECRET en tu archivo de configuración .env
      { expiresIn: '1h' } // Puedes ajustar el tiempo de expiración
    );



    // Enviar el token y los detalles del usuario (sin la contraseña) en la respuesta
    res.cookie('token', token, { httpOnly: true, secure: true });
    console.log('Login exitoso');
    res.status(200).json({
      message: 'Inicio de sesión exitoso',
      token,
      usuario: {
        id: usuario.id,
        email: usuario.email,
        nombre: usuario.nombre,
        role: usuario.role
      }
    });
  } catch (error) {
    console.error('Error en el inicio de sesión:', error);
    res.status(500).json({ message: 'Error en el inicio de sesión', error });
  }
}



module.exports = { registerUser, login };
