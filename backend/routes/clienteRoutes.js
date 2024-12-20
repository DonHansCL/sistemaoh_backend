// routes/clienteRoutes.js
const express = require('express');
const multer = require ('multer')
const fs = require ('fs')
const csv = require ('csv-parser')
const Cliente = require('../models/Cliente'); // Asegúrate de que el path sea correcto
const router = express.Router();
const { register, login } = require('../controllers/authController');
const { verifyToken, checkRole } = require('../middleware/auth');


// Configuracion de multer para manejar el archivo
const upload = multer({ dest: 'uploads/' })

// Definir la ruta para cargar el archivo CSV
router.post('/upload', upload.single('file'), verifyToken, checkRole(['ADMIN', 'FACTURACION']), async (req, res) => {
    const resultados = [];
    const errores = [];
    const advertencias = [];
  
    try {
      // Leer y procesar el archivo CSV
      const registros = await parseCSV(req.file.path);
  
      for (let index = 0; index < registros.length; index++) {
        const data = registros[index];
        const linea = index + 2; // Índice + 2 para considerar la cabecera y comenzar en línea 2
        let errorEncontrado = false;
  
        // Validar campos obligatorios
        if (!data.nombre || !data.rut || !data.direccion || !data.email) {
          errores.push({
            linea,
            mensaje: 'Todos los campos son obligatorios',
            datos: data,
          });
          errorEncontrado = true;
          continue;
        }
  
        // Validar formato de email
        if (!validarEmail(data.email)) {
          errores.push({
            linea,
            mensaje: 'Formato de email inválido',
            datos: data,
          });
          errorEncontrado = true;
          continue;
        }
  
        // Verificar si el cliente ya existe
        const clienteExistente = await Cliente.findOne({ rut: data.rut.trim() });
  
        if (clienteExistente) {
          advertencias.push({
            linea,
            mensaje: 'El cliente ya existe y fue omitido',
            datos: data,
          });
          continue; // Omitir e ir al siguiente registro
        }
  
        // Si no hay errores, crear el cliente
        if (!errorEncontrado) {
          const nuevoCliente = new Cliente({
            nombre: data.nombre.trim(),
            rut: data.rut.trim(),
            direccion: data.direccion.trim(),
            email: data.email.trim(),
            saldoPendiente: parseFloat(data.saldoPendiente) || 0,
          });
  
          try {
            await nuevoCliente.save();
            resultados.push({
              linea,
              mensaje: 'Cliente creado correctamente',
              datos: data,
            });
          } catch (err) {
            errores.push({
              linea,
              mensaje: `Error al guardar en la base de datos: ${err.message}`,
              datos: data,
            });
          }
        }
      }
  
      // Enviar resumen al cliente
      res.json({
        resultados,
        errores,
        advertencias,
      });
  
    } catch (err) {
      console.error(err);
      res.status(500).json({ mensaje: 'Error al procesar el archivo CSV.', error: err.message });
    } finally {
      // Eliminar el archivo temporal
      fs.unlinkSync(req.file.path);
    }
  });
  
  // Función para parsear el CSV
  const parseCSV = (filePath) => {
    return new Promise((resolve, reject) => {
      const registros = [];
      fs.createReadStream(filePath)
        .pipe(csv({ separator: ';' }))
        .on('data', (data) => registros.push(data))
        .on('end', () => resolve(registros))
        .on('error', (error) => reject(error));
    });
  };
  
  // Función para validar el formato de email
  const validarEmail = (email) => {
    const regex = /\S+@\S+\.\S+/;
    return regex.test(email);
  };


// Crear un cliente
router.post('/', verifyToken, checkRole(['ADMIN', 'FACTURACION']), async (req, res) => {
    const { nombre, rut, direccion, email, saldoPendiente } = req.body;
    const nuevoCliente = new Cliente({ nombre, rut, direccion, email, saldoPendiente });
    try {
        await nuevoCliente.save();
        res.status(201).json(nuevoCliente);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});


// Obtener un cliente por su RUT
router.get('/rut/:rut', verifyToken, checkRole(['ADMIN', 'FACTURACION']), async (req, res) => {
  const { rut } = req.params;

  try {
    // Buscar cliente por el RUT
    const cliente = await Cliente.findOne({ rut });
    
    if (!cliente) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }

    res.json(cliente);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
})


// Obtener todos los clientes
router.get('/', verifyToken, checkRole(['ADMIN', 'FACTURACION']), async (req, res) => {
    try {
      const clientes = await Cliente.find();
      res.json(clientes);
    } catch (error) {
      console.error('Error al obtener clientes:', error);
      res.status(500).json({ message: 'Error al obtener clientes' });
    }
  });

  // Nueva Ruta: Obtener clientes paginados
// URL: /paginated?page=1&limit=25
router.get('/paginated', verifyToken, checkRole(['ADMIN', 'FACTURACION']), async (req, res) => {
    let { page = 1, limit = 25, searchTerm = '', sortField = 'nombre', sortOrder = 'asc' } = req.query;

    // Convertir a número
    page = parseInt(page, 10);
    limit = parseInt(limit, 10);

    if (isNaN(page) || page < 1) page = 1;
    if (isNaN(limit) || limit < 1) limit = 25;

    // Crear filtro de búsqueda
    const searchRegex = new RegExp(searchTerm, 'i'); // Búsqueda insensible a mayúsculas y minúsculas
    const matchStage = searchTerm
        ? { 
            $match: {
                $or: [
                    { nombre: { $regex: searchRegex } },
                    { rut: { $regex: searchRegex } }
                ]
            }
          }
        : { $match: {} };

    // Crear objeto de sort
    const sortOptions = {};
    const allowedSortFields = ['nombre', 'rut', 'direccion', 'email', 'saldoPendienteTotal', 'abonosTotales'];
    if (allowedSortFields.includes(sortField)) {
        sortOptions[sortField] = sortOrder === 'asc' ? 1 : -1;
    } else {
        sortOptions['nombre'] = 1; // Orden predeterminado
    }

    try {
        const pipeline = [
            matchStage,
            // Lookup Facturas
            {
                $lookup: {
                    from: 'facturas', // Nombre correcto de la colección
                    localField: 'rut',
                    foreignField: 'clienteRut',
                    as: 'facturas'
                }
            },
            // Lookup Honorarios
            {
                $lookup: {
                    from: 'honorarios', // Nombre correcto de la colección
                    localField: 'rut',
                    foreignField: 'clienteRut',
                    as: 'honorarios'
                }
            },
            // Lookup Abonos para Facturas
            {
                $lookup: {
                    from: 'abonos',
                    localField: 'facturas._id',
                    foreignField: 'factura_id',
                    as: 'abonosFacturas'
                }
            },
            // Lookup Abonos para Honorarios
            {
                $lookup: {
                    from: 'abonohonorarios', // Nombre corregido de la colección
                    localField: 'honorarios._id',
                    foreignField: 'honorario_id',
                    as: 'abonosHonorarios'
                }
            },
            // Agregar los campos necesarios
            {
                $addFields: {
                    // Resumen Facturas
                    totalFacturas: { 
                        $sum: '$facturas.monto' 
                    },
                    totalAbonosFacturas: { 
                        $sum: '$abonosFacturas.monto' 
                    },
                    saldoPendienteFacturas: { 
                        $subtract: [ 
                            { $ifNull: ['$totalFacturas', 0] }, 
                            { $ifNull: ['$totalAbonosFacturas', 0] } 
                        ] 
                    },
                    cantidadDocumentosPendientesFacturas: { 
                        $size: { 
                            $filter: { 
                                input: '$facturas', 
                                as: 'factura', 
                                cond: { 
                                    $in: ['$$factura.estado', ['pendiente', 'abonada']] 
                                } 
                            } 
                        } 
                    },

                    // Resumen Honorarios
                    totalHonorarios: { 
                        $sum: '$honorarios.monto' 
                    },
                    totalAbonosHonorarios: { 
                        $sum: '$abonosHonorarios.monto' 
                    },
                    saldoPendienteHonorarios: { 
                        $subtract: [ 
                            { $ifNull: ['$totalHonorarios', 0] }, 
                            { $ifNull: ['$totalAbonosHonorarios', 0] } 
                        ] 
                    },
                    cantidadDocumentosPendientesHonorarios: { 
                        $size: { 
                            $filter: { 
                                input: '$honorarios', 
                                as: 'honorario', 
                                cond: { 
                                    $in: ['$$honorario.estado', ['pendiente', 'abonada']] 
                                } 
                            } 
                        } 
                    },

                    // Totales Generales
                    saldoPendienteTotal: { 
                        $add: [ 
                            { $ifNull: ['$saldoPendienteFacturas', 0] }, 
                            { $ifNull: ['$saldoPendienteHonorarios', 0] } 
                        ] 
                    },
                    abonosTotales: { 
                        $add: [ 
                            { $ifNull: ['$totalAbonosFacturas', 0] }, 
                            { $ifNull: ['$totalAbonosHonorarios', 0] } 
                        ] 
                    }
                }
            },
            // Proyectar campos que no necesitamos
            {
                $project: {
                    facturas: 0,
                    honorarios: 0,
                    abonosFacturas: 0,
                    abonosHonorarios: 0,
                    totalFacturas: 0,
                    totalHonorarios: 0
                }
            },
            // Ordenar
            { 
                $sort: sortOptions 
            },
            // Paginación
            { 
                $facet: {
                    metadata: [ 
                        { $count: "total" }, 
                        { $addFields: { page } } 
                    ],
                    data: [ 
                        { $skip: (page - 1) * limit }, 
                        { $limit: limit } 
                    ]
                } 
            },
            { 
                $unwind: "$metadata" 
            },
            { 
                $project: {
                    data: 1,
                    total: "$metadata.total",
                    page: "$metadata.page",
                    limit: limit
                } 
            }
        ];

        const result = await Cliente.aggregate(pipeline);

        if (result.length === 0) {
            return res.json({
                data: [],
                total: 0,
                page,
                limit,
            });
        }

        const { data, total, page: currentPage, limit: currentLimit } = result[0];

        res.json({
            data,
            total,
            page: currentPage,
            limit: currentLimit,
        });

    } catch (error) {
        console.error('Error al obtener clientes paginados:', error);
        res.status(500).json({ message: 'Error al obtener clientes paginados' });
    }
});


// Actualizar un cliente
router.put('/:id', verifyToken, checkRole(['ADMIN', 'FACTURACION']), async (req, res) => {
    const { nombre, rut, direccion, email, saldoPendiente } = req.body;
    try {
        const cliente = await Cliente.findByIdAndUpdate(req.params.id, { nombre, rut, direccion, email, saldoPendiente }, { new: true });
        if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado' });
        res.json(cliente);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// Eliminar un cliente
router.delete('/:id', verifyToken, checkRole(['ADMIN', 'FACTURACION']), async (req, res) => {
    try {
        const cliente = await Cliente.findByIdAndDelete(req.params.id);
        if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado' });
        res.json({ message: 'Cliente eliminado' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
