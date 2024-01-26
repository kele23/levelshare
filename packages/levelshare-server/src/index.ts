import fastify from 'fastify';
import auth from './auth/index.js';
import maindb from './maindb.js';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import dbs from './dbs/index.js';
import fastifyCors from '@fastify/cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

////////////////// ENVIRONMENT VARIABLES
//LOAD!!!
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 8080;
const MAINDB_LOCATION = process.env.DBUSER_LOCATION || 'data';
const PRODUCTION = process.env.NODE_ENV === 'production';
const SECURE_COOKIES = process.env.NODE_ENV === 'production';
const JWT_SECRET = process.env.JWT_SECRET || '12345678901234567890';
const ENABLE_HTTPS = process.env.ENABLE_HTTPS || false;
const PRIVATE_KEY_PATH = process.env.PRIVATE_KEY
    ? path.resolve(process.env.PRIVATE_KEY)
    : path.join(__dirname, '..', 'certs', 'fastify.key');
const CERT_PATH = process.env.CERT
    ? path.resolve(process.env.CERT)
    : path.join(__dirname, '..', 'certs', 'fastify.cert');
const CORS_ORIGIN = process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : '*';

//////////////////////////// CODE

let httpsObj = {};
if (ENABLE_HTTPS) {
    httpsObj = {
        http2: true,
        https: {
            allowHTTP1: true, // fallback support for HTTP1
            key: fs.readFileSync(PRIVATE_KEY_PATH),
            cert: fs.readFileSync(CERT_PATH),
        },
    };
}

const app = fastify({
    logger: true,
    ...httpsObj,
});

await app.register(fastifyCors, {
    origin: CORS_ORIGIN,
    cacheControl: 3600,
});

// swagger
if (!PRODUCTION) {
    await app.register(fastifySwagger);

    await app.register(fastifySwaggerUi, {
        routePrefix: '/docs',
        uiConfig: {
            docExpansion: 'full',
            deepLinking: false,
        },
    });
}

// maindb plugin
app.register(maindb, { location: MAINDB_LOCATION });

// auth routes
app.register(auth, { secret: JWT_SECRET, secureCookies: SECURE_COOKIES });

// dbs
app.register(dbs);

// create server
const start = async () => {
    try {
        await app.listen({ port: PORT, host: '0.0.0.0' });
    } catch (err) {
        app.log.error(err);
        process.exit(1);
    }
};
start();
