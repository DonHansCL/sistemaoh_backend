const jwt = require('jsonwebtoken');

// Verificar si el usuario tiene un token válido ESTE FUNCIONABA
// exports.verifyToken = (req, res, next) => {
//   const token = req.headers['authorization']?.split(' ')[1];
//   if (!token) {
//     return res.status(403).json({ message: 'Token no proporcionado' });
//   }

//   try {
//     const decoded = jwt.verify(token, process.env.JWT_SECRET);
//     req.user = decoded;  // Adjunta el usuario decodificado al request
//     next();
//   } catch (err) {
//     return res.status(401).json({ message: 'Token inválido o expirado' });
//   }
// }


// Middleware para verificar y autenticar el token
exports.verifyToken = (req, res, next) => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) {
    return res.status(403).json({ message: 'Token no proporcionado' });
  }

  jwt.verify(token, process.env.JWT_SECRET || process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).json({ message: 'Token inválido o expirado' });
    }
    req.user = decoded; // Adjunta el usuario decodificado al request
    next(); // Pasa al siguiente middleware
  });
}




// Verificar el rol del usuario
exports.checkRole = (roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'No tienes permiso para acceder a esta ruta' });
    }
    next();
  };
};
