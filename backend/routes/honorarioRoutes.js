// routes/honorarioRoutes.js
const express = require('express');
const { verifyToken, checkRole } = require('../middleware/auth');
const Honorario = require('../models/Honorario');
const Cliente = require('../models/Cliente');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const csv = require('csv-parser');
const AbonoHonorario = require('../models/AbonoHonorario');
const mongoose = require('mongoose');
const upload = multer({ dest: 'uploads/' });

// Función para convertir fecha de DD-MM-YYYY a objeto Date
function convertirFecha(fechaString) {
  // Regex para verificar formatos DD-MM-YYYY o MM/DD/YYYY
  const regex = /^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/;
  const match = fechaString.match(regex);
  if (!match) return null;

  let [ , parte1, parte2, parte3 ] = match;

  let dia, mes, año;

  // Determinar el formato basado en el separador
  if (fechaString.includes('-')) {
    // Asumir formato DD-MM-YYYY
    dia = parseInt(parte1, 10);
    mes = parseInt(parte2, 10);
    año = parseInt(parte3, 10);
  } else {
    // Asumir formato MM/DD/YYYY
    mes = parseInt(parte1, 10);
    dia = parseInt(parte2, 10);
    año = parseInt(parte3, 10);
  }

  // Ajustar año si es de dos dígitos
  if (año < 100) {
    año += 2000;
  }

    // Verificar rangos válidos para mes y día
if (mes < 1 || mes > 12 || dia < 1 || dia > 31) {
  return null;
}

  const fecha = new Date(año, mes - 1, dia);

  // Validar que la fecha sea correcta
  if (fecha.getFullYear() !== año || fecha.getMonth() !== (mes - 1) || fecha.getDate() !== dia) {
    return null;
  }

  return fecha;
}


// Crear un nuevo honorario
router.post('/', verifyToken, checkRole(['ADMIN', 'FACTURACION']), async (req, res) => {
  const { clienteRut, fechaEmision, fechaPago, estado, monto } = req.body;

  try {
    const clienteExistente = await Cliente.findOne({ rut: clienteRut });
    if (!clienteExistente) {
      return res.status(400).json({ error: 'Cliente no encontrado' });
    }

    const nuevoHonorario = new Honorario({
      clienteRut: clienteExistente.rut, // Asignar rut directamente
      fechaEmision,
      fechaPago,
      estado,
      monto,
    });

    await nuevoHonorario.save();
    
    res.status(201).json(nuevoHonorario);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});


// Carga masiva de honorarios desde CSV
router.post('/upload', upload.single('file'), verifyToken, checkRole(['ADMIN', 'FACTURACION']), async (req, res) => {
  const resultados = [];
  let fila = 1; // Contador de filas

  // Verificar si se ha subido un archivo
  if (!req.file) {
    return res.status(400).json({ error: 'No se ha subido ningún archivo.' });
  }

  const session = await mongoose.startSession();
    session.startTransaction();

  try {
    // Leer y parsear el archivo CSV utilizando Promesas
    await new Promise((resolve, reject) => {
      fs.createReadStream(req.file.path)
        .pipe(csv({ separator: ';' }))
        .on('data', (data) => {
          resultados.push({
            fila,
            clienteRut: data.clienteRut ? data.clienteRut.trim() : '',
            fechaEmision: data.fechaEmision ? data.fechaEmision.trim() : '',
            fechaPago: data.fechaPago ? data.fechaPago.trim() : '',
            estado: data.estado ? data.estado.trim().toLowerCase() : '',
            monto: data.monto ? data.monto.trim() : '',
          });
          fila++;
        })
        .on('end', () => {
          resolve();
        })
        .on('error', (error) => {
          reject(error);
        });
    });

    const errores = [];

    // Validar todas las filas antes de insertar
      for (const item of resultados) {
        const { fila, clienteRut, fechaEmision, fechaPago, estado, monto } = item;

        // Validaciones básicas
        if (!clienteRut || !fechaEmision || !estado || !monto) {
          errores.push({
            fila,
            estado: 'Error',
            detalles: 'Faltan campos obligatorios.',
          });
          continue;
        }

        // Validar formato de fecha de emisión
        const fechaEmisionDate = convertirFecha(fechaEmision);
        if (!fechaEmisionDate) {
          errores.push({
            fila,
            estado: 'Error',
            detalles: 'Formato de fecha de emisión inválido.',
          });
          continue;
        }

        // Validar formato de fecha de pago si existe
        let fechaPagoDate = null;
        if (fechaPago) {
          fechaPagoDate = convertirFecha(fechaPago);
          if (!fechaPagoDate) {
            errores.push({
              fila,
              estado: 'Error',
              detalles: 'Formato de fecha de pago inválido.',
            });
            continue;
          }
        }

        // Validar estado
        if (!['pendiente', 'pagada', 'abonada'].includes(estado)) {
          errores.push({
            fila,
            estado: 'Error',
            detalles: `Estado inválido: ${estado}.`,
          });
          continue;
        }

        // Validar monto
        const montoNumber = parseFloat(monto);
        if (isNaN(montoNumber) || montoNumber < 0) {
          errores.push({
            fila,
            estado: 'Error',
            detalles: 'Monto inválido.',
          });
          continue;
        }

        // Verificar existencia del cliente
        const clienteExistente = await Cliente.findOne({ rut: clienteRut }).session(session);
        if (!clienteExistente) {
          errores.push({
            fila,
            estado: 'Error',
            detalles: `Cliente con RUT ${clienteRut} no encontrado.`,
          });
          continue;
        }
      }

      if (errores.length > 0) {
        // Si hay errores, abortar la transacción y devolver los errores
        await session.abortTransaction();
        session.endSession();

        // Eliminar el archivo temporal
        fs.unlinkSync(req.file.path);

        return res.status(400).json({
          message: 'Error en la carga masiva.',
          errores,
        });
      }

      // Insertar todos los honorarios en la base de datos dentro de la transacción
      const honorariosParaInsertar = resultados.map((item) => ({
        clienteRut: item.clienteRut,
        fechaEmision: convertirFecha(item.fechaEmision),
        fechaPago: item.fechaPago ? convertirFecha(item.fechaPago) : null,
        estado: item.estado,
        monto: parseFloat(item.monto),
      }));

      await Honorario.insertMany(honorariosParaInsertar, { session });

      // Commit de la transacción
      await session.commitTransaction();
      session.endSession();

      // Eliminar el archivo temporal
      fs.unlinkSync(req.file.path);

      // Enviar la respuesta con la confirmación de éxito
      res.status(200).json({ message: 'Carga completada exitosamente.' });
    } catch (error) {
      // Abort de la transacción en caso de error
      await session.abortTransaction();
      session.endSession();

      console.error('Error al procesar el archivo CSV:', error);
      // Eliminar el archivo temporal en caso de error
      fs.unlinkSync(req.file.path);
      res.status(500).json({ error: 'Error al procesar el archivo CSV.' });
    }
  }
)

// Obtener honorarios por RUT de cliente
router.get('/rut/:rut', verifyToken, checkRole(['ADMIN', 'FACTURACION']), async (req, res) => {
  try {
    const { rut } = req.params;
    const cliente = await Cliente.findOne({ rut });

    if (!cliente) {
      return res.status(404).json({ message: 'Cliente no encontrado.' });
    }

    // Buscar honorarios con clienteRut igual al RUT del cliente
    const honorarios = await Honorario.find({ clienteRut: cliente.rut });

    if (!honorarios.length) {
      return res.status(404).json({ message: 'No se encontraron honorarios para este cliente.' });
    }

    // Agregar el nombre del cliente manualmente
    const honorariosConCliente = honorarios.map(honorario => ({
      ...honorario.toObject(),
      clienteNombre: cliente.nombre,
    }));

    res.json(honorariosConCliente);
  } catch (error) {
    console.error(error);
    res.status(400).json({ message: 'Error al obtener honorarios.', error: error.message });
  }
})

// Obtener un honorario por su ID
router.get('/:id', verifyToken, checkRole(['ADMIN', 'FACTURACION']), async (req, res) => {
  const { id } = req.params;

  try {
    const honorario = await Honorario.findById(id);

    if (!honorario) {
      return res.status(404).json({ message: 'Honorario no encontrado.' });
    }

    // Obtener detalles del cliente basado en clienteRut
    const cliente = await Cliente.findOne({ rut: honorario.clienteRut });
    if (!cliente) {
      return res.status(404).json({ message: 'Cliente asociado no encontrado.' });
    }

    // Retornar honorario con detalles del cliente
    res.json({
      ...honorario.toObject(),
      clienteNombre: cliente.nombre,
      clienteRut: cliente.rut,
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
})


// Obtener honorarios con filtrado opcional por rango de fechas
router.get('/', verifyToken, checkRole(['ADMIN', 'USER']), async (req, res) => {
  const { year, month, startDate, endDate } = req.query;

  let filter = {};

  if (startDate && endDate) {
    filter.fechaEmision = {
      $gte: new Date(startDate),
      $lte: new Date(endDate),
    };
  } else if (year && month) {
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 1);
    filter.fechaEmision = {
      $gte: start,
      $lt: end,
    };
  }

  try {
    const honorarios = await Honorario.find(filter);
    // console.log(honorarios);

    // Obtener todos los clientes únicos de los honorarios encontrados
    const ruts = [...new Set(honorarios.map(h => h.clienteRut))];
    const clientes = await Cliente.find({ rut: { $in: ruts } });

    // Crear un mapa de RUT a datos de cliente
    const clientesMap = {};
    clientes.forEach(cliente => {
      clientesMap[cliente.rut] = cliente.nombre;
    });

    // Agregar el nombre del cliente a cada honorario
    const honorariosConCliente = honorarios.map(honorario => ({
      ...honorario.toObject(),
      clienteNombre: clientesMap[honorario.clienteRut] || 'Desconocido',
    }));

    res.json(honorariosConCliente);
  } catch (error) {
    console.error('Error al obtener los honorarios:', error);
    res.status(500).json({ message: 'Error al obtener los honorarios' });
  }
})


// Actualizar un honorario existente por ID
router.put('/:id', verifyToken, checkRole(['ADMIN', 'FACTURACION']), async (req, res) => {
  const { id } = req.params;
  const { clienteRut, fechaEmision, fechaPago, estado, monto } = req.body;

  try {
    // 1. Verificar si el cliente con el RUT dado existe
    const clienteExistente = await Cliente.findOne({ rut: clienteRut });
    if (!clienteExistente) {
      return res.status(400).json({ error: 'Cliente no encontrado' });
    }

    // 2. Obtener el honorario actual
    const honorarioActual = await Honorario.findById(id);
    if (!honorarioActual) {
      return res.status(404).json({ error: 'Honorario no encontrado' });
    }

    // 3. Preparar los campos a actualizar
    const camposActualizacion = {
      clienteRut: clienteExistente.rut,
      fechaEmision,
      fechaPago,
      estado,
      monto,
    };

    // Calcular la suma de los abonos existentes para este honorario
    const sumAbonosResult = await AbonoHonorario.aggregate([
      { $match: { honorario_id: honorarioActual._id } },
      { $group: { _id: null, total: { $sum: '$monto' } } },
    ]);

    const totalAbonado = sumAbonosResult[0]?.total || 0;

    //console.log(`Suma de abonos para el honorario ${id}: ${totalAbonado}`);

    // Manejar fechas dependiendo del estado
    if (estado === 'pagada') {
      camposActualizacion.fechaPago = new Date();
      camposActualizacion.total_abonado = monto; // Asignar total_abonado igual al monto si está pagado
    } else if (estado === 'abonada') {
      camposActualizacion.total_abonado = totalAbonado;
      camposActualizacion.fechaPago = null; // Opcional: puedes decidir si mantener o eliminar fechaPago
    } else if (estado === 'pendiente') {
      if (totalAbonado > 0) {
        // Si hay abonos previos, mantener el estado como 'abonada'
        camposActualizacion.estado = 'abonada';
      } else {
        // Si no hay abonos, permitir el estado 'pendiente'
        camposActualizacion.estado = 'pendiente';
      }
      camposActualizacion.total_abonado = totalAbonado; // Esto puede ser 0 o la suma de abonos
      camposActualizacion.fechaPago = null;
    }

    // Validar que `total_abonado` no exceda el `monto`
    if (camposActualizacion.total_abonado > monto) {
      return res.status(400).json({ error: 'El total abonado no puede exceder el monto del honorario.' });
    }

    // Actualizar el honorario en la base de datos
    const honorarioActualizado = await Honorario.findByIdAndUpdate(
      id,
      { $set: camposActualizacion },
      { new: true, runValidators: true }
    );

    if (!honorarioActualizado) {
      return res.status(404).json({ error: 'Honorario no encontrado para actualizar.' });
    }

    // Obtener detalles del cliente
    const cliente = await Cliente.findOne({ rut: honorarioActualizado.clienteRut });
    const honorarioConCliente = {
      ...honorarioActualizado.toObject(),
      clienteNombre: cliente ? cliente.nombre : 'Desconocido',
    };

   res.json(honorarioConCliente);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }

})


// Actualizar un honorario abonado existente por ID
router.put('/abonar/:honorarioId', verifyToken, checkRole(['ADMIN', 'FACTURACION']), async (req, res) => {
  const { honorarioId } = req.params;
  const { monto } = req.body;

  try {
    const honorarioExistente = await Honorario.findById(honorarioId);
    if (!honorarioExistente) {
      return res.status(404).json({ error: 'Honorario no encontrado' });
    }

    // Actualizar el total abonado
    honorarioExistente.total_abonado += monto;

    // Validar que total_abonado no exceda el monto del honorario
    if (honorarioExistente.total_abonado > honorarioExistente.monto) {
      return res.status(400).json({ error: 'El total abonado no puede exceder el monto del honorario.' });
    }

    // Actualizar el estado si es necesario
    if (honorarioExistente.total_abonado === honorarioExistente.monto) {
      honorarioExistente.estado = 'pagada';
      honorarioExistente.fechaPago = new Date();
    } else if (honorarioExistente.total_abonado > 0) {
      honorarioExistente.estado = 'abonada';
    }

    const honorarioActualizado = await honorarioExistente.save();

    // Obtener detalles del cliente
    const cliente = await Cliente.findOne({ rut: honorarioActualizado.clienteRut });
    const honorarioConCliente = {
      ...honorarioActualizado.toObject(),
      clienteNombre: cliente ? cliente.nombre : 'Desconocido',
    };

    res.json(honorarioConCliente);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
})


// Eliminar un honorario por su ID
router.delete('/:id', verifyToken, checkRole(['ADMIN', 'FACTURACION']), async (req, res) => {
  const { id } = req.params;

  try {
    const honorario = await Honorario.findById(id);

    if (!honorario) {
      return res.status(404).json({ error: 'Honorario no encontrado.' });
    }

    await honorario.deleteOne();

    res.json({ message: 'Honorario y abonos eliminados exitosamente', honorario });
  } catch (error) {
    console.error('Error al eliminar el honorario:', error);
    res.status(400).json({ error: error.message });
  }
})

module.exports = router;