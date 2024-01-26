import { SyncRequest, SyncResponse } from '@kele23/levelshare';
import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { UserTokenPayload } from '../auth/type.js';
import { ADMINISTRATOR_ROLE } from '../auth/user.js';
import { getShareLevel } from './sync.js';

const DBPlugin: FastifyPluginAsync = async (fastify: FastifyInstance) => {


    fastify.after(() => {
        fastify.route<{ Body: SyncRequest; Reply: SyncResponse }>({
            method: 'POST',
            url: '/dbs/:name/sync',
            schema: {
                description: 'Sync DB with name',
                tags: ['DBs'],
            },
            preHandler: fastify.auth([fastify.verifyJWT]),
            handler: async (req, rpl) => {
                const { name } = req.params as { name: string };

                const user = req.user as UserTokenPayload;
                let permit = false;
                if (name == user.username) permit = true;
                if (user.roles.includes(name)) permit = true;
                if (user.roles.includes(ADMINISTRATOR_ROLE)) permit = true;

                if (!permit) {
                    throw new Error('Access denied');
                }

                const sync = await getShareLevel(name, fastify.db);
                const data = await sync.receive(req.body);
                rpl.send(data);
            },
        });
    });
};

export default fp(DBPlugin);
