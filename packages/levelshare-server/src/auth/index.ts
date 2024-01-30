import fastifyAuth from '@fastify/auth';
import jwt from '@fastify/jwt';
import { FastifyInstance, FastifyPluginAsync, FastifyPluginOptions, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { Level } from 'level';
import {
    CheckResp,
    CheckRespType,
    LoginReq,
    LoginReqType,
    LoginResp,
    LoginRespType,
    RefreshReq,
    RefreshReqType,
    RefreshResp,
    RefreshRespType,
    User,
    UserTokenPayload,
} from './type.js';
import { checkInitUsers, checkLogin, getUser } from '../user/index.js';

declare module 'fastify' {
    interface FastifyInstance {
        users: Level<string, User>;
        verifyUsernamePassword: (req: FastifyRequest, rpl: FastifyReply) => Promise<void>;
        verifyJWT: (req: FastifyRequest, rpl: FastifyReply) => Promise<void>;
        verifyRefresh: (req: FastifyRequest, rpl: FastifyReply) => Promise<void>;
    }
}

export type AuthOptions = FastifyPluginOptions & {
    secret: string;
    secureCookies: boolean;
};

const AuthPlugin: FastifyPluginAsync<AuthOptions> = async (fastify: FastifyInstance, options: AuthOptions) => {
    // basic decorate
    const userDb = fastify.db.sublevel<string, User>('users', { valueEncoding: 'json' }) as unknown as Level<
        string,
        User
    >;
    fastify.decorate('users', userDb);
    await checkInitUsers(fastify, userDb);

    // auth decorate
    fastify.decorate('verifyUsernamePassword', async function (req: FastifyRequest, _: FastifyReply): Promise<void> {
        const body = req.body as LoginReqType;
        await checkLogin(body, fastify.users);
    });
    fastify.decorate('verifyJWT', async function (req: FastifyRequest, _: FastifyReply): Promise<void> {
        const payload = (await req.jwtVerify()) as UserTokenPayload;
        if (payload.refresh) throw 'Cannot use RefreshToken for standard operations';
    });

    // auth, jwt and cookie plugins
    fastify.register(jwt, {
        secret: options.secret,
        sign: {
            expiresIn: '10m',
        },
    });
    fastify.register(fastifyAuth);

    //////// after
    await fastify.after();

    //////// routes

    fastify.route<{ Body: LoginReqType; Reply: LoginRespType }>({
        method: 'POST',
        url: '/auth/login',
        schema: {
            description: 'Login user using username & password',
            tags: ['Auth'],
            body: LoginReq,
            response: {
                200: LoginResp,
            },
        },
        preHandler: fastify.auth([fastify.verifyUsernamePassword]),
        handler: async (req, rpl) => {
            const user = await getUser(req.body.username, fastify.users);

            // main token
            const token = await rpl.jwtSign({
                username: req.body.username,
                roles: user.roles,
            });

            // refresh token
            const refreshToken = await rpl.jwtSign(
                {
                    username: req.body.username,
                    roles: user.roles,
                    refresh: true,
                },
                { expiresIn: '1d' },
            );

            // send response
            rpl.code(200).send({ token, refreshToken });
        },
    });

    fastify.route<{ Body: RefreshReqType; Reply: RefreshRespType }>({
        method: 'POST',
        url: '/auth/refresh',
        schema: {
            description: 'Refresh user token',
            tags: ['Auth'],
            body: RefreshReq,
            response: {
                200: RefreshResp,
            },
        },
        handler: async (req, rpl) => {
            const payload = fastify.jwt.verify<UserTokenPayload>(req.body.refreshToken);
            if (!payload.refresh) throw 'You need to pass refresh token';

            const user = payload as UserTokenPayload;

            // main token
            const token = await rpl.jwtSign({
                username: user.username,
                roles: user.roles,
            });

            // send response
            rpl.code(200).send({ token });
        },
    });

    fastify.route<{ Reply: CheckRespType }>({
        method: 'GET',
        url: '/auth/check',
        schema: {
            description: 'Check user token',
            tags: ['Auth'],
            response: {
                200: CheckResp,
            },
        },
        preHandler: fastify.auth([fastify.verifyJWT]),
        handler: async (req, rpl) => {
            const pay = req.user as UserTokenPayload;
            rpl.code(200).send(pay);
        },
    });

    fastify.route({
        method: 'GET',
        url: '/auth/logout',
        schema: {
            description: 'Logout user',
            tags: ['Auth'],
        },
        preHandler: fastify.auth([fastify.verifyJWT]),
        handler: async (_, rpl) => {
            rpl.code(200).send();
        },
    });
};
export default fp(AuthPlugin);
