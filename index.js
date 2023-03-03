require('dotenv').config();
const express = require('express');
const app = express()
const port = process.env.PORT
const user = process.env.DBUSER
const password = process.env.PASSWORD
const qrcode = require('qrcode-terminal');
const bodyParser = require("body-parser");
const multer = require('multer');
const path = require('path');
const fs = require('fs')
const mime = require('mime-types')
const shortid = require('shortid');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');

//middlewares
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, path.join(__dirname, '/uploads/')) // Directorio a donde iran los archivos subidos
    },
    filename: function (req, file, cb) {
      cb(null, `${Date.now()}-${file.originalname}`)
    }
  })
const upload = multer({ storage: storage })

//Sesiones creadas ////////////////////////////
const client1 = new Client(
    {
        authStrategy: new LocalAuth({ clientId: "client-one" })
    }
);
const client2 = new Client(
    {
        authStrategy: new LocalAuth({ clientId: "two-one" })
    }
)

let QR1 = null
let QR2 = null
//Sesiones creadas ///////////////////////////

//creando conexion con la base de datos
var mysql = require('mysql');
var conexion= mysql.createConnection({
    host     : process.env.HOST,
    database : process.env.DB,
    user     : user,
    password : password,
});

conexion.connect(function(err) {
    if (err) {
        console.error('Error de conexion: ' + err.stack);
        return;
    }
    console.log('Conectado con el identificador ' + conexion.threadId);
});

//const client = new Client({
  //  authStrategy: new LocalAuth()
//});
client1.on('qr', qr => {
        QR1 = qr 
});

client2.on('qr', qr => {
    QR2 = qr 
});

//ruta para vincular
app.get('/vincular', (req, res) => {
    console.log('Sesion 1')
    qrcode.generate(QR1, {small: true});
    console.log('Sesion 2')
    qrcode.generate(QR2, {small: true});
    res.send('qr en consola')
})
client1.on('ready', () => {
    console.log('Sesion 1 vinculada de forma exitosa');
});

client2.on('ready', () => {
    console.log('Sesion 2 vinculada de forma exitosa');
});

//funcion para responder mensajes
const replyMessage = async (message, res) => {
    if(message.body === 'Hola!') {
		message.reply(res);
	}

    //guarda las imagenes
    if(message.hasMedia) {
        const media = await message.downloadMedia();
        const ext = mime.extension(media.mimetype);
        const filename = shortid.generate();
        fs.writeFile('./files/'+filename + '.' + ext, media.data, {encoding:'base64'},function(error){
            if(error){
                console.log(error)
            }else{
                console.log('archivo creado')
            }
        })
    }

    const userdata = {
        mensaje: message.body,
        nombre: message._data.notifyName,
        fecha: new Date().toISOString().slice(0, 19).replace('T', ' '),
        tipo: message._data.type,
        autor: message._data.notifyName
    }

    // si el mensaje es de texto se guarda en la base de datos directamente
    console.log(userdata.tipo)
    if (userdata.tipo == 'chat'){

        const query = `INSERT INTO mensajes (nick, mensaje, fecha, tipo, autor) VALUES ("${userdata.nombre}", "${userdata.mensaje}", "${userdata.fecha}", "${userdata.tipo}", "${userdata.autor}")`
        //guardando mensaje en la base de datos
        conexion.query(query, function (error, results, fields) {
            if (error)
            throw error;
        });
    }
    
}

//se ejecuta cuando llega un mensaje
client1.on('message', async message => {
    conexion.query('SELECT * FROM respuestas WHERE id = 1', function (error, results, fields) {
        if(message.body === '') {
            replyMessage(message, results[0].mensaje)
        }
    });
	
});

client2.on('message', message => {
	conexion.query('SELECT * FROM respuestas WHERE id = 2', function (error, results, fields) {
        if(message.body === '') {
            replyMessage(message, results[0].mensaje)
        }
    });
});

client1.initialize();
client2.initialize();

/////////////////////////////////////////////////////////////////
// RUTAS DE LA API /////////////////////////////////////////////
///////////////////////////////////////////////////////////////

// ruta para ver los mensajes guardados
app.get('/mensajes', (req, res) => {   
    conexion.query('SELECT * FROM mensajes', function (error, results, fields) {
        res.send(results)
    });
})

// obtener lista de respuestas
app.get('/respuestas', (req, res) => {
    conexion.query('SELECT * FROM respuestas', function (error, results, fields) {
        res.send(results)
    });
})

//endpoint para modificar las respuestas automaticas
app.post('/modrespuestas', (req, res) => {

    const id = req.body.id
    const mensaje = req.body.mensaje
    const asunto = req.body.asunto

    conexion.query(`UPDATE respuestas SET mensaje="${mensaje}", asunto="${asunto}" WHERE id=${id}`, function (error, results, fields) {
        if (error)
            throw error;

        console.log(results)

    });
    res.send('enviar respuestas')
})

// ruta para agregar nuevas respuestas
app.post('/addrespuesta', (req, res) => {

    const mensaje = req.body.mensaje
    const asunto = req.body.asunto
    const query = `INSERT INTO respuestas (mensaje, asunto) VALUES ("${mensaje}", "${asunto}")`

    conexion.query(query, function (error, results, fields) {
        if (error)
        throw error;
    });

    res.send('respuesta agregada')

})

// ruta para enviar un mensaje a un numero especifico
app.post('/enviar', (req, res) => {

    //datos del mensaje
    const number = req.body.numero;
    const text = req.body.mensaje;
    const sesion = req.body.sesion;
    const fecha = new Date().toISOString().slice(0, 19).replace('T', ' ');

    // envia un mensaje a cada numero
    number.forEach(num => {
        const chatId = num.substring(1) + "@c.us";
        eval('client'+sesion+'.sendMessage(chatId, text);')
    })

    const query = `INSERT INTO mensajes (nick, mensaje, fecha, tipo, autor) VALUES ("admin", "${text}", "${fecha}", "chat", "admin")`
    //guardando mensaje en la base de datos
    conexion.query(query, function (error, results, fields) {
        if (error)
        throw error;
    });
    
    res.send('mensaje enviado')

})

// ruta para enviar archivos al chat
app.post('/media', upload.single('file'), (req, res) => {

    //datos del mensaje
    const number = req.body.numero;
    const sesion = req.body.sesion;

    //toma el archivo a enviar
    const media = MessageMedia.fromFilePath(req.file.path);
    
    number.forEach(num => {
        const chatId = num.substring(1) + "@c.us";
        eval('client'+sesion+'.sendMessage(chatId, media);')
    })

    res.send('mensaje enviado')
})

app.listen(port, () => {
    console.log('servidor en el puerto 3000')
})